// Mission 13 orders and rules (src/line/orders.js, src/line/nmin.js, src/line/copy.js, src/missions.js):
//   - the stored N_min search of every order is what the search gives now on the committed profiles
//     (regenerate: node sim/so101/tools/line.mjs orders --write);
//   - only proven orders (no budget stop, no "not reachable"), uniform arrivals, measured speeds, λ within the belt;
//   - the stored best line passes when the page's configuration of it runs; one cell fewer cannot;
//   - stars: ★ met, ★ reserve (p10 output ≥ F), ★ N ≤ N_min; which orders have an N_min line with the reserve (and
//     that one more cell gives it where none has); the mission check and rate;
//   - histogram, own-run records, the line checks; every page string has its English entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDERS, ORDER_DEFS, ORDER_COMMON, SEARCH, searchOrder, lineConfig, lineProblems, lineStars, reserveAtNmin, cellsAtLeast, histogram, cleanRuns, RUNS_VER, RUNS_MAX, beltMax } from '../src/line/orders.js';
import { NMIN } from '../src/line/nmin.js';
import { LINE, runLine, lambdaMax, fractionSets, bestOf } from '../src/line/des.js';
import { COPY, PLURAL, VENDOR_SOURCES } from '../src/line/copy.js';
import { MISSIONS, lineCheck } from '../src/missions.js';
import { loadProfiles, ordersModule } from '../tools/line.mjs';
import en from '../src/i18n/en.js';

const P = loadProfiles('skript');

test('every order is stored, proven, uniform, at a measured speed and within the belt', () => {
  assert.deepEqual(Object.keys(NMIN).sort(), ORDER_DEFS.map((d) => d.id).sort());
  assert.ok(ORDERS.length >= 3 && ORDERS.length <= 4);
  for (const o of ORDERS) {
    assert.equal(o.arrivals, 'uniform', o.id); assert.equal(o.jitter, 0, o.id);
    assert.ok(LINE.speeds.includes(o.v) && P[o.v], `${o.id}: measured speed with a committed profile`);
    assert.ok(o.lambda > 0 && o.lambda <= lambdaMax(o.v) + 1e-9, `${o.id}: λ ${o.lambda} within the belt maximum ${lambdaMax(o.v)}`);
    assert.ok(o.lambda >= o.F, `${o.id}: the inflow can bring F`);
    const s = o.search;
    assert.ok(s && Number.isInteger(s.n) && s.n >= 1 && s.n <= LINE.maxCells && s.reason === null, `${o.id}: N_min proven (${s && s.reason})`);
    assert.ok(s.evaluated <= SEARCH.budget, `${o.id}: within the search budget`);
    assert.equal(s.total, fractionSets(o.mix).length ** s.n);
    assert.ok(s.passing >= 1 && s.passing <= s.total);
    assert.equal(s.profile.version, P[o.v].version, `${o.id}: searched on the committed profile`);
    assert.equal(s.profile.measured_at, P[o.v].measured_at);
  }
});

test('easy → hard: the share of N_min-cell lines that pass falls after the first order', () => {
  const share = ORDERS.map((o) => o.search.passing / o.search.total);
  assert.ok(ORDERS[0].search.n <= Math.min(...ORDERS.map((o) => o.search.n)), 'the first order needs the fewest cells');
  for (let i = 2; i < ORDERS.length; i++) assert.ok(share[i] < share[i - 1], `${ORDERS[i].id} harder than ${ORDERS[i - 1].id}: ${share.map((x) => x.toFixed(2))}`);
});

test('the stored N_min search is what the search gives on the committed profiles (regenerated)', { timeout: 600000 }, () => {
  const fresh = Object.fromEntries(ORDER_DEFS.map((d) => [d.id, searchOrder(d, P)]));
  assert.deepEqual(JSON.parse(JSON.stringify(fresh)), NMIN, 'run: node sim/so101/tools/line.mjs orders --write');
  assert.ok(ordersModule(fresh).includes('export const NMIN'));
});

test('the stored best line passes as the page runs it; the capacity hint is consistent', () => {
  for (const o of ORDERS) {
    const cells = o.search.best.cells.map((f, i) => ({ slot: i, fractions: f }));
    assert.deepEqual(lineProblems(cells), []);
    const r = runLine(lineConfig(o, cells), { skript: P[o.v] });
    const st = lineStars(o, r.summary, cells.length);
    assert.ok(st.win && st.fewest && st.stars >= 2, `${o.id}: ${r.summary.sorted.mean}`);
    // the search prefers a line with the reserve: the stored best has it exactly when some N_min line has
    assert.equal(st.reserve, reserveAtNmin(o), `${o.id}: p10 ${r.summary.sorted.p10} vs F ${o.F}`);
    assert.ok(Math.abs(r.summary.sorted.p10 - o.search.best.p10) < 1e-3);
    assert.ok(Math.abs(r.summary.sorted.mean - o.search.best.sorted) < 1e-3);
    // the hint "⌈F / one cell⌉" never asks for more cells than N_min
    assert.ok(cellsAtLeast(o) <= o.search.n, `${o.id}: ${cellsAtLeast(o)} ≤ ${o.search.n}`);
  }
});

