// Mission 13 "Třídění odpadu III: Navrhněte linku" (waste_line): the order cards ("zakázky") and the rules of the
// mission that do not need the page. Pure: no DOM, no MuJoCo.
//
// An order fixes the belt speed v (a measured speed only), the inflow λ (items/min, evenly spaced arrivals), the mix
// (the mission 11 batch), the target output F (sorted items/min) and purity X. The player chooses the number of cells,
// their slots along the belt and the fractions each one sorts (two bins per cell). Every order carries N_min, the
// fewest cells for which some configuration meets it, from the exhaustive search of src/line/des.js (searchNmin), run
// offline by `node sim/so101/tools/line.mjs orders --write` into src/line/nmin.js. tests/line-orders.test.mjs runs the
// search again and checks the stored record, so N_min (and the ★ it gives) always follows the committed profiles.
// Only orders whose N_min the search proved are listed (no budget stop, no "not reachable").
//
// Choice of the four orders (numbers from the stored search, src/line/nmin.js; uniform arrivals, X = 95 %):
//   A  2 cm/s, λ 9,  F 6:   N_min 2, 54 of the 100 two-cell lines pass (most pairings work)
//   B  6 cm/s, λ 30, F 12:  N_min 3, 769 of the 1000 three-cell lines pass (the fastest measured belt)
//   C  2 cm/s, λ 15, F 12:  N_min 3, 302 of the 1000 three-cell lines pass (the design's "12/min at 2 cm/s"; it needs
//                           uniform arrivals: with Poisson arrivals the belt accepts too few, design §6 / PR 8)
//   D  4 cm/s, λ 30, F 12:  N_min 2, 1 of the 100 two-cell lines passes (three cells meet it easily)
// Easy → hard by the share of N_min-cell lines that pass (A has the fewest cells; B, C, D fall from 77 % to 1 %).

import { LINE, CLASSES, slotX, lambdaMax, searchNmin, bestOf, seedsOf, meets } from './des.js';
import { M11_MIX } from './explain.js';
import { NMIN } from './nmin.js';

/** What every order shares: evenly spaced arrivals (no refusal surprises), the mission 11 mix, the Skript profiles. */
export const ORDER_COMMON = { arrivals: 'uniform', jitter: 0, mix: M11_MIX, policy: 'skript', X: 0.95 };
/** The orders as written (the search record is added from nmin.js). */
export const ORDER_DEFS = [
  { id: 'A', v: 0.02, lambda: 9, F: 6 },
  { id: 'B', v: 0.06, lambda: 30, F: 12 },
  { id: 'C', v: 0.02, lambda: 15, F: 12 },
  { id: 'D', v: 0.04, lambda: 30, F: 12 }
];
/** The N_min search settings used for the stored records (the defaults of tools/line.mjs nmin). */
export const SEARCH = { budget: 2e4, seeds: LINE.seeds, maxN: LINE.maxCells };
/** Cells sort at most this many fractions (two bins per cell, design §3). */
export const MAX_FRACTIONS = 2;

export const ORDERS = ORDER_DEFS.map((d) => Object.freeze(Object.assign({}, ORDER_COMMON, d, { search: NMIN[d.id] || null })));
export const orderById = (id) => ORDERS.find((o) => o.id === id) || null;

const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

/**
 * The N_min search of one order, as stored in nmin.js. profiles: { [speed]: profile } of the order's policy.
 * Returns { n, evaluated, skipped, passing, total (configurations of n cells), perN, best: { cells, sorted, purity,
 * reliable }, cap1: { cells, sorted } (the best single cell: the capacity the hint quotes), accepted (items/min the
 * belt takes), profile: { version, measured_at, n } }.
 */
export function searchOrder(def, profiles) {
  const o = Object.assign({}, ORDER_COMMON, def), prof = { [o.policy]: profiles }, seeds = seedsOf(SEARCH.seeds);
  const order = { F: o.F, X: o.X, mix: o.mix, v: o.v, lambda: o.lambda, arrivals: o.arrivals, jitter: o.jitter, policy: o.policy };
  const r = searchNmin(order, prof, { seeds, maxN: SEARCH.maxN, budget: SEARCH.budget });
  const cap = bestOf(order, prof, 1, { seeds }), p = profiles[o.v];
  const sets = CLASSES.length + CLASSES.length * (CLASSES.length - 1) / 2;
  return {
    n: r.n, reason: r.reason || null, evaluated: r.evaluated, skipped: r.skipped, passing: r.passing,
    total: r.n == null ? null : Math.pow(sets, r.n), perN: r.perN,
    best: r.best ? { cells: r.best.config.cells.map((c) => c.fractions.slice()), sorted: r3(r.best.summary.sorted.mean), p5: r3(r.best.summary.sorted.p5), p95: r3(r.best.summary.sorted.p95), purity: r3(r.best.summary.purity.mean), reliable: r.best.reliable } : null,
    cap1: { cells: cap.config.cells[0].fractions.slice(), sorted: r3(cap.summary.sorted.mean) },
    accepted: r3(cap.summary.accepted.mean),
    profile: { version: p.version, measured_at: p.measured_at, n: p.n }
  };
}

