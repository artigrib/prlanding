// Adapter: the SO-101 sim on `main` (sim/so101/app.js, `window.__sim` from ?test=1) -> AgentBridge handler.
//
//   import { createTestHookHandler } from '…/adapters/so101-testhook.js';
//   const handler = createTestHookHandler(window.__sim);
//   // headless tests: { advance: true } steps sim time from the motion loop (deterministic, like ?test=1 advance())
//
// Maps degrees/percent at the API boundary to the sim's radians (d.ctrl). Motions are smoothstep
// interpolations of the position targets, like the scripted demo. move_to needs IK, which `main`
// does not have yet (it lands with branch so101-ux), so it reports NOT_SUPPORTED here.
// When so101-ux exposes window.so101, write an equally thin adapter against that API instead.

import { BridgeError } from '../agent-bridge.js';

const ARM = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'];
const DEG = 180 / Math.PI;
const V_DPS = 60;
const r1 = (x) => Math.round(x * 10) / 10;
const smooth = (k) => k * k * (3 - 2 * k);

export function createTestHookHandler(sim, opts = {}) {
  const app = sim._app;
  const { m, d } = app;
  const qadr = app.act.map((a) => m.jnt_qposadr[m.actuator_trnid[2 * a]]);
  const dadr = app.act.map((a) => m.jnt_dofadr[m.actuator_trnid[2 * a]]);
  const [glo, ghi] = app.range[5];
  const limDeg = app.range.slice(0, 5).map(([lo, hi]) => [lo * DEG, hi * DEG]);
  const pctOf = (rad) => ((rad - glo) / (ghi - glo)) * 100;
  const radOf = (pct) => glo + (pct / 100) * (ghi - glo);
  let mission = { id: null, started: 0 };
  let motion = 0;
  const STEP_S = 0.02;
  const clock = opts.advance ? () => d.time * 1000 : () => performance.now();

  const ctrl = (i) => d.ctrl[app.act[i]];
  const qpos = (i) => d.qpos[qadr[i]];
  const jointsDeg = (get) => Object.fromEntries(ARM.map((j, i) => [j, r1(get(i) * DEG)]));
  const vec = (arr, i) => ({ x_mm: r1(arr[3 * i] * 1000), y_mm: r1(arr[3 * i + 1] * 1000), z_mm: r1(arr[3 * i + 2] * 1000) });
  const maxVel = () => Math.max(...dadr.map((a) => Math.abs(d.qvel[a]))) * DEG;
  const safety = () => (app.lost ? 'fault' : 'ok');
  const meta = () => ({ backend: 'sim', mode: 'sim', safety: safety(), sim_time_s: r1(d.time) });
  const missionState = () => (mission.id ? (app.won ? 'success' : 'running') : 'idle');

  const state = () => ({
    joints_deg: jointsDeg(qpos), gripper_pct: r1(pctOf(qpos(5))),
    goal_deg: jointsDeg(ctrl), goal_gripper_pct: r1(pctOf(ctrl(5))),
    tool: vec(d.site_xpos, app.gripSite),
    moving: motion > 0 || maxVel() > 2, safety: safety(), sim_time_s: r1(d.time)
  });

  function hold() { sim.setTargets(app.act.map((_, i) => qpos(i))); }

  /** target: rad[6]. Smoothstep in wall time; the sim's own loop steps physics. */
  function run(target, duration_s, signal) {
    // no TAB_HIDDEN: the sim keeps running in a background tab while an AI is linked (core.js background driver)
    if (app.lost) throw new BridgeError('RENDER_UNAVAILABLE');
    ARM.forEach((j, i) => {
      const v = target[i] * DEG, [lo, hi] = limDeg[i];
      if (v < lo - 1e-6 || v > hi + 1e-6) throw new BridgeError('OUT_OF_LIMITS', { joint: j, value_deg: r1(v), min_deg: r1(lo), max_deg: r1(hi) });
    });
    const tp = pctOf(target[5]);
    if (tp < -1e-6 || tp > 100 + 1e-6) throw new BridgeError('OUT_OF_LIMITS', { joint: 'gripper', value_pct: r1(tp), min_pct: 0, max_pct: 100 });
    const from = app.act.map((_, i) => ctrl(i));
    let maxD = Math.abs(tp - pctOf(from[5])) * 0.6;
    for (let i = 0; i < 5; i++) maxD = Math.max(maxD, Math.abs(target[i] - from[i]) * DEG);
    const auto = Math.max(0.3, (maxD / V_DPS) * 1.875);
    const dur = duration_s != null ? Math.max(duration_s, auto) : auto;
    const motion_id = 'm' + Math.random().toString(36).slice(2, 10);
    const t0 = clock();
    motion++;
    return new Promise((resolve) => {
      let timer = 0, settleUntil = 0;
      const finish = (status) => {
        clearInterval(timer);
        motion--;
        if (status !== 'completed') hold();
        const final = state();
        const final_error_deg = Object.fromEntries(ARM.map((j, i) => [j, r1(Math.abs(final.joints_deg[j] - target[i] * DEG))]));
        resolve({
          motion_id, status, planned_duration_s: r1(dur), elapsed_s: r1((clock() - t0) / 1000),
          time_stretched_by: duration_s != null && dur > duration_s ? r1(dur / duration_s) : undefined,
          final, final_error_deg, meta: meta()
        });
      };
      timer = setInterval(() => {
        const k = Math.min(1, (clock() - t0) / 1000 / dur), e = smooth(k);
        sim.setTargets(target.map((v, i) => from[i] + (v - from[i]) * e));
        if (opts.advance) sim.advance(STEP_S);
        if (k < 1) return;
        // wait until the position servos have converged (≤ 1°) or 1 s passed
        if (!settleUntil) settleUntil = clock() + 1000;
        const err = Math.max(...ARM.map((_, i) => Math.abs(qpos(i) - target[i]))) * DEG;
        if (err < 1 || clock() > settleUntil) finish('completed');
      }, 16);
      signal.addEventListener('abort', () => finish(signal.reason === 'preempted' ? 'preempted' : 'stopped'), { once: true });
    });
  }

  const currentGoal = () => app.act.map((_, i) => ctrl(i));

  // ---------- snapshot ----------
  const VIEWS = {
    overview: { pos: [0.45, 0.42, -0.55], at: [0.15, 0.08, -0.01] },
    top: { pos: [0.16, 0.85, 0.0001], at: [0.16, 0, 0], up: [1, 0, 0] },   // robot x (forward) points up in the image
    side: { pos: [0.18, 0.16, -0.78], at: [0.18, 0.12, 0] }
  };
  async function snapshot(a) {
    if (app.lost) throw new BridgeError('RENDER_UNAVAILABLE');
    const T = app.T, r = app.renderer, v = VIEWS[a.view || 'overview'];
    if (!v) throw new BridgeError('NOT_SUPPORTED', { view: a.view });
    const width = a.width || 512, height = Math.round(width * 0.75);
    const cam = new T.PerspectiveCamera(40, width / height, 0.01, 10);
    cam.position.set(...v.pos);
    if (v.up) cam.up.set(...v.up);
    cam.lookAt(new T.Vector3(...v.at));
    const size = r.getSize(new T.Vector2()), ratio = r.getPixelRatio();
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    try {
      r.setPixelRatio(1);
      r.setSize(width, height, false);
      r.render(app.scene, cam);
      const g = out.getContext('2d');
      g.fillStyle = '#e9e9e4'; // the WebGL canvas is transparent (CSS gradient behind it); JPEG has no alpha
      g.fillRect(0, 0, width, height);
      g.drawImage(r.domElement, 0, 0, width, height); // same task: drawing buffer still valid
    } finally {
      r.setPixelRatio(ratio);
      r.setSize(size.x, size.y, false);
      r.render(app.scene, app.camera);
    }
    const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.8));
    if (!blob) throw new BridgeError('RENDER_UNAVAILABLE');
    return { blob, view: a.view || 'overview', width, height, sim_time_s: r1(d.time) };
  }

  return {
    info: () => ({ mode: 'sim', views: Object.keys(VIEWS), missions: ['bowl'] }),
    getState: () => ({ ...state(), mission: { id: mission.id, state: missionState() }, meta: meta() }),
    getScene: () => ({
      robot: state(),
      objects: [
        { id: 'cube', kind: 'cube', size_mm: [25, 25, 25], pose: vec(d.xpos, app.cubeBody) },
        { id: 'bowl', kind: 'bowl', radius_mm: 60, pose: vec(d.xpos, app.bowlBody) }
      ],
      mission: { id: mission.id, state: missionState() },
      safety: { state: safety(), estop: false, mode: 'sim' },
      limits: { joints_deg: Object.fromEntries(ARM.map((j, i) => [j, limDeg[i].map(r1)])), gripper_pct: [0, 100] },
      meta: meta()
    }),
    moveJoints(a, { signal }) {
      const t = currentGoal();
      ARM.forEach((j, i) => { const v = a.joints_deg && a.joints_deg[j]; if (v != null) t[i] = a.relative ? t[i] + v / DEG : v / DEG; });
      if (a.gripper_pct != null) t[5] = a.relative ? radOf(pctOf(t[5]) + a.gripper_pct) : radOf(a.gripper_pct);
      return run(t, a.duration_s, signal);
    },
    moveTo() { throw new BridgeError('NOT_SUPPORTED', { tool: 'move_to' }); },
    setGripper(a, { signal }) {
      const t = currentGoal();
      t[5] = radOf(a.gripper_pct === 'open' ? 70 : a.gripper_pct === 'close' ? 0 : a.gripper_pct);
      return run(t, a.duration_s, signal);
    },
    home(a, { signal }) {
      const t = a.pose === 'zero' ? [0, 0, 0, 0, 0, ctrl(5)] : app.home.slice();
      return run(t, a.duration_s, signal);
    },
    stop() { hold(); return { status: 'held', final: state(), meta: meta() }; },
    snapshot,
    listMissions: () => ({ missions: [{ id: 'bowl' }], meta: meta() }),
    startMission(a) {
      if (a.mission_id !== 'bowl') throw new BridgeError('UNKNOWN_MISSION', { mission_id: a.mission_id });
      sim.reset();
      mission = { id: 'bowl', started: d.time };
      return { mission: { id: 'bowl', state: 'running', elapsed_s: 0 }, meta: meta() };
    },
    checkMission: () => ({ mission: { id: mission.id, state: missionState(), elapsed_s: mission.id ? r1(d.time - mission.started) : 0 }, meta: meta() }),
    resetScene() { sim.reset(); mission = { id: null, started: 0 }; return { robot: state(), meta: meta() }; },
    onLinkLost() { hold(); }
  };
}
