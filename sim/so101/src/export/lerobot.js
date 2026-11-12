// LeRobot dataset export (format v2.1) for demonstrations recorded in the SO-101 simulator.
//
// Input: the demo JSON written by Teach.toJSON() / Teach.download() (src/ui/teach.js,
//   format 'printedrobotics.cz/so101-sim-demo@1': 30 fps frames with observation.state and action,
//   joints in degrees, gripper 0–100 % open). One JSON = one episode; pass several for several episodes.
// Output: the files of a LeRobot v2.1 dataset (no videos: the simulator records joints only)
//   meta/info.json, meta/tasks.jsonl, meta/episodes.jsonl, meta/episodes_stats.jsonl, meta/stats.json,
//   data/chunk-000/episode_000000.parquet …, README.md (dataset card: CC BY 4.0, source: simulation),
//   optionally zipped (store-only zip, no dependencies).
//
// Conveyor missions (11 on): demos with env frames (frames[].env, src/policy/episodes.js) also export
// observation.environment_state (18 float32: target item then next item, each position 3 + yaw sin/cos 2 + class
// one-hot 4), and a demo cut into per-item segments (printedrobotics.segments) becomes one episode per item.
//
// Camera images (tier b, campaign "Třídění odpadu" §4.2): a demo replayed in the SIL runner (tools/sil/replay.mjs,
// printedrobotics.replay.cameras) carries rendered frames on disk; with opts.images (a loader for the PNG bytes)
// every camera becomes an `observation.images.<name>` feature (dtype image: PNG bytes inside the Parquet, as LeRobot's
// own image datasets), with per-channel stats from the replay's per-frame sums. The browser itself renders no
// camera, so the page exports joints (and env) only; images come from the SIL replay.
//
// Pure module: no DOM access except downloadLeRobot(); the Parquet writer (vendor/hyparquet-writer,
// MIT) is imported lazily. Tested in node: sim/so101/tests/lerobot-export.test.mjs.
// Usage and the LeRobot schema it follows: docs/lerobot-export.md.

export const FPS = 30;
export const CODEBASE_VERSION = 'v2.1';
export const ROBOT_TYPE = 'so101_follower';
export const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
export const NAMES = JOINTS.map((n) => n + '.pos');
export const DEFAULT_LICENSE = 'cc-by-4.0';
const MAX_FRAMES = 200 * FPS;                 // the simulator records at most 180 s
const CHUNK = 1000;                           // episodes per chunk (LeRobot default)
const DEMO_FORMAT = 'printedrobotics.cz/so101-sim-demo@1';
import { ENV_NAMES, ENV_DIM, envVector, validEnv, validSegments } from '../policy/episodes.js';
export { ENV_NAMES };
export const ENV_KEY = 'observation.environment_state';   // LeRobot's OBS_ENV_STATE (lerobot/utils/constants.py)
export const IMAGE_PREFIX = 'observation.images.';           // LeRobot's OBS_IMAGES + '.' + camera name
const WRITER_URL = new URL('../../vendor/hyparquet-writer/hyparquet-writer.min.js', import.meta.url);

/** English task instructions for the simulator missions (the demo JSON carries the Czech title). */
export const MISSION_TASKS = {
  bowl: 'Move the cube into the bowl',
  stack: 'Build a tower',
  sort: 'Sort the colours',
  ball: 'Push the ball into the goal',
  trace: 'Trace the star',
  waste_hand: 'Sort the waste into bins by material',
  waste_teach: 'Sort the waste into bins by material',
  waste_line: 'Sort the waste into bins by material'
};

const isRow = (v) => Array.isArray(v) && v.length === 6 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/**
 * Validate a demo JSON and return its single episode as plain arrays. env: the environment-state vectors per frame
 * (null for demos without env frames: older demos and missions without a belt); segments: per-item cuts or null.
 * @returns {{ task: string, mission: string|null, t: number[], state: number[][], action: number[][],
 *   env: number[][]|null, segments: object[]|null }}
 */
