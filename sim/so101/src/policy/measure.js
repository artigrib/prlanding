// Měřicí buňka (measuring cell) of the waste-sorting campaign: one SO-101 cell of the conveyor scene, run headless
// and fast-forwarded, measures a policy's per-class success, cycle-time distributions and failure reasons at one belt
// speed. The result is a policy profile: the only input the line model of mission 13 (discrete-event simulation,
// design "Třídění odpadu" §6) takes about a cell. Every number in a profile comes from a trial run here; nothing is
// fitted or invented.
//
// DOM/three-free. Used by tools/profiles.mjs (CI: profiles/skript-{2,4,6}.json, MuJoCo in node), by the page
// (src/ui/measure.js: the player's own kNN policy, in the browser, on a separate MjData) and by tests/profiles.test.mjs.
//
// One trial = one item of a class on the belt, alone, at speed v; the policy runs as it does in the missions
// (beltSolve for the Skript; knnSolve's decision rule for the learned policy). The arm is free from a seeded point on
// the belt on (yFree, uniform over the pick window): the policy commits at max(yFree, where it would commit anyway),
// which samples the spot along the belt where a cell in a line gets to an item. Per attempt (commit) it logs:
//   t_grasp  commit → jaws closed (s)        t_return  jaws closed → arm ready for the next item (s)
//   y        belt y of the item when the jaws closed (m)   lat: lateral offset of the item on the belt (m)
//   outcome  success · miss (not held, item still on the belt) · knock_off (not held, item off the belt) ·
//            drop_belt (held, back on the belt) · drop_off (held, then on the table / floor / in the end tote) ·
//            drop_other_bin (held, in a bin of another fraction, not the one the policy chose) ·
//            wrong_bin (in the bin the policy chose, which is not the item's: a decision copied from a wrong demo)
// An item the policy lets pass (a class it has no demonstration of, a bin it judges full) is a pass: no attempt,
// counted per reason. The tracking pick tries an item at most BELT_PICK.tries times, so a trial has 0–2 attempts.
//
// Determinism: each trial resets the MuJoCo data to the keyframe, the controller and the belt; its random draws come
// from its own seed (trialSeed: policy, speed, class, index). Re-running trial k gives the same result whatever ran
// before it, so a CI job can re-measure the first trials of a committed profile and compare (tests/profiles.test.mjs).

import { beltSolve, beltV, BELT_PICK } from '../objects/beltpick.js';
import { BELT, CONVEYOR_ITEMS, CONVEYOR_BINS, FRACTION_BIN } from '../objects/scene.js';
import { rng, yawFor } from '../objects/wastebatch.js';
import { inZone } from '../missions.js';
import { decide, obsOf } from './knn.js';

export const MEASURE = {
  schema: 1,
  speeds: [0.02, 0.04, 0.06],          // m/s: the belt speeds a profile can be measured at (mission 13 snaps to these)
  free: [BELT_PICK.yMin, 0.155],       // m: the arm gets free at a uniform belt y in here (yMax minus one wait step at 6 cm/s)
  lat: 0.015,                          // m: items arrive up to ± this far off the belt axis (as tools/belt-measure.mjs)
  ctlEvery: 4,                         // physics steps per controller tick (16 ms, a page frame)
  still: 0.6,                          // s at rest before an item's place counts (the sortCheck rule)
  limit: 60,                           // s of sim time per trial at most
  yBin: 0.04,                          // m: success-vs-y bins
  edges: { t_grasp: [0, 8, 0.25], t_return: [0, 12, 0.25] },   // histogram [from, to, step] (s)
  quantiles: [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]
};
export const OUTCOMES = ['success', 'miss', 'knock_off', 'drop_belt', 'drop_off', 'drop_other_bin', 'wrong_bin'];
export const CLASSES = ['paper', 'plastic', 'glass', 'metal'];
export const POLICIES = { skript: 'Skript (plánovač)', knn: 'Naučené pravidlo (kNN) + plánovač' };

