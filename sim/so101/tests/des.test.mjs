// Line model of mission 13 (src/line/des.js): analytic cases that pin the engine (design "Třídění odpadu" §6),
// seed reproducibility, the reserve rule, window/commit, refused arrivals, failure handling, the N_min search, and
// the committed profiles as input. Synthetic profiles use the profile shape of src/policy/measure.js profileFrom.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LINE, CLASSES, lambdaMax, slotX, cellModel, simulate, runLine, summarize, validateLine, searchNmin, meets,
  configurations, fractionSets, arrivalBounds, upperBound, seedsOf, quantile
} from '../src/line/des.js';
import { EXPLAIN, M11_BATCH } from '../src/line/explain.js';
import { BELT_PICK } from '../src/objects/beltpick.js';
import { MEASURE, validateProfile } from '../src/policy/measure.js';
import { loadProfiles, m11Config, BATCH_MIX } from '../tools/line.mjs';
import en from '../src/i18n/en.js';

/** A synthetic profile: per class a list of attempts { tg, tr, y, outcome } (one trial each, or `trials` given),
 *  the window per class, optional decision passes per class. */
function fake(speed, spec) {
  const trials = [], classes = {};
  let k = 0;
  for (const [c, s] of Object.entries(spec)) {
    const tt = [];
    for (const a of s.attempts) tt.push({ k: k++, item: c, class: c, seed: 1, attempts: [{ t_grasp: a.tg, t_return: a.tr, y: a.y, outcome: a.outcome }], pass: null, end: a.outcome === 'success' ? 'bin_' + c : (a.end || 'tote') });
    for (let i = 0; i < (s.passes || 0); i++) tt.push({ k: k++, item: c, class: c, seed: 1, attempts: [], pass: s.passReason || 'unknown', end: 'tote' });
    trials.push(...tt);
    classes[c] = { window_m: s.window };
  }
  return { policy: 'skript', speed, version: 'test', n: trials.length, trials, classes };
}
/** Constant cycle c (s): t_grasp 2 s, success always, spread over a wide window. */
const constant = (speed, c, cls = ['paper', 'plastic', 'glass', 'metal']) => fake(speed, Object.fromEntries(cls.map((k) => [k, {
  window: [-0.2, 0.2], attempts: Array.from({ length: 10 }, (_, i) => ({ tg: 2, tr: c - 2, y: -0.18 + 0.04 * i, outcome: 'success' }))
}])));
const line = (v, lambda, sets, extra = {}) => Object.assign({ v, lambda, mix: { paper: 1 }, arrivals: 'uniform', jitter: 0,
  cells: sets.map((fs, i) => ({ x: slotX(i), fractions: fs, policy: 'skript' })) }, extra);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (± ${tol})`);
const ONE = 1 / 30 + 1e-9;   // one item in a 30 min window, per minute

test('constants match the measuring cell and the planner', () => {
  assert.equal(LINE.tries, BELT_PICK.tries);
  assert.equal(LINE.yBin, MEASURE.yBin);
  assert.deepEqual(LINE.speeds, MEASURE.speeds);
  assert.equal(lambdaMax(0.02), 15, 'design: at 2 cm/s the belt takes at most 15 items/min');
  assert.equal(slotX(7), 3.75);
});

// ---------------- analytic cases (design §6) ----------------
test('one cell, constant cycle c, p = 1, deterministic arrivals, ample λ: saturates at 60 / c per min', () => {
  for (const c of [8, 10, 12.5]) {
    const m = { skript: cellModel(constant(0.04, c)) };
    for (const seed of [1, 2]) {
      const r = simulate(line(0.04, 20, [['paper']]), m, seed);
      near(r.rate.sorted, 60 / c, ONE, `c = ${c}`);
      near(r.cells[0].utilisation, 1, 1e-9, 'never idle');
      assert.equal(r.purity, 1);
    }
  }
});

test('N cells, ample λ: output = min(λ · share, N · 60 / c)', () => {
  const m = { skript: cellModel(constant(0.04, 10)) };
  // capacity bound: 2 cells × 6 = 12 < λ = 30 (the belt maximum at 4 cm/s)
  near(simulate(line(0.04, 30, [['paper'], ['paper']]), m, 1).rate.sorted, 12, 2 * ONE, 'N · 60 / c');
  near(simulate(line(0.04, 30, [['paper'], ['paper'], ['paper']]), m, 1).rate.sorted, 18, 3 * ONE, 'N · 60 / c');
  // inflow bound: half the items are glass, which no cell sorts: λ · share = 12 · ½ = 6 < 3 × 6
  const mix = { paper: 1, glass: 1 }, rs = seedsOf(20).map((s) => simulate(line(0.04, 12, [['paper'], ['paper'], ['paper']], { mix }), m, s));
  const mean = rs.reduce((a, r) => a + r.rate.sorted, 0) / rs.length, acc = rs.reduce((a, r) => a + r.counts.accepted.paper, 0) / rs.length / 30;
  near(mean, acc, ONE, 'every paper item sorted');
  near(mean, 6, 0.4, 'λ · share');
  assert.ok(rs.every((r) => r.counts.sorted.glass === 0 && r.totals.missed > 0));
});

test('no cells: output 0, every accepted item missed', () => {
  const r = simulate(line(0.02, 12, []), {}, 1);
  assert.equal(r.totals.sorted, 0);
  near(r.rate.missed, 12, ONE, 'missed = λ');
  near(r.rate.accepted, 12, ONE, 'λ ≤ λ_max: nothing refused');
  assert.equal(r.totals.refused, 0);
  assert.equal(r.purity, null);
});

// ---------------- arrivals and refusals ----------------
test('refused arrivals: closer than the 8 cm spacing are refused, counted per class, never silently dropped', () => {
  // uniform λ = 30/min at 2 cm/s: one every 2 s, but one needs 4 s → every other one refused
  const r = simulate(line(0.02, 30, []), {}, 1);
  near(r.rate.offered, 30, ONE, 'offered');
  near(r.rate.refused, 15, ONE, 'refused');
  near(r.rate.accepted, lambdaMax(0.02), ONE, 'accepted = the belt maximum');
  for (const c of CLASSES) assert.equal(r.counts.offered[c], r.counts.accepted[c] + r.counts.refused[c]);
  // Poisson: refusing arrivals within h of the last accepted one is a dead-time counter: accepted rate λ / (1 + λh)
  const lam = 12, h = 0.08 / 0.02, rs = seedsOf(20).map((s) => simulate(Object.assign(line(0.02, lam, []), { arrivals: 'poisson', mix: BATCH_MIX }), {}, s));
  const acc = rs.reduce((a, x) => a + x.rate.accepted, 0) / rs.length, off = rs.reduce((a, x) => a + x.rate.offered, 0) / rs.length;
  near(acc, 60 * (lam / 60) / (1 + (lam / 60) * h), 0.15, 'accepted rate λ / (1 + λh)');
  near(off, lam, 0.25, 'offered rate λ');
  for (const x of rs) for (const c of CLASSES) assert.equal(x.counts.offered[c], x.counts.accepted[c] + x.counts.refused[c]);
});

test('batch mode: every accepted item has exactly one fate', () => {
  const m = { skript: cellModel(loadProfiles()[0.04]) };
  for (const seed of [1, 2, 3]) {
    const cfg = Object.assign(line(0.04, 25, [['paper', 'plastic'], ['glass', 'metal']]), { arrivals: 'poisson', mix: BATCH_MIX, count: 200 });
    const r = simulate(cfg, m, seed, { trace: true });
    assert.equal(r.totals.accepted, 200);
    const t = r.totals;
    assert.equal(t.sorted + t.missed + t.lost + t.contaminated, 200);
    assert.ok(r.items.every((it) => ['sorted', 'missed', 'lost'].includes(it.state) || it.state.startsWith('bin:')));
  }
});

// ---------------- reproducibility ----------------
test('seeded: the same seed gives the same run, another seed another run; arrivals do not depend on the cells', () => {
  const m = { skript: cellModel(loadProfiles()[0.02]) };
  const cfg = Object.assign(line(0.02, 12, [['paper', 'plastic'], ['glass', 'metal']]), { arrivals: 'poisson', mix: BATCH_MIX });
  const a = simulate(cfg, m, 7, { trace: true }), b = simulate(cfg, m, 7, { trace: true }), c = simulate(cfg, m, 8, { trace: true });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.attempts, c.attempts);
  const none = simulate(Object.assign({}, cfg, { cells: [] }), m, 7, { trace: true });
  assert.deepEqual(none.items.map((it) => [it.cls, it.tArr]), a.items.map((it) => [it.cls, it.tArr]));
  assert.deepEqual(runLine(cfg, { skript: loadProfiles()[0.02] }, { seeds: [3, 4] }).summary, runLine(cfg, { skript: loadProfiles()[0.02] }, { seeds: [3, 4] }).summary);
});

// ---------------- reserve rule, window and commit ----------------
test('reserve rule: one item, one cell – an item is never in two attempts at once', () => {
  const P = loadProfiles();
  for (const v of LINE.speeds) {
    const m = { skript: cellModel(P[v]) };
    // overlapping fractions on neighbouring cells: they compete for plastic and glass
    const cfg = Object.assign(line(v, lambdaMax(v), [['paper', 'plastic'], ['plastic', 'glass'], ['glass', 'metal'], ['plastic']]), { arrivals: 'poisson', mix: BATCH_MIX });
    for (const seed of [1, 2]) {
      const r = simulate(cfg, m, seed, { trace: true }), by = new Map();
      for (const a of r.attempts) { if (!by.has(a.item)) by.set(a.item, []); by.get(a.item).push(a); }
      let shared = 0;
      for (const list of by.values()) {
        list.sort((x, y) => x.t - y.t);
        for (let i = 1; i < list.length; i++) assert.ok(list[i].t >= list[i - 1].t + list[i - 1].tg + list[i - 1].tr - 1e-9, `item ${list[i].item}: attempt at ${list[i].t} overlaps the previous one`);
        if (new Set(list.map((a) => a.cell)).size > 1) shared++;
        const per = {}; for (const a of list) per[a.cell] = (per[a.cell] || 0) + 1;
        assert.ok(Object.values(per).every((n) => n <= LINE.tries), 'at most LINE.tries attempts per item and cell');
      }
      if (v === 0.06) assert.ok(shared > 0, 'some items were tried by two cells (one after the other)');
    }
  }
});

test('window and commit: every attempt closes inside the cell window of its class; no cell takes another fraction', () => {
  const P = loadProfiles();
  for (const v of LINE.speeds) {
    const m = cellModel(P[v]), cells = [['paper', 'plastic'], ['glass', 'metal'], ['plastic', 'glass']];
    const r = simulate(Object.assign(line(v, lambdaMax(v) * 0.8, cells), { arrivals: 'poisson', mix: BATCH_MIX }), { skript: m }, 3, { trace: true });
    assert.ok(r.attempts.length > 50);
    for (const a of r.attempts) {
      assert.ok(cells[a.cell].includes(a.cls), `cell ${a.cell} tried ${a.cls}`);
      const w = m.classes[a.cls].window;
      assert.ok(a.y >= w[0] - 1e-4 && a.y <= w[1] + 1e-4, `${a.cls} closed at y ${a.y}, window ${w}`);
    }
  }
  // a window that starts downstream: no commit before the item's predicted close reaches it
  const late = fake(0.04, { paper: { window: [0.1, 0.2], attempts: [{ tg: 2, tr: 6, y: 0.15, outcome: 'success' }] } });
  const r = simulate(line(0.04, 3, [['paper']]), { skript: cellModel(late) }, 1, { trace: true });
  assert.ok(r.attempts.length > 50 && r.attempts.every((a) => Math.abs(a.y - 0.1) < 1e-6), 'each commit happens exactly when the predicted close enters the window');
});

test('success depends on where along the window the close falls (outcomes drawn per 4 cm bin)', () => {
  // upstream half of the window always misses, downstream half always succeeds
  const att = [];
  for (let i = 0; i < 6; i++) att.push({ tg: 2, tr: 3, y: -0.07, outcome: 'miss' }, { tg: 2, tr: 7, y: 0.05, outcome: 'success' });
  const p = fake(0.04, { paper: { window: [-0.075, 0.08], attempts: att } });
  const r = simulate(line(0.04, 30, [['paper']]), { skript: cellModel(p) }, 1, { trace: true });
  for (const a of r.attempts) assert.equal(a.outcome, a.y < -0.04 ? 'miss' : (a.y >= 0.04 ? 'success' : a.outcome));
  assert.ok(r.attempts.some((a) => a.outcome === 'miss') && r.attempts.some((a) => a.outcome === 'success'));
  assert.ok(r.attempts.filter((a) => a.outcome === 'miss').every((a) => a.tr === 3), 'a failure costs its measured time');
});

test('failures: back on the belt (next cell may take it), lost, contamination into the other bin of the cell', () => {
  const p = fake(0.04, {
    paper: { window: [-0.2, 0.2], attempts: Array.from({ length: 10 }, (_, i) => ({ tg: 2, tr: 4, y: -0.18 + 0.04 * i, outcome: 'drop_other_bin', end: 'tote' })) },
    glass: { window: [-0.2, 0.2], attempts: Array.from({ length: 10 }, (_, i) => ({ tg: 2, tr: 4, y: -0.18 + 0.04 * i, outcome: i % 2 ? 'miss' : 'success' })) },
    metal: { window: [-0.2, 0.2], attempts: Array.from({ length: 10 }, (_, i) => ({ tg: 2, tr: 4, y: -0.18 + 0.04 * i, outcome: 'knock_off' })) }
  });
  const m = { skript: cellModel(p) };
  const cfg = (cells, mix) => Object.assign(line(0.04, 6, cells), { mix, count: 300 });
  // drop into the other bin: paper ends in the glass bin of a paper+glass cell
  let r = simulate(cfg([['paper', 'glass']], { paper: 1 }), m, 1);
  assert.equal(r.totals.contaminated, 300); assert.equal(r.bins.glass.wrong, 300); assert.equal(r.purity, 0);
  // a one-fraction cell has no other bin: lost
  r = simulate(cfg([['paper']], { paper: 1 }), m, 1);
  assert.equal(r.totals.lost, 300); assert.equal(r.totals.contaminated, 0);
  // knock-off: lost
  r = simulate(cfg([['metal']], { metal: 1 }), m, 1);
  assert.equal(r.totals.lost, 300);
  // miss: back on the belt; with two tries one cell sorts 1 − ½² of the items, two cells 1 − ½⁴
  const one = simulate(cfg([['glass']], { glass: 1 }), m, 1).totals.sorted / 300, two = simulate(cfg([['glass'], ['glass']], { glass: 1 }), m, 1).totals.sorted / 300;
  near(one, 0.75, 0.08, 'one cell'); near(two, 0.9375, 0.05, 'a second cell catches what the first missed');
});

test('decision passes (a class the policy has no demonstration of) let items pass; timing passes do not', () => {
  const att = Array.from({ length: 10 }, (_, i) => ({ tg: 2, tr: 4, y: -0.18 + 0.04 * i, outcome: 'success' }));
  const unknown = fake(0.04, { paper: { window: [-0.2, 0.2], attempts: att, passes: 10, passReason: 'unknown' } });
  const late = fake(0.04, { paper: { window: [-0.2, 0.2], attempts: att, passes: 10, passReason: 'late' } });
  const cfg = Object.assign(line(0.04, 6, [['paper']]), { count: 400 });
  const a = simulate(cfg, { skript: cellModel(unknown) }, 1).totals.sorted / 400, b = simulate(cfg, { skript: cellModel(late) }, 1).totals.sorted / 400;
  near(a, 0.5, 0.08, 'half the paper trials were decision passes');
  assert.equal(b, 1, 'late passes are what the window models');
  // a class with no attempt at all cannot be sorted by that policy
  const none = fake(0.04, { paper: { window: [-0.2, 0.2], attempts: att } });
  assert.equal(cellModel(none).classes.glass, null);
  assert.equal(simulate(Object.assign(line(0.04, 6, [['glass']]), { mix: { glass: 1 }, count: 50 }), { skript: cellModel(none) }, 1).totals.sorted, 0);
});

// ---------------- configuration checks ----------------
test('validateLine: a profile of another speed, a window off the belt, too many cells are refused', () => {
  const P = loadProfiles();
  assert.deepEqual(validateLine(Object.assign(line(0.02, 12, [['paper', 'glass']]), { mix: BATCH_MIX }), { skript: P[0.02] }), []);
  assert.ok(validateLine(line(0.04, 12, [['paper']]), { skript: P[0.02] }).some((s) => /measured at 0.02/.test(s)));
  assert.ok(validateLine(Object.assign(line(0.02, 12, []), { cells: [{ x: 0.05, fractions: ['paper'], policy: 'skript' }] }), { skript: P[0.02] }).some((s) => /leaves the belt/.test(s)));
  assert.ok(validateLine(line(0.02, 12, Array(9).fill(['paper'])), { skript: P[0.02] }).some((s) => /at most 8/.test(s)));
  assert.ok(validateLine(line(0.02, 12, [['paper', 'paper']]), { skript: P[0.02] }).some((s) => /twice/.test(s)));
  assert.throws(() => runLine(line(0.04, 12, [['paper']]), { skript: P[0.02] }), /measured at/);
  for (let k = 0; k < LINE.maxCells; k++) for (const v of LINE.speeds) for (const c of CLASSES) {
    const w = P[v].classes[c].window_m;
    assert.ok(slotX(k) + w[0] >= 0 && slotX(k) + w[1] <= LINE.length, `every slot fits the ${c} window at ${v}`);
  }
});

// ---------------- the N_min search ----------------
test('configurations enumerate every order of every fraction set; the bound never cuts a passing configuration', () => {
  const sets = fractionSets(BATCH_MIX);
  assert.equal(sets.length, 10, '4 single fractions + 6 pairs');
  assert.equal([...configurations(sets, 2)].length, 100);
  assert.equal(new Set([...configurations(sets, 2)].map((c) => JSON.stringify(c))).size, 100);
  const P = loadProfiles(), model = cellModel(P[0.04]), seeds = seedsOf(4);
  const cfg = (cs) => Object.assign(line(0.04, 25, cs), { arrivals: 'poisson', mix: BATCH_MIX });
  const bounds = arrivalBounds(cfg([]), seeds);
  for (const cs of [[['paper', 'plastic']], [['glass', 'metal'], ['paper']], [['plastic', 'glass'], ['paper', 'metal'], ['plastic']]]) {
    seeds.forEach((s, i) => {
      const r = simulate(cfg(cs), { skript: model }, s);
      assert.ok(r.rate.sorted <= upperBound(cs, model, bounds[i]) + 1e-9, `${JSON.stringify(cs)} seed ${s}: ${r.rate.sorted} > bound`);
    });
  }
});

test('N_min search: returns a configuration that passes, and none with one cell fewer does', () => {
  const P = loadProfiles();
  const order = { F: 6, X: 0.95, mix: BATCH_MIX, v: 0.02, lambda: 15, arrivals: 'poisson' };
  const r = searchNmin(order, { skript: P });
  assert.equal(r.n, 2, JSON.stringify(r.perN));
  assert.ok(r.passing >= 1 && r.best);
  assert.equal(r.best.config.cells.length, r.n);
  // the configuration it returns passes when run again on its own
  const again = runLine(r.best.config, { skript: P[0.02] });
  assert.ok(meets(again.summary, order).win);
  assert.deepEqual(again.summary, r.best.summary);
  // one cell fewer: every one-cell configuration was run (or provably bounded) and none passes
  for (const cs of configurations(fractionSets(BATCH_MIX), 1)) {
    const s = runLine(Object.assign(line(0.02, 15, cs), { arrivals: 'poisson', mix: BATCH_MIX }), { skript: P[0.02] }).summary;
    assert.ok(!meets(s, order).win, JSON.stringify(cs));
  }
  // more than the belt brings: refused at once, with the reason
  const no = searchNmin(Object.assign({}, order, { F: 12 }), { skript: P });
  assert.equal(no.n, null); assert.equal(no.reason, 'inflow'); assert.ok(no.reach < 12);
  // a synthetic line with a known answer: cycle 10 s, F = 15 items/min of one fraction needs 3 cells
  const syn = searchNmin({ F: 15, X: 0.95, mix: { paper: 1 }, v: 0.04, lambda: 30, arrivals: 'uniform' }, { skript: constant(0.04, 10, ['paper']) }, { seeds: seedsOf(3) });
  assert.equal(syn.n, 3);
  // a search that would need more runs than its budget says so instead of claiming an answer
  const cut = searchNmin({ F: 15, X: 0.95, mix: { paper: 1 }, v: 0.04, lambda: 30, arrivals: 'uniform' }, { skript: constant(0.04, 10, ['paper']) }, { seeds: seedsOf(3), budget: 0 });
  assert.equal(cut.n, null); assert.equal(cut.reason, 'budget');
});

test('meets: win on the mean, ★ spolehlivě on the 10th percentile', () => {
  const s = (vals, pur) => summarize(vals.map((x) => ({ minutes: 30, purity: pur, totals: {}, rate: { offered: 0, accepted: 0, refused: 0, sorted: x, missed: 0, lost: 0, contaminated: 0 }, recovery: {}, bins: Object.fromEntries(CLASSES.map((c) => [c, { purity: pur }])), missedByClass: Object.fromEntries(CLASSES.map((c) => [c, 0])), cells: [] })));
  assert.deepEqual(meets(s([12, 12, 12, 12], 1), { F: 12, X: 0.95 }), { win: true, reliable: true });
  assert.deepEqual(meets(s([10, 14, 10, 14], 1), { F: 12, X: 0.95 }), { win: true, reliable: false });
  assert.deepEqual(meets(s([14, 14, 14, 14], 0.9), { F: 12, X: 0.95 }), { win: false, reliable: false });
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});

// ---------------- the committed profiles ----------------
test('committed profiles feed the model: windows, per-class draws, the mission 11 sanity run', () => {
  const P = loadProfiles();
  for (const v of LINE.speeds) {
    assert.deepEqual(validateProfile(P[v]), []);
    const m = cellModel(P[v]);
    for (const c of CLASSES) {
      assert.ok(m.classes[c], `${c} at ${v}`);
      assert.deepEqual(m.classes[c].window, P[v].classes[c].window_m);
      assert.equal(m.classes[c].tg.length, P[v].classes[c].t_grasp.length, 'every measured t_grasp is a candidate draw');
    }
  }
  const cfg = m11Config(), m = { skript: cellModel(P[0.02]) };
  const runs = seedsOf(50).map((s) => simulate(cfg, m, s)), mean = runs.reduce((a, r) => a + r.totals.sorted, 0) / runs.length;
  assert.ok(runs.every((r) => r.totals.accepted === 11 && r.purity === 1));
  // the model has no full bins or bounces in a bin, so it is not below the measured batches (it is a check of the
  // direction of the difference that "Jak to počítáme" states, not a tuning target)
  const measured = M11_BATCH.sorted.reduce((a, b) => a + b, 0) / M11_BATCH.sorted.length;
  assert.ok(mean >= measured, `DES ${mean} vs MuJoCo ${measured}`);
});

test('performance: 30 min × 20 seeds of a 4-cell line at the belt maximum in well under a second', () => {
  const P = loadProfiles();
  const cfg = Object.assign(line(0.06, 45, [['paper', 'plastic'], ['glass', 'metal'], ['plastic', 'glass'], ['metal', 'paper']]), { arrivals: 'poisson', mix: BATCH_MIX });
  runLine(cfg, { skript: P[0.06] }, { seeds: [1] });   // warm the JIT
  // best of 3: a shared CI runner can stall one run
  const ms = Math.min(...[0, 1, 2].map(() => { const t0 = performance.now(); runLine(cfg, { skript: P[0.06] }); return performance.now() - t0; }));
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
});

test('"Jak to počítáme": every string has its English entry and quotes the model constants', () => {
  const strings = [EXPLAIN.title, EXPLAIN.intro, EXPLAIN.beltMax, EXPLAIN.profile, EXPLAIN.check];
  for (const s of EXPLAIN.sections) strings.push(s.title, ...s.items);
  const miss = strings.filter((s) => !(s in en.strings));
  assert.deepEqual(miss, [], 'add to src/i18n/en.js');
  const all = strings.join(' ');
  assert.ok(all.includes(`${LINE.spacing * 100} cm`), 'spacing');
  assert.ok(all.includes(`nejvýš ${LINE.tries} pokusy`), 'tries');
  assert.ok(all.includes(`${LINE.horizon / 60} minut`) && all.includes(`${LINE.seeds} běhů`), 'horizon and seeds');
  assert.ok(all.includes(`${String(MEASURE.lat * 100).replace('.', ',')} cm od osy`), 'lateral offset of the measurement');
  assert.ok(all.includes(`po ${LINE.yBin * 100} cm`), 'y bins');
  const n = JSON.parse(fs.readFileSync(new URL('../profiles/skript-2.json', import.meta.url), 'utf8')).n_per_class;
  assert.ok(all.includes(`${n} předmětů z každé frakce`), 'items per class of the committed profiles');
});
