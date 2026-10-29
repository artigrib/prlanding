// Agent API (src/agent/sim-api.js) against MuJoCo in node: units, limits, workspace, speed cap, STOP,
// the person taking over, and mission 01 solved only through the tools (tests/agent-script.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScene } from './mj-node.mjs';
import { chainFromModel } from '../src/kin.js';
import { World } from '../src/world.js';
import { MISSIONS, MissionRunner } from '../src/missions.js';
import { createSimApi, AgentError, SPEED_CAP_DPS } from '../src/agent/sim-api.js';
import { solveBowl } from './agent-script.mjs';

const { mj, m, d } = await loadScene();
const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper']
  .map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
const world = new World(mj, m, d);
const runner = new MissionRunner(world);
const ts = m.opt.timestep;
let userBusy = false;
const reloads = [];
const tipSite = mj.mj_name2id(m, mj.mjtObj.mjOBJ_SITE.value, 'gripperframe');

function reset(id = runner.m.id) {
  mj.mj_resetDataKeyframe(m, d, 0);
  runner.select(id); runner.setup();
  if (runner.m.openStart) d.ctrl[act[5]] = 1.2;
  mj.mj_forward(m, d);
}
const api = createSimApi({
  mj, m, d, act, chain: chainFromModel(mj, m), world, runner, missions: MISSIONS,
  userBusy: () => userBusy, takeControl() {}, afterMotion() {},
  selectMission: (id) => reset(id), resetScene: () => reset(),
  heldObject() {
    if (d.ctrl[act[5]] > 0.4) return null;
    const t = d.site_xpos.subarray(3 * tipSite, 3 * tipSite + 3), p = world.pos('cube', [0, 0, 0]);
    return Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]) < 0.03 ? 'cube' : null;
  },
  snapshot: async () => ({ dataUrl: 'data:image/jpeg;base64,AAAA' }),
  reloadInto: (id) => { reloads.push(id); }
});

// like the page: one frame = tick + 4 physics steps + mission check
function frame() {
  const dt = 4 * ts;
  api.tick(dt);
  for (let k = 0; k < 4; k++) mj.mj_step(m, d);
  const t = d.site_xpos; runner.ctx.tip.set(t.subarray(3 * tipSite, 3 * tipSite + 3));
  runner.ctx.gripOpen = d.ctrl[act[5]] > 0.5;
  runner.tick(dt);
}
const METHODS = { run_trajectory: 'runTrajectory', get_state: 'getState', get_scene: 'getScene', move_joints: 'moveJoints', move_to: 'moveTo', set_gripper: 'setGripper', home: 'home', stop: 'stop', list_missions: 'listMissions', start_mission: 'startMission', check_mission: 'checkMission', reset_scene: 'resetScene' };
async function call(tool, args = {}, opts = {}) {
  let done = false, out, err;
  Promise.resolve().then(() => api[METHODS[tool]](args, opts)).then((r) => { out = r; done = true; }, (e) => { err = e; done = true; });
  for (let i = 0; i < 60 * 60 && !done; i++) { await null; if (!done) frame(); }
  if (err) throw err;
  assert.ok(done, tool + ' did not finish');
  return out;
}
async function wait(cond, maxSec) {
  for (let i = 0; i < maxSec * 60; i++) { if (cond(api.checkMission().mission)) return true; frame(); }
  return cond(api.checkMission().mission);
}
const code = async (p) => { try { await p; return null; } catch (e) { assert.ok(e instanceof AgentError, String(e)); return e; } };

test('state in API units; move_joints is smooth, speed-capped and reaches the goal', async () => {
  reset('bowl');
  const s = api.getState();
  assert.ok(Math.abs(s.joints_deg.shoulder_lift - -57.3) < 1, JSON.stringify(s.joints_deg));
  assert.equal(s.mission.id, 'bowl');
  assert.ok(s.tool.z_mm > 50 && s.tool.pitch_deg < 0);
  const r = await call('move_joints', { joints_deg: { shoulder_pan: 60 }, duration_s: 0.2 });
  assert.equal(r.status, 'completed');
  assert.ok(Math.abs(r.final.joints_deg.shoulder_pan - 60) < 1.5);
  assert.ok(r.time_stretched_by > 1, 'too-fast request is stretched to the speed cap');
  assert.ok(r.planned_duration_s >= (60 / SPEED_CAP_DPS) * 1.875 - 0.05);
});

