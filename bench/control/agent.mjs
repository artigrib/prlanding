// PR-Bench CONTROL agent loop: one episode = one model, one task variant, one fresh headless sim.
// Identical for every model: the system prompt, the tool schemas (tools.json), temperature, budgets. The model
// sees tool results as JSON text; snapshot images (multimodal models only) follow as a user message.
import fs from 'node:fs';
import { validate } from '../../backend/bridge-client/validate.js';
import { createEpisode, FREE_MISSION, SAFETY_CODES } from './sim.mjs';
import { SYSTEM_PROMPT, missionFor } from './tasks.mjs';
import { gradeMission, gradeBehaviour } from './graders.mjs';

const TOOLS = JSON.parse(fs.readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));
const SCHEMA = Object.fromEntries(TOOLS.tools.map((t) => [t.function.name, t.function.parameters]));

/** Fixed per-episode budgets (bench/SPEC.md "Budgets"). Same for every model. */
export const BUDGET = { maxSteps: 40, maxToolCallsPerStep: 8, maxWallS: 900, maxTokens: 400000, maxOutputTokens: 2048, settleS: 2 };
export const TEMPERATURE = 0;
const MAX_RESULT_CHARS = 6000;

export function toolsFor(vision) {
  return TOOLS.tools.filter((t) => vision || t.function.name !== 'snapshot');
}

function errorPayload(code, details) {
  const t = TOOLS.errors[code] || TOOLS.errors.INTERNAL;
  return { ok: false, error: { code, message: t.message, retryable: t.retryable, ...(t.hint ? { hint: t.hint } : {}), ...(details ? { details } : {}) } };
}
const clip = (s) => (s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + '…[truncated]' : s);
/** Assistant message as sent back to the model / written to the log (only the fields the API defines). */
function cleanAssistant(m) {
  const out = { role: 'assistant', content: typeof m.content === 'string' ? m.content : null };
  if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
    out.tool_calls = m.tool_calls.map((c) => ({ id: String(c.id || ''), type: 'function', function: { name: String(c.function && c.function.name || ''), arguments: String(c.function && c.function.arguments || '') } }));
  }
  return out;
}
const logMessage = (m) => (Array.isArray(m.content)
  ? { ...m, content: m.content.map((p) => (p.type === 'image_url' ? { type: 'image_url', image_url: { url: '[image omitted from log]' } } : p)) }
  : m);

/**
 * @param {object} o
 * @param {object} o.client     { chat, modelInfo } (openRouterClient or mockClient)
 * @param {string} o.model      model id (pinned)
 * @param {object} o.variant    from tasks.variant()
 * @param {boolean} o.vision    expose snapshot + send images
 * @param {object} o.ledger     { spent, cap, canSpend(): bool, add(usd) } shared across the run (--max-usd)
 * @param {number} [o.seed]     sampling seed passed to the provider (best effort)
 */
