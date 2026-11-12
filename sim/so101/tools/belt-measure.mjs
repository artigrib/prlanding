// Measurement harness for the conveyor cell (waste sorting): tracking pick + place success of the scripted planner
// (src/objects/beltpick.js) in MuJoCo, in node, with the real batch objects. Nothing here runs in the page.
//
//   node sim/so101/tools/belt-measure.mjs pick  [--speeds 0.02,0.04,0.06] [--n 10] [--seed 1] [--out file.json]
//       every batch kind × speed × target grasp y (−0.20 … 0.20): one item on the belt, beltPick when its predicted
//       grasp point reaches the target y, then libPlace into the bin of its fraction. Success is binned by the
//       item's measured y when the jaws close.
//   node sim/so101/tools/belt-measure.mjs bins  [--n 6] [--speed 0.02]
//       every batch kind into each of the 4 bins (near (0.12, ±0.17), far (0.38, ±0.14)), picked around y = 0.
//   node sim/so101/tools/belt-measure.mjs batch [--n 10] [--speed 0.02] [--every 10]
//       beltSolve on the 11-item batch, seeded order and yaws, one item every `every` s (mission 11 rules).
//   node sim/so101/tools/belt-measure.mjs mission [--n 10] [--seed 1] [--hz 60]
//       mission 11 ("Ukázat řešení") as the page runs it: MissionRunner + its check every frame, the controller once
//       per frame at `hz`, physics by the page's accumulator; seeds seed … seed + n − 1.
//   node sim/so101/tools/belt-measure.mjs teach [--demos 4,6,11] [--n 10] [--seed 2] [--hz 60] [--wrong glass:bin_plastic]
//       mission 12: the scripted planner sorts the first `demos` items of the demo batch (WASTE.seed) while a
//       30 fps recorder takes the env frames (as src/ui/teach.js); the episodes are cut, the kNN rule is trained
//       (src/policy/knn.js) and runs the verification batch (seeds seed … seed + n − 1; the mission's is TEACH.seed)
//       through MissionRunner. Also the Skript (beltSolve) on the same batches. --wrong: the demos put that fraction
//       into that bin (a wrong demonstration).
//
// Trial outcome: held (lifted off the belt after the close), placed (at rest inside the target bin), tipped (an
// upright item lying before the grasp), slat (control ticks with a gripper–slat contact during
// the pick: the jaws pressing into the moving belt). Output: a table on stdout
// and, with --out, the raw trials as JSON.

import fs from 'node:fs';
import { loadObjectScene } from '../tests/mj-node.mjs';
import { World } from '../src/world.js';
import { ArmController } from '../src/controller.js';
import { inZone, MissionRunner } from '../src/missions.js';
import { beltPick, beltSolve, heldBy, binDrop, fractionOf, BELT_PICK } from '../src/objects/beltpick.js';
import { libPlace } from '../src/missions.js';
import { CONVEYOR_ITEMS, CONVEYOR_BINS, FRACTION_BIN } from '../src/objects/scene.js';
import { WasteRun, WASTE, rng, yawFor, batchOrder } from '../src/objects/wastebatch.js';
import { TEACH } from '../src/missions.js';
import { envOf, cutEpisodes, cutFrames } from '../src/policy/episodes.js';
import { examplesFromDemo, train, report, coverage } from '../src/policy/knn.js';
import { knnSolve } from '../src/policy/run.js';

const args = process.argv.slice(2), mode = args[0] || 'pick';
const opt = (k, dflt) => { const i = args.indexOf('--' + k); return i < 0 ? dflt : args[i + 1]; };
const N = +opt('n', mode === 'bins' ? 6 : 10), SEED = +opt('seed', mode === 'teach' ? 2 : 1), OUT = opt('out', null);
const SPEEDS = String(opt('speeds', opt('speed', mode === 'pick' ? '0.02,0.04,0.06' : '0.02'))).split(',').map(Number);
const ONLY = opt('only', null), FLOOR = opt('floor', null);

