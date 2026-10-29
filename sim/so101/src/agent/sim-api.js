// SO-101 agent API: the tool surface an AI (MCP client via the printedrobotics.cz relay) uses to drive the
// SIMULATED arm. DOM- and three.js-free, so node tests run it against MuJoCo directly (tests/agent-api.test.mjs).
//
// The tab is the only safety authority. Everything here is enforced in the page, whatever the relay sends:
//  * joint limits: a target outside the range is refused (OUT_OF_LIMITS, nothing moves, never clamped silently)
//  * speed cap: every motion is a min-jerk profile whose peak joint speed stays under SPEED_CAP_DPS
//  * workspace box: the jaw tip and the wrist stay inside WORKSPACE_MM along the whole sampled path
//  * one motion at a time; a STOP latched in the page (estop) blocks motion until the person releases it
//  * the person always wins: touching the sliders, the gizmo or a click-to-pick ends the AI motion at once
// API units (as in backend/bridge-client/README.md): degrees, percent open, millimetres, seconds.
// Internally MuJoCo radians / metres. Motions advance with simulated time (tick(dt) from the page frame hook).

import { Kin } from '../kin.js';

export const ARM = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'];
export const SPEED_CAP_DPS = 90;           // peak joint speed of any AI motion
export const GRIP_CAP_PPS = 160;           // gripper, percent per second
export const WORKSPACE_MM = { x: [-300, 600], y: [-450, 450], z: [-2, 500] };
export const BODY_FLOOR_MM = -2;           // no arm body origin below the table top
/** Missions the relay's catalogue knows (backend/bridge/src/schemas.ts MISSIONS). The object missions (06–10) run
 *  in the object scene: from the plain scene the page reloads into it, which ends the AI session (new code needed). */
export const AGENT_MISSIONS = ['bowl', 'stack', 'sort', 'ball', 'trace', 'line', 'breakfast', 'tidy', 'workshop', 'lab'];
const SAMPLES = 16;                         // workspace check: FK samples along the planned path
const DEG = 180 / Math.PI;
const r1 = (x) => Math.round(x * 10) / 10;
const smooth = (k) => k * k * k * (10 + k * (6 * k - 15));   // min-jerk
const COLORS = { cube: 'orange', cube_b: 'blue', bowl: 'blue', bowl2: 'orange', ball: 'white', goal: 'grey' };
const KINDS = { cube: 'cube', cube_b: 'cube', ball: 'ball', bowl: 'bowl', bowl2: 'bowl', goal: 'goal' };

export class AgentError extends Error {
  constructor(code, details) { super(code); this.code = code; this.details = details; }
}

/**
 * env: { mj, m, d, act (actuator ids, 6), chain (kin chain), world, runner, missions (MISSIONS),
 *        userBusy(): bool        the person is driving (drag, click-to-pick plan, replay): a new AI motion is BUSY
 *        tookOver(): bool        (optional) the person touched the controls during an AI motion: it stops
 *        onTick(): void          (optional) called on every motion tick (slider refresh)
 *        takeControl(): void     cancel the page's own controller before an AI motion
 *        afterMotion(): void     sync the page controller / sliders after an AI motion
 *        selectMission(id), resetScene(), heldObject(): name|null,
 *        hidden(): bool, renderOk(): bool, snapshot(args): Promise }
 */
