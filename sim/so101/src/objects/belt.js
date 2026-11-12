// Slat conveyor of the 'conveyor' scene profile (src/objects/scene.js BELT): runtime. DOM/three-free.
//
// Each slat is a body on a slide joint along y. Before every mj_step, step(dt) ramps the belt speed toward
// `speed` (at most BELT.accel m/s²), puts every slat at its exact place behind slat 0 (no drift, gaps stay
// BELT.gap) and sets its joint velocity, so contact friction sees the real relative velocity and items ride the
// belt like on a table that moves. A mocap plate could not do this: a mocap body has no DOFs, the contact solver
// sees it standing still.
// A slat whose centre has passed the head drum (y1) has turned down around the drum: its geom stops colliding and is
// not drawn, so what it carried drops into the end tote. Half a pitch later it wraps back to the tail (empty).
//
//   const belt = Belt.of(mj, m, d);     // null in the plain and objects scenes; one instance per MjData
//   belt.speed = 0.02;                  // m/s target; 0 = pause (ramped, see BELT.accel)
//   each physics step: belt.step(m.opt.timestep); mj.mj_step(m, d);

import { BELT } from './scene.js';

const CACHE = new WeakMap();

export class Belt {
  /** The belt of a compiled model, or null if it has no slats. Cached per MjData (ArmSim and World share it). */
  static of(mj, m, d) {
    if (CACHE.has(d)) return CACHE.get(d);
    const b = mj.mj_name2id(m, mj.mjtObj.mjOBJ_BODY.value, 'slat0') < 0 ? null : new Belt(mj, m, d);
    CACHE.set(d, b);
    return b;
  }

  constructor(mj, m, d, cfg = BELT) {
    this.mj = mj; this.m = m; this.d = d; this.cfg = cfg;
    const O = mj.mjtObj;
    this.slats = [];
    for (let i = 0; ; i++) {
      const b = mj.mj_name2id(m, O.mjOBJ_BODY.value, 'slat' + i);
      if (b < 0) break;
      const j = m.body_jntadr[b], g = m.body_geomadr[b];
      this.slats.push({ body: b, q: m.jnt_qposadr[j], v: m.jnt_dofadr[j], geom: g, y: m.body_pos[3 * b + 1],
        ct: m.geom_contype[g], ca: m.geom_conaffinity[g], on: true });
    }
    if (!this.slats.length) throw new Error('no slats in the model');
    this.n = this.slats.length;
    this.lo = cfg.y0 - cfg.pitch / 2;            // slat centres cycle through [lo, lo + P)
    this.P = this.n * cfg.pitch;
    this.speed = 0;                              // target (m/s)
    this._v = d.qvel[this.slats[0].v]; this._t = null;
    this.accel = cfg.accel;
    this.wraps = 0;
    this.onWrap = null;                          // (slat index) => void, just before a slat jumps to the tail
    this.sync();
  }

  /** Belt velocity (m/s) commanded in the last step. Follows the physics state only when that was replaced
   *  (keyframe reset, snapshot restore: d.time is not one timestep after the last step()); otherwise the solver's
   *  per-step deviation is not fed back. (Comparing velocities instead let an item wedged against a rail, which
   *  slows the slats by more than 1 mm/s, read as a reset every step and stall the belt for good.) */
  get v() {
    const d = this.d, q = d.qvel[this.slats[0].v];
    if (this._t == null) return q;
    const t = d.time - this._t;
    return t >= 0 && t <= this.m.opt.timestep * 1.5 ? this._v : q;
  }
  get moving() { return Math.abs(this.v) > 1e-6; }
  pause() { this.speed = 0; }

  /** World y of slat i's centre. */
  centre(i) { const s = this.slats[i]; return s.y + this.d.qpos[s.q]; }
  /** Is slat i carrying (in contact range, drawn)? */
  carrying(i) { return this.slats[i].on; }

  wrapY(c) { const P = this.P; return this.lo + ((((c - this.lo) % P) + P) % P); }

  /** Before each mj_step. dt = the MuJoCo timestep. */
  step(dt) {
    const d = this.d, S = this.slats, pitch = this.cfg.pitch;
    let v = this.v;
    const dv = this.speed - v, lim = this.accel * dt;
    v += Math.abs(dv) <= lim ? dv : Math.sign(dv) * lim;
    if (Math.abs(v) < 1e-9) v = 0;
    const c0 = S[0].y + d.qpos[S[0].q];
    for (let i = 0; i < this.n; i++) {
      const s = S[i], prev = s.y + d.qpos[s.q];
      const c = this.wrapY(c0 + i * pitch);
      if (Math.abs(c - prev) > this.P / 2) { this.wraps++; if (this.onWrap) this.onWrap(i); }
      d.qpos[s.q] = c - s.y; d.qvel[s.v] = v;
    }
    this._v = v; this._t = d.time;   // step() runs just before mj_step
    this.contacts();
  }

  /** Slat contacts on/off by position (after a reset or restore too). */
  contacts() {
    const m = this.m, y1 = this.cfg.y1;
    for (const s of this.slats) {
      const on = s.y + this.d.qpos[s.q] < y1;
      if (on === s.on) continue;
      s.on = on;
      m.geom_contype[s.geom] = on ? s.ct : 0; m.geom_conaffinity[s.geom] = on ? s.ca : 0;
    }
  }

  /** Re-read the state after mj_resetData* / a snapshot restore (contacts follow the slat positions). */
  sync() { for (const s of this.slats) s.on = !(s.y + this.d.qpos[s.q] < this.cfg.y1); this.contacts(); }

  /** Largest gap (m) between neighbouring slats, from the current joint positions (after the physics step). */
  maxGap() {
    const sz = this.m.geom_size;
    const spans = this.slats.map((s, i) => { const y = this.centre(i), h = sz[3 * s.geom + 1]; return [y - h, y + h]; }).sort((a, b) => a[0] - b[0]);
    let g = 0;
    for (let i = 1; i < spans.length; i++) g = Math.max(g, spans[i][0] - spans[i - 1][1]);
    return g;
  }

  /** Where a world point is relative to the belt: 'entry' (first BELT.entry m), 'belt', 'tote' or null. */
  zone(p) {
    const B = this.cfg, T = B.tote;
    if (Math.abs(p[0] - B.x) <= T.hx && p[1] >= T.y0 && p[1] <= T.y1 && p[2] < 0) return 'tote';
    if (Math.abs(p[0] - B.x) <= B.hw && p[1] >= B.y0 - B.pitch && p[1] <= B.y1 + B.pitch / 2 && p[2] > 0 && p[2] < 0.15) {
      return p[1] < B.y0 + B.entry ? 'entry' : 'belt';
    }
    return null;
  }
}
