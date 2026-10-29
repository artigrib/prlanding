// Arm controller for "Chytrý pohyb": IK target following + a small waypoint planner (pick / place / paths).
// DOM- and three.js-free so it runs in node tests (tests/plan.test.mjs) as well as in the page.
//
// Coordinates are MuJoCo world (z up, metres). The controller writes d.ctrl only while it is active
// (following a dragged target or executing a plan); anything else that drives the arm (joint sliders,
// the scripted demo, replay) calls cancel() first.

import { Kin, chainFromModel } from './kin.js';

export const GRIP_OPEN = 1.2, GRIP_CLOSED = -0.17;
const HOVER = 0.075;          // height above an object's top for approach / retreat (m)
const JAW_OFFSET = 0.007;
const FLOOR = 0.009;         // lowest target (m): every planner waypoint is at or above it     // site sits this far from the grasp centre along the closing axis

export class ArmController {
  constructor(mj, m, d, actIds) {
    this.mj = mj; this.m = m; this.d = d; this.act = actIds;
    this.kin = new Kin(chainFromModel(mj, m));
    this.planKin = new Kin(this.kin.c);           // separate scratch for planning
    this.lo = this.kin.lo; this.hi = this.kin.hi;
    this.home = Float64Array.from(actIds.map((a) => m.key_ctrl[a]));
    this.qGoal = new Float64Array(6);
    this.target = new Float64Array(3);
    this.tip = new Float64Array(3);               // current FK tip of the commanded pose
    this.roll = 0; this.pitch = Math.PI / 2;
    this.grip = GRIP_OPEN;
    this.active = false; this.dragging = false;
    this.reachable = true; this.err = 0; this.usedPitch = this.pitch;
    this.floor = FLOOR;                           // lowest target; a library grasp may go a little lower (o.floor)
    this.vmax = 2.2;                              // rad/s per joint (commanded)
    this.plan = null;                             // { steps, i, t, ... }
    this.listeners = {};
    this._q = new Float64Array(6); this._qa = new Float64Array(6);
    this._p = new Float64Array(3);
    this.syncFromCtrl();
  }

  on(ev, fn) { (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); }
  emit(ev, a) { const l = this.listeners[ev]; if (l) for (const f of l) f(a); }

  ctrl(i) { return this.d.ctrl[this.act[i]]; }

  /** Take the current commanded pose as the starting point (target = where the gripper is now). */
  syncFromCtrl() {
    for (let i = 0; i < 6; i++) this.qGoal[i] = this.ctrl(i);
    this.roll = this.qGoal[4]; this.grip = this.qGoal[5];
    const p = this.kin.fk(this.qGoal);
    this.target.set(p); this.tip.set(p);
    this.reachable = true; this.err = 0;
  }

  /** Actual (measured) tip position from qpos. */
  actualTip(out) {
    const q = this._qa, qp = this.d.qpos;
    for (let i = 0; i < 6; i++) q[i] = qp[this.m.jnt_qposadr[this.m.actuator_trnid[2 * this.act[i]]]];
    out.set(this.kin.fk(q)); return out;
  }

  cancel() { this.floor = FLOOR; this.active = false; this.dragging = false; if (this.plan) { this.plan = null; this.emit('plan', null); } }

  /** Start following (a drag began or the keyboard moved the target). */
  begin() { if (!this.active) { this.syncTargetOnly(); } this.active = true; if (this.plan) { this.plan = null; this.emit('plan', null); } }
  syncTargetOnly() { for (let i = 0; i < 6; i++) this.qGoal[i] = this.ctrl(i); }

