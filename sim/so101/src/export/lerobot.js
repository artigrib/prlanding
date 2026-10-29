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
const WRITER_URL = new URL('../../vendor/hyparquet-writer/hyparquet-writer.min.js', import.meta.url);

/** English task instructions for the simulator missions (the demo JSON carries the Czech title). */
export const MISSION_TASKS = {
  bowl: 'Move the cube into the bowl',
  stack: 'Build a tower',
  sort: 'Sort the colours',
  ball: 'Push the ball into the goal',
  trace: 'Trace the star'
};

const isRow = (v) => Array.isArray(v) && v.length === 6 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/**
 * Validate a demo JSON and return its single episode as plain arrays.
 * @returns {{ task: string, mission: string|null, t: number[], state: number[][], action: number[][] }}
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
  const t = [], state = [], action = [];
  let prev = -Infinity;
  for (const f of ep.frames) {
    if (!f || typeof f !== 'object') throw new Error('bad frame');
    const ts = f.timestamp;
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < 0 || ts < prev) throw new Error('bad timestamp');
    if (!isRow(f['observation.state']) || !isRow(f.action)) throw new Error('bad frame row');
    t.push(prev = ts); state.push(f['observation.state'].slice()); action.push(f.action.slice());
  }
  const mission = (j.printedrobotics && typeof j.printedrobotics.mission === 'string') ? j.printedrobotics.mission : null;
  const name = task || MISSION_TASKS[mission] || (typeof ep.task === 'string' && ep.task.trim()) || 'SO-101 simulator demonstration';
  return { task: String(name).slice(0, 500), mission, t, state, action };
}

/**
 * Resample an episode onto an exact fps grid (t_k = k / fps, starting at the first frame), linear
 * interpolation per joint. LeRobot checks that timestamps match frame_index / fps (tolerance 1e-4 s);
 * the simulator samples on physics steps, so its timestamps are only approximately 1/30 s apart.
 */
export function resample(ep, fps = FPS) {
  const T = ep.t, t0 = T[0], dur = T[T.length - 1] - t0;
  const n = Math.floor(dur * fps + 1e-6) + 1;
  const state = new Array(n), action = new Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / fps;
    while (k < T.length - 2 && T[k + 1] <= t) k++;
    const k2 = Math.min(T.length - 1, k + 1), span = T[k2] - T[k];
    const f = span > 0 ? Math.max(0, Math.min(1, (t - T[k]) / span)) : 0;
    const lerp = (A) => A[k].map((a, j) => a + (A[k2][j] - a) * f);
    state[i] = lerp(ep.state); action[i] = lerp(ep.action);
  }
  return { task: ep.task, mission: ep.mission, n, state, action };
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

/** LeRobot feature spec of this dataset (meta/info.json "features"). */
export function features() {
  const vec = { dtype: 'float32', shape: [6], names: NAMES.slice() };
  const one = (dtype) => ({ dtype, shape: [1], names: null });
  return {
    action: { ...vec, names: NAMES.slice() }, 'observation.state': { ...vec, names: NAMES.slice() },
    timestamp: one('float32'), frame_index: one('int64'), episode_index: one('int64'), index: one('int64'), task_index: one('int64')
  };
}
// Hugging Face `datasets` feature types, stored in the Parquet key-value metadata like LeRobot does
const HF_FEATURES = (() => {
  const seq = { feature: { dtype: 'float32', _type: 'Value' }, length: 6, _type: 'Sequence' }, val = (dtype) => ({ dtype, _type: 'Value' });
  return { action: seq, 'observation.state': seq, timestamp: val('float32'), frame_index: val('int64'), episode_index: val('int64'), index: val('int64'), task_index: val('int64') };
})();
const PARQUET_SCHEMA = (() => {
  const list = (name) => [
    { name, repetition_type: 'OPTIONAL', converted_type: 'LIST', num_children: 1 },
    { name: 'list', repetition_type: 'REPEATED', num_children: 1 },
    { name: 'element', type: 'FLOAT', repetition_type: 'OPTIONAL' }
  ];
  const col = (name, type) => ({ name, type, repetition_type: 'OPTIONAL' });
  return [{ name: 'schema', num_children: 7 }, ...list('action'), ...list('observation.state'),
    col('timestamp', 'FLOAT'), col('frame_index', 'INT64'), col('episode_index', 'INT64'), col('index', 'INT64'), col('task_index', 'INT64')];
})();