test('limits and workspace are enforced in the page: nothing moves', async () => {
  reset('bowl');
  const before = api.getState().goal_deg;
  let e = await code(call('move_joints', { joints_deg: { shoulder_pan: 130 } }));
  assert.equal(e.code, 'OUT_OF_LIMITS'); assert.deepEqual(e.details, { joint: 'shoulder_pan', value_deg: 130, min_deg: -110, max_deg: 110 });
  e = await code(call('move_joints', { gripper_pct: 120 }));
  assert.equal(e.code, 'OUT_OF_LIMITS');
  e = await code(call('move_to', { pose: { x_mm: 200, y_mm: 0, z_mm: -20 } }));
  assert.equal(e.code, 'WORKSPACE_VIOLATION');
  e = await code(call('move_to', { pose: { x_mm: 520, y_mm: 0, z_mm: 20 } }));
  assert.equal(e.code, 'UNREACHABLE');
  // a joint move that would swing the jaw into the table
  e = await code(call('move_joints', { joints_deg: { shoulder_lift: 60, elbow_flex: 40, wrist_flex: 60 } }));
  assert.equal(e && e.code, 'WORKSPACE_VIOLATION');
  assert.deepEqual(api.getState().goal_deg, before);
});

test('move_to: IK reaches the point, explicit pitch is honoured or refused', async () => {
  reset('bowl');
  const r = await call('move_to', { pose: { x_mm: 200, y_mm: 50, z_mm: 80 } });
  assert.equal(r.status, 'completed');
  assert.ok(r.ik.position_error_mm < 5);
  const t = r.final.tool;
  assert.ok(Math.hypot(t.x_mm - 200, t.y_mm - 50, t.z_mm - 80) < 8, JSON.stringify(t));
  const p = await call('move_to', { pose: { x_mm: 220, y_mm: 0, z_mm: 120, pitch_deg: -45 } });
  assert.ok(Math.abs(p.ik.pitch_deg_used - -45) < 3, 'pitch ' + p.ik.pitch_deg_used);
  const e = await code(call('move_to', { pose: { x_mm: 400, y_mm: 0, z_mm: 20, pitch_deg: -90 } }));
  assert.equal(e.code, 'IK_NO_SOLUTION');
});

test('STOP in the page ends the motion and blocks motion until released; the person takes over', async () => {
  reset('bowl');
  const ac = new AbortController();
  let res = null;
  api.moveJoints({ joints_deg: { shoulder_pan: -90 }, duration_s: 4 }, { signal: ac.signal }).then((r) => { res = r; });
  for (let i = 0; i < 40; i++) frame();
  api.setEstop(true);
  await null; await null;
  assert.equal(res.status, 'stopped');
  assert.ok(res.final.goal_deg.shoulder_pan > -80);
  assert.equal((await code(call('home'))).code, 'ESTOP_ACTIVE');
  assert.equal(api.getState().safety, 'estop');
  api.setEstop(false);
  // the person grabs the controls
  res = null;
  api.moveJoints({ joints_deg: { shoulder_pan: 90 }, duration_s: 4 }, {}).then((r) => { res = r; });
  for (let i = 0; i < 20; i++) frame();
  userBusy = true; frame(); await null; await null;
  assert.equal(res.status, 'stopped');
  assert.equal((await code(call('home'))).code, 'BUSY');
  userBusy = false;
  assert.equal((await call('home')).status, 'completed');
});

test('missions: list, unknown id, reset', async () => {
  const l = api.listMissions().missions.map((x) => x.id);
  assert.deepEqual(l, ['bowl', 'stack', 'sort', 'ball', 'trace', 'line', 'breakfast', 'tidy', 'workshop', 'lab']);
  assert.deepEqual(api.listMissions().missions.filter((x) => x.needs_reload).map((x) => x.id), ['line', 'breakfast', 'tidy', 'workshop', 'lab']);
  assert.equal((await code(call('start_mission', { mission_id: 'nope' }))).code, 'UNKNOWN_MISSION');
  const lab = await call('start_mission', { mission_id: 'lab' });
  assert.ok(lab.reload_required && lab.reconnect_required); assert.deepEqual(reloads, ['lab']);
  const s = await call('start_mission', { mission_id: 'stack' });
  assert.equal(s.mission.id, 'stack'); assert.equal(s.mission.state, 'running');
  assert.equal(api.getScene().objects.filter((o) => o.kind === 'cube').length, 2);
  assert.ok((await call('reset_scene')).robot);
});