  setTarget(x, y, z) {
    // keep the target above the table and inside a generous box (IK reports the rest as unreachable)
    this.target[0] = Math.max(-0.25, Math.min(0.55, x));
    this.target[1] = Math.max(-0.40, Math.min(0.40, y));
    // the table is the floor (9 mm keeps the fingertips out of it); user moves get told so (P1-8)
    if (z < this.floor) { z = this.floor; if (!this.plan) this.emit('floor'); }
    this.target[2] = Math.min(0.42, z);
  }
  setRoll(r) { this.roll = Math.max(this.lo[4], Math.min(this.hi[4], r)); }
  setGrip(open) { this.grip = open ? GRIP_OPEN : GRIP_CLOSED; this.active = true; this.emit('grip', open); }
  gripOpen() { return this.grip > 0.5; }

  /** IK for the current target (into qGoal). */
  solveGoal() {
    this.qGoal[4] = this.roll; this.qGoal[5] = this.grip;
    const r = this.kin.solveAuto(this.qGoal, this.target, this.pitch, { iters: 25, home: this.home });
    this.reachable = r.reachable; this.err = r.err; this.usedPitch = r.pitch;
    this.tip.set(this.kin.fk(this.qGoal));
    return r;
  }

  /** Called once per frame (or per physics step in tests). */
  update(dt) {
    if (this.plan) this.tickPlan(dt);
    if (!this.active) return;
    this.solveGoal();
    const c = this.d.ctrl, step = this.vmax * dt;
    let moving = false;
    for (let i = 0; i < 5; i++) {
      const a = this.act[i], cur = c[a], dv = this.qGoal[i] - cur;
      const s = dv > step ? step : dv < -step ? -step : dv;
      // ease in the last few degrees so the arm settles smoothly
      c[a] = cur + (Math.abs(dv) < 0.15 ? dv * Math.min(1, dt * 12) : s);
      if (Math.abs(dv) > 0.002) moving = true;
    }
    const ag = this.act[5], dg = this.grip - c[ag], gs = 4 * dt;
    c[ag] += dg > gs ? gs : dg < -gs ? -gs : dg;
    this.moving = moving;
  }

  // ---------------- planner ----------------

  /** Solve IK for a point without touching the live goal; returns reachability. q is seed/out. */
  reach(q, p, pitch = Math.PI / 2) {
    const r = this.planKin.solveAuto(q, p, pitch, { iters: 40, home: this.home });
    return r.reachable;
  }

  /** Closing-axis heading (world, rad) of the gripper for joint vector q. */
  jawHeading(q) {
    const k = this.planKin; k.fk(q);
    const gi = this.kin.c.site.body, M = k.xmat;
    return Math.atan2(M[9 * gi + 3], M[9 * gi]);
  }

  /**
   * Roll that aligns the jaws with a face of a box of heading `yaw` when grasping at p.
   * Returns { roll, at } where `at` is the site position (offset along the closing axis).
   */
  graspRoll(p, yaw, seed, period = Math.PI / 2, offset = JAW_OFFSET) {
    const q = this._q; q.set(seed); q[4] = 0;
    this.reach(q, p);
    const h = this.jawHeading(q);
    let dr = wrap(yaw - h, period);
    let roll = q[4] + dr;
    if (roll > this.hi[4]) roll -= period; if (roll < this.lo[4]) roll += period;
    q[4] = roll; this.reach(q, p);
    const h2 = this.jawHeading(q);
    const at = [p[0] + offset * Math.cos(h2), p[1] + offset * Math.sin(h2), p[2]];
    return { roll, at };
  }

  /** Current commanded tip (start of a new plan). */
  startPoint() { this.syncTargetOnly(); return Array.from(this.kin.fk(this.qGoal)); }