const BINS = Object.keys(CONVEYOR_BINS);
const FR = Object.fromEntries(CONVEYOR_ITEMS.map((it) => [it.name, it.fraction]));
/** Item kinds of each class (one pool instance per asset + scale), in pool order: trials cycle through them. */
export const KINDS = (() => {
  const seen = new Set(), out = Object.fromEntries(CLASSES.map((c) => [c, []]));
  for (const it of CONVEYOR_ITEMS) { const k = it.id + '@' + (it.scale || 1); if (!seen.has(k)) { seen.add(k); out[it.fraction].push(it.name); } }
  return out;
})();
export const kindOf = (name) => name.replace(/\d+$/, '');

/** FNV-1a (32 bit) of a string, hex. */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
/** Version of the measured cell: items, belt, bins, pick parameters and this harness. A profile measured on another
 *  cell is stale (the test asks to regenerate it). */
export function cellVersion() {
  return hash(JSON.stringify({ items: CONVEYOR_ITEMS, belt: BELT, bins: CONVEYOR_BINS, pick: BELT_PICK,
    m: { s: MEASURE.schema, free: MEASURE.free, lat: MEASURE.lat, every: MEASURE.ctlEvery, still: MEASURE.still, limit: MEASURE.limit } }));
}
/** Seed of trial k of a class at a speed for a policy (independent of every other trial). */
export function trialSeed(policy, speed, cls, k) { return parseInt(hash(`${policy}|${Math.round(speed * 1000)}|${cls}|${k}`), 16) || 1; }

/**
 * The cell around a compiled conveyor scene: { mj, m, d, w (World), ctl (ArmController) }. Returns
 * { ...C, step(sec, until?), reset(speed) }: step runs physics with the controller every MEASURE.ctlEvery steps;
 * reset puts the data at the keyframe, bins in place, controller and belt synced, belt up to speed.
 */
export function measureCell(C) {
  const { mj, m, d, w, ctl } = C, ts = m.opt.timestep, belt = w.belt;
  let tick = 0;
  const step = (sec, until) => {
    const n = Math.round(sec / ts);
    for (let i = 0; i < n; i++) {
      if (tick++ % MEASURE.ctlEvery === 0) ctl.update(ts * MEASURE.ctlEvery);
      belt.step(ts); mj.mj_step(m, d);
      if (until && i % 25 === 24 && until()) return true;
    }
    return false;
  };
  const reset = (speed) => {
    mj.mj_resetDataKeyframe(m, d, 0);
    w.layout(Object.fromEntries(Object.entries(CONVEYOR_BINS).map(([n, p]) => [n, [p[0], p[1], 0]])));
    ctl.cancel(); ctl.syncFromCtrl(); ctl.pitch = Math.PI / 2;
    belt.speed = speed; belt.wraps = 0; belt.sync();
    mj.mj_forward(m, d);
    tick = 0;
    step(1.0);   // belt up to speed
  };
  return Object.assign({}, C, { ts, belt, step, reset });
}

/** Where an item is: a bin name, 'belt', 'tote', 'floor' or 'table'. */
export function whereIs(w, name) {
  const p = w.com(name, [0, 0, 0]);
  const fx = BINS.find((b) => inZone(w, name, b));
  if (fx) return fx;
  const z = w.belt.zone(p);
  if (z === 'belt' || z === 'entry') return 'belt';
  if (z === 'tote') return 'tote';
  return p[2] < -0.05 ? 'floor' : 'table';
}

/**
 * The policy as a beltSolve decision rule for one trial: which bin, from which belt y on. policy: { kind: 'skript' }
 * or { kind: 'knn', model } (src/policy/knn.js train()). yFree: the arm is not free before the item's predicted grasp
 * point reaches it.
 */
