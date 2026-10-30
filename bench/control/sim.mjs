// Headless SO-101 for PR-Bench: MuJoCo WASM in node + the page's own agent API (sim/so101/src/agent/sim-api.js),
// called in-process (no relay, no pairing). Same safety governor, units and error codes as the browser tab.
// One frame = what the page does every display frame: agent tick, 4 physics steps, mission check.
import { loadScene, loadObjectScene } from '../../sim/so101/tests/mj-node.mjs';
import { chainFromModel } from '../../sim/so101/src/kin.js';
import { World } from '../../sim/so101/src/world.js';
import { MISSIONS, MissionRunner } from '../../sim/so101/src/missions.js';
import { createSimApi, AgentError } from '../../sim/so101/src/agent/sim-api.js';
import { renderSchematic } from './snapshot.mjs';

export const FPS = 30;                    // replay / trajectory sampling rate (sim time), = sim/so101/src/ui/teach.js
const ARM6 = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
const METHODS = {
  get_state: 'getState', get_scene: 'getScene', move_joints: 'moveJoints', move_to: 'moveTo', run_trajectory: 'runTrajectory',
  set_gripper: 'setGripper', home: 'home', stop: 'stop', snapshot: 'snapshot', check_mission: 'checkMission', reset_scene: 'resetScene'
};
/** Errors that count as safety violations: the governor refused a motion that would break a limit. */
export const SAFETY_CODES = new Set(['OUT_OF_LIMITS', 'WORKSPACE_VIOLATION']);

const cache = {};
/** Compiled scene + its World, cached per process ('plain' = missions 01–05 + behaviour tasks, 'objects' = 06–10).
 *  The World must be shared too: parking a library object zeroes its contacts in the model (World.sleep) and only
 *  the World that did it remembers the original values. Episodes run one after another, never in parallel. */
export async function loadModel(scene) {
  if (!cache[scene]) {
    cache[scene] = (scene === 'objects' ? loadObjectScene() : loadScene()).then((S) => {
      const world = new World(S.mj, S.m, S.d);
      if (S.sizes) world.sizes(S.sizes);
      return { ...S, world };
    });
  }
  return cache[scene];
}

/** A mission runner bound to one mission object (the task's variant layout), not to the global MISSIONS index. */
class BenchRunner extends MissionRunner {
  constructor(world, mission) { super(world); this.mission = mission; }
  get m() { return this.mission; }
  select() {}
  start() { this.started = true; }      // no analytics from the bench
}

/** Pseudo-mission for behaviour tasks: empty table, no checker (graded from the trajectory afterwards). */
export const FREE_MISSION = { id: 'free', n: '00', title: 'free', layout: {}, check: () => ({ text: '' }), rate: () => 0 };

/**
 * @param {object} o
 * @param {'plain'|'objects'} o.scene
 * @param {object} o.mission   mission object (MISSIONS entry with the variant layout, or FREE_MISSION)
 * @param {number} o.maxSimS   sim-time budget of the episode (motions are stopped when it runs out)
 */