  /**
   * Build a pick plan for an object: center p=[x,y,z], half height hz, heading yaw.
   * Returns { steps, path, ok } (path = polyline for the preview).
   * o (library objects): { z: grasp height, top: object top, period: jaw symmetry (π for a closing axis),
   *   offset: site offset along the closing axis from the grasp centre }
   */
  planPick(p, hz, yaw = 0, from, o = {}) {
    const s = from || this.startPoint();
    const grasp = [p[0], p[1], o.z != null ? o.z : Math.max(0.007, p[2] - 0.002)];
    const { roll, at } = this.graspRoll(grasp, yaw, this.home, o.period, o.offset);
    const hover = (o.top != null ? o.top : p[2] + hz) + HOVER;
    const lift = Math.max(s[2], hover);
    const pts = [s, [s[0], s[1], lift], [at[0], at[1], hover], at];
    const steps = [
      { k: 'grip', open: true },
      { k: 'move', pts: [s, [s[0], s[1], lift], [at[0], at[1], hover]], roll },
      { k: 'move', pts: [[at[0], at[1], hover], at], roll, slow: true, settle: true, floor: o.floor },
      { k: 'grip', open: false, t: 0.7 },
      { k: 'move', pts: [at, [at[0], at[1], hover + 0.03]], roll, slow: true, floor: o.floor }
    ];
    return this.finish(steps, pts.concat([[at[0], at[1], hover + 0.03]]), { kind: 'pick', roll, end: [at[0], at[1], hover + 0.03] });
  }

  /** Place whatever is held at p (x, y = centre, z = height where the held object's centre should end). */
  planPlace(p, from, rollIn, heldPos) {
    const s = from || this.startPoint();
    const hover = Math.max(p[2] + HOVER, 0.09);
    const lift = Math.max(s[2], hover);
    const roll = rollIn != null ? rollIn : this.roll;
    const rel = [p[0], p[1], p[2] + 0.004];
    const pts = [s, [s[0], s[1], lift], [p[0], p[1], hover], rel, [p[0], p[1], hover]];
    const tail = (r, h) => [
      { k: 'move', pts: [h, r], roll, slow: true, settle: true },
      { k: 'grip', open: true, t: 0.45 },
      { k: 'move', pts: [r, [r[0], r[1], hover]], roll }
    ];
    const steps = [{ k: 'move', pts: [s, [s[0], s[1], lift], [p[0], p[1], hover]], roll }];
    if (heldPos) {
      // closed loop: the object sits a few mm off the gripper centre, so correct the release point
      const plan = this.finish(steps.concat(tail(rel, [p[0], p[1], hover])), pts, { kind: 'place', roll, end: [p[0], p[1], hover] });
      plan.steps.splice(1, 3, { k: 'dyn', fn: (c) => {
        const o = heldPos(), t = c.actualTip(c._p);
        let ox = t[0] - o[0], oy = t[1] - o[1], oz = t[2] - o[2];
        if (Math.hypot(ox, oy, oz) > 0.03) { ox = oy = oz = 0; }
        const h = [c.target[0], c.target[1], c.target[2]];
        return tail([p[0] + ox, p[1] + oy, p[2] + 0.004 + oz], h);
      } });
      return plan;
    }
    return this.finish(steps.concat(tail(rel, [p[0], p[1], hover])), pts, { kind: 'place', roll, end: [p[0], p[1], hover] });
  }

  /** Follow an arbitrary polyline with the tip (pen / pushing). */
  planPath(pts, opts = {}) {
    const s = opts.from || this.startPoint();
    const first = pts[0];
    const hover = Math.max(first[2] + 0.05, 0.06);
    const lift = Math.max(s[2], hover);
    const pre = [[s[0], s[1], lift], [first[0], first[1], hover]];
    const steps = [];
    if (opts.grip != null) steps.push({ k: 'grip', open: opts.grip });
    steps.push({ k: 'move', pts: [s].concat(pre), roll: opts.roll != null ? opts.roll : this.roll });
    steps.push({ k: 'move', pts: [pre[1], first], roll: opts.roll != null ? opts.roll : this.roll, slow: true, settle: true });
    steps.push({ k: 'move', pts, roll: opts.roll != null ? opts.roll : this.roll, speed: opts.speed || 0.06, pitch: opts.pitch });
    if (opts.retreat !== false) {
      const last = pts[pts.length - 1];
      steps.push({ k: 'move', pts: [last, [last[0], last[1], last[2] + 0.05]], roll: opts.roll != null ? opts.roll : this.roll });
    }
    return this.finish(steps, [s].concat(pre, pts), { kind: 'path' });
  }

