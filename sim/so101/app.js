// SO-101 in-browser simulation — printedrobotics.cz
// MuJoCo (official WASM bindings, vendored) for physics, three.js for rendering.
// Model: MuJoCo Menagerie robotstudio_so101 (Apache-2.0), see NOTICE.txt.

const $ = (id) => document.getElementById(id);
const TEST = new URLSearchParams(location.search).get('test') === '1';  // Playwright hook only
const BASE = new URL('./', import.meta.url);

// Filament colours — same values as window.PR_COLORS in /assets/data.js
const COLORS = [
  { id: 'white', name: 'Bílá', hex: '#F2F2EE' },
  { id: 'grey', name: 'Šedá', hex: '#9A9A94' },
  { id: 'black', name: 'Černá', hex: '#2A2A2A' },
  { id: 'orange', name: 'Oranžová', hex: '#E8461E' },
  { id: 'blue', name: 'Modrá', hex: '#1F3BFF' }
];

const JOINTS = [
  { name: 'shoulder_pan', label: 'Otočení základny' },
  { name: 'shoulder_lift', label: 'Rameno' },
  { name: 'elbow_flex', label: 'Loket' },
  { name: 'wrist_flex', label: 'Zápěstí – náklon' },
  { name: 'wrist_roll', label: 'Zápěstí – rotace' },
  { name: 'gripper', label: 'Chapadlo', grip: true }
];

const MESHES = [
  'base_motor_holder_so101_v1', 'base_so101_v2', 'motor_holder_so101_base_v1', 'motor_holder_so101_wrist_v1',
  'moving_jaw_so101_gripper_part0_v1', 'moving_jaw_so101_gripper_part1_v1', 'moving_jaw_so101_v1',
  'rotation_pitch_so101_v1', 'sts3215_03a_no_horn_v1', 'sts3215_03a_v1', 'under_arm_so101_v1', 'upper_arm_so101_v1',
  'waveshare_mounting_plate_so101_v2', 'wrist_roll_follower_so101_camera_mount',
  'wrist_roll_follower_so101_gripper_part0_v1', 'wrist_roll_follower_so101_v1', 'wrist_roll_pitch_so101_v2'
];

// Scripted solution (joint targets, rad) — used by "Ukázat řešení" and tests.
const DEMO = [
  { q: [0.476, 0.315, -0.382, 1.638, 0, 1.2], t: 1.4 },  // above the cube, gripper open
  { q: [0.476, 0.370, -0.030, 1.230, 0, 1.2], t: 1.0 },  // down
  { q: [0.476, 0.370, -0.030, 1.230, 0, -0.1], t: 0.7 }, // close
  { q: [0.476, 0.331, -0.483, 1.658, 0, -0.1], t: 1.0 }, // lift
  { q: [-0.754, 0.142, -0.216, 1.645, 0, -0.1], t: 1.8 },// above the bowl
  { q: [-0.754, 0.135, -0.058, 1.494, 0, 1.2], t: 0.9 }, // lower a bit and release
  { q: null, t: 1.4 }                                    // home
];

const BOWL_R = 0.05;        // success radius (m) around bowl centre
const WIN_HOLD = 0.5;       // seconds the cube must rest in the bowl

// ---------- capability check ----------
function fail(msg) {
  $('loader').hidden = true;
  $('fail').hidden = false;
  document.body.classList.add('sim-fail');
  if (msg) $('fail-msg').textContent = msg;
  if (TEST) window.__sim = { error: msg || 'fail' };
}
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();  // free the probe context
    return true;
  } catch (e) { return false; }
}
if (typeof WebAssembly !== 'object' || !hasWebGL()) {
  fail();
} else {
  main().catch((e) => {
    console.error(e);
    fail('Při načítání simulace nastala chyba. Zkuste stránku obnovit, případně jiný prohlížeč.');
  });
}

// ---------- loading with progress ----------
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

