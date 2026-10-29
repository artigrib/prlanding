// SO-101 in-browser simulation core — printedrobotics.cz
// Shared by the mission page (app.js) and the setup wizard (nastaveni/wizard.js).
// MuJoCo (official WASM bindings, vendored) for physics, three.js for rendering.
// Model: MuJoCo Menagerie robotstudio_so101 (Apache-2.0), see NOTICE.txt.

export const BASE = new URL('./', import.meta.url);

// Filament colours — same values as window.PR_COLORS in /assets/data.js
export const COLORS = [
  { id: 'white', name: 'Bílá', hex: '#F2F2EE' },
  { id: 'grey', name: 'Šedá', hex: '#9A9A94' },
  { id: 'black', name: 'Černá', hex: '#2A2A2A' },
  { id: 'orange', name: 'Oranžová', hex: '#E8461E' },
  { id: 'blue', name: 'Modrá', hex: '#1F3BFF' }
];

export const JOINTS = [
  { name: 'shoulder_pan', label: 'Otočení základny' },
  { name: 'shoulder_lift', label: 'Rameno' },
  { name: 'elbow_flex', label: 'Loket' },
  { name: 'wrist_flex', label: 'Zápěstí – náklon' },
  { name: 'wrist_roll', label: 'Zápěstí – rotace' },
  { name: 'gripper', label: 'Chapadlo', grip: true }
];

// Body that carries each joint's servo (for highlighting a faulty servo)
const SERVO_BODY = ['base', 'shoulder', 'upper_arm', 'lower_arm', 'wrist', 'gripper'];

const MESHES = [
  'base_motor_holder_so101_v1', 'base_so101_v2', 'motor_holder_so101_base_v1', 'motor_holder_so101_wrist_v1',
  'moving_jaw_so101_gripper_part0_v1', 'moving_jaw_so101_gripper_part1_v1', 'moving_jaw_so101_v1',
  'rotation_pitch_so101_v1', 'sts3215_03a_no_horn_v1', 'sts3215_03a_v1', 'under_arm_so101_v1', 'upper_arm_so101_v1',
  'waveshare_mounting_plate_so101_v2', 'wrist_roll_follower_so101_camera_mount',
  'wrist_roll_follower_so101_gripper_part0_v1', 'wrist_roll_follower_so101_v1', 'wrist_roll_pitch_so101_v2'
];

// Scripted solution (joint targets, rad) — used by "Ukázat řešení", the wizard test and tests.
export const DEMO = [
  { q: [0.476, 0.315, -0.382, 1.638, 0, 1.2], t: 1.4 },  // above the cube, gripper open
  { q: [0.476, 0.370, -0.030, 1.230, 0, 1.2], t: 1.0 },  // down
  { q: [0.476, 0.370, -0.030, 1.230, 0, -0.1], t: 0.7 }, // close
  { q: [0.476, 0.331, -0.483, 1.658, 0, -0.1], t: 1.0 }, // lift
  { q: [-0.754, 0.142, -0.216, 1.645, 0, -0.1], t: 1.8 },// above the bowl
  { q: [-0.754, 0.135, -0.058, 1.494, 0, 1.2], t: 0.9 }, // lower a bit and release
  { q: null, t: 1.4 }                                    // home
];

const BG_MS = 16;            // background tick period (ms), ~60 Hz like the rAF loop
const BG_SLICE = 1 / 60;    // background physics slice (s): onFrame / step / onAfter per slice, like one frame
const TICKER_SRC = 'let t=0;onmessage=(e)=>{clearInterval(t);t=setInterval(()=>postMessage(0),e.data)}';
const BOWL_R = 0.05;        // success radius (m) around bowl centre
const WIN_HOLD = 0.5;       // seconds the cube must rest in the bowl

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();  // free the probe context
    return true;
  } catch (e) { return false; }
}

