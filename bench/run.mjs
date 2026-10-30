#!/usr/bin/env node
// PR-Bench runner (CONTROL track). Methodology: bench/SPEC.md.
//   node bench/run.mjs --models a,b --tasks public --seeds 3 --max-usd 5 [--vision auto|off] [--out DIR] [--sample]
//   node bench/run.mjs --models mock/solve-bowl,mock/fail --tasks m01-bowl --seeds 1 --max-usd 0.1   (no network)
// Real models go through OpenRouter: key from env OPENROUTER_API_KEY only (never printed, never written).
// Refuses without an explicit --max-usd; stops before the next model call once the cap is reached.
// Hidden set: --tasks hidden needs env BENCH_HIDDEN_SECRET (VPS only); its logs stay in the output dir (gitignored).
// Prints fixed status lines only. Writes <out>/results.json, <out>/summary.md, <out>/episodes/*.json, <out>/replays/*.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { variant, resolveTasks } from './control/tasks.mjs';
import { runEpisode, BUDGET, TEMPERATURE } from './control/agent.mjs';
import { openRouterClient, ClientError } from './control/client.mjs';
import { mockClient } from './control/mock.mjs';
import { toReplay } from './control/replay.mjs';
import { aggregate, summaryMarkdown, SCORE_VERSION } from './control/score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = 'usage: node bench/run.mjs --models a,b --tasks public|hidden|id,id --seeds 3 --max-usd 5 [--vision auto|off] [--out DIR] [--sample]';

export function parseArgs(argv) {
  const o = { seeds: 3, tasks: 'public', vision: 'auto', sample: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { const v = argv[++i]; if (v == null || v.startsWith('--')) throw new Error('missing value for ' + a); return v; };
    if (a === '--models') o.models = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--tasks') o.tasks = next();
    else if (a === '--seeds') o.seeds = Number(next());
    else if (a === '--max-usd') o.maxUsd = Number(next());
    else if (a === '--vision') o.vision = next();
    else if (a === '--out') o.out = next();
    else if (a === '--sample') o.sample = true;
    else throw new Error('unknown argument ' + a.slice(0, 40));
  }
  if (!o.models || !o.models.length) throw new Error('--models is required');
  for (const m of o.models) if (!/^[A-Za-z0-9._:/@-]{1,120}$/.test(m)) throw new Error('bad model id');
  if (o.maxUsd == null || !Number.isFinite(o.maxUsd) || o.maxUsd <= 0) throw new Error('--max-usd is required (a positive number of US dollars)');
  if (!Number.isInteger(o.seeds) || o.seeds < 1 || o.seeds > 20) throw new Error('--seeds must be 1..20');
  if (!['auto', 'off'].includes(o.vision)) throw new Error('--vision must be auto or off');
  o.set = o.tasks === 'hidden' ? 'hidden' : 'public';
  o.taskIds = resolveTasks(o.tasks);
  return o;
}

export function createLedger(cap) {
  let spent = 0, last = 0;
  return {
    get spent() { return spent; }, cap,
    /** Stop before a call that would likely cross the cap: spent + 1.5 × the last call's cost. */
    canSpend: () => spent + 1.5 * last < cap,
    add(usd) { spent += usd; last = usd; }
  };
}

const safeName = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);