export function parseDemo(j, { task } = {}) {
  if (!j || typeof j !== 'object') throw new Error('not a demo: expected an object');
  if (j.format && j.format !== DEMO_FORMAT) throw new Error('unknown demo format: ' + j.format);
  if (j.fps !== FPS) throw new Error('demo fps must be ' + FPS);
  const ep = Array.isArray(j.episodes) && j.episodes[0];
  if (!ep || !Array.isArray(ep.frames)) throw new Error('not a demo: no episodes[0].frames');
  const n = ep.frames.length;
  if (n < 2) throw new Error('demo too short');
  if (n > MAX_FRAMES) throw new Error('demo too long');
  const t = [], state = [], action = [], envRaw = [];
  let prev = -Infinity;
  for (const f of ep.frames) {
    if (!f || typeof f !== 'object') throw new Error('bad frame');
    const ts = f.timestamp;
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < 0 || ts < prev) throw new Error('bad timestamp');
    if (!isRow(f['observation.state']) || !isRow(f.action)) throw new Error('bad frame row');
    t.push(prev = ts); state.push(f['observation.state'].slice()); action.push(f.action.slice()); envRaw.push(f.env);
  }
  const pr = (j.printedrobotics && typeof j.printedrobotics === 'object') ? j.printedrobotics : {};
  const mission = typeof pr.mission === 'string' ? pr.mission : null;
  const name = task || MISSION_TASKS[mission] || (typeof ep.task === 'string' && ep.task.trim()) || 'SO-101 simulator demonstration';
  // env on every frame or on none; segments only with env
  let env = null, segments = null;
  if (!envRaw.every((e) => e === undefined)) {
    const ok = validEnv(envRaw, n);
    if (!ok) throw new Error('bad env frames');
    env = ok.map(envVector);
    if (pr.segments != null) { segments = validSegments(pr.segments, n); if (!segments) throw new Error('bad segments'); }
  } else if (pr.segments != null) throw new Error('segments without env frames');
  // SIL replay (tools/sil/lib/replay.mjs): cameras rendered per frame, per-frame channel sums for the stats
  let images = null;
  const rp = pr.replay;
  if (rp && Array.isArray(rp.cameras) && rp.cameras.length) {
    const names = rp.cameras.map((c) => c && c.name), sums = rp.images && rp.images.sums;
    const ok = names.every((c) => typeof c === 'string' && /^[A-Za-z0-9_.-]+$/.test(c)) && new Set(names).size === names.length &&
      Number.isInteger(rp.width) && Number.isInteger(rp.height) && rp.width >= 16 && rp.height >= 16 && rp.width <= 1920 && rp.height <= 1080 &&
      sums && names.every((c) => Array.isArray(sums[c]) && sums[c].length === n && sums[c].every((r) => Array.isArray(r) && r.length === 13 && r.every(Number.isFinite)));
    if (!ok) throw new Error('bad replay cameras');
    images = { names, width: rp.width, height: rp.height, sums, items: Array.isArray(rp.items) ? rp.items : [] };
  }
  return { task: String(name).slice(0, 500), mission, t, state, action, env, segments, images, fidx: t.map((_, i) => i) };
}

/**
 * Resample an episode onto an exact fps grid (t_k = k / fps, starting at the first frame), linear
 * interpolation per joint. LeRobot checks that timestamps match frame_index / fps (tolerance 1e-4 s);
 * the simulator samples on physics steps, so its timestamps are only approximately 1/30 s apart.
 */