export async function cell() {
  const { mj, m, d, sizes } = await loadObjectScene('conveyor');
  const w = new World(mj, m, d); w.sizes(sizes);
  const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'].map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
  const ctl = new ArmController(mj, m, d, act);
  const ts = m.opt.timestep, belt = w.belt;
  // gripper collision geoms (bodies under "gripper") touching a slat: the squeeze check
  const O = mj.mjtObj, gb = mj.mj_name2id(m, O.mjOBJ_BODY.value, 'gripper');
  const under = (b) => { for (; b > 0; b = m.body_parentid[b]) if (b === gb) return true; return false; };
  const grip = new Set(), slat = new Set(belt.slats.map((s) => s.geom));
  for (let g = 0; g < m.ngeom; g++) if (under(m.geom_bodyid[g])) grip.add(g);
  let touch = 0, zmin = Infinity;
  const site = mj.mj_name2id(m, O.mjOBJ_SITE.value, 'gripperframe');
  const squeeze = () => {
    zmin = Math.min(zmin, d.site_xpos[3 * site + 2]);
    if (!d.ncon) return;
    const cv = d.contact;   // embind copies: free both, or the wasm heap fills up
    for (let k = 0, n = d.ncon; k < n; k++) {
      const c = cv.get(k), g1 = c.geom1, g2 = c.geom2, dist = c.dist; c.delete();
      if (dist < 0 && ((slat.has(g1) && grip.has(g2)) || (slat.has(g2) && grip.has(g1)))) { touch++; break; }
    }
    cv.delete();
  };
  let tick = 0;   // the controller runs every 4th physics step (16 ms, a page frame), counted across calls
  const step = (sec, every) => {
    const n = Math.round(sec / ts);
    for (let i = 0; i < n; i++) {
      if (tick++ % 4 === 0) { ctl.update(ts * 4); squeeze(); }
      belt.step(ts); mj.mj_step(m, d);
      if (every && i % 25 === 0 && every()) return;
    }
  };
  const reset = (speed) => {
    mj.mj_resetDataKeyframe(m, d, 0);
    w.layout(Object.fromEntries(Object.entries(CONVEYOR_BINS).map(([n, p]) => [n, [p[0], p[1], 0]])));
    ctl.cancel(); ctl.syncFromCtrl();
    belt.speed = speed; belt.wraps = 0;
    mj.mj_forward(m, d);
    step(1.0);   // belt up to speed
  };
  return { mj, m, d, w, ctl, belt, ts, step, reset, touch: { get: () => touch, zmin: () => zmin, zero: () => { touch = 0; zmin = Infinity; } } };
}

export { rng, yawFor, batchOrder };
export const KINDS = [...new Map(CONVEYOR_ITEMS.map((it) => [it.id + (it.scale || 1), it])).values()];
export const kindOf = (name) => name.replace(/\d+$/, '');

/** At rest inside bin fx (the sortCheck rule: in the zone, still). */
export function inBin(C, name, fx) { return inZone(C.w, name, fx) && C.w.speed(name) < 0.02; }

/** One item: spawn, wait until its predicted grasp reaches yT, tracking pick, place into bin fx. */
export function trial(C, it, { speed, yT, fx, r, pre }) {
  const { w, ctl, d, step } = C;
  C.reset(speed);
  if (pre) pre(C);   // e.g. items already lying in the bin
  const yaw = yawFor(it.name, r), dx = (r() - 0.5) * 0.03;
  w.spawn(it.name, { y: -0.26, yaw, force: true });
  const q = w.o[it.name].qadr; d.qpos[q] += dx; C.mj.mj_forward(C.m, d);
  step(0.6);
  const up0 = w.axis(it.name, 2, [0, 0, 0]).slice();
  const po = FLOOR != null ? { floor: +FLOOR } : {};
  let pick = beltPick(ctl, w, it.name, null, po), t0 = d.time;
  while (pick.y < yT && d.time - t0 < 25) { step(0.1); pick = beltPick(ctl, w, it.name, null, po); }
  const tilt0 = Math.acos(Math.min(1, w.axis(it.name, 2)[0] * up0[0] + w.axis(it.name, 2)[1] * up0[1] + w.axis(it.name, 2)[2] * up0[2]));
  const out = { name: it.name, kind: kindOf(it.name), speed, yT, fx, yaw: +yaw.toFixed(3), yCommit: +w.com(it.name)[1].toFixed(4), yPred: +pick.y.toFixed(4), T: +pick.T.toFixed(3), ok: pick.ok };
  C.touch.zero();
  const tc = d.time, ci = pick.steps.findIndex((s) => s.k === 'grip' && !s.open);
  let closeT = null;
  pick.steps.splice(ci, 0, { k: 'dyn', fn: () => { closeT = d.time; out.yClose = +w.com(it.name)[1].toFixed(4); return null; } });
  ctl.run(pick);
  step(15, () => !ctl.busy());
  out.tClose = closeT == null ? null : +(closeT - tc).toFixed(3);
  out.slat = C.touch.get();   // control ticks (16 ms) with a gripper–slat contact during the pick
  out.zmin = +(1000 * C.touch.zmin()).toFixed(1);   // mm: lowest gripper site height during the pick
  out.floor = +(1000 * pick.steps[2].floor).toFixed(1);
  out.tipped = tilt0 > 0.5;
  out.held = heldBy(ctl, w, it.name);
  if (out.yClose == null) out.yClose = +w.com(it.name)[1].toFixed(4);
  if (out.held) {
    const t = binDrop(w, fx, it.name);
    const pl = libPlace(ctl, w, { dz: pick.dz, ref: pick.ref, roll: ctl.roll, end: ctl.startPoint() }, t.xy, t.surface, t.closeYaw);
    ctl.run(pl);
    step(20, () => !ctl.busy());
    out.cycle = +(d.time - tc).toFixed(3);
    step(1.0);
    out.placed = inBin(C, it.name, fx);
    if (!out.placed) out.at = Array.from(w.com(it.name)).map((v) => +v.toFixed(3));
  } else out.placed = false;
  ctl.cancel(); ctl.syncFromCtrl();
  return out;
}

