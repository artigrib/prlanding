// Picking from the moving belt of the 'conveyor' scene profile: tracking pick + beltSolve (scripted baseline).
// DOM/three-free (node tests: tests/belt-pick.test.mjs; measurements: tools/belt-measure.mjs).
//
// Tracking pick (beltPick): the grasp is planned where the item will be when the jaws close (lead-time prediction:
// now + planned time to close × belt speed), so the wrist roll fits the item there. While the arm approaches,
// descends and closes, the pick waypoints move with the belt (ArmController `track`): the offset integrates the
// commanded belt speed (belt.v, which follows the physics state after a reset or a snapshot restore), not the item's
// measured velocity, whose noise moved the waypoints in the prototype. Below BELT_PICK.gate the belt counts as stopped.
// Tracking ends with the close; the lift holds the offset; release and lift into the bin are the usual libPlace.
//
// beltSolve: one `dyn` loop. Each round it takes the most downstream item of a known fraction whose predicted
// grasp point lies in the pick window [yMin, yMax], picks it with tracking and drops it into the bin of its fraction;
// with nothing in the window it waits 0.2 s. An item whose bin is full (it would rest higher than the bin counts)
// is left to pass. Past yMax an item is left to the end tote: near the head drum the
// slats turn down, items slow down and tip, and tracking stops at yStop.

import { libGrasp, libPick, libPlace, inZone } from '../missions.js';
import { BELT, CONVEYOR_ITEMS, FRACTION_BIN } from './scene.js';

export const BELT_PICK = {
  gate: 0.005,          // m/s: slower than this the belt counts as stopped (no tracking)
  lead: 0.06,           // s: waypoints lead the item by v · lead (servo lag: 3.7 mm at 6 cm/s, measured)
  closeAt: 0.35,        // s into the 0.7 s close: when the jaws reach a ~6 cm item (for the prediction)
  settle: 0.05,         // s: mean extra wait for the arm to settle at the hover and grasp points (measured)
  jawDrop: 0.0081,      // m: the moving jaw dips this far below the gripper site while it closes (so101.xml geometry)
  margin: 0.001,        // m: jaw clearance above the slat top at the lowest grasp (thin forks need the jaws low)
  yMin: -0.15,          // m: earliest predicted grasp point: further upstream the extended arm sags into the slats
  yMax: 0.17,           // m: latest predicted grasp point for a commit
  yStop: 0.24,          // m: tracking stops here (the slats turn down over the head drum at y1 = 0.30)
  tries: 2              // attempts per item
};
/** Lowest site height of a belt grasp: the closing jaw stays `margin` above the slat top (13.6 mm). */
export const BELT_FLOOR = BELT.top + BELT_PICK.jawDrop + BELT_PICK.margin;

const FRACTION = Object.fromEntries(CONVEYOR_ITEMS.map((it) => [it.name, it.fraction]));
/** Fraction of a conveyor pool item ('paper' | 'plastic' | 'glass' | 'metal'), or undefined. */
export const fractionOf = (name) => FRACTION[name];
const LONG = /^(fork|spoon)_/;

/** Commanded belt velocity (m/s along +y), 0 below the gate. */
export function beltV(w) { const v = w.belt ? w.belt.v : 0; return Math.abs(v) < BELT_PICK.gate ? 0 : v; }

/** Planned time (s) from the start of a plan until the jaws hold the item: moves (as ArmController times them),
 *  the settle waits and part of the close. */
export function timeToClose(plan) {
  let t = 0;
  for (const st of plan.steps) {
    if (st.k === 'grip' && !st.open) return t + BELT_PICK.closeAt;
    if (st.k === 'move') {
      let len = 0;
      for (let k = 1; k < st.pts.length; k++) len += Math.hypot(st.pts[k][0] - st.pts[k - 1][0], st.pts[k][1] - st.pts[k - 1][1], st.pts[k][2] - st.pts[k - 1][2]);
      t += Math.max(0.25, len / (st.speed || (st.slow ? 0.09 : 0.2)) + 0.25) + (st.settle ? BELT_PICK.settle : 0);
    } else if (st.k === 'wait') t += st.t;
  }
  return t;
}