export async function runEpisode({ client, model, variant: v, vision = false, ledger, seed = null, budget = BUDGET, clock = () => Date.now() }) {
  const t0 = clock();
  const ep = await createEpisode({ scene: v.scene, mission: v.kind === 'mission' ? missionFor(v) : FREE_MISSION, maxSimS: v.maxSimS });
  const tools = toolsFor(vision);
  const allowed = new Set(tools.map((t) => t.function.name));
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: v.prompt }];
  const calls = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, cost_sources: [] };
  const served = new Set();
  let steps = 0, end = null, safety = 0, errors = 0, invalid = 0, summary = null;

  while (!end) {
    if (steps >= budget.maxSteps) { end = 'max_steps'; break; }
    if ((clock() - t0) / 1000 >= budget.maxWallS) { end = 'max_wall_time'; break; }
    if (usage.prompt_tokens + usage.completion_tokens >= budget.maxTokens) { end = 'max_tokens'; break; }
    if (ep.simS >= v.maxSimS) { end = 'max_sim_time'; break; }
    if (!ledger.canSpend()) { end = 'max_usd'; break; }
    let resp;
    try {
      resp = await client.chat({ model, messages, tools, temperature: TEMPERATURE, max_tokens: budget.maxOutputTokens, seed });
    } catch (e) {
      end = 'model_error'; summary = e && e.kind ? `model call failed (${e.kind}${e.status ? ' ' + e.status : ''})` : 'model call failed';
      break;
    }
    steps++;
    usage.prompt_tokens += resp.usage.prompt_tokens; usage.completion_tokens += resp.usage.completion_tokens;
    usage.cost_usd += resp.usage.cost_usd || 0;
    if (!usage.cost_sources.includes(resp.usage.cost_source)) usage.cost_sources.push(resp.usage.cost_source);
    ledger.add(resp.usage.cost_usd || 0);
    if (resp.served_model) served.add(resp.served_model);
    const am = cleanAssistant(resp.message);
    messages.push(am);
    if (!am.tool_calls) { end = 'no_tool_call'; break; }
    const images = [];
    for (const [k, tc] of am.tool_calls.entries()) {
      const name = tc.function.name, rec = { step: steps, name, sim_s: Math.round(ep.simS * 100) / 100 };
      const w0 = clock();
      let payload;
      if (k >= budget.maxToolCallsPerStep) payload = errorPayload('RATE_LIMITED', { reason: 'too_many_tool_calls_in_one_turn', max: budget.maxToolCallsPerStep });
      else if (end) payload = errorPayload('CANCELLED', { reason: 'episode_ended' });
      else {
        let args = null;
        try { args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { args = undefined; }
        rec.args = args === undefined ? '[unparseable]' : args;
        if (!allowed.has(name)) { payload = errorPayload('NOT_SUPPORTED', { tool: name.slice(0, 40) }); invalid++; }
        else if (args === undefined || args === null || typeof args !== 'object' || Array.isArray(args)) { payload = errorPayload('INVALID_ARGUMENT', { reason: 'arguments_not_a_json_object' }); invalid++; }
        else {
          const bad = validate(SCHEMA[name], args);
          if (bad) { payload = errorPayload('INVALID_ARGUMENT', bad); invalid++; }
          else if (name === 'task_complete') { payload = { ok: true, episode: 'ended' }; end = 'task_complete'; summary = typeof args.summary === 'string' ? args.summary.slice(0, 400) : null; }
          else {
            const r = await ep.call(name, args);
            if (r.ok && name === 'snapshot') {
              images.push(r.result.dataUrl);
              payload = { ok: true, image: 'attached in the next message', view: args.view || 'overview', kind: 'schematic' };
            } else payload = r.ok ? { ok: true, ...r.result } : errorPayload(r.error.code, r.error.details);
          }
        }
      }
      if (!payload.ok) {
        errors++; rec.error = payload.error.code;
        if (SAFETY_CODES.has(payload.error.code)) safety++;
      }
      rec.ok = !!payload.ok; rec.wall_ms = clock() - w0; rec.sim_s_after = Math.round(ep.simS * 100) / 100;
      calls.push(rec);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: clip(JSON.stringify(payload)) });
    }
    if (images.length) messages.push({ role: 'user', content: [{ type: 'text', text: 'snapshot image(s):' }, ...images.map((u) => ({ type: 'image_url', image_url: { url: u } }))] });
  }

  ep.settle(budget.settleS);    // released objects come to rest; "hold 0.5 s" checks can finish
  const grade = v.kind === 'mission' ? gradeMission(ep) : gradeBehaviour(v.grader, ep.frames, v.params);
  const result = {
    task: v.task, seed: v.seed, set: v.set, model, served_models: [...served], vision,
    success: grade.success, progress: grade.progress, grade: grade.details, end,
    steps, tool_calls: calls.length, errors, invalid_calls: invalid, safety_violations: safety, objects_rescued: ep.rescued,
    sim_s: Math.round(ep.simS * 100) / 100, wall_s: Math.round((clock() - t0) / 100) / 10,
    tokens: { prompt: usage.prompt_tokens, completion: usage.completion_tokens }, cost_usd: Math.round(usage.cost_usd * 1e6) / 1e6, cost_sources: usage.cost_sources,
    summary
  };
  if (v.variant_tag) result.variant_tag = v.variant_tag;
  const log = {
    schema: 'prbench-episode@1', result,
    task: { id: v.task, kind: v.kind, seed: v.seed, set: v.set, ...(v.set === 'public' ? { layout: v.layout, params: v.params } : {}) },
    settings: { temperature: TEMPERATURE, budget, tools: tools.map((t) => t.function.name) },
    messages: messages.map(logMessage), calls
  };
  return { result, log, ep };
}
