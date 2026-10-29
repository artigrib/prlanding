// Mock SO-101 handler: kinematic arm (no physics) with smooth real-time motion, a crude
// planar IK, missions and a 2D-canvas snapshot. Used by tests and as a reference
// implementation of the handler interface (see README.md).

import { BridgeError } from './agent-bridge.js';
import schemas from './schemas.js';

const LIM = schemas.limits.joints_deg;
const JOINTS = Object.keys(LIM);
const HOME = { shoulder_pan: 0, shoulder_lift: -57.3, elbow_flex: 34.4, wrist_flex: 68.8, wrist_roll: 0 };
const HOME_GRIP = 24.7;
const L0 = 120, L1 = 116, L2 = 135, L3 = 161;     // mm: shoulder height, upper arm, forearm, wrist->tip (mock geometry)
const V_DPS = 60;                                // joint speed cap for automatic durations
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
const smooth = (k) => k * k * (3 - 2 * k);

export function fk(q) {
  const t1 = rad(q.shoulder_lift), t2 = t1 + rad(q.elbow_flex), t3 = t2 + rad(q.wrist_flex);
  const r = L1 * Math.sin(t1) + L2 * Math.sin(t2) + L3 * Math.sin(t3);
  const z = L0 + L1 * Math.cos(t1) + L2 * Math.cos(t2) + L3 * Math.cos(t3);
  const p = rad(q.shoulder_pan);
  return { x_mm: r * Math.cos(p), y_mm: r * Math.sin(p), z_mm: z, pitch_deg: 90 - deg(t3), roll_deg: q.wrist_roll };
}

function ik(x, y, z, pitch) {
  const r = Math.hypot(x, y), pan = deg(Math.atan2(y, x));
  const t3 = rad(90 - pitch);
  const rw = r - L3 * Math.sin(t3), zw = z - L0 - L3 * Math.cos(t3);
  const d = Math.hypot(rw, zw);
  if (d > L1 + L2 || d < Math.abs(L1 - L2)) return null;
  const a2 = Math.acos(Math.max(-1, Math.min(1, (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2))));
  const t1 = Math.atan2(rw, zw) - Math.atan2(L2 * Math.sin(a2), L1 + L2 * Math.cos(a2));
  const q = { shoulder_pan: pan, shoulder_lift: deg(t1), elbow_flex: deg(a2), wrist_flex: deg(t3 - t1 - a2) };
  for (const j of Object.keys(q)) if (q[j] < LIM[j][0] || q[j] > LIM[j][1]) return null;
  return q;
}

