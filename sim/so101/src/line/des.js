// Line model of mission 13 ("Třídění odpadu III: Navrhněte linku"; design "Třídění odpadu" §6): a discrete-event
// simulation (DES) of a sorting line, built only from measured policy profiles (profiles/<policy>-<cm/s>.json,
// src/policy/measure.js). Pure: no DOM, no MuJoCo, no clock; every random draw comes from a seeded generator, so a
// (configuration, profiles, seed) gives the same run anywhere.
//
// What a run is
//   Belt of LINE.length m at speed v. Items arrive at its head (Poisson with rate λ per minute, or "rovnoměrně":
//   every 60/λ s plus an optional jitter), with a class drawn from the order's mix. Two items need LINE.spacing m of
//   belt between them, so an arrival closer than spacing / v s to the previous accepted one is refused ("nepřijato")
//   and counted, not dropped silently. An item rides at s(t) = v · (t − t_arrival) and leaves at the belt end
//   (missed, "propadlo") unless a cell takes it.
//   Cell i sits at belt position x_i (its local belt y = s − x_i, as in the measuring cell), sorts a set of fractions
//   (two in the game: two bins per cell) and runs a policy whose profile was measured at speed v.
//
// Where every number comes from (nothing is fitted or invented)
//   window     per class: the profile's window_m, the span of 4 cm bins of the belt y at the close where measured
//              success ≥ 50 % of the peak bin (measure.js byY). A cell commits only if the item's predicted close
//              position lies inside it.
//   t_grasp    the cell's planned time from commit to the close for an item: one bootstrap draw from the class's
//              measured t_grasp list (drawn once per cell and item, so waiting does not re-roll it).
//   outcome,   one measured attempt record (outcome and t_return together, so each failure costs its measured time)
//   t_return   drawn from the attempts of that class whose close fell in the same 4 cm y bin as this close (n ≥
//              LINE.minBin, the window rule's minimum), else from the attempts inside the window, else from all.
//              (The close time is the planned t_grasp above; outcome and t_return come from this record. So t_grasp
//              and the outcome are drawn separately: a measured link between a slow grasp and a miss is not kept.)
//   passes     items the policy refused by decision (kNN: a class without a demonstration, reason 'unknown'):
//              per-item probability = such passes / trials of the class. Timing passes ('late', 'reach') are what
//              the window models; 'full' (bin full) is a bin-capacity effect this model leaves out.
//   tries      at most LINE.tries attempts per item per cell (BELT_PICK.tries of the measured planner).
//
// Commit rule (the measured planner's beltSolve): an idle cell takes the most downstream item of its fractions,
// not reserved by another cell, whose predicted close position s − x_i + v · t_grasp lies in the window; otherwise
// it waits until the first such item reaches the window (or something changes). The item is reserved for the
// whole attempt, so no other cell can take it meanwhile (one item, one cell).
//
// Outcomes of an attempt (measure.js OUTCOMES), applied when the arm is ready again (commit + t_grasp + t_return):
//   success → its own bin · miss, drop_belt → back on the belt at its belt position, free for any cell ·
//   knock_off, drop_off → lost (off the line) · drop_other_bin, wrong_bin → into another bin of the same cell
//   (the bin the measured trial ended in if the cell has that fraction, else the cell's first other fraction; a
//   one-fraction cell has no other bin, so the item is lost).
//
// Not modelled (stated in "Jak to počítáme", src/line/explain.js): neighbouring cells do not interfere physically;
// no belt stops, jams or bin changes; perception is perfect; the lateral position on the belt is the measured
// ±1.5 cm only; each attempt is an independent draw of single-item trials (the measuring cell had one item on the
// belt at a time).
//
// Measurement: a run first fills the belt (warm-up, default L / v: the first item reaches the end), then counts
// events in the next `horizon` s (default 30 min). Rates are per minute of that window. Batch mode (config.count)
// instead sends exactly `count` accepted items and counts each one's fate (used to compare with a mission 11 batch).

