// PR-Bench CONTROL tasks v0 and their seeded variants (bench/SPEC.md "Tasks").
//   public set: 10 SO-101 missions (01–05 plain scene, 06–10 object scene) + 2 behaviour tasks (wave, square)
//   seed 0 of the public set = the mission's own layout; seeds 1.. = small jitter (positions ±15 mm, yaw ±20°)
//   hidden set: the same tasks, larger jitter (±35 mm, any yaw) and new behaviour parameters, derived from a secret
//   that lives only on the VPS (env BENCH_HIDDEN_SECRET). It is never committed, logged or written to results.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { MISSIONS } from '../../sim/so101/src/missions.js';

const TOOLS = JSON.parse(fs.readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));

const M = (id, n, scene) => ({ id: `m${n}-${id}`, kind: 'mission', mission: id, scene, maxSimS: scene === 'objects' ? 300 : 180 });
export const TASKS = [
  M('bowl', '01', 'plain'), M('stack', '02', 'plain'), M('sort', '03', 'plain'), M('ball', '04', 'plain'), M('trace', '05', 'plain'),
  M('line', '06', 'objects'), M('breakfast', '07', 'objects'), M('tidy', '08', 'objects'), M('workshop', '09', 'objects'), M('lab', '10', 'objects'),
  { id: 'b01-wave', kind: 'behaviour', grader: 'wave', scene: 'plain', maxSimS: 120 },
  { id: 'b02-square', kind: 'behaviour', grader: 'square', scene: 'plain', maxSimS: 120 }
];
export const TASK_IDS = TASKS.map((t) => t.id);