export function createMockHandler(opts = {}) {
  const speed = opts.speed || 1;                 // >1 = faster than real time (tests)
  const missions = opts.missions || ['bowl'];
  const q = { ...HOME };
  let grip = HOME_GRIP, goal = { ...HOME }, goalGrip = HOME_GRIP;
  let moving = false, estop = false, t0 = Date.now();
  let mission = { id: null, state: 'idle', started: 0 };
  const simTime = () => ((Date.now() - t0) / 1000) * speed;

  const state = () => ({
    joints_deg: { ...q }, gripper_pct: grip, goal_deg: { ...goal }, goal_gripper_pct: goalGrip,
    tool: fk(q), moving, safety: estop ? 'estop' : 'ok', sim_time_s: simTime()
  });
  const meta = () => ({ backend: 'sim', mode: 'sim', safety: estop ? 'estop' : 'ok', sim_time_s: simTime() });

  function checkTarget(target) {
    for (const j of JOINTS) {
      const v = target[j];
      if (v < LIM[j][0] || v > LIM[j][1]) throw new BridgeError('OUT_OF_LIMITS', { joint: j, value_deg: v, min_deg: LIM[j][0], max_deg: LIM[j][1] });
    }
  }

  /** Smoothstep interpolation in real time; resolves with a MotionResult. */
  function run(target, targetGrip, duration_s, signal) {
    if (estop) throw new BridgeError('ESTOP_ACTIVE');
    checkTarget(target);
    if (targetGrip < 0 || targetGrip > 100) throw new BridgeError('OUT_OF_LIMITS', { joint: 'gripper', value_pct: targetGrip, min_pct: 0, max_pct: 100 });
    const from = { ...q }, fromGrip = grip;
    let maxD = Math.abs(targetGrip - fromGrip) * 0.6;
    for (const j of JOINTS) maxD = Math.max(maxD, Math.abs(target[j] - from[j]));
    const auto = Math.max(0.3, (maxD / V_DPS) * 1.875);
    const dur = duration_s != null ? Math.max(duration_s, auto) : auto;
    goal = { ...target }; goalGrip = targetGrip;
    const motion_id = 'm' + Math.random().toString(36).slice(2, 10);
    moving = true;
    const start = Date.now();
    return new Promise((resolve) => {
      const finish = (status) => {
        clearInterval(timer);
        moving = false;
        if (status !== 'completed') { goal = { ...q }; goalGrip = grip; }
        resolve({
          motion_id, status, planned_duration_s: dur, elapsed_s: ((Date.now() - start) / 1000) * speed,
          time_stretched_by: duration_s != null && dur > duration_s ? dur / duration_s : undefined,
          final: state(), meta: meta()
        });
      };
      const tick = () => {
        const k = Math.min(1, (((Date.now() - start) / 1000) * speed) / dur), e = smooth(k);
        for (const j of JOINTS) q[j] = from[j] + (target[j] - from[j]) * e;
        grip = fromGrip + (targetGrip - fromGrip) * e;
        if (k >= 1) finish('completed');
      };
      const timer = setInterval(tick, 10);
      signal.addEventListener('abort', () => finish(signal.reason === 'preempted' ? 'preempted' : 'stopped'), { once: true });
    });
  }

  return {
    info: () => ({ mode: 'sim', views: ['overview', 'top', 'side'], missions }),
    getState: () => ({ ...state(), mission: { id: mission.id, state: mission.state }, meta: meta() }),
    getScene: () => ({
      robot: state(),
      objects: [
        { id: 'cube', kind: 'cube', size_mm: [25, 25, 25], pose: { x_mm: 250, y_mm: -110, z_mm: 12.5, yaw_deg: 0 } },
        { id: 'bowl', kind: 'bowl', radius_mm: 60, pose: { x_mm: 200, y_mm: 150, z_mm: 0 } }
      ],
      mission: { id: mission.id, state: mission.state },
      safety: { state: estop ? 'estop' : 'ok', estop, mode: 'sim' },
      meta: meta()
    }),
    moveJoints(a, { signal }) {
      const target = { ...goal };
      for (const [j, v] of Object.entries(a.joints_deg || {})) target[j] = a.relative ? goal[j] + v : v;
      const g = a.gripper_pct == null ? goalGrip : a.relative ? goalGrip + a.gripper_pct : a.gripper_pct;
      return run(target, g, a.duration_s, signal);
    },
    async moveTo(a, { signal }) {
      const { x_mm, y_mm, z_mm } = a.pose;
      const pitches = a.pose.pitch_deg == null || a.pose.pitch_deg === 'auto' ? [-80, -70, -60, -50, -40, -30, -20, -10, 0] : [a.pose.pitch_deg];
      for (const p of pitches) {
        const s = ik(x_mm, y_mm, z_mm, p);
        if (!s) continue;
        const target = { ...goal, ...s, wrist_roll: a.pose.roll_deg ?? goal.wrist_roll };
        const res = await run(target, a.gripper_pct ?? goalGrip, a.duration_s, signal);
        const t = fk(q);
        return { ...res, ik: { joints_deg: s, pitch_deg_used: p, position_error_mm: Math.hypot(t.x_mm - x_mm, t.y_mm - y_mm, t.z_mm - z_mm) } };
      }
      throw new BridgeError('UNREACHABLE', { x_mm, y_mm, z_mm, max_reach_mm: L1 + L2 + L3 });
    },
    setGripper(a, { signal }) {
      const g = a.gripper_pct === 'open' ? 70 : a.gripper_pct === 'close' ? 0 : a.gripper_pct;
      return run({ ...goal }, g, a.duration_s, signal);
    },
    home(a, { signal }) {
      const target = a.pose === 'zero' ? Object.fromEntries(JOINTS.map((j) => [j, 0])) : { ...HOME };
      return run(target, a.pose === 'zero' ? goalGrip : HOME_GRIP, a.duration_s, signal);
    },
    stop() { goal = { ...q }; goalGrip = grip; return { status: 'held', final: state(), meta: meta() }; },
    async snapshot(a) {
      const width = a.width || 512, height = Math.round(width * 0.75);
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
      const g = c.getContext('2d');
      g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, width, height);
      g.strokeStyle = '#ddd';
      for (let x = 0; x < width; x += width / 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, height); g.stroke(); }
      // side projection of the mock arm
      const s = width / 1000, ox = width * 0.3, oy = height * 0.9;
      const t1 = rad(q.shoulder_lift), t2 = t1 + rad(q.elbow_flex), t3 = t2 + rad(q.wrist_flex);
      const pts = [[0, 0], [0, L0]];
      pts.push([pts[1][0] + L1 * Math.sin(t1), pts[1][1] + L1 * Math.cos(t1)]);
      pts.push([pts[2][0] + L2 * Math.sin(t2), pts[2][1] + L2 * Math.cos(t2)]);
      pts.push([pts[3][0] + L3 * Math.sin(t3), pts[3][1] + L3 * Math.cos(t3)]);
      g.strokeStyle = '#e8461e'; g.lineWidth = 6 * s * 2;
      g.beginPath(); pts.forEach(([r, z], i) => (i ? g.lineTo : g.moveTo).call(g, ox + r * s, oy - z * s)); g.stroke();
      const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 }) : await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
      return { blob, view: a.view || 'overview', width, height, sim_time_s: simTime() };
    },
    listMissions: () => ({ missions: missions.map((id) => ({ id })), meta: meta() }),
    startMission(a) {
      if (!missions.includes(a.mission_id)) throw new BridgeError('UNKNOWN_MISSION', { mission_id: a.mission_id });
      mission = { id: a.mission_id, state: 'running', started: Date.now() };
      Object.assign(q, HOME); goal = { ...HOME }; grip = goalGrip = HOME_GRIP;
      return { mission: { id: mission.id, state: mission.state, elapsed_s: 0 }, meta: meta() };
    },
    checkMission: () => ({
      mission: { id: mission.id, state: mission.state, elapsed_s: mission.started ? ((Date.now() - mission.started) / 1000) * speed : 0 },
      meta: meta()
    }),
    resetScene() {
      Object.assign(q, HOME); goal = { ...HOME }; grip = goalGrip = HOME_GRIP;
      mission = { id: null, state: 'idle', started: 0 };
      return { robot: state(), meta: meta() };
    },
    onLinkLost() { goal = { ...q }; goalGrip = grip; },
    // test helpers (not part of the handler interface)
    _estop(on = true) { estop = on; },
    _win() { if (mission.id) mission.state = 'success'; },
    _q: q
  };
}
