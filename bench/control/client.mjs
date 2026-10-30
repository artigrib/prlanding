// OpenRouter-compatible chat client for PR-Bench (OpenAI-style function calling, streaming off).
// The key comes from env OPENROUTER_API_KEY only (on the VPS: secret OPENROUTER_SECRET -> env). It is put into the
// Authorization header and nowhere else: never logged, never in errors, results or episode logs.
// Base URL: env OPENROUTER_BASE_URL (default https://openrouter.ai/api/v1); https only (http only for localhost tests).

export class ClientError extends Error {
  /** kind: auth | http | network | response | config. The message is fixed text, never the response body. */
  constructor(kind, status) { super(`model call failed (${kind}${status ? ' ' + status : ''})`); this.kind = kind; this.status = status || null; }
}

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_PRICE = [15, 75];          // USD per M tokens (in, out): conservative fallback when no cost is reported

export function baseUrlFrom(env) {
  const u = (env.OPENROUTER_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  let p;
  try { p = new URL(u); } catch { throw new ClientError('config'); }
  const local = p.hostname === '127.0.0.1' || p.hostname === 'localhost';
  if (p.protocol !== 'https:' && !(local && p.protocol === 'http:')) throw new ClientError('config');
  return u;
}

export function openRouterClient({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 180000, retries = 2 } = {}) {
  const key = (env.OPENROUTER_API_KEY || '').trim();
  if (!key) throw new ClientError('config');
  const base = baseUrlFrom(env);
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://printedrobotics.cz', 'X-Title': 'printedrobotics PR-Bench' };
  let models = null;

  async function post(path, body) {
    for (let attempt = 0; ; attempt++) {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
      let res;
      try { res = await fetchImpl(base + path, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal }); }
      catch { clearTimeout(t); if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; } throw new ClientError('network'); }
      clearTimeout(t);
      if (res.status === 401 || res.status === 403) throw new ClientError('auth', res.status);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(3000 * (attempt + 1)); continue; }
      if (!res.ok) throw new ClientError('http', res.status);
      try { return await res.json(); } catch { throw new ClientError('response'); }
    }
  }

  /** Model metadata from GET /models (pricing, input modalities). Cached; failures = null (fallbacks apply). */
  async function modelInfo(model) {
    if (!models) {
      try {
        const res = await fetchImpl(base + '/models', { headers: { Authorization: headers.Authorization } });
        const j = res.ok ? await res.json() : null;
        models = new Map(((j && j.data) || []).map((x) => [x.id, x]));
      } catch { models = new Map(); }
    }
    const x = models.get(model);
    if (!x) return null;
    const pr = x.pricing || {};
    return {
      id: x.id, vision: !!(x.architecture && (x.architecture.input_modalities || []).includes('image')),
      price_in_per_m: +pr.prompt * 1e6 || null, price_out_per_m: +pr.completion * 1e6 || null
    };
  }

  async function chat({ model, messages, tools, temperature, max_tokens, seed }) {
    const body = { model, messages, tools, tool_choice: 'auto', temperature, max_tokens, stream: false, usage: { include: true } };
    if (seed != null) body.seed = seed;
    const data = await post('/chat/completions', body);
    const choice = data && data.choices && data.choices[0];
    if (!choice || !choice.message) throw new ClientError('response');
    const u = data.usage || {};
    const usage = { prompt_tokens: +u.prompt_tokens || 0, completion_tokens: +u.completion_tokens || 0 };
    if (typeof u.cost === 'number') Object.assign(usage, { cost_usd: u.cost, cost_source: 'openrouter' });
    else {
      const info = await modelInfo(model);
      const [pi, po] = info && info.price_in_per_m != null ? [info.price_in_per_m, info.price_out_per_m || 0] : DEFAULT_PRICE;
      Object.assign(usage, { cost_usd: (usage.prompt_tokens * pi + usage.completion_tokens * po) / 1e6, cost_source: 'estimate' });
    }
    return { message: choice.message, finish_reason: choice.finish_reason || null, usage, served_model: typeof data.model === 'string' ? data.model.slice(0, 120) : null, provider: typeof data.provider === 'string' ? data.provider.slice(0, 60) : null };
  }
  return { chat, modelInfo, kind: 'openrouter' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
