// Demo for the object library: SO-101 scene + library objects dropped on the table; pick one with IK.
// Standalone page (objects.html); does not touch the mission app.
import { ObjectLibrary, injectObjects } from './library.js';
import { layoutFor } from './layout.js';
import { armIds, makePick } from './pick.js';

const $ = (id) => document.getElementById(id);
const TEST = new URLSearchParams(location.search).get('test') === '1';
const ROOT = new URL('../../', import.meta.url);   // sim/so101/
const MESHES = [
  'base_motor_holder_so101_v1', 'base_so101_v2', 'motor_holder_so101_base_v1', 'motor_holder_so101_wrist_v1',
  'moving_jaw_so101_gripper_part0_v1', 'moving_jaw_so101_gripper_part1_v1', 'moving_jaw_so101_v1',
  'rotation_pitch_so101_v1', 'sts3215_03a_no_horn_v1', 'sts3215_03a_v1', 'under_arm_so101_v1', 'upper_arm_so101_v1',
  'waveshare_mounting_plate_so101_v2', 'wrist_roll_follower_so101_camera_mount',
  'wrist_roll_follower_so101_gripper_part0_v1', 'wrist_roll_follower_so101_v1', 'wrist_roll_pitch_so101_v2'
];

function fail(msg) {
  $('loader').hidden = true; $('fail').hidden = false;
  if (msg) $('fail-msg').textContent = msg;
  if (TEST) window.__objs = { error: msg || 'fail' };
}

async function bytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return new Uint8Array(await r.arrayBuffer());
}

async function main() {
  const bar = $('prog');
  const lib = new ObjectLibrary();
  const [THREE, OC, GL, MD, loadMujoco, wasm, sceneXml, man, files] = await Promise.all([
    import('three'),
    import('../../vendor/three/OrbitControls.js'),
    import('../../vendor/three/loaders/GLTFLoader.js'),
    import('../../vendor/three/libs/meshopt_decoder.module.js'),
    import('../../vendor/mujoco/mujoco.js').then((m) => m.default),
    bytes(new URL('vendor/mujoco/mujoco.wasm', ROOT)),
    fetch(new URL('model/scene.xml', ROOT)).then((r) => r.text()),
    lib.manifest(),
    Promise.all([['so101.xml', 'model/so101.xml'], ...MESHES.map((n) => ['assets/' + n + '.msh', 'model/assets/' + n + '.msh'])]
      .map(async ([dst, src]) => [dst, await bytes(new URL(src, ROOT))]))
  ]);
  bar.style.width = '60%';

  const mj = await loadMujoco({ wasmBinary: wasm.buffer, locateFile: (p) => new URL('vendor/mujoco/' + p, ROOT).href });
  mj.FS.mkdir('/m'); mj.FS.mkdir('/m/assets');
  for (const [p, b] of files) mj.FS.writeFile('/m/' + p, b);
  const layout = layoutFor(man);
  const instances = await Promise.all(layout.map((l) => lib.instance(l.id, { pos: l.pos, quat: l.quat })));
  mj.FS.writeFile('/m/scene_objects.xml', injectObjects(sceneXml, instances));
  const model = mj.MjModel.from_xml_path('/m/scene_objects.xml');
  const data = new mj.MjData(model);
  mj.mj_resetDataKeyframe(model, data, 0);
  mj.mj_forward(model, data);

  const loader = new GL.GLTFLoader().setMeshoptDecoder(MD.MeshoptDecoder);
  const app = new Demo(THREE, OC.OrbitControls, mj, model, data, man, instances);
  bar.style.width = '85%';
  app.objects = await lib.attach({ THREE, loader, parent: app.world, mj, model, data, instances });
  app.ui();
  $('loader').hidden = true; $('hud').hidden = false;
  $('sr').textContent = 'Simulace je připravena.';
  if (TEST) window.__objs = app.api();
  addEventListener('pagehide', (e) => { if (!e.persisted) app.dispose(); });
}

