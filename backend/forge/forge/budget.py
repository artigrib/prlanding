"""Spend caps for forge jobs: per job (tokens, USD, LLM calls, run_cad calls) and per day (USD).

The daily ledger is <jobs>/spend/<YYYY-MM-DD>.json (UTC day), written only by the worker (one job at a
time, atomic replace). The api reads the same file to refuse new jobs once the day's cap is reached.
Costs come from OpenRouter's usage.cost when present, otherwise an estimate from token counts with the
configured per-million prices (FORGE_PRICE_IN / FORGE_PRICE_OUT, deliberately high defaults).

Before every LLM call the agent asks `check(reserve_usd)`: the call is refused if what is already
spent plus a worst-case reserve for that call would pass a cap. The LLM has no way to change any of
these numbers: they come from the worker's environment only.
"""
import datetime
import json
import os


class BudgetExceeded(Exception):
    def __init__(self, which, msg):
        super().__init__(msg)
        self.which = which


def today(now=None):
    return (now or datetime.datetime.now(datetime.timezone.utc)).strftime("%Y-%m-%d")


class Ledger:
    def __init__(self, jobs_dir, clock=None):
        self.dir = os.path.join(jobs_dir, "spend")
        self.clock = clock

    def _path(self):
        return os.path.join(self.dir, today(self.clock() if self.clock else None) + ".json")

    def read(self):
        try:
            with open(self._path(), encoding="utf-8") as f:
                d = json.load(f)
            return {"usd": float(d.get("usd", 0)), "tokens": int(d.get("tokens", 0)), "calls": int(d.get("calls", 0))}
        except (OSError, ValueError, TypeError):
            return {"usd": 0.0, "tokens": 0, "calls": 0}

    def add(self, usd, tokens):
        os.makedirs(self.dir, exist_ok=True)
        d = self.read()
        d = {"usd": round(d["usd"] + usd, 6), "tokens": d["tokens"] + tokens, "calls": d["calls"] + 1}
        tmp = self._path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f)
        os.replace(tmp, self._path())
        return d


class JobBudget:
    def __init__(self, ledger, job_usd, job_tokens, daily_usd, max_llm_calls=40, max_cad_calls=12):
        self.ledger = ledger
        self.job_usd, self.job_tokens, self.daily_usd = float(job_usd), int(job_tokens), float(daily_usd)
        self.max_llm_calls, self.max_cad_calls = int(max_llm_calls), int(max_cad_calls)
        self.usd = 0.0
        self.tokens = 0
        self.llm_calls = 0
        self.cad_calls = 0

    def check(self, reserve_usd=0.0, reserve_tokens=0):
        if self.llm_calls >= self.max_llm_calls:
            raise BudgetExceeded("job_calls", f"job limit reached: {self.max_llm_calls} LLM calls")
        if self.tokens + reserve_tokens > self.job_tokens:
            raise BudgetExceeded("job_tokens", f"job token cap reached ({self.tokens} of {self.job_tokens} tokens used)")
        if self.usd + reserve_usd > self.job_usd:
            raise BudgetExceeded("job_usd", f"job cost cap reached (${self.usd:.2f} spent, cap ${self.job_usd:.2f})")
        day = self.ledger.read()["usd"]
        if day + reserve_usd > self.daily_usd:
            raise BudgetExceeded("daily_usd", f"daily cost cap reached (${day:.2f} spent today, cap ${self.daily_usd:.2f})")

    def record(self, usage):
        usd = float(usage.get("cost_usd") or 0.0)
        tok = int(usage.get("prompt_tokens") or 0) + int(usage.get("completion_tokens") or 0)
        self.usd += usd
        self.tokens += tok
        self.llm_calls += 1
        self.ledger.add(usd, tok)

    def take_cad(self):
        if self.cad_calls >= self.max_cad_calls:
            raise BudgetExceeded("cad_calls", f"job limit reached: {self.max_cad_calls} run_cad calls")
        self.cad_calls += 1
        return self.cad_calls

    def snapshot(self):
        return {"cost_usd": round(self.usd, 4), "tokens": self.tokens, "llm_calls": self.llm_calls, "cad_calls": self.cad_calls,
                "caps": {"job_usd": self.job_usd, "job_tokens": self.job_tokens, "daily_usd": self.daily_usd,
                         "llm_calls": self.max_llm_calls, "cad_calls": self.max_cad_calls}}