export function resample(ep, fps = FPS) {
  const T = ep.t, t0 = T[0], dur = T[T.length - 1] - t0;
  const n = Math.floor(dur * fps + 1e-6) + 1;
  const state = new Array(n), action = new Array(n), env = ep.env ? new Array(n) : null, fidx = new Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / fps;
    while (k < T.length - 2 && T[k + 1] <= t) k++;
    const k2 = Math.min(T.length - 1, k + 1), span = T[k2] - T[k];
    const f = span > 0 ? Math.max(0, Math.min(1, (t - T[k]) / span)) : 0;
    const lerp = (A) => A[k].map((a, j) => a + (A[k2][j] - a) * f);
    state[i] = lerp(ep.state); action[i] = lerp(ep.action);
    // environment state: the nearest recorded frame (a one-hot or a change of target must not be blended)
    if (env) env[i] = ep.env[f < 0.5 ? k : k2].slice();
    fidx[i] = ep.fidx ? ep.fidx[f < 0.5 ? k : k2] : (f < 0.5 ? k : k2);   // camera frame: the nearest recorded one too
  }
  return { task: ep.task, mission: ep.mission, n, state, action, env, item: ep.item || null, images: ep.images || null, fidx, demo: ep.demo };
}

const f32 = (x) => Math.fround(x);
function stats(rows) {                       // rows: number[][] (n × d) → LeRobot per-feature stats
  const n = rows.length, d = rows[0].length;
  const min = new Array(d).fill(Infinity), max = new Array(d).fill(-Infinity), sum = new Array(d).fill(0), sq = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) { const x = r[j]; if (x < min[j]) min[j] = x; if (x > max[j]) max[j] = x; sum[j] += x; }
  const mean = sum.map((s) => s / n);
  for (const r of rows) for (let j = 0; j < d; j++) sq[j] += (r[j] - mean[j]) ** 2;
  return { min, max, mean, std: sq.map((s) => Math.sqrt(s / n)), count: [n] };
}
function mergeStats(list) {                  // weighted merge of per-episode stats (same as LeRobot aggregate_stats)
  const tot = list.reduce((a, s) => a + s.count[0], 0), d = list[0].mean.length;
  const mean = new Array(d).fill(0), v = new Array(d).fill(0);
  for (const s of list) for (let j = 0; j < d; j++) mean[j] += s.mean[j] * s.count[0] / tot;
  for (const s of list) for (let j = 0; j < d; j++) v[j] += (s.std[j] ** 2 + (s.mean[j] - mean[j]) ** 2) * s.count[0] / tot;
  return {
    min: mean.map((_, j) => Math.min(...list.map((s) => s.min[j]))), max: mean.map((_, j) => Math.max(...list.map((s) => s.max[j]))),
    mean, std: v.map(Math.sqrt), count: [tot]
  };
}

/**
 * LeRobot feature spec of this dataset (meta/info.json "features"). env: add observation.environment_state
 * (LeRobot maps that exact key to FeatureType.ENV, lerobot/utils/feature_utils.py dataset_to_policy_features).
 */
