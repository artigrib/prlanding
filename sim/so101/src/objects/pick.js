// Top-down pick for library objects with the SO-101 (no dependency on the mission code).
// IK: damped least squares with a finite-difference Jacobian, evaluated with mj_kinematics on a scratch MjData,
// so it always matches the compiled MJCF. Tasks: gripper-site position (3), approach axis pointing down (1),
// jaw closing axis across the object's narrow side (1) -> joints shoulder_pan .. wrist_roll (5).
//
// Gripper facts (from so101.xml, checked in test/objects.test.mjs): the gripperframe site's x axis is the approach
// direction, its z axis the jaw closing direction; the fixed jaw sits ~16 mm behind the site along -z.

export const ARM = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
const FIXED_JAW = 0.016;
export const GRIP_OPEN = 1.2, GRIP_CLOSED = -0.17;

export function armIds(mj, m) {
  const O = mj.mjtObj;
  const jnt = ARM.map((n) => mj.mj_name2id(m, O.mjOBJ_JOINT.value, n));
  return {
    qadr: jnt.map((j) => m.jnt_qposadr[j]),
    range: jnt.map((j) => [m.jnt_range[2 * j], m.jnt_range[2 * j + 1]]),
    act: ARM.map((n) => mj.mj_name2id(m, O.mjOBJ_ACTUATOR.value, n)),
    site: mj.mj_name2id(m, O.mjOBJ_SITE.value, 'gripperframe')
  };
}

// residual vector for joint vector q (5 arm joints) -> r[5]
function residual(mj, m, s, ids, q, tgt, perp, r) {
  for (let i = 0; i < 5; i++) s.qpos[ids.qadr[i]] = q[i];
  mj.mj_kinematics(m, s);
  const p = 3 * ids.site, R = 9 * ids.site, x = s.site_xpos, M = s.site_xmat;
  r[0] = x[p] - tgt[0]; r[1] = x[p + 1] - tgt[1]; r[2] = x[p + 2] - tgt[2];
  r[3] = 0.05 * (M[R + 6] + 1);                              // approach axis (x column) z-component -> -1
  r[4] = 0.03 * (M[R + 2] * perp[0] + M[R + 5] * perp[1]);   // closing axis (z column) _|_ perp
  return r;
}

// Solve for a gripper-site target. closeDir: horizontal unit vector the jaws should close along.
export function solveIK(mj, m, scratch, ids, target, closeDir, q0) {
  const q = Float64Array.from(q0.slice(0, 5));
  const perp = [-closeDir[1], closeDir[0]];
  const r = new Float64Array(5), r2 = new Float64Array(5), J = new Float64Array(25);
  const h = 1e-4;
  let err = Infinity;
  for (let it = 0; it < 60; it++) {
    residual(mj, m, scratch, ids, q, target, perp, r);
    err = Math.hypot(...r);
    if (err < 5e-4) break;
    for (let j = 0; j < 5; j++) {
      const old = q[j]; q[j] = old + h;
      residual(mj, m, scratch, ids, q, target, perp, r2);
      q[j] = old;
      for (let i = 0; i < 5; i++) J[5 * i + j] = (r2[i] - r[i]) / h;
    }
    // dq = -J^T (J J^T + l I)^-1 r
    const A = new Float64Array(25), lam = 1e-4;
    for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) {
      let s = 0; for (let j = 0; j < 5; j++) s += J[5 * i + j] * J[5 * k + j];
      A[5 * i + k] = s + (i === k ? lam : 0);
    }
    const y = solve5(A, r);
    for (let j = 0; j < 5; j++) {
      let s = 0; for (let i = 0; i < 5; i++) s += J[5 * i + j] * y[i];
      const [lo, hi] = ids.range[j];
      q[j] = Math.min(hi, Math.max(lo, q[j] - Math.max(-0.3, Math.min(0.3, s))));
    }
  }
  const posErr = Math.hypot(r[0], r[1], r[2]);
  return { q: Array.from(q), err, posErr };
}

