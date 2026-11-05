// Scroll-driven camera flythrough over a static showroom of robots grouped by category.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {toCreasedNormals, mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const Q = new URLSearchParams(location.search);
const CAPTURE = Q.has('capture');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const G = await (await fetch('groups.json')).json();
const canvas = document.getElementById('c');
const mobile = () => innerWidth < 700;

// captions inside the text cards
document.querySelectorAll('.t').forEach(sec => {
  const g = G[+sec.dataset.i], m = sec.querySelector('.meta');
  if (!g || !m) return;
  m.innerHTML = `<b>${g.models.map(x => x.name).join(' · ')}</b>` +
    (g.count ? `Kategorie: ${g.label} · ${g.count} projektů` : `${g.label} · ${g.models.length} modely`);
});

// ---------- renderer / scene ----------
const r = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
r.setClearColor(0xffffff, 1);
r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0;
const s = new THREE.Scene();
s.fog = new THREE.Fog(0xffffff, 9, 30);
s.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), .04).texture;
s.environmentIntensity = .38;
s.add(new THREE.HemisphereLight(0xffffff, 0xd9d9d3, .35));
const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(4, 9, 6); s.add(key, key.target);
const SHADOWS = !mobile();
if (SHADOWS) {
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.0004; key.shadow.normalBias = .02;
  Object.assign(key.shadow.camera, {left: -7, right: 7, top: 7, bottom: -7, near: .5, far: 30});
}
const fill = new THREE.DirectionalLight(0xe8eeff, .35); fill.position.set(-6, 3, -4); s.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
  new THREE.MeshBasicMaterial({color: 0xf4f4f1, toneMapped: false}));
floor.rotation.x = -Math.PI / 2; s.add(floor);
if (SHADOWS) { const sf = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({opacity: .16})); sf.rotation.x = -Math.PI / 2; sf.position.y = .001; sf.receiveShadow = true; s.add(sf); }
// soft contact shadow texture
const shTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(.45, 'rgba(0,0,0,.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
})();
const shMat = new THREE.MeshBasicMaterial({map: shTex, transparent: true, depthWrite: false, toneMapped: false});
const cam = new THREE.PerspectiveCamera(30, 1, .05, 80);

// ---------- models ----------
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = {};
const CREASE = 30 * Math.PI / 180, geoCache = new Map(), edgeMat = new THREE.LineBasicMaterial({color: 0x1a1a1a, transparent: true, opacity: .22});
// hard-surface normals: computed once per source geometry, shared between meshes, original disposed
function crisp(g) {
  if (geoCache.has(g)) return geoCache.get(g);
  let n = g;
  try {
    const tmp = new THREE.BufferGeometry(); tmp.setAttribute('position', g.attributes.position); if (g.index) tmp.setIndex(g.index);
    n = mergeVertices(toCreasedNormals(tmp, CREASE), 1e-5);
    if (n !== g) { n.groups = g.groups; g.dispose(); }
  } catch (e) { n = g; }
  geoCache.set(g, n); return n;
}
const idle = () => new Promise(res => (window.requestIdleCallback || setTimeout)(res));
async function prep(gl) {
  const root = new THREE.Group(), m = gl.scene; root.add(m);
  const b = new THREE.Box3().setFromObject(m), sph = b.getBoundingSphere(new THREE.Sphere()), k = 1 / sph.radius;
  m.scale.multiplyScalar(k); m.position.sub(sph.center).multiplyScalar(k); m.updateMatrixWorld(true);
  let mi = 0; const meshes = [];
  m.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (let i = 0; i < meshes.length; i++) { const o = meshes[i]; o.geometry = crisp(o.geometry); o.castShadow = SHADOWS; if (i % 8 === 7) await idle(); }
  m.traverse(o => {
    if (!o.isMesh) return;
    const ar = [].concat(o.material).map(M => {
      M = M.clone();
      let L = .5;
      if (M.color) { const h = {}; M.color.getHSL(h); L = h.l; if (h.l > .7) M.color.setHSL(h.h, h.s * .4, .7 + .06 * ((mi * 37) % 7) / 6); }
      if ('roughness' in M) { M.roughness = L < .25 ? .42 : .5; M.metalness = L < .25 ? .45 : .05; }
      M.flatShading = false; M.needsUpdate = true;
      mi++; return M;
    });
    o.material = Array.isArray(o.material) ? ar : ar[0];
  });
  let tops = [...m.children];
  while (tops.length < 4) { const n = tops.find(o => o.children.length > 1); if (!n) break; tops = tops.filter(o => o !== n).concat(n.children); }
  const parts = tops.map(o => {
    const wc = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    const d = wc.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : wc.clone();
    d.normalize().add(new THREE.Vector3(0, .25, 0)).normalize();
    const wsc = o.parent.getWorldScale(new THREE.Vector3()).x;
    return {o, base: o.position.clone(), off: d.multiplyScalar(.6 / wsc)};
  });
  root.userData.edges = () => {
    if (mobile() || root.userData.e) return;
    root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert(), out = [], v = new THREE.Vector3(), M = new THREE.Matrix4();
    for (const o of meshes) {
      const eg = new THREE.EdgesGeometry(o.geometry, 35), p = eg.attributes.position; M.multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(M); out.push(v.x, v.y, v.z); }
      eg.dispose();
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    root.add(root.userData.e = new THREE.LineSegments(g, edgeMat));
  };
  return {root, parts};
}
export const loadModel = name => cache[name] ??= loader.loadAsync(`../models/${name}.glb`).then(prep);
window.loadModel = loadModel;