export function features({ env = false, images = null } = {}) {
  const vec = { dtype: 'float32', shape: [6], names: NAMES.slice() };
  const one = (dtype) => ({ dtype, shape: [1], names: null });
  const img = images ? Object.fromEntries(images.names.map((c) => [IMAGE_PREFIX + c, { dtype: 'image', shape: [images.height, images.width, 3], names: ['height', 'width', 'channels'] }])) : {};
  return {
    action: { ...vec, names: NAMES.slice() }, 'observation.state': { ...vec, names: NAMES.slice() },
    ...(env ? { [ENV_KEY]: { dtype: 'float32', shape: [ENV_DIM], names: ENV_NAMES.slice() } } : {}), ...img,
    timestamp: one('float32'), frame_index: one('int64'), episode_index: one('int64'), index: one('int64'), task_index: one('int64')
  };
}
// Hugging Face `datasets` feature types, stored in the Parquet key-value metadata like LeRobot does
function hfFeatures(env, cams = []) {
  const seq = (length) => ({ feature: { dtype: 'float32', _type: 'Value' }, length, _type: 'Sequence' }), val = (dtype) => ({ dtype, _type: 'Value' });
  return { action: seq(6), 'observation.state': seq(6), ...(env ? { [ENV_KEY]: seq(ENV_DIM) } : {}),
    ...Object.fromEntries(cams.map((c) => [IMAGE_PREFIX + c, { _type: 'Image' }])),
    timestamp: val('float32'), frame_index: val('int64'), episode_index: val('int64'), index: val('int64'), task_index: val('int64') };
}
function parquetSchema(env, cams = []) {
  const list = (name) => [
    { name, repetition_type: 'OPTIONAL', converted_type: 'LIST', num_children: 1 },
    { name: 'list', repetition_type: 'REPEATED', num_children: 1 },
    { name: 'element', type: 'FLOAT', repetition_type: 'OPTIONAL' }
  ];
  const col = (name, type) => ({ name, type, repetition_type: 'OPTIONAL' });
  // an image column = HF datasets' Image struct { bytes: binary, path: string } (what pyarrow writes for it)
  const image = (name) => [{ name, repetition_type: 'OPTIONAL', num_children: 2 },
    { name: 'bytes', type: 'BYTE_ARRAY', repetition_type: 'OPTIONAL' }, { name: 'path', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' }];
  return [{ name: 'schema', num_children: (env ? 8 : 7) + cams.length }, ...list('action'), ...list('observation.state'), ...(env ? list(ENV_KEY) : []),
    ...cams.flatMap((c) => image(IMAGE_PREFIX + c)),
    col('timestamp', 'FLOAT'), col('frame_index', 'INT64'), col('episode_index', 'INT64'), col('index', 'INT64'), col('task_index', 'INT64')];
}

/** A parsed demo → its LeRobot episodes: one per item segment (perItem, when the demo has segments), else one. */
export function splitDemo(ep, { perItem = true, keepDiverged = false } = {}) {
  if (!perItem || !ep.segments || !ep.segments.length) return [ep];
  // SIL replay: an item that ended differently than in the recording is left out (keepDiverged keeps it, labelled
  // with the replay's outcome, which is what its images show)
  const diverged = new Set(ep.images && !keepDiverged ? ep.images.items.filter((x) => x && x.recorded !== x.replay).map((x) => x.item) : []);
  return ep.segments.filter((s) => !diverged.has(s.item)).map((s) => {
    const sl = (A) => A.slice(s.from, s.to + 1);
    return { task: ep.task, mission: ep.mission, t: sl(ep.t), state: sl(ep.state), action: sl(ep.action), env: ep.env ? sl(ep.env) : null,
      images: ep.images, fidx: sl(ep.fidx || ep.t.map((_, i) => i)), demo: ep.demo,
      item: { item: s.item, class: s.class, outcome: s.outcome, bin: s.bin } };
  });
}

/** Per-channel image stats (LeRobot's shape (3, 1, 1), values in 0–1) from per-frame sums
 *  [min r g b, max r g b, Σ r g b, Σ² r g b, pixels] (tools/sil/lib/replay.mjs imageSums). */
export function imageStats(rows) {
  const min = [255, 255, 255], max = [0, 0, 0], s = [0, 0, 0], q = [0, 0, 0];
  let px = 0;
  for (const r of rows) {
    for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], r[c]); max[c] = Math.max(max[c], r[3 + c]); s[c] += r[6 + c]; q[c] += r[9 + c]; }
    px += r[12];
  }
  const mean = s.map((v) => v / px), std = q.map((v, c) => Math.sqrt(Math.max(0, v / px - mean[c] * mean[c])));
  return { min: min.map((v) => v / 255), max: max.map((v) => v / 255), mean: mean.map((v) => v / 255), std: std.map((v) => v / 255), count: [rows.length] };
}
const nest3 = (st) => ({ min: st.min.map((v) => [[v]]), max: st.max.map((v) => [[v]]), mean: st.mean.map((v) => [[v]]), std: st.std.map((v) => [[v]]), count: st.count });