async function fetchBytes(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !total) { const b = new Uint8Array(await r.arrayBuffer()); onProgress && onProgress(b.length, b.length); return b; }
  const reader = r.body.getReader(); const parts = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    parts.push(value); got += value.length; onProgress && onProgress(got, total);
  }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function loadModelFiles(onProgress) {
  const list = [['scene.xml', 'model/scene.xml'], ['so101.xml', 'model/so101.xml']]
    .concat(MESHES.map((n) => ['assets/' + n + '.msh', 'model/assets/' + n + '.msh']));
  let done = 0;
  return Promise.all(list.map(async ([dst, src]) => {
    const b = await fetchBytes(new URL(src, BASE));
    onProgress(++done / list.length);
    return [dst, b];
  }));
}

/** Load MuJoCo + model + three.js. onProgress(fraction 0..1). Returns the ingredients for ArmSim.
 *  opts.objects: compile the object-mission scene (src/objects/scene.js: library objects + fixtures, ~40 kB of
 *  MJCF); the plain scene (mission 01) never fetches anything of the object library. */
export async function loadSim(onProgress = () => {}, opts = {}) {
  // Progress: wasm ~ 70 %, meshes ~ 25 %, rest 5 %. Content-length may be the compressed size, so clamp.
  const prog = { wasm: 0, mesh: 0 };
  const paint = () => onProgress(Math.min(1, 0.05 + prog.wasm * 0.7 + prog.mesh * 0.25));
  const [THREE, OC, loadMujoco, wasmBinary, files] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('./vendor/mujoco/mujoco.js').then((m) => m.default),
    fetchBytes(new URL('vendor/mujoco/mujoco.wasm', BASE), (g, t) => { prog.wasm = Math.min(1, g / t); paint(); }),
    loadModelFiles((f) => { prog.mesh = f; paint(); })
  ]);
  const mj = await loadMujoco({ wasmBinary: wasmBinary.buffer, locateFile: (p) => new URL('vendor/mujoco/' + p, BASE).href });
  mj.FS.mkdir('/m'); mj.FS.mkdir('/m/assets');
  for (const [path, bytes] of files) mj.FS.writeFile('/m/' + path, bytes);
  let scene = '/m/scene.xml', objects = null;
  if (opts.objects) {
    const [L, S] = await Promise.all([import('./src/objects/library.js'), import('./src/objects/scene.js')]);
    const lib = new L.ObjectLibrary();
    const xml = new TextDecoder().decode(files.find(([p]) => p === 'scene.xml')[1]);
    const built = await S.objectSceneXml(xml, lib, L);
    mj.FS.writeFile('/m/scene_objects.xml', built.xml);
    scene = '/m/scene_objects.xml';
    objects = { lib, items: built.items, sizes: Object.fromEntries(built.items.map((it) => [it.name, S.itemSize(it)])) };
  }
  const model = mj.MjModel.from_xml_path(scene);
  const data = new mj.MjData(model);
  mj.mj_resetDataKeyframe(model, data, 0);
  mj.mj_forward(model, data);
  onProgress(1);
  return { THREE, OrbitControls: OC.OrbitControls, mj, model, data, objects };
}

