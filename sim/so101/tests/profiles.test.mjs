// Policy profiles (src/policy/measure.js, tools/profiles.mjs, profiles/skript-{2,4,6}.json): the input of the line
// model of mission 13. Pure parts on synthetic trials; the committed profiles against the schema and the current
// cell; determinism of the measuring cell; and a regeneration of the first trials of each committed profile,
// compared within the tolerance of measure.js compareTrials.
//
// How much is re-measured: PROFILE_CHECK_N trials per class (default 1) at the speeds in PROFILE_CHECK_SPEEDS
// (default 0.02). CI's so101-profiles job runs this file per speed with PROFILE_CHECK_N=25 (100 trials per speed,
// see .github/workflows/site-tests.yml); the full n = 100 per class is what tools/profiles.mjs gen measures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nodeCell, readProfile, profilePath } from '../tools/profiles.mjs';
import {
  MEASURE, OUTCOMES, CLASSES, KINDS, profileFrom, validateProfile, compareTrials, quantile, histogram, wilson,
  trial, trialGen, trialSeed, trialItem, measureSpeed, cellVersion, modelHash, policyId, TOL
} from '../src/policy/measure.js';
import { train, examplesFromDemo } from '../src/policy/knn.js';
import { CONVEYOR_ITEMS } from '../src/objects/scene.js';

const N = +(process.env.PROFILE_CHECK_N || 1);
const SPEEDS = String(process.env.PROFILE_CHECK_SPEEDS || '0.02').split(',').map(Number);

// ---------------- pure ----------------
test('quantile, histogram, Wilson interval', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([5], 0.9), 5);
  assert.equal(quantile([], 0.5), null);
  const hg = histogram([0, 0.1, 0.3, 9, -1], [0, 1, 0.25]);
  assert.deepEqual(hg, { from: 0, step: 0.25, counts: [3, 1, 0, 1] }, 'out-of-range values go to the end bins');
  const [lo, hi] = wilson(95, 100);
  assert.ok(lo > 0.88 && lo < 0.9 && hi > 0.97 && hi < 0.99, `${lo} ${hi}`);
  assert.deepEqual(wilson(0, 0), [0, 1]);
});

const fake = (cls, k, outs, extra = {}) => ({ k, item: trialItem(cls, k), kind: trialItem(cls, k).replace(/\d+$/, ''), class: cls, speed: 0.02, seed: k + 1, yFree: 0, lat: 0, yaw: 0,
  attempts: outs.map((o, i) => ({ t_grasp: 3 + i, y: k % 2 ? 0.01 : 0.05, t_return: 6, outcome: o })), end: outs.at(-1) === 'success' ? 'bin_' + cls : 'tote', t: 20, ...extra });

test('profileFrom: per-class outcomes per attempt, passes, times, window from success vs y', () => {
  const tr = [];
  for (let k = 0; k < 8; k++) tr.push(fake('glass', k, k < 6 ? ['success'] : ['miss', 'success']));
  tr.push(fake('metal', 0, [], { pass: 'unknown' }), fake('metal', 1, ['drop_other_bin']));
  const p = profileFrom(tr, { policy: 'skript', speed: 0.02, source: 'ci', measured_at: '2026-01-01' });
  assert.deepEqual(validateProfile(p), []);
  const g = p.classes.glass, m = p.classes.metal;
  assert.equal(g.trials, 8); assert.equal(g.attempts, 10); assert.equal(g.outcomes.success, 8); assert.equal(g.outcomes.miss, 2);
  assert.equal(g.success_per_attempt, 0.8); assert.equal(g.sorted_per_item, 1);
  assert.deepEqual(g.t_grasp.slice(0, 6), [3, 3, 3, 3, 3, 3]);
  assert.equal(g.t_cycle_success.length, 8);
  assert.deepEqual(g.t_fail.miss, [9, 9], 'a miss costs its measured grasp + return time');
  assert.deepEqual(m.passes, { unknown: 1 }); assert.equal(m.attempts, 1); assert.equal(m.outcomes.drop_other_bin, 1);
  assert.equal(p.n, 10); assert.equal(p.n_per_class, 2);
  assert.deepEqual(Object.keys(p.outcomes), OUTCOMES);
  // window: 4 cm bins with ≥ 3 attempts and success ≥ 50 % of the best bin
  assert.deepEqual(g.window_m, [0, 0.08]);
  assert.equal(m.window_m, null, 'too few attempts for a window');
  for (const b of g.by_y) assert.ok(b.y1 - b.y0 > 0.039 && b.success <= b.n);
  // a changed number is caught: the summaries must follow from the raw trials
  const bad = JSON.parse(JSON.stringify(p)); bad.classes.glass.outcomes.success = 7; bad.classes.glass.outcomes.miss = 3;
  assert.ok(validateProfile(bad).includes('summaries do not follow from the trials'));
  const bad2 = JSON.parse(JSON.stringify(p)); bad2.speed = 0.03;
  assert.ok(validateProfile(bad2).some((x) => /speed/.test(x)), 'only measured speeds');
});