// Stats are written with the number types LeRobot's own (numpy) stats have: min / max in the feature's dtype, mean and
// std always floats, count an integer. JSON.stringify writes 0.0 as 0, and LeRobot's v2.1 → v3.0 converter builds one
// Arrow table from all episodes' stats: an int in one episode and a float in the next fails it ("arrays to be
// concatenated must be identically typed"; a one-hot std is 0 in one episode and 0.47 in another).
const FLOAT_MARK = '#float#';   // only numbers are marked, so no real string looks like this
function typedStats(st, feats) {
  const out = {};
  for (const [k, v] of Object.entries(st)) {
    const fl = (a) => a.map((x) => (Array.isArray(x) ? fl(x) : Number.isInteger(x) ? FLOAT_MARK + x : x));
    const isF = feats[k] && (feats[k].dtype === 'float32' || feats[k].dtype === 'image');
    out[k] = { min: isF ? fl(v.min) : v.min, max: isF ? fl(v.max) : v.max, mean: fl(v.mean), std: fl(v.std), count: v.count };
  }
  return out;
}
const typedJSON = (o, indent) => JSON.stringify(o, null, indent).replace(/"#float#(-?\d+)"/g, '$1.0');

let writerP = null;
async function parquetWriter() { return (writerP ||= import(WRITER_URL.href).then((m) => m.parquetWriteBuffer)); }

function datasetCard({ repoId, license, totalEpisodes, totalFrames, tasks, env, items, images = null }) {
  const out = {}; for (const it of items) if (it) out[it.outcome] = (out[it.outcome] || 0) + 1;
  const envLine = env ? `
- \`${ENV_KEY}\` (${ENV_DIM} float32, simulator ground truth, no camera): the target item (in the jaws, else the most
  downstream item on the belt) and the next item on the belt, each \`x, y, z\` (centre of mass, m, world frame),
  \`yaw_sin, yaw_cos\` and a class one-hot (${ENV_NAMES.slice(5, 9).map((n) => n.split('.')[1]).join(', ')}); an absent item is all zeros.
  A real \`so101_follower\` has no such sensor: a policy trained on it runs only in the simulator.` : '';
  const camLine = images ? `
- ${images.names.map((c) => '`' + IMAGE_PREFIX + c + '`').join(', ')} (${images.width}×${images.height} RGB, PNG): virtual cameras rendered by
  the SIL runner's software rasteriser while it replayed the recorded actions (tools/sil/replay.mjs). Flat-shaded
  geometry, items as collision hulls in one colour per material, no textures, shadows or noise: not photographs.
  \`observation.state\` and the item state are the replay's, so they match the images; \`action\` is the recording's.` : '';
  const itemLine = items.some(Boolean) ? `
- One episode per waste item, cut at the mission's events (approach → 0.5 s after the release, or the miss):
  ${Object.entries(out).map(([k, v]) => `${v} ${k}`).join(', ')}.` : '';
  return `---
license: ${license}
task_categories:
- robotics
tags:
- LeRobot
- so101
- simulation
- mujoco
- printedrobotics
source: simulation
configs:
- config_name: default
  data_files: data/*/*.parquet
---

# ${repoId || 'SO-101 simulator demonstrations'}

Teleoperated demonstrations of the **SO-101** robot arm recorded in the browser simulator at
[printedrobotics.cz/sim/so101](https://printedrobotics.cz/sim/so101/?lang=en)
(MuJoCo physics, robot model from MuJoCo Menagerie / The Robot Studio, Apache-2.0).

- **Source: simulation.** Not recorded on real hardware; ${images ? 'rendered camera images, joint positions' : 'no camera streams, joint positions only'}${env ? ' plus the simulator\'s item state' : ''}.
- Format: [LeRobot](https://github.com/huggingface/lerobot) dataset ${CODEBASE_VERSION}, robot_type \`${ROBOT_TYPE}\`, ${FPS} fps,
  ${totalEpisodes} episode(s), ${totalFrames} frames.
- \`observation.state\` and \`action\`: ${NAMES.map((n) => '`' + n + '`').join(', ')}.
  Joints in degrees (0 = the simulator's zero pose), gripper 0–100 % open.
  These follow LeRobot's SO-101 naming and degree mode, but the zero offsets of a calibrated real arm differ.
- Tasks: ${tasks.map((t) => '"' + t + '"').join(', ')}.${envLine}${camLine}${itemLine}
- Licence: ${license === 'cc-by-4.0' ? 'CC BY 4.0' : license}.

Made with the free SO-101 simulator by [printedrobotics.cz](https://printedrobotics.cz/?lang=en).
`;
}

