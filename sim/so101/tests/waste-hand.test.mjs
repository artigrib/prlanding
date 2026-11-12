// Mission 11 "Třídění odpadu I: Ručně" (waste_hand) in MuJoCo with the real objects (node): the seeded spawn
// schedule, the per-item states the mission counts, purity, the belt pause, the named stars, and the automatic plan
// (beltSolve, used by "Ukaž mi" and "Ukázat řešení") winning the mission through MissionRunner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadObjectScene } from './mj-node.mjs';
import { ArmController } from '../src/controller.js';
import { World } from '../src/world.js';
import { MISSIONS, MissionRunner, sceneOf, runsIn, wasteStars } from '../src/missions.js';
import { WasteRun, WASTE, batchOrder } from '../src/objects/wastebatch.js';
import { BELT, CONVEYOR_ITEMS, CONVEYOR_BINS, FRACTION_BIN } from '../src/objects/scene.js';

const { mj, m, d, sizes } = await loadObjectScene('conveyor');
const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'].map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
const world = new World(mj, m, d); world.sizes(sizes);
const ctl = new ArmController(mj, m, d, act);
const runner = new MissionRunner(world);
const ts = m.opt.timestep, belt = world.belt;
const M = MISSIONS.find((x) => x.id === 'waste_hand');

function reset() {
  mj.mj_resetDataKeyframe(m, d, 0);
  runner.select('waste_hand'); runner.setup();
  mj.mj_forward(m, d);
  ctl.cancel(); ctl.syncFromCtrl();
}
// the page's order: controller, belt + physics, then the mission check (every 4th step = one 16 ms frame)
function run(sec, stopWhen) {
  const n = Math.round(sec / ts), every = 4;
  for (let i = 0; i < n; i++) {
    if (i % every === 0) { ctl.update(ts * every); ctl.actualTip(runner.ctx.tip); runner.ctx.gripOpen = ctl.gripOpen(); }
    belt.step(ts); mj.mj_step(m, d);
    if (i % every === 0) { runner.tick(ts * every); if (stopWhen && stopWhen()) return i * ts; }
  }
  return sec;
}
const runOf = () => runner.ctx.s.run;

test('mission 11 is a conveyor mission: entry, scene, stars as data, every item has a bin', () => {
  assert.equal(M.n, '11');
  assert.equal(sceneOf(M), 'conveyor');
  assert.ok(runsIn(M, 'conveyor') && !runsIn(M, 'plain') && !runsIn(M, 'objects'));
  assert.deepEqual(Object.keys(M.layout).sort(), Object.keys(CONVEYOR_BINS).sort(), 'the layout is the 4 bins (items are spawned)');
  for (const it of CONVEYOR_ITEMS) assert.equal(M.sort[it.name], FRACTION_BIN[it.fraction], it.name);
  assert.deepEqual(M.stars, { win: 8, purity: 1, pause: 0 });
  assert.ok(M.look && M.look.p && M.look.pn, 'desktop and phone cameras');
  assert.equal(WASTE.speed, 0.02, 'mission 11 runs at 2 cm/s only');
  // named stars: 1 for the win, + purity 100 %, + the belt never stood
  assert.equal(wasteStars(M.stars, { purity: 1, paused: 0 }), 3);
  assert.equal(wasteStars(M.stars, { purity: 10 / 11, paused: 0 }), 2);
  assert.equal(wasteStars(M.stars, { purity: 1, paused: 4.2 }), 2);
  assert.equal(wasteStars(M.stars, { purity: 0.5, paused: 1 }), 1);
  assert.equal(M.rate(100, 0, { purity: 1, paused: 0 }), 3);
});

test('setup: belt at 2 cm/s, every pool item parked; nothing spawns before the run starts', () => {
  reset();
  assert.equal(belt.speed, WASTE.speed);
  for (const it of CONVEYOR_ITEMS) assert.ok(!world.o[it.name].active, it.name);
  run(3);
  assert.equal(runOf().next, 0, 'no spawn before the first input');
  assert.ok(/pohnete rukou/.test(runner.last.text), runner.last.text);
});

