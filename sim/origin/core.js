// ROBOTO ORIGIN in-browser simulation core — printedrobotics.cz
// Our code (not part of the vendored upstream files): MuJoCo WASM physics, three.js rendering, the upstream
// walking policy run with onnxruntime-web, gantry hold, pushes. Upstream model, meshes and policy:
// vendor/roboto_origin/ (RoboParty, see NOTICE.txt for licences and changes).
// Engines are the site's vendored copies: ../so101/vendor/mujoco (MuJoCo 3.17.0) and ../../vendor/three (r186).

import * as P from './src/policy.js';

export const BASE = new URL('./', import.meta.url);
const V = 'vendor/roboto_origin/';
const ORT = 'vendor/onnxruntime-web/';
const MJ = '../so101/vendor/mujoco/';

export const GROUPS = [
  { id: 'lleg', joints: [0, 1, 2, 3, 4, 5] }, { id: 'rleg', joints: [6, 7, 8, 9, 10, 11] }, { id: 'torso', joints: [12] },
  { id: 'larm', joints: [13, 14, 15, 16, 17] }, { id: 'rarm', joints: [18, 19, 20, 21, 22] }
];

const STAND_Z = 0.75;           // base height of the upstream model in its default pose (rpo.xml body pos)
const GANTRY_Z = 0.80;          // held a little higher on the gantry so the feet can swing freely
const PUSH_N = 140, PUSH_S = 0.12;   // small shove: 140 N for 0.12 s ≈ 17 N·s on a 34 kg robot

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
    return true;
  } catch (e) { return false; }
}

async function fetchBytes(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !total) { const b = new Uint8Array(await r.arrayBuffer()); onProgress && onProgress(1, 1); return b; }
  const reader = r.body.getReader(); const parts = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    parts.push(value); got += value.length; onProgress && onProgress(got, total);
  }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Model files: our scene wrapper, the vendored rpo.xml and the meshes it names. */
async function loadModelFiles(onProgress) {
  const [scene, rpo] = await Promise.all([fetchBytes(new URL('scene.xml', BASE)), fetchBytes(new URL(V + 'mjcf/rpo.xml', BASE))]);
  const names = [...new TextDecoder().decode(rpo).matchAll(/file="([\w.-]+\.msh)"/g)].map((m) => m[1]);
  let done = 0;
  const meshes = await Promise.all(names.map(async (n) => {
    const b = await fetchBytes(new URL(V + 'meshes/' + n, BASE));
    onProgress(++done / names.length);
    return ['meshes/' + n, b];
  }));
  return [['mjcf/scene.xml', scene], ['mjcf/rpo.xml', rpo], ...meshes];
}

/** onnxruntime-web (wasm backend, single thread: no cross-origin isolation needed) + the upstream policy. */
async function loadPolicy(onProgress) {
  const [ort, bytes] = await Promise.all([
    import('./' + ORT + 'ort.wasm.min.mjs'),
    fetchBytes(new URL(V + 'policy/policy.onnx', BASE), (g, t) => onProgress(g / t))
  ]);
  ort.env.wasm.wasmPaths = new URL(ORT, BASE).href;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const inName = session.inputNames[0], outName = session.outputNames[0];
  const input = new Float32Array(P.FRAME * P.STACK);
  return {
    async run(obs) {
      input.set(obs);
      const res = await session.run({ [inName]: new ort.Tensor('float32', input, [1, input.length]) });
      return res[outName].data;
    },
    release() { try { session.release(); } catch (e) {} }
  };
}

