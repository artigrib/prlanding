// Scroll-driven camera flythrough over a static showroom of robots grouped by category.
import * as THREE from 'three';
import {loadModel, mobile, SHADOWS} from './model.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const Q = new URLSearchParams(location.search);
const CAPTURE = Q.has('capture');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const G = await (await fetch('groups.json')).json();
const canvas = document.getElementById('c');

// captions inside the text cards
document.querySelectorAll('.t').forEach(sec => {
  const g = G[+sec.dataset.i], m = sec.querySelector('.meta');
  if (!g || !m) return;
  m.innerHTML = `<b>${g.models.map(x => x.name).join(' · ')}</b>` +
    (g.count ? `${g.key === 'mix' ? '' : 'Kategorie: '}${g.label} · ${g.count} projektů` : `${g.label} · ${g.models.length} modely`);
});

// ---------- renderer / scene ----------
const r = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
r.setClearColor(0xf4f4f1, 1);
r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0;
const s = new THREE.Scene();
s.fog = new THREE.Fog(0xf4f4f1, 9, 30);
s.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), .04).texture;
s.environmentIntensity = .38;
s.add(new THREE.HemisphereLight(0xffffff, 0xd9d9d3, .35));
const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(4, 9, 6); s.add(key, key.target);
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


// ---------- showroom layout ----------
const SCALE = .62, GAP = 1.45, STEP = 6, EXPL = 5;
const FAM = G.length - 1, FG = 1.05;
const clusters = G.map((g, k) => ({
  g, k, c: new THREE.Vector3(k * STEP, 0, k % 2 ? -1.6 : 1.6),
  w: (g.models.length - 1) * (k === FAM ? FG : GAP) + 1.3
}));
const slots = [];
clusters.forEach(cl => cl.g.models.forEach((m, j) => slots.push({
  cl, j, name: m.model, x: cl.c.x + (j - (cl.g.models.length - 1) / 2) * (cl.k === FAM ? FG : GAP), z: cl.c.z + (cl.k === FAM ? (j % 2 ? -.55 : .35) : 0)
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
    let D = (Math.max(4.4, cl.w * 1.1 + 2)) * (mob ? 1.5 : 1);
    let t = cl.c.clone().add(new THREE.Vector3(mob ? 0 : -(cl.w * .1 + .8), mob ? -.15 : .45, 0));
    if (mob && cl.k === FAM) D *= 1.25;
    if (mob && cl.k === EXPL) { const s0 = slots.find(x => x.cl === cl && x.j === 0); t = new THREE.Vector3(s0.x + .6, .3, s0.z); D = 7; }
    T.push(t); P.push(t.clone().add(new THREE.Vector3(Math.sin(yaw) * D, mob ? 1.9 : 1.35, Math.cos(yaw) * D)));
  });
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
  const worker = async () => { while (i < order.length) { const sl = order[i++]; try { place(sl, await loadModel(sl.name, sl.name === 'so101')); } catch (e) { console.warn(sl.name, e); } } };
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
new ResizeObserver(() => { measure(); dirty = true; }).observe(document.body);
addEventListener('scroll', () => { dirty = true; }, {passive: true});
// skip rendering while an opaque block covers the viewport
const cover = new Set();
new IntersectionObserver(es => { for (const e of es) (e.intersectionRatio > .98 || (e.isIntersecting && e.boundingClientRect.top <= 0 && e.boundingClientRect.bottom >= innerHeight)) ? cover.add(e.target) : cover.delete(e.target); const was = covered; covered = cover.size > 0; if (was && !covered) { measure(); u = scrollU(); } dirty = true; },
  {threshold: [0, .5, .98, 1]}).observe(document.getElementById('ag'));

let lastE = -1, forced = null;
// frame recorder hook (tools/seq/record.mjs): render the path at an exact thesis position u ∈ [0, N]
window.__at = uu => { forced = u = uu; dirty = true; covered = false; return step(0); };
const stats = window.__stats = {frames: 0, ms: 0};
function step(dt) {
  if (bar) bar.style.width = (scrollY / (document.documentElement.scrollHeight - innerHeight) * 100) + '%';
  const tu = forced ?? scrollU();
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
if (!CAPTURE) import('./agent.js').then(m => m.start(THREE, loadModel('so101')));