const pct = (a, b) => (b ? `${a}/${b} (${Math.round(100 * a / b)} %)` : '–');
function table(rows, key, cols) {
  const groups = new Map();
  for (const r of rows) { const k = key(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const lines = [];
  for (const [k, g] of [...groups.entries()].sort((a, b) => (a[0] > b[0] ? 1 : -1))) lines.push(`| ${k} | ${cols.map((c) => c(g)).join(' | ')} |`);
  return lines.join('\n');
}
const held = (g) => pct(g.filter((r) => r.held).length, g.length);
const placed = (g) => pct(g.filter((r) => r.placed).length, g.length);
const cyc = (g) => { const c = g.filter((r) => r.placed).map((r) => r.cycle); return c.length ? (c.reduce((a, b) => a + b, 0) / c.length).toFixed(2) : '–'; };
const slat = (g) => `${g.filter((r) => r.slat > 0).length}`;

async function main() {
  const C = await cell(), r = rng(SEED), rows = [], t0 = Date.now();
  const kinds = KINDS.filter((it) => !ONLY || ONLY.split(',').some((o) => it.name.startsWith(o)));
  if (mode === 'pick') {
    const YS = String(opt('ys', '-0.2,-0.1,0,0.1,0.2')).split(',').map(Number);
    for (const speed of SPEEDS) for (const it of kinds) for (const yT of YS) for (let k = 0; k < N; k++) {
      rows.push(trial(C, it, { speed, yT, fx: FRACTION_BIN[fractionOf(it.name)], r }));
    }
    const yb = (y) => { const b = Math.round(y * 10) / 10; return (b >= 0 ? '+' : '') + b.toFixed(1); };
    console.log(`\n### Tracking pick + place into the fraction bin (n per row; ${((Date.now() - t0) / 1000).toFixed(0)} s wall)\n`);
    console.log('By speed and kind:\n\n| speed · kind | held | placed in bin | mean cycle (s) | trials with a gripper–slat contact |\n|---|---|---|---|---|');
    console.log(table(rows, (x) => `${(x.speed * 100).toFixed(0)} cm/s · ${x.kind}`, [held, placed, cyc, slat]));
    console.log('\nBy speed:\n\n| speed | held | placed | mean cycle (s) | slat contact |\n|---|---|---|---|---|');
    console.log(table(rows, (x) => `${(x.speed * 100).toFixed(0)} cm/s`, [held, placed, cyc, slat]));
    console.log('\nBy speed and measured y at the close (±5 cm):\n\n| speed · y (m) | held | placed | mean cycle (s) | slat contact |\n|---|---|---|---|---|');
    console.log(table(rows, (x) => `${(x.speed * 100).toFixed(0)} cm/s · y ${yb(x.yClose)}`, [held, placed, cyc, slat]));
  } else if (mode === 'bins') {
    for (const speed of SPEEDS) for (const it of kinds) for (const fx of Object.keys(CONVEYOR_BINS)) for (let k = 0; k < N; k++) {
      rows.push(trial(C, it, { speed, yT: (fx.endsWith('paper') || fx.endsWith('glass') ? -1 : 1) * 0.04, fx, r }));
    }
    console.log(`\n### Placement into each bin (picked at y ≈ ±0.04, ${SPEEDS.map((s) => s * 100 + ' cm/s').join(', ')}; ${((Date.now() - t0) / 1000).toFixed(0)} s wall)\n`);
    console.log('| bin · kind | held | placed | mean cycle (s) |\n|---|---|---|---|');
    console.log(table(rows, (x) => `${x.fx} · ${x.kind}`, [held, placed, cyc]));
    console.log('\n| bin | held | placed | mean cycle (s) |\n|---|---|---|---|');
    console.log(table(rows, (x) => x.fx, [held, placed, cyc]));
  } else if (mode === 'batch') {
    const every = +opt('every', 10);
    for (const speed of SPEEDS) for (let k = 0; k < N; k++) rows.push(batch(C, { speed, every, seed: SEED + k }));
    console.log('| run | speed | correct | wrong bin | missed | purity | skipped | sim s |\n|---|---|---|---|---|---|---|---|');
    for (const [i, x] of rows.entries()) console.log(`| ${i} | ${x.speed * 100} cm/s | ${x.correct}/${x.n} | ${x.wrong} | ${x.missed} | ${x.purity == null ? '–' : (100 * x.purity).toFixed(1) + ' %'} | ${x.skipped} | ${x.time.toFixed(0)} |`);
    console.log('\nNot in their bin (item: where it ended; events):');
    for (const [i, x] of rows.entries()) {
      const lost = Object.entries(x.where).filter(([n, wh]) => wh !== FRACTION_BIN[fractionOf(n)]);
      console.log(`- run ${i} (seed ${x.seed}): ` + lost.map(([n, wh]) => `${n} → ${wh} [${x.events.filter((e) => e.name === n && e.ev !== 'close' && e.ev !== 'commit').map((e) => e.ev + (e.why ? '/' + e.why : '')).join(',')}]`).join('; '));
    }
  } else if (mode === 'mission') {
    const hz = +opt('hz', 60);
    for (let k = 0; k < N; k++) rows.push(missionRun(C, { seed: SEED + k, hz }));
    console.log(`| seed | won | correct | wrong bin | missed | purity | belt stood | sim s |\n|---|---|---|---|---|---|---|---|`);
    for (const x of rows) console.log(`| ${x.seed} | ${x.won ? 'yes' : 'no'} | ${x.correct}/${x.n} | ${x.wrong} | ${x.missed} | ${x.purity == null ? '–' : (100 * x.purity).toFixed(1) + ' %'} | ${x.paused.toFixed(1)} s | ${x.time.toFixed(0)} |`);
  } else if (mode === 'teach') {
    const hz = +opt('hz', 60), DEMOS = String(opt('demos', '4,6,11')).split(',').map(Number);
    const wrong = opt('wrong', null), bins = wrong ? Object.assign({}, FRACTION_BIN, Object.fromEntries([wrong.split(':')])) : null;
    const script = [];
    for (let k = 0; k < N; k++) script.push(teachRun(C, null, { seed: SEED + k, hz }));
    console.log(`\n### Skript (beltSolve) on the verification batches\n\n| seed | correct | wrong bin | purity | causes |\n|---|---|---|---|---|`);
    for (const x of script) console.log(`| ${x.seed} | ${x.correct}/${x.n} | ${x.wrong} | ${x.purity == null ? '–' : (100 * x.purity).toFixed(1) + ' %'} | ${x.causes} |`);
    for (const nd of DEMOS) {
      const demo = teachDemos(C, { n: nd, hz, bins });
      const ex = demo.examples, used = ex.filter((e) => e.use);
      const t0 = process.hrtime.bigint(), model = train(ex), ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(`\n### kNN policy from ${nd} scripted demos${wrong ? ' (wrong: ' + wrong + ')' : ''}: ${used.length} used of ${ex.length} episodes, coverage ${JSON.stringify(coverage(ex))}, trained in ${ms.toFixed(3)} ms`);
      console.log('episodes: ' + ex.map((e) => `${e.item}:${e.outcome}${e.use ? `(y ${e.y}, dz ${e.dz})` : ''}`).join(', '));
      console.log(`\n| seed | won | correct | wrong bin | purity | causes |\n|---|---|---|---|---|---|`);
      for (let k = 0; k < N; k++) {
        const x = teachRun(C, model, { seed: SEED + k, hz });
        rows.push(Object.assign({ demos: nd, used: used.length, ms }, x));
        console.log(`| ${x.seed} | ${x.won ? 'yes' : 'no'} | ${x.correct}/${x.n} | ${x.wrong} | ${x.purity == null ? '–' : (100 * x.purity).toFixed(1) + ' %'} | ${x.causes} |`);
      }
    }
    rows.push(...script.map((x) => Object.assign({ script: true }, x)));
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ mode, seed: SEED, n: N, speeds: SPEEDS, belt_pick: BELT_PICK, rows }, null, 1));
}

