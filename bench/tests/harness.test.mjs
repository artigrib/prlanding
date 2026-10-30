// PR-Bench harness unit tests: tool translation, task variants, graders, score, client, runner guards.
// No network, no keys (the OpenRouter client is tested against a fake fetch).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build, BENCH_TOOLS } from '../control/gen-tools.mjs';
import { toolsFor } from '../control/agent.mjs';
import { TASKS, variant, jitterLayout, rng, resolveTasks } from '../control/tasks.mjs';
import { countSwings, gradeWave, gradeSquare, squareCorners } from '../control/graders.mjs';
import { episodePoints, aggregate } from '../control/score.mjs';
import { openRouterClient, ClientError } from '../control/client.mjs';
import { parseArgs, createLedger, main } from '../run.mjs';
import { HANDLER_METHODS } from '../../backend/bridge-client/agent-bridge.js';
import { MISSIONS } from '../../sim/so101/src/missions.js';

const TOOLS = JSON.parse(fs.readFileSync(new URL('../control/tools.json', import.meta.url), 'utf8'));

test('tools.json is generated from the bridge schemas and up to date', async () => {
  const fresh = await build();
  assert.equal(JSON.stringify(fresh, null, 1) + '\n', fs.readFileSync(new URL('../control/tools.json', import.meta.url), 'utf8'), 'run node bench/control/gen-tools.mjs');
  for (const t of TOOLS.tools) {
    assert.equal(t.type, 'function');
    const name = t.function.name, props = t.function.parameters.properties || {};
    assert.ok(name === 'task_complete' || HANDLER_METHODS[name], name + ' is a bridge tool');
    for (const k of ['session', 'request_id', 'preempt']) assert.ok(!(k in props), `${name}.${k} dropped`);
    assert.ok(t.function.description.length > 20);
  }
  assert.deepEqual(TOOLS.tools.map((t) => t.function.name), [...BENCH_TOOLS, 'task_complete']);
  assert.equal(TOOLS.errors.OUT_OF_LIMITS.retryable, false);
  assert.match(TOOLS.missions.bowl.goal_en, /orange cube/);
});

test('text-only models get no snapshot tool; multimodal ones do; order is fixed', () => {
  assert.ok(!toolsFor(false).some((t) => t.function.name === 'snapshot'));
  assert.ok(toolsFor(true).some((t) => t.function.name === 'snapshot'));
  assert.deepEqual(toolsFor(false).map((t) => t.function.name), toolsFor(false).map((t) => t.function.name));
});

