// Real-arm safety policy for the SO-101 browser tooling — printedrobotics.cz.
// Pure logic, no DOM and no bus access: the wizard, the agent bridge and the Node tests share it.
// Numbers come from the real-arm safety specification (SR-6, SR-7, SR-12, SR-13, SR-14, SR-19).
// Every timer takes an injectable clock (`now`), so tests can run hours in microseconds.

/** SR-7 browser speed caps in °/s (and %/s for the gripper). */
export const SPEED = Object.freeze({ min: 10, default: 30, teacher: 20, ownerMax: 60 });
/** SR-7 firmware Goal_Velocity backstop = 1.25 × the browser cap (unit per Phase bit, TO VERIFY ON BENCH). */
export const BACKSTOP_FACTOR = 1.25;

/** SR-13/14/16 per-session profiles. */
export const PROFILES = Object.freeze({
  owner: Object.freeze({ id: 'owner', maxSpeed: SPEED.ownerMax, defaultSpeed: SPEED.default, permissionMs: 10 * 60e3, sessionMs: 45 * 60e3 }),
  teacher: Object.freeze({ id: 'teacher', maxSpeed: SPEED.teacher, defaultSpeed: SPEED.teacher, permissionMs: 5 * 60e3, sessionMs: 20 * 60e3 })
});
export const IDLE_MS = 3 * 60e3;          // SR-13: no human motion for 3 min -> disarm
export const COOLDOWN_MS = 5 * 60e3;      // SR-14: forced shadow pause after the session cap
export const LIMP_HOLD_MS = 1000;         // SR-6: press-and-hold STOP this long = limp
export const SPACE_WINDOW_MS = 2000;      // SR-6: second STOP within 2 s (used for the Space key)
export const DEADMAN_MS = 1000;           // SR-12: agent link silent this long -> hold
export const PING_MS = 250;               // SR-12: agent-link ping period in real mode

const profileOf = (p) => PROFILES[p] || PROFILES.owner;

/** Clamp a requested browser speed to the profile's range (never above 60 °/s, teacher 20 °/s). */
export function clampSpeed(v, profile = 'owner') {
  const max = profileOf(profile).maxSpeed;
  const n = Number(v);
  if (!Number.isFinite(n)) return Math.min(SPEED.default, max);
  return Math.min(max, Math.max(SPEED.min, n));
}
/** Firmware backstop in °/s for a browser cap (the cap is clamped to the owner maximum first). */
export const firmwareCapDeg = (browserCap) => Math.min(Math.max(0, browserCap), SPEED.ownerMax) * BACKSTOP_FACTOR;

/** "m:ss" for a countdown. */
export function fmtLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/**
 * SR-13/14 motion permission. arm() grants `permissionMs` (10 min owner, 5 min teacher), touch()
 * (a human/confirmed motion) renews it, never past the session cap (45/20 min). check() reports
 * expiry, idleness and the session cap; after the cap a 5-min cool-down refuses arming.
 */
export class MotionPermission {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.armed = false; this.profile = null;
    this.until = 0; this.sessionEnd = 0; this.lastMotion = 0; this.cooldownUntil = 0;
    this.reason = null;          // why the last disarm happened
  }
  canArm() {
    const t = this.now();
    if (t < this.cooldownUntil) return { ok: false, reason: 'cooldown', leftMs: this.cooldownUntil - t };
    return { ok: true };
  }
  arm(profile = 'owner') {
    const c = this.canArm();
    if (!c.ok) return c;
    const p = profileOf(profile), t = this.now();
    this.armed = true; this.profile = p.id; this.reason = null;
    this.sessionEnd = t + p.sessionMs;
    this.until = Math.min(t + p.permissionMs, this.sessionEnd);
    this.lastMotion = t;
    return { ok: true };
  }
  /** A confirmed (human) motion: renews the permission up to the session cap. */
  touch() {
    if (!this.armed) return false;
    const t = this.now();
    this.lastMotion = t;
    this.until = Math.min(t + profileOf(this.profile).permissionMs, this.sessionEnd);
    return true;
  }
  disarm(reason = 'user') {
    if (reason === 'session') this.cooldownUntil = this.now() + COOLDOWN_MS;
    this.armed = false; this.reason = reason;
  }
  /** {ok} while armed and valid; otherwise {ok:false, reason}. Disarms on expiry. */
  check() {
    if (!this.armed) return { ok: false, reason: this.reason || 'not_armed' };
    const t = this.now();
    let why = null;
    if (t >= this.sessionEnd) why = 'session';
    else if (t >= this.until) why = 'expired';
    else if (t - this.lastMotion >= IDLE_MS) why = 'idle';
    if (why) { this.disarm(why); return { ok: false, reason: why }; }
    return { ok: true };
  }
  status() {
    const t = this.now();
    return {
      armed: this.armed, profile: this.profile, reason: this.reason,
      leftMs: this.armed ? Math.max(0, Math.min(this.until, this.lastMotion + IDLE_MS) - t) : 0,
      sessionLeftMs: this.armed ? Math.max(0, this.sessionEnd - t) : 0,
      cooldownLeftMs: Math.max(0, this.cooldownUntil - t)
    };
  }
}