  finish(steps, path, info) {
    // reachability check of every waypoint (chained seeds), used for the red/green preview
    const q = this._q; q.set(this.qGoal);
    let ok = true; const bad = [];
    for (const st of steps) if (st.k === 'move') {
      q[4] = st.roll;
      for (const p of st.pts) if (!this.reach(q, p, st.pitch != null ? st.pitch : Math.PI / 2)) { ok = false; bad.push(p); }
    }
    return Object.assign({ steps, path, ok, bad }, info);
  }

  /** Concatenate plans (e.g. pick then place). Paths are joined; reachability ANDed. */
  static chain(...plans) {
    return {
      steps: plans.flatMap((p) => p.steps), path: plans.flatMap((p) => p.path),
      ok: plans.every((p) => p.ok), bad: plans.flatMap((p) => p.bad), kind: plans.map((p) => p.kind).join('+')
    };
  }

  run(plan) {
    this.syncTargetOnly();
    this.active = true; this.dragging = false;
    this.plan = { steps: plan.steps, i: -1, t: 0, plan };
    this.nextStep();
    this.emit('plan', plan);
  }

  nextStep() {
    const P = this.plan; P.i++; P.t = 0;
    if (P.i >= P.steps.length) { const done = P.plan; this.plan = null; this.floor = FLOOR; this.emit('done', done); return; }
    const st = P.steps[P.i];
    if (st.k === 'move') {
      // arc-length table for the polyline (allocation only at step start)
      const L = [0]; for (let k = 1; k < st.pts.length; k++) L.push(L[k - 1] + dist(st.pts[k - 1], st.pts[k]));
      st.L = L; st.len = L[L.length - 1];
      const v = st.speed || (st.slow ? 0.09 : 0.2);
      st.T = Math.max(0.25, st.len / v + 0.25);
      if (st.roll != null) this.setRoll(st.roll);
      this.floor = st.floor != null ? st.floor : FLOOR;
      this.pitch = st.pitch != null ? st.pitch : Math.PI / 2;
    } else if (st.k === 'grip') {
      this.grip = st.open ? GRIP_OPEN : GRIP_CLOSED;
      this.emit('grip', st.open);
    } else if (st.k === 'dyn') {
      // re-plan at execution time (closed loop, e.g. re-aiming a push); fn returns steps or null
      const more = st.fn(this);
      if (more && more.length) P.steps.splice(P.i + 1, 0, ...more);
      this.nextStep();
    }
  }

  tickPlan(dt) {
    const P = this.plan, st = P.steps[P.i];
    P.t += dt;
    if (st.k === 'move') {
      const u = Math.min(1, P.t / st.T), e = u * u * (3 - 2 * u);  // ease in/out along the path
      const s = e * st.len, L = st.L;
      let k = 1; while (k < L.length - 1 && L[k] < s) k++;
      const a = st.pts[k - 1], b = st.pts[k], seg = L[k] - L[k - 1] || 1, f = Math.min(1, Math.max(0, (s - L[k - 1]) / seg));
      this.setTarget(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
      if (u >= 1) {
        // wait for the real arm to catch up (or give up after a while)
        const tip = this.actualTip(this._p);
        const close = dist(tip, this.target) < (st.settle ? 0.004 : 0.012);
        if (close || P.t > st.T + (st.settle ? 1.6 : 0.6)) this.nextStep();
      }
    } else if (st.k === 'grip') {
      if (P.t >= (st.t || 0)) this.nextStep();
    } else if (st.k === 'wait') {
      if (P.t >= st.t) this.nextStep();
    }
  }

  busy() { return !!this.plan; }
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
// wrap angle into [-p/2, p/2) for period p
function wrap(a, p) { a = ((a % p) + p) % p; return a >= p / 2 ? a - p : a; }
