// three.js visuals of the object missions: printed-style fixtures (from their MJCF boxes / cylinders) and the
// library objects. Each object shows its collision hull at once (light grey) and swaps to the textured GLB when
// that has loaded – GLBs are fetched per mission, only for the objects the mission uses (~0.1–0.3 MB each).
// Everything lives in app.world (MuJoCo frame, z up).

const G = { BOX: 6, CYLINDER: 5, MESH: 7 };

export class ObjectView {
  constructor(ux, objects) {
    const T = this.T = ux.T, app = ux.app, m = this.m = app.m;
    this.ux = ux; this.d = app.d; this.w = ux.world; this.lib = objects.lib;
    this.items = new Map(objects.items.map((it) => [it.name, it]));
    this.groups = {};
    this.mats = new Map();
    const parent = app.world;
    for (const [name, e] of Object.entries(this.w.o)) {
      if (!e.lib && !e.fixture) continue;
      const g = new T.Group(); g.userData.pick = name; g.visible = false;
      for (let k = m.body_geomadr[e.body], n = k + m.body_geomnum[e.body]; k < n; k++) {
        const mesh = this.geomMesh(k, !!e.lib);
        if (mesh) g.add(mesh);
      }
      if (e.lib) g.userData.proxy = g.children.slice();
      parent.add(g);
      this.groups[name] = g;
      ux.extras.meshes[name] = g;          // visibility + mocap pose follow the mission layout (Extras.onLayout)
    }
    this.loading = new Map();
  }

  mat(rgba, lib) {
    const key = lib ? 'proxy' : rgba.join(',');
    if (!this.mats.has(key)) {
      const T = this.T, c = new T.Color().setRGB(rgba[0], rgba[1], rgba[2], T.SRGBColorSpace);
      this.mats.set(key, lib ? new T.MeshStandardMaterial({ color: 0xd8d5ce, roughness: 0.7, transparent: true, opacity: 0.85 })
        : new T.MeshStandardMaterial({ color: c, roughness: 0.62, metalness: 0 }));   // matte, like PLA
    }
    return this.mats.get(key);
  }

  geomMesh(k, lib) {
    const T = this.T, m = this.m, type = m.geom_type[k], s = m.geom_size;
    if (!lib && m.geom_group[k] !== 3) return null;
    let geo;
    if (type === G.BOX) geo = new T.BoxGeometry(2 * s[3 * k], 2 * s[3 * k + 1], 2 * s[3 * k + 2]);
    else if (type === G.CYLINDER) { geo = new T.CylinderGeometry(s[3 * k], s[3 * k], 2 * s[3 * k + 1], 48); geo.rotateX(Math.PI / 2); }
    else if (type === G.MESH && lib) {
      const id = m.geom_dataid[k], va = m.mesh_vertadr[id], vn = m.mesh_vertnum[id], fa = m.mesh_faceadr[id], fn = m.mesh_facenum[id];
      geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(Float32Array.from(m.mesh_vert.subarray(3 * va, 3 * (va + vn))), 3));
      geo.setIndex(Array.from(m.mesh_face.subarray(3 * fa, 3 * (fa + fn))));
      geo = geo.toNonIndexed(); geo.computeVertexNormals();
    } else return null;
    const rgba = [m.geom_rgba[4 * k], m.geom_rgba[4 * k + 1], m.geom_rgba[4 * k + 2]];
    const mesh = new T.Mesh(geo, this.mat(rgba, lib));
    const p = m.geom_pos, q = m.geom_quat;
    mesh.position.set(p[3 * k], p[3 * k + 1], p[3 * k + 2]);
    mesh.quaternion.set(q[4 * k + 1], q[4 * k + 2], q[4 * k + 3], q[4 * k]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  /** After a mission layout: place the objects, start loading the GLBs the mission shows. */
  onLayout(mission) {
    this.sync(true);
    for (const name of Object.keys(mission.layout || {})) if (this.w.o[name] && this.w.o[name].lib) this.loadGlb(name);
  }

  async loader() {
    if (!this._loader) {
      this._loader = Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')])
        .then(([GL, MD]) => new GL.GLTFLoader().setMeshoptDecoder(MD.MeshoptDecoder));
    }
    return this._loader;
  }

  loadGlb(name) {
    if (this.loading.has(name)) return this.loading.get(name);
    const it = this.items.get(name), g = this.groups[name];
    const job = (async () => {
      const vis = await this.lib.glb(it.id, await this.loader());
      vis.rotation.x = Math.PI / 2;               // glTF Y-up -> MuJoCo Z-up (same as ObjectLibrary.attach)
      if (it.scale !== 1) vis.scale.setScalar(it.scale);
      vis.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      for (const p of g.userData.proxy) p.visible = false;
      g.add(vis);
      g.userData.glb = true;
    })().catch((e) => { console.warn('object GLB', it.id, e); });   // the hull proxy stays: still playable
    this.loading.set(name, job);
    return job;
  }

  /** Follow the physics (free objects; fixtures are placed by Extras.onLayout). */
  sync(all) {
    const x = this.d.xpos, q = this.d.xquat;
    for (const [name, g] of Object.entries(this.groups)) {
      const e = this.w.o[name];
      if (!g.visible && !all) continue;
      if (e.fixture && !all) continue;
      const b = e.body;
      g.position.set(x[3 * b], x[3 * b + 1], x[3 * b + 2]);
      g.quaternion.set(q[4 * b + 1], q[4 * b + 2], q[4 * b + 3], q[4 * b]);
    }
  }

  /** Test hook: are the GLBs of the active objects in place? */
  ready() { return Object.entries(this.groups).every(([n, g]) => !g.visible || !this.w.o[n].lib || g.userData.glb); }
}