/** beltSolve on a seeded batch with the rules of mission 11 (src/objects/wastebatch.js WasteRun): one item every
 *  `every` s at the entry (retried while the entry is busy), counted in a bin when at rest there; ends when every item
 *  is spawned and none is left on the belt or in the jaws (or after `limit` s). */
export function batch(C, { speed, every = 10, seed = 1, limit = 240, log }) {
  const { w, ctl, d } = C;
  C.reset(speed);
  const run = new WasteRun(w, { seed, every, speed }), events = [], tip = new Float64Array(3);
  const tick = (dt) => { ctl.actualTip(tip); run.tick(dt, { started: true, tip, gripOpen: ctl.gripOpen() }); };
  const held = () => w.active().some((e) => e.lib && heldBy(ctl, w, e.name));
  const done = () => run.next >= run.n && !run.items.some((it) => it.state === 'belt') && !held();
  ctl.run(beltSolve(ctl, w, { stop: done, log: (e) => { events.push(e); if (log) log(e); } }));
  const t0 = d.time;
  while (d.time - t0 < limit) {
    C.step(0.1); tick(0.1);
    if (!ctl.busy() && done()) break;
  }
  for (let k = 0; k < 15; k++) { C.step(0.1); tick(0.1); }
  const st = run.stats(), where = {};
  for (const it of run.items) where[it.name] = it.state === 'bin' ? it.bin : it.state === 'queued' ? 'not spawned' : it.state;
  return { speed, seed, n: run.n, correct: st.correct, wrong: st.wrong, missed: st.missed, purity: st.purity,
    skipped: events.filter((e) => e.ev === 'skip').length, where, misses: events.filter((e) => e.ev === 'miss').length, time: d.time - t0, events, order: run.items.map((it) => it.name) };
}