function decider(policy, w, yFree, out) {
  return (n) => {
    let D;
    if (policy.kind === 'knn') {
      D = decide(policy.model, obsOf({ class: FR[n], pos: w.com(n, [0, 0, 0]), yaw: w.yaw(n) }, beltV(w)));
      if (!D.bin) { out.pass = D.why || 'unknown'; return D; }
    } else D = { bin: FRACTION_BIN[FR[n]] };
    out.bin = D.bin;
    return Object.assign({}, D, { y: Math.max(D.y != null ? D.y : -Infinity, yFree) });
  };
}

/**
 * One trial: item `name` alone on the belt at `speed`, run by `policy`, with draws from `seed`.
 * Returns { item, kind, class, speed, seed, yFree, lat, yaw, attempts: [{ t_grasp, t_return, y, outcome }], pass?,
 * end (where the item ended), t (sim s) }. trialGen yields after every 0.1 s of sim time (the page runs it in slices
 * between frames and can stop it there); trial runs it to the end. Both step the physics identically.
 */
export function trial(C, policy, o) { const g = trialGen(C, policy, o); for (;;) { const x = g.next(); if (x.done) return x.value; } }
export function* trialGen(C, policy, { name, speed, seed }) {
  const { w, ctl, d } = C, r = rng(seed);
  C.reset(speed);
  const yFree = MEASURE.free[0] + (MEASURE.free[1] - MEASURE.free[0]) * r();
  const yaw = yawFor(name, r), lat = (2 * r() - 1) * MEASURE.lat;
  w.spawn(name, { yaw, force: true });
  const e = w.o[name];
  d.qpos[e.qadr] += lat; C.mj.mj_forward(C.m, d);
  const out = { item: name, kind: kindOf(name), class: FR[name], speed, seed, yFree: r4(yFree), lat: r4(lat), yaw: r4(yaw), attempts: [] };
  const t0 = d.time;
  let cur = null, done = false, still = 0, lastT = d.time;
  const settle = () => {   // the attempt's outcome once its item has come to rest (or left the belt for good)
    const at = whereIs(w, name), correct = FRACTION_BIN[out.class];
    if (cur.held) {
      if (at === correct) cur.outcome = 'success';
      else if (BINS.includes(at)) cur.outcome = at === out.bin ? 'wrong_bin' : 'drop_other_bin';
      else if (cur.at === 'belt') cur.outcome = 'drop_belt';
      else cur.outcome = 'drop_off';
    }
    out.end = at;
  };
  const stop = () => {
    // called by beltSolve at the top of every round: the arm is ready again
    if (cur && cur.t_return == null && cur.tClose != null) {
      cur.t_return = r3(d.time - cur.tClose);
      cur.at = whereIs(w, name);
      if (!cur.held) cur.outcome = cur.at === 'belt' ? 'miss' : 'knock_off';
    }
    return done;
  };
  const log = (ev) => {
    if (ev.name !== name) return;
    if (ev.ev === 'commit') { cur = { tCommit: ev.t, held: false }; out.attempts.push(cur); }
    else if (ev.ev === 'close' && cur) { cur.tClose = ev.t; cur.t_grasp = r3(ev.t - cur.tCommit); cur.y = r4(ev.y); }
    else if (ev.ev === 'held' && cur) cur.held = true;
    else if (ev.ev === 'skip') { if (out.attempts.length) out.gave_up = ev.why; else out.pass = out.pass || ev.why; }
  };
  const plan = beltSolve(ctl, w, { pick: (n) => n === name, decide: decider(policy, w, yFree, out), stop, log });
  ctl.run(plan);
  // run until the item's fate is known: it left the belt for good (tote, floor), or it rests off the belt (in a bin,
  // on the table) with the gripper open and the arm ready again after the last attempt. An item on the belt rides on.
  const finished = () => {
    const at = whereIs(w, name), dt = d.time - lastT; lastT = d.time;
    if (at === 'tote' || at === 'floor') return true;
    const resting = at !== 'belt' && w.speed(name) < 0.02 && ctl.gripOpen() && (!cur || cur.t_return != null);
    still = resting ? still + dt : 0;
    return still >= MEASURE.still;
  };
  const until = () => d.time - t0 > MEASURE.limit - 1 || finished();
  for (let k = 0; k < MEASURE.limit * 10; k++) { if (C.step(0.1, until)) break; yield; }
  done = true;
  if (cur && cur.t_return == null && cur.tClose != null) { cur.t_return = r3(d.time - cur.tClose); cur.at = whereIs(w, name); if (!cur.held) cur.outcome = cur.at === 'belt' ? 'miss' : 'knock_off'; }
  if (cur) settle(); else out.end = whereIs(w, name);
  for (const a of out.attempts) {
    if (!a.outcome) a.outcome = a.held ? 'drop_off' : 'miss';
    delete a.tCommit; delete a.tClose; delete a.held; delete a.at;
  }
  if (!out.attempts.length && !out.pass) out.pass = 'none';
  out.t = r3(d.time - t0);
  ctl.cancel(); ctl.syncFromCtrl();
  return out;
}

