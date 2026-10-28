// SO-101 kinematics + inverse kinematics (pure JS, no allocations per call).
// The kinematic chain is read from the compiled MuJoCo model, so it always matches the MJCF.
// Works in the browser and in node (tests/ik.test.mjs).
//
// IK: damped least squares on the gripper site position (primary task, pan/lift/elbow/wrist_flex)
// plus a secondary "approach pitch" task projected into the null space of the primary one,
// so the gripper keeps pointing sensibly (default: straight down) whenever the position allows.
// Joint limits are respected (clamping + locking joints that sit on a limit).

export const ARM_JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];

// Plain-data description of the arm, extracted from an MjModel.
export function chainFromModel(mj, m) {
  const O = mj.mjtObj;
  const id = (t, n) => mj.mj_name2id(m, O[t].value, n);
  const jids = ARM_JOINTS.map((n) => id('mjOBJ_JOINT', n));
  const base = id('mjOBJ_BODY', 'base');
  // every body in the arm subtree, in model (topological) order
  const bodies = [];
  const inArm = new Set([base]);
  for (let b = 0; b < m.nbody; b++) {
    if (b === base || inArm.has(m.body_parentid[b])) {
      inArm.add(b);
      const jn = m.body_jntnum[b], ja = m.body_jntadr[b];
      const j = jn > 0 ? jids.indexOf(ja) : -1;
      bodies.push({
        id: b,
        parent: b === base ? -1 : bodies.findIndex((x) => x.id === m.body_parentid[b]),
        pos: Array.from(m.body_pos.subarray(3 * b, 3 * b + 3)),
        quat: Array.from(m.body_quat.subarray(4 * b, 4 * b + 4)),
        joint: j,                                      // index into ARM_JOINTS or -1
        axis: jn > 0 ? Array.from(m.jnt_axis.subarray(3 * ja, 3 * ja + 3)) : null,
        jpos: jn > 0 ? Array.from(m.jnt_pos.subarray(3 * ja, 3 * ja + 3)) : null
      });
    }
  }
  const s = id('mjOBJ_SITE', 'gripperframe');
  const sb = m.site_bodyid[s];
  return {
    bodies,
    basePos: Array.from(m.body_pos.subarray(3 * base, 3 * base + 3)),
    site: {
      body: bodies.findIndex((x) => x.id === sb),
      pos: Array.from(m.site_pos.subarray(3 * s, 3 * s + 3)),
      quat: Array.from(m.site_quat.subarray(4 * s, 4 * s + 4))
    },
    range: jids.map((j) => [m.jnt_range[2 * j], m.jnt_range[2 * j + 1]])
  };
}

// row-major 3x3 from quaternion (w, x, y, z), like mju_quat2Mat
function quat2mat(q, out, o) {
  let [w, x, y, z] = q; const n = Math.hypot(w, x, y, z) || 1; w /= n; x /= n; y /= n; z /= n;
  out[o] = 1 - 2 * (y * y + z * z); out[o + 1] = 2 * (x * y - w * z); out[o + 2] = 2 * (x * z + w * y);
  out[o + 3] = 2 * (x * y + w * z); out[o + 4] = 1 - 2 * (x * x + z * z); out[o + 5] = 2 * (y * z - w * x);
  out[o + 6] = 2 * (x * z - w * y); out[o + 7] = 2 * (y * z + w * x); out[o + 8] = 1 - 2 * (x * x + y * y);
}

export class Kin {
  constructor(chain) {
    this.c = chain;
    const nb = chain.bodies.length;
    this.nb = nb;
    this.xpos = new Float64Array(3 * nb);       // world body positions (z-up, metres)
    this.xmat = new Float64Array(9 * nb);       // world body rotations (row-major)
    this.lmat = new Float64Array(9 * nb);       // body_quat as matrices (constant)
    this.anchor = new Float64Array(3 * 6);      // joint anchors (world)
    this.waxis = new Float64Array(3 * 6);       // joint axes (world)
    this.siteLmat = new Float64Array(9);
    this.sitePos = new Float64Array(3);
    this.siteMat = new Float64Array(9);
    this.lo = new Float64Array(6); this.hi = new Float64Array(6);
    chain.range.forEach((r, i) => { this.lo[i] = r[0]; this.hi[i] = r[1]; });
    chain.bodies.forEach((b, i) => quat2mat(b.quat, this.lmat, 9 * i));
    quat2mat(chain.site.quat, this.siteLmat, 0);
    this._R = new Float64Array(9); this._T = new Float64Array(9);
    // IK scratch
    this.q = new Float64Array(6);
    this.J = new Float64Array(12);  // 3x4
    this.J2 = new Float64Array(4);
    this.A = new Float64Array(9); this.Ai = new Float64Array(9);
    this.Jp = new Float64Array(12); // 4x3 damped pseudo-inverse
    this.N = new Float64Array(16);
    this.dq = new Float64Array(4); this.dq2 = new Float64Array(4); this.v = new Float64Array(4);
    this.mask = new Float64Array(4);
    this.result = { err: 0, pitchErr: 0, reachable: true, iters: 0 };
  }

