// Touch input helpers (coarse pointers): pure, DOM- and three.js-free, so node tests can check them
// (tests/touch.test.mjs). Used by src/ui/gizmo.js, src/ui/cameras.js and src/ux.js.

/** Smallest touch target (CSS px): 44 px (Apple HIG 44 pt, WCAG 2.5.5). Hit radii are half of it. */
export const TOUCH_MIN = 44;
/** The work point (gripper) is kept this far from the side edges: the system back gesture lives there. */
export const EDGE = 24;

/**
 * Which gizmo handle a finger hits. cands: [{ k, d, r }] = handle kind, distance of the finger from the handle's
 * on-screen centre, hit radius (≥ TOUCH_MIN / 2). The nearest centre within its radius wins, so handles that
 * overlap on screen split the overlap fairly instead of the first one in the list taking it all.
 */
export function pickHandle(cands) {
  let best = null;
  for (const c of cands) if (c.d <= c.r && (!best || c.d < best.d)) best = c;
  return best ? best.k : null;
}

/** Distance from (x, y) to the nearest of the points [[x, y], …] (a projected ring). */
export function nearestOnPolyline(pts, x, y) {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
    const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L)) : 0;
    d = Math.min(d, Math.hypot(a[0] + vx * t - x, a[1] + vy * t - y));
  }
  return d;
}

/**
 * Scale factor for the gizmo on touch so the height arrows sit at least `min` px from the ball centre on screen
 * (each arrow then owns a ≥ 44 px hit cell; 4 px spare for the perspective of the lower arrow). px = current
 * on-screen distance; capped at `cap`.
 */
export function touchScale(px, min = TOUCH_MIN + 4, cap = 3) {
  if (!(px > 0)) return cap;
  return Math.max(1, Math.min(cap, min / px));
}

/**
 * Auto-framing: how many px the view should pan sideways so a point at screen x stays ≥ `edge` px from both side
 * edges of a w px wide view. It starts when the point enters the edge band and, while `active` (it started),
 * keeps pulling until the point is `aim` px from the edge (hysteresis: a point already inside is left alone).
 * Returns 0 or the signed px distance to remove (+ = the point is too far right).
 */
export function edgeShift(x, w, active = false, edge = EDGE, aim = 2.5 * EDGE) {
  if (!(w > 2 * aim)) return 0;
  const lo = active ? aim : edge, hi = w - lo;
  if (x < lo) return x - aim;
  if (x > hi) return x - (w - aim);
  return 0;
}

/**
 * Drops: the gripper held an object, is still commanded closed, and the object is no longer between the jaws
 * for `confirm` s (a short flicker while carrying fast is not a drop). Opening the gripper is a release, not a drop.
 * update(held name | null, closed: commanded closed, dt s) → the dropped object's name once, else null.
 */
export class DropWatch {
  constructor(confirm = 0.3) { this.confirm = confirm; this.reset(); }
  reset() { this.prev = null; this.cand = null; this.t = 0; }
  update(held, closed, dt) {
    if (held) { this.prev = held; this.cand = null; return null; }
    if (!closed) { this.reset(); return null; }
    if (this.prev) { this.cand = this.prev; this.prev = null; this.t = 0; }
    if (!this.cand) return null;
    this.t += dt;
    if (this.t < this.confirm) return null;
    const n = this.cand; this.cand = null;
    return n;
  }
}

/** Double tap: a second tap within `ms` and `px` of the first. Returns true for the second tap. */
export function isDoubleTap(prev, cur, ms = 350, px = 40) {
  return !!prev && cur.t - prev.t < ms && Math.hypot(cur.x - prev.x, cur.y - prev.y) < px;
}

// ---------------- trackpad scheme (?touch=pad, src/ui/touchpad.js) ----------------

/**
 * Numbers of the trackpad scheme (touch audit, option A):
 *   gain: 0.25 mm per px below 150 px/s, rising smoothly to 1.2 mm per px at 900 px/s and above (pointer ballistics)
 *   tap: < 8 px and < 300 ms · rail 0.4 mm/px, detents capture ±2 mm · wrist strip 0.5°/px, a detent every 15°
 *   (capture ±1°), "lícuje" within 3° of the selected object's faces (the magnet pulls it to 0°)
 */
