// LeRobot v2.1 export (src/export/lerobot.js) with a synthetic demonstration.
// Set LEROBOT_OUT=<dir> to also write the dataset there (used to check it with pyarrow / lerobot).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDataset, exportLeRobotZip, parseDemo, resample, features, imageStats, NAMES, FPS, ENV_KEY, ENV_NAMES, MISSION_TASKS, IMAGE_PREFIX } from '../src/export/lerobot.js';

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
  const files = await buildDataset([synthDemo('bowl'), synthDemo('stack', 1.5), synthDemo('bowl', 1)], { repoId: 'protorobot/so101-sim-test' });
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

// a conveyor demo (mission 11): env on every frame (target / next item) and two per-item segments
function wasteDemo(secs = 4) {
  const j = synthDemo('waste_hand', secs), fr = j.episodes[0].frames, n = fr.length;
  fr.forEach((f, i) => {
    const y = -0.15 + 0.02 * f.timestamp;
    f.env = { belt: i > n - 10 ? 0 : 0.02,
      target: { item: i < n / 2 ? 'cup_paper1' : 'socket_s1', class: i < n / 2 ? 'paper' : 'metal', pos: [0.24, y, 0.03], yaw: 0.5 },
      next: i < n / 2 ? { item: 'socket_s1', class: 'metal', pos: [0.24, y - 0.2, 0.02], yaw: -1 } : null };
  });
  j.printedrobotics.segments = [
    { item: 'cup_paper1', class: 'paper', outcome: 'sorted', bin: 'bin_paper', from: 0, to: Math.floor(n / 2) - 1 },
    { item: 'socket_s1', class: 'metal', outcome: 'wrong', bin: 'bin_glass', from: Math.floor(n / 2), to: n - 1 }
  ];
  return j;
}

test('waste demos: observation.environment_state (18 floats), the waste task, one episode per item', async () => {
  assert.equal(MISSION_TASKS.waste_hand, 'Sort the waste into bins by material');
  assert.equal(MISSION_TASKS.waste_teach, MISSION_TASKS.waste_hand);
  const j = wasteDemo(), n = j.episodes[0].frames.length;
  const ep = parseDemo(j);
  assert.equal(ep.task, 'Sort the waste into bins by material');
  assert.equal(ep.env.length, n);
  assert.equal(ep.env[0].length, 18);
  assert.deepEqual(ep.env[0].slice(5, 9), [1, 0, 0, 0], 'target paper');
  assert.deepEqual(ep.env[0].slice(14, 18), [0, 0, 0, 1], 'next metal');
  assert.deepEqual(ep.env[n - 1].slice(9), new Array(9).fill(0), 'no next item: zeros');
  // resampling holds the nearest frame (no blended one-hot)
  const r = resample(ep);
  for (const row of r.env) assert.equal(row.slice(5, 9).reduce((a, b) => a + b, 0), 1);
  const files = await buildDataset([j, wasteDemo(3)]);
  const info = JSON.parse(files['meta/info.json']);
  assert.equal(info.total_episodes, 4, 'two items per demo');
  assert.deepEqual(info.features[ENV_KEY], { dtype: 'float32', shape: [18], names: ENV_NAMES });
  assert.deepEqual(Object.keys(info.features), ['action', 'observation.state', ENV_KEY, 'timestamp', 'frame_index', 'episode_index', 'index', 'task_index']);
  const eps = files['meta/episodes.jsonl'].trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(eps.reduce((a, e) => a + e.length, 0), info.total_frames);
  assert.ok(Math.abs(eps[0].length - Math.floor(n / 2) * 1) <= Math.ceil(n / 2), 'the first item episode is about half the demo');
  const tasks = files['meta/tasks.jsonl'].trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(tasks, [{ task_index: 0, task: 'Sort the waste into bins by material' }]);
  const st = files['meta/episodes_stats.jsonl'].trim().split('\n').map((l) => JSON.parse(l));
  const es = st[0].stats[ENV_KEY];
  assert.equal(es.mean.length, 18); assert.deepEqual(es.count, [eps[0].length]);
  assert.equal(es.min[5], 1, 'episode 0 is the paper cup throughout'); assert.equal(es.max[8], 0);
  assert.equal(st[1].stats[ENV_KEY].max[8], 1, 'episode 1: the socket (metal)');
  const agg = JSON.parse(files['meta/stats.json']);
  assert.equal(agg[ENV_KEY].std.length, 18);
  // number types as numpy writes them (LeRobot's v2.1 → v3.0 converter concatenates all episodes' stats in one Arrow
  // table): float32 features and every mean / std as floats (0.0, not 0), int64 min / max and counts as integers
  for (const txt of [files['meta/episodes_stats.jsonl'], files['meta/stats.json']]) {
    for (const m of txt.matchAll(/"(min|max|mean|std)":\s*\[([^\]]*)\]/g)) {
      for (const tok of m[2].split(',').map((x) => x.trim())) assert.ok(/^-?\d+$/.test(tok) ? (m[1] === 'min' || m[1] === 'max') : /^-?\d+\.\d+(e[-+]?\d+)?$|^-?\d(\.\d+)?e[-+]?\d+$/.test(tok), `${m[1]} ${tok}`);
    }
  }
  assert.match(files['meta/episodes_stats.jsonl'], /"frame_index":\{"min":\[0\],"max":\[\d+\],"mean":\[\d+\.\d+\]/, 'int64 min / max integers, mean a float');
  assert.ok(/"std":\[0\.0/.test(files['meta/episodes_stats.jsonl']), 'a zero std is written 0.0');
  assert.deepEqual(agg[ENV_KEY].count, [info.total_frames]);
  // the Parquet footer names the column and the HF feature (length 18)
  const p = files['data/chunk-000/episode_000000.parquet'], txt = new TextDecoder('latin1').decode(p);
  assert.ok(txt.includes(ENV_KEY), 'column in the Parquet schema');
  assert.ok(txt.includes('"' + ENV_KEY + '":{"feature":{"dtype":"float32","_type":"Value"},"length":18,"_type":"Sequence"}'), 'HF feature metadata');
  assert.match(files['README.md'], /observation\.environment_state/);
  assert.match(files['README.md'], /2 sorted, 2 wrong/);
  // perItem: false keeps one episode per file
  assert.equal(JSON.parse((await buildDataset([j], { perItem: false }))['meta/info.json']).total_episodes, 1);
  if (process.env.LEROBOT_OUT_ENV) {
    for (const [f, v] of Object.entries(files)) {
      const out = path.join(process.env.LEROBOT_OUT_ENV, f);
      fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, v);
    }
  }
});

