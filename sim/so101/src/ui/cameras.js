// Camera presets (orbit / top / side), wrist camera picture-in-picture and the cinematic orbit on success.

const VIEWS = {
  // three.js coordinates: (x, z_mj, -y_mj). target, position for wide and narrow screens
  orbit: null,  // = app.resetView()
  top: { t: [0.15, 0.0, -0.01], p: [0.1501, 0.86, -0.0101], pn: [0.1501, 1.02, -0.0101] },
  side: { t: [0.15, 0.06, 0.0], p: [0.16, 0.16, -0.78], pn: [0.16, 0.2, -0.95] },
  front: { t: [0.14, 0.06, 0.0], p: [0.85, 0.22, 0.0], pn: [1.0, 0.3, 0.0] }
};
export const VIEW_LABELS = { orbit: 'Volný pohled', top: 'Shora', side: 'Z boku', front: 'Zepředu', arm: 'Ruka' };

export class Cameras {
  constructor(ux) {
    const T = this.T = ux.T, app = this.app = ux.app;
    this.ux = ux;
    this.view = 'orbit';
    this.tw = null;
    this.from = { p: new T.Vector3(), t: new T.Vector3() };
    this.to = { p: new T.Vector3(), t: new T.Vector3() };
    this.wrist = new T.PerspectiveCamera(70, 4 / 3, 0.005, 5);
    this.wristOn = false;
    this.cam = app.d.cam_xpos ? 0 : -1;
    this.m3 = new T.Matrix4(); this.size = new T.Vector2();
    this.cine = 0;
    app.controls.addEventListener('start', () => { this.stopCinematic(); this.tw = null; });
    // the wrist camera mount: draw it while the wrist camera is on (it is hidden by app.js otherwise)
    this.mountMeshes = [];
    const m = app.m;
    for (let g = 0; g < m.ngeom; g++) {
      if (m.geom_bodyid[g] !== app.camBody || m.geom_group[g] > 2) continue;
      const mesh = this.mountMesh(g); if (mesh) this.mountMeshes.push([g, mesh]);
    }
  }

  mountMesh(g) {
    const T = this.T, m = this.app.m;
    if (m.geom_type[g] !== 7) return null;
    const id = m.geom_dataid[g];
    const pos = m.mesh_vert.subarray(3 * m.mesh_vertadr[id], 3 * (m.mesh_vertadr[id] + m.mesh_vertnum[id]));
    const idx = m.mesh_face.subarray(3 * m.mesh_faceadr[id], 3 * (m.mesh_faceadr[id] + m.mesh_facenum[id]));
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setIndex(Array.from(idx)); geo.computeVertexNormals();
    const mesh = new T.Mesh(geo, this.app.printed);
    mesh.matrixAutoUpdate = false; mesh.castShadow = true; mesh.visible = false;
    this.app.world.add(mesh);
    return mesh;
  }

  set(view) {
    const app = this.app;
    this.view = view;
    this.stopCinematic();
    const c = app.controls, cam = app.camera;
    this.from.p.copy(cam.position); this.from.t.copy(c.target);
    if (view === 'orbit') {
      app.resetView();
      this.to.p.copy(cam.position); this.to.t.copy(c.target);
    } else {
      const v = VIEWS[view], narrow = matchMedia('(max-width:860px)').matches;
      const p = narrow ? v.pn : v.p;
      this.to.p.set(p[0], p[1], p[2]); this.to.t.set(v.t[0], v.t[1], v.t[2]);
    }
    if (this.ux.reduced) { cam.position.copy(this.to.p); c.target.copy(this.to.t); c.update(); this.tw = null; return; }
    cam.position.copy(this.from.p); c.target.copy(this.from.t);
    this.tw = { t: 0 };
  }

  /** Frame the arm (exploded view). */
  frameArm() {
    VIEWS.arm = { t: [0.06, 0.13, 0.0], p: [0.42, 0.3, -0.36], pn: [0.5, 0.36, -0.48] };
    this.set('arm');
  }

