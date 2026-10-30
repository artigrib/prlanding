// PR-Bench end to end with mock models (no network, no keys): the runner drives the headless sim through the agent
// loop; graders, metrics, the $ cap, episode logs and replay files are checked. Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../run.mjs';
import { openRouterClient } from '../control/client.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prbench-'));
const read = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
const quiet = { env: { CI: 'true' }, log: () => {} };

test('mock/solve-bowl solves M01, mock/fail fails with a safety violation; metrics and files', async () => {
  const out = tmp();
  const code = await main(['--models', 'mock/solve-bowl,mock/fail', '--tasks', 'm01-bowl', '--seeds', '1', '--max-usd', '1', '--out', out], quiet);
  assert.equal(code, 0);
  const res = read(out, 'results.json');
  assert.equal(res.schema, 'prbench-results@1'); assert.equal(res.mock, true); assert.equal(res.stopped, null);
  const [win, lose] = res.episodes;
  assert.equal(win.success, true); assert.equal(win.end, 'task_complete'); assert.equal(win.safety_violations, 0);
  assert.ok(win.steps >= 10 && win.sim_s > 5 && win.tokens.prompt > 0 && win.cost_usd > 0, JSON.stringify(win));
  assert.equal(lose.success, false); assert.equal(lose.safety_violations, 1); assert.equal(lose.errors, 1);
  const [a, b] = res.models;
  assert.equal(a.score, 100); assert.equal(a.success_rate, 1);
  assert.equal(b.score, 0);
  assert.ok(fs.readFileSync(path.join(out, 'summary.md'), 'utf8').includes('| 1 | `mock/solve-bowl` | 100 |'));
  // episode log: messages + calls, the system prompt and the tool schema list are recorded
  const log = read(out, 'episodes/mock_solve-bowl__m01-bowl__s0.json');
  assert.equal(log.schema, 'prbench-episode@1');
  assert.equal(log.messages[0].role, 'system'); assert.equal(log.messages[1].role, 'user');
  assert.ok(log.calls.some((c) => c.name === 'set_gripper'));
  assert.ok(!log.settings.tools.includes('snapshot'), 'text-only mock gets no snapshot');
  // replay: the sim's demo format (teach.js importJSON), 30 fps, snapshot of the start scene
  const rp = read(out, 'replays/mock_solve-bowl__m01-bowl__s0.json');
  assert.equal(rp.format, 'printedrobotics.cz/so101-sim-demo@1'); assert.equal(rp.fps, 30); assert.equal(rp.printedrobotics.mission, 'bowl');
  const fr = rp.episodes[0].frames;
  assert.ok(fr.length > 5 * 30 && fr.length === rp.printedrobotics.bench.tip_mm.length);
  assert.equal(fr[0]['observation.state'].length, 6);
  for (let i = 1; i < fr.length; i++) assert.ok(fr[i].timestamp >= fr[i - 1].timestamp);
  assert.ok(Array.isArray(rp.printedrobotics.snapshot.qpos) && rp.printedrobotics.snapshot.mpos.length > 0);
});

test('deterministic: the same run gives the same results (except wall time)', async () => {
  const strip = (r) => r.episodes.map(({ wall_s, ...e }) => e);
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const out = tmp();
    await main(['--models', 'mock/wave,mock/square', '--tasks', 'b01-wave,b02-square', '--seeds', '2', '--max-usd', '1', '--out', out], quiet);
    runs.push(read(out, 'results.json'));
  }
  assert.deepEqual(strip(runs[0]), strip(runs[1]));
  const ep = runs[0].episodes;
  assert.equal(ep.find((e) => e.model === 'mock/wave' && e.task === 'b01-wave').success, true);
  assert.equal(ep.find((e) => e.model === 'mock/square' && e.task === 'b02-square').success, true);
  assert.equal(ep.find((e) => e.model === 'mock/wave' && e.task === 'b02-square').success, false);
});

test('the $ cap stops the run before the next model call', async () => {
  const out = tmp(), lines = [];
  const code = await main(['--models', 'mock/solve-bowl', '--tasks', 'm01-bowl', '--seeds', '3', '--max-usd', '0.02', '--out', out], { env: { CI: 'true' }, log: (s) => lines.push(s) });
  assert.equal(code, 3);
  const res = read(out, 'results.json');
  assert.equal(res.stopped, 'max_usd');
  assert.ok(res.spent_usd < 0.02 * 1.6, 'spent ' + res.spent_usd);
  assert.equal(res.episodes.length, 1); assert.equal(res.episodes[0].end, 'max_usd');
  assert.ok(lines.some((l) => /stopped=max_usd/.test(l)));
});

test('real-model path (fake OpenRouter): the key never reaches stdout, logs, results or replays', async () => {
  const KEY = 'sk-or-v1-FAKEKEYFORTESTSONLY111111111111';
  let n = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'acme/robot-1', pricing: { prompt: '0.000001', completion: '0.000002' }, architecture: { input_modalities: ['text'] } }] }) };
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'acme/robot-1'); assert.equal(body.temperature, 0); assert.ok(body.tools.length >= 10);
    n++;
    const call = n === 1 ? { name: 'get_state', arguments: '{}' } : n === 2 ? { name: 'move_joints', arguments: '{"joints_deg":{"shoulder_pan":200}}' } : { name: 'task_complete', arguments: '{"summary":"done"}' };
    return { ok: true, status: 200, json: async () => ({ model: 'acme/robot-1', choices: [{ message: { role: 'assistant', content: 'ok', tool_calls: [{ id: 'c' + n, type: 'function', function: call }] } }], usage: { prompt_tokens: 1000, completion_tokens: 50 } }) };
  };
  const out = tmp(), lines = [];
  const env = { OPENROUTER_API_KEY: KEY };
  const code = await main(['--models', 'acme/robot-1', '--tasks', 'm02-stack', '--seeds', '1', '--max-usd', '1', '--out', out],
    { env, log: (s) => lines.push(s), clientFor: () => openRouterClient({ env, fetchImpl }) });
  assert.equal(code, 0);
  const res = read(out, 'results.json');
  const e = res.episodes[0];
  assert.equal(e.steps, 3); assert.equal(e.safety_violations, 1); assert.deepEqual(e.cost_sources, ['estimate']);
  assert.equal(e.cost_usd, 3 * (1000 * 1 + 50 * 2) / 1e6);
  const all = lines.join('\n') + fs.readdirSync(out, { recursive: true }).filter((f) => f.endsWith('.json') || f.endsWith('.md'))
    .map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
  assert.ok(!all.includes(KEY) && !all.includes('FAKEKEY'), 'key leaked');
});