class Demo {
  constructor(THREE, OrbitControls, mj, m, d, man, instances) {
    Object.assign(this, { T: THREE, mj, m, d, man, instances });
    this.ids = armIds(mj, m);
    this.home = this.ids.act.map((a) => m.key_ctrl[a]);
    this.pick = null; this.objects = null;
    this.setup(OrbitControls);
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  setup(OrbitControls) {
    const T = this.T, canvas = $('c');
    const r = this.renderer = new T.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true; r.outputColorSpace = T.SRGBColorSpace; r.setClearColor(0, 0);
    const s = this.scene = new T.Scene();
    this.world = new T.Group(); this.world.rotation.x = -Math.PI / 2; s.add(this.world);
    s.add(new T.HemisphereLight(0xffffff, 0xd8d8d2, 1.6));
    const sun = new T.DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.35, 0.9, 0.45); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -0.45, right: 0.45, top: 0.45, bottom: -0.45, near: 0.1, far: 2 });
    sun.shadow.bias = -0.0005; s.add(sun);
    this.camera = new T.PerspectiveCamera(40, 1, 0.01, 10);
    this.camera.position.set(0.45, 0.42, -0.55);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0.17, 0.06, -0.01); this.controls.enableDamping = true; this.controls.update();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement); this.resize();

    // robot + table + cube from the compiled model (visual groups 0-2)
    const { m } = this, camBody = this.mj.mj_name2id(m, this.mj.mjtObj.mjOBJ_BODY.value, 'camera_mount');
    const printed = new T.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.55 });
    const servo = new T.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.45 });
    const cache = new Map();
    this.geoms = [];
    for (let g = 0; g < m.ngeom; g++) {
      if (m.geom_group[g] > 2 || m.geom_bodyid[g] === camBody) continue;
      const type = m.geom_type[g], sz = m.geom_size;
      let geo, mat;
      if (type === 7) {
        const id = m.geom_dataid[g];
        if (!cache.has(id)) {
          const geo2 = new T.BufferGeometry();
          geo2.setAttribute('position', new T.BufferAttribute(m.mesh_vert.slice(3 * m.mesh_vertadr[id], 3 * (m.mesh_vertadr[id] + m.mesh_vertnum[id])), 3));
          geo2.setIndex(new T.BufferAttribute(Uint32Array.from(m.mesh_face.subarray(3 * m.mesh_faceadr[id], 3 * (m.mesh_faceadr[id] + m.mesh_facenum[id]))), 1));  // WebGL has no Int32 indices
          geo2.computeVertexNormals();
          cache.set(id, geo2);
        }
        geo = cache.get(id);
        const mi = m.geom_matid[g];
        mat = (mi >= 0 ? m.mat_rgba[4 * mi] : m.geom_rgba[4 * g]) > 0.5 ? printed : servo;
      } else if (type === 6) {
        geo = new T.BoxGeometry(2 * sz[3 * g], 2 * sz[3 * g + 1], 2 * sz[3 * g + 2]);
        const c = m.geom_rgba.slice(4 * g, 4 * g + 3);
        mat = new T.MeshStandardMaterial({ color: new T.Color(c[0], c[1], c[2]), roughness: 0.8 });
      } else if (type === 5) {
        geo = new T.CylinderGeometry(sz[3 * g], sz[3 * g], 2 * sz[3 * g + 1], 24); geo.rotateX(Math.PI / 2); mat = servo;
      } else continue;
      const mesh = new T.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false; mesh.castShadow = true; mesh.receiveShadow = true;
      this.world.add(mesh); this.geoms.push([g, mesh]);
    }
    // bowl (collision octagon is invisible in the MJCF)
    const bowlBody = this.mj.mj_name2id(m, this.mj.mjtObj.mjOBJ_BODY.value, 'bowl');
    if (bowlBody >= 0) {
      const prof = [[0, 0.004], [0.05, 0.004], [0.054, 0.006], [0.058, 0.016], [0.06, 0.028], [0.064, 0.028], [0.062, 0.014], [0.057, 0.002], [0.05, 0], [0, 0]];
      const lathe = new T.LatheGeometry(prof.map(([a, b]) => new T.Vector2(a, b)), 48); lathe.rotateX(Math.PI / 2);
      const bowl = new T.Mesh(lathe, new T.MeshStandardMaterial({ color: 0x1f3bff, roughness: 0.5, side: T.DoubleSide }));
      bowl.position.set(m.body_pos[3 * bowlBody], m.body_pos[3 * bowlBody + 1], m.body_pos[3 * bowlBody + 2]);
      bowl.castShadow = true; this.world.add(bowl);
    }
    this.sync();
  }

  resize() {
    const el = this.renderer.domElement.parentElement, w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 52 : 40; this.camera.updateProjectionMatrix();
  }

  sync() {
    const xp = this.d.geom_xpos, xm = this.d.geom_xmat;
    for (const [g, mesh] of this.geoms) {
      const p = 3 * g, r = 9 * g, e = mesh.matrix.elements;
      e[0] = xm[r]; e[4] = xm[r + 1]; e[8] = xm[r + 2]; e[12] = xp[p];
      e[1] = xm[r + 3]; e[5] = xm[r + 4]; e[9] = xm[r + 5]; e[13] = xp[p + 1];
      e[2] = xm[r + 6]; e[6] = xm[r + 7]; e[10] = xm[r + 8]; e[14] = xp[p + 2];
      e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1; mesh.matrixWorldNeedsUpdate = true;
    }
    if (this.objects) this.objects.sync();
  }

  ui() {
    const list = $('objs');
    this.rows = new Map();
    for (const it of this.instances) {
      const o = this.man.objects.find((x) => x.id === it.id);
      const li = document.createElement('li'); li.className = 'obj';
      const h = document.createElement('h3'); h.textContent = o.name_cs;
      const p = document.createElement('p');
      p.textContent = `${Math.round(o.mass_kg * 1000)} g · ${o.size_m.map((s) => (s * 100).toFixed(1)).join(' × ')} cm · ${o.license}`;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn';
      b.innerHTML = 'Zvednout <span aria-hidden="true">↑</span>';
      b.disabled = !o.graspable;
      b.addEventListener('click', () => this.startPick(it.name));
      li.append(h, b, p); list.appendChild(li);
      this.rows.set(it.name, li);
    }
    $('drop').disabled = false; $('home').disabled = false;
    $('drop').addEventListener('click', () => this.drop());
    $('home').addEventListener('click', () => { this.pick = null; this.goHome(); });
  }

  hud(text) { if (text !== this.hudText) { $('hud-text').textContent = text; this.hudText = text; } }

  goHome() { this.ids.act.forEach((a, i) => { this.d.ctrl[a] = this.home[i]; }); }

  drop(h = 0.05) {   // reset to the keyframe and let every object fall from a few cm
    this.pick = null;
    this.mj.mj_resetDataKeyframe(this.m, this.d, 0);
    for (const it of this.objects.items) {
      const j = this.m.body_jntadr[it.bodyId], a = this.m.jnt_qposadr[j];
      this.d.qpos[a + 2] += h;
    }
    this.mj.mj_forward(this.m, this.d);
    this.hud('Předměty padají na stůl');
  }

  startPick(name) {
    const it = this.objects.items.find((x) => x.name === name);
    const o = this.man.objects.find((x) => x.id === it.id);
    const P = makePick(this.mj, this.m, this.d, this.ids, it.bodyId, o.size_m);
    if (!P.reachable) { this.hud(`${o.name_cs}: ruka na předmět nedosáhne`); return false; }
    for (const li of this.rows.values()) li.removeAttribute('aria-busy');
    this.rows.get(name).setAttribute('aria-busy', 'true');
    this.pick = { P, it, o, z0: this.d.xpos[3 * it.bodyId + 2] };
    this.hud(`Zvedám: ${o.name_cs}`);
    return true;
  }

  tickPick(dt) {
    const k = this.pick; if (!k) return;
    if (k.P.step(dt) === 'done') {
      const lifted = this.d.xpos[3 * k.it.bodyId + 2] - k.z0;
      k.result = lifted > 0.03;
      this.hud(k.result ? `${k.o.name_cs} je ve vzduchu (${Math.round(lifted * 100)} cm)` : `${k.o.name_cs} vyklouzl`);
      this.rows.get(k.it.name).removeAttribute('aria-busy');
      this.lastPick = { id: k.o.id, lifted, ok: k.result };
      this.pick = null;
    }
  }

  loop(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = Math.min(1 / 20, Math.max(0, (now - this.last) / 1000)); this.last = now;
    this.acc = (this.acc || 0) + dt;
    const ts = this.m.opt.timestep;
    while (this.acc >= ts) { this.tickPick(ts); this.mj.mj_step(this.m, this.d); this.acc -= ts; }
    this.sync(); this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.raf);
    try { this.d.delete(); this.m.delete(); } catch (e) { /* already freed */ }
    this.renderer.dispose();
  }

  api() {
    const self = this;
    return {
      ready: true,
      objects: () => self.objects.items.map((it) => ({ id: it.id, name: it.name, pos: Array.from(self.d.xpos.subarray(3 * it.bodyId, 3 * it.bodyId + 3)) })),
      pick: (id) => self.startPick('obj_' + id),
      drop: () => self.drop(),
      lastPick: () => self.lastPick || null,
      advance: (sec) => {
        const ts = self.m.opt.timestep, n = Math.round(sec / ts);
        for (let i = 0; i < n; i++) { self.tickPick(ts); self.mj.mj_step(self.m, self.d); }
        self.sync();
      }
    };
  }
}

if (typeof WebAssembly !== 'object') fail();
else main().catch((e) => { console.error(e); fail('Při načítání nastala chyba. Zkuste stránku obnovit.'); });