  // Forward kinematics for joint vector q (6 values: pan, lift, elbow, flex, roll, gripper).
  fk(q) {
    const { bodies } = this.c, P = this.xpos, M = this.xmat, L = this.lmat, R = this._R, T = this._T;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i], o3 = 3 * i, o9 = 9 * i;
      if (b.parent < 0) {
        P[o3] = b.pos[0]; P[o3 + 1] = b.pos[1]; P[o3 + 2] = b.pos[2];
        for (let k = 0; k < 9; k++) M[o9 + k] = L[o9 + k];
      } else {
        const p3 = 3 * b.parent, p9 = 9 * b.parent;
        for (let r = 0; r < 3; r++) {
          P[o3 + r] = P[p3 + r] + M[p9 + 3 * r] * b.pos[0] + M[p9 + 3 * r + 1] * b.pos[1] + M[p9 + 3 * r + 2] * b.pos[2];
          for (let c = 0; c < 3; c++) M[o9 + 3 * r + c] = M[p9 + 3 * r] * L[o9 + c] + M[p9 + 3 * r + 1] * L[o9 + 3 + c] + M[p9 + 3 * r + 2] * L[o9 + 6 + c];
        }
      }
      if (b.joint >= 0) {
        const j = b.joint, a = b.axis, jp = b.jpos, A3 = 3 * j;
        // anchor + world axis
        for (let r = 0; r < 3; r++) {
          this.anchor[A3 + r] = P[o3 + r] + M[o9 + 3 * r] * jp[0] + M[o9 + 3 * r + 1] * jp[1] + M[o9 + 3 * r + 2] * jp[2];
          this.waxis[A3 + r] = M[o9 + 3 * r] * a[0] + M[o9 + 3 * r + 1] * a[1] + M[o9 + 3 * r + 2] * a[2];
        }
        // local rotation about axis (Rodrigues), R = M * Rot
        const th = q[j], c = Math.cos(th), s = Math.sin(th), C = 1 - c, x = a[0], y = a[1], z = a[2];
        R[0] = c + x * x * C; R[1] = x * y * C - z * s; R[2] = x * z * C + y * s;
        R[3] = y * x * C + z * s; R[4] = c + y * y * C; R[5] = y * z * C - x * s;
        R[6] = z * x * C - y * s; R[7] = z * y * C + x * s; R[8] = c + z * z * C;
        for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++)
          T[3 * r + cc] = M[o9 + 3 * r] * R[cc] + M[o9 + 3 * r + 1] * R[3 + cc] + M[o9 + 3 * r + 2] * R[6 + cc];
        for (let k = 0; k < 9; k++) M[o9 + k] = T[k];
        // xpos = anchor - Mnew * jpos
        for (let r = 0; r < 3; r++)
          P[o3 + r] = this.anchor[A3 + r] - (M[o9 + 3 * r] * jp[0] + M[o9 + 3 * r + 1] * jp[1] + M[o9 + 3 * r + 2] * jp[2]);
      }
    }
    // gripper site
    const sb = this.c.site, i3 = 3 * sb.body, i9 = 9 * sb.body, sp = sb.pos, SL = this.siteLmat;
    for (let r = 0; r < 3; r++) {
      this.sitePos[r] = P[i3 + r] + M[i9 + 3 * r] * sp[0] + M[i9 + 3 * r + 1] * sp[1] + M[i9 + 3 * r + 2] * sp[2];
      for (let cc = 0; cc < 3; cc++) this.siteMat[3 * r + cc] = M[i9 + 3 * r] * SL[cc] + M[i9 + 3 * r + 1] * SL[3 + cc] + M[i9 + 3 * r + 2] * SL[6 + cc];
    }
    return this.sitePos;
  }

  // approach direction of the gripper (site x axis), written into out[0..2]
  approach(out) { const S = this.siteMat; out[0] = S[0]; out[1] = S[3]; out[2] = S[6]; return out; }

  clamp(i, v) { return v < this.lo[i] ? this.lo[i] : v > this.hi[i] ? this.hi[i] : v; }

  /**
   * Solve IK. q (length 6) is the seed and receives the solution (roll q[4] and gripper q[5] are kept).
   * target: [x, y, z] (MuJoCo world, metres). pitch: desired angle of the approach below horizontal (rad),
   * or null to ignore orientation. Returns this.result (reused object).
   */
  solve(q, target, pitch = Math.PI / 2, opts) {
    const maxIter = (opts && opts.iters) || 40, tol = (opts && opts.tol) || 4e-4;
    const wPitch = pitch == null ? 0 : (opts && opts.wPitch != null ? opts.wPitch : 1);
    const lam2 = 0.0004;             // damping^2 (0.02 m)
    const J = this.J, J2 = this.J2, A = this.A, Ai = this.Ai, Jp = this.Jp, N = this.N;
    const dq = this.dq, dq2 = this.dq2, mask = this.mask, v = this.v;
    const bp = this.c.basePos;
    for (let i = 0; i < 4; i++) { q[i] = this.clamp(i, q[i]); mask[i] = 1; }
    let err = 1, e2 = 0, it = 0;
    for (; it < maxIter; it++) {
      const p = this.fk(q);
      let ex = target[0] - p[0], ey = target[1] - p[1], ez = target[2] - p[2];
      err = Math.hypot(ex, ey, ez);
      // limit the task-space step so DLS stays in its linear region
      if (err > 0.04) { const k = 0.04 / err; ex *= k; ey *= k; ez *= k; }
      // secondary task: pitch of the approach direction in the arm's vertical plane
      let rx = target[0] - bp[0], ry = target[1] - bp[1]; const rl = Math.hypot(rx, ry);
      if (rl < 0.01) { rx = Math.cos(q[0]); ry = Math.sin(q[0]); } else { rx /= rl; ry /= rl; }
      // n = z x r (horizontal, perpendicular to the radial direction): rotation about n changes pitch
      const nx = -ry, ny = rx;
      const S = this.siteMat, ax = S[0], ay = S[3], az = S[6];
      if (wPitch > 0) {
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const dx = cp * rx, dy = cp * ry, dz = -sp;
        // e2 = n . (a x d)
        e2 = nx * (ay * dz - az * dy) + ny * (az * dx - ax * dz);
      } else e2 = 0;
      if (err < tol && Math.abs(e2) < 2e-3) break;
      // Jacobians for the 4 positioning joints
      for (let j = 0; j < 4; j++) {
        const wx = this.waxis[3 * j], wy = this.waxis[3 * j + 1], wz = this.waxis[3 * j + 2];
        const px = p[0] - this.anchor[3 * j], py = p[1] - this.anchor[3 * j + 1], pz = p[2] - this.anchor[3 * j + 2];
        const m = mask[j];
        J[j] = (wy * pz - wz * py) * m; J[4 + j] = (wz * px - wx * pz) * m; J[8 + j] = (wx * py - wy * px) * m;
        J2[j] = (nx * wx + ny * wy) * m;
      }
      // A = J J^T + lam2 I (3x3), invert
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        let s = 0; for (let k = 0; k < 4; k++) s += J[4 * r + k] * J[4 * c + k];
        A[3 * r + c] = s + (r === c ? lam2 : 0);
      }
      inv3(A, Ai);
      // Jp = J^T Ai (4x3)
      for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++)
        Jp[3 * k + c] = J[k] * Ai[c] + J[4 + k] * Ai[3 + c] + J[8 + k] * Ai[6 + c];
      for (let k = 0; k < 4; k++) dq[k] = Jp[3 * k] * ex + Jp[3 * k + 1] * ey + Jp[3 * k + 2] * ez;
      if (wPitch > 0) {
        // N = I - Jp J
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
          N[4 * r + c] = (r === c ? 1 : 0) - (Jp[3 * r] * J[c] + Jp[3 * r + 1] * J[4 + c] + Jp[3 * r + 2] * J[8 + c]);
        // v = N J2^T ; denom = J2 v
        let den = 0.01, res = e2;
        for (let r = 0; r < 4; r++) { let s = 0; for (let c = 0; c < 4; c++) s += N[4 * r + c] * J2[c]; v[r] = s; den += J2[r] * s; res -= J2[r] * dq[r]; }
        const k2 = wPitch * res / den;
        for (let r = 0; r < 4; r++) dq2[r] = v[r] * k2;
        for (let r = 0; r < 4; r++) dq[r] += dq2[r];
      }
      // apply with a step cap, clamp to limits, lock joints pushed against a limit
      let mx = 0; for (let k = 0; k < 4; k++) mx = Math.max(mx, Math.abs(dq[k]));
      const sc = mx > 0.25 ? 0.25 / mx : 1;
      for (let k = 0; k < 4; k++) {
        const nv = q[k] + dq[k] * sc, cv = this.clamp(k, nv);
        if (cv !== nv) mask[k] = 0.05; else if (mask[k] < 1) mask[k] = Math.min(1, mask[k] * 4);
        q[k] = cv;
      }
    }
    const p = this.fk(q);
    err = Math.hypot(target[0] - p[0], target[1] - p[1], target[2] - p[2]);
    const r = this.result;
    r.err = err; r.pitchErr = Math.abs(e2); r.reachable = err < 0.005; r.iters = it;
    return r;
  }
}

function inv3(a, o) {
  const A = a[0], B = a[1], C = a[2], D = a[3], E = a[4], F = a[5], G = a[6], H = a[7], I = a[8];
  const c0 = E * I - F * H, c1 = F * G - D * I, c2 = D * H - E * G;
  const det = A * c0 + B * c1 + C * c2, id = 1 / det;
  o[0] = c0 * id; o[1] = (C * H - B * I) * id; o[2] = (B * F - C * E) * id;
  o[3] = c1 * id; o[4] = (A * I - C * G) * id; o[5] = (C * D - A * F) * id;
  o[6] = c2 * id; o[7] = (B * G - A * H) * id; o[8] = (A * E - B * D) * id;
}
