// Tier (a) policy of mission 12 "Třídění odpadu II: Naučte robota" (waste_teach): "Naučené pravidlo (kNN) + plánovač".
// Pure and deterministic (no DOM, no MuJoCo): the page (src/ui/policy.js), the executor (src/policy/run.js),
// tools/belt-measure.mjs and tests/knn-policy.test.mjs use it.
//
// What it is (design: campaign "Třídění odpadu" §4.1): behaviour cloning of the player's *decisions* on the belt,
// executed by the existing tracking planner (src/objects/beltpick.js beltSolve). It is not motor control: the motion
// is always the planner's. Learned per demonstrated item (one episode, src/policy/episodes.js):
//   - the bin it went into (the decision; a wrong bin is learned too: that is the lesson about data quality),
//   - where along the belt the jaws took it (belt y at the grasp: early vs late commit),
//   - the grasp height relative to the item's centre of mass (from the recorded joints, forward kinematics).
// The jaw heading stays the planner's (libGrasp / across the belt).
// Observation of an item (perfect perception: class and pose come from the simulator): class (4-way), yaw mod π
// relative to the belt, lateral offset from the belt axis, commanded belt speed.
// Model: k-nearest neighbours (k = 3) within the same class; distance = weighted (Δyaw mod π, Δlateral, Δbelt).
// Output: the majority bin of the neighbours (a tie goes to the nearest), the median commit y and grasp height.
// "Training" builds the per-class index; there are no weights. A class without a demonstration has no answer: the
// item is let through ("neznámá třída – nechal projet"), an honest failure.

import { BELT, FRACTION_BIN } from '../objects/scene.js';
import { ENV_CLASSES } from './episodes.js';

export const KNN = {
  k: 3,
  yawScale: Math.PI / 2,   // rad: the largest yaw difference mod π
  latScale: BELT.hw,       // m: half the belt width
  beltScale: 0.02,         // m/s: the mission's belt speed
  wYaw: 1, wLat: 1, wBelt: 0.5,
  // commit window along the belt (= BELT_PICK.yMin … yMax − 1 cm, src/objects/beltpick.js; checked by the tests): a
  // learned commit point outside it is clipped, so the planner can still reach the item
  yMin: -0.15, yMax: 0.16,
  dzMin: -0.03, dzMax: 0.03   // m: grasp height relative to the COM (a cup's rim or the slats are outside this)
};
/** Episode outcomes a decision is learned from: the item went into a bin (its own or another). */
export const USED = ['sorted', 'wrong'];

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Yaw of an item relative to the belt direction (+y), mod π, in [0, π). */
export function relYaw(yaw) {
  const r = (yaw - Math.PI / 2) % Math.PI;
  return r4(r < 0 ? r + Math.PI : r);
}
/** Observation of one item (an env item state { class, pos, yaw }, src/policy/episodes.js) at belt speed `belt`. */
export function obsOf(s, belt) {
  return { class: s.class, yaw: relYaw(s.yaw), lat: r4(s.pos[0] - BELT.x), belt: r4(belt || 0) };
}

/**
 * Episodes of one recording (Teach demo: t[], obs[], env[], segments[]) → examples, in time order.
 * The observation of an episode's item is read at its grasp frame (the first frame where the jaws held it), from the
 * env slot that holds that item: before the grasp, env.target is the most downstream item on the belt, which need
 * not be the one the player took. Times come from the timestamps (demo.t), not from frame counts.
 * opts.tipOf(jointRow) → gripper site [x, y, z] (forward kinematics of the recorded joints): gives the grasp height.
 * Every episode is returned; `use` says whether a decision is learned from it (into a bin, with a grasp observed).
 * Example: { item, class, outcome, bin, use, t (s from the recording start), src, obs?, y?, dz?, tg? (s from the
 * episode start to the grasp) }.
 */
