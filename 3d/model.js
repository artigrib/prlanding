// Shared GLB loader + hard-surface pass (crease normals, feature edges) for /3d/.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
export const mobile = () => innerWidth < 700;
export const SHADOWS = !mobile();
// ---------- models ----------
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = {};
const CREASE = 30 * Math.PI / 180, geoCache = new Map(), edgeMat = new THREE.LineBasicMaterial({color: 0x1a1a1a, transparent: true, opacity: .22});
// hard-surface pass (crease normals + feature edges) runs in a small worker pool, off the main thread;
// computed once per source geometry, shared between meshes, original disposed
const pool = Array.from({length: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1))}, () => new Worker(new URL('./crease-worker.js', import.meta.url)));
const pend = new Map(); let jid = 0, rr = 0;
pool.forEach(w => w.onmessage = ({data}) => { pend.get(data.id)(data); pend.delete(data.id); });
function crisp(g) {
  if (geoCache.has(g)) return geoCache.get(g);
  const pa = g.attributes.position, pos = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) { pos[i*3] = pa.getX(i); pos[i*3+1] = pa.getY(i); pos[i*3+2] = pa.getZ(i); }
  const idx = g.index ? Uint32Array.from(g.index.array) : null, id = jid++;
  const pr = new Promise(res => { pend.set(id, res); pool[rr++ % pool.length].postMessage({id, pos, idx, crease: Math.cos(CREASE), edge: mobile() ? null : Math.cos(35 * Math.PI / 180)}, [pos.buffer].concat(idx ? [idx.buffer] : [])); })
    .then(({p, n, ix, E}) => {
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(p, 3)); out.setAttribute('normal', new THREE.BufferAttribute(n, 3)); out.setIndex(new THREE.BufferAttribute(ix, 1));
      out.groups = g.groups; out.userData.edges = E; g.dispose(); return out;
    }).catch(() => g);
  geoCache.set(g, pr); return pr;
}
async function prep(gl) {
  const root = new THREE.Group(), m = gl.scene; root.add(m);
  const b = new THREE.Box3().setFromObject(m), sph = b.getBoundingSphere(new THREE.Sphere()), k = 1 / sph.radius;
  m.scale.multiplyScalar(k); m.position.sub(sph.center).multiplyScalar(k); m.updateMatrixWorld(true);
  let mi = 0; const meshes = [];
  m.traverse(o => { if (o.isMesh) meshes.push(o); });
  await Promise.all(meshes.map(async o => { o.geometry = await crisp(o.geometry); o.castShadow = SHADOWS; }));
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
    root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert(), v = new THREE.Vector3(), M = new THREE.Matrix4();
    let len = 0; for (const o of meshes) len += o.geometry.userData.edges?.length || 0;
    const out = new Float32Array(len); let k = 0;
    for (const o of meshes) {
      const E = o.geometry.userData.edges; if (!E) continue; M.multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < E.length; i += 3) { v.set(E[i], E[i+1], E[i+2]).applyMatrix4(M); out[k++] = v.x; out[k++] = v.y; out[k++] = v.z; }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    root.add(root.userData.e = new THREE.LineSegments(g, edgeMat));
  };
  return {root, parts};
}
// desktop gets full-detail CAD conversions (models/hd, tools/robots-cad/hd.sh)
const HD = new Set(['lizard', 'orca', 'so102']);
export const loadModel = (name, own) => own ? loader.loadAsync(`../models/${name}.glb`).then(prep) : cache[name] ??= (hd => loader.loadAsync(`../models/${hd ? 'hd/' : ''}${name}.glb`).then(prep))(!mobile() && HD.has(name));
window.loadModel = loadModel;
