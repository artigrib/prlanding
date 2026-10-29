// Physics-in-the-loop tests: every mission's automatic solution must succeed in MuJoCo (node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScene } from './mj-node.mjs';
import { ArmController } from '../src/controller.js';
import { World } from '../src/world.js';
import { MISSIONS, MissionRunner } from '../src/missions.js';

const { mj, m, d } = await loadScene();
const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper']
  .map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
const world = new World(mj, m, d);
const ctl = new ArmController(mj, m, d, act);
const runner = new MissionRunner(world);
const ts = m.opt.timestep;

function reset(id) {
  mj.mj_resetDataKeyframe(m, d, 0);
  runner.select(id); runner.setup();
  mj.mj_forward(m, d);
  ctl.cancel(); ctl.syncFromCtrl();
}
// simulate `sec` seconds; controller ticks at ~60 Hz like the page
function run(sec, stopWhen) {
  const n = Math.round(sec / ts), every = 4;
  for (let i = 0; i < n; i++) {
    if (i % every === 0) {
      ctl.update(ts * every);
      ctl.actualTip(runner.ctx.tip); runner.ctx.gripOpen = ctl.gripOpen();
    }
    mj.mj_step(m, d);
    if (i % every === 0) { runner.tick(ts * every); if (stopWhen && stopWhen()) return i * ts; }
  }
  return sec;
}

for (const mis of MISSIONS.filter((x) => !x.objects)) {   // object missions: tests/missions-objects.test.mjs
  test(`mission "${mis.id}" is solved by its automatic plan`, () => {
    reset(mis.id);
    runner.start();
    const plan = mis.solve(ctl, world);
    assert.ok(plan.ok, 'plan reachable; bad: ' + JSON.stringify(plan.bad));
    ctl.run(plan);
    const t = run(40, () => runner.won);
    assert.ok(runner.won, `not won after ${t.toFixed(1)} s; hud: ${runner.last.text}; busy ${ctl.busy()}`);
    console.log(`  ${mis.id}: won after ${t.toFixed(1)} s sim time, stars ${runner.result.stars}, prec ${(runner.result.prec * 1000).toFixed(1)} mm`);
  });
}

test('drag-follow: the tip follows a moving target smoothly', () => {
  reset('bowl');
  ctl.begin();
  const tip = new Float64Array(3);
  for (let k = 0; k <= 60; k++) {
    ctl.setTarget(0.18 + 0.1 * k / 60, -0.1 + 0.2 * k / 60, 0.08);
    run(1 / 60);
  }
  run(1.5);
  ctl.actualTip(tip);
  const e = Math.hypot(tip[0] - 0.28, tip[1] - 0.1, tip[2] - 0.08);
  assert.ok(e < 0.006, 'tip error ' + e);
  assert.ok(ctl.reachable);
});

test('click-to-pick works for cubes at random spots and headings', async () => {
  const { pickPlace, bowlDrop } = await import('../src/missions.js');
  let s = 7; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let okN = 0; const N = 8;
  for (let k = 0; k < N; k++) {
    reset('bowl');
    const x = 0.14 + 0.16 * rnd(), y = -0.2 + 0.22 * rnd(), yaw = (rnd() - 0.5) * Math.PI;
    world.place('cube', x, y, null, yaw); mj.mj_forward(m, d);
    runner.start();
    const plan = pickPlace(ctl, world, 'cube', bowlDrop(world, 'bowl'));
    ctl.run(plan);
    run(25, () => runner.won);
    if (runner.won) okN++; else console.log('  miss at', x.toFixed(3), y.toFixed(3), yaw.toFixed(2), runner.last.text);
  }
  assert.ok(okN >= N - 1, `${okN}/${N} picks succeeded`);
});