export function examplesFromDemo(demo, opts = {}) {
  const out = [], env = demo.env, T = demo.t;
  for (const seg of demo.segments || []) {
    const ex = { item: seg.item, class: seg.class, outcome: seg.outcome, bin: seg.bin || null, use: false, t: r4(T[seg.from]), src: opts.src || 'hand' };
    if (USED.includes(seg.outcome) && seg.grasp != null && env && seg.bin) {
      let k = seg.grasp, s = null;
      for (; k <= seg.to && !s; k++) { const e = env[k]; s = e && [e.target, e.next].find((x) => x && x.item === seg.item); }
      k--;
      if (s) {
        ex.use = true;
        ex.obs = obsOf(s, env[k].belt);
        ex.y = r4(clamp(s.pos[1], KNN.yMin, KNN.yMax));
        ex.tg = r4(T[k] - T[seg.from]);
        if (opts.tipOf && demo.obs && demo.obs[k]) ex.dz = r4(clamp(opts.tipOf(demo.obs[k])[2] - s.pos[2], KNN.dzMin, KNN.dzMax));
      }
    }
    out.push(ex);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Demonstrated decisions per class (examples with use, not excluded). */
export function coverage(examples) {
  const c = Object.fromEntries(ENV_CLASSES.map((k) => [k, 0]));
  for (const e of examples) if (e.use && !e.off && c[e.class] != null) c[e.class]++;
  return c;
}

/**
 * The per-class index. examples: from examplesFromDemo (possibly several recordings, concatenated); an example with
 * off = true (deleted by the player) is left out. Each kept example gets its demo number n (1-based, in the order
 * given), which the explanations cite ("podle ukázky č. 3"). Deterministic: the same examples give the same model.
 */
export function train(examples) {
  const byClass = Object.fromEntries(ENV_CLASSES.map((k) => [k, []]));
  let n = 0;
  examples.forEach((e, i) => {
    if (!e.use || e.off || !byClass[e.class]) return;
    byClass[e.class].push({ n: ++n, i, item: e.item, bin: e.bin, obs: e.obs, y: e.y, dz: e.dz });
  });
  return { k: KNN.k, n, byClass, coverage: Object.fromEntries(ENV_CLASSES.map((k) => [k, byClass[k].length])) };
}

function circ(a, b) { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); }
/** Distance between two observations of the same class. */
export function dist(a, b) {
  const dy = KNN.wYaw * circ(a.yaw, b.yaw) / KNN.yawScale, dl = KNN.wLat * (a.lat - b.lat) / KNN.latScale, db = KNN.wBelt * (a.belt - b.belt) / KNN.beltScale;
  return Math.sqrt(dy * dy + dl * dl + db * db);
}
const median = (v) => {
  if (!v.length) return null;
  const s = v.slice().sort((a, b) => a - b), m = s.length >> 1;
  return r4(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

/**
 * Decision for an observed item: { bin, y, dz, nn: [demo numbers, nearest first], by: demo number the bin comes from
 * (the nearest neighbour that voted for it), votes } or { bin: null, why: 'unknown', nn: [] } for a class the model
 * has no demonstration of.
 */
export function decide(model, o) {
  const list = (model && model.byClass[o.class]) || [];
  if (!list.length) return { bin: null, why: 'unknown', nn: [] };
  const near = list.map((e) => ({ e, d: dist(o, e.obs) })).sort((a, b) => a.d - b.d || a.e.n - b.e.n).slice(0, model.k || KNN.k);
  const votes = {};
  for (const { e } of near) votes[e.bin] = (votes[e.bin] || 0) + 1;
  const top = Math.max(...Object.values(votes));
  const win = near.find(({ e }) => votes[e.bin] === top).e;   // a tie: the nearest one's bin
  return {
    bin: win.bin, by: win.n, votes, nn: near.map(({ e }) => e.n),
    y: median(near.map(({ e }) => e.y).filter((v) => v != null)),
    dz: median(near.map(({ e }) => e.dz).filter((v) => v != null))
  };
}

/** Failure causes of the result card (design §2 M12; the same categories as the line model of mission 13). */
export const CAUSES = {
  sorted: 'správně',
  wrong: 'špatný koš',
  unknown: 'neznámá třída – nechal projet',
  miss: 'minul úchop',
  dropped: 'upustil',
  late: 'nestihl (mimo dosah)'
};

/**
 * Per item of a policy run: what happened and why. items: WasteRun items ({ name, fraction, state, bin });
 * events: the executor's log (beltSolve events); decisions: { name: decide() result }.
 * Returns [{ item, fraction, ok, cause (key of CAUSES), bin, by (demo number for a bin decision), nn }].
 */
export function report(items, events, decisions = {}) {
  return items.map((it) => {
    const ev = events.filter((e) => e.name === it.name), D = decisions[it.name] || null;
    const has = (k, why) => ev.some((e) => e.ev === k && (why == null || e.why === why));
    const row = { item: it.name, fraction: it.fraction, ok: false, bin: it.state === 'bin' ? it.bin : null, by: D && D.bin ? D.by : null, nn: D ? D.nn : [] };
    if (it.state === 'bin') { row.ok = it.bin === FRACTION_BIN[it.fraction]; row.cause = row.ok ? 'sorted' : 'wrong'; }
    else if (has('skip', 'unknown')) row.cause = 'unknown';
    else if (has('held')) row.cause = 'dropped';
    else if (has('miss')) row.cause = 'miss';
    else row.cause = 'late';
    return row;
  });
}
