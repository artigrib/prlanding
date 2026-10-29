// Star rules by control mode, progress migration, the partial-plan cut and the stuck detector (src/mastery.js).
//   node --test sim/so101/tests/mastery.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOutcome, mergeRecord, migrateProgress, partialPlan, HintCoach, PROGRESS_VERSION } from '../src/mastery.js';
import { MISSIONS, autopilotAllowed } from '../src/missions.js';

const res = { time: 20, stars: 3 };

test('stars only for a manual carry; autopilot = "Splněno" without stars', () => {
  assert.deepEqual(runOutcome(res, { auto: true, drag: true }), { kind: 'auto', stars: 0, badges: { drag: false, joints: false } });
  assert.deepEqual(runOutcome(res, { drag: true }), { kind: 'manual', stars: 3, badges: { drag: true, joints: false } });
  assert.deepEqual(runOutcome(res, { joints: true }), { kind: 'manual', stars: 3, badges: { drag: false, joints: true } });
  // ⚙ only when the whole carry was in Klouby
  assert.deepEqual(runOutcome(res, { joints: true, drag: true }).badges, { drag: true, joints: false });
});

test('full solution, AI and replays are assisted: no stars, no record change', () => {
  for (const f of [{ assisted: true }, { replay: true }, { assisted: true, drag: true }]) {
    const o = runOutcome(res, f);
    assert.equal(o.kind, 'assisted'); assert.equal(o.stars, 0);
    const prev = { stars: 2, time: 30, done: true };
    assert.deepEqual(mergeRecord(prev, o, 10), { rec: prev, isNew: false });
    assert.deepEqual(mergeRecord(undefined, o, 10), { rec: null, isNew: false });
  }
});

test('records: autopilot marks done and keeps manual stars; manual improves; badges accumulate', () => {
  const auto = runOutcome(res, { auto: true });
  let { rec, isNew } = mergeRecord(undefined, auto, 9);
  assert.equal(isNew, false); assert.equal(rec.done, true); assert.equal(rec.stars, 0); assert.equal(rec.v, PROGRESS_VERSION);
  ({ rec, isNew } = mergeRecord(rec, runOutcome({ time: 40, stars: 2 }, { drag: true }), 40));
  assert.equal(isNew, true); assert.equal(rec.stars, 2); assert.equal(rec.time, 40); assert.equal(rec.drag, true);
  ({ rec, isNew } = mergeRecord(rec, runOutcome({ time: 35, stars: 1 }, { joints: true }), 35));
  assert.equal(isNew, false, 'fewer stars is not a record'); assert.equal(rec.stars, 2); assert.equal(rec.time, 40); assert.equal(rec.joints, true);
  ({ rec } = mergeRecord(rec, auto, 5));
  assert.equal(rec.stars, 2, 'an autopilot run never lowers or raises stars'); assert.equal(rec.time, 40);
  ({ rec, isNew } = mergeRecord(rec, runOutcome({ time: 30, stars: 2 }, { drag: true }), 30));
  assert.equal(isNew, true, 'same stars, faster = record'); assert.equal(rec.time, 30);
});

test('v1 progress migrates as-is (legacy stars stay displayed)', () => {
  const v1 = { bowl: { stars: 3, time: 8.9 }, stack: { stars: 1, time: 70 }, junk: 5 };
  const m = migrateProgress(v1, 1);
  assert.deepEqual(m.bowl, { stars: 3, time: 8.9, done: true, legacy: true });
  assert.equal(m.stack.stars, 1); assert.equal(m.junk, undefined);
  assert.deepEqual(migrateProgress(m, PROGRESS_VERSION), m, 'v2 is left alone');
});

