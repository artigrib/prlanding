// Physics grab ("tah rukou"): pull any part of the arm and the whole chain gives way, like a real arm
// pulled by hand. Same idea as MuJoCo's `simulate` perturbation (mjvPerturb): a spring-damper force at the
// grab point toward the cursor, applied through d.xfrc_applied. While grabbed the servos are made compliant
// (back-driven): low position gain, their reference slowly follows the actual pose, gravity is compensated so
// the arm does not sag, joint damping / friction / limits stay → weighty, not floppy, end-stops are felt.
// On release the reference is the current pose and the stiffness blends back in → the arm holds where you left it.
// DOM/three-free (unit-tested in node: tests/grab.test.mjs).

const OMEGA = 2 * Math.PI * 3.2;   // spring natural frequency (rad/s) for the grabbed body's subtree mass
const ZETA = 0.75;                 // damping ratio of the grab spring
const F_MAX = 12;                  // N, force cap (fast flicks stay stable)
const SOFT = 0.015;                // servo stiffness while grabbed (× normal)
const FOLLOW = 30;                // 1/s, how fast the soft servo reference follows (kp·SOFT/FOLLOW = felt damping)
const SOFT_KV = 0.05;              // servo velocity damping while grabbed (× normal); joint damping stays
const BLEND = 0.3;                 // s, stiffness blend-in after release

export class Grab {
  constructor(mj, m, d, actIds) {
    this.mj = mj; this.m = m; this.d = d; this.act = actIds;
    this.kp0 = actIds.map((a) => m.actuator_gainprm[10 * a]);
    this.kv0 = actIds.map((a) => m.actuator_biasprm[10 * a + 2]);
    this.qadr = actIds.map((a) => m.jnt_qposadr[m.actuator_trnid[2 * a]]);
    this.dadr = actIds.map((a) => m.jnt_dofadr[m.actuator_trnid[2 * a]]);
    this.lo = actIds.map((a) => m.jnt_range[2 * m.actuator_trnid[2 * a]]);
    this.hi = actIds.map((a) => m.jnt_range[2 * m.actuator_trnid[2 * a] + 1]);
    this.body = -1; this.local = new Float64Array(3);
    this.p = new Float64Array(3); this.pPrev = new Float64Array(3); this.target = new Float64Array(3);
    this.force = 0; this.atLimit = -1; this.blend = 1;
    this.active = false;
  }

  /** Grab body b at world point (x, y, z); the point is stored in the body frame. */
  start(b, x, y, z) {
    const d = this.d, P = d.xpos, R = d.xmat, o3 = 3 * b, o9 = 9 * b;
    const rx = x - P[o3], ry = y - P[o3 + 1], rz = z - P[o3 + 2];
    // local = R^T r (xmat is row-major)
    this.local[0] = R[o9] * rx + R[o9 + 3] * ry + R[o9 + 6] * rz;
    this.local[1] = R[o9 + 1] * rx + R[o9 + 4] * ry + R[o9 + 7] * rz;
    this.local[2] = R[o9 + 2] * rx + R[o9 + 5] * ry + R[o9 + 8] * rz;
    this.body = b; this.active = true; this.blend = 0;
    this.point(this.p); this.pPrev.set(this.p); this.target.set(this.p);
    // pulling any link drags the chain behind it: use at least half the arm's mass as the effective mass
    const mass = Math.max(0.45, this.m.body_subtreemass[b]);
    this.k = mass * OMEGA * OMEGA;
    this.c = 2 * ZETA * Math.sqrt(this.k * mass);
    // compliant servos: reference = current pose, low stiffness (damping kept)
    const c = d.ctrl, q = d.qpos;
    for (let i = 0; i < this.act.length; i++) { c[this.act[i]] = q[this.qadr[i]]; this.gain(i, SOFT); }
  }
  setTarget(x, y, z) { this.target[0] = x; this.target[1] = y; this.target[2] = z; }

