// High-detail visuals: after the sim is running, load model/visual/so101_visual.glb (original Menagerie STLs,
// meshopt + quantized) and swap it in for the decimated physics meshes. Physics keeps the .msh files.
// Quality: 'high' | 'low' (localStorage), default high on desktops, low on small-memory phones / Save-Data.

import { store } from './store.js';

export function defaultQuality(touch) {
  try {
    const c = navigator.connection;
    if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return 'low';
    const mem = navigator.deviceMemory;
    if (touch && mem && mem < 6) return 'low';
  } catch (e) { /* ignore */ }
  return 'high';
}

export class HiDetail {
  constructor(ux) {
    this.ux = ux; this.app = ux.app; this.T = ux.T;
    const forced = new URLSearchParams(location.search).get('detail');   // ?detail=low|high (tests, support)
    this.quality = forced === 'low' || forced === 'high' ? forced : store.get('quality', null) || defaultQuality(ux.touch);
    this.loaded = false; this.loading = null;
    this.lo = new Map(); this.hi = new Map();   // mesh id -> geometry
    for (const [g, mesh] of this.app.geoms) if (this.app.m.geom_type[g] === 7) this.lo.set(this.app.m.geom_dataid[g], mesh.geometry);
  }

  set(q) {
    this.quality = q; store.set('quality', q);
    if (q === 'high') return this.load().then(() => this.apply());
    this.apply(); return Promise.resolve();
  }

  start() { if (this.quality === 'high') this.load().then(() => this.apply()).catch((e) => console.warn('hi-detail', e)); }

  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('../../vendor/three/loaders/GLTFLoader.js'),
        import('../../vendor/three/libs/meshopt_decoder.module.js')
      ]);
      await MeshoptDecoder.ready;
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(new URL('../../model/visual/so101_visual.glb', import.meta.url).href);
      const { mj, m } = { mj: this.ux.mj, m: this.app.m };
      const T = this.T, M = new T.Matrix4(), Q = new T.Quaternion(), P = new T.Vector3(), one = new T.Vector3(1, 1, 1);
      const meshes = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const o of meshes) {
        const id = mj.mj_name2id(m, mj.mjtObj.mjOBJ_MESH.value, o.name);
        if (id < 0) continue;
        // raw STL coordinates -> MuJoCo's processed mesh frame: v = R(mesh_quat)^T (raw - mesh_pos)
        const q = m.mesh_quat.subarray(4 * id, 4 * id + 4), p = m.mesh_pos.subarray(3 * id, 3 * id + 3);
        Q.set(q[1], q[2], q[3], q[0]).invert();
        P.set(-p[0], -p[1], -p[2]).applyQuaternion(Q);
        M.compose(P, Q, one).multiply(o.matrixWorld);     // node matrix undoes the quantization
        // dequantize to float (the attribute may be normalized int16) and transform
        const a = o.geometry.attributes.position, n = a.count, f = new Float32Array(3 * n), e = M.elements;
        for (let i = 0; i < n; i++) {
          const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
          f[3 * i] = e[0] * x + e[4] * y + e[8] * z + e[12];
          f[3 * i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          f[3 * i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        }
        this.hi.set(id, creased(T, f, o.geometry.index.array, 0.6));
        o.geometry.dispose();
        await new Promise((r) => setTimeout(r, 0));      // keep frames flowing between parts
      }
      this.loaded = true;
    })();
    return this.loading;
  }

  apply() {
    const use = this.quality === 'high' && this.loaded ? this.hi : this.lo;
    const m = this.app.m;
    const swap = (g, mesh) => { const geo = use.get(m.geom_dataid[g]); if (geo) mesh.geometry = geo; };
    for (const [g, mesh] of this.app.geoms) if (m.geom_type[g] === 7) swap(g, mesh);
    for (const gh of this.ux.gizmo.ghosts) if (m.geom_type[gh.g] === 7) swap(gh.g, gh.mesh);
    for (const [g, mesh] of this.ux.cameras.mountMeshes) swap(g, mesh);
    this.ux.hiDetail = use === this.hi;
    if (this.ux.panel) this.ux.panel.showQuality(this.quality, this.ux.hiDetail);
  }
}

// Same normal smoothing as app.js (creasedGeometry), for indexed input.
function creased(T, pos, idx, crease) {
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
  bg.computeBoundingSphere();
  return bg;
}