test('autopilot fades from mission 04', () => {
  assert.deepEqual(MISSIONS.map((m) => autopilotAllowed(m)), [true, true, true, false, false, false, false, false, false, false]);
  for (const m of MISSIONS) assert.ok(m.strategy && !/Klikněte na/.test(m.strategy), m.id + ' has a manual strategy for hint rung 1');
  assert.equal(MISSIONS[0].desc, 'Dostaňte kostku do modré misky.', 'mission 01 states the outcome only');
  assert.ok(!/ruka sama natočí|natočí podél/.test(MISSIONS.map((m) => m.desc + (m.strategy || '')).join(' ')), 'no mission promises the planner rotates the object');
});

test('partialPlan: up to the grasp + lift; without a grasp up to the first settle move', () => {
  const pick = { ok: true, bad: [], steps: [
    { k: 'grip', open: true }, { k: 'move', pts: [[0, 0, 0.1], [0.2, 0, 0.1]] }, { k: 'move', pts: [[0.2, 0, 0.1], [0.2, 0, 0.01]], settle: true },
    { k: 'grip', open: false }, { k: 'move', pts: [[0.2, 0, 0.01], [0.2, 0, 0.08]] },
    { k: 'move', pts: [[0.2, 0, 0.08], [0.2, 0.15, 0.08]] }, { k: 'dyn', fn: () => null }] };
  const p = partialPlan(pick);
  assert.equal(p.steps.length, 5); assert.equal(p.steps[3].k, 'grip'); assert.equal(p.kind, 'partial');
  assert.deepEqual(p.path[p.path.length - 1], [0.2, 0, 0.08]);
  const push = { ok: true, steps: [{ k: 'grip', open: false }, { k: 'move', pts: [[0, 0, 0.1]] }, { k: 'move', pts: [[0, 0, 0.1], [0.1, 0, 0.01]], settle: true }, { k: 'move', pts: [[0.1, 0, 0.01], [0.2, 0, 0.01]] }] };
  assert.equal(partialPlan(push).steps.length, 3, 'push: the arm only gets into position');
});

const sig = (o) => Object.assign({ started: true, busy: false, won: false, joints: false, level: 0, gripOpen: true, held: null }, o);
function run(c, seconds, s, dt = 0.25) { let n = 0; for (let t = 0; t < seconds; t += dt) if (c.tick(dt, sig(s))) n++; return n; }

test('HintCoach: offers after ~25 s without progress (60 s in Klouby), not before the first move', () => {
  const c = new HintCoach();
  assert.equal(run(c, 60, { started: false }), 0, 'timer waits for the first move');
  c.reset(); assert.equal(run(c, 24, {}), 0); assert.equal(run(c, 2, {}), 1); assert.equal(c.reason, 'idle');
  const j = new HintCoach(); assert.equal(run(j, 50, { joints: true }), 0); assert.equal(run(j, 11, { joints: true }), 1);
});

test('HintCoach: progress resets the idle timer; planner / replay time does not count', () => {
  const c = new HintCoach();
  let lvl = 0, offers = 0;
  for (let t = 0; t < 100; t += 0.25) { if (Math.abs(t % 20) < 1e-9) lvl += 0.25; if (c.tick(0.25, sig({ level: lvl }))) offers++; }
  assert.equal(offers, 0, 'progress every 20 s: no offer');
  assert.equal(run(c, 100, { busy: true }), 0, 'busy (autopilot, replay) never triggers');
  assert.equal(run(c, 20, { won: true }), 0, 'never after a win');
});

test('HintCoach: two failed grasps trigger an offer; a successful grasp resets the count', () => {
  const c = new HintCoach();
  const grasp = (held) => { c.tick(0.1, sig({ gripOpen: true })); let o = false; for (let i = 0; i < 10; i++) o = c.tick(0.1, sig({ gripOpen: false, held })) || o; return o; };
  assert.equal(grasp(null), false);
  assert.equal(grasp('cube'), false, 'got it: count resets');
  assert.equal(grasp(null), false);
  assert.equal(grasp(null), true); assert.equal(c.reason, 'grasp');
});