test('compareTrials: identical trials pass; changed outcomes beyond the tolerance fail', () => {
  const tr = []; for (let k = 0; k < 20; k++) tr.push(fake('paper', k, k % 10 ? ['success'] : ['miss']));
  const p = profileFrom(tr, { policy: 'skript', speed: 0.02, source: 'ci', measured_at: '2026-01-01' });
  const again = JSON.parse(JSON.stringify(tr.slice(0, 10)));
  assert.ok(compareTrials(p, again).ok);
  again[3].attempts[0].t_grasp += TOL.dt * 2;
  assert.ok(!compareTrials(p, again).ok, 'a time beyond TOL.dt');
  const worse = JSON.parse(JSON.stringify(tr.slice(0, 10))); for (const t of worse) t.attempts[0].outcome = 'miss';
  const r = compareTrials(p, worse);
  assert.ok(!r.ok && r.problems.some((x) => /repeat/.test(x)) && r.problems.some((x) => /success per attempt/.test(x)), r.problems.join('; '));
});

test('kinds per class cover the pool (one instance per asset and scale), seeds are per trial', () => {
  assert.deepEqual(KINDS, { paper: ['cup_paper1'], plastic: ['cup_plastic1', 'fork_plastic1', 'spoon_plastic1'], glass: ['vial_glass1'], metal: ['socket_s1', 'socket_l1', 'nut_m1'] });
  for (const c of CLASSES) assert.ok(KINDS[c].every((n) => CONVEYOR_ITEMS.find((it) => it.name === n).fraction === c));
  assert.equal(trialItem('metal', 4), 'socket_l1');
  assert.notEqual(trialSeed('skript', 0.02, 'paper', 0), trialSeed('skript', 0.02, 'paper', 1));
  assert.notEqual(trialSeed('skript', 0.02, 'paper', 0), trialSeed('skript', 0.04, 'paper', 0));
  assert.equal(trialSeed('skript', 0.02, 'paper', 3), trialSeed('skript', 0.02, 'paper', 3));
});

// ---------------- the committed profiles ----------------
test('committed profiles: skript at 2, 4 and 6 cm/s, schema, current cell, n ≥ 100 per class, measured numbers only', () => {
  for (const s of MEASURE.speeds) {
    const f = profilePath('skript', s);
    assert.ok(fs.existsSync(f), 'missing ' + f + ' (node sim/so101/tools/profiles.mjs gen --speed ' + s + ')');
    const p = readProfile('skript', s);
    assert.deepEqual(validateProfile(p), [], f);
    assert.equal(p.version, cellVersion(), `${f} was measured on another cell (belt, items, bins, pick or harness changed): regenerate it with node sim/so101/tools/profiles.mjs gen --speed ${s}`);
    assert.equal(p.policy, 'skript'); assert.equal(p.source, 'ci'); assert.equal(p.speed, s);
    assert.ok(p.n_per_class >= 100, `${f}: ${p.n_per_class} per class`);
    for (const c of CLASSES) {
      const k = p.classes[c];
      assert.ok(k && k.trials >= 100, c);
      // every time is one measured attempt (a list, not a fitted distribution)
      assert.ok(k.t_grasp.length <= k.attempts && k.t_return.length <= k.attempts && k.t_grasp.length > 0, c);
      assert.equal(k.hist.t_grasp.counts.reduce((a, b) => a + b, 0), k.t_grasp.length);
    }
    const kinds = new Set(p.trials.map((t) => t.item));
    assert.deepEqual([...kinds].sort(), Object.values(KINDS).flat().sort(), 'every pool kind measured');
  }
});