/**
 * SR-6 two-stage STOP latch. press() returns the action to take: 'hold' for the first press,
 * 'limp' for a press while already holding (or for a 1 s press-and-hold, via holdLong()).
 * Only release() — an explicit in-page action — clears it. state: null | 'hold' | 'limp'.
 */
export class StopLatch {
  constructor({ now = () => Date.now() } = {}) { this.now = now; this.state = null; this.since = 0; this.presses = 0; }
  press() {
    this.presses++;
    if (this.state === null) { this.state = 'hold'; this.since = this.now(); return 'hold'; }
    this.state = 'limp'; this.since = this.now();
    return 'limp';
  }
  holdLong() { this.state = 'limp'; this.since = this.now(); return 'limp'; }
  /** Space is a STOP key only while moving, or as the second press within 2 s of a hold. */
  spaceIsStop(moving) { return moving || (this.state === 'hold' && this.now() - this.since <= SPACE_WINDOW_MS); }
  get latched() { return this.state !== null; }
  release() { const was = this.state; this.state = null; this.since = 0; return was; }
}

/**
 * SR-12 deadman: kick() on every inbound message; expired() once nothing arrived for `timeoutMs`.
 * Fires `onTrip` at most once per silence (the caller decides what tripping means: hold).
 */
export class Deadman {
  constructor({ timeoutMs = DEADMAN_MS, now = () => Date.now(), onTrip = () => {} } = {}) {
    this.timeoutMs = timeoutMs; this.now = now; this.onTrip = onTrip; this.last = now(); this.tripped = false;
  }
  kick() { this.last = this.now(); this.tripped = false; }
  silentMs() { return this.now() - this.last; }
  expired() { return this.silentMs() > this.timeoutMs; }
  /** Call periodically. Returns true when it tripped on this call. */
  poll() {
    if (this.tripped || !this.expired()) return false;
    this.tripped = true;
    try { this.onTrip(this.silentMs()); } catch (e) { /* the hold must not be blocked by a UI error */ }
    return true;
  }
}

/**
 * SR-19 firmware allow-list: {major, minor, model} triples measured on the bench arms.
 * EMPTY ON PURPOSE until the two bench arms have been read (spec §10 Q4): every real servo is
 * "unknown" and the real arm stays read-only (shadow). Add entries only from bench reports, e.g.
 *   { major: 3, minor: 10, model: 777, source: 'bench arm A, 2026-xx-xx' }
 * The emulator reports 3.10 ("emulated"), which is NOT evidence about real servos.
 */
export const FIRMWARE_ALLOW = Object.freeze([]);
/** What the emulator reports; tests and the virtual arm may allow it explicitly. */
export const EMULATED_FIRMWARE = Object.freeze({ major: 3, minor: 10, model: 777, source: 'emulated' });

/**
 * readings: Map|object id -> {major, minor, model} (null = no answer).
 * Returns {ok, unknown: [{id, version, model}], missing: [ids], reason}.
 */
export function checkFirmware(readings, allow = FIRMWARE_ALLOW) {
  const entries = readings instanceof Map ? [...readings] : Object.entries(readings).map(([k, v]) => [+k, v]);
  const unknown = [], missing = [];
  for (const [id, r] of entries) {
    if (!r) { missing.push(id); continue; }
    const hit = allow.some((a) => a.major === r.major && a.minor === r.minor && a.model === r.model);
    if (!hit) unknown.push({ id, version: `${r.major}.${r.minor}`, model: r.model });
  }
  const ok = !unknown.length && !missing.length && entries.length > 0;
  const reason = ok ? null : missing.length ? 'no_reply' : !allow.length ? 'allow_list_empty' : 'unknown_firmware';
  return { ok, unknown, missing, reason };
}
