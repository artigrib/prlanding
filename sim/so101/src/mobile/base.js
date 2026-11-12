// Driving the cart (lab-transport campaign PR 2, design: campaign "Převoz mezi laboratořemi" §3.1, §4.1).
// Pure: no DOM, no three.js, no MuJoCo (node tests import it directly).
//
// The command path, once per physics step (core.js ArmSim.preStep):
//   keys → body-frame target (u forward m/s, v left m/s, w rad/s) at the chosen speed level
//        → LeRobot clamp (port of LeKiwi._body_to_wheel_raw: every wheel ≤ max_raw ticks/s, all three scaled down
//          together, so the direction of travel is kept)
//        → ramp (3 m/s² linear, 6 rad/s² angular)
//        → world frame: ctrl[base_vx, base_vy] = R(yaw)·(u, v), ctrl[base_wz] = w (src/mobile/scene.js actuators).
//
// Sources:
// - LeRobot (github.com/huggingface/lerobot @ e6ffde60, Apache-2.0, NOTICE.txt §7):
//   src/lerobot/robots/lekiwi/lekiwi.py `_body_to_wheel_raw` (max_raw 3000, steps_per_deg 4096 / 360, proportional
//   scaling) and `_degps_to_raw` (int(round(·)), clamp ±0x7FFF); lekiwi_client.py `speed_levels`
//   (xy 0.1 / 0.2 / 0.3 m/s, theta 30 / 60 / 90 °/s), the key directions (forward/backward = ±x, left/right = ±y,
//   rotate_left/right = ±theta, summed per key) and theta in deg/s.
// - The ramp is a game parameter, not a measured property of the real robot: LeRobot sets no acceleration register
//   on the wheel servos (lekiwi.py sets only the velocity mode), and the STS3215 acceleration in that mode is not
//   documented. Design doc §3.1 chose 3 m/s² and 6 rad/s²: at 3 m/s² straight starts tilt the cart-rack vials by
//   1.4–2.3° in the prototype (§4.1 table).

import { wheelSpeeds } from './scene.js';

/** LeRobot lekiwi_client.py speed_levels (xy m/s, theta °/s). */
export const SPEED_LEVELS = [{ xy: 0.1, theta: 30 }, { xy: 0.2, theta: 60 }, { xy: 0.3, theta: 90 }];
/** Ramp limits (design §3.1; a labelled game parameter, see above). */
export const RAMP = { lin: 3, ang: 6 };
/** lekiwi.py _body_to_wheel_raw defaults. */
export const LEROBOT = { maxRaw: 3000, stepsPerDeg: 4096 / 360, rawMax: 0x7FFF };

const DEG = Math.PI / 180;