// Non-indexed geometry with "creased" normals: smooth across faces that are within
// `crease` rad of each other (hides decimation facets), hard across real CAD edges.
function creasedGeometry(T, pos, idx, crease) {
  const nf = idx.length / 3, nv = pos.length / 3, cosT = Math.cos(crease);
  const fn = new Float32Array(nf * 3);
  const deg = new Uint32Array(nv + 1);
  for (let f = 0; f < nf; f++) {
    const a = 3 * idx[3 * f], b = 3 * idx[3 * f + 1], c = 3 * idx[3 * f + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    // area-weighted normal (not normalised yet)
    fn[3 * f] = uy * vz - uz * vy; fn[3 * f + 1] = uz * vx - ux * vz; fn[3 * f + 2] = ux * vy - uy * vx;
    deg[idx[3 * f]]++; deg[idx[3 * f + 1]]++; deg[idx[3 * f + 2]]++;
  }
  // vertex -> incident faces (CSR)
  const start = new Uint32Array(nv + 1);
  for (let v = 0; v < nv; v++) start[v + 1] = start[v] + deg[v];
  const fill = start.slice(0, nv), inc = new Uint32Array(start[nv]);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) { const v = idx[3 * f + k]; inc[fill[v]++] = f; }
  const unit = new Float32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const x = fn[3 * f], y = fn[3 * f + 1], z = fn[3 * f + 2], l = Math.hypot(x, y, z) || 1;
    unit[3 * f] = x / l; unit[3 * f + 1] = y / l; unit[3 * f + 2] = z / l;
  }
  const P = new Float32Array(nf * 9), N = new Float32Array(nf * 9);
  for (let f = 0; f < nf; f++) {
    const ux = unit[3 * f], uy = unit[3 * f + 1], uz = unit[3 * f + 2];
    for (let k = 0; k < 3; k++) {
      const v = idx[3 * f + k], o = 9 * f + 3 * k;
      P[o] = pos[3 * v]; P[o + 1] = pos[3 * v + 1]; P[o + 2] = pos[3 * v + 2];
      let nx = 0, ny = 0, nz = 0;
      for (let j = start[v]; j < start[v + 1]; j++) {
        const g = inc[j];
        if (unit[3 * g] * ux + unit[3 * g + 1] * uy + unit[3 * g + 2] * uz >= cosT) { nx += fn[3 * g]; ny += fn[3 * g + 1]; nz += fn[3 * g + 2]; }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l;
    }
  }
  const bg = new T.BufferGeometry();
  bg.setAttribute('position', new T.BufferAttribute(P, 3));
  bg.setAttribute('normal', new T.BufferAttribute(N, 3));
  return bg;
}

/** Plays DEMO as joint targets: tick(dt) -> q[6] (or null when finished). */
export class DemoPlayer {
  constructor(from, home) { this.i = 0; this.t = 0; this.from = from.slice(); this.home = home; this.q = from.slice(); }
  tick(dt) {
    if (this.i >= DEMO.length) return null;
    const step = DEMO[this.i]; const to = step.q || this.home;
    this.t += dt;
    const k = Math.min(1, this.t / step.t), e = k * k * (3 - 2 * k);
    for (let j = 0; j < 6; j++) this.q[j] = this.from[j] + (to[j] - this.from[j]) * e;
    if (k >= 1) { this.i++; this.t = 0; this.from = to.slice(); }
    return this.q;
  }
}

/**
 * The simulated arm: physics, rendering, mission check. No page-specific DOM.
 * opts: { canvas, onContextLost(), onContextRestored(), onInteract() }
 * Hooks (set by the page): onFrame(dt) before physics, onAfter(dt) after physics.
 */
