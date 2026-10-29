// Object missions (chapters 06–10): every automatic solution succeeds in MuJoCo with the real objects (node).
// Also: the plain scene is untouched (mission 01 loads no object), every library item is pickable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadObjectScene, loadScene } from './mj-node.mjs';
import { ArmController } from '../src/controller.js';
import { World } from '../src/world.js';
import { MISSIONS, MissionRunner, libPickPlace } from '../src/missions.js';
import { LIB_ITEMS } from '../src/objects/scene.js';

const { mj, m, d, sizes } = await loadObjectScene();
const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper']
  .map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
const world = new World(mj, m, d); world.sizes(sizes);
const ctl = new ArmController(mj, m, d, act);
const runner = new MissionRunner(world);
const ts = m.opt.timestep;
const OBJ = MISSIONS.filter((x) => x.objects);

function reset(id) {
  mj.mj_resetDataKeyframe(m, d, 0);
  runner.select(id); runner.setup();
  mj.mj_forward(m, d);
  ctl.cancel(); ctl.syncFromCtrl();
}
function run(sec, stopWhen) {
  const n = Math.round(sec / ts), every = 4;
  for (let i = 0; i < n; i++) {
    if (i % every === 0) { ctl.update(ts * every); ctl.actualTip(runner.ctx.tip); runner.ctx.gripOpen = ctl.gripOpen(); }
    mj.mj_step(m, d);
    if (i % every === 0) { runner.tick(ts * every); if (stopWhen && stopWhen()) return i * ts; }
  }
  return sec;
}

test('plain scene has no library objects (mission 01 loads nothing extra)', async () => {
  const base = await loadScene();
  const w = new World(base.mj, base.m, base.d);
  assert.equal(w.lib, false);
  assert.equal(base.mj.mj_name2id(base.m, base.mj.mjtObj.mjOBJ_BODY.value, 'nut1'), -1);
  assert.ok(world.lib && OBJ.length === 5);
  assert.deepEqual(OBJ.map((x) => x.n), ['06', '07', '08', '09', '10']);
});

test('objects of the missions settle on the table without moving away', () => {
  for (const mis of OBJ) {
    reset(mis.id);
    const before = Object.fromEntries(Object.keys(mis.layout).filter((n) => world.o[n].lib).map((n) => [n, Array.from(world.com(n))]));
    run(1.5);
    for (const [n, p] of Object.entries(before)) {
      const q = world.com(n);
      assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.006 && Math.abs(q[2] - p[2]) < 0.006, `${mis.id}/${n} moved ${(Math.hypot(q[0] - p[0], q[1] - p[1]) * 1000).toFixed(1)} mm`);
    }
  }
});

for (const mis of OBJ) {
  test(`object mission "${mis.id}" (${mis.n}) is solved by its automatic plan`, () => {
    reset(mis.id);
    runner.start();
    const plan = mis.solve(ctl, world);
    assert.ok(plan.ok, 'plan reachable; bad: ' + JSON.stringify(plan.bad));
    ctl.run(plan);
    const t = run(150, () => runner.won);
    assert.ok(runner.won, `not won after ${t.toFixed(1)} s; hud: ${runner.last.text}; busy ${ctl.busy()}`);
    console.log(`  ${mis.id}: won after ${t.toFixed(1)} s sim time, stars ${runner.result.stars}, prec ${(runner.result.prec * 1000).toFixed(1)}`);
  });
}

test('every library item can be picked up and carried (SO-101 gripper, real mass/friction)', () => {
  const seen = new Set();
  for (const it of LIB_ITEMS) {
    if (seen.has(it.id)) continue; seen.add(it.id);
    mj.mj_resetDataKeyframe(m, d, 0);
    world.layout({ [it.name]: [0.25, -0.1, 0.4] }); ctl.cancel(); ctl.syncFromCtrl();
    run(0.5);
    const z0 = world.com(it.name)[2];
    const [a, b] = libPickPlace(ctl, world, it.name, [0.2, 0.14], 0);
    ctl.run(ArmController.chain(a, b));
    let lift = 0;
    for (let k = 0; k < 400 && ctl.busy(); k++) { run(0.04); lift = Math.max(lift, world.com(it.name)[2] - z0); }
    run(1);
    const p = world.com(it.name);
    assert.ok(lift > 0.06, `${it.id}: lifted only ${(lift * 1000).toFixed(0)} mm`);
    assert.ok(Math.hypot(p[0] - 0.2, p[1] - 0.14) < 0.03, `${it.id}: put down ${(Math.hypot(p[0] - 0.2, p[1] - 0.14) * 1000).toFixed(0)} mm off`);
  }
});

test('app.js knows which missions need the object scene (same list and order as MISSIONS)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const list = JSON.parse(/const OBJECT_MISSIONS = (\[[^\]]*\])/.exec(src)[1].replace(/'/g, '"'));
  assert.deepEqual(list, OBJ.map((x) => x.id));
  assert.deepEqual(MISSIONS.filter((x) => !x.objects).map((x) => x.id), ['bowl', 'stack', 'sort', 'ball', 'trace']);
});

test('parked library objects float without contacts (no cost, no drift)', () => {
  reset('line');
  run(3);
  for (const n of ['apple', 'vial', 'screwdriver']) assert.ok(Math.abs(world.com(n)[2] + 0.72) < 0.05, `${n} z ${world.com(n)[2]}`);
  for (const n of ['nut1', 'bolt2']) assert.ok(world.com(n)[2] > 0 && world.com(n)[2] < 0.04, `${n} on the table`);
});