/** Load MuJoCo + model + three.js + policy. onProgress(0..1). A policy that fails to load leaves policy null. */
export async function loadOrigin(onProgress = () => {}, opts = {}) {
  const prog = { wasm: 0, mesh: 0, pol: 0 };
  const paint = () => onProgress(Math.min(1, 0.03 + prog.wasm * 0.45 + prog.mesh * 0.22 + prog.pol * 0.3));
  const policyP = opts.noPolicy ? Promise.resolve(null)
    : loadPolicy((f) => { prog.pol = Math.min(1, f); paint(); }).catch((e) => { console.warn('policy disabled:', e); return { error: String(e && e.message || e) }; });
  const [THREE, OC, loadMujoco, wasmBinary, files] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import(MJ + 'mujoco.js').then((m) => m.default),
    fetchBytes(new URL(MJ + 'mujoco.wasm', BASE), (g, t) => { prog.wasm = Math.min(1, g / t); paint(); }),
    loadModelFiles((f) => { prog.mesh = f; paint(); })
  ]);
  const mj = await loadMujoco({ wasmBinary: wasmBinary.buffer, locateFile: (p) => new URL(MJ + p, BASE).href });
  for (const d of ['/o', '/o/mjcf', '/o/meshes']) mj.FS.mkdir(d);
  for (const [path, bytes] of files) mj.FS.writeFile('/o/' + path, bytes);
  const model = mj.MjModel.from_xml_path('/o/mjcf/scene.xml');
  const data = new mj.MjData(model);
  const pol = await policyP;
  onProgress(1);
  return { THREE, OrbitControls: OC.OrbitControls, mj, model, data, policy: pol && pol.run ? pol : null, policyError: pol && pol.error || null };
}

// Non-indexed geometry with creased normals (smooth within `crease` rad, hard across CAD edges).
function creasedGeometry(T, pos, idx, crease) {
  const nf = idx.length / 3, nv = pos.length / 3, cosT = Math.cos(crease);
  const fn = new Float32Array(nf * 3), deg = new Uint32Array(nv + 1);
  for (let f = 0; f < nf; f++) {
    const a = 3 * idx[3 * f], b = 3 * idx[3 * f + 1], c = 3 * idx[3 * f + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    fn[3 * f] = uy * vz - uz * vy; fn[3 * f + 1] = uz * vx - ux * vz; fn[3 * f + 2] = ux * vy - uy * vx;
    deg[idx[3 * f]]++; deg[idx[3 * f + 1]]++; deg[idx[3 * f + 2]]++;
  }
  const start = new Uint32Array(nv + 1);
  for (let v = 0; v < nv; v++) start[v + 1] = start[v] + deg[v];
  const fill = start.slice(0, nv), inc = new Uint32Array(start[nv]);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) { const v = idx[3 * f + k]; inc[fill[v]++] = f; }
  const unit = new Float32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const x = fn[3 * f], y = fn[3 * f + 1], z = fn[3 * f + 2], l = Math.hypot(x, y, z) || 1;
    unit[3 * f] = x / l; unit[3 * f + 1] = y / l; unit[3 * f + 2] = z / l;
  }
  const Pp = new Float32Array(nf * 9), Nn = new Float32Array(nf * 9);
  for (let f = 0; f < nf; f++) {
    const ux = unit[3 * f], uy = unit[3 * f + 1], uz = unit[3 * f + 2];
    for (let k = 0; k < 3; k++) {
      const v = idx[3 * f + k], o = 9 * f + 3 * k;
      Pp[o] = pos[3 * v]; Pp[o + 1] = pos[3 * v + 1]; Pp[o + 2] = pos[3 * v + 2];
      let nx = 0, ny = 0, nz = 0;
      for (let j = start[v]; j < start[v + 1]; j++) {
        const g = inc[j];
        if (unit[3 * g] * ux + unit[3 * g + 1] * uy + unit[3 * g + 2] * uz >= cosT) { nx += fn[3 * g]; ny += fn[3 * g + 1]; nz += fn[3 * g + 2]; }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      Nn[o] = nx / l; Nn[o + 1] = ny / l; Nn[o + 2] = nz / l;
    }
  }
  const bg = new T.BufferGeometry();
  bg.setAttribute('position', new T.BufferAttribute(Pp, 3));
  bg.setAttribute('normal', new T.BufferAttribute(Nn, 3));
  bg.computeBoundingSphere();
  return bg;
}

/**
 * The simulated humanoid. Modes: 'walk' (upstream policy at 50 Hz, PD at every physics step) and
 * 'stand' (held by a virtual gantry, PD to the slider targets). No page DOM besides the canvas.
 * opts: { canvas, onInteract(), onContextLost(), onContextRestored(), onPush(bodyName) }
 */