// ---------------- MuJoCo: the measuring cell ----------------
const C = await nodeCell();

test('the measuring cell is deterministic: a trial repeats exactly whatever ran before it; sliced = whole', () => {
  const o = { name: trialItem('glass', 0), speed: 0.04, seed: trialSeed('skript', 0.04, 'glass', 0) };
  const a = trial(C, { kind: 'skript' }, o);
  trial(C, { kind: 'skript' }, { name: 'fork_plastic1', speed: 0.06, seed: 99 });
  const g = trialGen(C, { kind: 'skript' }, o);
  let x, slices = 0; while (!(x = g.next()).done) slices++;
  assert.deepEqual(x.value, a);
  assert.ok(slices > 10, 'the generator yields between slices');
  assert.ok(a.attempts.length >= 1 && a.attempts.every((t) => OUTCOMES.includes(t.outcome)), JSON.stringify(a));
});

test('kNN policy in the cell: decisions from the demos (a wrong demo → wrong_bin, an unseen class → pass "unknown")', () => {
  // two demonstrations: glass into the plastic bin (wrong), metal into metal; nothing of paper
  const env = (item, cls, y) => ({ target: { item, class: cls, pos: [0.24, y, 0.03], yaw: Math.PI / 2 }, next: null, belt: 0.02 });
  const demo = { t: [0, 0.5, 1], obs: [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]],
    env: [env('vial_glass1', 'glass', -0.05), env('vial_glass1', 'glass', -0.04), env('socket_s1', 'metal', -0.04)],
    segments: [{ item: 'vial_glass1', class: 'glass', outcome: 'wrong', bin: 'bin_plastic', from: 0, to: 1, grasp: 1 },
      { item: 'socket_s1', class: 'metal', outcome: 'sorted', bin: 'bin_metal', from: 2, to: 2, grasp: 2 }] };
  const model = train(examplesFromDemo(demo));
  assert.equal(model.n, 2);
  assert.match(policyId({ kind: 'knn', model }), /^knn-[0-9a-f]{8}$/);
  assert.equal(modelHash(model), modelHash(train(examplesFromDemo(demo))), 'model hash is deterministic');
  const tr = measureSpeed(C, { kind: 'knn', model }, 0.02, 1, { classes: ['paper', 'glass'] });
  const paper = tr.find((t) => t.class === 'paper'), glass = tr.find((t) => t.class === 'glass');
  assert.equal(paper.pass, 'unknown'); assert.equal(paper.attempts.length, 0); assert.equal(paper.end, 'tote');
  assert.ok(glass.attempts.length >= 1);
  if (glass.end === 'bin_plastic') assert.equal(glass.attempts.at(-1).outcome, 'wrong_bin', JSON.stringify(glass));
  const p = profileFrom(tr, { policy: 'knn', speed: 0.02, source: 'browser', measured_at: '2026-01-01', model: modelHash(model) });
  assert.deepEqual(validateProfile(p), []);
  assert.equal(p.classes.paper.passes.unknown, 1);
});

for (const s of SPEEDS) {
  test(`regenerated: the first ${N} trial(s) per class at ${s * 100} cm/s agree with profiles/skript-${Math.round(s * 100)}.json within the tolerance`, () => {
    const ref = readProfile('skript', s), t0 = Date.now();
    const tr = measureSpeed(C, { kind: 'skript' }, s, N);
    const r = compareTrials(ref, tr);
    console.log(`  ${s * 100} cm/s: ${r.matched}/${r.n} trials repeat exactly, success per attempt ${r.rate == null ? '–' : r.rate.toFixed(3)} (profile ${r.rateRef}), ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    assert.ok(r.ok, r.problems.join('\n'));
  });
}
