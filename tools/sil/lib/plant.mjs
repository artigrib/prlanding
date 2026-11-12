// Headless MuJoCo plant for the SIL runner — the same plant interface the browser ArmSim gives the
// STS3215 emulator (sim/so101/core.js "plant interface"), without three.js. printedrobotics.cz.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SO101 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sim/so101');
export const JOINT_NAMES = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];

/** Scene profiles the SIL runner can load (sim/so101/src/objects/scene.js PROFILES; 'plain' = model/scene.xml). */
export const SIL_SCENES = ['plain', 'objects', 'conveyor'];

/**
 * Load the vendored MuJoCo WASM build and the SO-101 scene (same files the browser sim uses).
 * opts.scene: 'plain' (default: model/scene.xml, one cube and a bowl) | 'objects' (missions 06–10) | 'conveyor'
 * (waste sorting: slat belt, end tote, 4 bins and the 11-item pool, parked), compiled exactly as the page does it
 * (src/objects/scene.js objectSceneXml), with the object library read from disk instead of fetched.
 * Returns { mj, m, d, scene, items, sizes, belt } (items / sizes: the profile's library items, empty for 'plain';
 * belt: the conveyor's src/objects/belt.js instance, else null).
 */
export async function loadScene(dir = SO101, { scene = 'plain' } = {}) {
  if (!SIL_SCENES.includes(scene)) throw new Error(`unknown scene "${scene}" (${SIL_SCENES.join(', ')})`);
  const loadMujoco = (await import(path.join(dir, 'vendor/mujoco/mujoco.js'))).default;
  const mj = await loadMujoco({ wasmBinary: fs.readFileSync(path.join(dir, 'vendor/mujoco/mujoco.wasm')) });
  mj.FS.mkdir('/m'); mj.FS.mkdir('/m/assets');
  for (const f of ['scene.xml', 'so101.xml']) mj.FS.writeFile('/m/' + f, fs.readFileSync(path.join(dir, 'model', f)));
  for (const f of fs.readdirSync(path.join(dir, 'model/assets'))) mj.FS.writeFile('/m/assets/' + f, fs.readFileSync(path.join(dir, 'model/assets', f)));
  let file = '/m/scene.xml', items = [], sizes = {};
  if (scene !== 'plain') {
    const { ObjectLibrary, injectObjects, instanceXml } = await import(path.join(dir, 'src/objects/library.js'));
    const { objectSceneXml, itemSize } = await import(path.join(dir, 'src/objects/scene.js'));
    const fsFetch = async (u) => {
      const b = fs.readFileSync(new URL(u));
      return { ok: true, status: 200, json: async () => JSON.parse(b), text: async () => b.toString('utf8'),
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    };
    const lib = new ObjectLibrary({ base: pathToFileURL(path.join(dir, 'objects') + '/'), fetch: fsFetch });
    const built = await objectSceneXml(fs.readFileSync(path.join(dir, 'model/scene.xml'), 'utf8'), lib, { injectObjects, instanceXml }, scene);
    file = `/m/scene_${scene}.xml`;
    mj.FS.writeFile(file, built.xml);
    items = built.items;
    sizes = Object.fromEntries(items.map((it) => [it.name, itemSize(it)]));
  }
  const m = mj.MjModel.from_xml_path(file);
  const d = new mj.MjData(m);
  mj.mj_resetDataKeyframe(m, d, 0);
  mj.mj_forward(m, d);
  const belt = scene === 'conveyor' ? (await import(path.join(dir, 'src/objects/belt.js'))).Belt.of(mj, m, d) : null;
  return { mj, m, d, scene, items, sizes, belt };
}

export const PARKED_Z = -0.5;   // parked items wait at z ≈ −0.745 (src/objects/scene.js parkSpot)

export class MjPlant {
  /** sc: a loadScene() result. */
  constructor({ mj, m, d, scene = 'plain', items = [], belt = null }) {
    this.mj = mj; this.m = m; this.d = d; this.scene = scene;
    this.belt = belt;                  // conveyor: slat velocities are set before every physics step, as in ArmSim
    this.items = items.map((it) => {   // library items of the profile: body + free-joint qpos address
      const b = mj.mj_name2id(m, mj.mjtObj.mjOBJ_BODY.value, it.name);
      return { name: it.name, body: b, q: m.jnt_qposadr[m.body_jntadr[b]] };
    });
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
    this.tipSite = id('mjOBJ_SITE', 'gripperframe');
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
    while (this.acc >= this.ts) { this.mjStep(); this.acc -= this.ts; }
  }
  /** One MuJoCo step (conveyor: the belt sets the slat velocities first, src/objects/belt.js). */
  mjStep() { if (this.belt) this.belt.step(this.ts); this.mj.mj_step(this.m, this.d); }
  qs() { return this.qadr.map((a) => this.d.qpos[a]); }
  cube() { const x = this.d.xpos, c = 3 * this.cubeBody; return [x[c], x[c + 1], x[c + 2]]; }
  /** Gripper frame (between the jaw tips) in world coordinates, metres. */
  tip() { const x = this.d.site_xpos, c = 3 * this.tipSite; return this.tipSite < 0 ? null : [x[c], x[c + 1], x[c + 2]]; }
  /** Cube pose as MuJoCo free-joint qpos [x y z qw qx qy qz]. */
  cubePose() { const a = this.m.jnt_qposadr[this.m.body_jntadr[this.cubeBody]]; return Array.from(this.d.qpos.subarray(a, a + 7)); }
  /** Free-joint qpos [x y z qw qx qy qz] of every library item of the profile (parked ones too, z ≈ −0.745). */
  itemPoses({ out = false } = {}) {
    const res = {}, q = this.d.qpos;
    for (const it of this.items) if (!out || q[it.q + 2] > PARKED_Z) res[it.name] = Array.from(q.subarray(it.q, it.q + 7));
    return res;
  }
  /**
   * One frame of the live mirror (sim/so101/src/mirror.js applyFrame reads it): the follower's joints and the cube;
   * in the object scenes also every library item's pose and the mocap poses (bins), and on the conveyor the slat
   * joint positions and the belt speed, so the page draws what the runner simulates. The page refuses a frame of
   * another scene (other bodies, other qpos addresses).
   */
  mirrorFrame(extra = {}) {
    const d = this.d, f = { t: d.time, scene: this.scene, follower: { q: this.qs() }, cube: this.cubePose(), ...extra };
    if (this.items.length) {
      f.items = this.itemPoses();
      f.mocap = { pos: Array.from(d.mocap_pos), quat: Array.from(d.mocap_quat) };
    }
    if (this.belt) f.belt = { v: this.belt.v, slats: this.belt.slats.map((s) => d.qpos[s.q]) };
    return f;
  }
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