test('seeded schedule: first item at the start, one every 10 s, a busy entry zone delays the next spawn', () => {
  reset();
  runner.start();
  run(0.1);
  const r = runOf(), { order } = batchOrder(WASTE.seed);
  assert.deepEqual(r.items.map((it) => it.name), order, 'the mission seed\'s order');
  assert.equal(r.next, 1); assert.equal(r.items[0].state, 'belt');
  const t1 = r.items[0].spawnT;
  run(10.1);
  assert.equal(r.next, 2, 'second item 10 s later');
  assert.ok(Math.abs(r.items[1].spawnT - t1 - 10) < 0.05, `spacing ${(r.items[1].spawnT - t1).toFixed(2)} s`);
  // stop the belt: the second item stays in the entry zone, the third one waits (retries every 0.2 s)
  belt.speed = 0;
  run(11);
  assert.equal(r.next, 2, 'no spawn into a busy entry zone');
  assert.ok(r.retries > 5, `retried ${r.retries}×`);
  assert.ok(r.paused > 10.5 && r.pauses === 1, `belt stood ${r.paused.toFixed(1)} s (${r.pauses} pause)`);
  assert.ok(r.pauseT > 10.5, 'current pause time for the chip');
  belt.speed = WASTE.speed;
  run(6);
  assert.equal(r.next, 3, 'spawns again once the entry is clear');
  assert.equal(r.pauseT, 0);
});

test('per-item states: an item left on the belt drops into the tote (missed), one put into a bin counts there', () => {
  reset();
  runner.start();
  run(0.1);
  const r = runOf(), first = r.items[0];
  run(34);   // 0.6 m at 2 cm/s = 30 s, then the drop
  assert.equal(first.state, 'tote', `${first.name}: ${first.state}`);
  assert.equal(r.stats().lost, 1);
  assert.ok(r.events.some((e) => e.ev === 'tote' && e.name === first.name));
  // the item on the belt now: put it into a wrong bin by hand (teleport), then into its own bin
  const it = r.items.find((x) => x.state === 'belt'), own = FRACTION_BIN[it.fraction], wrong = Object.values(FRACTION_BIN).find((b) => b !== own);
  const put = (fx) => { const p = world.pos(fx, [0, 0, 0]); world.place(it.name, p[0], p[1], null, 0); mj.mj_forward(m, d); };
  put(wrong); run(1.5);
  assert.equal(it.state, 'bin'); assert.equal(it.bin, wrong);
  let st = r.stats();
  assert.equal(st.wrong, 1); assert.equal(st.purity, 0);
  assert.ok(/^Pozor: .+ je .+, ne .+$/.test(runner.last.text), runner.last.text);
  put(own); run(1.5);
  st = r.stats();
  assert.equal(it.bin, own); assert.equal(st.correct, 1); assert.equal(st.wrong, 0); assert.equal(st.purity, 1);
  assert.equal(st.byBin[own].correct, 1);
});

test('"Ukázat řešení": beltSolve wins mission 11 through the mission check (seeded batch, 2 cm/s)', () => {
  reset();
  runner.start();
  const plan = M.solve(ctl, world, runner);
  ctl.run(plan);
  const t = run(260, () => runner.won);
  const st = runOf().stats();
  console.log(`  waste_hand by beltSolve: ${runner.won ? 'won' : 'not won'} after ${t.toFixed(0)} s sim, ${st.correct}/${st.n} correct, purity ${st.purity}, missed ${st.missed}, belt stood ${st.paused.toFixed(1)} s; stars ${runner.result && runner.result.stars}`);
  assert.ok(runner.won, `not won: ${runner.last.text}`);
  assert.ok(st.correct >= M.stars.win);
  assert.equal(st.purity, 1);
  assert.equal(st.paused, 0);
  assert.equal(runner.result.stars, 3, 'a planner run at 100 % purity without pausing rates 3 (the page gives no stars: assisted)');
  assert.deepEqual(runner.result.stats.n, 11);
  assert.ok(runOf().items.every((it) => it.state !== 'belt' && it.state !== 'queued'));
});

test('belt geometry the mission relies on: the 10 cm wide belt and 30 s ride at 2 cm/s', () => {
  assert.ok(Math.abs((BELT.y1 - BELT.y0) / WASTE.speed - 30) < 1e-9);
});