// Python's round(): halves go to the even neighbour (JavaScript's Math.round rounds them up)
function pyRound(x) {
  const f = Math.floor(x), r = x - f;
  if (r > 0.5) return f + 1;
  if (r < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Port of LeKiwi._degps_to_raw: wheel deg/s → Goal_Velocity ticks (sign-magnitude, at most 0x7FFF either way). */
export function degpsToRaw(degps) {
  const v = pyRound(degps * LEROBOT.stepsPerDeg);
  return Math.max(-LEROBOT.rawMax, Math.min(LEROBOT.rawMax, v));
}

/**
 * Port of LeKiwi._body_to_wheel_raw (lekiwi.py @ e6ffde60): body velocity x, y (m/s), theta (deg/s, as LeRobot)
 * → raw wheel commands [left, back, right] in ticks/s. If any wheel exceeds max_raw, all three are scaled down by the
 * same factor. The matrix itself is wheelSpeeds() in scene.js (the PR 1 port of the same function).
 */
export function bodyToWheelRaw(x, y, thetaDeg, maxRaw = LEROBOT.maxRaw) {
  const w = wheelSpeeds(x, y, thetaDeg * DEG), degps = w.map((r) => r / DEG);
  const top = Math.max(...degps.map((d) => Math.abs(d) * LEROBOT.stepsPerDeg));
  const s = top > maxRaw ? maxRaw / top : 1;
  return degps.map((d) => degpsToRaw(d * s));
}

/**
 * The same clamp in the body frame: the command the real driver would carry out (u, v m/s, w rad/s) and the scale
 * it applied (1 = within limits). Unrounded: the sim drives continuous velocity actuators, not 1-tick steps.
 */
export function clampBody(u, v, w, maxRaw = LEROBOT.maxRaw) {
  const ws = wheelSpeeds(u, v, w);
  const top = Math.max(...ws.map((r) => Math.abs(r) / DEG * LEROBOT.stepsPerDeg));
  const s = top > maxRaw ? maxRaw / top : 1;
  return { u: u * s, v: v * s, w: w * s, scale: s };
}

/** Top speeds the clamp allows along each axis alone (derived from the LeRobot numbers, design §1.2). */
export function topSpeeds() {
  const rim = LEROBOT.maxRaw / LEROBOT.stepsPerDeg * DEG * 0.05;   // m/s at the rim of a 0.05 m wheel
  const fwd = clampBody(10, 0, 0).u, side = clampBody(0, 10, 0).v, spin = clampBody(0, 0, 10).w;
  return { rim, forward: fwd, strafe: side, spinDeg: spin / DEG };
}

/** Rate limit: move the body command (u, v, w) towards the target by at most lin·dt (|Δ(u, v)|) and ang·dt (|Δw|). */
export function ramp(cur, target, dt, lim = RAMP) {
  const du = target.u - cur.u, dv = target.v - cur.v, d = Math.hypot(du, dv), maxL = lim.lin * dt;
  if (d > maxL) { cur.u += du / d * maxL; cur.v += dv / d * maxL; } else { cur.u = target.u; cur.v = target.v; }
  const dw = target.w - cur.w, maxA = lim.ang * dt;
  cur.w += Math.abs(dw) > maxA ? Math.sign(dw) * maxA : dw;
  return cur;
}

/** Body frame → world frame (the chassis slides are world x, y; its hinge is the heading). */
export function toWorld(u, v, w, yaw, out = [0, 0, 0]) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out[0] = c * u - s * v; out[1] = s * u + c * v; out[2] = w;
  return out;
}

/** Drive actions → LeRobot key directions (lekiwi_client.py: each pressed key adds its axis at the level's speed). */
const AXES = { forward: [1, 0, 0], back: [-1, 0, 0], left: [0, 1, 0], right: [0, -1, 0], turnLeft: [0, 0, 1], turnRight: [0, 0, -1] };
export const DRIVE_ACTIONS = Object.keys(AXES);

/**
 * The cart's drive state. Held actions (a Set of DRIVE_ACTIONS) at the speed level give the target; step() runs the
 * clamp, the ramp and the world mapping once per physics step and returns the velocity actuator targets.
 */
export class BaseDrive {
  constructor() {
    this.level = 0;                      // LeRobot starts at the slow level (speed_index = 0)
    this.held = new Set();
    this.braked = false;                 // Ruka mode / Space: target 0 until a drive key is pressed again
    this.target = { u: 0, v: 0, w: 0 };
    this.cmd = { u: 0, v: 0, w: 0 };     // ramped, clamped body command (what the wheels are told)
    this.scale = 1;
    this.out = [0, 0, 0];
  }
  setLevel(i) { this.level = Math.max(0, Math.min(SPEED_LEVELS.length - 1, i | 0)); }
  press(a) { if (AXES[a]) { this.held.add(a); this.braked = false; } }
  release(a) { this.held.delete(a); }
  /** Space / Ruka mode: forget the held keys, ramp down to a stop. */
  brake() { this.held.clear(); this.braked = true; }
  reset() { this.held.clear(); this.braked = false; this.cmd.u = this.cmd.v = this.cmd.w = 0; this.scale = 1; }
  moving(eps = 1e-6) { return Math.abs(this.cmd.u) > eps || Math.abs(this.cmd.v) > eps || Math.abs(this.cmd.w) > eps; }

  /** Body-frame target from the held keys at the current level, after the LeRobot clamp. */
  targetNow() {
    const L = SPEED_LEVELS[this.level];
    let x = 0, y = 0, th = 0;
    if (!this.braked) for (const a of this.held) { const k = AXES[a]; x += k[0] * L.xy; y += k[1] * L.xy; th += k[2] * L.theta; }
    const c = clampBody(x, y, th * DEG);
    this.target.u = c.u; this.target.v = c.v; this.target.w = c.w; this.scale = c.scale;
    return this.target;
  }

  /** One physics step of dt seconds at heading yaw: [vx, vy, wz] for the chassis velocity actuators. */
  step(dt, yaw) {
    ramp(this.cmd, this.targetNow(), dt);
    // the ramp moves u, v and w at their own rates, so an intermediate mix can leave the clamp's set: clamp again
    const c = clampBody(this.cmd.u, this.cmd.v, this.cmd.w);
    this.cmd.u = c.u; this.cmd.v = c.v; this.cmd.w = c.w;
    return toWorld(c.u, c.v, c.w, yaw, this.out);
  }
}

/** Carry pose (design §4.4, prototype t_tuck.mjs): keeps the arm inside the cart footprint while driving. */
export const CARRY_POSE = [0, -1.74, -1.69, 0, 0, 0];
