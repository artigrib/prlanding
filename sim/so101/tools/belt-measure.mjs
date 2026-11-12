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
//       beltSolve on the 12-item batch, seeded order and yaws, one item every `every` s.
//
// Trial outcome: held (lifted off the belt after the close), placed (at rest inside the target bin), tipped (an
// upright item lying before the grasp), slat (control ticks with a gripper–slat contact during
// the pick: the jaws pressing into the moving belt). Output: a table on stdout
// and, with --out, the raw trials as JSON.

import fs from 'node:fs';
import { loadObjectScene } from '../tests/mj-node.mjs';
import { World } from '../src/world.js';
import { ArmController } from '../src/controller.js';
import { inZone } from '../src/missions.js';
import { beltPick, beltSolve, heldBy, binDrop, fractionOf, BELT_PICK } from '../src/objects/beltpick.js';
import { libPlace } from '../src/missions.js';
import { CONVEYOR_ITEMS, CONVEYOR_BINS, FRACTION_BIN, BELT } from '../src/objects/scene.js';

const args = process.argv.slice(2), mode = args[0] || 'pick';
const opt = (k, dflt) => { const i = args.indexOf('--' + k); return i < 0 ? dflt : args[i + 1]; };
const N = +opt('n', mode === 'bins' ? 6 : 10), SEED = +opt('seed', 1), OUT = opt('out', null);
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

export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
export const KINDS = [...new Map(CONVEYOR_ITEMS.map((it) => [it.id + (it.scale || 1), it])).values()];
export const kindOf = (name) => name.replace(/\d+$/, '');
const LONG = /^(fork|spoon)_/;
/** Yaw on the belt: long items lengthwise (± 0.35 rad), the rest any. */
export const yawFor = (name, r) => (LONG.test(name) ? Math.PI / 2 + (r() - 0.5) * 0.7 : r() * Math.PI * 2);

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
    for (const [i, x] of rows.entries()) console.log(`| ${i} | ${x.speed * 100} cm/s | ${x.correct}/12 | ${x.wrong} | ${x.missed} | ${x.purity == null ? '–' : (100 * x.purity).toFixed(1) + ' %'} | ${x.skipped} | ${x.time.toFixed(0)} |`);
    console.log('\nNot in their bin (item: where it ended; events):');
    for (const [i, x] of rows.entries()) {
      const lost = Object.entries(x.where).filter(([n, wh]) => wh !== FRACTION_BIN[fractionOf(n)]);
      console.log(`- run ${i} (seed ${x.seed}): ` + lost.map(([n, wh]) => `${n} → ${wh} [${x.events.filter((e) => e.name === n && e.ev !== 'close' && e.ev !== 'commit').map((e) => e.ev + (e.why ? '/' + e.why : '')).join(',')}]`).join('; '));
    }
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ mode, seed: SEED, n: N, speeds: SPEEDS, belt_pick: BELT_PICK, rows }, null, 1));
}

/** Seeded batch order: 12 pool items, interleaved so that a fraction never comes twice in a row more than once. */
export function batchOrder(seed) {
  const r = rng(seed);
  for (;;) {
    const a = CONVEYOR_ITEMS.map((it) => it.name);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    let rep = 0; for (let i = 1; i < a.length; i++) if (fractionOf(a[i]) === fractionOf(a[i - 1])) rep++;
    if (rep <= 1) return { order: a, yaw: a.map((n) => yawFor(n, r)) };
  }
}

/** beltSolve on a seeded 12-item batch: one item every `every` s at the entry; ends when every item is spawned and
 *  none is left on the belt (or after `limit` s). Counts per the M11 rules: correct, wrong bin, missed. */
export function batch(C, { speed, every = 10, seed = 1, limit = 240, log }) {
  const { w, ctl, d, belt } = C;
  C.reset(speed);
  const { order, yaw } = batchOrder(seed), events = [];
  let next = 0, tNext = d.time;
  const onBelt = () => w.active().some((e) => e.lib && ['belt', 'entry'].includes(belt.zone(w.com(e.name, [0, 0, 0]))));
  const held = () => w.active().some((e) => e.lib && heldBy(ctl, w, e.name));
  const done = () => next >= order.length && !onBelt() && !held();
  ctl.run(beltSolve(ctl, w, { stop: done, log: (e) => { events.push(e); if (log) log(e); } }));
  const t0 = d.time;
  while (d.time - t0 < limit) {
    if (next < order.length && d.time >= tNext) {
      if (w.spawn(order[next], { yaw: yaw[next] })) { next++; tNext += every; } else tNext += 0.2;
    }
    C.step(0.1);
    if (!ctl.busy() && done()) break;
  }
  C.step(1.5);
  let correct = 0, wrong = 0;
  const where = {};
  for (const n of order) {
    const fx = FRACTION_BIN[fractionOf(n)], p = w.com(n, [0, 0, 0]);
    const b = Object.keys(CONVEYOR_BINS).find((k) => inZone(w, n, k));
    where[n] = !w.o[n].active ? 'not spawned' : b || belt.zone(p) || (p[2] < -0.1 ? 'floor' : 'table');
    if (b === fx) correct++; else if (b) wrong++;
  }
  const inBins = correct + wrong;
  return { speed, seed, correct, wrong, missed: order.length - inBins, purity: inBins ? correct / inBins : null,
    skipped: events.filter((e) => e.ev === 'skip').length, where, misses: events.filter((e) => e.ev === 'miss').length, time: d.time - t0, events };
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