export class OriginSim {
  constructor({ THREE, OrbitControls, mj, model, data, policy }, opts) {
    this.T = THREE; this.mj = mj; this.m = model; this.d = data; this.policy = policy; this.opts = opts;
    this.mode = policy ? 'walk' : 'stand';
    this.cmd = { vx: 0, vy: 0, yaw: 0 };
    this.target = Float64Array.from(P.DEFAULT_Q);   // PD targets (MJCF order)
    this.sliders = Float64Array.from(P.DEFAULT_Q);  // gantry pose chosen by the user
    this.act = new Float32Array(P.N);               // last raw policy action
    this.stack = new P.ObsStack();
    this.push = null; this.exploded = 0; this.explodeTo = 0;
    this.fallen = false; this.lowFor = 0; this.policyMs = 0; this.policyTicks = 0;
    this.fps = 0; this.frames = 0; this.fpsT = performance.now();
    this.onFrame = null; this.onAfter = null;
    this.ids();
    this.three(OrbitControls);
    this.build();
    this.reset();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  ids() {
    const { mj, m } = this, O = mj.mjtObj;
    const id = (t, n) => mj.mj_name2id(m, O[t].value, n);
    this.qadr = P.JOINTS.map((n) => m.jnt_qposadr[id('mjOBJ_JOINT', n)]);
    this.vadr = P.JOINTS.map((n) => m.jnt_dofadr[id('mjOBJ_JOINT', n)]);
    this.aid = P.JOINTS.map((n) => id('mjOBJ_ACTUATOR', n));
    if (this.aid.some((a) => a < 0) || this.qadr.some((a) => a == null)) throw new Error('model joints do not match the policy');
    this.range = P.JOINTS.map((n) => { const j = id('mjOBJ_JOINT', n); return [m.jnt_range[2 * j], m.jnt_range[2 * j + 1]]; });
    const sadr = (n) => m.sensor_adr[id('mjOBJ_SENSOR', n)];
    this.sQuat = sadr('orientation'); this.sGyro = sadr('angular-velocity');
    this.base = id('mjOBJ_BODY', 'base_link');
    this.dt = m.opt.timestep;
    this.sub = Math.max(1, Math.round(P.POLICY_DT / this.dt));   // physics steps per policy tick
    this.bodyName = (b) => mj.mj_id2name(m, O.mjOBJ_BODY.value, b);
  }

  three(OrbitControls) {
    const T = this.T, canvas = this.opts.canvas;
    const r = this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const phone = matchMedia('(max-width:860px)').matches;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2));
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFShadowMap;
    r.outputColorSpace = T.SRGBColorSpace;
    r.setClearColor(0x000000, 0);
    const s = this.scene = new T.Scene();
    this.world = new T.Group(); this.world.rotation.x = -Math.PI / 2; s.add(this.world);   // MuJoCo z-up -> three y-up
    s.add(new T.HemisphereLight(0xffffff, 0xd8d8d2, 1.5));
    const sun = this.sun = new T.DirectionalLight(0xffffff, 2.4);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -1.2, right: 1.2, top: 1.2, bottom: -1.2, near: 0.1, far: 6 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.01;
    s.add(sun, sun.target);
    const fill = new T.DirectionalLight(0xffffff, 0.7); fill.position.set(-2, 1.5, -1.5); s.add(fill);
    const cam = this.camera = new T.PerspectiveCamera(38, 1, 0.05, 60);
    this.controls = new OrbitControls(cam, canvas);
    Object.assign(this.controls, { enableDamping: true, minDistance: 0.8, maxDistance: 7, maxPolarAngle: Math.PI * 0.495, enablePan: false });
    this.controls.addEventListener('start', () => this.opts.onInteract && this.opts.onInteract());
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.opts.onContextLost && this.opts.onContextLost(); });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.opts.onContextRestored && this.opts.onContextRestored(); });
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.pointer(canvas);
  }

  resetView() {
    const narrow = matchMedia('(max-width:860px)').matches;
    const b = this.basePos();
    this.controls.target.set(b[0], 0.62, -b[1]);
    this.camera.position.set(b[0] + 2.1, narrow ? 1.35 : 1.15, -b[1] - 2.3);
    this.controls.update();
  }

  resize() {
    const el = this.renderer.domElement.parentElement, w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.fov = w / h < 1 ? 50 : 38;
    this.camera.updateProjectionMatrix();
  }

  build() {
    const { T, m } = this;
    const metal = new T.MeshStandardMaterial({ color: 0x2b2c2e, roughness: 0.42, metalness: 0.55 });   // BOM: black anodised CNC aluminium
    const light = new T.MeshStandardMaterial({ color: 0xd9dbdc, roughness: 0.5, metalness: 0.2 });     // feet / ankle parts (light grey in rpo.xml)
    const vert = m.mesh_vert, face = m.mesh_face, vadr = m.mesh_vertadr, vnum = m.mesh_vertnum, fadr = m.mesh_faceadr, fnum = m.mesh_facenum;
    const cache = new Map();
    this.geoms = []; this.pickable = [];
    for (let g = 0; g < m.ngeom; g++) {
      if (m.geom_type[g] !== 7) continue;   // meshes only; the ground plane is drawn below
      const id = m.geom_dataid[g];
      if (!cache.has(id)) {
        const pos = vert.subarray(3 * vadr[id], 3 * (vadr[id] + vnum[id]));
        const idx = face.subarray(3 * fadr[id], 3 * (fadr[id] + fnum[id]));
        cache.set(id, creasedGeometry(T, pos, idx, 0.55));
      }
      const b = m.geom_bodyid[g], name = this.bodyName(b) || '';
      const lightGrey = m.geom_rgba[4 * g] > 0.85;
      const mat = /torso/.test(name) || lightGrey ? light : metal;   // bare frame: the white shells (rpo_appearance) are not modelled
      const mesh = new T.Mesh(cache.get(id), mat);
      mesh.matrixAutoUpdate = false; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.body = b; mesh.userData.name = name;
      this.world.add(mesh); this.geoms.push([g, mesh, b]); this.pickable.push(mesh);
    }
    // floor: 0.5 m grid on a soft shadow catcher (physics plane is infinite)
    const grid = this.grid = new T.GridHelper(40, 80, 0xbdbdb7, 0xdcdcd7);
    grid.rotation.x = Math.PI / 2; grid.position.z = 0.0005;
    this.world.add(grid);
    const floor = new T.Mesh(new T.PlaneGeometry(40, 40), new T.ShadowMaterial({ opacity: 0.12 }));
    floor.receiveShadow = true; this.world.add(floor);
    // gantry drawn while the robot hangs on it (stand mode)
    const gm = new T.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.6, metalness: 0.3 });
    const gantry = this.gantry = new T.Group();
    const post = (x, y) => { const c = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 1.7, 12), gm); c.rotation.x = Math.PI / 2; c.position.set(x, y, 0.85); c.castShadow = true; gantry.add(c); };
    post(-0.35, 0.45); post(-0.35, -0.45);
    const top = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.9, 12), gm); top.position.set(-0.35, 0, 1.7); gantry.add(top);
    const arm = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, 0.33, 12), gm); arm.rotation.z = Math.PI / 2; arm.position.set(-0.19, 0, 1.7); gantry.add(arm);
    const rope = this.rope = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, 1, 8), new T.MeshStandardMaterial({ color: 0x0e0e0e }));
    rope.rotation.x = Math.PI / 2; gantry.add(rope);
    this.world.add(gantry);
    // push arrow
    this.arrow = new T.ArrowHelper(new T.Vector3(1, 0, 0), new T.Vector3(), 0.4, 0xe8461e, 0.12, 0.07);
    this.arrow.visible = false; this.world.add(this.arrow);
  }

  basePos() { const p = this.d.qpos; return [p[0], p[1], p[2]]; }

  // ---------- state ----------
  reset({ z = STAND_Z, mode } = {}) {
    const { mj, m, d } = this;
    if (mode) this.mode = mode;
    const stand = this.mode === 'stand';
    mj.mj_resetData(m, d);
    const q = d.qpos;
    q[0] = 0; q[1] = 0; q[2] = stand ? GANTRY_Z : z; q[3] = 1; q[4] = q[5] = q[6] = 0;
    for (let j = 0; j < P.N; j++) q[this.qadr[j]] = stand ? this.sliders[j] : P.DEFAULT_Q[j];
    this.hold = [q[0], q[1], GANTRY_Z];
    this.act.fill(0); this.stack.reset(); this.stepN = 0; this.acc = 0;
    this.target.set(this.mode === 'stand' ? this.sliders : P.DEFAULT_Q);
    this.push = null; this.fallen = false; this.lowFor = 0;
    for (let i = 0; i < d.xfrc_applied.length; i++) d.xfrc_applied[i] = 0;
    mj.mj_forward(m, d);
    this.sync();
    if (this.camera) this.resetView();
  }

  setMode(mode) {
    if (mode === this.mode || (mode === 'walk' && !this.policy)) return false;
    if (mode === 'stand') {
      // hang it where it stands, upright; sliders start from the current pose
      for (let j = 0; j < P.N; j++) this.sliders[j] = this.d.qpos[this.qadr[j]];
      this.mode = 'stand';
      this.hold = [this.d.qpos[0], this.d.qpos[1], GANTRY_Z];
      this.target.set(this.sliders);
      this.fallen = false; this.lowFor = 0;
    } else {
      // set it down on its feet in the default pose and hand over to the policy
      const x = this.d.qpos[0], y = this.d.qpos[1];
      this.mode = 'walk';
      this.reset({ z: STAND_Z, mode: 'walk' });
      this.d.qpos[0] = x; this.d.qpos[1] = y; this.mj.mj_forward(this.m, this.d);
    }
    return true;
  }

  setSlider(j, v) { const [lo, hi] = this.range[j]; this.sliders[j] = Math.min(hi, Math.max(lo, v)); if (this.mode === 'stand') this.target[j] = this.sliders[j]; }
  resetPose() { this.sliders.set(P.DEFAULT_Q); if (this.mode === 'stand') this.target.set(this.sliders); }
  q(j) { return this.d.qpos[this.qadr[j]]; }
  setCmd(c) { this.cmd = P.clampCmd(c); }
  drop() { this.reset({ z: 1.35, mode: this.policy ? 'walk' : 'stand' }); }

  /** Shove a body: world-frame horizontal direction [dx, dy]. */
  shove(body = this.base, dir = null) {
    if (!dir) { const a = Math.random() * Math.PI * 2; dir = [Math.cos(a), Math.sin(a)]; }
    const l = Math.hypot(dir[0], dir[1]) || 1;
    this.push = { body, f: [dir[0] / l * PUSH_N, dir[1] / l * PUSH_N, 0], until: this.d.time + PUSH_S };
    this.opts.onPush && this.opts.onPush(this.bodyName(body));
  }

  obsState() {
    const d = this.d, sd = d.sensordata;
    const q = new Float64Array(P.N), dq = new Float64Array(P.N);
    for (let j = 0; j < P.N; j++) { q[j] = d.qpos[this.qadr[j]]; dq[j] = d.qvel[this.vadr[j]]; }
    return { gyro: [sd[this.sGyro], sd[this.sGyro + 1], sd[this.sGyro + 2]],
      quat: [sd[this.sQuat], sd[this.sQuat + 1], sd[this.sQuat + 2], sd[this.sQuat + 3]], q, dq, act: this.act };
  }

  async policyTick() {
    const t0 = performance.now();
    const obs = this.stack.push(P.obsFrame(this.obsState(), this.cmd));
    const a = await this.policy.run(obs);
    for (let i = 0; i < P.N; i++) this.act[i] = a[i];
    P.actionToTargets(this.act, this.target);
    this.policyMs = this.policyMs * 0.9 + (performance.now() - t0) * 0.1; this.policyTicks++;
  }

  physicsStep() {
    const { m, d } = this, X = d.xfrc_applied;
    for (let j = 0; j < P.N; j++) d.ctrl[this.aid[j]] = P.pdTorque(j, this.target[j], d.qpos[this.qadr[j]], d.qvel[this.vadr[j]]);
    for (let i = 0; i < X.length; i++) X[i] = 0;
    if (this.mode === 'stand') {
      // virtual gantry: spring-damper on the base position, upright torque, yaw damping
      const o = 6 * this.base, xp = d.xipos, b3 = 3 * this.base, R = d.xmat, r9 = 9 * this.base, v = d.qvel;
      const k = 5000, c = 700, kr = 900, cr = 90;
      X[o] = k * (this.hold[0] - xp[b3]) - c * v[0];
      X[o + 1] = k * (this.hold[1] - xp[b3 + 1]) - c * v[1];
      X[o + 2] = k * (this.hold[2] - d.qpos[2]) - c * v[2] + m.body_subtreemass[this.base] * 9.81;
      const zx = R[r9 + 2], zy = R[r9 + 5], zz = R[r9 + 8];         // body z axis in world
      const wx = R[r9] * v[3] + R[r9 + 1] * v[4] + R[r9 + 2] * v[5];  // body angular velocity -> world
      const wy = R[r9 + 3] * v[3] + R[r9 + 4] * v[4] + R[r9 + 5] * v[5];
      const wz = R[r9 + 6] * v[3] + R[r9 + 7] * v[4] + R[r9 + 8] * v[5];
      X[o + 3] = kr * zy - cr * wx; X[o + 4] = -kr * zx - cr * wy; X[o + 5] = -cr * wz;
    }
    if (this.push) {
      if (d.time < this.push.until) { const o = 6 * this.push.body; X[o] += this.push.f[0]; X[o + 1] += this.push.f[1]; }
      else this.push = null;
    }
    this.mj.mj_step(m, d);
    this.stepN++;
  }

  /** Advance one policy period (sub physics steps); runs the policy first in walk mode. */
  async tick() {
    if (this.mode === 'walk' && this.policy && !this.fallen) await this.policyTick();
    else if (this.mode === 'walk') { /* fallen: hold the last targets, limp */ }
    for (let i = 0; i < this.sub; i++) this.physicsStep();
    const z = this.d.qpos[2];
    if (this.mode === 'walk') {
      this.lowFor = z < 0.45 ? this.lowFor + P.POLICY_DT : 0;
      if (this.lowFor > 0.6 && !this.fallen) { this.fallen = true; this.target.set(P.DEFAULT_Q); this.onFall && this.onFall(); }
    }
  }

  sync() {
    const xp = this.d.geom_xpos, xm = this.d.geom_xmat;
    const e = this.exploded, bx = this.d.xpos[3 * this.base], by = this.d.xpos[3 * this.base + 1], bz = this.d.xpos[3 * this.base + 2];
    for (const [g, mesh] of this.geoms) {
      const p = 3 * g, r = 9 * g, el = mesh.matrix.elements;
      let x = xp[p], y = xp[p + 1], z = xp[p + 2];
      if (e > 0) { x += (x - bx) * e * 0.9; y += (y - by) * e * 1.4; z += (z - bz) * e * 0.6; }
      el[0] = xm[r]; el[4] = xm[r + 1]; el[8] = xm[r + 2]; el[12] = x;
      el[1] = xm[r + 3]; el[5] = xm[r + 4]; el[9] = xm[r + 5]; el[13] = y;
      el[2] = xm[r + 6]; el[6] = xm[r + 7]; el[10] = xm[r + 8]; el[14] = z;
      el[3] = 0; el[7] = 0; el[11] = 0; el[15] = 1;
      mesh.matrixWorldNeedsUpdate = true;
    }
    const stand = this.mode === 'stand';
    this.gantry.visible = stand && e < 0.05;
    if (stand) {
      this.gantry.position.set(this.hold[0], this.hold[1], 0);
      const top = 1.7, zb = this.d.qpos[2] + 0.3;
      this.rope.scale.set(1, Math.max(0.01, top - zb), 1); this.rope.position.set(this.d.qpos[0] - this.hold[0], this.d.qpos[1] - this.hold[1], (top + zb) / 2);
    }
    if (this.push) {
      const o = 3 * this.push.body, f = this.push.f, T = this.T;
      this.arrow.visible = true;
      this.arrow.position.set(this.d.xipos[o] - f[0] / PUSH_N * 0.45, this.d.xipos[o + 1] - f[1] / PUSH_N * 0.45, this.d.xipos[o + 2]);
      this.arrow.setDirection(new T.Vector3(f[0], f[1], 0).normalize());
    } else this.arrow.visible = false;
  }

  follow(dt) {
    const b = this.basePos(), t = this.controls.target;
    const k = 1 - Math.exp(-dt * 3);
    const dx = (b[0] - t.x) * k, dz = (-b[1] - t.z) * k;
    t.x += dx; t.z += dz; this.camera.position.x += dx; this.camera.position.z += dz;
    this.sun.position.set(t.x + 1.6, 3.2, t.z + 1.2); this.sun.target.position.set(t.x, 0, t.z);
    this.grid.position.x = Math.round(b[0] / 0.5) * 0.5; this.grid.position.y = Math.round(b[1] / 0.5) * 0.5;
  }

  // ---------- click to push ----------
  pointer(canvas) {
    const T = this.T, ray = new T.Raycaster(), ndc = new T.Vector2();
    let down = null;
    canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY, performance.now()]; });
    canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]), quick = performance.now() - down[2] < 400;
      down = null;
      if (moved > 6 || !quick || this.exploded > 0.05) return;
      const rc = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects(this.pickable, false)[0];
      if (!hit) return;
      const dir = ray.ray.direction;                 // three (x, y, z) -> MuJoCo (x, -z)
      this.shove(hit.object.userData.body, [dir.x, -dir.z]);
    });
  }

  // ---------- loop ----------
  loop(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.lost) { this.last = now; return; }
    let dt = (now - this.last) / 1000; this.last = now;
    if (!(dt > 0)) dt = 0; if (dt > 0.1) dt = 0.1;
    this.frames++; if (now - this.fpsT > 1000) { this.fps = this.frames * 1000 / (now - this.fpsT); this.frames = 0; this.fpsT = now; this.quality(); }
    this.exploded += (this.explodeTo - this.exploded) * Math.min(1, dt * 6);
    if (Math.abs(this.explodeTo - this.exploded) < 1e-3) this.exploded = this.explodeTo;
    if (!this.paused && !this.busy) {
      this.onFrame && this.onFrame(dt);
      this.acc += dt;
      const n = Math.min(3, Math.floor(this.acc / P.POLICY_DT));
      if (n > 0) {
        this.acc -= n * P.POLICY_DT; if (this.acc > P.POLICY_DT) this.acc = 0;
        this.busy = true;
        (async () => { try { for (let i = 0; i < n; i++) await this.tick(); } catch (e) { console.error(e); this.policyFailed(e); } finally { this.busy = false; } })();
      }
    }
    this.sync();
    this.follow(dt);
    this.onAfter && this.onAfter(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Slow GPU (software GL, old phones): after a few seconds under 24 FPS drop shadows and render at 1x. */
  quality() {
    this.fpsN = (this.fpsN || 0) + 1;
    if (this.lowQ || this.fpsN < 3 || this.fps >= 24) return;
    this.lowQ = true;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setPixelRatio(1); this.resize();
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  policyFailed(e) {
    this.policy = null;
    if (this.mode === 'walk') this.setMode('stand');
    this.onPolicyError && this.onPolicyError(e);
  }

  /** Test hook: advance simulated time (policy periods) without waiting for frames. */
  async advance(sec) {
    const n = Math.round(sec / P.POLICY_DT);
    while (this.busy) await new Promise((r) => setTimeout(r, 1));
    this.busy = true;
    try { for (let i = 0; i < n; i++) { this.onFrame && this.onFrame(P.POLICY_DT); await this.tick(); } } finally { this.busy = false; }
    this.sync();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.raf);
    try { this.d.delete(); this.m.delete(); } catch (e) {}
    this.controls.dispose(); this.renderer.dispose();
  }
}