// ---------- showroom layout ----------
const SCALE = .62, GAP = 1.45, STEP = 6, EXPL = 5;
const clusters = G.slice(0, 12).map((g, k) => ({
  g, k, c: new THREE.Vector3(k * STEP, 0, k % 2 ? -1.6 : 1.6),
  w: (g.models.length - 1) * GAP + 1.3
}));
const slots = [];
clusters.forEach(cl => cl.g.models.forEach((m, j) => slots.push({
  cl, j, name: m.model, x: cl.c.x + (j - (cl.g.models.length - 1) / 2) * GAP, z: cl.c.z
})));
let dirty = true;
function place(sl, o) {
  const R = o.root; R.scale.setScalar(SCALE); R.rotation.y = -.55 + (sl.j % 2) * .25;
  R.position.set(0, 0, 0); R.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(R);
  R.position.set(sl.x, -b.min.y + .002, sl.z); s.add(R);
  const sz = b.getSize(new THREE.Vector3());
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shMat);
  sh.rotation.x = -Math.PI / 2; sh.position.set(sl.x, .003, sl.z); sh.scale.set(sz.x * 1.35 + .2, sz.z * 1.35 + .2, 1);
  s.add(sh); sl.o = o; dirty = true;
  if (!(sl.cl.k === EXPL && sl.j === 0)) o.root.userData.edges?.();
}

// ---------- camera keyframes ----------
const secs = [...document.querySelectorAll('.t')];
let camCurve, tgtCurve;
function buildPath() {
  const mob = mobile(), P = [], T = [];
  clusters.forEach(cl => {
    const yaw = (cl.k % 2 ? -1 : 1) * .38;
    let D = (Math.max(3.2, cl.w * .95 + 1.5)) * (mob ? 1.5 : 1);
    let t = cl.c.clone().add(new THREE.Vector3(mob ? 0 : -(cl.w * .24 + .7), mob ? -.15 : .45, 0));
    if (mob && cl.k === EXPL) { const s0 = slots.find(x => x.cl === cl && x.j === 0); t = new THREE.Vector3(s0.x + .6, .3, s0.z); D = 10.5; }
    T.push(t); P.push(t.clone().add(new THREE.Vector3(Math.sin(yaw) * D, mob ? 1.9 : 1.35, Math.cos(yaw) * D)));
  });
  // final thesis: pull back over the whole showroom
  const mid = new THREE.Vector3((clusters.length - 1) * STEP / 2, 0, 0);
  T.push(mid.clone().add(new THREE.Vector3(mob ? 0 : -3.5, 0, 0)));
  P.push(mid.clone().add(new THREE.Vector3(mob ? 0 : 2, mob ? 13 : 7.5, mob ? 24 : 15)));
  camCurve = new THREE.CatmullRomCurve3(P, false, 'centripetal');
  tgtCurve = new THREE.CatmullRomCurve3(T, false, 'centripetal');
}
buildPath();
let centers = [];
const measure = () => { centers = secs.map(e => { const b = e.getBoundingClientRect(); return b.top + scrollY + b.height / 2; }); };
measure();
const smooth = x => x * x * (3 - 2 * x);
function scrollU() {
  const y = scrollY + innerHeight / 2, n = centers.length;
  if (y <= centers[0]) return 0;
  for (let k = 0; k < n - 1; k++) if (y < centers[k + 1]) {
    const f = (y - centers[k]) / (centers[k + 1] - centers[k]);
    if (RM) return f < .5 ? k : k + 1;
    return k + smooth(Math.min(1, Math.max(0, (f - .18) / .64)));   // dwell at each thesis
  }
  return n - 1;
}