export const PAD = { slow: 0.25, fast: 1.2, v0: 150, v1: 900, tapPx: 8, tapMs: 300, rail: 0.4, railBand: 0.002, railStep: 0.01,
  scrub: 0.5, detent: 15, detentBand: 1, align: 3 };

/** mm of gripper motion per px of finger motion at finger speed v (px/s) */
export function padGain(v) {
  if (!(v > PAD.v0)) return PAD.slow;
  if (v >= PAD.v1) return PAD.fast;
  const k = (v - PAD.v0) / (PAD.v1 - PAD.v0), s = k * k * (3 - 2 * k);
  return PAD.slow + (PAD.fast - PAD.slow) * s;
}

/** finger speed (px/s), smoothed over the last few events; times in ms (event timeStamp) */
export class Speed {
  constructor(tau = 60) { this.tau = tau; this.v = 0; this.t = null; }
  reset(t) { this.v = 0; this.t = t; }
  update(d, t) {
    if (this.t == null) { this.t = t; return this.v; }
    const dt = Math.max(1, t - this.t); this.t = t;
    const a = 1 - Math.exp(-dt / this.tau);
    this.v += (d / dt * 1000 - this.v) * a;
    return this.v;
  }
}

/**
 * Finger motion (px, screen: x right, y down) → table motion (m, MuJoCo x/y) relative to the camera: finger up moves
 * the gripper away from the camera, right moves it to the camera's right. f = camera forward on the table [fx, fy].
 */
export function tableDelta(dx, dy, mmPerPx, f) {
  const L = Math.hypot(f[0], f[1]) || 1, ux = f[0] / L, uy = f[1] / L, k = mmPerPx / 1000;
  return [k * (uy * dx - ux * dy), k * (-ux * dx - uy * dy)];
}

/**
 * Gesture of one contact so far: 'tap' (lifted within tapPx and tapMs), 'drag' (moved beyond tapPx),
 * 'press' (still down, not moved), 'long' (lifted without moving after tapMs: no action).
 */
export function classify(dist, ms, up) {
  if (dist > PAD.tapPx) return 'drag';
  if (!up) return 'press';
  return ms <= PAD.tapMs ? 'tap' : 'long';
}

/**
 * Height rail: raw height (m, the finger's relative motion summed) → the commanded height, snapped to a detent when
 * within the capture band. Returns { z, at } with at = the detent index or -1.
 */
export function railSnap(raw, detents, band = PAD.railBand) {
  let at = -1, best = band;
  for (let i = 0; i < detents.length; i++) { const d = Math.abs(raw - detents[i]); if (d <= best) { best = d; at = i; } }
  return { z: at >= 0 ? detents[at] : raw, at };
}

/** wrap an angle (deg) into (-period/2, period/2] */
export function wrapDeg(a, period = 360) { a = ((a % period) + period) % period; return a > period / 2 ? a - period : a; }

/**
 * Wrist strip: raw roll (deg) → { r, mis, aligned, detent }. off = the jaws' misalignment with the selected object's
 * faces at this raw roll (deg, null without a selection), period = the object's symmetry (90° cube, 180° otherwise).
 * Within PAD.align of square the magnet sets the roll so the misalignment is 0 ("Lícuje ✓"); otherwise the roll
 * sticks to multiples of 15° within ±1° (a detent).
 */
export function scrubSnap(raw, off, period = 90) {
  if (off != null) {
    const mis = wrapDeg(off, period);
    if (Math.abs(mis) <= PAD.align) return { r: raw - mis, mis: 0, aligned: true, detent: null };
  }
  const k = Math.round(raw / PAD.detent), d = raw - k * PAD.detent;
  if (Math.abs(d) <= PAD.detentBand) return { r: k * PAD.detent, mis: off == null ? null : wrapDeg(off - d, period), aligned: false, detent: k };
  return { r: raw, mis: off == null ? null : wrapDeg(off, period), aligned: false, detent: null };
}
