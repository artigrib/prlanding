"""LLM clients for the forge agent: OpenRouter chat completions, and a mock that replays a script.

The OpenRouter key comes from the environment of the forge-worker container (OPENROUTER_API_KEY, a
deploy secret). It is read once, removed from os.environ (so no child process inherits it) and only
ever put into the Authorization header of requests to the fixed OpenRouter URL. It is never logged,
never part of an error message, never written to a job file.

chat(purpose, model, messages, tools, max_tokens) -> {"message": {...}, "usage": {"prompt_tokens",
"completion_tokens", "cost_usd", "cost_source"}}. `purpose` is "parse", "design" or "guide" (the mock
uses it to pick the scripted answer; OpenRouter ignores it).
"""
import copy
import json
import os
import urllib.error
import urllib.request

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"  # fixed: not configurable by env or by the LLM


class LLMError(Exception):
    """Fixed, key-free message; `kind` is one of http, network, response, auth."""

    def __init__(self, kind, msg):
        super().__init__(msg)
        self.kind = kind


def estimate_cost(usage, price_in, price_out):
    """USD from token counts with per-million prices (fallback when the provider gives no cost)."""
    return (usage.get("prompt_tokens", 0) * price_in + usage.get("completion_tokens", 0) * price_out) / 1e6


class OpenRouterClient:
    def __init__(self, key, prices=None, default_price=(15.0, 75.0), timeout_s=180, opener=None):
        if not key:
            raise ValueError("no OpenRouter key")
        self._key = key
        self.prices = dict(prices or {})          # model -> (USD per M input tokens, USD per M output tokens)
        self.default_price = default_price
        self.timeout_s = timeout_s
        self._open = opener or urllib.request.urlopen

    @classmethod
    def from_env(cls, prices=None, env=None):
        """Reads OPENROUTER_API_KEY and removes it from os.environ (children never inherit it)."""
        env = os.environ if env is None else env
        key = env.pop("OPENROUTER_API_KEY", "") if env is os.environ else env.get("OPENROUTER_API_KEY", "")
        return cls(key.strip(), prices)

    def price_for(self, model):
        return self.prices.get(model, self.default_price)

    def __repr__(self):
        return "OpenRouterClient(key=<hidden>)"

    def chat(self, purpose, model, messages, tools=None, max_tokens=4096):
        body = {"model": model, "messages": messages, "max_tokens": int(max_tokens), "temperature": 0.2,
                "usage": {"include": True}}
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        req = urllib.request.Request(OPENROUTER_URL, data=json.dumps(body).encode(), method="POST", headers={
            "Authorization": "Bearer " + self._key, "Content-Type": "application/json",
            "HTTP-Referer": "https://printedrobotics.cz", "X-Title": "printedrobotics forge"})
        try:
            with self._open(req, timeout=self.timeout_s) as r:
                raw = r.read(8 * 1024 * 1024)
        except urllib.error.HTTPError as e:
            kind = "auth" if e.code in (401, 403) else "http"
            raise LLMError(kind, f"OpenRouter HTTP {e.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise LLMError("network", f"OpenRouter unreachable ({type(e).__name__})") from None
        try:
            data = json.loads(raw)
            msg = data["choices"][0]["message"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise LLMError("response", "OpenRouter: unexpected response") from None
        u = data.get("usage") or {}
        usage = {"prompt_tokens": int(u.get("prompt_tokens") or 0), "completion_tokens": int(u.get("completion_tokens") or 0)}
        if isinstance(u.get("cost"), (int, float)):
            usage.update(cost_usd=float(u["cost"]), cost_source="openrouter")
        else:
            usage.update(cost_usd=estimate_cost(usage, *self.price_for(model)), cost_source="estimate")
        return {"message": msg, "usage": usage}


class MockLLM:
    """Replays a recorded script: {"parse": msg, "design": [msg, ...], "guide": msg, "usage": {...}}.

    Every call returns the next scripted message for its purpose with the scripted usage (tokens and
    cost), so budget caps can be tested without any network. `calls` records what the agent sent.
    """

    def __init__(self, script, usage=None):
        self.script = copy.deepcopy(script)
        self.usage = usage or self.script.get("usage") or {"prompt_tokens": 1000, "completion_tokens": 200, "cost_usd": 0.01}
        self.pos = {"parse": 0, "design": 0, "guide": 0}
        self.calls = []

    def chat(self, purpose, model, messages, tools=None, max_tokens=4096):
        self.calls.append({"purpose": purpose, "model": model, "messages": copy.deepcopy(messages),
                           "tools": [t["function"]["name"] for t in (tools or [])], "max_tokens": max_tokens})
        item = self.script[purpose]
        if isinstance(item, list):
            i = self.pos[purpose]
            if i >= len(item):
                msg = {"role": "assistant", "content": "{}"}
            else:
                msg = item[i]
            self.pos[purpose] = i + 1
        else:
            msg = item
        return {"message": copy.deepcopy(msg), "usage": dict(self.usage, cost_source="mock")}