export const CLASSES = ['paper', 'plastic', 'glass', 'metal'];
export const OUTCOMES = ['success', 'miss', 'knock_off', 'drop_belt', 'drop_off', 'drop_other_bin', 'wrong_bin'];
export const LINE = {
  length: 4,          // m: belt length of mission 13 (design §2)
  firstSlot: 0.25,    // m: first cell slot; slots every `slot` m
  slot: 0.5,          // m
  maxCells: 8,
  spacing: 0.08,      // m: minimum spacing of items on the belt (slat length and item size, design §6)
  tries: 2,           // attempts per item per cell (src/objects/beltpick.js BELT_PICK.tries; a test keeps them equal)
  yBin: 0.04,         // m: success-vs-y bins (src/policy/measure.js MEASURE.yBin; a test keeps them equal)
  minBin: 3,          // attempts in a y bin before its own outcome frequencies are used (the window rule's n ≥ 3)
  horizon: 1800,      // s: measured line time per run (30 min)
  seeds: 20,          // runs per configuration (design §2 M13: 20 seeded runs)
  speeds: [0.02, 0.04, 0.06]   // m/s: measured belt speeds (src/policy/measure.js MEASURE.speeds)
};
/** Decision passes of a profile (the policy chose not to try); every other pass reason is timing or bin capacity. */
export const DECISION_PASS = ['unknown'];

/** Largest inflow (items/min) the belt takes at speed v (m/s): one item per LINE.spacing m. */
export const lambdaMax = (v) => 60 * v / LINE.spacing;
/** Belt position (m) of slot k. */
export const slotX = (k) => LINE.firstSlot + LINE.slot * k;