export class ArmSim {
  constructor({ THREE, OrbitControls, mj, model, data }, opts) {
    this.T = THREE; this.mj = mj; this.m = model; this.d = data; this.opts = opts;
    this.won = false; this.inBowl = 0; this.fellAt = null;
    this.onFrame = null; this.onAfter = null; this.onWin = null; this.onRender = null;
    this.ids();
    this.three(OrbitControls);
    this.build();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    // background driver: browsers stop requestAnimationFrame in a hidden tab. While keepAlive() says so (an AI
    // session drives the sim, see src/agent/index.js) physics keeps running from worker ticks, without rendering.
    this.keepAlive = null; this.bg = false; this.ticker = null;
    this.bgTick = this.bgTick.bind(this);
    this.syncBg = this.syncBg.bind(this);
    document.addEventListener('visibilitychange', this.syncBg);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.syncBg);
    this.stopTicker();
    try { this.d.delete(); this.m.delete(); } catch (e) {}
    this.controls.dispose();
    this.renderer.dispose();
  }

  ids() {
    const { mj, m } = this, O = mj.mjtObj;
    const id = (type, name) => mj.mj_name2id(m, O[type].value, name);
    this.cubeBody = id('mjOBJ_BODY', 'cube');
    this.bowlBody = id('mjOBJ_BODY', 'bowl');
    this.camBody = id('mjOBJ_BODY', 'camera_mount');
    this.gripSite = id('mjOBJ_SITE', 'gripperframe');
    this.act = JOINTS.map((j) => id('mjOBJ_ACTUATOR', j.name));
    this.qadr = JOINTS.map((j) => m.jnt_qposadr[id('mjOBJ_JOINT', j.name)]);
    this.servoBodies = SERVO_BODY.map((b) => id('mjOBJ_BODY', b));
    this.cubeQ = m.jnt_qposadr[id('mjOBJ_JOINT', 'cube')];
    const range = m.actuator_ctrlrange;
    this.range = this.act.map((a) => [range[2 * a], range[2 * a + 1]]);
    const fr = m.actuator_forcerange;
    this.force0 = this.act.map((a) => [fr[2 * a], fr[2 * a + 1]]);
    const key = m.key_ctrl; this.home = this.act.map((a) => key[a]);
  }

  three(OrbitControls) {
    const T = this.T;
    const canvas = this.opts.canvas;
    const r = this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const phone = matchMedia('(max-width:860px)').matches;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.75 : 2));
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFShadowMap;   // r186: soft PCF (PCFSoftShadowMap was removed)
    r.outputColorSpace = T.SRGBColorSpace;
    r.setClearColor(0x000000, 0); // CSS gradient shows through

    const s = this.scene = new T.Scene();
    // MuJoCo is z-up; three is y-up. Everything physics-driven lives in `world`.
    this.world = new T.Group(); this.world.rotation.x = -Math.PI / 2; s.add(this.world);

    s.add(new T.HemisphereLight(0xffffff, 0xd8d8d2, 1.6));
    const sun = new T.DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.35, 0.9, 0.45); sun.target.position.set(0.15, 0, 0);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -0.45, right: 0.45, top: 0.45, bottom: -0.45, near: 0.1, far: 2 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.002;
    s.add(sun, sun.target);
    const fill = new T.DirectionalLight(0xffffff, 0.6); fill.position.set(-0.5, 0.4, -0.3); s.add(fill);

    const cam = this.camera = new T.PerspectiveCamera(40, 1, 0.01, 10);
    this.controls = new OrbitControls(cam, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.25; this.controls.maxDistance = 1.6;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.enablePan = false;
    this.controls.addEventListener('start', () => this.opts.onInteract && this.opts.onInteract());
    this.resetView();

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.opts.onContextLost && this.opts.onContextLost(); });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.opts.onContextRestored && this.opts.onContextRestored(); });
    const ro = new ResizeObserver(() => this.resize()); ro.observe(canvas.parentElement);
    this.resize();
  }

  resetView() {
    // three coords: (x, z_mj, -y_mj). Look at the work area between cube and bowl.
    const narrow = matchMedia('(max-width:860px)').matches;
    this.controls.target.set(0.15, narrow ? 0.07 : 0.08, -0.01);
    if (narrow) this.camera.position.set(0.41, 0.47, -0.47);
    else this.camera.position.set(0.45, 0.42, -0.55);
    this.controls.update();
  }

  resize() {
    const el = this.renderer.domElement.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the scene framed on tall phone canvases
    this.camera.fov = w / h < 1 ? 52 : 40;
    this.camera.updateProjectionMatrix();
  }

  build() {
    const { T, m } = this;
    const G = { PLANE: 0, SPHERE: 2, CAPSULE: 3, CYLINDER: 5, BOX: 6, MESH: 7 };
    this.printed = new T.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.55, metalness: 0 });
    const servo = new T.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.45, metalness: 0.1 });
    // one servo material per joint so a faulty servo can be tinted
    this.servoMats = SERVO_BODY.map(() => servo.clone());
    const meshCache = new Map();
    this.geoms = [];
    const ngeom = m.ngeom;
    const types = m.geom_type, groups = m.geom_group, dataid = m.geom_dataid, size = m.geom_size;
    const matid = m.geom_matid, matRgba = m.mat_rgba, rgba = m.geom_rgba;
    const vert = m.mesh_vert, face = m.mesh_face, vadr = m.mesh_vertadr, vnum = m.mesh_vertnum, fadr = m.mesh_faceadr, fnum = m.mesh_facenum;
    const bodyOf = m.geom_bodyid;

    for (let g = 0; g < ngeom; g++) {
      if (groups[g] > 2) continue;                 // collision-only geoms
      if (bodyOf[g] === this.camBody) continue;    // Menagerie's optional wrist camera: not part of the kit
      const type = types[g];
      let geo, mat;
      const col = matid[g] >= 0 ? [matRgba[4 * matid[g]], matRgba[4 * matid[g] + 1], matRgba[4 * matid[g] + 2]]
                                : [rgba[4 * g], rgba[4 * g + 1], rgba[4 * g + 2]];
      if (type === G.MESH) {
        const id = dataid[g];
        if (!meshCache.has(id)) {
          const pos = vert.subarray(3 * vadr[id], 3 * (vadr[id] + vnum[id]));
          const idx = face.subarray(3 * fadr[id], 3 * (fadr[id] + fnum[id]));
          meshCache.set(id, creasedGeometry(T, pos, idx, 0.6));
        }
        geo = meshCache.get(id);
        const k = this.servoBodies.indexOf(bodyOf[g]);
        mat = col[0] > 0.5 ? this.printed : (k >= 0 ? this.servoMats[k] : servo);  // yellow in MJCF = printed part; dark = servo
      } else if (bodyOf[g] === this.cubeBody) {
        const s = size[3 * g];
        geo = new T.BoxGeometry(2 * s, 2 * s, 2 * s);
        mat = new T.MeshStandardMaterial({ color: 0xe8461e, roughness: 0.5 });
      } else if (type === G.BOX) {                         // the table
        geo = new T.BoxGeometry(2 * size[3 * g], 2 * size[3 * g + 1], 2 * size[3 * g + 2]);
        mat = new T.MeshStandardMaterial({ color: 0xf6f6f3, roughness: 0.9 });
      } else if (type === G.CYLINDER) {
        geo = new T.CylinderGeometry(size[3 * g], size[3 * g], 2 * size[3 * g + 1], 24);
        geo.rotateX(Math.PI / 2);                          // three cylinders are y-aligned, MuJoCo z-aligned
        mat = servo;
      } else continue;
      const mesh = new T.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = type !== G.BOX || bodyOf[g] === this.cubeBody;
      mesh.receiveShadow = true;
      this.world.add(mesh);
      this.geoms.push([g, mesh]);
    }

    // table grid (Swiss-grid nod), 5 cm pitch, drawn just above the table top
    const grid = new T.GridHelper(0.6, 12, 0xcfcfca, 0xe2e2de);
    grid.rotation.x = Math.PI / 2; grid.position.set(0.14, 0, 0.0004);
    grid.material.transparent = true; grid.material.opacity = 0.9;
    this.world.add(grid);

    // bowl: smooth lathe (collision is an octagon in MJCF)
    const pts = [];
    const prof = [[0, 0.004], [0.050, 0.004], [0.054, 0.006], [0.058, 0.016], [0.060, 0.028], [0.064, 0.028], [0.062, 0.014], [0.057, 0.002], [0.05, 0], [0, 0]];
    for (const [rr, z] of prof) pts.push(new T.Vector2(rr, z));
    const lathe = new T.LatheGeometry(pts, 48); lathe.rotateX(Math.PI / 2);
    this.bowl = new T.Mesh(lathe, new T.MeshStandardMaterial({ color: 0x1f3bff, roughness: 0.5, side: T.DoubleSide }));
    this.bowl.castShadow = true; this.bowl.receiveShadow = true;
    const bp = this.d.xpos; const b = this.bowlBody;
    this.bowl.position.set(bp[3 * b], bp[3 * b + 1], bp[3 * b + 2]);
    this.world.add(this.bowl);

    // soft floor shadow catcher under the table so it does not float
    const floor = new T.Mesh(new T.CircleGeometry(1.2, 48), new T.ShadowMaterial({ opacity: 0.08 }));
    floor.position.set(0.14, 0, -0.03); floor.receiveShadow = true;
    this.world.add(floor);

    this.sync();
  }

  sync() {
    const xp = this.d.geom_xpos, xm = this.d.geom_xmat;
    for (const [g, mesh] of this.geoms) {
      const p = 3 * g, r = 9 * g, e = mesh.matrix.elements;
      // MuJoCo xmat is row-major 3x3; three Matrix4.elements is column-major.
      e[0] = xm[r]; e[4] = xm[r + 1]; e[8] = xm[r + 2]; e[12] = xp[p];
      e[1] = xm[r + 3]; e[5] = xm[r + 4]; e[9] = xm[r + 5]; e[13] = xp[p + 1];
      e[2] = xm[r + 6]; e[6] = xm[r + 7]; e[10] = xm[r + 8]; e[14] = xp[p + 2];
      e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
      mesh.matrixWorldNeedsUpdate = true;
    }
  }

  setColor(hex) { this.printed.color.set(hex); }
  /** Tint a servo body (e.g. red for a fault); null restores the normal colour. */
  tintServo(i, hex) { this.servoMats[i].color.set(hex || 0x1c1c1c); this.servoMats[i].emissive.set(hex ? hex : 0x000000); this.servoMats[i].emissiveIntensity = hex ? 0.35 : 0; }

  // ---------- joints ----------
  setCtrl(i, v) {
    const [lo, hi] = this.range[i];
    this.d.ctrl[this.act[i]] = Math.min(hi, Math.max(lo, v));
  }
  ctrl(i) { return this.d.ctrl[this.act[i]]; }
  q(i) { return this.d.qpos[this.qadr[i]]; }
  goHome() { this.home.forEach((v, i) => this.setCtrl(i, v)); }

  // plant interface for the servo emulator (lib/sts3215-emu.js)
  effort(i) { return this.d.actuator_force[this.act[i]] / this.force0[i][1]; }
  drive(i, q) { this.setCtrl(i, q); }
  release(i) { this.setCtrl(i, this.q(i)); }           // torque off: the 1:345 gearbox holds the joint where it is
  hand(i, q) { this.setCtrl(i, q); }                   // the user's hand moving an unpowered joint
  setStrength(i, s) {
    const a = this.act[i], fr = this.m.actuator_forcerange;
    s = Math.max(0.05, Math.min(1, s));
    if (this._str && this._str[i] === s) return;
    (this._str = this._str || [])[i] = s;
    fr[2 * a] = this.force0[i][0] * s; fr[2 * a + 1] = this.force0[i][1] * s;
  }

  respawnCube() {
    // put the cube back to its start pose (from the keyframe) and stop it
    const q = this.d.qpos, k = this.m.key_qpos, a = this.cubeQ;
    for (let i = 0; i < 7; i++) q[a + i] = k[a + i];
    const v = this.d.qvel, dv = this.m.jnt_dofadr[this.m.body_jntadr[this.cubeBody]];
    for (let i = 0; i < 6; i++) v[dv + i] = 0;
    this.mj.mj_forward(this.m, this.d);
  }

  reset() {
    this.mj.mj_resetDataKeyframe(this.m, this.d, 0);
    this.mj.mj_forward(this.m, this.d);
    this.won = false; this.inBowl = 0; this.fellAt = null;
    this.sync();
  }

  // ---------- mission: cube into the bowl ----------
  /** Returns {text, ok}; calls onWin() once when the cube rests in the bowl. */
  check(dt) {
    const x = this.d.xpos, c = 3 * this.cubeBody, b = 3 * this.bowlBody;
    const cx = x[c], cy = x[c + 1], cz = x[c + 2];
    const dx = cx - x[b], dy = cy - x[b + 1];
    const s = this.d.site_xpos, g = 3 * this.gripSite;
    const near = Math.hypot(s[g] - cx, s[g + 1] - cy, s[g + 2] - cz) < 0.035;
    const qv = this.d.qvel; const vq = this.m.jnt_dofadr[this.m.body_jntadr[this.cubeBody]];
    const slow = Math.hypot(qv[vq], qv[vq + 1], qv[vq + 2]) < 0.05;

    let text, ok = false;
    if (Math.hypot(dx, dy) < BOWL_R && cz < 0.03) {
      this.inBowl = slow ? this.inBowl + dt : 0;
      text = 'Kostka je v misce…'; ok = true;
      if (this.inBowl > WIN_HOLD && !this.won) { this.won = true; this.onWin && this.onWin(); }
    } else {
      this.inBowl = 0;
      if (cz < -0.1) { this.respawnCube(); this.fellAt = this.d.time; }
      if (this.fellAt != null && this.d.time - this.fellAt < 2.5) text = 'Kostka spadla ze stolu, vrátili jsme ji zpět';
      else if (cz > 0.03) text = 'Výborně! Přeneste ji nad misku a pusťte';
      else if (near) text = 'Teď sevřete chapadlo';
      else text = 'Natočte ruku ke kostce a sjeďte k ní';
    }
    if (this.won) { text = 'Mise splněna'; ok = true; }
    return { text, ok };
  }

  /** Advance physics by dt seconds (fixed MuJoCo timestep). */
  step(dt) {
    this.ts = this.ts || this.m.opt.timestep;
    this.acc = (this.acc || 0) + dt;
    while (this.acc >= this.ts) { this.mj.mj_step(this.m, this.d); this.acc -= this.ts; }
  }

  loop(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.bg) return;                   // the background driver owns the clock (no double stepping)
    if (this.lost) { this.last = now; return; }
    let dt = (now - this.last) / 1000; this.last = now;
    if (!(dt > 0)) dt = 0; if (dt > 1 / 20) dt = 1 / 20;   // tab switch / slow frame: don't spiral
    if (this.paused) { this.last = now; return; }   // test hook drives time itself (and skips slow software rendering)
    this.onFrame && this.onFrame(dt);
    this.step(dt);
    this.sync();
    this.onAfter && this.onAfter(dt);
    this.controls.update();
    if (this.onRender) this.onRender(dt); else this.renderer.render(this.scene, this.camera);  // [ux-hook:render]
  }

  // ---------- background driver (hidden tab) ----------
  /** Hidden tab + keepAlive(): physics from worker ticks; otherwise the rAF loop. Called on visibilitychange,
   *  on every background tick and by the page when keepAlive() may have changed. */
  syncBg() {
    const want = !this.disposed && document.hidden && !!(this.keepAlive && this.keepAlive());
    if (want === this.bg) return;
    this.bg = want;
    this.last = performance.now();         // one clock for both drivers: the switch never replays the gap
    if (want) this.startTicker(); else this.stopTicker();
  }

  bgTick() {
    if (!this.bg) return;
    this.syncBg();
    if (!this.bg) return;
    const now = performance.now();
    let dt = (now - this.last) / 1000; this.last = now;
    if (this.lost || this.paused || !(dt > 0)) return;
    // ticks may arrive late (a throttled fallback timer): catch up in frame-sized slices, at most 1 s at once
    dt = Math.min(dt, 1);
    for (let t = 0; t < dt - 1e-9; t += BG_SLICE) {
      const h = Math.min(BG_SLICE, dt - t);
      this.onFrame && this.onFrame(h);
      this.step(h);
      this.onAfter && this.onAfter(h);
    }
    // no sync() / render: nobody sees the canvas (a snapshot syncs and renders on demand)
  }

  /** Dedicated worker timer: not throttled in background tabs like main-thread timers are. */
  startTicker() {
    if (this.ticker) return;
    try {
      const url = URL.createObjectURL(new Blob([TICKER_SRC], { type: 'text/javascript' }));
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      w.onmessage = this.bgTick;
      w.postMessage(BG_MS);
      this.ticker = { stop: () => w.terminate() };
    } catch (e) {
      // no workers (CSP, odd embeds): a plain timer; throttled when hidden, the slices above catch up
      const id = setInterval(this.bgTick, BG_MS);
      this.ticker = { stop: () => clearInterval(id) };
    }
  }

  stopTicker() { if (this.ticker) { this.ticker.stop(); this.ticker = null; } }

  /** Test hook: advance simulated time synchronously in small slices (headless GPUs are slow). */
  advance(sec, slice = 1 / 60) {
    for (let t = 0; t < sec - 1e-9; t += slice) {
      const dt = Math.min(slice, sec - t);
      this.onFrame && this.onFrame(dt);
      this.step(dt);
      this.onAfter && this.onAfter(dt);
    }
    this.sync();
  }
}