/**
 * Tracking pick of a belt item. Returns the pick plan (libPick fields: ref, dz, roll, end) plus
 * { tracker, y: predicted grasp y, T: predicted time to close }. o.floor overrides BELT_FLOOR.
 */
export function beltPick(ctl, w, name, from, o = {}) {
  const v = o.v != null ? o.v : beltV(w), floor = o.floor != null ? o.floor : BELT_FLOOR;
  const g0 = libGrasp(w, name), sz = w.o[name].size;
  // a narrow round item (vial, socket, nut) is gripped across the belt: the jaws then close at right angles to
  // the motion, so a few mm of tracking lag along the belt does not put a jaw on it. Cups keep libGrasp's heading
  // (measured: the plastic cup across the belt 0/6 at 6 cm/s, 2/6 at 2 cm/s; with libGrasp's heading 4/6 and 6/6).
  const across = o.across != null ? o.across : !!sz && Math.max(sz[0], sz[1]) < 0.05 &&
    Math.abs(sz[0] - sz[1]) < 0.15 * Math.max(sz[0], sz[1]) && !w.o[name].lib.lying;
  if (across) {
    Object.assign(g0, { dir: [1, 0], yaw: 0, g: [g0.c[0], g0.c[1]] });
  }
  const at = (dy) => {
    const g = { ...g0, c: [g0.c[0], g0.c[1] + dy, g0.c[2]], g: [g0.g[0], g0.g[1] + dy] };
    return libPick(ctl, w, name, from, { grasp: g, floor });
  };
  let dy = 0, plan = at(0), T = timeToClose(plan);
  for (let k = 0; k < 2 && v; k++) { dy = v * T; plan = at(dy); T = timeToClose(plan); }
  const gy = g0.g[1] + dy;
  // the plan's waypoints assume the item at the predicted spot; it is still dy upstream of it now
  const tracker = {
    off: [0, -dy], lead: o.lead != null ? o.lead : BELT_PICK.lead, gy,
    v: () => { const u = beltV(w); return u && gy + tracker.off[1] < BELT_PICK.yStop ? [0, u] : null; }
  };
  const S = plan.steps;   // grip open · approach · descend · close · lift (ArmController.planPick)
  S[1].track = tracker; S[1].trackFrom = 2;   // from the start pose up and over: only the hover point moves
  S[2].track = tracker; S[3].track = tracker; S[4].hold = tracker;
  return Object.assign(plan, { tracker, y: gy, T });
}

/** Is the item held by the gripper (lifted off its rest height, close to the tip)? */
export function heldBy(ctl, w, name) {
  const p = w.com(name, [0, 0, 0]), t = ctl.actualTip(new Float64Array(3)), e = w.o[name];
  return p[2] > (e.restZ || 0) + 0.012 && Math.hypot(t[0] - p[0], t[1] - p[1], t[2] - p[2]) < 0.09 && !ctl.gripOpen();
}

/** Highest point (and its item) of what already lies in bin fx inside the rectangle |dx| < hx, |dy| < hy around
 *  (x, y) (bins are axis aligned), or 0. */
function pileTop(w, fx, x, y, hx, hy, except) {
  let top = 0, on = null;
  for (const e of w.active()) {
    if (!e.lib || e.name === except || !inZone(w, e.name, fx, 0.01)) continue;
    for (const P of w.points(e.name)) for (let i = 0; i < P.length; i += 3) {
      if (Math.abs(P[i] - x) < hx && Math.abs(P[i + 1] - y) < hy && P[i + 2] > top) { top = P[i + 2]; on = e.name; }
    }
  }
  return { top, on };
}
/** Drop spot in bin fx for the held item: of the spots where its footprint fits inside the bin, the one with the
 *  lowest pile (nearer spots first), released just above it. Long items lie along the bin's long axis (y). An item
 *  as wide as the bin (a 6 cm cup in the 9 cm paper bin) has only the centre: it is stacked straight on the
 *  previous one, which stays put, instead of being dropped onto a rim and bouncing out. */
