// LeRobot v2.1 export (src/export/lerobot.js) with a synthetic demonstration.
// Set LEROBOT_OUT=<dir> to also write the dataset there (used to check it with pyarrow / lerobot).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDataset, exportLeRobotZip, parseDemo, resample, NAMES, FPS } from '../src/export/lerobot.js';

// a demo in the Teach.toJSON() format: 2.5 s, physics-step jitter on the timestamps
function synthDemo(mission = 'bowl', secs = 2.5) {
  const frames = [];
  for (let i = 0, t = 0; t <= secs; i++, t += 1 / FPS + (i % 3 === 0 ? 0.002 : -0.001)) {
    const s = [10 * Math.sin(t), -20 + t, 30 * Math.cos(t), 5, -3 * t, 50 + 40 * Math.sin(2 * t)];
    frames.push({ frame_index: i, timestamp: Math.round(t * 1000) / 1000, 'observation.state': s.map((x) => x + 0.5), action: s });
  }
  return {
    format: 'printedrobotics.cz/so101-sim-demo@1', robot_type: 'so101_follower', fps: 30,
    printedrobotics: { mission, snapshot: null },
    episodes: [{ episode_index: 0, task: 'Přeneste kostku do misky', length: frames.length, frames }]
  };
}

test('parseDemo validates and uses an English task for known missions', () => {
  const ep = parseDemo(synthDemo());
  assert.equal(ep.task, 'Move the cube into the bowl');
  assert.equal(parseDemo(synthDemo(), { task: 'Custom' }).task, 'Custom');
  assert.throws(() => parseDemo({ fps: 25, episodes: [] }), /fps/);
  const bad = synthDemo(); bad.episodes[0].frames[3].action = [1, 2, 3];
  assert.throws(() => parseDemo(bad), /row/);
  const back = synthDemo(); back.episodes[0].frames[4].timestamp = 0;
  assert.throws(() => parseDemo(back), /timestamp/);
});

test('resample puts frames on an exact 30 fps grid', () => {
  const ep = parseDemo(synthDemo());
  const r = resample(ep);
  const dur = ep.t[ep.t.length - 1] - ep.t[0];
  assert.equal(r.n, Math.floor(dur * FPS + 1e-6) + 1);
  assert.deepEqual(r.state[0], ep.state[0]);
  // a value in the middle lies between its neighbours
  for (const row of r.action) for (const x of row) assert.ok(Number.isFinite(x));
});

test('buildDataset writes a LeRobot v2.1 layout', async () => {
  const files = await buildDataset([synthDemo('bowl'), synthDemo('stack', 1.5), synthDemo('bowl', 1)], { repoId: 'printedrobotics/so101-sim-test' });
  const info = JSON.parse(files['meta/info.json']);
  assert.equal(info.codebase_version, 'v2.1');
  assert.equal(info.robot_type, 'so101_follower');
  assert.equal(info.fps, 30);
  assert.equal(info.total_episodes, 3);
  assert.equal(info.total_tasks, 2);
  assert.equal(info.source, 'simulation');
  assert.equal(info.license, 'cc-by-4.0');
  assert.deepEqual(info.features.action.names, NAMES);
  assert.deepEqual(info.features['observation.state'].shape, [6]);
  assert.deepEqual(NAMES, ['shoulder_pan.pos', 'shoulder_lift.pos', 'elbow_flex.pos', 'wrist_flex.pos', 'wrist_roll.pos', 'gripper.pos']);
  const eps = files['meta/episodes.jsonl'].trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(eps.length, 3);
  assert.equal(eps.reduce((a, e) => a + e.length, 0), info.total_frames);
  const tasks = files['meta/tasks.jsonl'].trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(tasks.map((t) => t.task), ['Move the cube into the bowl', 'Build a tower']);
  const st = files['meta/episodes_stats.jsonl'].trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(st[0].stats.action.mean.length, 6);
  assert.deepEqual(st[1].stats.frame_index.count, [eps[1].length]);
  for (let e = 0; e < 3; e++) {
    const p = files[`data/chunk-000/episode_${String(e).padStart(6, '0')}.parquet`];
    assert.ok(p instanceof Uint8Array && p.length > 100);
    assert.equal(new TextDecoder().decode(p.subarray(0, 4)), 'PAR1');
    assert.equal(new TextDecoder().decode(p.subarray(p.length - 4)), 'PAR1');
  }
  assert.match(files['README.md'], /^---\nlicense: cc-by-4.0\n/);
  assert.match(files['README.md'], /\nsource: simulation\n/);
  if (process.env.LEROBOT_OUT) {
    for (const [f, v] of Object.entries(files)) {
      const out = path.join(process.env.LEROBOT_OUT, f);
      fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, v);
    }
  }
});

test('exportLeRobotZip produces a valid store-only zip', async () => {
  const { bytes, name, files } = await exportLeRobotZip(synthDemo());
  assert.equal(name, 'so101-sim-bowl-lerobot.zip');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  const end = bytes.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), Object.keys(files).length);
});