/** Item of trial k of a class (cycling through the class's kinds). */
export const trialItem = (cls, k) => KINDS[cls][k % KINDS[cls].length];

/**
 * Trials of one speed: n per class, classes interleaved (k-th of every class, then k + 1-th), so a cancelled or
 * partial run is balanced. opts: { classes, from: first index, onTrial(trial, i, total) → false to stop }.
 * Returns the list (possibly cut short by onTrial). measureGen yields between slices (see trialGen).
 */
export function measureSpeed(C, policy, speed, n, opts = {}) { const g = measureGen(C, policy, speed, n, opts); for (;;) { const x = g.next(); if (x.done) return x.value; } }
export function* measureGen(C, policy, speed, n, opts = {}) {
  const classes = opts.classes || CLASSES, out = [], total = n * classes.length, pol = policyId(policy), k0 = opts.from || 0;
  for (let k = k0, i = 0; k < k0 + n; k++) {
    for (const cls of classes) {
      const t = yield* trialGen(C, policy, { name: trialItem(cls, k), speed, seed: trialSeed(pol, speed, cls, k) });
      t.k = k; out.push(t);
      if (opts.onTrial && opts.onTrial(t, ++i, total) === false) return out;
    }
  }
  return out;
}
/** Seed namespace of a policy: 'skript', or 'knn-<hash of the model>' (the same model gives the same trials). */
export function policyId(policy) { return policy.kind === 'knn' ? 'knn-' + modelHash(policy.model) : 'skript'; }
/** Hash of a trained kNN model (what it decides from): the cache key of the browser measuring cell. */
export function modelHash(model) {
  if (!model) return '00000000';
  const rows = CLASSES.map((c) => (model.byClass[c] || []).map((e) => [e.bin, e.obs.yaw, e.obs.lat, e.obs.belt, e.y, e.dz]));
  return hash(JSON.stringify({ k: model.k, rows }));
}

// ---------------- profile (pure: from trials) ----------------
const r3 = (v) => Math.round(v * 1e3) / 1e3;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
/** Quantile (linear between order statistics, type 7) of a sorted list. */
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return r3(sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo));
}
function quants(list) {
  const s = list.slice().sort((a, b) => a - b);
  return Object.fromEntries(MEASURE.quantiles.map((p) => ['p' + Math.round(p * 100), quantile(s, p)]));
}
/** Counts per bin [from + i·step, from + (i+1)·step); values past the end go to the last bin. */
export function histogram(list, [from, to, step]) {
  const nb = Math.round((to - from) / step), counts = new Array(nb).fill(0);
  for (const v of list) counts[Math.max(0, Math.min(nb - 1, Math.floor((v - from) / step)))]++;
  return { from, step, counts };
}
/** Wilson score interval (95 %) of k successes in n. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, z2 = z * z, c = (p + z2 / (2 * n)) / (1 + z2 / n), h = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n);
  return [r4(Math.max(0, c - h)), r4(Math.min(1, c + h))];
}
/** Success-vs-y bins (by the belt y at the close) and the window: the span of bins with success ≥ 50 % of the peak
 *  (design §6: the reach window of a cell comes from measured success, not from IK). */