// ---------- load nearest clusters first ----------
(async () => {
  const u0 = scrollU();
  const order = [...slots].sort((a, b) => Math.abs(a.cl.k - u0) - Math.abs(b.cl.k - u0));
  let i = 0;
  const worker = async () => { while (i < order.length) { const sl = order[i++]; try { place(sl, await loadModel(sl.name)); } catch (e) { console.warn(sl.name, e); } } };
  await Promise.all([worker(), worker(), worker()]);
  window.ready = true;
})();

// ---------- frame ----------
let u = scrollU(), covered = false;
const N = secs.length - 1;
const bar = document.getElementById('bar');
function resize() {
  const w = innerWidth, h = innerHeight;
  r.setPixelRatio(Math.min(devicePixelRatio, mobile() ? 1.25 : 1.5));
  r.setSize(w, h, false); cam.aspect = w / h; cam.fov = mobile() ? 38 : 30; cam.updateProjectionMatrix();
  buildPath(); measure(); dirty = true;
}
addEventListener('resize', resize); resize();
addEventListener('scroll', () => { dirty = true; }, {passive: true});
// skip rendering while an opaque block covers the viewport
const cover = new Set();
new IntersectionObserver(es => { for (const e of es) (e.intersectionRatio > .98 || (e.isIntersecting && e.boundingClientRect.top <= 0 && e.boundingClientRect.bottom >= innerHeight)) ? cover.add(e.target) : cover.delete(e.target); covered = cover.size > 0; dirty = true; },
  {threshold: [0, .5, .98, 1]}).observe(document.getElementById('ag'));

let lastE = -1;
const stats = window.__stats = {frames: 0, ms: 0};
function step(dt) {
  if (bar) bar.style.width = (scrollY / (document.documentElement.scrollHeight - innerHeight) * 100) + '%';
  const tu = scrollU();
  const k = RM ? 1 : 1 - Math.exp(-dt * 4.5);
  const moving = Math.abs(tu - u) > 1e-4;
  u += (tu - u) * k; if (!moving) u = tu;
  // scroll-scrubbed exploded view
  const sl = slots.find(x => x.cl.k === EXPL && x.j === 0);
  let e = Math.max(0, 1 - Math.abs(u - EXPL) * 1.25); e = RM ? (Math.round(u) === EXPL ? .7 : 0) : smooth(e);
  if (sl?.o && Math.abs(e - lastE) > 1e-4) { for (const P of sl.o.parts) P.o.position.copy(P.base).addScaledVector(P.off, e * 1.1); lastE = e; dirty = true; }
  if (!(dirty || moving) || covered) return false;
  const t = Math.min(1, Math.max(0, u / N));
  cam.position.copy(camCurve.getPoint(t)); const tg = tgtCurve.getPoint(t); cam.lookAt(tg); const dd = cam.position.distanceTo(tg); if (SHADOWS) { key.target.position.copy(tg); key.position.copy(tg).add(new THREE.Vector3(4, 9, 6)); const ext = Math.min(18, dd * .6 + 3); Object.assign(key.shadow.camera, {left: -ext, right: ext, top: ext, bottom: -ext}); key.shadow.camera.updateProjectionMatrix(); } s.fog.near = dd + 3; s.fog.far = dd * 2.2 + 14;
  const t0 = performance.now(); r.render(s, cam); stats.ms += performance.now() - t0; stats.frames++;
  stats.tris = r.info.render.triangles; stats.calls = r.info.render.calls;
  dirty = false; return true;
}
window.__frame = dt => step(dt);
if (!CAPTURE) {
  let last = performance.now();
  (function loop(now) { requestAnimationFrame(loop); const dt = Math.min(.1, (now - last) / 1000); last = now; if (!document.hidden) step(dt); })(last);
}
import('./agent.js').then(m => m.start(THREE, loadModel('so101')));