test('stars: met, reserve (p10 output ≥ F), N ≤ N_min; nothing extra without the order met', () => {
  const o = ORDERS[0], S = (mean, p10, pur) => ({ sorted: { mean, p10 }, purity: { mean: pur, p10: pur } });
  const ok = lineStars(o, S(o.F + 1, o.F, 1), o.search.n);
  assert.deepEqual([ok.win, ok.reserve, ok.fewest, ok.stars], [true, true, true, 3]);
  const more = lineStars(o, S(o.F + 1, o.F, 1), o.search.n + 1);
  assert.deepEqual([more.fewest, more.stars], [false, 2]);
  const thin = lineStars(o, S(o.F + 0.2, o.F - 0.3, 1), o.search.n);
  assert.deepEqual([thin.win, thin.reserve, thin.p10, thin.stars], [true, false, o.F - 0.3, 2]);
  const short = lineStars(o, S(o.F - 0.5, o.F - 1, 1), 1);
  assert.deepEqual([short.win, short.reserve, short.stars], [false, false, 0]);
  // purity below X still fails the order, even with output and reserve to spare
  const impure = lineStars(o, S(o.F + 1, o.F + 1, o.X - 0.01), 1);
  assert.deepEqual([impure.win, impure.reserve, impure.stars], [false, false, 0]);
});

test('reserve at N_min: stored per order; where no N_min line has it, one more cell does', () => {
  for (const o of ORDERS) {
    const s = o.search;
    assert.ok(Number.isInteger(s.reserve) && s.reserve >= 0 && s.reserve <= s.passing, o.id);
    assert.equal(reserveAtNmin(o), s.reserve > 0);
    assert.equal(s.best.p10 >= o.F - 1e-9, s.reserve > 0, `${o.id}: best p10 ${s.best.p10}`);
    if (s.reserve > 0) continue;
    const b = bestOf(o, { skript: P }, s.n + 1);
    assert.ok(b.summary.sorted.p10 >= o.F, `${o.id}: ${s.n + 1} cells keep the reserve (p10 ${b.summary.sorted.p10})`);
  }
  // the orders as chosen: every order but D has an N_min line with the reserve (src/line/orders.js header)
  assert.deepEqual(ORDERS.filter((o) => !reserveAtNmin(o)).map((o) => o.id), ['D']);
});

test('mission 13: entry, check and rate', () => {
  const m = MISSIONS.find((x) => x.id === 'waste_line');
  assert.ok(m && m.n === '13' && m.scene === 'conveyor' && m.line && !m.belt, 'conveyor scene, no batch, no Pás control');
  assert.equal(MISSIONS[MISSIONS.length - 1].id, 'waste_line');
  const w = { belt: {} };
  assert.deepEqual(lineCheck({ w }), { text: '' });
  const r = lineCheck({ w, line: { text: 'x', won: true, ok: true, stats: { stars: 3 } } });
  assert.ok(r.won && r.ok && r.stats.stars === 3);
  assert.equal(m.rate(10, 0, { stars: 2 }), 2);
  assert.equal(m.rate(10, 0, null), 1);
  assert.equal(typeof m.hints.ghost.text, 'function');
});

test('line checks: empty, slots, fractions', () => {
  assert.deepEqual(lineProblems([]).map((p) => p.code), ['empty']);
  assert.deepEqual(lineProblems([{ slot: 0, fractions: [] }]).map((p) => p.code), ['nofraction']);
  assert.deepEqual(lineProblems([{ slot: 0, fractions: ['paper', 'glass', 'metal'] }]).map((p) => p.code), ['fractions']);
  assert.deepEqual(lineProblems([{ slot: 0, fractions: ['paper'] }, { slot: 0, fractions: ['glass'] }]).map((p) => p.code), ['slot']);
  assert.deepEqual(lineProblems([{ slot: LINE.maxCells, fractions: ['paper'] }]).map((p) => p.code), ['slot']);
  // the page's configuration: slot positions, sorted along the belt, the order's policy
  const c = lineConfig(ORDERS[0], [{ slot: 3, fractions: ['glass'] }, { slot: 1, fractions: ['paper', 'metal'] }]);
  assert.deepEqual(c.cells.map((x) => x.x), [0.75, 1.75]);
  assert.equal(c.arrivals, ORDER_COMMON.arrivals);
  assert.equal(beltMax(ORDERS[0]), lambdaMax(ORDERS[0].v));
});

test('histogram and own-run records', () => {
  assert.deepEqual(histogram([1, 2, 2, 8, 9, -3, NaN], 0.5, 8.5, 8), [2, 2, 0, 0, 0, 0, 0, 2]);
  assert.deepEqual(histogram([1, 1], 1, 1, 3), [2, 0, 0]);
  const good = { n: 2, sorted: 8.7, purity: 1, missed: 0.2, win: true };
  const j = { v: RUNS_VER, orders: { A: [good, { n: 0, sorted: 1, purity: 1, missed: 0 }, { n: 2, sorted: -1, purity: 1, missed: 0 }, { n: 2, sorted: 1, purity: 1.2, missed: 0 }, null], B: 'x' } };
  const out = cleanRuns(j);
  assert.deepEqual(out.A, [good]);
  assert.deepEqual(out.B, []);
  assert.deepEqual(cleanRuns({ v: 99, orders: {} }), {});
  assert.equal(cleanRuns({ v: RUNS_VER, orders: { A: Array(RUNS_MAX + 5).fill(good) } }).A.length, RUNS_MAX);
});

test('every mission 13 string has its English entry with the same placeholders', () => {
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const all = [...Object.values(COPY), ...Object.values(PLURAL).flat()];
  const m = MISSIONS.find((x) => x.id === 'waste_line');
  all.push(m.title, m.short, m.desc, m.strategy, m.advice, m.done, m.starsHint, m.hints.ghost.next, m.hints.partial.next);
  const miss = all.filter((s) => !(s in en.strings));
  assert.deepEqual(miss, [], 'add to src/i18n/en.js');
  for (const s of all) assert.equal(ph(en.strings[s]), ph(s), 'placeholders of: ' + s);
  for (const v of VENDOR_SOURCES) assert.match(v.href, /^https:\/\//);
});