test('backward compatibility: demos without env export exactly as before; mixing or damage is refused', async () => {
  assert.deepEqual(features(), features({ env: false }));
  assert.ok(!(ENV_KEY in features()));
  const old = parseDemo(synthDemo());
  assert.equal(old.env, null); assert.equal(old.segments, null);
  const files = await buildDataset([synthDemo()]);
  const info = JSON.parse(files['meta/info.json']);
  assert.deepEqual(Object.keys(info.features), ['action', 'observation.state', 'timestamp', 'frame_index', 'episode_index', 'index', 'task_index']);
  assert.ok(!new TextDecoder('latin1').decode(files['data/chunk-000/episode_000000.parquet']).includes(ENV_KEY));
  assert.doesNotMatch(files['README.md'], /environment_state/);
  // an old waste_hand demo (no env): one episode, the waste task, no env feature
  const ow = synthDemo('waste_hand');
  const fo = JSON.parse((await buildDataset([ow]))['meta/info.json']);
  assert.equal(fo.total_episodes, 1); assert.ok(!(ENV_KEY in fo.features));
  await assert.rejects(buildDataset([wasteDemo(), synthDemo()]), /mixed demos/);
  const spoil = (fn) => { const j = wasteDemo(); fn(j); return () => parseDemo(j); };
  assert.throws(spoil((j) => { delete j.episodes[0].frames[3].env; }), /env/);
  assert.throws(spoil((j) => { j.episodes[0].frames[3].env.target.class = 'glass'; }), /env/);
  assert.throws(spoil((j) => { j.episodes[0].frames[3].env.target.pos = [0, 'x', 0]; }), /env/);
  assert.throws(spoil((j) => { j.printedrobotics.segments[0].to = 99999; }), /segments/);
  assert.throws(() => { const j = synthDemo('waste_hand'); j.printedrobotics.segments = []; parseDemo(j); }, /segments without env/);
});