export function createSimApi(env) {
  const { m, d, act, world, runner } = env;
  const kin = new Kin(env.chain);
  const qadr = act.map((a) => m.jnt_qposadr[m.actuator_trnid[2 * a]]);
  const dadr = act.map((a) => m.jnt_dofadr[m.actuator_trnid[2 * a]]);
  const range = act.map((a) => [m.actuator_ctrlrange[2 * a], m.actuator_ctrlrange[2 * a + 1]]);
  const home = Float64Array.from(act.map((a) => m.key_ctrl[a]));
  const [glo, ghi] = range[5];
  const limDeg = range.slice(0, 5).map(([lo, hi]) => [r1(lo * DEG), r1(hi * DEG)]);
  const pctOf = (rad) => ((rad - glo) / (ghi - glo)) * 100;
  const radOf = (pct) => glo + (pct / 100) * (ghi - glo);
  const listeners = {};
  const emit = (ev, a) => { for (const f of listeners[ev] || []) { try { f(a); } catch (e) { console.error(e); } } };
  let estop = false;
  let motion = null;     // { ... resolve }
  let seq = 0;
  const _q = new Float64Array(6), _a = new Float64Array(3);

  const ctrl = (i) => d.ctrl[act[i]];
  const qpos = (i) => d.qpos[qadr[i]];
  const vecMm = (p) => ({ x_mm: r1(p[0] * 1000), y_mm: r1(p[1] * 1000), z_mm: r1(p[2] * 1000) });
  const jointsDeg = (get) => Object.fromEntries(ARM.map((j, i) => [j, r1(get(i) * DEG)]));
  const maxVel = () => Math.max(...dadr.slice(0, 5).map((a) => Math.abs(d.qvel[a]))) * DEG;
  const safety = () => (estop ? 'estop' : 'ok');
  const meta = () => ({ backend: 'sim', mode: 'sim', safety: safety(), sim_time_s: r1(d.time) });
  const pitchDeg = () => r1(Math.asin(Math.max(-1, Math.min(1, kin.approach(_a)[2]))) * DEG);   // −90 = straight down

  function tool(get) {
    for (let i = 0; i < 6; i++) _q[i] = get(i);
    const p = kin.fk(_q);
    return { ...vecMm(p), pitch_deg: pitchDeg(), jaw_yaw_deg: jawYawDeg() };
  }
  /** Heading of the jaws' closing axis in the table plane (deg, world): align it with a cube face to grasp. */
  function jawYawDeg() {
    const gi = env.chain.site.body, M = kin.xmat;
    return r1(Math.atan2(M[9 * gi + 3], M[9 * gi]) * DEG);
  }
  function missionInfo() {
    const r = runner, id = r.m.id;
    const state = r.won ? 'success' : r.started ? 'running' : 'idle';
    const out = { id, state, elapsed_s: r1(r.time || 0) };
    if (r.won && r.result) out.stars = r.result.stars;
    if (r.last && r.last.ok != null) out.near_goal = !!r.last.ok;
    if (!AGENT_MISSIONS.includes(id)) out.agent_supported = false;
    return out;
  }
  function jointState() {
    return {
      joints_deg: jointsDeg(qpos), gripper_pct: r1(pctOf(qpos(5))),
      goal_deg: jointsDeg(ctrl), goal_gripper_pct: r1(pctOf(ctrl(5))),
      tool: tool(qpos), held_object: env.heldObject() || null,
      moving: !!motion || maxVel() > 3, safety: safety(), sim_time_s: r1(d.time)
    };
  }

  // ---------------- safety governor ----------------
  function checkLimits(target) {
    ARM.forEach((j, i) => {
      const v = target[i] * DEG, [lo, hi] = limDeg[i];
      if (!Number.isFinite(v)) throw new AgentError('INVALID_ARGUMENT', { joint: j });
      if (v < lo - 1e-6 || v > hi + 1e-6) throw new AgentError('OUT_OF_LIMITS', { joint: j, value_deg: r1(v), min_deg: lo, max_deg: hi });
    });
    const tp = pctOf(target[5]);
    if (!Number.isFinite(tp)) throw new AgentError('INVALID_ARGUMENT', { joint: 'gripper' });
    if (tp < -1e-6 || tp > 100 + 1e-6) throw new AgentError('OUT_OF_LIMITS', { joint: 'gripper', value_pct: r1(tp), min_pct: 0, max_pct: 100 });
  }
  /** FK samples along the joint-space min-jerk path: jaw tip inside the box, no arm body below the table. */
  function checkWorkspace(from, to) {
    const W = WORKSPACE_MM;
    for (let s = 1; s <= SAMPLES; s++) {
      const e = smooth(s / SAMPLES);
      for (let i = 0; i < 6; i++) _q[i] = from[i] + (to[i] - from[i]) * e;
      const p = kin.fk(_q), x = p[0] * 1000, y = p[1] * 1000, z = p[2] * 1000;
      const out = x < W.x[0] || x > W.x[1] || y < W.y[0] || y > W.y[1] || z < W.z[0] || z > W.z[1];
      let low = null;
      for (let b = 1; b < kin.nb && low == null; b++) if (kin.xpos[3 * b + 2] * 1000 < BODY_FLOOR_MM) low = b;
      if (out || low != null) {
        throw new AgentError('WORKSPACE_VIOLATION', {
          at_fraction: r1(s / SAMPLES), x_mm: r1(x), y_mm: r1(y), z_mm: r1(z), part: low != null ? 'arm' : 'tip',
          box_x_mm: W.x, box_y_mm: W.y, box_z_mm: W.z
        });
      }
    }
  }
  function autoDuration(from, to) {
    let maxD = 0;
    for (let i = 0; i < 5; i++) maxD = Math.max(maxD, Math.abs(to[i] - from[i]) * DEG / SPEED_CAP_DPS);
    maxD = Math.max(maxD, Math.abs(pctOf(to[5]) - pctOf(from[5])) / GRIP_CAP_PPS);
    return Math.max(0.4, maxD * 1.875);            // peak speed of min-jerk = 1.875 × mean
  }
  function preflight() {
    if (estop) throw new AgentError('ESTOP_ACTIVE');
    if (env.hidden && env.hidden()) throw new AgentError('TAB_HIDDEN');
    if (env.renderOk && !env.renderOk()) throw new AgentError('RENDER_UNAVAILABLE');
    if (env.userBusy && env.userBusy()) throw new AgentError('BUSY', { running: 'user' });
  }
  const currentGoal = () => Float64Array.from(act.map((_, i) => ctrl(i)));

  // ---------------- motion ----------------
  /** target: rad[6]. Resolves with a MotionResult when done, stopped (signal / STOP / person) or held. */
  function run(target, duration_s, signal, extra) {
    preflight();
    checkLimits(target);
    const from = currentGoal();
    checkWorkspace(from, target);
    if (motion) finish('preempted');
    env.takeControl && env.takeControl();
    const auto = autoDuration(from, target);
    const T = duration_s != null ? Math.max(duration_s, auto) : auto;
    runner.start();
    runner.assisted = true;          // the AI moved the arm: no stars / records for the visitor
    const id = 'm' + (++seq).toString(36) + Math.random().toString(36).slice(2, 7);
    return new Promise((resolve) => {
      motion = { id, from, to: Float64Array.from(target), T, t: 0, settle: 0, t0: d.time, duration_s, resolve, extra };
      emit('motion', { id, phase: 'start' });
      if (signal) {
        if (signal.aborted) return finish(signal.reason === 'preempted' ? 'preempted' : 'stopped', id);
        signal.addEventListener('abort', () => finish(signal.reason === 'preempted' ? 'preempted' : 'stopped', id), { once: true });
      }
    });
  }

  function finish(status, onlyId) {
    const mo = motion;
    if (!mo || (onlyId && mo.id !== onlyId)) return;
    motion = null;
    // stopped / preempted: the commanded pose freezes where the profile is now (no jump, the gripper keeps its grip)
    env.afterMotion && env.afterMotion();
    const final = jointState();
    const final_error_deg = Object.fromEntries(ARM.map((j, i) => [j, r1(Math.abs(final.joints_deg[j] - mo.to[i] * DEG))]));
    const res = {
      motion_id: mo.id, status, planned_duration_s: r1(mo.T), elapsed_s: r1(d.time - mo.t0),
      final, final_error_deg, meta: meta(), ...(mo.extra || {})
    };
    if (mo.duration_s != null && mo.T > mo.duration_s + 1e-6) res.time_stretched_by = r1(mo.T / mo.duration_s);
    emit('motion', { id: mo.id, phase: 'end', status });
    mo.resolve(res);
  }

  /** Called every frame / physics slice (simulated dt) from the page's frame hook. */
  function tick(dt) {
    const mo = motion;
    if (!mo) return;
    if (env.tookOver ? env.tookOver() : env.userBusy && env.userBusy()) return finish('stopped');      // the person took over
    if (env.onTick) env.onTick();
    mo.t += dt;
    const k = Math.min(1, mo.t / mo.T), e = smooth(k);
    for (let i = 0; i < 6; i++) d.ctrl[act[i]] = mo.from[i] + (mo.to[i] - mo.from[i]) * e;
    if (k < 1) return;
    mo.settle += dt;
    let err = 0;
    for (let i = 0; i < 5; i++) err = Math.max(err, Math.abs(qpos(i) - mo.to[i]) * DEG);
    if (err < 1 || mo.settle > 1) finish('completed');
  }

  // ---------------- IK ----------------
  function solveTo(pose, roll) {
    const p = [pose.x_mm / 1000, pose.y_mm / 1000, pose.z_mm / 1000];
    const W = WORKSPACE_MM;
    if (pose.z_mm < 0) throw new AgentError('WORKSPACE_VIOLATION', { x_mm: pose.x_mm, y_mm: pose.y_mm, z_mm: pose.z_mm, part: 'tip', reason: 'below_table', box_z_mm: W.z });
    if (pose.x_mm < W.x[0] || pose.x_mm > W.x[1] || Math.abs(pose.y_mm) > W.y[1] || pose.z_mm > W.z[1]) {
      throw new AgentError('WORKSPACE_VIOLATION', { x_mm: pose.x_mm, y_mm: pose.y_mm, z_mm: pose.z_mm, part: 'tip', box_x_mm: W.x, box_y_mm: W.y, box_z_mm: W.z });
    }
    const bp = env.chain.basePos, rh = Math.hypot(p[0] - bp[0], p[1] - bp[1]) * 1000;
    if (rh > 480 || pose.z_mm > 530) throw new AgentError('UNREACHABLE', { horizontal_mm: r1(rh), max_reach_mm: 479, max_z_mm: 526 });
    const q = currentGoal();
    q[4] = roll;
    const pitch = pose.pitch_deg == null || pose.pitch_deg === 'auto' ? null : -pose.pitch_deg / DEG;
    let r;
    if (pitch == null) r = kin.solveAuto(q, p, Math.PI / 2, { iters: 50, home });
    else {
      // explicit pitch: try it from the current pose and from home; never trade the pitch away silently
      const seed = Float64Array.from(q);
      r = kin.solve(q, p, pitch, { iters: 80 });
      if (!(r.reachable && r.pitchErr < 0.03)) { q.set(home); q[4] = roll; r = kin.solve(q, p, pitch, { iters: 80 }); }
      if (!(r.reachable && r.pitchErr < 0.03)) {
        const probe = Float64Array.from(seed), a = kin.solveAuto(probe, p, Math.PI / 2, { iters: 50, home });
        kin.fk(probe);
        throw new AgentError('IK_NO_SOLUTION', { best_error_mm: r1(r.err * 1000), requested_pitch_deg: pose.pitch_deg, feasible_pitch_deg: a.reachable ? pitchDeg() : null });
      }
    }
    if (!r.reachable) throw new AgentError('IK_NO_SOLUTION', { best_error_mm: r1(r.err * 1000) });
    kin.fk(q);
    return { q, ik: { joints_deg: Object.fromEntries(ARM.map((j, i) => [j, r1(q[i] * DEG)])), pitch_deg_used: pitchDeg(), position_error_mm: r1(r.err * 1000) } };
  }

  const missionList = () => env.missions.filter((x) => AGENT_MISSIONS.includes(x.id));
  const needsReload = (x) => !!x.objects && !world.lib;

  // ---------------- handler (backend/bridge-client/README.md) ----------------
  const api = {
    info: () => ({ mode: 'sim', views: ['overview', 'top', 'side', 'wrist'], missions: missionList().map((x) => x.id) }),
    getState: () => ({ ...jointState(), mission: missionInfo(), meta: meta() }),
    getScene(a = {}) {
      const inc = new Set(a.include && a.include.length ? a.include : ['robot', 'objects', 'mission', 'safety', 'limits']);
      const out = { meta: meta() };
      if (inc.has('robot')) out.robot = jointState();
      if (inc.has('objects')) {
        out.objects = world.active().map((e) => {
          const p = e.lib ? world.com(e.name, [0, 0, 0]) : world.pos(e.name, [0, 0, 0]);
          const o = { id: e.name, kind: e.lib ? 'object' : e.fixture ? 'fixture' : KINDS[e.name] || 'object', pose: vecMm(p) };
          if (COLORS[e.name]) o.color = COLORS[e.name];
          if (e.kind === 'free') o.yaw_deg = r1(world.yaw(e.name) * DEG);
          if (e.half) o.size_mm = r1(e.half * 2000);
          if (o.kind === 'bowl') { o.radius_mm = 60; o.drop_z_mm = 30; }
          return o;
        });
      }
      if (inc.has('mission')) out.mission = missionInfo();
      if (inc.has('safety')) out.safety = { state: safety(), estop, mode: 'sim', speed_cap_dps: SPEED_CAP_DPS, workspace_mm: WORKSPACE_MM };
      if (inc.has('limits')) out.limits = { joints_deg: Object.fromEntries(ARM.map((j, i) => [j, limDeg[i]])), gripper_pct: [0, 100], workspace_mm: WORKSPACE_MM };
      return out;
    },
    moveJoints(a, { signal } = {}) {
      const t = currentGoal();
      ARM.forEach((j, i) => { const v = a.joints_deg && a.joints_deg[j]; if (v != null) t[i] = a.relative ? t[i] + v / DEG : v / DEG; });
      if (a.gripper_pct != null) t[5] = radOf(a.relative ? pctOf(t[5]) + a.gripper_pct : a.gripper_pct);
      return run(t, a.duration_s, signal);
    },
    moveTo(a, { signal } = {}) {
      preflight();
      const goal = currentGoal();
      const roll = a.pose.roll_deg != null ? a.pose.roll_deg / DEG : goal[4];
      const { q, ik } = solveTo(a.pose, roll);
      q[5] = a.gripper_pct != null ? radOf(a.gripper_pct) : goal[5];
      return run(q, a.duration_s, signal, { ik });
    },
    setGripper(a, { signal } = {}) {
      const t = currentGoal();
      const pct = a.gripper_pct === 'open' ? 70 : a.gripper_pct === 'close' ? 0 : a.gripper_pct;
      t[5] = radOf(pct);
      return run(t, a.duration_s, signal);
    },
    home(a = {}, { signal } = {}) {
      const t = a.pose === 'zero' ? Float64Array.from([0, 0, 0, 0, 0, ctrl(5)]) : Float64Array.from(home);
      if (a.pose === 'zero') t[5] = ctrl(5);
      return run(t, a.duration_s, signal);
    },
    stop() { finish('stopped'); return { status: 'held', final: jointState(), meta: meta() }; },
    snapshot(a = {}) {
      if (!env.snapshot) throw new AgentError('RENDER_UNAVAILABLE');
      if (env.renderOk && !env.renderOk()) throw new AgentError('RENDER_UNAVAILABLE');
      return env.snapshot({ view: a.view || 'overview', width: a.width || 512 });
    },
    listMissions: () => ({
      missions: missionList().map((x) => ({ id: x.id, n: +x.n, current: x.id === runner.m.id, needs_reload: needsReload(x) })),
      meta: meta()
    }),
    startMission(a) {
      if (!missionList().some((x) => x.id === a.mission_id)) throw new AgentError('UNKNOWN_MISSION', { mission_id: String(a.mission_id).slice(0, 32) });
      preflight();
      if (motion) finish('preempted');
      const mi = missionList().find((x) => x.id === a.mission_id);
      if (needsReload(mi)) {
        // the object scene is a different compiled model: the page reloads into it and this AI session ends
        if (!env.reloadInto) throw new AgentError('NOT_SUPPORTED', { mission_id: mi.id, reason: 'reload_required' });
        env.reloadInto(mi.id);
        return { mission: { id: mi.id, state: 'idle', elapsed_s: 0 }, reload_required: true, reconnect_required: true, meta: meta() };
      }
      env.selectMission(a.mission_id);
      runner.start();
      return { mission: missionInfo(), robot: jointState(), meta: meta() };
    },
    checkMission: () => ({ mission: missionInfo(), meta: meta() }),
    resetScene() {
      preflight();
      if (motion) finish('preempted');
      env.resetScene();
      return { robot: jointState(), mission: missionInfo(), meta: meta() };
    },
    onLinkLost() { finish('held'); },

    // ---------------- page side (not reachable over the relay) ----------------
    tick,
    /** STOP latched by the person: ends the AI motion, blocks motion tools until released. */
    setEstop(on) {
      estop = !!on;
      if (estop) finish('stopped');
      emit('estop', estop);
    },
    get estop() { return estop; },
    /** The person moved a slider / pressed a key: the AI motion ends at once (status "stopped"). */
    userTakeover() { finish('stopped'); },
    get busy() { return !!motion; },
    on(ev, fn) { (listeners[ev] || (listeners[ev] = [])).push(fn); return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); }; },
    limits: { joints_deg: Object.fromEntries(ARM.map((j, i) => [j, limDeg[i]])), gripper_pct: [0, 100], workspace_mm: WORKSPACE_MM, speed_cap_dps: SPEED_CAP_DPS }
  };
  return api;
}