let writerP = null;
async function parquetWriter() { return (writerP ||= import(WRITER_URL.href).then((m) => m.parquetWriteBuffer)); }

function datasetCard({ repoId, license, totalEpisodes, totalFrames, tasks }) {
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

- **Source: simulation.** Not recorded on real hardware; no camera streams, joint positions only.
- Format: [LeRobot](https://github.com/huggingface/lerobot) dataset ${CODEBASE_VERSION}, robot_type \`${ROBOT_TYPE}\`, ${FPS} fps,
  ${totalEpisodes} episode(s), ${totalFrames} frames.
- \`observation.state\` and \`action\`: ${NAMES.map((n) => '`' + n + '`').join(', ')}.
  Joints in degrees (0 = the simulator's zero pose), gripper 0–100 % open.
  These follow LeRobot's SO-101 naming and degree mode, but the zero offsets of a calibrated real arm differ.
- Tasks: ${tasks.map((t) => '"' + t + '"').join(', ')}.
- Licence: ${license === 'cc-by-4.0' ? 'CC BY 4.0' : license}.

Made with the free SO-101 simulator by [printedrobotics.cz](https://printedrobotics.cz/?lang=en).
`;
}

/**
 * Build all files of a LeRobot v2.1 dataset from one or more demo JSON objects.
 * @param {object[]} demos  Teach.toJSON() objects (one episode each)
 * @param {{ repoId?: string, license?: string, task?: string }} opts
 * @returns {Promise<Record<string, string|Uint8Array>>}
 */
export async function buildDataset(demos, opts = {}) {
  const list = (Array.isArray(demos) ? demos : [demos]).map((j) => resample(parseDemo(j, opts)));
  if (!list.length) throw new Error('no demonstrations');
  const license = opts.license || DEFAULT_LICENSE;
  const write = await parquetWriter();
  const tasks = [], taskIdx = new Map(), files = {}, episodes = [], epStats = [];
  let index = 0;
  for (const [e, ep] of list.entries()) {
    if (!taskIdx.has(ep.task)) { taskIdx.set(ep.task, tasks.length); tasks.push(ep.task); }
    const ti = taskIdx.get(ep.task), n = ep.n;
    const ts = Array.from({ length: n }, (_, i) => f32(i / FPS));
    const fi = Array.from({ length: n }, (_, i) => i), gi = fi.map((i) => index + i);
    const state = ep.state.map((r) => r.map(f32)), action = ep.action.map((r) => r.map(f32));
    const kv = [{ key: 'huggingface', value: JSON.stringify({ info: { features: HF_FEATURES } }) }];
    const buf = write({
      schema: PARQUET_SCHEMA, kvMetadata: kv,
      columnData: [
        { name: 'action', data: action }, { name: 'observation.state', data: state },
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
        action: stats(action), 'observation.state': stats(state), timestamp: stats(col(ts)),
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
    features: features(),
    // not read by LeRobot; kept with the data so the provenance travels with copies of the dataset
    source: 'simulation', license
  };
  const agg = {};
  for (const k of Object.keys(epStats[0].stats)) agg[k] = mergeStats(epStats.map((s) => s.stats[k]));
  const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  files['meta/info.json'] = JSON.stringify(info, null, 4) + '\n';
  files['meta/tasks.jsonl'] = jsonl(tasks.map((task, task_index) => ({ task_index, task })));
  files['meta/episodes.jsonl'] = jsonl(episodes);
  files['meta/episodes_stats.jsonl'] = jsonl(epStats);
  files['meta/stats.json'] = JSON.stringify(agg, null, 4) + '\n';
  files['README.md'] = datasetCard({ repoId: opts.repoId, license, totalEpisodes: E, totalFrames: index, tasks });
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
