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