/** Mission 11 solved by its automatic plan the way the page runs it (ux.startDemo: 0.6 s path preview, then the plan;
 *  app.js frame: controller update, physics by accumulator, mission check). Ends at the win or after `limit` s. */
export function missionRun(C, { seed = WASTE.seed, hz = 60, limit = 300 } = {}) {
  const { w, ctl, d, m, mj, belt, ts } = C, runner = new MissionRunner(w), keep = WASTE.seed;
  WASTE.seed = seed;
  try {
    mj.mj_resetDataKeyframe(m, d, 0);
    runner.select('waste_hand'); runner.setup(); mj.mj_forward(m, d);
    ctl.cancel(); ctl.syncFromCtrl();
    runner.start();
    const plan = runner.m.solve(ctl, w, runner), dt = 1 / hz, t0 = d.time;
    let acc = 0, pend = 0.6;
    while (d.time - t0 < limit && !runner.won) {
      if (pend > 0 && (pend -= dt) <= 0) ctl.run(plan);
      ctl.update(dt);
      acc += dt; while (acc >= ts) { belt.step(ts); mj.mj_step(m, d); acc -= ts; }
      ctl.actualTip(runner.ctx.tip); runner.ctx.gripOpen = ctl.gripOpen();
      runner.tick(dt);
    }
    const st = runner.ctx.s.run.stats();
    return { seed, hz, won: runner.won, n: st.n, correct: st.correct, wrong: st.wrong, missed: st.missed, purity: st.purity, paused: st.paused, time: d.time - t0,
      states: runner.ctx.s.run.items.map((it) => `${it.name}:${it.state}${it.bin ? '@' + it.bin : ''}`) };
  } finally { WASTE.seed = keep; ctl.cancel(); ctl.syncFromCtrl(); }
}

