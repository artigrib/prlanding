// Drawing-mission assist ("robotický kreslíř"), DOM/three-free so it is unit-testable in node.
// - paper-plane mode: the marker tip moves only in the paper plane; the height is fixed by the pen state
// - magnet: gentle pull toward the template line inside a tolerance corridor (help 0 / 1 / 2)
// - speed limit while drawing (the arm keeps up, the line stays clean)

import { TRACE, distToPolyline } from './missions.js';

export const PEN = { down: 0.009, up: 0.04 };             // tip height (m): touching (= table floor, light pressure) / lifted
export const HELP = [                                     // corridor (m) and pull strength per help level
  { corridor: 0, pull: 0 },
  { corridor: 0.008, pull: 0.55 },
  { corridor: 0.014, pull: 0.85 }
];
const V_DRAW = 0.09, V_MOVE = 0.25;                       // m/s: pen down / pen up

/** Closest point of the template polyline to (x, y); writes into out [x, y], returns the distance. */
export function closestOnTemplate(x, y, out, corners = TRACE.corners) {
  let best = Infinity;
  for (let i = 1; i < corners.length; i++) {
    const ax = corners[i - 1][0], ay = corners[i - 1][1], bx = corners[i][0] - ax, by = corners[i][1] - ay;
    const L2 = bx * bx + by * by || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / L2));
    const px = ax + u * bx, py = ay + u * by, d = Math.hypot(x - px, y - py);
    if (d < best) { best = d; out[0] = px; out[1] = py; }
  }
  return best;
}

export class DrawAssist {
  constructor() {
    this.help = 1; this.penDown = true;
    this.goal = new Float64Array(3);    // where the user points (after the magnet)
    this.tgt = new Float64Array(3);     // rate-limited target handed to the IK controller
    this.c = new Float64Array(2);
    this.dev = 0;                       // deviation of the goal from the template (m)
    this.active = false;
  }
  reset(x, y) {
    this.goal[0] = this.tgt[0] = x; this.goal[1] = this.tgt[1] = y;
    this.goal[2] = this.tgt[2] = this.height();
  }
  height() { return this.penDown ? PEN.down : PEN.up; }

  /** Pointer position on the paper (x, y) → goal (magnet applied when the pen is down). */
  point(x, y) {
    const h = HELP[this.help] || HELP[0];
    const d = closestOnTemplate(x, y, this.c);
    if (this.penDown && h.pull > 0 && d < h.corridor) {
      // pull grows toward the line, fades out at the corridor edge (no snapping jump at the border)
      const k = h.pull * (1 - d / h.corridor);
      x += (this.c[0] - x) * k; y += (this.c[1] - y) * k;
    }
    this.goal[0] = x; this.goal[1] = y; this.goal[2] = this.height();
    this.dev = closestOnTemplate(x, y, this.c);
    this.active = true;
    return this.goal;
  }

  /** Advance the rate-limited target toward the goal. Returns this.tgt. */
  step(dt) {
    const v = this.penDown ? V_DRAW : V_MOVE, g = this.goal, t = this.tgt;
    const dx = g[0] - t[0], dy = g[1] - t[1], L = Math.hypot(dx, dy), m = v * dt;
    if (L > m) { t[0] += dx / L * m; t[1] += dy / L * m; } else { t[0] = g[0]; t[1] = g[1]; }
    const dz = g[2] - t[2], mz = 0.15 * dt;                  // lifting / lowering is a separate slow move
    t[2] += Math.abs(dz) > mz ? Math.sign(dz) * mz : dz;
    return t;
  }

  /** Deviation class for the cursor colour: 'ok' (green), 'warn' (orange), 'off'. */
  grade() { return this.dev < 0.003 ? 'ok' : this.dev < 0.008 ? 'warn' : 'off'; }
}

export { distToPolyline };