export async function main(argv, { env = process.env, log = (s) => console.log(s), clientFor } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { log('bench: refused: ' + e.message); log(USAGE); return 2; }
  if (o.set === 'hidden' && !env.BENCH_HIDDEN_SECRET) { log('bench: refused: hidden set needs BENCH_HIDDEN_SECRET (VPS only)'); return 2; }
  const real = o.models.filter((m) => !m.startsWith('mock/'));
  if (real.length && env.CI) { log('bench: refused: real models never run in CI'); return 2; }
  if (real.length && !env.OPENROUTER_API_KEY) { log('bench: refused: OPENROUTER_API_KEY is not set'); return 2; }
  const date = new Date().toISOString();
  const runId = date.slice(0, 19).replace(/[:T]/g, '-') + '-' + o.set;
  const out = path.resolve(o.out || path.join(HERE, 'runs', runId));
  fs.mkdirSync(path.join(out, 'episodes'), { recursive: true });
  fs.mkdirSync(path.join(out, 'replays'), { recursive: true });
  const ledger = createLedger(o.maxUsd);
  const make = clientFor || ((m) => (m.startsWith('mock/') ? mockClient(m) : openRouterClient({ env })));
  log(`bench: run ${runId} models=${o.models.length} tasks=${o.taskIds.length} seeds=${o.seeds} set=${o.set} max_usd=${o.maxUsd}`);

  const episodes = [];
  let stopped = null;
  outer: for (const model of o.models) {
    let probe;
    try { probe = make(model); } catch (e) { log(`bench: model ${model}: client error (${e instanceof ClientError ? e.kind : 'setup'})`); continue; }
    const info = await probe.modelInfo(model).catch(() => null);
    const vision = o.vision === 'auto' && !!(info && info.vision);
    for (const taskId of o.taskIds) {
      for (let seed = 0; seed < o.seeds; seed++) {
        if (!ledger.canSpend()) { stopped = 'max_usd'; break outer; }
        const v = variant(taskId, seed, o.set, env);
        const client = make(model);          // fresh client (mock policy state) per episode
        const { result, log: elog, ep } = await runEpisode({ client, model, variant: v, vision, ledger, seed });
        episodes.push(result);
        const base = `${safeName(model)}__${taskId}__s${seed}`;
        fs.writeFileSync(path.join(out, 'episodes', base + '.json'), JSON.stringify(elog, null, 1));
        fs.writeFileSync(path.join(out, 'replays', base + '.json'), JSON.stringify(toReplay(ep, { taskId, seed, model, missionId: v.mission || null, title: taskId })));
        log(`bench: ${model} ${taskId} s${seed} success=${result.success ? 1 : 0} progress=${result.progress} steps=${result.steps} sim_s=${result.sim_s} usd=${result.cost_usd.toFixed(4)} end=${result.end}`);
        if (result.end === 'max_usd') { stopped = 'max_usd'; break outer; }
        if (result.end === 'model_error' && result.steps === 0 && /auth|config/.test(result.summary || '')) { log(`bench: ${model}: stopping this model (${result.summary})`); continue outer; }
      }
    }
  }
  const res = {
    schema: 'prbench-results@1', bench_version: 'v0', track: 'control', score_version: SCORE_VERSION,
    run_id: runId, date, set: o.set, tasks: o.taskIds, seeds: o.seeds,
    settings: { temperature: TEMPERATURE, budget: BUDGET, vision: o.vision },
    mock: o.models.every((m) => m.startsWith('mock/')),
    max_usd: o.maxUsd, spent_usd: Math.round(ledger.spent * 1e4) / 1e4, stopped,
    models: o.models.map((m) => aggregate(m, episodes, o.taskIds)),
    episodes: o.set === 'hidden' ? episodes.map(({ summary, ...e }) => e) : episodes
  };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(res, null, 1));
  fs.writeFileSync(path.join(out, 'summary.md'), summaryMarkdown(res));
  if (o.sample) {
    const { episodes: _drop, ...lean } = res;
    fs.writeFileSync(path.join(HERE, 'results', 'sample.json'), JSON.stringify({ ...lean, run_id: 'sample-mock', date: lean.date.slice(0, 10) }, null, 1) + '\n');
  }
  log(`bench: done episodes=${episodes.length} spent_usd=${res.spent_usd}${stopped ? ' stopped=' + stopped : ''}`);
  log(`bench: wrote ${path.relative(process.cwd(), out) || '.'}/results.json and summary.md`);
  return stopped ? 3 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), () => { console.log('bench: failed (internal error)'); process.exit(1); });
}