/** The DES configuration of a line: cells = [{ slot, fractions }] (slots 0 … LINE.maxCells − 1). */
export function lineConfig(order, cells) {
  return { v: order.v, lambda: order.lambda, mix: order.mix, arrivals: order.arrivals, jitter: order.jitter,
    cells: cells.slice().sort((a, b) => a.slot - b.slot).map((c) => ({ x: slotX(c.slot), fractions: c.fractions.slice(), policy: order.policy })) };
}

/** Problems of the player's line (empty = runnable). Codes, so the page can word them. */
export function lineProblems(cells) {
  const bad = [], seen = new Set();
  if (!cells.length) bad.push({ code: 'empty' });
  for (const c of cells) {
    if (!(Number.isInteger(c.slot) && c.slot >= 0 && c.slot < LINE.maxCells) || seen.has(c.slot)) bad.push({ code: 'slot', slot: c.slot });
    seen.add(c.slot);
    if (!c.fractions.length) bad.push({ code: 'nofraction', slot: c.slot });
    if (c.fractions.length > MAX_FRACTIONS || new Set(c.fractions).size !== c.fractions.length || c.fractions.some((f) => !CLASSES.includes(f))) bad.push({ code: 'fractions', slot: c.slot });
  }
  return bad;
}

/**
 * Stars of a line run (team lead's rule for mission 13): ★ splněno = the order is met (mean output ≥ F at mean purity
 * ≥ X, des.js meets); ★ čistota = purity ≥ X in every one of the seeded runs, not only on average; ★ minimum robotů =
 * N ≤ N_min (the stored search). The two extra stars count only with the first one. runs: the per-seed runs
 * (purity of each), summary: their summary.
 */
export function lineStars(order, summary, runs, n) {
  const win = meets(summary, order).win;
  const minPurity = runs.reduce((a, r) => Math.min(a, r.purity == null ? 0 : r.purity), Infinity);
  const purity = Number.isFinite(minPurity) && minPurity >= order.X - 1e-9;
  const nmin = order.search && order.search.n;
  const fewest = nmin != null && n <= nmin;
  return { win, purity, fewest, minPurity: Number.isFinite(minPurity) ? minPurity : null, nmin, stars: win ? 1 + (purity ? 1 : 0) + (fewest ? 1 : 0) : 0 };
}

/** How many cells at least, from the best single cell's capacity (the hint's "⌈F / c⌉"). */
export const cellsAtLeast = (order) => (order.search && order.search.cap1.sorted > 0 ? Math.ceil(order.F / order.search.cap1.sorted - 1e-9) : null);

/** Histogram of values in `bins` equal bins over [lo, hi] (values outside are clamped into the end bins). */
export function histogram(values, lo, hi, bins) {
  const out = new Array(bins).fill(0), w = (hi - lo) / bins;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const k = w > 0 ? Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w + 1e-9))) : 0;
    out[k]++;
  }
  return out;
}

/** The player's own runs of the orders (localStorage, outside data): only well-formed records survive. */
export const RUNS_VER = 1, RUNS_MAX = 50;
export function cleanRuns(j) {
  const out = {};
  if (!j || j.v !== RUNS_VER || typeof j.orders !== 'object' || !j.orders) return out;
  for (const o of ORDERS) {
    const l = Array.isArray(j.orders[o.id]) ? j.orders[o.id] : [];
    out[o.id] = l.filter((r) => r && Number.isInteger(r.n) && r.n >= 1 && r.n <= LINE.maxCells && [r.sorted, r.purity, r.missed].every((x) => Number.isFinite(x) && x >= 0) && r.purity <= 1)
      .slice(-RUNS_MAX).map((r) => ({ n: r.n, sorted: r.sorted, purity: r.purity, missed: r.missed, win: !!r.win }));
  }
  return out;
}

/** Belt maximum of an order's speed (items/min), as the des.js refusal rule has it. */
export const beltMax = (order) => lambdaMax(order.v);