  /** world position of the grab point into out */
  point(out) {
    const b = this.body, P = this.d.xpos, R = this.d.xmat, o3 = 3 * b, o9 = 9 * b, l = this.local;
    out[0] = P[o3] + R[o9] * l[0] + R[o9 + 1] * l[1] + R[o9 + 2] * l[2];
    out[1] = P[o3 + 1] + R[o9 + 3] * l[0] + R[o9 + 4] * l[1] + R[o9 + 5] * l[2];
    out[2] = P[o3 + 2] + R[o9 + 6] * l[0] + R[o9 + 7] * l[1] + R[o9 + 8] * l[2];
    return out;
  }

  gain(i, s) {
    const a = this.act[i], g = this.m.actuator_gainprm, bp = this.m.actuator_biasprm, kp = this.kp0[i] * s;
    g[10 * a] = kp; bp[10 * a + 1] = -kp;
    // velocity damping goes soft together with the stiffness (SOFT → SOFT_KV, 1 → 1)
    const kvS = SOFT_KV + (1 - SOFT_KV) * (s - SOFT) / (1 - SOFT);
    bp[10 * a + 2] = this.kv0[i] * Math.max(SOFT_KV, Math.min(1, kvS));
  }

  /** Before physics (each frame or each step). dt = time since the last call. */
  apply(dt) {
    const d = this.d, m = this.m;
    if (!this.active) {
      if (this.blend < 1) {          // stiffness blends back in after release
        this.blend = Math.min(1, this.blend + dt / BLEND);
        const e = this.blend * this.blend, s = SOFT + (1 - SOFT) * e;
        const qf = this.d.qfrc_applied, bias = this.d.qfrc_bias;
        for (let i = 0; i < this.act.length; i++) {
          this.gain(i, s);
          qf[this.dadr[i]] = this.blend < 1 ? bias[this.dadr[i]] * (1 - e) : 0;   // no sag while stiffening
        }
      }
      return;
    }
    if (!(dt > 0)) return;
    const p = this.point(this.p), t = this.target, b = this.body;
    let fx = 0, fy = 0, fz = 0;
    const vx = (p[0] - this.pPrev[0]) / dt, vy = (p[1] - this.pPrev[1]) / dt, vz = (p[2] - this.pPrev[2]) / dt;
    fx = this.k * (t[0] - p[0]) - this.c * vx; fy = this.k * (t[1] - p[1]) - this.c * vy; fz = this.k * (t[2] - p[2]) - this.c * vz;
    let F = Math.hypot(fx, fy, fz);
    if (!Number.isFinite(F)) { fx = fy = fz = 0; F = 0; }
    if (F > F_MAX) { const s = F_MAX / F; fx *= s; fy *= s; fz *= s; F = F_MAX; }
    this.force = F;
    this.pPrev.set(p);
    // force at the grab point = force + torque about the body's centre of mass (xfrc_applied acts at xipos)
    const X = d.xfrc_applied, ip = d.xipos, o = 6 * b;
    const rx = p[0] - ip[3 * b], ry = p[1] - ip[3 * b + 1], rz = p[2] - ip[3 * b + 2];
    X[o] = fx; X[o + 1] = fy; X[o + 2] = fz;
    X[o + 3] = ry * fz - rz * fy; X[o + 4] = rz * fx - rx * fz; X[o + 5] = rx * fy - ry * fx;
    // back-driven servos: gravity compensated (no sag), reference trails the pose, limits reported
    const c = d.ctrl, q = d.qpos, qf = d.qfrc_applied, bias = d.qfrc_bias, k = Math.min(1, FOLLOW * dt);
    this.atLimit = -1;
    for (let i = 0; i < this.act.length; i++) {
      const qi = q[this.qadr[i]];
      qf[this.dadr[i]] = bias[this.dadr[i]];
      c[this.act[i]] += (qi - c[this.act[i]]) * k;
      if (qi < this.lo[i] + 0.01 || qi > this.hi[i] - 0.01) this.atLimit = i;
    }
  }

  /** Let go: the current pose becomes the servo reference, forces off, stiffness blends back. */
  release() {
    if (!this.active) return;
    const d = this.d, X = d.xfrc_applied, o = 6 * this.body;
    for (let k = 0; k < 6; k++) X[o + k] = 0;
    for (let i = 0; i < this.act.length; i++) d.ctrl[this.act[i]] = d.qpos[this.qadr[i]];
    this.active = false; this.body = -1; this.force = 0; this.blend = 0;
  }
}