test('public set: 10 missions + 2 behaviour tasks; seed 0 = the mission layout; variants are deterministic', () => {
  assert.equal(TASKS.length, 12);
  assert.equal(TASKS.filter((t) => t.kind === 'mission').length, 10);
  assert.equal(TASKS.filter((t) => t.kind === 'behaviour').length, 2);
  for (const t of TASKS.filter((x) => x.kind === 'mission')) {
    const v0 = variant(t.id, 0);
    assert.deepEqual(v0.layout, MISSIONS.find((m) => m.id === t.mission).layout, t.id);
    assert.deepEqual(variant(t.id, 2), variant(t.id, 2));
    assert.match(v0.prompt, /Task \(mission \d\d,/);
  }
  assert.notDeepEqual(variant('m01-bowl', 1).layout, variant('m01-bowl', 0).layout);
  assert.deepEqual(variant('b02-square', 0).params, { cx_mm: 250, cy_mm: 0, z_mm: 100, side_mm: 100, yaw_deg: 0 });
  assert.deepEqual(resolveTasks('public').length, 12);
  assert.throws(() => resolveTasks('m99-nope'));
});

test('hidden set: needs the secret, differs from public, never carries the secret', () => {
  assert.throws(() => variant('m01-bowl', 0, 'hidden', {}), /BENCH_HIDDEN_SECRET/);
  const secret = 'test-only-secret-0123456789abcdef';
  const h = variant('m01-bowl', 0, 'hidden', { BENCH_HIDDEN_SECRET: secret });
  assert.notDeepEqual(h.layout, variant('m01-bowl', 0).layout);
  assert.deepEqual(h, variant('m01-bowl', 0, 'hidden', { BENCH_HIDDEN_SECRET: secret }));
  assert.notDeepEqual(h.layout, variant('m01-bowl', 0, 'hidden', { BENCH_HIDDEN_SECRET: secret + 'x' }).layout);
  assert.ok(!JSON.stringify(h).includes(secret));
  assert.match(h.variant_tag, /^[0-9a-f]{12}$/);
});

test('jittered layouts stay reachable, on the table and apart', () => {
  for (const id of ['bowl', 'sort', 'line', 'tidy']) {
    const mis = MISSIONS.find((m) => m.id === id);
    for (let s = 0; s < 20; s++) {
      const L = jitterLayout(mis, rng('t' + id + s), { pos: 0.035, yaw: 180 });
      for (const [x, y] of Object.values(L)) { assert.ok(Math.hypot(x, y) <= 0.345 && x >= 0.1 && Math.abs(y) <= 0.23, id + JSON.stringify(L)); }
    }
  }
});

// ---------- graders ----------
const fr = (q3, z = 0.3, q4 = 0) => ({ q: [0, 0, 0, q3 * Math.PI / 180, q4 * Math.PI / 180, 0], tip: [0.25, 0, z] });
function waveFrames(n, { amp = 35, raised = true } = {}) {
  const f = [];
  for (let i = 0; i <= 30; i++) f.push(fr(70 - 70 * i / 30, raised ? 0.15 + 0.15 * i / 30 : 0.1));   // raise
  for (let k = 0; k < n; k++) for (const a of [amp, -amp]) for (let i = 0; i < 15; i++) f.push(fr(a * Math.sin(Math.PI / 2 * i / 15), raised ? 0.3 : 0.1));
  for (let i = 0; i < 10; i++) f.push(fr(0, raised ? 0.3 : 0.1));
  return f;
}
test('wave grader: counts raised wrist swings, ignores small wiggles and lowered arms', () => {
  assert.equal(countSwings([0, 30, -30, 30, -30].map((v) => ({ v, up: true }))), 4);
  assert.equal(countSwings([0, 10, -5, 10, 0].map((v) => ({ v, up: true }))), 0);
  const ok = gradeWave(waveFrames(3), { waves: 3 });
  assert.equal(ok.success, true, JSON.stringify(ok));
  assert.equal(gradeWave(waveFrames(1), { waves: 3 }).success, false);
  assert.equal(gradeWave(waveFrames(3, { amp: 8 }), { waves: 3 }).details.swings, 0);
  assert.equal(gradeWave(waveFrames(3, { raised: false }), { waves: 3 }).details.swings, 0);
});

test('square grader: a traced outline passes, a circle or a wrong plane fails', () => {
  const p = { cx_mm: 250, cy_mm: 20, z_mm: 100, side_mm: 100, yaw_deg: 30 };
  const C = squareCorners(p), f = [];
  for (let k = 0; k < 4; k++) for (let i = 0; i < 40; i++) {
    const t = i / 40; f.push({ q: [0, 0, 0, 0, 0, 0], tip: [C[k][0] + (C[k + 1][0] - C[k][0]) * t, C[k][1] + (C[k + 1][1] - C[k][1]) * t, 0.1] });
  }
  const g = gradeSquare(f, p);
  assert.equal(g.success, true, JSON.stringify(g));
  const circle = Array.from({ length: 160 }, (_, i) => ({ q: [0, 0, 0, 0, 0, 0], tip: [0.25 + 0.05 * Math.cos(i / 25), 0.02 + 0.05 * Math.sin(i / 25), 0.1] }));
  assert.equal(gradeSquare(circle, p).success, false);
  assert.equal(gradeSquare(f.map((x) => ({ ...x, tip: [x.tip[0], x.tip[1], 0.2] })), p).progress, 0);
});

// ---------- score ----------
test('score formula: success, partial progress, safety penalty, equal task weights', () => {
  assert.equal(episodePoints({ success: true, progress: 1, safety_violations: 0 }), 100);
  assert.equal(episodePoints({ success: false, progress: 0.5, safety_violations: 0 }), 7.5);
  assert.equal(episodePoints({ success: true, progress: 1, safety_violations: 2 }), 90);
  assert.equal(episodePoints({ success: false, progress: 0, safety_violations: 9 }), 0);
  const ep = (task, success) => ({ model: 'a', task, success, progress: success ? 1 : 0, safety_violations: 0, steps: 3, sim_s: 1, wall_s: 1, tokens: { prompt: 10, completion: 2 }, cost_usd: 0.01 });
  const a = aggregate('a', [ep('t1', true), ep('t1', false), ep('t2', true)], ['t1', 't2', 't3']);
  assert.equal(a.score, Math.round((50 + 100 + 0) / 3 * 10) / 10);
  assert.equal(a.success_rate, 0.6667);
  assert.equal(a.per_task.t3.n, 0);
});

// ---------- OpenRouter client (fake fetch, fake key) ----------
const FAKE_KEY = 'sk-or-v1-FAKEKEYFORTESTSONLY000000000000';
test('client: key only in the Authorization header, fixed settings, cost from usage, errors without secrets', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    return { ok: true, status: 200, json: async () => ({ model: 'x/y-2026-01-01', choices: [{ message: { role: 'assistant', content: null, tool_calls: [] }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0012 } }) };
  };
  const c = openRouterClient({ env: { OPENROUTER_API_KEY: FAKE_KEY }, fetchImpl });
  const r = await c.chat({ model: 'x/y', messages: [{ role: 'user', content: 'hi' }], tools: [], temperature: 0, max_tokens: 50, seed: 1 });
  assert.equal(r.usage.cost_usd, 0.0012); assert.equal(r.usage.cost_source, 'openrouter'); assert.equal(r.served_model, 'x/y-2026-01-01');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(body.stream, false); assert.equal(body.temperature, 0); assert.equal(body.seed, 1); assert.deepEqual(body.usage, { include: true });
  assert.ok(!seen[0].init.body.includes(FAKE_KEY));
  assert.equal(seen[0].init.headers.Authorization, 'Bearer ' + FAKE_KEY);
  const bad = openRouterClient({ env: { OPENROUTER_API_KEY: FAKE_KEY }, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: FAKE_KEY }) }) });
  await assert.rejects(bad.chat({ model: 'x', messages: [], tools: [] }), (e) => e instanceof ClientError && e.kind === 'auth' && !e.message.includes(FAKE_KEY));
  assert.throws(() => openRouterClient({ env: {} }), ClientError);
  assert.throws(() => openRouterClient({ env: { OPENROUTER_API_KEY: FAKE_KEY, OPENROUTER_BASE_URL: 'http://evil.example/v1' } }), ClientError);
});