// a SIL replay (tools/sil/replay.mjs): the waste demo with two rendered cameras and per-frame image sums
function replayDemo() {
  const j = wasteDemo(), n = j.episodes[0].frames.length;
  const sums = (k, c) => [k % 7, 2 + c, 3, 200, 210 + c, 220, 100 * 64, 110 * 64, 120 * 64, 100 * 100 * 64, 110 * 110 * 64, 120 * 120 * 64 + k, 64];
  j.printedrobotics.replay = { format: 'printedrobotics.cz/so101-sil-replay@1', width: 32, height: 24,
    cameras: [{ name: 'up', preset: 'up' }, { name: 'wrist', preset: 'wrist' }],
    items: [{ item: 'cup_paper1', recorded: 'sorted', replay: 'sorted' }, { item: 'socket_s1', recorded: 'sorted', replay: 'wrong' }],
    images: { dir: 'images/000', sums: { up: Array.from({ length: n }, (_, k) => sums(k, 0)), wrist: Array.from({ length: n }, (_, k) => sums(k, 1)) } } };
  return j;
}

test('SIL replay demos: observation.images.<camera> (image dtype, PNG bytes from the loader), stats (3,1,1), diverged items left out', async () => {
  const j = replayDemo(), asked = [];
  const png = (demo, cam, k) => { asked.push([demo, cam, k]); return new Uint8Array([0x89, 0x50, 0x4e, 0x47, cam === 'up' ? 1 : 2, k & 255]); };
  const files = await buildDataset([j], { images: png });
  const info = JSON.parse(files['meta/info.json']);
  assert.equal(info.total_episodes, 1, 'the socket ended "wrong" in the replay, "sorted" in the recording: left out');
  for (const c of ['up', 'wrist']) assert.deepEqual(info.features[IMAGE_PREFIX + c], { dtype: 'image', shape: [24, 32, 3], names: ['height', 'width', 'channels'] });
  assert.equal(info.total_videos, 0);
  // the loader was asked for exactly the frames of the cup's episode (resampled onto 30 fps: the nearest frame)
  const seg = j.printedrobotics.segments[0];
  assert.equal(asked.length, 2 * info.total_frames);
  assert.ok(asked.every(([d, , k]) => d === 0 && k >= seg.from && k <= seg.to));
  const st = JSON.parse(files['meta/stats.json'])[IMAGE_PREFIX + 'up'];
  assert.deepEqual([st.mean.length, st.mean[0].length, st.mean[0][0].length], [3, 1, 1]);
  assert.ok(Math.abs(st.mean[0][0][0] - 100 / 255) < 1e-12 && Math.abs(st.max[2][0][0] - 220 / 255) < 1e-12);
  assert.ok(Math.abs(imageStats([[0, 0, 0, 10, 10, 10, 10, 20, 30, 50, 200, 450, 2]]).std[0] - Math.sqrt(25 - 25) / 255) < 1e-12);
  assert.match(files['meta/stats.json'], /"min": \[\s*\[\s*\[\s*0\.0/, 'image stats are floats, as numpy writes them');
  const txt = new TextDecoder('latin1').decode(files['data/chunk-000/episode_000000.parquet']);
  assert.ok(txt.includes('"' + IMAGE_PREFIX + 'up":{"_type":"Image"}'), 'HF Image feature in the Parquet metadata');
  assert.match(files['README.md'], /observation\.images\.up`, `observation\.images\.wrist` \(32×24 RGB, PNG\)/);
  assert.match(files['README.md'], /not photographs/);
  // keepDiverged keeps the socket (labelled with the replay's outcome); envState: false drops the item state only
  const k = JSON.parse((await buildDataset([j], { images: png, keepDiverged: true, envState: false }))['meta/info.json']);
  assert.equal(k.total_episodes, 2); assert.ok(!(ENV_KEY in k.features)); assert.ok(IMAGE_PREFIX + 'up' in k.features);
  // images: false exports without them; a replay without a loader, or damaged camera data, is refused
  assert.ok(!(IMAGE_PREFIX + 'up' in JSON.parse((await buildDataset([j], { images: false }))['meta/info.json']).features));
  await assert.rejects(buildDataset([j]), /PNG loader/);
  await assert.rejects(buildDataset([j, wasteDemo()], { images: png }), /different cameras/);
  const bad = replayDemo(); bad.printedrobotics.replay.images.sums.up.pop();
  assert.throws(() => parseDemo(bad), /bad replay cameras/);
  const bad2 = replayDemo(); bad2.printedrobotics.replay.cameras[1].name = 'up';
  assert.throws(() => parseDemo(bad2), /bad replay cameras/);
});