async function main() {
  const t0 = performance.now();
  // Progress: wasm ~ 70 %, meshes ~ 25 %, rest 5 %. Content-length may be the compressed size, so clamp.
  const prog = { wasm: 0, mesh: 0 };
  const bar = $('prog');
  const paint = () => { bar.style.width = Math.min(100, 5 + prog.wasm * 70 + prog.mesh * 25).toFixed(1) + '%'; };

  const [THREE, OC, loadMujoco, wasmBinary, files] = await Promise.all([
    import('three'),
    import('./vendor/three/OrbitControls.js'),
    import('./vendor/mujoco/mujoco.js').then((m) => m.default),
    fetchBytes(new URL('vendor/mujoco/mujoco.wasm', BASE), (g, t) => { prog.wasm = Math.min(1, g / t); paint(); }),
    loadModelFiles((f) => { prog.mesh = f; paint(); })
  ]);

  const mj = await loadMujoco({ wasmBinary: wasmBinary.buffer, locateFile: (p) => new URL('vendor/mujoco/' + p, BASE).href });
  mj.FS.mkdir('/m'); mj.FS.mkdir('/m/assets');
  for (const [path, bytes] of files) mj.FS.writeFile('/m/' + path, bytes);
  const model = mj.MjModel.from_xml_path('/m/scene.xml');
  const data = new mj.MjData(model);
  mj.mj_resetDataKeyframe(model, data, 0);
  mj.mj_forward(model, data);

  const app = new Sim(THREE, OC.OrbitControls, mj, model, data);
  // [ux-hook:install] optional UX layer (src/ux.js: smart move, missions, replay, cameras...).
  // The plain slider sim keeps working if it fails to load.
  try { await (await import('./src/ux.js')).install(app, { THREE, mj, TEST }); }
  catch (e) { console.warn('UX layer disabled:', e); app.ux = null; }
  bar.style.width = '100%';
  $('loader').hidden = true;
  $('hud').hidden = false;
  $('hint').hidden = false;
  $('sr').textContent = 'Simulace je připravena, ovládání je dostupné.';
  if (TEST) { window.__sim = app.api(); window.__sim.loadMs = Math.round(performance.now() - t0); }
  // free WASM heap objects (Embind handles are not garbage-collected)
  addEventListener('pagehide', (e) => { if (!e.persisted) app.dispose(); });
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

// ---------- simulation + rendering ----------
class Sim {
  constructor(THREE, OrbitControls, mj, model, data) {
    this.T = THREE; this.mj = mj; this.m = model; this.d = data;
    this.paused = false; this.won = false; this.inBowl = 0; this.demo = null;
    this.ids();
    this.three(OrbitControls);
    this.build();
    this.ui();
    this.setColor(this.loadColor());
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
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
    this.cubeQ = m.jnt_qposadr[id('mjOBJ_JOINT', 'cube')];
    const range = m.actuator_ctrlrange;
    this.range = this.act.map((a) => [range[2 * a], range[2 * a + 1]]);
    const key = m.key_ctrl; this.home = this.act.map((a) => key[a]);
  }

  three(OrbitControls) {
    const T = this.T;
    const canvas = $('c');
    const r = this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const phone = matchMedia('(max-width:860px)').matches;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.75 : 2));
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
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
    this.controls.addEventListener('start', () => { $('hint').hidden = true; });
    this.resetView();

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); this.lost = true;
      $('fail-msg').textContent = 'Grafika prohlížeče se resetovala. Počkejte chvíli, nebo obnovte stránku.';
      $('reload').hidden = false; $('fail').hidden = false;
    });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; $('fail').hidden = true; $('reload').hidden = true; });
    $('reload').addEventListener('click', () => location.reload());
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
        mat = col[0] > 0.5 ? this.printed : servo;          // yellow in MJCF = printed part; dark = servo
      } else if (bodyOf[g] === this.cubeBody) {
        const s = size[3 * g];
        geo = new T.BoxGeometry(2 * s, 2 * s, 2 * s);
        mat = new T.MeshStandardMaterial({ color: 0xe8461e, roughness: 0.5 });
        this.cubeMat = mat;
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

  // ---------- UI ----------
  ui() {
    const box = $('joints');
    this.sliders = JOINTS.map((j, i) => {
      const [lo, hi] = this.range[i];
      const wrap = document.createElement('div'); wrap.className = 'jn' + (j.grip ? ' grip' : '');
      const id = 'j-' + j.name;
      wrap.innerHTML = `<label for="${id}">${j.label}</label><output for="${id}"></output>` +
        `<input type="range" id="${id}" min="${lo}" max="${hi}" step="any">`;
      const input = wrap.querySelector('input'), out = wrap.querySelector('output');
      input.addEventListener('input', () => { this.stopDemo(); this.setCtrl(i, +input.value); });
      box.appendChild(wrap);
      return { input, out, grip: !!j.grip, lo, hi };
    });
    box.disabled = false;
    for (const b of ['home', 'reset', 'demo']) $(b).disabled = false;
    $('home').addEventListener('click', () => { this.stopDemo(); this.goHome(); });
    $('reset').addEventListener('click', () => this.reset());
    $('again').addEventListener('click', () => this.reset());
    $('demo').addEventListener('click', () => this.startDemo());
    $('cta').addEventListener('click', () => { try { window.dataLayer && window.dataLayer.push({ event: 'sim_cta', robot: 'so101' }); } catch (e) {} });

    const sw = $('sw');
    this.swatches = COLORS.map((c) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.title = c.name; b.setAttribute('aria-label', c.name);
      b.style.background = c.hex; b.dataset.id = c.id;
      b.addEventListener('click', () => this.setColor(c.id));
      sw.appendChild(b); return b;
    });
    this.refreshSliders();
  }

  setCtrl(i, v) {
    const [lo, hi] = this.range[i];
    this.d.ctrl[this.act[i]] = Math.min(hi, Math.max(lo, v));
    this.refreshSlider(i);
  }
  refreshSlider(i) {
    const s = this.sliders[i], v = this.d.ctrl[this.act[i]];
    s.input.value = v;
    s.out.textContent = s.grip
      ? (v < 0.15 ? 'zavřeno' : Math.round((v - s.lo) / (s.hi - s.lo) * 100) + ' % otevřeno')
      : Math.round(v * 180 / Math.PI) + '°';
  }
  refreshSliders() { for (let i = 0; i < this.sliders.length; i++) this.refreshSlider(i); }

  setColor(id) {
    const c = COLORS.find((x) => x.id === id) || COLORS[0];
    this.printed.color.set(c.hex);
    for (const b of this.swatches) b.setAttribute('aria-checked', String(b.dataset.id === c.id));
    try { localStorage.setItem('pr-sim-color', c.id); } catch (e) {}
    this.color = c.id;
  }
  loadColor() { try { return localStorage.getItem('pr-sim-color') || 'white'; } catch (e) { return 'white'; } }

  respawnCube() {
    // put the cube back to its start pose (from the keyframe) and stop it
    const q = this.d.qpos, k = this.m.key_qpos, a = this.cubeQ;
    for (let i = 0; i < 7; i++) q[a + i] = k[a + i];
    const v = this.d.qvel, dv = this.m.jnt_dofadr[this.m.body_jntadr[this.cubeBody]];
    for (let i = 0; i < 6; i++) v[dv + i] = 0;
    this.mj.mj_forward(this.m, this.d);
  }

  goHome() { this.home.forEach((v, i) => this.setCtrl(i, v)); }

  reset() {
    this.stopDemo();
    this.mj.mj_resetDataKeyframe(this.m, this.d, 0);
    this.mj.mj_forward(this.m, this.d);
    const hadFocus = $('win').contains(document.activeElement);
    this.won = false; this.inBowl = 0; this.fellAt = null;
    $('win').hidden = true;
    if (hadFocus) $('demo').focus({ preventScroll: true });
    if (this.ux) this.ux.onReset();  // [ux-hook:reset] mission layout, controller sync
    this.refreshSliders(); this.sync();
  }

  startDemo() {
    if (this.ux && this.ux.startDemo()) return;  // [ux-hook:demo] per-mission planner solution
    this.reset();
    this.demo = { i: 0, t: 0, from: this.act.map((a) => this.d.ctrl[a]) };
  }
  stopDemo() { this.demo = null; }
  tickDemo(dt) {
    const D = this.demo; if (!D) return;
    const step = DEMO[D.i]; const to = step.q || this.home;
    D.t += dt;
    const k = Math.min(1, D.t / step.t), e = k * k * (3 - 2 * k);
    for (let i = 0; i < 6; i++) this.d.ctrl[this.act[i]] = D.from[i] + (to[i] - D.from[i]) * e;
    if (k >= 1) {
      D.i++; D.t = 0; D.from = to.slice();
      if (D.i >= DEMO.length) this.demo = null;
    }
    this.refreshSliders();
  }

  // ---------- mission ----------
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
      if (this.inBowl > WIN_HOLD && !this.won) this.win();
    } else {
      this.inBowl = 0;
      if (cz < -0.1) { this.respawnCube(); this.fellAt = this.d.time; }
      if (this.fellAt != null && this.d.time - this.fellAt < 2.5) text = 'Kostka spadla ze stolu, vrátili jsme ji zpět';
      else if (cz > 0.03) text = 'Výborně! Přeneste ji nad misku a pusťte';
      else if (near) text = 'Teď sevřete chapadlo';
      else text = 'Natočte ruku ke kostce a sjeďte k ní';
    }
    if (this.won) { text = 'Mise splněna'; ok = true; }
    // write only on change: #hud-text is a live region
    if (text !== this.hudText) { $('hud-text').textContent = text; this.hudText = text; }
    if (ok !== this.hudOk) { $('hud').classList.toggle('ok', ok); this.hudOk = ok; }
  }

  win() {
    this.won = true;
    $('win').hidden = false;
    $('win-h').focus({ preventScroll: true });
    try { window.dataLayer && window.dataLayer.push({ event: 'sim_success', robot: 'so101' }); } catch (e) {}
  }

  loop(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.lost) { this.last = now; return; }
    let dt = (now - this.last) / 1000; this.last = now;
    if (!(dt > 0)) dt = 0; if (dt > 1 / 20) dt = 1 / 20;   // tab switch / slow frame: don't spiral
    if (this.ux) this.ux.pre(dt);  // [ux-hook:pre] IK controller, replay, planner
    this.tickDemo(dt);
    this.ts = this.ts || this.m.opt.timestep;
    this.acc = (this.acc || 0) + dt;
    while (this.acc >= this.ts) { this.mj.mj_step(this.m, this.d); this.acc -= this.ts; }
    this.sync();
    if (!(this.ux && this.ux.check(dt))) this.check(dt);  // [ux-hook:check] mission logic
    this.controls.update();
    if (this.ux) this.ux.render(dt); else this.renderer.render(this.scene, this.camera);  // [ux-hook:render]
  }

  api() {
    const api = {
      ready: true,
      setTargets: (q) => { this.stopDemo(); q.forEach((v, i) => v != null && this.setCtrl(i, v)); },
      state: () => ({
        qpos: Array.from(this.d.qpos), ctrl: Array.from(this.d.ctrl),
        cube: Array.from(this.d.xpos.subarray(3 * this.cubeBody, 3 * this.cubeBody + 3)),
        won: this.won, hud: this.hudText, color: this.color, time: this.d.time
      }),
      demo: () => this.startDemo(),
      // test hook: advance simulated time synchronously (headless GPUs render too slowly for real time)
      advance: (sec) => {
        const ts = this.m.opt.timestep, n = Math.round(sec / ts);
        for (let i = 0; i < n; i++) { this.tickDemo(ts); this.mj.mj_step(this.m, this.d); this.check(ts); }
        this.sync();
      },
      reset: () => this.reset(),
      setColor: (id) => this.setColor(id),
      DEMO,
      _app: this
    };
    return this.ux ? this.ux.extendApi(api) : api;  // [ux-hook:api] test hooks of the UX layer
  }
}
