// End to end: a demonstration recorded by Teach (real MuJoCo physics in node) exports to LeRobot v2.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScene } from './mj-node.mjs';
import { ArmController } from '../src/controller.js';
import { Teach } from '../src/ui/teach.js';
import { buildDataset, FPS } from '../src/export/lerobot.js';

const { mj, m, d } = await loadScene();
const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper']
  .map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
const ctl = new ArmController(mj, m, d, act);
const ux = {
  mj, ctl, app: { d, m, act, stopDemo() {} }, runner: { m: { id: 'stack', n: '02', title: 'Postavte věž' }, ctx: { s: {} } },
  beginReplayReset() { mj.mj_resetDataKeyframe(m, d, 0); mj.mj_forward(m, d); }
};
const teach = new Teach(ux);
const step = (sec) => { for (let i = 0, n = Math.round(sec / m.opt.timestep); i < n; i++) { teach.pre(); mj.mj_step(m, d); teach.sample(); } };

test('Teach.toJSON() output converts to a LeRobot dataset with exact 30 fps timestamps', async () => {
  teach.startRec();
  for (let i = 0; i < 6; i++) d.ctrl[act[i]] = [0.3, -0.4, 0.4, 0.9, 0.2, 0.8][i];
  step(1.2);
  teach.stopRec();
  const demo = JSON.parse(JSON.stringify(teach.toJSON()));
  const files = await buildDataset([demo]);
  const info = JSON.parse(files['meta/info.json']);
  const src = demo.episodes[0].frames;
  assert.equal(info.total_episodes, 1);
  // the exporter's grid starts at the first frame (the recorder's first sample is one physics step after the start)
  assert.equal(info.total_frames, Math.floor((src[src.length - 1].timestamp - src[0].timestamp) * FPS + 1e-6) + 1);
  assert.equal(JSON.parse(files['meta/tasks.jsonl']).task, 'Build a tower');
  const st = JSON.parse(files['meta/episodes_stats.jsonl']).stats;
  // gripper in 0–100 %, joints in degrees (well inside ±180)
  assert.ok(st.action.min[5] >= 0 && st.action.max[5] <= 100);
  for (let j = 0; j < 5; j++) assert.ok(Math.abs(st['observation.state'].max[j]) < 180);
  // recorder 3 (fixed 30 fps grid, observe then command) is marked in the demo; the demo format itself is unchanged
  assert.equal(demo.format, 'printedrobotics.cz/so101-sim-demo@1');
  assert.equal(demo.printedrobotics.recorder, 3);
  const rate = (src.length - 1) / (src.at(-1).timestamp - src[0].timestamp);
  assert.ok(Math.abs(rate - FPS) < 0.5, `${rate} fps`);
  // an older demo (no recorder field) still loads, exports and keeps saying it is recorder 1
  const old = JSON.parse(JSON.stringify(demo));
  delete old.printedrobotics.recorder; delete old.printedrobotics.recorder_note;
  assert.equal(teach.importJSON(old), src.length);
  assert.equal(teach.toJSON().printedrobotics.recorder, 1);
  assert.equal(JSON.parse((await buildDataset([old]))['meta/info.json']).total_frames, info.total_frames);
  for (const r of [2, 3]) {   // a recorder 2 demo keeps its number through import and download
    const v = JSON.parse(JSON.stringify(demo)); v.printedrobotics.recorder = r;
    teach.importJSON(v); assert.equal(teach.toJSON().printedrobotics.recorder, r);
  }
});