test('mission 01 is solved only through the agent tools', async () => {
  const lines = [];
  const won = await solveBowl(call, { wait, log: (s) => lines.push(s) });
  const st = api.checkMission().mission;
  assert.ok(won, `not won: ${JSON.stringify(st)} hud ${runner.last.text}\n${lines.join('\n')}`);
  console.log('  ' + lines.join('\n  ') + `\n  won after ${st.elapsed_s} s`);
});

test('object scene: missions 06-10 start in place (no reload) and their objects are reported', async () => {
  const { loadObjectScene } = await import('./mj-node.mjs');
  const S = await loadObjectScene();
  const w = new World(S.mj, S.m, S.d); w.sizes(S.sizes);
  const r = new MissionRunner(w);
  const act2 = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'].map((n) => S.mj.mj_name2id(S.m, S.mj.mjtObj.mjOBJ_ACTUATOR.value, n));
  const sel = (id) => { S.mj.mj_resetDataKeyframe(S.m, S.d, 0); r.select(id); r.setup(); S.mj.mj_forward(S.m, S.d); };
  const a2 = createSimApi({
    mj: S.mj, m: S.m, d: S.d, act: act2, chain: chainFromModel(S.mj, S.m), world: w, runner: r, missions: MISSIONS,
    userBusy: () => false, selectMission: sel, resetScene: () => sel(r.m.id), heldObject: () => null,
    reloadInto: () => { throw new Error('must not reload in the object scene'); }
  });
  assert.equal(a2.listMissions().missions.filter((x) => x.needs_reload).length, 0);
  for (const id of ['line', 'breakfast', 'tidy', 'workshop', 'lab', 'bowl']) {
    const s = a2.startMission({ mission_id: id });
    assert.equal(s.mission.id, id); assert.ok(!s.reload_required);
    const objs = a2.getScene().objects;
    assert.ok(objs.length >= 2, id + ': objects ' + objs.length);
    if (id !== 'bowl') assert.ok(objs.some((o) => o.kind === 'object'), id + ' has library objects');
  }
});

// ---------------- run_trajectory ----------------
const dance = () => [
  { joints_deg: { shoulder_pan: 30, wrist_roll: 40 }, gripper_pct: 80, duration_s: 0.6 },
  { joints_deg: { shoulder_pan: -30, wrist_roll: -40 }, gripper_pct: 20, duration_s: 0.6 },
  { joints_deg: { shoulder_pan: 30, elbow_flex: 20 }, duration_s: 0.6 },
  { pose: { x_mm: 220, y_mm: 0, z_mm: 120 }, gripper_pct: 60 },
  { joints_deg: { shoulder_pan: 0 }, duration_s: 0.5 }
];

test('run_trajectory: one smooth motion through every waypoint, under the speed cap, ending at the last one', async () => {
  reset('bowl');
  // watch the commanded joint speed every frame
  let vmax = 0, prev = null, wp1 = Infinity;
  const p = api.runTrajectory({ waypoints: dance() }, {});
  let done = null; p.then((r) => { done = r; });
  for (let i = 0; i < 60 * 30 && !done; i++) {
    await null; if (done) break;
    frame();
    const c = Array.from(act.slice(0, 5), (a) => d.ctrl[a]);
    if (prev) vmax = Math.max(vmax, ...c.map((v, k) => Math.abs(v - prev[k]) / (4 * ts) * 180 / Math.PI));
    prev = c;
    wp1 = Math.min(wp1, Math.abs(c[0] * 180 / Math.PI - -30));
  }
  assert.ok(done, 'trajectory finished');
  assert.equal(done.status, 'completed');
  assert.equal(done.waypoints, 5);
  assert.ok(vmax <= SPEED_CAP_DPS * 1.02, 'commanded speed ' + vmax.toFixed(1) + ' deg/s');
  assert.ok(wp1 < 1, 'passed through waypoint 2 (pan -30): ' + wp1.toFixed(2));
  assert.ok(Math.abs(done.final.joints_deg.shoulder_pan) < 1.5, JSON.stringify(done.final.joints_deg));
  assert.ok(done.time_stretched_by == null || done.time_stretched_by >= 1);
  assert.ok(done.planned_duration_s < 8, 'planned ' + done.planned_duration_s);
});

