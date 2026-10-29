// Interactive 3D viewer: orbit, exploded view, assembly animation, live colour.
// Loaded on demand from app.js (dynamic import), three.js from jsDelivr via the import map.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountViewer(host, url, opts) {
  opts = opts || {};
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // r186: PCFShadowMap is the soft filter (PCFSoftShadowMap was removed)
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', opts.label || '3D model');
  renderer.domElement.setAttribute('role', 'img');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#EEEEEB');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(-2, 4, 3); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 6;
  scene.add(key, new THREE.HemisphereLight(0xffffff, 0xd8d8d2, 0.6));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.12 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const camera = new THREE.PerspectiveCamera(32, 4 / 3, 0.01, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  // let vertical swipes scroll the page on touch screens; horizontal drag still rotates
  renderer.domElement.style.touchAction = 'pan-y';
  controls.enableDamping = true; controls.enablePan = false;
  controls.autoRotate = !reduce; controls.autoRotateSpeed = 1.2;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  let parts = [], printMats = [], explode = 0, anim = null, disposed = false, ready = false;

  function resize() {
    const w = host.clientWidth, h = host.clientHeight || w * 0.75;
    renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  let zoomBase = null;
  controls.addEventListener('start', () => { zoomBase = null; });
  function applyExplode(t) {
    // dolly out while parts spread so the exploded view stays in frame
    const off = camera.position.clone().sub(controls.target), d = off.length();
    if (zoomBase == null) zoomBase = d / (1 + 0.45 * explode);
    camera.position.copy(controls.target).add(off.setLength(zoomBase * (1 + 0.45 * t)));
    explode = t;
    parts.forEach(p => { p.mesh.position.lerpVectors(p.home, p.away, t); });
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(url, gltf => {
    if (disposed) return;
    const root = gltf.scene;
    // rigged arena models carry every swappable module as opt_<slot>_<option>: show only the ones asked for
    const drop = [];
    root.traverse(o => { if (/^opt_/.test(o.name || '') && !(opts.show || []).includes(o.name)) drop.push(o); });
    drop.forEach(o => o.parent && o.parent.remove(o));
    scene.add(root);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const radius = size.length() / 2;
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => { if (m.name === 'print' && !printMats.includes(m)) printMats.push(m); });
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      const dir = c.clone().sub(center);
      dir.y = dir.y * 1.3 + size.y * 0.08;
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
      const worldAway = c.clone().add(dir.normalize().multiplyScalar(radius * (0.22 + 0.38 * Math.min(1, c.distanceTo(center) / radius))));
      const worldHome = o.getWorldPosition(new THREE.Vector3());
      const awayLocal = o.parent.worldToLocal(worldHome.clone().add(worldAway.sub(c)));
      parts.push({ mesh: o, home: o.position.clone(), away: awayLocal, cy: c.y });
    });
    // assembly order: bottom → top
    const sorted = parts.slice().sort((a, b) => a.cy - b.cy);
    sorted.forEach((p, i) => { p.order = i / Math.max(1, sorted.length - 1); });
    ground.position.y = box.min.y;
    controls.target.copy(center);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
    camera.position.set(center.x - dist * 0.55, center.y + dist * 0.28, center.z + dist * 0.79);
    controls.minDistance = radius * 1.2; controls.maxDistance = dist * 3;
    camera.near = radius / 50; camera.far = dist * 10; camera.updateProjectionMatrix();
    if (opts.color) setColor(opts.color);
    ready = true;
    opts.onReady && opts.onReady(parts.length);
  }, undefined, err => { opts.onError && opts.onError(err); });

  function tick(now) {
    if (disposed) return;
    if (anim) {
      const t = Math.min(1, (now - anim.start) / anim.dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      if (anim.kind === 'assemble') {
        // parts fly in one after another, bottom first
        parts.forEach(p => {
          const k = Math.min(1, Math.max(0, (t * 1.35 - p.order) / 0.35));
          const ke = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          p.mesh.position.lerpVectors(p.away, p.home, ke);
        });
        const off = camera.position.clone().sub(controls.target);
        if (zoomBase == null) zoomBase = off.length() / (1 + 0.45 * explode);
        explode = 1 - e;
        camera.position.copy(controls.target).add(off.setLength(zoomBase * (1 + 0.45 * explode)));
      } else {
        applyExplode(anim.from + (anim.to - anim.from) * e);
      }
      if (t >= 1) { const done = anim.done; anim = null; done && done(); }
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function setColor(hex) { printMats.forEach(m => { m.color.set(hex); }); }

  return {
    get ready() { return ready; },
    get explode() { return explode; },
    setExplode(t) { anim = null; applyExplode(t); },
    animateTo(to, done) {
      if (!ready) return;
      if (reduce) { applyExplode(to); done && done(); return; }
      anim = { kind: 'tween', from: explode, to, start: performance.now(), dur: 900, done };
    },
    assemble(done) {
      if (!ready) return;
      if (reduce) { applyExplode(0); done && done(); return; }
      applyExplode(1);
      anim = { kind: 'assemble', start: performance.now(), dur: 3200, done };
    },
    setColor,
    dispose() { disposed = true; ro.disconnect(); controls.dispose(); renderer.dispose(); pmrem.dispose(); renderer.domElement.remove(); }
  };
}
