// Mastery rules for the SO-101 missions (wave B of the psych review). DOM-free, unit-tested in
// tests/mastery.test.mjs.
//   * Stars only for a manual carry (Táhnout ruku or Klouby). A win where the click-to-grab autopilot moved the
//     object (or a hint rung did part of it) counts as "Splněno": the mission is done, but earns no stars.
//   * Per-mission mastery badges: ✋ drag (won by hand in Táhnout ruku) and ⚙ joints (won by hand in Klouby only).
//   * A full solution ("Ukázat řešení"), an AI or a replayed demonstration = assisted: no stars, no badge, no record.
//   * Saved progress gets a version key; records saved before v2 stay as they were (stars shown as earned).
//   * HintCoach: offers help on lack of progress (no subgoal progress for ~25 s, longer in Klouby) or on
//     repeated failed grasps, instead of a flat timer.

export const PROGRESS_VERSION = 2;

/**
 * Outcome of a won run.
 *   res: { time, stars } from the mission's rate()
 *   f:   { auto, assisted, replay, drag, joints } (what moved the object during this run)
 * Returns { kind: 'manual' | 'auto' | 'assisted', stars, badges: { drag, joints } }.
 */
export function runOutcome(res, f = {}) {
  if (f.assisted || f.replay) return { kind: 'assisted', stars: 0, badges: { drag: false, joints: false } };
  if (f.auto) return { kind: 'auto', stars: 0, badges: { drag: false, joints: false } };
  const drag = !!f.drag, joints = !!f.joints && !f.drag;
  return { kind: 'manual', stars: res.stars || 0, badges: { drag, joints } };
}

/**
 * Merge an outcome into the saved record of one mission. Returns { rec, isNew } (rec is a new object;
 * isNew = a better star result than before). Assisted outcomes never change the record.
 *   rec: { stars, time, done, drag, joints, v }
 */
export function mergeRecord(prev, out, time) {
  if (out.kind === 'assisted') return { rec: prev || null, isNew: false };
  const p = prev || null;
  const rec = Object.assign({}, p || {}, { done: true, v: PROGRESS_VERSION });
  if (out.kind === 'manual') {
    const ps = (p && p.stars) || 0, pt = p && p.time != null ? p.time : Infinity;
    const better = out.stars > ps || (out.stars === ps && time < pt);
    if (better) { rec.stars = out.stars; rec.time = time; }
    if (out.badges.drag) rec.drag = true;
    if (out.badges.joints) rec.joints = true;
    return { rec, isNew: better };
  }
  // "Splněno" (autopilot): done; stars and time earned by hand before stay
  rec.stars = (p && p.stars) || 0;
  return { rec, isNew: false };
}

/** v1 records ({ stars, time }) stay as earned; they are marked legacy so the UI can keep showing them as-is. */
export function migrateProgress(prog, ver) {
  const out = {};
  for (const [id, r] of Object.entries(prog || {})) {
    if (!r || typeof r !== 'object') continue;
    out[id] = (ver || 1) < PROGRESS_VERSION ? Object.assign({}, r, { done: true, legacy: true }) : r;
  }
  return out;
}

/** "★★☆ ✋ ⚙" style summary of a record for the mission picker (text only). */
export function recordLabel(r) {
  if (!r) return { stars: 0, done: false, drag: false, joints: false };
  return { stars: r.stars || 0, done: true, drag: !!r.drag, joints: !!r.joints };
}

/**
 * Part of a solution plan for the hint ladder (rung 3: the robot starts, the player finishes):
 * the steps up to the first grasp after a settle move plus the lift after it; without a grasp (pushing,
 * drawing) up to the first settle move (arm in position, the player does the rest).
 */
export function partialPlan(plan) {
  const st = plan.steps;
  let end = -1, settled = false;
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if (s.k === 'dyn') break;
    if (s.k === 'move' && s.settle) settled = true;
    if (s.k === 'grip' && !s.open && settled) { end = Math.min(st.length - 1, st[i + 1] && st[i + 1].k === 'move' ? i + 1 : i); break; }
  }
  if (end < 0) {
    for (let i = 0; i < st.length; i++) { if (st[i].k === 'dyn') break; if (st[i].k === 'move' && st[i].settle) { end = i; break; } }
  }
  if (end < 0) end = Math.max(0, st.findIndex((s) => s.k === 'dyn') - 1);
  const steps = st.slice(0, end + 1);
  const path = [];
  for (const s of steps) if (s.k === 'move') for (const p of s.pts) path.push(p);
  return { steps, path, ok: plan.ok, bad: plan.bad || [], kind: 'partial' };
}

/**
 * Offers help when the player is stuck. Call tick() every physics check; it returns true once per offer.
 *   sig: { started, busy, won, joints, level, gripOpen, held }
 *   level: any number that grows with subgoal progress (object lifted, items done, % traced…)
 */
export class HintCoach {
  constructor(o = {}) {
    this.idleSmart = o.idleSmart || 25; this.idleJoints = o.idleJoints || 60;
    this.failLimit = o.failLimit || 2; this.graspWait = o.graspWait || 0.8;
    this.reset();
  }
  reset() { this.best = -Infinity; this.idle = 0; this.fails = 0; this.wasOpen = null; this.closeT = -1; this.offers = 0; this.reason = null; }
  tick(dt, sig) {
    if (sig.won || !sig.started) { this.wasOpen = sig.gripOpen; return false; }
    let reason = null;
    // failed grasps: the jaws closed on nothing (checked a moment after closing)
    if (this.wasOpen === true && sig.gripOpen === false) this.closeT = 0;
    this.wasOpen = sig.gripOpen;
    if (this.closeT >= 0) {
      this.closeT += dt;
      if (this.closeT >= this.graspWait) {
        this.closeT = -1;
        if (sig.held) this.fails = 0;
        else if (!sig.busy && ++this.fails >= this.failLimit) { this.fails = 0; reason = 'grasp'; }
      }
    }
    // no subgoal progress for a while (the planner or a replay moving the arm does not count)
    if (sig.level > this.best + 1e-6) { this.best = sig.level; this.idle = 0; }
    else if (!sig.busy) {
      this.idle += dt;
      if (this.idle >= (sig.joints ? this.idleJoints : this.idleSmart)) { this.idle = 0; reason = reason || 'idle'; }
    }
    if (!reason) return false;
    if (reason === 'grasp') this.idle = 0;
    this.reason = reason; this.offers++;
    return true;
  }
}
