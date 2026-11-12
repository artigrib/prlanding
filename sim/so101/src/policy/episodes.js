// Episodes and environment state of the waste-sorting missions (M11 waste_hand, later M12 waste_teach). Pure, no DOM:
// the Teach recorder (src/ui/teach.js), the LeRobot export (src/export/lerobot.js) and the M12 kNN policy use it.
// Imports only src/objects/scene.js, so the standalone export page (lerobot.html) stays small.
//
// Environment state (design: campaign "Třídění odpadu" §4.2, §5.4): per recorded frame
//   { belt: commanded belt speed (m/s, 0 = paused),
//     target: { item, class, pos: [x, y, z] (centre of mass, world, m), yaw (rad) } | null,
//     next: same | null }
// target = the item in the closed jaws, else the most downstream item riding the belt; next = the most downstream
// belt item after it. The rule is causal (it uses only the present state), so a policy can be given the same
// observation when it runs. Perception is perfect: class and pose come from the simulator.
//
// Episodes: one per item, cut from the mission's per-item events (src/objects/wastebatch.js WasteRun.events), so the
// cut is exact, not a heuristic on the joints:
//   start = the item enters the reach window (WASTE.window; its spawn when it was taken before that), but not before
//           the arm let go of the previous item;
//   end   = 0.5 s after the release (the last time it left the closed jaws), or, for an item never grasped, the moment
//           it was missed (end tote, floor, wedged on the belt).
// Outcome: 'sorted' (its bin) · 'wrong' (another bin) · 'dropped' (grasped, not in a bin) · 'missed' (never grasped).
// Items still on the belt or in the jaws when the recording stops have no episode.

import { CONVEYOR_ITEMS } from '../objects/scene.js';

/** Classes of the one-hot (the fractions of src/objects/wastebatch.js FRACTIONS, same order). */
export const ENV_CLASSES = ['paper', 'plastic', 'glass', 'metal'];
const CLASS_OF = Object.fromEntries(CONVEYOR_ITEMS.map((it) => [it.name, it.fraction]));
/** Names of the observation.environment_state vector: target item then next item, 9 floats each. */
export const ENV_NAMES = ['target', 'next'].flatMap((k) => ['x', 'y', 'z', 'yaw_sin', 'yaw_cos', ...ENV_CLASSES].map((n) => k + '.' + n));
export const ENV_DIM = ENV_NAMES.length;   // 18
export const EPISODE = { post: 0.5, minLen: 5 };   // s kept after the release; frames an episode needs (Teach's minimum)
export const OUTCOMES = ['sorted', 'wrong', 'dropped', 'missed'];
const ON_BELT = new Set(['belt', 'stuck']);
const FINAL = new Set(['bin', 'tote', 'floor', 'stuck', 'table']);   // WasteRun states that end an item's story (for now)
const r4 = (v) => Math.round(v * 1e4) / 1e4;

/* ---------------------------------------------------------------- environment state ---------------------------- */

function itemState(w, name, buf) {
  const p = w.com(name, buf);
  return { item: name, class: CLASS_OF[name], pos: [r4(p[0]), r4(p[1]), r4(p[2])], yaw: r4(w.yaw(name)) };
}

/** Environment state now, from a WasteRun and its World (one frame of the demo JSON `env`). */
export function envOf(run, w, buf = [0, 0, 0]) {
  const belt = w.belt ? r4(w.belt.speed) : 0;
  let held = null; const on = [];
  for (const it of run.items) {
    if (it.state === 'held') held = it.name;
    else if (ON_BELT.has(it.state)) on.push([w.com(it.name, buf)[1], it.name]);
  }
  on.sort((a, b) => b[0] - a[0]);   // most downstream first
  const tgt = held || (on.length ? on[0][1] : null);
  const nxt = on.find(([, n]) => n !== tgt);
  return { belt, target: tgt ? itemState(w, tgt, buf) : null, next: nxt ? itemState(w, nxt[1], buf) : null };
}

