// Line model of mission 13 (src/line/des.js) from the committed policy profiles, for review. No MuJoCo: the DES
// reads only profiles/<policy>-<cm/s>.json.
//
//   node sim/so101/tools/line.mjs run   --v 0.02 --lambda 12 --cells paper+plastic,glass+metal [--seeds 20]
//                                       [--arrivals poisson|uniform] [--jitter 0] [--mix paper:2,plastic:3,glass:3,metal:3]
//                                       [--policy skript] [--minutes 30] [--json]
//       one configuration over seeds 1 … n: sorted/min, purity, refused/min, missed by class, utilisation per cell
//       (mean and 5–95 % across seeds). Cells sit in slots 0, 1, … (0.25 m, 0.75 m, …) in the order given.
//   node sim/so101/tools/line.mjs nmin  --v 0.02 --lambda 15 --F 12 [--X 0.95] [--mix …] [--max-n 8] [--budget N]
//       the N_min search for one order (exhaustive over fraction sets and their order along the belt)
//   node sim/so101/tools/line.mjs table [--F 6,12,18] [--lambdas …] [--X 0.95] [--arrivals poisson|uniform] [--cap-n 2] [--budget N]
//       N_min for every measured speed × inflow × target (markdown), and the best mean output of any 1 … cap-n
//       cells; the default inflows are 6, 9, 12, 15 items/min and, at 4 and 6 cm/s, also 20, 30 and the belt maximum
//   node sim/so101/tools/line.mjs m11   [--seeds 200]
//       one cell with all four fractions on the mission 11 belt (0.53 m from the spawn point to the tote edge, the
//       cell 0.26 m downstream of it), 11 items one every 10 s at 2 cm/s in the batch mix: sorted of 11 per seed, to
//       set beside the measured beltSolve batches (tools/belt-measure.mjs batch).
//
// The default mix is the mission 11 batch (2 paper, 3 plastic, 3 glass, 3 metal of 11): the composition of an
// order is a game parameter ("složení zakázky"), not a statistic of real waste.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLine, searchNmin, bestOf, lambdaMax, slotX, LINE, CLASSES, seedsOf, cellModel, simulate, summarize } from '../src/line/des.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BATCH_MIX = { paper: 2, plastic: 3, glass: 3, metal: 3 };
export function loadProfiles(policy = 'skript') {
  const out = {};
  for (const v of LINE.speeds) {
    const f = path.join(DIR, 'profiles', `${policy}-${Math.round(v * 100)}.json`);
    if (fs.existsSync(f)) out[v] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  return out;
}
const parseMix = (s) => (s ? Object.fromEntries(s.split(',').map((kv) => { const [k, w] = kv.split(':'); return [k, +w]; })) : BATCH_MIX);
const f1 = (x) => (x == null ? '–' : x.toFixed(1));
const pc = (x) => (x == null ? '–' : (100 * x).toFixed(1) + ' %');
const band = (s, f = f1) => `${f(s.mean)} (${f(s.p5)}–${f(s.p95)})`;

/** The mission 11 cell in the line model (see the header). */
export function m11Config() {
  // world.js spawn: y = BELT.y0 + BELT.entry / 2 = −0.26; the belt edge (items fall to the tote) BELT.edge = 0.27
  return { v: 0.02, lambda: 6, arrivals: 'uniform', jitter: 0, mix: BATCH_MIX, length: 0.53, count: 11,
    cells: [{ x: 0.26, fractions: CLASSES.slice(), policy: 'skript' }] };
}

function main(args) {
  const mode = args[0];
  const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
  const policy = opt('policy', 'skript'), all = loadProfiles(policy), mix = parseMix(opt('mix'));
  const seeds = seedsOf(+opt('seeds', LINE.seeds));
  if (mode === 'run') {
    const v = +opt('v', 0.02), lambda = +opt('lambda', 12);
    if (!all[v]) throw new Error(`no ${policy} profile at ${v} m/s`);
    const cells = String(opt('cells', '')).split(',').filter(Boolean).map((s, i) => ({ x: slotX(i), fractions: s.split('+'), policy }));
    const config = { v, lambda, mix, arrivals: opt('arrivals', 'poisson'), jitter: +opt('jitter', 0), horizon: 60 * +opt('minutes', 30), cells };
    const t0 = process.hrtime.bigint(), r = runLine(config, { [policy]: all[v] }, { seeds }), ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (args.includes('--json')) { console.log(JSON.stringify(r.summary, null, 1)); return; }
    const s = r.summary;
    console.log(`v ${v * 100} cm/s · λ ${lambda}/min (belt max ${f1(lambdaMax(v))}/min) · ${config.arrivals} · ${cells.length} cells · ${seeds.length} seeds × ${config.horizon / 60} min in ${ms.toFixed(0)} ms`);
    console.log(`profile: ${policy}, measured ${all[v].measured_at} (${all[v].source}), n = ${all[v].n}, cell ${all[v].version}`);
    console.log(`sorted/min   ${band(s.sorted)}   (p10 ${f1(s.sorted.p10)})`);
    console.log(`purity       ${band(s.purity, pc)}`);
    console.log(`accepted/min ${band(s.accepted)} · refused/min ${band(s.refused)} · missed/min ${band(s.missed)} · lost/min ${band(s.lost)}`);
    console.log('not sorted/min by class: ' + CLASSES.map((c) => `${c} ${f1(s.missedByClass[c].mean)}`).join(' · '));
    console.log('recovery by class: ' + CLASSES.map((c) => `${c} ${pc(s.recovery[c].mean)}`).join(' · '));
    s.cells.forEach((c, i) => console.log(`cell ${i + 1} @ ${cells[i].x} m [${cells[i].fractions.join('+')}]: utilisation ${band(c.utilisation, pc)}, sorted ${f1(c.sorted.mean)} in ${config.horizon / 60} min`));
  } else if (mode === 'nmin') {
    const order = { F: +opt('F', 12), X: +opt('X', 0.95), mix, v: +opt('v', 0.02), lambda: +opt('lambda', 15), arrivals: opt('arrivals', 'poisson'), policy };
    const t0 = Date.now(), r = searchNmin(order, { [policy]: all }, { seeds, maxN: +opt('max-n', LINE.maxCells), budget: +opt('budget', 2e4) });
    console.log(`order F ${order.F}/min, X ${pc(order.X)}, v ${order.v * 100} cm/s, λ ${order.lambda}/min: N_min = ${r.n == null ? 'none (' + r.reason + (r.reason === 'inflow' ? `: the belt brings ${f1(r.reach)}/min` : '') + ')' : r.n} (${r.evaluated} configurations run, ${r.skipped} skipped by the bound, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    for (const p of r.perN) console.log(`  N ${p.n}: ${p.evaluated} run to the end or dropped, ${p.passing} pass`);
    if (r.best) console.log(`  best: ${r.best.config.cells.map((c) => c.fractions.join('+')).join(' | ')} → ${band(r.best.summary.sorted)}/min, purity ${pc(r.best.summary.purity.mean)}, reliable ${r.best.reliable}`);
  } else if (mode === 'table') {
    const Fs = String(opt('F', '6,12,18')).split(',').map(Number), X = +opt('X', 0.95);
    const capN = +opt('cap-n', 2), name = (cfg) => cfg.cells.map((c) => c.fractions.map((f) => f.slice(0, 2)).join('+')).join(' · ');
    const rows = [`| v | λ (items/min) | accepted/min | best mean sorted/min, N = 1 … ${capN} | ` + Fs.map((F) => `N_min, F = ${F}`).join(' | ') + ' |', '|---|---|---|---|' + Fs.map(() => '---|').join('')];
    for (const v of LINE.speeds) {
      if (!all[v]) continue;
      const lmax = lambdaMax(v), lams = opt('lambdas') ? String(opt('lambdas')).split(',').map(Number) : [6, 9, 12, 15, ...(v > 0.02 ? [20, 30, lmax] : [])];
      for (const lambda of [...new Set(lams)].filter((l) => l <= lmax + 1e-9)) {
        const order = { X, mix, v, lambda, policy, arrivals: opt('arrivals', 'poisson') }, prof = { [policy]: all };
        const caps = []; let acc = null;
        for (let n = 1; n <= capN; n++) { const b = bestOf(order, prof, n, { seeds }); caps.push(`${f1(b.summary.sorted.mean)} (${name(b.config)})`); acc = b.summary.accepted.mean; }
        const cells = Fs.map((F) => {
          const r = searchNmin(Object.assign({ F }, order), prof, { seeds, budget: +opt('budget', 2e4) });
          return r.n == null ? (r.reason === 'inflow' ? `– (belt brings ${f1(r.reach)}/min)` : r.reason === 'budget' ? '? (budget)' : '> 8') : `**${r.n}** (${name(r.best.config)}: ${f1(r.best.summary.sorted.mean)}${r.best.reliable ? ', p10 ✓' : ''}; ${r.passing} pass)`;
        });
        rows.push(`| ${v * 100} cm/s | ${f1(lambda)} | ${f1(acc)} | ${caps.join('<br>')} | ${cells.join(' | ')} |`);
        console.error(`  ${v * 100} cm/s λ ${lambda} done`);
      }
    }
    console.log(rows.join('\n'));
  } else if (mode === 'm11') {
    const cfg = m11Config(), model = cellModel(all[0.02]);
    const runs = seeds.map((s) => simulate(cfg, { skript: model }, s)), s = summarize(runs);
    const hist = {};
    for (const r of runs) hist[r.totals.sorted] = (hist[r.totals.sorted] || 0) + 1;
    console.log(`DES, 1 cell (all 4 fractions), mission 11 belt, 11 items every 10 s at 2 cm/s, ${seeds.length} seeds:`);
    console.log(`  sorted of 11: mean ${s.sorted.mean.toFixed(2)} (5–95 %: ${s.sorted.p5}–${s.sorted.p95}); per seed ${Object.entries(hist).sort((a, b) => b[0] - a[0]).map(([k, n]) => `${k}: ${n}×`).join(', ')}`);
    console.log(`  missed ${s.missed.mean.toFixed(2)} · lost ${s.lost.mean.toFixed(2)} · contaminated ${s.contaminated.mean.toFixed(2)} · purity ${pc(s.purity.mean)}`);
    console.log('  recovery by class: ' + CLASSES.map((c) => `${c} ${pc(s.recovery[c].mean)}`).join(' · '));
  } else {
    console.error('usage: line.mjs run|nmin|table|m11 [options] (see the header)');
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