function byY(atts) {
  const B = MEASURE.yBin, bins = new Map();
  for (const a of atts) {
    if (a.y == null) continue;
    const i = Math.floor(a.y / B);
    if (!bins.has(i)) bins.set(i, { n: 0, success: 0 });
    const b = bins.get(i); b.n++; if (a.outcome === 'success') b.success++;
  }
  const list = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([i, b]) => ({ y0: r3(i * B), y1: r3((i + 1) * B), n: b.n, success: b.success }));
  const ok = list.filter((b) => b.n >= 3), peak = Math.max(0, ...ok.map((b) => b.success / b.n));
  const inw = ok.filter((b) => peak > 0 && b.success / b.n >= 0.5 * peak);
  return { by_y: list, window_m: inw.length ? [inw[0].y0, inw[inw.length - 1].y1] : null };
}
function summary(trials) {
  const atts = trials.flatMap((t) => t.attempts), outcomes = Object.fromEntries(OUTCOMES.map((k) => [k, 0]));
  for (const a of atts) outcomes[a.outcome]++;
  const passes = {};
  for (const t of trials) if (t.pass) passes[t.pass] = (passes[t.pass] || 0) + 1;
  const tg = atts.map((a) => a.t_grasp).filter((v) => v != null), tr = atts.map((a) => a.t_return).filter((v) => v != null);
  const ok = atts.filter((a) => a.outcome === 'success');
  const items = trials.filter((t) => t.end === FRACTION_BIN[t.class]).length;
  const t_fail = {};
  for (const k of OUTCOMES.slice(1)) {
    const l = atts.filter((a) => a.outcome === k && a.t_grasp != null && a.t_return != null).map((a) => r3(a.t_grasp + a.t_return));
    if (l.length) t_fail[k] = l;
  }
  const yy = byY(atts);
  return {
    trials: trials.length, attempts: atts.length, outcomes, passes,
    success_per_attempt: atts.length ? r4(outcomes.success / atts.length) : null,
    success_per_attempt_ci95: wilson(outcomes.success, atts.length),
    sorted_per_item: trials.length ? r4(items / trials.length) : null,
    sorted_per_item_ci95: wilson(items, trials.length),
    window_m: yy.window_m, by_y: yy.by_y,
    t_grasp: tg, t_return: tr,
    t_cycle_success: ok.map((a) => r3(a.t_grasp + a.t_return)),
    t_fail,
    quantiles: { t_grasp: quants(tg), t_return: quants(tr), t_cycle_success: quants(ok.map((a) => a.t_grasp + a.t_return)) },
    hist: { t_grasp: histogram(tg, MEASURE.edges.t_grasp), t_return: histogram(tr, MEASURE.edges.t_return) },
    by_kind: Object.fromEntries([...new Set(trials.map((t) => t.kind))].map((k) => {
      const tt = trials.filter((t) => t.kind === k), aa = tt.flatMap((t) => t.attempts);
      return [k, { trials: tt.length, attempts: aa.length, success: aa.filter((a) => a.outcome === 'success').length }];
    }))
  };
}

/**
 * Profile of one policy at one speed from its trials. meta: { policy: 'skript' | 'knn', speed, source: 'ci' |
 * 'browser' | 'sil', measured_at (YYYY-MM-DD), model? (hash), generator?, wall_s? }.
 * Shape (design §6 plus per class): { schema, policy, label, version (cell), speed, batch, n, n_per_class,
 * measured_at, source, window_m, t_grasp, t_return, outcomes, classes: { paper: {…}, … }, trials: [raw] }.
 * The top-level t_grasp, t_return, outcomes and window_m pool all classes; the DES takes the per-class ones.
 */