/** One env frame → the 18 floats of observation.environment_state (an absent item is all zeros: no class set). */
export function envVector(e) {
  const out = new Array(ENV_DIM).fill(0);
  [e && e.target, e && e.next].forEach((s, k) => {
    if (!s) return;
    const o = 9 * k;
    out[o] = s.pos[0]; out[o + 1] = s.pos[1]; out[o + 2] = s.pos[2];
    out[o + 3] = Math.sin(s.yaw); out[o + 4] = Math.cos(s.yaw);
    out[o + 5 + ENV_CLASSES.indexOf(s.class)] = 1;
  });
  return out;
}

/* ---------------------------------------------------------------- validation (Teach.validFrames style) ----------- */

const num = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
function validItem(s) {
  if (s === null) return null;
  if (!s || typeof s !== 'object' || typeof s.item !== 'string' || !CLASS_OF[s.item] || s.class !== CLASS_OF[s.item]) return undefined;
  const p = s.pos;
  if (!Array.isArray(p) || p.length !== 3 || !p.every((x) => num(x, -2, 2)) || !num(s.yaw, -10, 10)) return undefined;
  return { item: s.item, class: s.class, pos: p.slice(), yaw: s.yaw };
}
/**
 * Env frames from outside (file, link, localStorage): exactly n entries, each { belt, target, next } with a known
 * item whose class matches, finite pose within 2 m, belt speed within ±0.2 m/s. Returns plain copies or null.
 */
export function validEnv(env, n) {
  if (!Array.isArray(env) || env.length !== n) return null;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const e = env[i];
    if (!e || typeof e !== 'object' || !num(e.belt, -0.2, 0.2)) return null;
    const target = validItem(e.target), next = validItem(e.next);   // null = no item; a missing key is damage
    if (target === undefined || next === undefined) return null;
    out[i] = { belt: e.belt, target, next };
  }
  return out;
}
/** Episode cuts from outside: frame ranges inside 0…n−1 (from < to, ≥ minLen frames), known item, outcome and bin;
 *  grasp / release frames (optional, null for a miss) inside the range. */
export function validSegments(segs, n) {
  if (!Array.isArray(segs) || segs.length > 200) return null;
  const out = [];
  for (const s of segs) {
    if (!s || typeof s !== 'object' || typeof s.item !== 'string' || !CLASS_OF[s.item] || s.class !== CLASS_OF[s.item]) return null;
    if (!OUTCOMES.includes(s.outcome) || !(s.bin === null || s.bin === undefined || (typeof s.bin === 'string' && /^bin_[a-z]+$/.test(s.bin)))) return null;
    if (!Number.isInteger(s.from) || !Number.isInteger(s.to) || s.from < 0 || s.to > n - 1 || s.to - s.from + 1 < EPISODE.minLen) return null;
    const fr = (k) => (s[k] == null ? null : Number.isInteger(s[k]) && s[k] >= s.from && s[k] <= s.to ? s[k] : undefined);
    const grasp = fr('grasp'), release = fr('release');
    if (grasp === undefined || release === undefined) return null;
    out.push({ item: s.item, class: s.class, outcome: s.outcome, bin: s.bin || null, from: s.from, to: s.to, grasp, release });
  }
  return out;
}

/* ---------------------------------------------------------------- cutting ------------------------------------- */

/**
 * Per-item episodes in run time from WasteRun events ({ ev, name, fraction, t, from, bin?, ok? }).
 * `end`: run time when the recording stopped (items unresolved by then get no episode).
 * Returns [{ item, class, outcome, bin, ok, t0, t1, grasp, release }] sorted by t0.
 */