export function binDrop(w, fx, name) {
  const f = w.pos(fx, [0, 0, 0]), z = w.o[fx].fixture.zone, sz = w.o[name].size || [0.03, 0.03, 0.03], long = LONG.test(name);
  const rx = long ? Math.min(sz[0], sz[1]) / 2 : Math.max(sz[0], sz[1]) / 2, ry = long ? Math.max(sz[0], sz[1]) / 2 : rx;
  const ax = Math.max(0, z.hx - rx - 0.004), ay = Math.max(0, z.hy - ry - 0.004);
  // candidate spots: a 5 × 5 grid over the room the footprint has (placed items drift 1–2 cm on release, so a coarse
  // grid found every spot blocked while a gap was still free)
  const grid = (a) => (a > 0.003 ? [-a, a, 0, -a / 2, a / 2] : [0]);
  let xs = grid(ax);
  const ys = grid(ay);
  // a long bin that takes long items (plastic: fork, spoon and the cup): two lanes, so neither blocks the other.
  // Long items lie in the lane on the robot side (they stack there), everything else stands in the belt-side lane.
  if (z.hy > 1.5 * z.hx && fx === 'bin_plastic' && ax > 0.003) xs = [long ? -ax : ax];
  // score: pile height plus 0.3 × the reach beyond the bin centre, so the spots nearer the robot fill first and a
  // flat item rather lands on a flat one than on the far edge (a far drop at the reach limit tipped over the wall)
  let best = null;
  const r0 = Math.hypot(f[0], f[1]);
  for (const dy of ys) for (const dx of xs) {
    const x = f[0] + dx, y = f[1] + dy, { top, on } = pileTop(w, fx, x, y, Math.max(rx, 0.015) + 0.003, Math.max(ry, 0.015) + 0.003, name);
    const score = top + 0.3 * (Math.hypot(x, y) - r0);
    if (!best || score < best.score - 1e-4) best = { xy: [x, y], top, on, score };
  }
  // on top of another item: straight above its centre (a cup on a cup's rim tips over the wall)
  if (best.on && !long) { const c = w.com(best.on, [0, 0, 0]); best.xy = [c[0], c[1]]; }
  return { xy: best.xy, surface: f[2] + best.top + (best.top ? 0.004 : 0.002), closeYaw: long ? w.yaw(fx) : null };
}

/** Carry high enough over bin fx that the held item clears what already stands in it (a carried vial swept
 *  standing vials out of the glass bin), then go straight down to libPlace's hover above the drop spot. */
function carryOver(w, fx, name, dz, pl) {
  const f = w.pos(fx, [0, 0, 0]), z = w.o[fx].fixture.zone;
  const { top } = pileTop(w, fx, f[0], f[1], z.hx + 0.01, z.hy + 0.01, name);
  const st = pl.steps[0], P = st.pts, end = P[P.length - 1];
  const H = Math.max(top, z.top) + dz + 0.025;   // item bottom 2.5 cm above the highest thing in the bin
  if (H <= end[2]) return;
  const s = P[0], lift = Math.max(s[2], H);
  st.pts = [s, [s[0], s[1], lift], [end[0], end[1], lift], end];
}

/**
 * Scripted baseline for the conveyor: sorts belt items into the bins of their fractions until opts.stop() is true.
 * opts: { bins: { fraction: fixture } (default FRACTION_BIN), stop: () => bool, log: (event) => void,
 *         pick: (name) => bool (which items to handle; default: every pool item with a fraction) }
 * Events: { ev: 'commit' | 'close' | 'held' | 'miss' | 'release' | 'skip', name, t, y, ... } (t = sim time).
 */