// ---------- runner guards ----------
test('runner: refuses without --max-usd, with a bad cap, real models in CI or without a key', async () => {
  assert.throws(() => parseArgs(['--models', 'mock/idle']), /--max-usd/);
  assert.throws(() => parseArgs(['--models', 'mock/idle', '--max-usd', '0']), /--max-usd/);
  assert.throws(() => parseArgs(['--models', 'mock/idle', '--max-usd', 'lots']), /--max-usd/);
  assert.equal(parseArgs(['--models', 'a/b,c/d', '--max-usd', '5']).seeds, 3);
  const lines = [];
  assert.equal(await main(['--models', 'mock/idle'], { env: {}, log: (s) => lines.push(s) }), 2);
  assert.equal(await main(['--models', 'openai/gpt-x', '--max-usd', '1'], { env: { CI: 'true', OPENROUTER_API_KEY: FAKE_KEY }, log: (s) => lines.push(s) }), 2);
  assert.equal(await main(['--models', 'openai/gpt-x', '--max-usd', '1'], { env: {}, log: (s) => lines.push(s) }), 2);
  assert.equal(await main(['--models', 'mock/idle', '--tasks', 'hidden', '--max-usd', '1'], { env: {}, log: (s) => lines.push(s) }), 2);
  assert.ok(lines.every((l) => l.startsWith('bench: ') || l.startsWith('usage: ')));
  assert.ok(!lines.join('\n').includes(FAKE_KEY));
});

test('ledger: stops before a call that would cross the cap', () => {
  const l = createLedger(1);
  assert.ok(l.canSpend()); l.add(0.2); assert.ok(l.canSpend()); l.add(0.4); assert.ok(!l.canSpend()); assert.equal(Math.round(l.spent * 10), 6);
});
