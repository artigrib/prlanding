// PR-Bench graders. Missions: the sim's own mission checker (sim/so101/src/missions.js), latched success.
// Behaviour tasks: trajectory metrics over the recorded frames (30 fps of sim time; joints in rad, tip in m).
// Every grader returns { success: bool, progress: 0..1, details: {...} } (bench/SPEC.md "Graders").

const DEG = 180 / Math.PI;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const r2 = (x) => Math.round(x * 100) / 100;

/** Mission: success = the checker reported a win during the episode (incl. the settle time after it). */
export function gradeMission(ep) {
  const last = ep.lastCheck() || {};
  const p = typeof last.progress === 'number' ? last.progress : last.ok ? 0.5 : 0;
  return { success: ep.won, progress: r2(ep.won ? 1 : clamp01(p)), details: { won_at_sim_s: ep.wonAt != null ? r2(ep.wonAt) : null } };
}

/**
 * Wave: count swings of the wrist (wrist_flex, or wrist_roll if that one swings more) while the jaw tip is at least
 * 200 mm above the table. A swing = a monotone move of >= 20° between two turning points (hysteresis 20°).
 * One wave = two swings (out and back). Success: swings within ±1 of 2·N. Progress: 1 − |swings − 2N| / 2N.
 */
export function turningPoints(series, minDeg = 20) {
  // zig-zag with hysteresis: a turning point is confirmed once the value has moved back by >= minDeg
  if (!series.length) return [];
  let hi = 0, lo = 0, dir = 0, cand = 0;
  const pts = [];
  for (let i = 1; i < series.length; i++) {
    const v = series[i].v;
    if (dir === 0) {
      if (v > series[hi].v) hi = i;
      if (v < series[lo].v) lo = i;
      if (series[hi].v - series[lo].v >= minDeg) {
        if (hi > lo) { pts.push(lo); dir = 1; cand = hi; } else { pts.push(hi); dir = -1; cand = lo; }
      }
    } else if (dir === 1) {
      if (v > series[cand].v) cand = i; else if (series[cand].v - v >= minDeg) { pts.push(cand); dir = -1; cand = i; }
    } else if (v < series[cand].v) cand = i; else if (v - series[cand].v >= minDeg) { pts.push(cand); dir = 1; cand = i; }
  }
  if (dir !== 0 && Math.abs(series[cand].v - series[pts[pts.length - 1]].v) >= minDeg) pts.push(cand);
  return pts;
}
/** Swings between consecutive turning points whose both ends are "raised" (series[i].up). */
export function countSwings(series, minDeg = 20) {
  const tp = turningPoints(series, minDeg);
  let n = 0;
  for (let k = 1; k < tp.length; k++) if (series[tp[k - 1]].up && series[tp[k]].up) n++;
  return n;
}
const swingsOf = (frames, j) => countSwings(frames.map((f) => ({ v: f.q[j] * DEG, up: f.tip[2] >= 0.2 })));
export function gradeWave(frames, { waves }) {
  const flex = swingsOf(frames, 3), roll = swingsOf(frames, 4);
  const swings = Math.max(flex, roll), want = 2 * waves;
  const success = Math.abs(swings - want) <= 1;
  return { success, progress: r2(clamp01(1 - Math.abs(swings - want) / want)), details: { swings, waves_counted: r2(swings / 2), wanted: waves, joint: roll > flex ? 'wrist_roll' : 'wrist_flex' } };
}

/** Square in a horizontal plane. In-plane samples: |z − z0| <= 15 mm. Coverage: perimeter checkpoints every 5 mm hit
 *  by a sample within 8 mm. Error: mean distance of in-plane samples within 30 mm of the outline. Success: coverage
 *  >= 0.9 and error <= 6 mm. Progress: coverage × (1 − max(0, error − 6) / 20). */
export function squareCorners({ cx_mm, cy_mm, side_mm, yaw_deg }) {
  const h = side_mm / 2000, a = yaw_deg / DEG, c = Math.cos(a), s = Math.sin(a), cx = cx_mm / 1000, cy = cy_mm / 1000;
  return [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([x, y]) => [cx + c * x - s * y, cy + s * x + c * y]);
}
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function gradeSquare(frames, params) {
  const C = squareCorners(params), z0 = params.z_mm / 1000;
  const pts = frames.filter((f) => Math.abs(f.tip[2] - z0) <= 0.015).map((f) => f.tip);
  const cps = [];
  for (let k = 0; k < 4; k++) {
    const a = C[k], b = C[k + 1], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.005));
    for (let i = 0; i < n; i++) cps.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  }
  // densify the samples (30 fps can skip a few mm at speed): linear interpolation between consecutive in-plane samples
  const dense = [];
  for (let i = 0; i < pts.length; i++) {
    dense.push(pts[i]);
    if (i + 1 < pts.length) {
      const a = pts[i], b = pts[i + 1], dd = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (dd < 0.03) for (let k = 1; k * 0.002 < dd; k++) { const t = (k * 0.002) / dd; dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
  }
  let hit = 0;
  for (const c of cps) if (dense.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= 0.008)) hit++;
  let errSum = 0, errN = 0;
  for (const p of pts) {
    let dmin = Infinity;
    for (let k = 0; k < 4; k++) dmin = Math.min(dmin, distSeg(p, C[k], C[k + 1]));
    if (dmin <= 0.03) { errSum += dmin; errN++; }
  }
  const coverage = cps.length ? hit / cps.length : 0, err_mm = errN ? (errSum / errN) * 1000 : null;
  const success = coverage >= 0.9 && err_mm != null && err_mm <= 6;
  const progress = coverage * (err_mm == null ? 0 : clamp01(1 - Math.max(0, err_mm - 6) / 20));
  return { success, progress: r2(progress), details: { coverage: r2(coverage), mean_error_mm: err_mm == null ? null : r2(err_mm), in_plane_samples: pts.length } };
}

export function gradeBehaviour(grader, frames, params) {
  if (grader === 'wave') return gradeWave(frames, params);
  if (grader === 'square') return gradeSquare(frames, params);
  throw new Error('unknown grader ' + grader);
}
