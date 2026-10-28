// three.js visuals for the mission objects that app.js does not draw (second cube, ball, second bowl,
// goal, paper + star + ink for the drawing mission, the pen), plus studio lighting.
// Everything lives in app.world (MuJoCo coordinates, z up).

import { TRACE } from '../missions.js';

const INK_MAX = 5000;

export class Extras {
  constructor(ux) {
    const T = this.T = ux.T, app = this.app = ux.app;
    this.ux = ux; this.d = app.d; this.w = ux.world;
    const W = app.world;
    this.meshes = {};

    const box = new T.BoxGeometry(0.025, 0.025, 0.025);
    this.blueMat = new T.MeshStandardMaterial({ color: 0x1f3bff, roughness: 0.45 });
    this.meshes.cube_b = this.add(new T.Mesh(box, this.blueMat));
    const ballMat = new T.MeshPhysicalMaterial({ color: 0x232323, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15 });
    this.meshes.ball = this.add(new T.Mesh(new T.SphereGeometry(0.02, 32, 20), ballMat));

    // second bowl: same lathe as app.js, orange
    this.meshes.bowl2 = this.add(new T.Mesh(app.bowl.geometry, new T.MeshStandardMaterial({ color: 0xe8461e, roughness: 0.5, side: T.DoubleSide })));
    this.meshes.bowl = app.bowl;

    // goal: low U-shaped fence + tinted floor area
    const g = new T.Group();
    const fence = new T.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });
    const b1 = new T.Mesh(new T.BoxGeometry(0.008, 0.11, 0.02), fence); b1.position.set(0.045, 0, 0.01);
    const b2 = new T.Mesh(new T.BoxGeometry(0.09, 0.008, 0.02), fence); b2.position.set(0, 0.055, 0.01);
    const b3 = b2.clone(); b3.position.y = -0.055;
    const zone = new T.Mesh(new T.PlaneGeometry(0.09, 0.102), new T.MeshBasicMaterial({ color: 0x1f3bff, transparent: true, opacity: 0.12, depthWrite: false }));
    zone.position.set(0, 0, 0.0007);
    for (const m of [b1, b2, b3]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    g.add(zone);
    this.meshes.goal = this.add(g, false);

    // paper with the star (drawing mission)
    const paper = this.paper = new T.Group();
    const sheet = new T.Mesh(new T.PlaneGeometry(0.17, 0.17), new T.MeshStandardMaterial({ color: 0xfffdf6, roughness: 0.95 }));
    sheet.receiveShadow = true; sheet.position.set(0.215, 0, 0.0005);
    paper.add(sheet);
    paper.add(this.ribbon(TRACE.corners.map(([x, y]) => [x, y]), 0.0035, 0xcfcfca, 0.0008));
    W.add(paper); paper.visible = false;

    // ink ribbon (preallocated)
    const ip = this.inkPos = new Float32Array(INK_MAX * 18);
    const ig = this.inkGeo = new T.BufferGeometry();
    ig.setAttribute('position', new T.BufferAttribute(ip, 3).setUsage(T.DynamicDrawUsage));
    ig.setDrawRange(0, 0);
    this.ink = new T.Mesh(ig, new T.MeshBasicMaterial({ color: 0x1f3bff, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.ink.frustumCulled = false;
    W.add(this.ink);
    this.inkN = 0; this.lastInk = [0, 0, 0]; this.hasLast = false;

    // pen held in the gripper
    const pen = this.pen = new T.Group();
    const body = new T.Mesh(new T.CylinderGeometry(0.0055, 0.0055, 0.075, 20), new T.MeshStandardMaterial({ color: 0x1f3bff, roughness: 0.4 }));
    body.position.y = 0.045;
    const cone = new T.Mesh(new T.ConeGeometry(0.0055, 0.008, 20), new T.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }));
    cone.rotation.x = Math.PI; cone.position.y = 0.004;
    const tipm = new T.Mesh(new T.SphereGeometry(0.0015, 8, 6), new T.MeshBasicMaterial({ color: 0x1f3bff }));
    body.castShadow = true;
    pen.add(body, cone, tipm);
    pen.matrixAutoUpdate = false; pen.visible = false;
    W.add(pen);

    this.lighting();
  }

  add(obj, shadow = true) {
    obj.traverse((o) => { if (o.isMesh && shadow) { o.castShadow = true; o.receiveShadow = true; } });
    obj.visible = false;
    this.app.world.add(obj);
    return obj;
  }

  ribbon(pts, wd, color, z) {
    const T = this.T, pos = [];
    for (let i = 1; i < pts.length; i++) quad(pos, pts[i - 1], pts[i], wd, z);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    return new T.Mesh(g, new T.MeshBasicMaterial({ color, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
  }

  // soft studio environment: PMREM of a simple room with large light panels (no external HDR)
  lighting() {
    const T = this.T, r = this.app.renderer, s = this.app.scene;
    try {
      const room = new T.Scene();
      const wall = new T.MeshBasicMaterial({ color: 0x8c8c88, side: T.BackSide });
      room.add(new T.Mesh(new T.BoxGeometry(6, 4, 6), wall));
      const panel = (w, h, x, y, z, ry, rx, c) => {
        const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }));
        m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); room.add(m);
      };
      panel(3, 1.2, 0, 1.95, 0, 0, Math.PI / 2, 0xffffff);      // ceiling softbox
      panel(1.4, 1.8, -2.9, 1, 0.5, Math.PI / 2, 0, 0xf4f4f1);   // side softbox
      panel(1.2, 1.2, 1.5, 0.9, -2.9, 0, 0, 0xffe2d6);           // warm kicker (accent-ish)
      const pm = new T.PMREMGenerator(r);
      const env = pm.fromScene(room, 0.04).texture;
      s.environment = env;
      pm.dispose();
      // the env now carries part of the fill light
      s.traverse((o) => { if (o.isHemisphereLight) o.intensity = 0.9; });
      for (const [, mesh] of this.app.geoms) {
        const m = mesh.material;
        if (m && m.isMeshStandardMaterial) m.envMapIntensity = 0.55;
      }
      this.app.printed.roughness = 0.5;
    } catch (e) { /* plain lights are fine */ }
    // crisper shadows on desktop
    const phone = matchMedia('(max-width:860px)').matches;
    s.traverse((o) => {
      if (o.isDirectionalLight && o.castShadow) { o.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048); o.shadow.radius = 3; }
    });
  }

  /** After a mission layout: visibility, mocap meshes, paper. */
  onLayout(mission) {
    for (const [name, mesh] of Object.entries(this.meshes)) {
      const e = this.w.o[name];
      mesh.visible = !!e.active;
      if (e.kind === 'mocap' && e.active) {
        const b = e.body, x = this.d.xpos, q = this.d.xquat;
        mesh.position.set(x[3 * b], x[3 * b + 1], x[3 * b + 2]);
        mesh.quaternion.set(q[4 * b + 1], q[4 * b + 2], q[4 * b + 3], q[4 * b]);
      }
    }
    // app.js's cube mesh: hide when the mission does not use it
    if (this.ux.cubeMesh) this.ux.cubeMesh.visible = !!this.w.o.cube.active;
    this.paper.visible = !!mission.pen;
    this.pen.visible = !!mission.pen;
    this.clearInk();
  }

  /** Hide / show the mission objects (exploded view). */
  setObjectsVisible(on) {
    if (!on) { this.hiddenSet = []; for (const m of [...Object.values(this.meshes), this.ux.cubeMesh, this.paper, this.pen, this.ink]) if (m && m.visible) { m.visible = false; this.hiddenSet.push(m); } }
    else if (this.hiddenSet) { for (const m of this.hiddenSet) m.visible = true; this.hiddenSet = null; }
  }

  clearInk() { this.inkN = 0; this.hasLast = false; this.inkGeo.setDrawRange(0, 0); }

  sync() {
    const x = this.d.xpos, q = this.d.xquat;
    for (const name of ['cube_b', 'ball']) {
      const mesh = this.meshes[name]; if (!mesh.visible) continue;
      const b = this.w.o[name].body;
      mesh.position.set(x[3 * b], x[3 * b + 1], x[3 * b + 2]);
      mesh.quaternion.set(q[4 * b + 1], q[4 * b + 2], q[4 * b + 3], q[4 * b]);
    }
    if (this.pen.visible) this.syncPen();
  }

  syncPen() {
    const s = 3 * this.app.gripSite, r = 9 * this.app.gripSite, P = this.d.site_xpos, M = this.d.site_xmat;
    // pen y axis = -approach (site x axis), tip at the site
    const ax = -M[r], ay = -M[r + 3], az = -M[r + 6];
    const zx = M[r + 2], zy = M[r + 5], zz = M[r + 8];     // site z axis
    const xx = ay * zz - az * zy, xy = az * zx - ax * zz, xz = ax * zy - ay * zx; // y cross z
    const e = this.pen.matrix.elements;
    e[0] = xx; e[1] = xy; e[2] = xz; e[3] = 0;
    e[4] = ax; e[5] = ay; e[6] = az; e[7] = 0;
    e[8] = zx; e[9] = zy; e[10] = zz; e[11] = 0;
    e[12] = P[s]; e[13] = P[s + 1]; e[14] = P[s + 2]; e[15] = 1;
    this.pen.matrixWorldNeedsUpdate = true;
  }

  /** Add ink where the pen touches the paper (called from the mission tick). */
  inkAt(t) {
    if (!this.pen.visible) return;
    if (t[2] >= TRACE.penDown) { this.hasLast = false; return; }
    const L = this.lastInk;
    if (!this.hasLast) { L[0] = t[0]; L[1] = t[1]; this.hasLast = true; return; }
    if (Math.hypot(t[0] - L[0], t[1] - L[1]) < 0.0015 || this.inkN >= INK_MAX) return;
    writeQuad(this.inkPos, this.inkN * 18, L, t, 0.0028, 0.0012);
    this.inkN++;
    L[0] = t[0]; L[1] = t[1];
    const a = this.inkGeo.attributes.position;
    a.needsUpdate = true;
    this.inkGeo.setDrawRange(0, this.inkN * 6);
  }
}

function quad(out, a, b, w, z) {
  const tmp = new Array(18); writeQuad(tmp, 0, a, b, w, z); for (const v of tmp) out.push(v);
}
const QV = new Float64Array(8), QI = [0, 1, 2, 2, 1, 3];   // two triangles: 0 1 2, 2 1 3
function writeQuad(o, k, a, b, w, z) {
  let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx *= w / 2 / l; ny *= w / 2 / l;
  // extend a little along the segment so consecutive quads overlap at corners
  const ex = (b[0] - a[0]) / l * w * 0.5, ey = (b[1] - a[1]) / l * w * 0.5;
  const ax = a[0] - ex, ay = a[1] - ey, bx = b[0] + ex, by = b[1] + ey;
  const v = QV;
  v[0] = ax + nx; v[1] = ay + ny; v[2] = ax - nx; v[3] = ay - ny; v[4] = bx + nx; v[5] = by + ny; v[6] = bx - nx; v[7] = by - ny;
  const idx = QI;
  for (let i = 0; i < 6; i++) { o[k + 3 * i] = v[2 * idx[i]]; o[k + 3 * i + 1] = v[2 * idx[i] + 1]; o[k + 3 * i + 2] = z; }
}