export function cutEpisodes(events, { end = Infinity, post = EPISODE.post } = {}) {
  const per = new Map();
  for (const e of events) {
    if (!e || typeof e.name !== 'string' || !(e.t <= end)) continue;
    if (!per.has(e.name)) per.set(e.name, []);
    per.get(e.name).push(e);
  }
  const items = [];
  for (const [name, evs] of per) {
    const it = { item: name, class: CLASS_OF[name] || evs[0].fraction || null, spawn: null, win: null, grasp: null, release: null, final: null, state: null };
    for (const e of evs) {
      if (e.ev === 'window') { if (it.win == null) it.win = e.t; continue; }   // not a state change
      if (e.ev === 'belt' && e.from === 'queued') it.spawn = e.t;
      if (e.from === 'held') it.release = e.t;
      if (e.ev === 'held' && it.grasp == null) it.grasp = e.t;
      it.final = FINAL.has(e.ev) ? e : null;
      it.state = e.ev;
    }
    items.push(it);
  }
  const rel = items.filter((x) => x.release != null).map((x) => [x.release, x.item]);
  const out = [];
  for (const it of items) {
    const f = it.final;
    if (it.spawn == null || it.state === 'held' || !f) continue;   // unresolved when the recording stopped
    let outcome, t1, bin = null, ok = false;
    if (it.grasp != null) {
      if (f.ev === 'bin') { bin = f.bin; ok = !!f.ok; outcome = ok ? 'sorted' : 'wrong'; } else outcome = 'dropped';
      t1 = Math.min(end, it.release + post);
    } else {
      if (f.ev === 'bin' || f.ev === 'table') continue;   // not without a grasp (a push): no decision to learn from
      outcome = 'missed'; t1 = f.t;
    }
    const base = it.win != null && (it.grasp == null || it.win <= it.grasp) ? it.win : it.spawn;
    const until = it.grasp != null ? it.grasp : t1;
    let free = -Infinity;   // the arm let go of another item: this item's approach starts after that
    for (const [r, n] of rel) if (n !== it.item && r < until) free = Math.max(free, r);
    let t0 = Math.min(Math.max(base, free), until);
    if (it.grasp == null && t1 - t0 < 1) t0 = base;   // a miss while the arm was busy: keep its window time
    out.push({ item: it.item, class: it.class, outcome, bin, ok, t0, t1, grasp: it.grasp, release: it.release });
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

/**
 * Run-time cuts → frame ranges of a recording. rt[i] = the run clock at frame i (non-decreasing; null before the run
 * existed). Drops cuts shorter than EPISODE.minLen frames. Returns [{ item, class, outcome, bin, from, to, grasp, release }]
 * (grasp / release: the frames where the jaws first held it and last let go of it, null for a miss).
 */
export function cutFrames(cuts, rt) {
  const n = rt.length, out = [];
  const first = (t) => { for (let i = 0; i < n; i++) if (rt[i] != null && rt[i] >= t - 1e-9) return i; return n; };
  const last = (t) => { for (let i = n - 1; i >= 0; i--) if (rt[i] != null && rt[i] <= t + 1e-9) return i; return -1; };
  for (const c of cuts) {
    const from = first(c.t0), to = last(c.t1);
    if (to - from + 1 < EPISODE.minLen) continue;
    const at = (t) => (t == null ? null : Math.min(to, Math.max(from, first(t))));
    out.push({ item: c.item, class: c.class, outcome: c.outcome, bin: c.bin, from, to, grasp: at(c.grasp), release: at(c.release) });
  }
  return out;
}

/** After Teach.trim() kept frames a…b: shift the cuts, clip them, drop the ones that got too short. */
export function trimSegments(segs, a, b) {
  const out = [];
  for (const s of segs || []) {
    const from = Math.max(s.from, a) - a, to = Math.min(s.to, b) - a;
    const at = (i) => (i == null ? null : Math.min(to, Math.max(from, i - a)));
    if (to - from + 1 >= EPISODE.minLen) out.push(Object.assign({}, s, { from, to, grasp: at(s.grasp), release: at(s.release) }));
  }
  return out;
}

/* ---------------------------------------------------------------- compact form (localStorage, shared links) ------ */

const NAMES = CONVEYOR_ITEMS.map((it) => it.name);
/** env frame → [belt, ti, x, y, z, yaw, ni, x, y, z, yaw] (item index into CONVEYOR_ITEMS, −1 = none). */
export function packEnv(e) {
  const one = (s) => (s ? [NAMES.indexOf(s.item), ...s.pos, s.yaw] : [-1, 0, 0, 0, 0]);
  return [e.belt, ...one(e.target), ...one(e.next)];
}
/** Inverse of packEnv; anything malformed becomes undefined (validEnv then rejects the list). */
export function unpackEnv(a) {
  if (!Array.isArray(a) || a.length !== 11) return undefined;
  const one = (o) => {
    const i = a[o];
    if (i === -1) return null;
    const name = NAMES[i];
    return name ? { item: name, class: CLASS_OF[name], pos: [a[o + 1], a[o + 2], a[o + 3]], yaw: a[o + 4] } : undefined;
  };
  return { belt: a[0], target: one(1), next: one(6) };
}
