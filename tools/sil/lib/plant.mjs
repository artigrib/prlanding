// Headless MuJoCo plant for the SIL runner — the same plant interface the browser ArmSim gives the
// STS3215 emulator (sim/so101/core.js "plant interface"), without three.js. printedrobotics.cz.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SO101 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sim/so101');
export const JOINT_NAMES = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];

/** Load the vendored MuJoCo WASM build and the SO-101 scene (same files the browser sim uses). */
export async function loadScene(dir = SO101) {
  const loadMujoco = (await import(path.join(dir, 'vendor/mujoco/mujoco.js'))).default;
  const mj = await loadMujoco({ wasmBinary: fs.readFileSync(path.join(dir, 'vendor/mujoco/mujoco.wasm')) });
  mj.FS.mkdir('/m'); mj.FS.mkdir('/m/assets');
  for (const f of ['scene.xml', 'so101.xml']) mj.FS.writeFile('/m/' + f, fs.readFileSync(path.join(dir, 'model', f)));
  for (const f of fs.readdirSync(path.join(dir, 'model/assets'))) mj.FS.writeFile('/m/assets/' + f, fs.readFileSync(path.join(dir, 'model/assets', f)));
  const m = mj.MjModel.from_xml_path('/m/scene.xml');
  const d = new mj.MjData(m);
  mj.mj_resetDataKeyframe(m, d, 0);
  mj.mj_forward(m, d);
  return { mj, m, d };
}

export class MjPlant {
  constructor({ mj, m, d }) {
    this.mj = mj; this.m = m; this.d = d;
    const O = mj.mjtObj, id = (type, name) => mj.mj_name2id(m, O[type].value, name);
    this.act = JOINT_NAMES.map((n) => id('mjOBJ_ACTUATOR', n));
    this.qadr = JOINT_NAMES.map((n) => m.jnt_qposadr[id('mjOBJ_JOINT', n)]);
    const cr = m.actuator_ctrlrange, fr = m.actuator_forcerange;
    this.range = this.act.map((a) => [cr[2 * a], cr[2 * a + 1]]);
    this.force0 = this.act.map((a) => [fr[2 * a], fr[2 * a + 1]]);
    this.home = this.act.map((a) => m.key_ctrl[a]);
    this.driven = JOINT_NAMES.map(() => false);
    this.ts = m.opt.timestep; this.acc = 0;
    this.cubeBody = id('mjOBJ_BODY', 'cube');
  }
  setCtrl(i, v) { const [lo, hi] = this.range[i]; this.d.ctrl[this.act[i]] = Math.min(hi, Math.max(lo, v)); }
  // ---- plant interface (lib/sts3215-emu.js) ----
  q(i) { return this.d.qpos[this.qadr[i]]; }
  effort(i) { return this.d.actuator_force[this.act[i]] / this.force0[i][1]; }
  drive(i, q) { this.driven[i] = true; this.setCtrl(i, q); }
  release(i) { this.driven[i] = false; this.setCtrl(i, this.q(i)); }   // torque off: the 1:345 gearbox holds the joint
  hand(i, q) { if (!this.driven[i]) this.setCtrl(i, q); }               // a hand moving an unpowered joint
  setStrength(i, s) {
    const a = this.act[i], fr = this.m.actuator_forcerange;
    s = Math.max(0.05, Math.min(1, s));
    fr[2 * a] = this.force0[i][0] * s; fr[2 * a + 1] = this.force0[i][1] * s;
  }
  /** Advance physics by dt seconds in fixed MuJoCo steps. */
  step(dt) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= this.ts) { this.mj.mj_step(this.m, this.d); this.acc -= this.ts; }
  }
  qs() { return this.qadr.map((a) => this.d.qpos[a]); }
  cube() { const x = this.d.xpos, c = 3 * this.cubeBody; return [x[c], x[c + 1], x[c + 2]]; }
  /** Cube pose as MuJoCo free-joint qpos [x y z qw qx qy qz]. */
  cubePose() { const a = this.m.jnt_qposadr[this.m.body_jntadr[this.cubeBody]]; return Array.from(this.d.qpos.subarray(a, a + 7)); }
  /** Put the cube back to its start pose (from the keyframe) and stop it. */
  respawnCube() {
    const j = this.m.body_jntadr[this.cubeBody], a = this.m.jnt_qposadr[j], v = this.m.jnt_dofadr[j];
    for (let i = 0; i < 7; i++) this.d.qpos[a + i] = this.m.key_qpos[a + i];
    for (let i = 0; i < 6; i++) this.d.qvel[v + i] = 0;
    this.mj.mj_forward(this.m, this.d);
  }
}

/** Kinematic plant for the leader arm (no motors that matter: LeRobot keeps the leader's torque off). */
export class HandPlant {
  constructor(range, q) { this.range = range; this.qv = (q || range.map(([lo, hi]) => (lo + hi) / 2)).slice(); this.driven = range.map(() => false); }
  q(i) { return this.qv[i]; }
  effort(i) { return this.driven[i] ? 0.05 : 0; }
  drive(i, q) { this.driven[i] = true; this.qv[i] = this._clamp(i, q); }
  release(i) { this.driven[i] = false; }
  hand(i, q) { if (!this.driven[i]) this.qv[i] = this._clamp(i, q); }
  setStrength() {}
  step() {}
  qs() { return this.qv.slice(); }
  _clamp(i, q) { const [lo, hi] = this.range[i]; return Math.min(hi, Math.max(lo, q)); }
}