/** One page-like frame loop (controller at hz, physics by accumulator, mission check, recorder) until done(). */
function frames(C, runner, { hz = 60, limit = 300, done, frame }) {
  const { ctl, d, m, mj, belt, ts } = C, dt = 1 / hz, t0 = d.time;
  let acc = 0;
  while (d.time - t0 < limit && !done()) {
    ctl.update(dt);
    acc += dt; while (acc >= ts) { belt.step(ts); mj.mj_step(m, d); acc -= ts; }
    ctl.actualTip(runner.ctx.tip); runner.ctx.gripOpen = ctl.gripOpen();
    runner.tick(dt);
    if (frame) frame(d.time - t0);
  }
  return d.time - t0;
}

/** Mission 12 demo phase: beltSolve (optionally with other bins) sorts until n items were released, recorded at
 *  30 fps (t, joints, env, run clock); then the episodes are cut and turned into kNN examples (src/policy/knn.js). */
export function teachDemos(C, { n = 6, hz = 60, bins = null, seed = WASTE.seed } = {}) {
  const { w, ctl, d, m, mj } = C, runner = new MissionRunner(w), keep = WASTE.seed;
  WASTE.seed = seed;
  try {
    mj.mj_resetDataKeyframe(m, d, 0);
    runner.ctx.policy = { verify: false, demos: 0 };
    runner.select('waste_teach'); runner.setup(); mj.mj_forward(m, d);
    ctl.cancel(); ctl.syncFromCtrl();
    runner.start();
    let rel = 0, quiet = 0;
    const plan = beltSolve(ctl, w, Object.assign({ stop: () => rel >= n, log: (e) => { if (e.ev === 'release') rel++; } }, bins ? { bins } : {}));
    ctl.run(plan);
    const D = { t: [], obs: [], env: [], rt: [] }, buf = [0, 0, 0];
    let next = 0;
    frames(C, runner, { hz, limit: 400, done: () => { if (rel >= n && !ctl.busy()) quiet += 1 / hz; return quiet > 2; },
      frame: (t) => {
        if (t < next) return;
        next = t + 1 / 30;
        D.t.push(t); D.obs.push(Array.from(d.qpos.subarray(0, 6))); D.env.push(envOf(runner.ctx.s.run, w, buf)); D.rt.push(runner.ctx.s.run.t);
      } });
    const run = runner.ctx.s.run;
    D.segments = cutFrames(cutEpisodes(run.events, { end: run.t }), D.rt);
    D.examples = examplesFromDemo(D, { tipOf: (q) => Array.from(ctl.kin.fk(q)), src: 'script' });
    return D;
  } finally { WASTE.seed = keep; ctl.cancel(); ctl.syncFromCtrl(); }
}

/** Mission 12 policy run (model) or the Skript (model null) on the verification batch `seed`, as the page runs it. */
export function teachRun(C, model, { seed = TEACH.seed, hz = 60, limit = 320 } = {}) {
  const { w, ctl, d, m, mj } = C, runner = new MissionRunner(w), keep = TEACH.seed;
  TEACH.seed = seed;
  try {
    mj.mj_resetDataKeyframe(m, d, 0);
    runner.ctx.policy = { verify: true, demos: model ? model.n : 0 };
    runner.select('waste_teach'); runner.setup(); mj.mj_forward(m, d);
    ctl.cancel(); ctl.syncFromCtrl();
    runner.start();
    const events = [], log = (e) => events.push(e), stop = () => !!(runner.ctx.s.run && runner.ctx.s.run.done());
    const plan = model ? knnSolve(ctl, w, model, { stop, log }) : beltSolve(ctl, w, { stop, log });
    let pend = 0.6;
    const time = frames(C, runner, { hz, limit, done: () => { if (pend > 0 && (pend -= 1 / hz) <= 0) ctl.run(plan); return runner.won || (pend <= 0 && stop() && !ctl.busy()); } });
    const run = runner.ctx.s.run, st = run.stats(), rep = report(run.items, events, plan.decisions || {});
    const causes = rep.filter((r) => !r.ok).map((r) => `${r.item}:${r.cause}${r.by ? '#' + r.by : ''}`).join(', ');
    return { seed, hz, won: runner.won, n: st.n, correct: st.correct, wrong: st.wrong, missed: st.missed, purity: st.purity, time, causes, report: rep,
      stars: runner.won ? runner.result.stars : 0 };
  } finally { TEACH.seed = keep; ctl.cancel(); ctl.syncFromCtrl(); }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