/**
 * Build all files of a LeRobot v2.1 dataset from one or more demo JSON objects.
 * @param {object[]} demos  Teach.toJSON() objects (one episode each, or one per item segment), or SIL replays
 * @param {{ repoId?: string, license?: string, task?: string, perItem?: boolean, keepDiverged?: boolean, envState?: boolean,
 *   images?: false | ((demo: number, camera: string, frame: number) => Uint8Array | Promise<Uint8Array>) }} opts
 *   images: for SIL replays (printedrobotics.replay.cameras), the PNG bytes of frame `frame` of camera `camera` of
 *   demos[demo]; false = export without the images.
 * @returns {Promise<Record<string, string|Uint8Array>>}
 */
export async function buildDataset(demos, opts = {}) {
  // envState: false leaves observation.environment_state out (per-item episodes stay): a policy trained on cameras and
  // joints only can also run on a real arm, which has no such sensor
  const parse = (j, di) => { const ep = parseDemo(j, opts); ep.demo = di; if (opts.envState === false) ep.env = null; return ep; };
  const list = (Array.isArray(demos) ? demos : [demos]).flatMap((j, di) => splitDemo(parse(j, di), opts)).map((ep) => resample(ep));
  if (!list.length) throw new Error('no demonstrations');
  const env = !!list[0].env;
  if (list.some((ep) => !!ep.env !== env)) throw new Error('mixed demos: only some have environment state (conveyor missions); export them separately');
  const im = opts.images === false ? null : list[0].images, key = (x) => (x ? `${x.names.join(',')}@${x.width}x${x.height}` : '');
  if (opts.images !== false && list.some((ep) => key(ep.images) !== key(im))) throw new Error('mixed demos: different cameras or image sizes; export them separately');
  if (im && typeof opts.images !== 'function') throw new Error('the demos carry camera frames (SIL replay): pass opts.images (a PNG loader), or images: false');
  const cams = im ? im.names : [];
  const HF_FEATURES = hfFeatures(env, cams), PARQUET_SCHEMA = parquetSchema(env, cams);
  const license = opts.license || DEFAULT_LICENSE;
  const write = await parquetWriter();
  const tasks = [], taskIdx = new Map(), files = {}, episodes = [], epStats = [];
  let index = 0;
  for (const [e, ep] of list.entries()) {
    if (!taskIdx.has(ep.task)) { taskIdx.set(ep.task, tasks.length); tasks.push(ep.task); }
    const ti = taskIdx.get(ep.task), n = ep.n;
    const ts = Array.from({ length: n }, (_, i) => f32(i / FPS));
    const fi = Array.from({ length: n }, (_, i) => i), gi = fi.map((i) => index + i);
    const state = ep.state.map((r) => r.map(f32)), action = ep.action.map((r) => r.map(f32)), envs = env ? ep.env.map((r) => r.map(f32)) : null;
    const kv = [{ key: 'huggingface', value: JSON.stringify({ info: { features: HF_FEATURES } }) }];
    const imgCols = [];
    for (const c of cams) {
      const data = new Array(n);
      for (let i = 0; i < n; i++) data[i] = { bytes: await opts.images(ep.demo, c, ep.fidx[i]), path: null };
      imgCols.push({ name: IMAGE_PREFIX + c, data });
    }
    const buf = write({
      schema: PARQUET_SCHEMA, kvMetadata: kv,
      columnData: [
        { name: 'action', data: action }, { name: 'observation.state', data: state },
        ...(env ? [{ name: ENV_KEY, data: envs }] : []),
        ...imgCols,
        { name: 'timestamp', data: ts }, { name: 'frame_index', data: fi.map(BigInt) },
        { name: 'episode_index', data: fi.map(() => BigInt(e)) }, { name: 'index', data: gi.map(BigInt) },
        { name: 'task_index', data: fi.map(() => BigInt(ti)) }
      ]
    });
    const chunk = Math.floor(e / CHUNK);
    files[`data/chunk-${String(chunk).padStart(3, '0')}/episode_${String(e).padStart(6, '0')}.parquet`] = new Uint8Array(buf);
    episodes.push({ episode_index: e, tasks: [ep.task], length: n });
    const col = (v) => v.map((x) => [x]);
    epStats.push({
      episode_index: e,
      stats: {
        action: stats(action), 'observation.state': stats(state), ...(env ? { [ENV_KEY]: stats(envs) } : {}),
        ...Object.fromEntries(cams.map((c) => [IMAGE_PREFIX + c, imageStats(ep.fidx.map((i) => ep.images.sums[c][i]))])), timestamp: stats(col(ts)),
        frame_index: stats(col(fi)), episode_index: stats(col(fi.map(() => e))), index: stats(col(gi)), task_index: stats(col(fi.map(() => ti)))
      }
    });
    index += n;
  }
  const E = list.length;
  const info = {
    codebase_version: CODEBASE_VERSION, robot_type: ROBOT_TYPE,
    total_episodes: E, total_frames: index, total_tasks: tasks.length, total_videos: 0,
    total_chunks: Math.floor((E - 1) / CHUNK) + 1, chunks_size: CHUNK, fps: FPS, splits: { train: `0:${E}` },
    data_path: 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet', video_path: null,
    features: features({ env, images: im }),
    // not read by LeRobot; kept with the data so the provenance travels with copies of the dataset
    source: 'simulation', license
  };
  const agg = {};
  for (const k of Object.keys(epStats[0].stats)) agg[k] = mergeStats(epStats.map((s) => s.stats[k]));
  const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  files['meta/info.json'] = JSON.stringify(info, null, 4) + '\n';
  files['meta/tasks.jsonl'] = jsonl(tasks.map((task, task_index) => ({ task_index, task })));
  files['meta/episodes.jsonl'] = jsonl(episodes);
  const feats = features({ env, images: im });
  const nested = (st) => Object.fromEntries(Object.entries(st).map(([k, v]) => [k, k.startsWith(IMAGE_PREFIX) ? nest3(v) : v]));
  files['meta/episodes_stats.jsonl'] = epStats.map((r) => typedJSON({ episode_index: r.episode_index, stats: typedStats(nested(r.stats), feats) })).join('\n') + '\n';
  files['meta/stats.json'] = typedJSON(typedStats(nested(agg), feats), 4) + '\n';
  files['README.md'] = datasetCard({ repoId: opts.repoId, license, totalEpisodes: E, totalFrames: index, tasks, env, items: list.map((ep) => ep.item), images: im });
  return files;
}