export function profileFrom(trials, meta) {
  const classes = {};
  for (const c of CLASSES) { const tt = trials.filter((t) => t.class === c); if (tt.length) classes[c] = summary(tt); }
  const all = summary(trials), per = Object.values(classes).map((c) => c.trials);
  return {
    schema: MEASURE.schema, policy: meta.policy, label: POLICIES[meta.policy] || meta.policy,
    version: cellVersion(), speed: meta.speed, batch: hash(JSON.stringify(CONVEYOR_ITEMS)),
    n: trials.length, n_per_class: per.length ? Math.min(...per) : 0,
    measured_at: meta.measured_at, source: meta.source, model: meta.model || null,
    generator: meta.generator || null, wall_s: meta.wall_s != null ? meta.wall_s : null,
    definitions: {
      t_grasp: 's from the commit (the arm starts toward the item) to the jaws closed',
      t_return: 's from the jaws closed to the arm ready for the next item (placed and back, or retreated after a miss)',
      y: 'belt y (m) of the item when the jaws closed; window_m: span of 4 cm bins (n ≥ 3) with success ≥ 50 % of the peak bin',
      outcomes: 'per attempt; ' + OUTCOMES.join(', '), passes: 'items the policy let pass without an attempt, by reason',
      free: `the arm became free at a uniform belt y in [${MEASURE.free.join(', ')}] m; items alone on the belt, lateral offset ±${MEASURE.lat} m`
    },
    window_m: all.window_m, t_grasp: all.t_grasp, t_return: all.t_return, outcomes: all.outcomes, passes: all.passes,
    success_per_attempt: all.success_per_attempt, sorted_per_item: all.sorted_per_item,
    quantiles: all.quantiles,
    classes,
    trials: trials.map((t) => ({ k: t.k, item: t.item, class: t.class, seed: t.seed, yFree: t.yFree, lat: t.lat, yaw: t.yaw,
      attempts: t.attempts, pass: t.pass || null, gave_up: t.gave_up || null, end: t.end, t: t.t }))
  };
}

/** Schema check of a profile (outside data in the page; committed files in CI). Returns a list of problems. */
export function validateProfile(p) {
  const bad = [], num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!p || typeof p !== 'object') return ['not an object'];
  if (p.schema !== MEASURE.schema) bad.push('schema');
  if (!POLICIES[p.policy]) bad.push('policy');
  if (!MEASURE.speeds.includes(p.speed)) bad.push('speed not a measured speed');
  if (!['ci', 'browser', 'sil'].includes(p.source)) bad.push('source');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.measured_at || '')) bad.push('measured_at');
  if (!/^[0-9a-f]{8}$/.test(p.version || '')) bad.push('version');
  if (!Array.isArray(p.trials) || p.trials.length !== p.n) bad.push('trials ≠ n');
  for (const k of ['t_grasp', 't_return']) if (!Array.isArray(p[k]) || !p[k].every((v) => num(v) && v >= 0)) bad.push(k);
  if (!p.outcomes || !OUTCOMES.every((k) => Number.isInteger(p.outcomes[k]) && p.outcomes[k] >= 0)) bad.push('outcomes');
  if (p.window_m != null && !(Array.isArray(p.window_m) && p.window_m.length === 2 && p.window_m.every(num) && p.window_m[0] < p.window_m[1])) bad.push('window_m');
  if (!p.classes || typeof p.classes !== 'object') bad.push('classes');
  else for (const [c, s] of Object.entries(p.classes)) {
    if (!CLASSES.includes(c)) { bad.push('class ' + c); continue; }
    const att = OUTCOMES.reduce((a, k) => a + ((s.outcomes && s.outcomes[k]) || 0), 0);
    if (att !== s.attempts) bad.push(c + ': outcomes ≠ attempts');
    if (!Array.isArray(s.t_grasp) || s.t_grasp.length > s.attempts) bad.push(c + ': t_grasp');
    if (!s.hist || !s.hist.t_grasp || s.hist.t_grasp.counts.reduce((a, b) => a + b, 0) !== s.t_grasp.length) bad.push(c + ': hist');
  }
  if (Array.isArray(p.trials)) {
    const re = profileFrom(p.trials.map((t) => Object.assign({ kind: kindOf(t.item), speed: p.speed }, t)), p);
    if (JSON.stringify(re.classes) !== JSON.stringify(p.classes) || JSON.stringify(re.outcomes) !== JSON.stringify(p.outcomes)) bad.push('summaries do not follow from the trials');
  }
  return bad;
}