function solve5(A, b) { // Gaussian elimination with partial pivoting (5x5)
  const n = 5, M = Array.from({ length: n }, (_, i) => [...A.slice(n * i, n * i + n), b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    [M[c], M[p]] = [M[p], M[c]];
    for (let i = c + 1; i < n; i++) { const f = M[i][c] / M[c][c]; for (let k = c; k <= n; k++) M[i][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k]; x[i] = s / M[i][i]; }
  return x;
}

// Grasp plan for a body in its CURRENT pose (it may have toppled): grasp across the narrowest body axis that
// lies roughly horizontal, at ~45 % of the world-frame height (max 3 cm up).
// flip: use the opposite closing direction (the jaws are asymmetric, so both sides are worth trying).
export function graspTargets(mj, m, d, bodyId, sizeM, flip = false) {
  const R = 9 * bodyId, xm = d.xmat, c = d.xipos;           // body COM (world) + orientation
  let dir = null, w = Infinity;
  for (let k = 0; k < 3; k++) {                            // body axis k in world = column k of xmat
    const h = [xm[R + k], xm[R + 3 + k]], hn = Math.hypot(h[0], h[1]);
    if (hn > 0.7 && sizeM[k] < w) { w = sizeM[k]; dir = [h[0] / hn, h[1] / hn]; }
  }
  if (!dir) { dir = [1, 0]; w = Math.min(sizeM[0], sizeM[1]); }
  if ((dir[0] * c[3 * bodyId] + dir[1] * c[3 * bodyId + 1] < 0) !== flip) dir = [-dir[0], -dir[1]];
  // world-frame vertical extent of the (body-frame) bounding box, centred on the COM height
  let hz = 0;
  for (let k = 0; k < 3; k++) hz += Math.abs(xm[R + 6 + k]) * sizeM[k] / 2;
  const z0 = Math.max(0, c[3 * bodyId + 2] - hz), zTop = c[3 * bodyId + 2] + hz;
  const zg = Math.max(0.012, Math.min(z0 + Math.min(0.45 * (zTop - z0), 0.03), zTop - 0.012));
  const off = FIXED_JAW - w / 2;                            // site = centre + (c - w/2) * closeDir
  const cx = c[3 * bodyId], cy = c[3 * bodyId + 1];
  const grasp = [cx + off * dir[0], cy + off * dir[1], zg];
  return { dir, width: w, grasp, above: [grasp[0], grasp[1], zTop + 0.035], lift: [grasp[0], grasp[1], zg + 0.08] };
}

function closingAxisOk(mj, m, s, ids, q, dir) {
  for (let i = 0; i < 5; i++) s.qpos[ids.qadr[i]] = q[i];
  mj.mj_kinematics(m, s);
  const R = 9 * ids.site, M = s.site_xmat;
  return M[R + 2] * dir[0] + M[R + 5] * dir[1] > 0.7;
}

// Scripted pick: returns a stepper(dt) that writes ctrl targets and reports the phase.
export function makePick(mj, m, d, ids, bodyId, sizeM) {
  const scratch = new mj.MjData(m);
  for (let i = 0; i < m.nq; i++) scratch.qpos[i] = d.qpos[i];
  const cur = ids.act.map((a) => d.ctrl[a]);
  let best = null;
  for (const flip of [false, true]) {
    const T = graspTargets(mj, m, d, bodyId, sizeM, flip);
    const ik = (p, q0) => solveIK(mj, m, scratch, ids, p, T.dir, q0);
    const a = ik(T.above, cur), g = ik(T.grasp, a.q), l = ik(T.lift, g.q);
    const ok = a.posErr < 0.02 && g.posErr < 0.006 && l.posErr < 0.02 && closingAxisOk(mj, m, scratch, ids, g.q, T.dir);
    const score = (ok ? 0 : 10) + g.posErr;
    if (!best || score < best.score) best = { T, a, g, l, ok, score };
  }
  scratch.delete();
  const { T, a, g, l } = best;
  const steps = [
    { q: [...a.q, GRIP_OPEN], t: 1.4, phase: 'approach' },
    { q: [...g.q, GRIP_OPEN], t: 1.0, phase: 'descend' },
    { q: [...g.q, GRIP_CLOSED], t: 0.8, phase: 'close' },
    { q: [...l.q, GRIP_CLOSED], t: 1.2, phase: 'lift' },
    { q: [...l.q, GRIP_CLOSED], t: 0.8, phase: 'hold' }
  ];
  let i = 0, t = 0, from = cur;
  const step = (dt) => {
    if (i >= steps.length) return 'done';
    const s = steps[i]; t += dt;
    const k = Math.min(1, t / s.t), e = k * k * (3 - 2 * k);
    for (let j = 0; j < 6; j++) {
      const lo = m.actuator_ctrlrange[2 * ids.act[j]], hi = m.actuator_ctrlrange[2 * ids.act[j] + 1];
      d.ctrl[ids.act[j]] = Math.min(hi, Math.max(lo, from[j] + (s.q[j] - from[j]) * e));
    }
    if (k >= 1) { from = s.q; i++; t = 0; }
    return i >= steps.length ? 'done' : steps[i].phase;
  };
  return { step, reachable: best.ok, targets: T, ik: { above: a, grasp: g, lift: l } };
}