/* ---------- store-only zip (deterministic: fixed 1980-01-01 timestamps) ---------- */
let CRC = null;
function crc32(u8) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/** Zip a {path: string|Uint8Array} map (no compression; Parquet is already compressed). */
export function zipFiles(files, prefix = '') {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const [p, v] of Object.entries(files)) {
    const name = enc.encode(prefix + p), data = typeof v === 'string' ? enc.encode(v) : v, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), name, data); central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22)), cnt = Object.keys(files).length;
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, cnt, true); end.setUint16(10, cnt, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let o = 0; for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}

/** Dataset as a zip: { bytes, name, files }. The zip holds one folder named after the dataset. */
export async function exportLeRobotZip(demos, opts = {}) {
  const files = await buildDataset(demos, opts);
  const first = Array.isArray(demos) ? demos[0] : demos;
  const m = first && first.printedrobotics && first.printedrobotics.mission;
  const base = (opts.repoId ? opts.repoId.split('/').pop() : 'so101-sim-' + (m || 'demo')).replace(/[^A-Za-z0-9._-]/g, '_');
  return { bytes: zipFiles(files, base + '/'), name: base + '-lerobot.zip', files };
}

/** Browser: build the zip and hand it to the visitor as a download. */
export async function downloadLeRobot(demos, opts = {}) {
  const { bytes, name } = await exportLeRobotZip(demos, opts);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return name;
}