export async function createEpisode({ scene, mission, maxSimS = 240 }) {
  const S = await loadModel(scene);
  const { mj, m, d, world } = S;
  const runner = new BenchRunner(world, mission);
  const act = ARM6.map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
  const qadr = act.map((a) => m.jnt_qposadr[m.actuator_trnid[2 * a]]);
  const tipSite = mj.mj_name2id(m, mj.mjtObj.mjOBJ_SITE.value, 'gripperframe');
  const ts = m.opt.timestep, DT = 4 * ts;
  const tipBuf = new Float64Array(3);

  let simS = 0;                  // sim seconds this episode (survives reset_scene, unlike d.time)
  let won = false, wonAt = null, rescued = 0;
  const frames = [];             // { t, q[6], c[6], tip[3] } at FPS
  const resets = [];             // frame index of each reset_scene (replay segments)
  let nextRec = 0;

  function reset() {
    mj.mj_resetDataKeyframe(m, d, 0);
    runner.setup();
    if (runner.m.openStart) d.ctrl[act[5]] = 1.2;
    mj.mj_forward(m, d);
    runner.ctx.tip.set(d.site_xpos.subarray(3 * tipSite, 3 * tipSite + 3));
  }
  function heldObject() {           // = sim/so101/src/ux.js heldObject()
    const tip = runner.ctx.tip;
    if (d.ctrl[act[5]] >= 0.4) return null;
    for (const e of world.active()) {
      if (e.kind !== 'free' || e.name === 'ball') continue;
      if (e.lib) {
        const p = world.com(e.name, tipBuf);
        if (Math.hypot(p[0] - tip[0], p[1] - tip[1]) < 0.06 && p[2] > (e.restZ || 0) + 0.004 && Math.abs(p[2] - tip[2]) < 0.06) return e.name;
        continue;
      }
      const p = world.pos(e.name, tipBuf);
      if (Math.hypot(p[0] - tip[0], p[1] - tip[1], p[2] - tip[2]) < 0.03) return e.name;
    }
    return null;
  }
  const snapState = () => ({
    qpos: Array.from(d.qpos), qvel: Array.from(d.qvel), ctrl: Array.from(d.ctrl), act: d.act && d.act.length ? Array.from(d.act) : null,
    mpos: Array.from(d.mocap_pos), mquat: Array.from(d.mocap_quat), time: d.time
  });

  const api = createSimApi({
    mj, m, d, act, chain: chainFromModel(mj, m), world, runner, missions: MISSIONS,
    userBusy: () => false, takeControl() {}, afterMotion() {},
    selectMission: () => reset(),
    resetScene: () => { reset(); resets.push(frames.length); },
    heldObject,
    snapshot: async (a) => ({ dataUrl: renderSchematic({ mj, m, d, world, view: a.view, width: a.width }) })
  });

  function record() {
    while (simS >= nextRec - 1e-9) {
      frames.push({
        t: Math.round(simS * 1000) / 1000,
        q: qadr.map((a) => d.qpos[a]), c: act.map((a) => d.ctrl[a]),
        tip: Array.from(runner.ctx.tip, (v) => Math.round(v * 10000) / 10000)
      });
      nextRec += 1 / FPS;
    }
  }
  function frame() {
    api.tick(DT);
    for (let k = 0; k < 4; k++) mj.mj_step(m, d);
    simS += DT;
    if (world.rescue(runner.m.layout)) rescued++;
    runner.ctx.tip.set(d.site_xpos.subarray(3 * tipSite, 3 * tipSite + 3));
    runner.ctx.gripOpen = d.ctrl[act[5]] > 0.5;
    runner.tick(DT);
    if (runner.won && !won) { won = true; wonAt = simS; }
    record();
  }
  const outOfTime = () => simS >= maxSimS;

  /** One tool call. Returns { ok: true, result } or { ok: false, error: { code, details } }; never throws. */
  async function call(tool, args = {}) {
    const meth = METHODS[tool];
    if (!meth) return { ok: false, error: { code: 'NOT_SUPPORTED', details: { tool: String(tool).slice(0, 40) } } };
    if (outOfTime() && tool !== 'get_state' && tool !== 'get_scene' && tool !== 'check_mission') {
      return { ok: false, error: { code: 'TIMEOUT', details: { reason: 'episode_sim_time_budget', max_sim_s: maxSimS } } };
    }
    let done = false, out, err;
    Promise.resolve().then(() => api[meth](args, {})).then((r) => { out = r; done = true; }, (e) => { err = e; done = true; });
    await null; await null;
    while (!done) {
      if (outOfTime()) { api.stop(); await null; await null; break; }
      frame();
      await null;
    }
    if (err) {
      if (err instanceof AgentError) return { ok: false, error: { code: err.code, ...(err.details ? { details: err.details } : {}) } };
      return { ok: false, error: { code: 'INTERNAL' } };
    }
    if (!done) return { ok: false, error: { code: 'TIMEOUT', details: { reason: 'episode_sim_time_budget', max_sim_s: maxSimS } } };
    if (out && out.mission) delete out.mission.agent_supported;
    return { ok: true, result: out };
  }
  /** Let physics run with the arm holding (after the episode: a released object settles, "rest 0.5 s" checks finish). */
  function settle(s) { const n = Math.round(s / DT); for (let i = 0; i < n; i++) frame(); }

  reset();
  runner.start();
  const initial = snapState();
  record();
  return {
    api, call, settle, frame, world, runner, mj, m, d,
    get simS() { return simS; },
    get won() { return won; },
    get wonAt() { return wonAt; },
    get rescued() { return rescued; },
    progress: () => (runner.last && typeof runner.last.progress === 'number' ? runner.last.progress : null),
    lastCheck: () => runner.last,
    frames, resets, initial, act, gripRange: [m.actuator_ctrlrange[2 * act[5]], m.actuator_ctrlrange[2 * act[5] + 1]]
  };
}