  cycle() {
    const order = ['orbit', 'top', 'side', 'front'];
    this.set(order[(Math.max(0, order.indexOf(this.view)) + 1) % order.length]);
    return this.view;
  }

  setWrist(on) {
    this.wristOn = on;
    for (const [, mesh] of this.mountMeshes) mesh.visible = on;
  }

  cinematic() {
    if (this.ux.reduced) return;
    const c = this.app.controls;
    c.autoRotate = true; c.autoRotateSpeed = 2.2; this.cine = 7;
  }
  stopCinematic() { this.app.controls.autoRotate = false; this.cine = 0; }

  tick(dt) {
    if (this.tw) {
      const k = this.tw.t = Math.min(1, this.tw.t + dt / 0.7), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const cam = this.app.camera, c = this.app.controls;
      cam.position.lerpVectors(this.from.p, this.to.p, e);
      c.target.lerpVectors(this.from.t, this.to.t, e);
      if (k >= 1) this.tw = null;
    }
    if (this.cine > 0) { this.cine -= dt; if (this.cine <= 0) this.stopCinematic(); }
    if (this.wristOn) {
      // wrist camera pose from MuJoCo (camera looks along -z, y up: same convention as three.js)
      const d = this.app.d, p = d.cam_xpos, M = d.cam_xmat, e = this.m3.elements;
      e[0] = M[0]; e[4] = M[1]; e[8] = M[2]; e[12] = p[0];
      e[1] = M[3]; e[5] = M[4]; e[9] = M[5]; e[13] = p[1];
      e[2] = M[6]; e[6] = M[7]; e[10] = M[8]; e[14] = p[2];
      e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
      this.app.world.updateMatrixWorld();
      this.wrist.matrixWorld.multiplyMatrices(this.app.world.matrixWorld, this.m3);
      this.wrist.matrixWorld.decompose(this.wrist.position, this.wrist.quaternion, this.wrist.scale);
      this.wrist.updateMatrixWorld(true);
      for (const [g, mesh] of this.mountMeshes) {
        const xp = d.geom_xpos, xm = d.geom_xmat, q = 3 * g, r = 9 * g, el = mesh.matrix.elements;
        el[0] = xm[r]; el[4] = xm[r + 1]; el[8] = xm[r + 2]; el[12] = xp[q];
        el[1] = xm[r + 3]; el[5] = xm[r + 4]; el[9] = xm[r + 5]; el[13] = xp[q + 1];
        el[2] = xm[r + 6]; el[6] = xm[r + 7]; el[10] = xm[r + 8]; el[14] = xp[q + 2];
        el[3] = 0; el[7] = 0; el[11] = 0; el[15] = 1; mesh.matrixWorldNeedsUpdate = true;
      }
    }
  }

  /** Draw the frame: main view, then the wrist camera into a corner (scissor). */
  render() {
    const r = this.app.renderer, s = this.app.scene;
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true;
    r.render(s, this.app.camera);
    if (!this.wristOn) return;
    const rect = this.ux.panel.pipRect();   // CSS px within the canvas
    if (!rect) return;
    r.getSize(this.size);
    const y = this.size.y - rect.y - rect.h;
    r.setScissorTest(true);
    r.setScissor(rect.x, y, rect.w, rect.h); r.setViewport(rect.x, y, rect.w, rect.h);
    this.wrist.aspect = rect.w / rect.h; this.wrist.updateProjectionMatrix();
    const g = this.ux.gizmo; const vis = g.root.visible, gv = g.ghost.visible;
    g.root.visible = false; g.ghost.visible = false; g.drop.visible = false; g.foot.visible = false;  // real scene only
    r.setClearColor(0xf4f4f1, 1); r.clear();
    r.render(s, this.wrist);
    r.setClearColor(0x000000, 0);
    g.root.visible = vis; g.ghost.visible = gv; g.drop.visible = vis; g.foot.visible = vis;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.x, this.size.y);
  }
}