/**
 * Re-measured trials against a committed profile (the CI tolerance check). Trials are matched by (class, k). Passes when
 *   - at least TOL.match of the re-measured trials repeat exactly (same attempt outcomes, pass and end);
 *   - in those, every t_grasp and t_return is within TOL.dt s;
 *   - the success rate per attempt of the re-measured trials lies within z = 2.58 (99 %) binomial standard errors
 *     (+ 1/m) of the committed profile's rate, and their median t_grasp within TOL.median s of its median.
 * The cell is deterministic (see the header), so on the same MuJoCo build every trial repeats; the tolerance leaves
 * room for floating-point differences of another JS engine or CPU, which contact physics can amplify.
 * Returns { ok, problems: [...], matched, n, rate, rateRef, tol }.
 */
export const TOL = { match: 0.9, dt: 0.05, z: 2.58, median: 0.5 };
export function compareTrials(profile, trials) {
  const ref = new Map(profile.trials.map((t) => [t.class + '#' + t.k, t])), problems = [];
  const sig = (t) => JSON.stringify([t.attempts.map((a) => a.outcome), t.pass || null, t.end]);
  let matched = 0, n = 0;
  for (const t of trials) {
    const r = ref.get(t.class + '#' + t.k);
    if (!r) { problems.push(`no committed trial ${t.class} #${t.k}`); continue; }
    n++;
    if (sig(r) !== sig(t)) continue;
    matched++;
    t.attempts.forEach((a, i) => {
      for (const k of ['t_grasp', 't_return']) if (a[k] != null && Math.abs(a[k] - r.attempts[i][k]) > TOL.dt) problems.push(`${t.class} #${t.k} attempt ${i + 1}: ${k} ${a[k]} vs ${r.attempts[i][k]}`);
    });
  }
  if (n && matched < Math.ceil(TOL.match * n)) problems.push(`only ${matched} of ${n} trials repeat (need ${Math.ceil(TOL.match * n)})`);
  const atts = trials.flatMap((t) => t.attempts), m = atts.length;
  const rate = m ? atts.filter((a) => a.outcome === 'success').length / m : null, p = profile.success_per_attempt;
  if (m && p != null) {
    const tol = TOL.z * Math.sqrt(p * (1 - p) / m) + 1 / m;
    if (Math.abs(rate - p) > tol) problems.push(`success per attempt ${rate.toFixed(3)} vs ${p} (tolerance ±${tol.toFixed(3)})`);
  }
  const tg = atts.map((a) => a.t_grasp).filter((v) => v != null).sort((a, b) => a - b);
  if (tg.length && profile.quantiles && profile.quantiles.t_grasp.p50 != null) {
    const med = quantile(tg, 0.5);
    if (Math.abs(med - profile.quantiles.t_grasp.p50) > TOL.median) problems.push(`median t_grasp ${med} vs ${profile.quantiles.t_grasp.p50}`);
  }
  return { ok: !problems.length, problems, matched, n, rate, rateRef: p, tol: TOL };
}