/** Deterministic PRNG (mulberry32) from a string key. */
export function rng(key) {
  let a = crypto.createHash('sha256').update(key).digest().readUInt32LE(0);
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const U = (r, lo, hi) => lo + (hi - lo) * r();
const r1 = (x) => Math.round(x * 10) / 10;

/** Containers / fixtures (things you place into) vs things you move. */
const isFixture = (mis, name) => mis.targets && (mis.targets[name] === 'place' || name === 'goal');

/** Jitter a mission layout. Keeps everything reachable, on the table and apart; falls back to the original layout. */
export function jitterLayout(mis, r, { pos, yaw }) {
  const base = mis.layout || {};
  const names = Object.keys(base);
  if (!names.length || pos === 0) return structuredClone(base);
  for (let attempt = 0; attempt < 60; attempt++) {
    const scale = attempt < 40 ? 1 : 0.5;
    const out = {};
    for (const n of names) {
      const [x, y, a = 0] = base[n];
      const fx = isFixture(mis, n);
      const nx = x + U(r, -pos, pos) * scale, ny = y + U(r, -pos, pos) * scale;
      const na = fx ? a + U(r, -1, 1) * Math.min(yaw, 10) * Math.PI / 180 : a + U(r, -1, 1) * yaw * Math.PI / 180;
      out[n] = [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000, Math.round(na * 1000) / 1000];
    }
    let ok = true;
    for (const n of names) {
      const [x, y] = out[n], rr = Math.hypot(x, y);
      if (rr < 0.12 || rr > 0.345 || x < 0.1 || Math.abs(y) > 0.23) ok = false;
    }
    for (let i = 0; i < names.length && ok; i++) for (let j = i + 1; j < names.length && ok; j++) {
      const a = names[i], b = names[j], fa = isFixture(mis, a), fb = isFixture(mis, b);
      const dmin = fa && fb ? 0.13 : fa || fb ? 0.09 : 0.045;
      // keep the original clearance if the authored layout is tighter than our rule
      const d0 = Math.hypot(base[a][0] - base[b][0], base[a][1] - base[b][1]);
      if (Math.hypot(out[a][0] - out[b][0], out[a][1] - out[b][1]) < Math.min(dmin, d0 * 0.9)) ok = false;
    }
    if (ok) return out;
  }
  return structuredClone(base);
}

const JITTER = { public: { pos: 0.015, yaw: 20 }, hidden: { pos: 0.035, yaw: 180 } };

function behaviourParams(task, r, set, seed) {
  if (task.grader === 'wave') return { waves: set === 'public' ? 3 : 2 + Math.floor(r() * 3) };
  if (task.grader === 'square') {
    if (set === 'public' && seed === 0) return { cx_mm: 250, cy_mm: 0, z_mm: 100, side_mm: 100, yaw_deg: 0 };
    const J = set === 'public' ? 0.3 : 1;
    return { cx_mm: Math.round(250 + U(r, -40, 40) * J), cy_mm: Math.round(U(r, -80, 80) * J), z_mm: Math.round(100 + U(r, -40, 40) * J),
      side_mm: Math.round(100 + U(r, -30, 20) * J), yaw_deg: Math.round(U(r, -45, 45) * J) };
  }
  throw new Error('unknown grader ' + task.grader);
}

const RULES = 'You control a simulated SO-101 robot arm (6 joints incl. gripper) through tools. Units: degrees, percent open, millimetres, seconds. ' +
  'Base frame: x forward, y left, z up, origin at the robot base on the table top. Motion tools wait until the motion ends. ' +
  'The page refuses unsafe motions (joint limits, workspace box) and nothing moves; refused motions count against you. ' +
  'Work step by step with tool calls. When the task is done, call task_complete.';
export const SYSTEM_PROMPT = RULES;

function behaviourPrompt(task, p) {
  if (task.grader === 'wave') {
    return `Task: wave hello ${p.waves} times. Raise the arm so the jaw tip is at least 200 mm above the table, then swing the wrist (wrist_flex) out and back ${p.waves} times; ` +
      'one wave = one swing out and one swing back of at least 20 degrees each. Then call task_complete.';
  }
  return `Task: draw a square in the air with the jaw tip. The square lies in the horizontal plane z = ${p.z_mm} mm, its centre is at x = ${p.cx_mm} mm, y = ${p.cy_mm} mm, ` +
    `its side is ${p.side_mm} mm and its edges are rotated ${p.yaw_deg} degrees about the z axis from the x and y axes. ` +
    'Trace the whole outline once with straight edges, staying in that plane, then call task_complete.';
}

/**
 * One episode's concrete task. set: 'public' | 'hidden'. The hidden secret is read from env only, here, and only
 * a non-reversible tag of it goes into results.
 */
export function variant(taskId, seed, set = 'public', env = process.env) {
  const task = TASKS.find((t) => t.id === taskId);
  if (!task) throw new Error('unknown task ' + taskId);
  let key;
  if (set === 'hidden') {
    const secret = env.BENCH_HIDDEN_SECRET;
    if (!secret || secret.length < 16) throw new Error('hidden set needs BENCH_HIDDEN_SECRET (VPS only, >= 16 chars)');
    key = crypto.createHmac('sha256', secret).update(`${taskId}:${seed}`).digest('hex');
  } else key = `prbench-public-v0:${taskId}:${seed}`;
  const r = rng(key);
  const v = { task: taskId, kind: task.kind, scene: task.scene, seed, set, maxSimS: task.maxSimS };
  if (task.kind === 'mission') {
    const base = MISSIONS.find((x) => x.id === task.mission);
    const layout = set === 'public' && seed === 0 ? structuredClone(base.layout) : jitterLayout(base, r, JITTER[set]);
    v.mission = task.mission;
    v.layout = layout;
    v.prompt = `Task (mission ${base.n}, ${TOOLS.missions[task.mission].title_en}): ${TOOLS.missions[task.mission].goal_en} ` +
      'The mission is already running; check_mission reports its state. Use get_scene for object positions.';
  } else {
    v.grader = task.grader;
    v.params = behaviourParams(task, r, set, seed);
    v.prompt = behaviourPrompt(task, v.params);
  }
  // results carry only this tag for hidden runs (who ran which variant), never the parameters' source
  if (set === 'hidden') v.variant_tag = crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
  return v;
}

/** The mission object for an episode: MISSIONS entry with the variant layout (prototype keeps check/rate/...). */
export function missionFor(v) {
  const base = MISSIONS.find((x) => x.id === v.mission);
  return Object.assign(Object.create(base), { layout: v.layout });
}

export function resolveTasks(spec) {
  if (!spec || spec === 'public' || spec === 'hidden' || spec === 'all') return TASK_IDS.slice();
  const ids = spec.split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of ids) if (!TASK_IDS.includes(id)) throw new Error('unknown task ' + id + ' (known: ' + TASK_IDS.join(', ') + ')');
  return ids;
}
export { r1 };
