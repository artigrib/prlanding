// Scripted "hands" for the SIL runner: move an unpowered arm like a person would during calibration,
// and play leader-arm trajectories during teleoperation/recording. printedrobotics.cz.

// Pick-and-place in the default scene (cube -> bowl), joint angles in rad. Same waypoints as the
// browser sim's "Ukázat řešení" (sim/so101/core.js DEMO), starting and ending at the rest pose.
export const REST = [0, -1.0, 0.6, 1.2, 0, 0.3];
export const PICK_PLACE = [
  { q: REST, t: 1.0 },
  { q: [0.476, 0.315, -0.382, 1.638, 0, 1.2], t: 1.6 },
  { q: [0.476, 0.370, -0.030, 1.230, 0, 1.2], t: 1.2 },
  { q: [0.476, 0.370, -0.030, 1.230, 0, -0.1], t: 0.8 },
  { q: [0.476, 0.331, -0.483, 1.658, 0, -0.1], t: 1.2 },
  { q: [-0.754, 0.142, -0.216, 1.645, 0, -0.1], t: 2.0 },
  { q: [-0.754, 0.135, -0.058, 1.494, 0, 1.2], t: 1.0 },
  { q: REST, t: 1.6 }
];

export const middle = (range) => range.map(([lo, hi]) => (lo + hi) / 2);

/**
 * Calibration sweep: every joint except wrist_roll (LeRobot treats it as a full-turn motor) goes from
 * the middle to one end, to the other end and back, one joint at a time (lerobot-calibrate's
 * "move all joints sequentially through their entire ranges of motion"). `margin` keeps a little off
 * the hard stops, as a careful person would. Like a person, the sweep folds the arm out of the way of
 * the table first where the full range needs it (SWEEP_POSE: shoulder_lift with the elbow folded,
 * elbow_flex with the upper arm raised); otherwise the follower would stop on the table and record a
 * shorter range than the leader, and teleoperation in degrees would be offset.
 */
export const SWEEP_POSE = { 1: { 2: -1.6 }, 2: { 1: -1.5 } };
export function sweepSegments(range, { legS = 1.2, margin = 0.02, joints = [0, 1, 2, 3, 5], poses = SWEEP_POSE } = {}) {
  const mid = middle(range), segs = [{ q: mid, t: 0.6 }];
  for (const j of joints) {
    const [lo, hi] = range[j], w = (hi - lo) * margin;
    const base = mid.slice();
    for (const [k, v] of Object.entries(poses[j] || {})) base[k] = v;
    const at = (v) => base.map((m, k) => (k === j ? v : m));
    if (poses[j]) segs.push({ q: base, t: legS });
    segs.push({ q: at(lo + w), t: legS }, { q: at(lo + w), t: 0.25 }, { q: at(hi - w), t: 2 * legS }, { q: at(hi - w), t: 0.25 }, { q: base, t: legS });
    if (poses[j]) segs.push({ q: mid, t: legS });
  }
  return segs;
}

const smooth = (x) => x * x * (3 - 2 * x);

/** Plays segments [{q: [6 rad] | null (= hold), t: seconds}] on a plant through plant.hand(). */
export class HandMover {
  constructor(plant, n = 6) {
    this.plant = plant; this.n = n;
    this.target = Array.from({ length: n }, (_, i) => plant.q(i));
    this.queue = []; this.seg = null; this.loop = null; this.name = 'idle';
  }
  get busy() { return !!this.seg || this.queue.length > 0; }
  /** Replace whatever is playing. `loop: true` repeats the segments forever. */
  play(segs, { loop = false, name = 'script' } = {}) {
    this.target = Array.from({ length: this.n }, (_, i) => this.plant.q(i));
    this.queue = segs.map((s) => ({ ...s })); this.seg = null; this.loop = loop ? segs : null; this.name = name;
  }
  stop() { this.queue = []; this.seg = null; this.loop = null; this.name = 'idle'; }
  /** Nudge one joint by `dq` rad (keyboard control). */
  nudge(i, dq) {
    this.stop(); this.name = 'keyboard';
    const [lo, hi] = (this.plant.range && this.plant.range[i]) || [-Infinity, Infinity];
    this.target[i] = Math.min(hi, Math.max(lo, this.target[i] + dq));
    this.plant.hand(i, this.target[i]);
  }
  tick(dt) {
    if (!this.seg) {
      if (!this.queue.length && this.loop) { this.queue = this.loop.map((s) => ({ ...s })); this.onLoop && this.onLoop(this.name); }
      if (!this.queue.length) {
        if (this.name !== 'keyboard' && this.name !== 'idle') { const n = this.name; this.name = 'idle'; this.onIdle && this.onIdle(n); }
        return;
      }
      const s = this.queue.shift();
      this.seg = { from: this.target.slice(), to: s.q ? s.q.slice() : this.target.slice(), t: Math.max(1e-3, s.t), e: 0 };
    }
    const s = this.seg;
    s.e = Math.min(s.t, s.e + dt);
    const k = smooth(s.e / s.t);
    for (let i = 0; i < this.n; i++) {
      this.target[i] = s.from[i] + (s.to[i] - s.from[i]) * k;
      this.plant.hand(i, this.target[i]);
    }
    if (s.e >= s.t) this.seg = null;
  }
}

/** Trajectory file: JSON [{q:[6 rad], t:s}, ...] or {frames:[...]}; or CSV "t,q0..q5" with absolute times. */
export function parseTrajectory(text) {
  const s = text.trim();
  if (s.startsWith('[') || s.startsWith('{')) {
    const j = JSON.parse(s), frames = Array.isArray(j) ? j : j.frames;
    if (!Array.isArray(frames) || !frames.length) throw new Error('trajectory: no frames');
    return frames.map((f, k) => {
      if (!Array.isArray(f.q) || f.q.length !== 6 || f.q.some((v) => typeof v !== 'number' || !isFinite(v))) throw new Error(`trajectory: frame ${k} needs q: [6 numbers]`);
      return { q: f.q.slice(), t: Math.max(0.01, +f.t || 0.5) };
    });
  }
  const rows = s.split(/\r?\n/).filter((l) => l && !/^[#a-z]/i.test(l)).map((l) => l.split(/[,;\s]+/).map(Number));
  if (!rows.length) throw new Error('trajectory: empty');
  let prev = 0;
  return rows.map((r, k) => {
    if (r.length < 7 || r.some((v) => !isFinite(v))) throw new Error(`trajectory: row ${k + 1} needs t,q0..q5`);
    const t = Math.max(0.01, r[0] - prev); prev = r[0];
    return { q: r.slice(1, 7), t };
  });
}