// ---------------- random numbers ----------------
/** mulberry32: a small seeded generator, uniform in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 32-bit finaliser (murmur3 fmix32 constants of the "lowbias32" variant). */
function fmix(h) {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Counter-based draw in [0, 1) of (seed, key, item, purpose): independent of the order in which draws are made, so
 *  a cell's draws do not depend on when the event loop happens to look at it. */
function u01(seed, key, item, purpose) {
  let h = fmix((seed >>> 0) ^ 0x9e3779b9);
  h = fmix(h ^ key); h = fmix((h + Math.imul(item + 1, 0x85ebca77)) >>> 0); h = fmix(h ^ Math.imul(purpose + 1, 0xc2b2ae35));
  return h / 4294967296;
}
/** FNV-1a of a string (cell keys). */
function strHash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
/** Draw keys of the cells: by policy, fraction set and rank among cells with the same policy and set (not by slot),
 *  so configurations that share cells also share their random draws (common random numbers: differences between
 *  configurations are not drowned in seed noise). */
export function cellKeys(cells) {
  const seen = {};
  return cells.map((c) => { const id = c.policy + '|' + c.fractions.slice().sort().join('+'); seen[id] = (seen[id] || 0) + 1; return strHash(id + '|' + seen[id]); });
}
const P_PASS = 1, P_PLAN = 2, P_REC = 3;   // draw purposes (plan and record are offset by 4 × the try number)

// ---------------- the profile as the cell model ----------------
/**
 * The DES view of one policy profile (src/policy/measure.js profileFrom). Per class: null when the profile has no
 * attempt of it (the cell cannot sort that class), else { window: [w0, w1], tg: [...] (t_grasp list), atts: [...]
 * (attempt records { tg, tr, y, outcome, end }), byBin: Map(bin → records), inWin: records, pass (probability),
 * cmin (shortest measured successful cycle, s) }.
 */
export function cellModel(profile) {
  if (!profile || !Array.isArray(profile.trials)) throw new Error('cellModel: not a profile');
  const out = { policy: profile.policy, speed: profile.speed, version: profile.version, n: profile.n, measured_at: profile.measured_at, source: profile.source, classes: {} };
  for (const c of CLASSES) {
    const trials = profile.trials.filter((t) => t.class === c);
    const s = profile.classes && profile.classes[c];
    const atts = [];
    for (const t of trials) t.attempts.forEach((a, i) => {
      if (a.t_grasp == null || a.t_return == null) return;
      atts.push({ tg: a.t_grasp, tr: a.t_return, y: a.y, outcome: a.outcome, end: i === t.attempts.length - 1 ? t.end : null });
    });
    const win = s && s.window_m;
    if (!trials.length || !atts.length || !win) { out.classes[c] = null; continue; }
    const byBin = new Map();
    for (const a of atts) if (a.y != null) {
      const k = Math.floor(a.y / LINE.yBin);
      if (!byBin.has(k)) byBin.set(k, []);
      byBin.get(k).push(a);
    }
    for (const [k, l] of byBin) if (l.length < LINE.minBin) byBin.delete(k);
    const inWin = atts.filter((a) => a.y != null && a.y >= win[0] && a.y <= win[1]);
    const ok = atts.filter((a) => a.outcome === 'success').map((a) => a.tg + a.tr);
    const passes = trials.filter((t) => t.pass && DECISION_PASS.includes(t.pass)).length;
    out.classes[c] = { window: win.slice(), tg: atts.map((a) => a.tg), atts, byBin, inWin: inWin.length ? inWin : atts,
      pass: passes / trials.length, cmin: ok.length ? Math.min(...ok) : Infinity, trials: trials.length };
  }
  return out;
}
// ---------------- event queue ----------------
class Heap {
  constructor() { this.a = []; this.seq = 0; }
  get size() { return this.a.length; }
  push(t, e) {
    e.t = t; e.q = this.seq++;
    const a = this.a; a.push(e);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (Heap.lt(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && Heap.lt(a[l], a[m])) m = l;
        if (r < a.length && Heap.lt(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
  static lt(x, y) { return x.t < y.t || (x.t === y.t && x.q < y.q); }
}

// ---------------- configuration ----------------
/** Normalised mix: weights per class (missing = 0), summing to 1. */
export function normMix(mix) {
  const w = CLASSES.map((c) => Math.max(0, (mix && +mix[c]) || 0)), s = w.reduce((a, b) => a + b, 0);
  if (!(s > 0)) throw new Error('mix: no class with a positive weight');
  return Object.fromEntries(CLASSES.map((c, i) => [c, w[i] / s]));
}
/**
 * Problems of a line configuration with these profiles ({ [policy]: profile }), as a list (empty = runnable).
 * config: { v (m/s), lambda (items/min), mix, arrivals: 'poisson' | 'uniform', jitter (0–1, uniform only),
 *           cells: [{ x (m), fractions: [...], policy }], length?, horizon?, warmup?, count? }
 */
export function validateLine(config, profiles) {
  const bad = [], L = config.length || LINE.length;
  if (!(config.v > 0)) bad.push('v must be > 0');
  if (!(config.lambda > 0)) bad.push('lambda must be > 0');
  if (config.arrivals && !['poisson', 'uniform'].includes(config.arrivals)) bad.push('arrivals: poisson or uniform');
  if (config.jitter != null && !(config.jitter >= 0 && config.jitter <= 1)) bad.push('jitter must be in [0, 1]');
  try { normMix(config.mix); } catch (e) { bad.push(e.message); }
  const cells = config.cells || [];
  if (cells.length > LINE.maxCells) bad.push(`at most ${LINE.maxCells} cells`);
  cells.forEach((c, i) => {
    const p = profiles && profiles[c.policy];
    if (!p) { bad.push(`cell ${i + 1}: no profile for policy ${c.policy}`); return; }
    if (Math.abs(p.speed - config.v) > 1e-9) bad.push(`cell ${i + 1}: the ${c.policy} profile was measured at ${p.speed} m/s, not ${config.v}`);
    if (!Array.isArray(c.fractions) || !c.fractions.length) bad.push(`cell ${i + 1}: no fraction`);
    else for (const f of c.fractions) if (!CLASSES.includes(f)) bad.push(`cell ${i + 1}: unknown fraction ${f}`);
    if (Array.isArray(c.fractions) && new Set(c.fractions).size !== c.fractions.length) bad.push(`cell ${i + 1}: a fraction twice`);
    for (const f of c.fractions || []) {
      const w = p.classes && p.classes[f] && p.classes[f].window_m;
      if (w && (c.x + w[0] < 0 || c.x + w[1] > L)) bad.push(`cell ${i + 1}: its ${f} window [${(c.x + w[0]).toFixed(2)}, ${(c.x + w[1]).toFixed(2)}] m leaves the belt`);
    }
  });
  return bad;
}

// ---------------- one run ----------------
/**
 * One seeded run. models: { [policy]: cellModel(profile) }. opts.trace: also return every attempt and item.
 * Returns counts in the measured window (see the header) and their per-minute rates.
 */
export function simulate(config, models, seed, opts = {}) {
  const v = config.v, L = config.length || LINE.length, mix = normMix(config.mix), tries = config.tries || LINE.tries;
  const batch = config.count != null, horizon = config.horizon || LINE.horizon;
  const t0 = batch ? 0 : (config.warmup != null ? config.warmup : L / v), t1 = batch ? Infinity : t0 + horizon;
  const inWin = (t) => t >= t0 && t <= t1;
  const head = LINE.spacing / v, period = 60 / config.lambda, jitter = config.arrivals === 'uniform' ? (config.jitter || 0) : 0;
  const ra = rng(fmix((seed >>> 0) ^ 0x2545f491)), cum = []; let acc = 0;
  for (const c of CLASSES) { acc += mix[c]; cum.push(acc); }
  const last = CLASSES.filter((c) => mix[c] > 0).at(-1);
  const drawClass = () => { const u = ra(); for (let i = 0; i < CLASSES.length; i++) if (u < cum[i] && mix[CLASSES[i]] > 0) return CLASSES[i]; return last; };

  const keys = cellKeys(config.cells || []);
  const cells = (config.cells || []).map((c, i) => {
    const model = models[c.policy];
    if (!model) throw new Error(`simulate: no model for policy ${c.policy}`);
    return { i, key: keys[i], x: c.x, fr: c.fractions.slice(), has: Object.fromEntries(c.fractions.map((f) => [f, model.classes[f]])), model,
      busy: false, token: 0, wakeAt: Infinity, busyT: 0, attempts: 0, outcomes: Object.fromEntries(OUTCOMES.map((k) => [k, 0])), sorted: 0 };
  });
  const N = cells.length;
  const zero = () => Object.fromEntries(CLASSES.map((c) => [c, 0]));
  const cnt = { offered: zero(), accepted: zero(), refused: zero(), sorted: zero(), lost: zero(), missed: zero(), contaminated: zero() };
  const bins = Object.fromEntries(CLASSES.map((c) => [c, { correct: 0, wrong: 0 }]));
  const q = new Heap(), items = [], attempts = opts.trace ? [] : null;
  let belt = [], lastAcc = -Infinity, k = 0, nAcc = 0;

  const count = (key, cls, t) => { if (inWin(t)) cnt[key][cls]++; };
  const pos = (it, t) => v * (t - it.tArr);
  /** Where cell c stands with item it at time t: null (never: not its fraction, passed, out of tries, past the
   *  window) or the predicted close y (local belt y). Draws the cell's decision and planned t_grasp once. */
  const look = (c, it, t) => {
    const m = c.has[it.cls];
    if (!m || it.tries[c.i] >= tries) return null;
    if (it.passed[c.i] === undefined) it.passed[c.i] = m.pass > 0 && u01(seed, c.key, it.id, P_PASS) < m.pass;
    if (it.passed[c.i]) return null;
    if (it.plan[c.i] === undefined) it.plan[c.i] = m.tg[Math.floor(u01(seed, c.key, it.id, P_PLAN + 4 * it.tries[c.i]) * m.tg.length)];
    const y = pos(it, t) - c.x + v * it.plan[c.i];
    return y > m.window[1] + 1e-12 ? null : y;
  };
  const setWake = (c, at) => { if (at < c.wakeAt) { c.wakeAt = at; c.token++; q.push(at, { k: 'wake', c, token: c.token }); } };
  const commit = (c, it, t, y) => {
    const m = c.has[it.cls], tg = it.plan[c.i];
    const pool = m.byBin.get(Math.floor(y / LINE.yBin)) || m.inWin;
    const rec = pool[Math.floor(u01(seed, c.key, it.id, P_REC + 4 * it.tries[c.i]) * pool.length)];
    it.state = 'held'; it.tries[c.i]++; it.plan[c.i] = undefined;
    c.busy = true; c.attempts++; c.wakeAt = Infinity; c.token++;
    const tEnd = t + tg + rec.tr;
    c.busyT += Math.max(0, Math.min(tEnd, t1) - Math.max(t, t0));
    if (attempts) attempts.push({ cell: c.i, item: it.id, cls: it.cls, t, y: Math.round(y * 1e4) / 1e4, tg, tr: rec.tr, outcome: rec.outcome });
    q.push(tEnd, { k: 'ready', c, it, rec });
  };
  /** Commit rule: the most downstream item of the cell's fractions whose predicted close lies in the window; else
   *  wake when the first one reaches it. */
  const scan = (c, t) => {
    if (c.busy) return;
    c.wakeAt = Infinity; c.token++;
    let wake = Infinity;
    for (const it of belt) {   // oldest first = most downstream first (one belt speed)
      if (it.state !== 'belt') continue;
      const y = look(c, it, t);
      if (y == null) continue;
      const w0 = c.has[it.cls].window[0];
      if (y < w0 - 1e-12) { wake = Math.min(wake, t + (w0 - y) / v); continue; }
      return commit(c, it, t, y);
    }
    if (wake < Infinity) setWake(c, wake);
  };
  const scanAll = (t) => { for (const c of cells) if (!c.busy) scan(c, t); };
  const deposit = (c, it, f, t) => {
    if (f === it.cls) { if (inWin(t)) { bins[f].correct++; c.sorted++; } count('sorted', it.cls, t); it.state = 'sorted'; }
    else { if (inWin(t)) bins[f].wrong++; count('contaminated', it.cls, t); it.state = 'bin:' + f; }
  };
  const nextArrival = (t) => {
    if (batch && nAcc >= config.count) return;
    let tn;
    if (config.arrivals === 'uniform') { k++; tn = k * period + (jitter ? jitter * period * (ra() - 0.5) : 0); }
    else tn = t - Math.log(1 - ra()) * period;
    if (tn <= t1) q.push(tn, { k: 'arrive' });
  };
  if (config.arrivals === 'uniform') q.push(Math.max(0, jitter ? jitter * period * (ra() - 0.5) : 0), { k: 'arrive' });
  else nextArrival(0);

  while (q.size) {
    const e = q.pop(), t = e.t;
    if (t > t1) break;
    if (e.k === 'arrive') {
      const cls = drawClass();
      count('offered', cls, t);
      if (t - lastAcc < head - 1e-9) count('refused', cls, t);
      else {
        lastAcc = t; nAcc++;
        count('accepted', cls, t);
        const it = { id: nAcc - 1, cls, tArr: t, state: 'belt', tries: new Array(N).fill(0), passed: new Array(N), plan: new Array(N) };
        items.push(it); belt.push(it);
        q.push(t + L / v, { k: 'end', it });
        // an idle cell already knows its next moment for the older items; the new one (most upstream) can only
        // bring it forward, or be in the window right away (a full scan then keeps the most-downstream rule)
        for (const c of cells) {
          if (c.busy) continue;
          const y = look(c, it, t);
          if (y == null) continue;
          const w0 = c.has[cls].window[0];
          if (y >= w0 - 1e-12) scan(c, t); else setWake(c, t + (w0 - y) / v);
        }
      }
      nextArrival(t);
    } else if (e.k === 'wake') {
      if (e.token === e.c.token) scan(e.c, t);
    } else if (e.k === 'end') {
      if (e.it.state === 'belt') { e.it.state = 'missed'; count('missed', e.it.cls, t); }
      if (belt.length > 64) belt = belt.filter((it) => it.state === 'belt' || it.state === 'held');
    } else if (e.k === 'ready') {
      const { c, it, rec } = e, o = rec.outcome;
      c.busy = false; if (inWin(t)) c.outcomes[o]++;
      let back = false;
      if (o === 'success') deposit(c, it, it.cls, t);
      else if (o === 'miss' || o === 'drop_belt') {
        if (pos(it, t) >= L) { it.state = 'missed'; count('missed', it.cls, t); }
        else { it.state = 'belt'; back = true; }
      } else if (o === 'knock_off' || o === 'drop_off') { it.state = 'lost'; count('lost', it.cls, t); }
      else {   // drop_other_bin, wrong_bin
        const endF = rec.end && rec.end.startsWith('bin_') ? rec.end.slice(4) : null;
        const f = endF && endF !== it.cls && endF in c.has ? endF : c.fr.find((x) => x !== it.cls);
        if (f) deposit(c, it, f, t); else { it.state = 'lost'; count('lost', it.cls, t); }
      }
      if (back) scanAll(t); else scan(c, t);
    }
  }

  const minutes = batch ? null : horizon / 60, sum = (o) => CLASSES.reduce((a, c) => a + o[c], 0);
  const tot = Object.fromEntries(Object.keys(cnt).map((k2) => [k2, sum(cnt[k2])]));
  const dep = CLASSES.reduce((a, c) => a + bins[c].correct + bins[c].wrong, 0);
  const fates = (c) => cnt.sorted[c] + cnt.missed[c] + cnt.lost[c] + cnt.contaminated[c];
  const res = {
    seed, minutes, counts: cnt, totals: tot,
    purity: dep ? tot.sorted / dep : null,
    bins: Object.fromEntries(CLASSES.map((c) => [c, { correct: bins[c].correct, wrong: bins[c].wrong, purity: bins[c].correct + bins[c].wrong ? bins[c].correct / (bins[c].correct + bins[c].wrong) : null }])),
    // recovery: of the items of a class whose fate fell in the window, the share sorted into their own bin
    recovery: Object.fromEntries(CLASSES.map((c) => [c, fates(c) ? cnt.sorted[c] / fates(c) : null])),
    cells: cells.map((c) => ({ x: c.x, fractions: c.fr, policy: c.model.policy, attempts: c.attempts, outcomes: c.outcomes, sorted: c.sorted, utilisation: batch ? null : c.busyT / horizon }))
  };
  if (!batch) {
    const per = (n) => n / minutes;
    res.rate = { offered: per(tot.offered), accepted: per(tot.accepted), refused: per(tot.refused), sorted: per(tot.sorted),
      missed: per(tot.missed), lost: per(tot.lost), contaminated: per(tot.contaminated) };
    res.missedByClass = Object.fromEntries(CLASSES.map((c) => [c, per(cnt.missed[c] + cnt.lost[c])]));
  }
  if (opts.trace) { res.attempts = attempts; res.items = items.map((it) => ({ id: it.id, cls: it.cls, tArr: it.tArr, state: it.state })); }
  return res;
}

// ---------------- many seeds ----------------
/** Quantile (type 7) of a list. */
export function quantile(list, p) {
  const s = list.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}
export function stats(list) {
  const s = list.filter((x) => x != null && Number.isFinite(x));
  return { mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : null, p5: quantile(s, 0.05), p10: quantile(s, 0.1), p50: quantile(s, 0.5), p95: quantile(s, 0.95), n: s.length };
}
/** Seeds of a configuration: 1 … n (the same for every configuration, so configurations share their arrivals). */
export const seedsOf = (n = LINE.seeds) => Array.from({ length: n }, (_, i) => i + 1);

/**
 * The line over many seeds. profiles: { [policy]: profile at config.v }. Returns { config, runs, summary } with
 * summary metrics as { mean, p5, p10, p50, p95 } across seeds (design §6 outputs).
 */
export function runLine(config, profiles, opts = {}) {
  const bad = validateLine(config, profiles);
  if (bad.length) throw new Error('line: ' + bad.join('; '));
  const models = opts.models || Object.fromEntries(Object.entries(profiles).map(([k, p]) => [k, cellModel(p)]));
  const runs = (opts.seeds || seedsOf()).map((s) => simulate(config, models, s));
  return { config, runs, summary: summarize(runs) };
}
export function summarize(runs) {
  const batch = runs[0] && runs[0].minutes == null;
  const S = (f) => stats(runs.map(f));
  const out = {
    seeds: runs.length,
    purity: S((r) => r.purity),
    recovery: Object.fromEntries(CLASSES.map((c) => [c, S((r) => r.recovery[c])])),
    binPurity: Object.fromEntries(CLASSES.map((c) => [c, S((r) => r.bins[c].purity)])),
    cells: (runs[0] ? runs[0].cells : []).map((_, i) => ({ utilisation: batch ? null : S((r) => r.cells[i].utilisation), sorted: S((r) => r.cells[i].sorted) }))
  };
  if (batch) {
    out.sorted = S((r) => r.totals.sorted); out.accepted = S((r) => r.totals.accepted);
    out.missed = S((r) => r.totals.missed); out.lost = S((r) => r.totals.lost); out.contaminated = S((r) => r.totals.contaminated);
  } else {
    for (const k of ['offered', 'accepted', 'refused', 'sorted', 'missed', 'lost', 'contaminated']) out[k] = S((r) => r.rate[k]);
    out.missedByClass = Object.fromEntries(CLASSES.map((c) => [c, S((r) => r.missedByClass[c])]));
  }
  return out;
}

// ---------------- orders and the N_min search ----------------
/**
 * Does a summary meet an order { F (sorted items/min), X (purity, 0–1) }? win: mean output ≥ F and mean purity ≥ X;
 * reliable (★ spolehlivě): the 10th percentile of both meets them too.
 */
export function meets(summary, order) {
  const pur = summary.purity, out = summary.sorted;
  const win = out.mean != null && out.mean >= order.F - 1e-9 && pur.mean != null && pur.mean >= order.X - 1e-9;
  const reliable = win && out.p10 >= order.F - 1e-9 && pur.p10 >= order.X - 1e-9;
  return { win, reliable };
}

/** Fraction sets a cell can sort in an order: every class of the mix alone and every pair (two bins per cell). */
export function fractionSets(mix) {
  const m = normMix(mix), cl = CLASSES.filter((c) => m[c] > 0), out = cl.map((c) => [c]);
  for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) out.push([cl[i], cl[j]]);
  return out;
}

/**
 * Per-seed upper bounds on the sorted output (items/min) of any configuration at one speed and inflow: the items of
 * each class the belt accepted in the measured window or in the belt time before it (those could still be on the
 * belt when counting starts, plus one minute for an attempt still running). The arrivals of a seed do not depend on the cells, so this holds for every
 * configuration. Returns [{ paper, plastic, glass, metal }] per seed.
 */
export function arrivalBounds(config, seeds) {
  const L = config.length || LINE.length, T = config.horizon || LINE.horizon, w = config.warmup != null ? config.warmup : L / config.v;
  return seeds.map((sd) => {
    // + 60 s: an attempt that started on an item before its belt time ran out ends at most one cycle later
    const back = Math.min(w, L / config.v + 60);
    const r = simulate(Object.assign({}, config, { cells: [], warmup: w - back, horizon: T + back }), {}, sd);
    return Object.fromEntries(CLASSES.map((c) => [c, r.counts.accepted[c] / (T / 60)]));
  });
}
/** Upper bound (items/min) of one configuration on one seed: no cell sorts faster than its shortest measured
 *  successful cycle (cmin), and no class more than the belt brought of it (arrivalBounds). Exact: used only to skip
 *  configurations that cannot pass. */
export function upperBound(sets, model, bound, minutes = LINE.horizon / 60) {
  // a cell busy since before the window can finish one more item in it: + 1 per window
  const cap = sets.map((fs) => { const c = Math.min(...fs.map((f) => (model.classes[f] ? model.classes[f].cmin : Infinity))); return Number.isFinite(c) ? 60 / c + 1 / minutes : 0; });
  let byClass = 0;
  for (const c of CLASSES) {
    const k = sets.reduce((a, fs, i) => a + (fs.includes(c) ? cap[i] : 0), 0);
    byClass += Math.min(bound[c], k);
  }
  return Math.min(byClass, cap.reduce((a, b) => a + b, 0));
}

/** Every configuration of n cells over the fraction sets `sets`: each cell one set, in every order along the belt
 *  (an upstream cell sees an item first, and cells 0.5 m apart still meet at the edges of their reservations, so
 *  the order is searched too). */
export function* configurations(sets, n) {
  const K = sets.length, idx = new Array(n).fill(0);
  for (;;) {
    yield idx.map((j) => sets[j]);
    let p = n - 1;
    while (p >= 0 && ++idx[p] === K) idx[p--] = 0;
    if (p < 0) return;
  }
}

function lineConfig(order, v, lambda, cs, opts) {
  const policy = order.policy || 'skript';
  return { v, lambda, mix: order.mix, arrivals: order.arrivals || 'poisson', jitter: order.jitter, horizon: opts.horizon,
    cells: cs.map((fs, i) => ({ x: slotX(i), fractions: fs, policy })) };
}
function profileAt(profiles, policy, v) {
  const p = profiles[policy];
  if (!p) throw new Error('no profile for ' + policy);
  const q = p.trials ? p : p[v];
  if (!q || Math.abs(q.speed - v) > 1e-9) throw new Error(`no ${policy} profile at ${v} m/s`);
  return q;
}

/**
 * N_min: the smallest number of cells for which some configuration meets the order, by exhaustive search.
 * order: { F, X, mix, policy (default 'skript'), v | vs: [...], lambda | lambdas: [...], arrivals, jitter }.
 * profiles: { [policy]: { [speed]: profile } } or, with one speed, { [policy]: profile }.
 * Configurations: n cells in slots 0 … n − 1 (slotX), each sorting one fraction set of fractionSets, in every order
 * along the belt (configurations()), at every speed and inflow of the order. Not searched: gaps between cells (the
 * player may leave slots empty; that only shifts when a cell meets an item another cell has just released). Each runs on the same seeds (opts.seeds, default 1 … LINE.seeds); a configuration is
 * dropped once even the upper bound on its remaining seeds could not lift the mean to F (and skipped when the bound
 * alone is below F). Returns { n, best: { config, summary, reliable }, passing (count at n), evaluated, skipped,
 * perN: [{ n, evaluated, passing }] }, or n = null with reason: 'inflow' (the belt brings fewer than F items/min;
 * `reach` says how many), 'cells' (no configuration of 1 … maxN cells meets it) or 'budget' (more than
 * opts.budget configurations would have to run; the search stopped and proves nothing).
 * The best passing configuration prefers ★ spolehlivě (p10 meets the order), then the higher mean output.
 */
export function searchNmin(order, profiles, opts = {}) {
  const policy = order.policy || 'skript', seeds = opts.seeds || seedsOf(), maxN = opts.maxN || LINE.maxCells, budget = opts.budget != null ? opts.budget : 2e4;
  const vs = order.vs || [order.v], lambdas = order.lambdas || [order.lambda], sets = fractionSets(order.mix), S = seeds.length;
  const perN = [], F = order.F - 1e-9, ctx = [];
  for (const v of vs) {
    const model = cellModel(profileAt(profiles, policy, v));
    for (const lambda of lambdas) {
      const bounds = arrivalBounds(lineConfig(order, v, lambda, [], opts), seeds);
      // with every class covered by unlimited cells the output is still at most what the belt brings
      const reach = bounds.reduce((a, b) => a + CLASSES.reduce((x, c) => x + b[c], 0), 0) / S;
      ctx.push({ v, lambda, model, bounds, reach });
    }
  }
  let evaluated = 0, skipped = 0;
  const live = ctx.filter((c) => c.reach >= F);
  if (!live.length) return { n: null, best: null, passing: 0, evaluated, skipped, perN, reason: 'inflow', reach: Math.max(...ctx.map((c) => c.reach)) };
  for (let n = 1; n <= maxN; n++) {
    let best = null, passing = 0, ev = 0;
    for (const { v, lambda, model, bounds } of live) {
      const models = { [policy]: model };
      for (const cs of configurations(sets, n)) {
        const ub = bounds.map((b) => upperBound(cs, model, b, (opts.horizon || LINE.horizon) / 60));
        let rest = ub.reduce((a, b) => a + b, 0);
        if (rest / S < F) { skipped++; continue; }
        if (evaluated >= budget) return { n: null, best: null, passing: 0, evaluated, skipped, perN, reason: 'budget' };
        const config = lineConfig(order, v, lambda, cs, opts), runs = [];
        ev++; evaluated++;
        let sum = 0, dead = false;
        for (let i = 0; i < S; i++) {
          const r = simulate(config, models, seeds[i]);
          runs.push(r); sum += r.rate.sorted; rest -= ub[i];
          if ((sum + rest) / S < F) { dead = true; break; }
        }
        if (dead) continue;
        const summary = summarize(runs), m = meets(summary, order);
        if (!m.win) continue;
        passing++;
        if (!best || (m.reliable && !best.reliable) || (m.reliable === best.reliable && summary.sorted.mean > best.summary.sorted.mean)) best = { config, summary, reliable: m.reliable };
      }
    }
    perN.push({ n, evaluated: ev, passing });
    if (best) return { n, best, passing, evaluated, skipped, perN };
  }
  return { n: null, best: null, passing: 0, evaluated, skipped, perN, reason: 'cells' };
}

/** The highest mean sorted output (items/min) of any configuration of n cells at one speed and inflow, and that
 *  configuration (the capacity curve the hint ladder can quote). */
export function bestOf(order, profiles, n, opts = {}) {
  const policy = order.policy || 'skript', seeds = opts.seeds || seedsOf();
  const model = cellModel(profileAt(profiles, policy, order.v)), models = { [policy]: model };
  let best = null, evaluated = 0;
  for (const cs of configurations(fractionSets(order.mix), n)) {
    const config = lineConfig(order, order.v, order.lambda, cs, opts);
    const s = summarize(seeds.map((sd) => simulate(config, models, sd)));
    evaluated++;
    if (!best || s.sorted.mean > best.summary.sorted.mean) best = { config, summary: s };
  }
  return Object.assign({ evaluated }, best);
}