test('run_trajectory: the whole path is checked first; a bad waypoint is named and nothing moves', async () => {
  reset('bowl');
  const before = api.getState().goal_deg;
  let e = await code(call('run_trajectory', { waypoints: [{ joints_deg: { shoulder_pan: 20 } }, { joints_deg: { elbow_flex: 120 } }] }));
  assert.equal(e.code, 'OUT_OF_LIMITS'); assert.equal(e.details.waypoint, 1); assert.equal(e.details.joint, 'elbow_flex');
  e = await code(call('run_trajectory', { waypoints: [{ joints_deg: { shoulder_pan: 20 } }, { pose: { x_mm: 200, y_mm: 0, z_mm: -10 } }] }));
  assert.equal(e.code, 'WORKSPACE_VIOLATION'); assert.equal(e.details.waypoint, 1);
  e = await code(call('run_trajectory', { waypoints: [{ joints_deg: { shoulder_lift: 60, elbow_flex: 40, wrist_flex: 60 } }] }));
  assert.equal(e.code, 'WORKSPACE_VIOLATION'); assert.equal(e.details.waypoint, 0);
  e = await code(call('run_trajectory', { waypoints: Array(51).fill({ joints_deg: { shoulder_pan: 1 } }) }));
  assert.equal(e.code, 'INVALID_ARGUMENT');
  e = await code(call('run_trajectory', { waypoints: Array(8).fill(0).map((_, i) => ({ joints_deg: { shoulder_pan: i % 2 ? 60 : -60 }, duration_s: 9 })) }));
  assert.equal(e.code, 'INVALID_ARGUMENT'); assert.equal(e.details.reason, 'too_long');
  assert.deepEqual(api.getState().goal_deg, before);
});

test('run_trajectory: STOP mid-way and the person taking over end it like any motion', async () => {
  reset('bowl');
  let res = null;
  api.runTrajectory({ waypoints: dance() }, {}).then((r) => { res = r; });
  for (let i = 0; i < 50; i++) frame();
  api.setEstop(true); await null; await null;
  assert.equal(res.status, 'stopped');
  const held = api.getState().goal_deg;
  for (let i = 0; i < 30; i++) frame();
  assert.deepEqual(api.getState().goal_deg, held, 'commanded pose frozen after STOP');
  assert.equal((await code(call('run_trajectory', { waypoints: dance() }))).code, 'ESTOP_ACTIVE');
  api.setEstop(false);
  res = null;
  const ac = new AbortController();
  api.runTrajectory({ waypoints: dance() }, { signal: ac.signal }).then((r) => { res = r; });
  for (let i = 0; i < 30; i++) frame();
  ac.abort('preempted'); await null; await null;
  assert.equal(res.status, 'preempted');
  res = null;
  api.runTrajectory({ waypoints: dance() }, {}).then((r) => { res = r; });
  for (let i = 0; i < 30; i++) frame();
  userBusy = true; frame(); await null; await null; userBusy = false;
  assert.equal(res.status, 'stopped');
});

test('"Co říct AI": 8-12 prompts in 4 groups, every prompt and title has an English text', async () => {
  const { PROMPT_GROUPS, MISSION_PROMPT } = await import('../src/agent/prompts.js');
  const en = (await import('../src/i18n/en.js')).default.strings;
  const items = PROMPT_GROUPS.flatMap((g) => g.items);
  assert.equal(PROMPT_GROUPS.length, 4);
  assert.ok(items.length >= 8 && items.length <= 12, 'prompts: ' + items.length);
  for (const k of [...items, ...PROMPT_GROUPS.map((g) => g.title), MISSION_PROMPT]) assert.ok(en[k], 'no English for: ' + k);
  for (const m of MISSIONS) assert.ok(en[m.title], 'no English mission title: ' + m.title);
});
