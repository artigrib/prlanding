// ROBOTO ORIGIN walking policy: observation layout, joint order and PD gains.
// printedrobotics.cz code (not part of the vendored upstream files). The numbers below are copied from the
// upstream deployment/sim2sim configuration, see ../NOTICE.txt:
//   modules/roboparty_deploy/src/inference/robots/rpo/configs/default.yaml (obs layout, stack, scales, clip_cmd)
//   modules/roboparty_deploy/src/inference/robots/rpo/robot.yaml (kp, kd)
//   modules/roboparty_train/robolab/scripts/mujoco/sim2sim_rpo.py (MuJoCo obs construction, PD, tau limit)
// Pure functions only (no DOM, no MuJoCo, no onnxruntime) so node tests can import them.

/** MJCF joint / actuator order (rpo.xml), which is also the motor order of robot.yaml. */
export const JOINTS = [
  'left_thigh_yaw_joint', 'left_thigh_roll_joint', 'left_thigh_pitch_joint', 'left_knee_joint', 'left_ankle_pitch_joint', 'left_ankle_roll_joint',
  'right_thigh_yaw_joint', 'right_thigh_roll_joint', 'right_thigh_pitch_joint', 'right_knee_joint', 'right_ankle_pitch_joint', 'right_ankle_roll_joint',
  'torso_joint',
  'left_arm_pitch_joint', 'left_arm_roll_joint', 'left_arm_yaw_joint', 'left_elbow_pitch_joint', 'left_elbow_yaw_joint',
  'right_arm_pitch_joint', 'right_arm_roll_joint', 'right_arm_yaw_joint', 'right_elbow_pitch_joint', 'right_elbow_yaw_joint'
];
export const N = 23;
export const KP = [100, 100, 100, 150, 40, 40, 100, 100, 100, 150, 40, 40, 150, 40, 40, 40, 30, 20, 40, 40, 40, 30, 20];
export const KD = [3.3, 3.3, 3.3, 5.0, 2.0, 2.0, 3.3, 3.3, 3.3, 5.0, 2.0, 2.0, 5.0, 2.0, 2.0, 2.0, 1.5, 1.0, 2.0, 2.0, 2.0, 1.5, 1.0];
export const DEFAULT_Q = [0, 0, -0.1, 0.3, -0.2, 0, 0, 0, -0.1, 0.3, -0.2, 0, 0, 0.18, 0.06, 0, 0.78, 0, 0.18, -0.06, 0, 0.78, 0];
export const TAU_LIMIT = 200;              // N·m, sim2sim tau_limit and MJCF ctrlrange
/** Policy (Isaac Lab / USD) joint i  <->  MJCF joint USD2URDF[i]. */
export const USD2URDF = [0, 6, 12, 1, 7, 13, 18, 2, 8, 14, 19, 3, 9, 15, 20, 4, 10, 16, 21, 5, 11, 17, 22];
export const ACTION_SCALE = 0.25;
export const FRAME = 78;                   // ang_vel 3, gravity_b 3, cmd_vel 3, dof_pos 23, dof_vel 23, last_action 23
export const STACK = 10;                   // frame_major, oldest first
export const POLICY_DT = 0.02;             // 50 Hz (deploy: dt 0.004 × decimation 5; sim2sim: 0.001 × 20)
export const CLIP_OBS = 100, CLIP_ACT = 100;
/** default.yaml clip_cmd: [vx_min, vx_max, vy_min, vy_max, yaw_min, yaw_max]. */
export const CMD_RANGE = { vx: [-0.4, 0.6], vy: [-0.4, 0.4], yaw: [-0.8, 0.8] };

const clip = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Rotate v by the inverse of the unit quaternion q = [w, x, y, z] (world -> body). */
export function quatRotateInverse(q, v) {
  const [w, x, y, z] = q;
  const a = 2 * w * w - 1, dot = 2 * (x * v[0] + y * v[1] + z * v[2]);
  const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
  return [v[0] * a - cx * 2 * w + x * dot, v[1] * a - cy * 2 * w + y * dot, v[2] * a - cz * 2 * w + z * dot];
}

/** Clamp a command {vx, vy, yaw} to the deployment's clip_cmd ranges. */
export function clampCmd(c) {
  return { vx: clip(+c.vx || 0, ...CMD_RANGE.vx), vy: clip(+c.vy || 0, ...CMD_RANGE.vy), yaw: clip(+c.yaw || 0, ...CMD_RANGE.yaw) };
}

/**
 * One observation frame (Float32Array(78)) exactly as sim2sim_rpo.py builds it.
 * s: { gyro[3] (body rad/s), quat[4] (w,x,y,z of the IMU site), q[23], dq[23] (MJCF order), act[23] (last raw action) }
 */
export function obsFrame(s, cmd) {
  const o = new Float32Array(FRAME);
  const g = quatRotateInverse(s.quat, [0, 0, -1]);
  o[0] = s.gyro[0]; o[1] = s.gyro[1]; o[2] = s.gyro[2];
  o[3] = g[0]; o[4] = g[1]; o[5] = g[2];
  o[6] = cmd.vx; o[7] = cmd.vy; o[8] = cmd.yaw;
  for (let i = 0; i < N; i++) {
    const j = USD2URDF[i];
    o[9 + i] = s.q[j] - DEFAULT_Q[j];
    o[32 + i] = s.dq[j];
    o[55 + i] = s.act[i];
  }
  for (let i = 0; i < FRAME; i++) o[i] = clip(o[i], -CLIP_OBS, CLIP_OBS);
  return o;
}

/** Frame history (frame_major, oldest first); the first frame fills the whole stack like sim2sim. */
export class ObsStack {
  constructor() { this.buf = new Float32Array(FRAME * STACK); this.empty = true; }
  reset() { this.empty = true; }
  push(frame) {
    if (this.empty) { for (let k = 0; k < STACK; k++) this.buf.set(frame, k * FRAME); this.empty = false; }
    else { this.buf.copyWithin(0, FRAME); this.buf.set(frame, (STACK - 1) * FRAME); }
    return this.buf;
  }
}

/** Raw policy action (policy order) -> PD position targets in MJCF order. */
export function actionToTargets(act, out = new Float64Array(N)) {
  for (let j = 0; j < N; j++) out[j] = DEFAULT_Q[j];
  for (let i = 0; i < N; i++) out[USD2URDF[i]] += clip(act[i], -CLIP_ACT, CLIP_ACT) * ACTION_SCALE;
  return out;
}

/** PD torque for joint j, clamped to the torque limit. */
export function pdTorque(j, target, q, dq) {
  return clip((target - q) * KP[j] - dq * KD[j], -TAU_LIMIT, TAU_LIMIT);
}