export function beltSolve(ctl, w, opts = {}) {
  const bins = opts.bins || FRACTION_BIN, log = opts.log || (() => {}), d = w.d;
  const want = opts.pick || ((n) => !!bins[fractionOf(n)]);
  const tries = {}, gone = new Set();
  const ev = (e) => log(Object.assign({ t: d.time }, e));
  const onBelt = (e) => { const p = w.com(e.name, [0, 0, 0]), z = w.belt.zone(p); return (z === 'belt' || z === 'entry') ? p : null; };

  const choose = (c) => {
    const v = beltV(w), list = [];
    for (const e of w.active()) {
      if (!e.lib || gone.has(e.name) || !want(e.name)) continue;
      const p = onBelt(e); if (!p) continue;
      list.push([p[1], e.name]);
    }
    list.sort((a, b) => b[0] - a[0]);   // most downstream first
    for (const [, n] of list) {
      // bin full: the item would end higher than the bin counts (inZone: top + 6 cm), so it is left to the tote
      const fx = bins[fractionOf(n)], dr = binDrop(w, fx, n), e = w.o[n], f = w.pos(fx, [0, 0, 0]);
      if (dr.surface + (e.restZ - BELT.top) > f[2] + w.o[fx].fixture.zone.top + 0.06 - 0.01) {
        gone.add(n); ev({ ev: 'skip', name: n, y: w.com(n, [0, 0, 0])[1], why: 'full' }); continue;
      }
      const pick = beltPick(c, w, n, c.startPoint());
      if (pick.y > BELT_PICK.yMax || !pick.ok) { gone.add(n); ev({ ev: 'skip', name: n, y: pick.y, why: pick.ok ? 'late' : 'reach' }); continue; }
      if (pick.y < BELT_PICK.yMin) continue;   // not in the window yet; a downstream item may be
      return { n, pick, v };
    }
    return null;
  };

  const loop = (c) => {
    if (opts.stop && opts.stop()) return null;
    const ch = choose(c);
    if (!ch) return [{ k: 'wait', t: 0.2 }, { k: 'dyn', fn: loop }];
    const { n, pick } = ch;
    tries[n] = (tries[n] || 0) + 1;
    ev({ ev: 'commit', name: n, y: w.com(n, [0, 0, 0])[1], yGrasp: pick.y, T: pick.T, v: ch.v, try: tries[n] });
    const close = pick.steps.findIndex((st) => st.k === 'grip' && !st.open);
    pick.steps.splice(close + 1, 0, { k: 'dyn', fn: () => { ev({ ev: 'close', name: n, y: w.com(n, [0, 0, 0])[1] }); return null; } });
    const place = (cc) => {
      if (!heldBy(cc, w, n)) {
        ev({ ev: 'miss', name: n, y: w.com(n, [0, 0, 0])[1] });
        if (tries[n] >= BELT_PICK.tries) gone.add(n);
        const s = cc.startPoint();
        return [{ k: 'grip', open: true, t: 0.3 }, { k: 'move', pts: [s, [s[0], s[1], Math.max(s[2], 0.12)]], roll: cc.roll }];
      }
      ev({ ev: 'held', name: n });
      gone.add(n);
      const fx = bins[fractionOf(n)], t = binDrop(w, fx, n);
      const pl = libPlace(cc, w, { dz: pick.dz, ref: pick.ref, roll: cc.roll, end: cc.startPoint() }, t.xy, t.surface, t.closeYaw);
      carryOver(w, fx, n, pick.dz, pl);
      // a fork or spoon caught in half-opened jaws rode along to the next pick: open them wide
      if (LONG.test(n)) for (const st of pl.steps) if (st.k === 'dyn') {
        const fn = st.fn; st.fn = (c) => { const r = fn(c); if (r) for (const x of r) if (x.k === 'grip' && x.open) x.partial = 0.9; return r; };
      }
      const rel = pl.steps.findIndex((st) => st.k === 'dyn');
      pl.steps.splice(rel + 1, 0, { k: 'dyn', fn: (c3) => {
        // a light fork can stay caught in the half-opened jaws (libPlace opens gently) and ride along to the next
        // pick: open fully over the bin and let it drop
        const p = w.com(n, [0, 0, 0]), t3 = c3.actualTip(new Float64Array(3));
        const stuck = Math.hypot(t3[0] - p[0], t3[1] - p[1], t3[2] - p[2]) < 0.05 && p[2] > (w.o[n].restZ || 0) + 0.03;
        ev({ ev: 'release', name: n, bin: fx, stuck });
        return stuck ? [{ k: 'grip', open: true, t: 0.6 }] : null;
      } });
      return pl.steps;
    };
    return [...pick.steps, { k: 'dyn', fn: place }, { k: 'dyn', fn: loop }];
  };
  const plan = { steps: [{ k: 'dyn', fn: loop }], path: [], ok: true, bad: [], kind: 'belt' };
  return plan;
}
