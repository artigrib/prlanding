// Teach & replay (src/ui/teach.js) with real MuJoCo physics in node: looping must restart from the snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScene } from './mj-node.mjs';
import { ArmController } from '../src/controller.js';
import { Teach } from '../src/ui/teach.js';

const { mj, m, d } = await loadScene();
const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper']
  .map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
const ctl = new ArmController(mj, m, d, act);
const mission = { id: 'bowl', n: '01', title: 'Přeneste kostku do misky' };
// minimal UX stand-in; beginReplayReset resets to the keyframe like app.reset() does
const ux = {
  mj, ctl, app: { d, m, act, stopDemo() {} }, runner: { m: mission, ctx: { s: {} } },
  beginReplayReset() { mj.mj_resetDataKeyframe(m, d, 0); mj.mj_forward(m, d); }
};
const teach = new Teach(ux);
const ts = m.opt.timestep;
const step = (sec) => { for (let i = 0, n = Math.round(sec / ts); i < n; i++) { teach.pre(); mj.mj_step(m, d); teach.sample(); } };

test('loop replay restarts from the recorded snapshot (time, pose, progress)', () => {
  // move away from the keyframe first, so the snapshot differs from it
  for (let i = 0; i < 6; i++) d.ctrl[act[i]] = [0.4, -0.6, 0.5, 1.0, 0.3, 1.0][i];
  step(1.5);
  teach.startRec();
  const snapTime = d.time, snapQ = Array.from(d.qpos.subarray(0, 6));
  for (let i = 0; i < 6; i++) d.ctrl[act[i]] = [-0.3, -0.2, 0.2, 1.2, -0.4, 0.2][i];
  step(2);
  teach.stopRec();
  assert.ok(teach.demo && teach.demo.t.length > 50);
  teach.loop = true;
  assert.ok(teach.startReplay());
  assert.ok(Math.abs(d.time - snapTime) < 1e-9, 'replay starts at the snapshot time');
  let minP = 1, restarts = 0, prevP = 0;
  for (let k = 0; k < 900; k++) {          // 3.6 s: past the end (2 s + 0.6 s) → one loop restart
    step(ts);
    const p = teach.progress();
    minP = Math.min(minP, p);
    if (p < prevP - 0.5) {
      restarts++;
      for (let i = 0; i < 6; i++) assert.ok(Math.abs(d.qpos[i] - snapQ[i]) < 0.02, 'pose after restart ' + i);
    }
    prevP = p;
  }
  assert.ok(teach.replaying, 'still replaying (loop)');
  assert.equal(restarts, 1, 'looped once');
  assert.ok(minP >= 0, 'progress never negative (' + minP + ')');
});
