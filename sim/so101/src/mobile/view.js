// three.js visuals of the mobile scene (src/mobile/scene.js): the floor, the two labs, the cart and its LeKiwi base.
// core.js build() already draws the arm and the chassis geoms with a colour (tray, vial rack, crate) and moves them
// every frame. This adds what MuJoCo does not need:
// - the static rooms: walls one mesh each, bench tops and legs merged into one mesh per material. A wall between the
//   camera and the cart (and the middle wall, from either lab) is drawn cut down to bench height (0.76 m), so both
//   labs stay readable over it and the door gap stays visible (campaign PR 2; PR 1 faded it). The front camera view
//   never cuts walls: a real camera cannot see through them;
// - the cart frame: corner posts and the two lower shelves (schematic: the tier spacing is not published), the two
//   LeKiwi plates and 3 procedural omni wheels (hub + 2 × 6 rollers, sizes measured from the LeKiwi wheel STL) that
//   spin at the wheel speeds the LeRobot matrix gives for the chassis's measured velocity (scene.js wheelSpeeds);
// - a schematic head post with the front camera box (front_cam in scene.js, where XLeRobot mounts its head camera);
// - room labels; the sun's shadow camera follows the cart;
// - the camera views (src/mobile/camera.js).
// Everything lives in app.world (MuJoCo frame, z up).

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CART, LEKIWI, MAP, FRONT_CAM, wheelSpeeds, wheelPose } from './scene.js';
import { CameraRig } from './camera.js';

const t = (s) => (globalThis.PRI18N ? globalThis.PRI18N.t(s) : s);
const LABEL = { A: 'Laboratoř A · Příjem vzorků', B: 'Laboratoř B · Analytika' };
const CUT_H = MAP.bench.top;   // cutaway walls end at bench height: bench tops, racks and the cart show over them

export class MobileView {
  constructor(sim, THREE, opts = {}) {
    const T = this.T = THREE, m = this.m = sim.m, mj = sim.mj;
    this.sim = sim; this.d = sim.d;
    const id = (type, n) => mj.mj_name2id(m, mj.mjtObj[type].value, n);
    this.chassis = id('mjOBJ_BODY', 'chassis');
    const ja = (n) => m.jnt_qposadr[id('mjOBJ_JOINT', n)], jv = (n) => m.jnt_dofadr[id('mjOBJ_JOINT', n)];
    this.qa = ['base_x', 'base_y', 'base_yaw'].map(ja); this.va = ['base_x', 'base_y', 'base_yaw'].map(jv);
    this.root = new T.Group(); sim.world.add(this.root);
    // the legacy mission objects wait off the map (scene.js LEGACY): not drawn
    for (const [g, mesh] of sim.geoms) if (m.geom_bodyid[g] === sim.cubeBody) mesh.visible = false;
    if (sim.bowl) sim.bowl.visible = false;
    this.mats = new Map();
    this.floor();
    this.rooms(mj);
    this.cart();
    this.labels();
    this.camera(opts);
    this.w = [0, 0, 0]; this.spin = [0, 0, 0];
    this.update(0);
  }

  mat(hex, extra) {
    const key = hex + (extra ? JSON.stringify(extra) : '');
    if (!this.mats.has(key)) this.mats.set(key, new this.T.MeshStandardMaterial({ color: hex, roughness: 0.75, metalness: 0, ...extra }));
    return this.mats.get(key);
  }
  rgbaHex(g) {
    const r = this.m.geom_rgba, c = new this.T.Color().setRGB(r[4 * g], r[4 * g + 1], r[4 * g + 2], this.T.SRGBColorSpace);
    return c.getHex();
  }

  floor() {
    const T = this.T, M = MAP, w = 2 * (M.room[0] + M.wall) + M.wall, h = M.room[1] + 2 * M.wall;
    const f = new T.Mesh(new T.PlaneGeometry(w, h), this.mat(0xe7e6e1, { roughness: 0.9 }));
    f.receiveShadow = true; this.root.add(f);
    // floor tiles: 0.5 m grid lines just above the floor (level design, not a measured floor)
    const pts = [], z = 0.0005, hx = M.room[0] + M.wall / 2, hy = M.room[1] / 2;
    for (let x = -hx; x <= hx + 1e-9; x += 0.5) pts.push(x, -hy, z, x, hy, z);
    for (let y = -hy; y <= hy + 1e-9; y += 0.5) pts.push(-hx, y, z, hx, y, z);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    this.root.add(new T.LineSegments(g, new T.LineBasicMaterial({ color: 0xd2d1cb })));
  }

  /** Walls: one mesh each (fadeable); bench tops and legs: merged per material. */
  rooms(mj) {
    const T = this.T, m = this.m, size = m.geom_size, pos = m.geom_pos, merged = new Map();
    this.walls = [];
    for (let g = 0; g < m.ngeom; g++) {
      if (m.geom_bodyid[g] !== 0 || m.geom_type[g] !== 6) continue;     // static world boxes
      const name = mj.mj_id2name(m, mj.mjtObj.mjOBJ_GEOM.value, g) || '';
      const s = [size[3 * g], size[3 * g + 1], size[3 * g + 2]], p = [pos[3 * g], pos[3 * g + 1], pos[3 * g + 2]];
      const geo = new T.BoxGeometry(2 * s[0], 2 * s[1], 2 * s[2]); geo.translate(p[0], p[1], p[2]);
      if (/^(wall_|door_)/.test(name)) {
        const mat = this.mat(this.rgbaHex(g), { roughness: 0.9 });
        const mesh = new T.Mesh(geo, mat); mesh.receiveShadow = true; mesh.userData.box = [p, s]; mesh.userData.name = name;
        // the cutaway copy: the same wall from the floor up to CUT_H (none for the lintel above the door)
        let cut = null;
        if (p[2] - s[2] < CUT_H) {
          const top = Math.min(CUT_H, p[2] + s[2]), bot = p[2] - s[2];
          const cg = new T.BoxGeometry(2 * s[0], 2 * s[1], top - bot); cg.translate(p[0], p[1], (top + bot) / 2);
          cut = new T.Group(); cut.visible = false; this.root.add(cut);
          const cm = new T.Mesh(cg, mat); cm.receiveShadow = true; cut.add(cm);
          // a dark cap on the cut face: reads as "wall cut here", like a floor plan
          const cap = new T.Mesh(new T.BoxGeometry(2 * s[0], 2 * s[1], 0.012), this.mat(0x3a3b3d, { roughness: 0.8 }));
          cap.position.set(p[0], p[1], top + 0.006); cut.add(cap);   // on top: no z-fighting with the cut face
        }
        mesh.userData.cut = cut;
        this.root.add(mesh); this.walls.push(mesh);
      } else {
        const hex = this.rgbaHex(g);
        if (!merged.has(hex)) merged.set(hex, []);
        merged.get(hex).push(geo);
      }
    }
    for (const [hex, list] of merged) {
      const mesh = new T.Mesh(mergeGeometries(list), this.mat(hex, { roughness: 0.6 }));
      mesh.castShadow = true; mesh.receiveShadow = true; this.root.add(mesh);
      list.forEach((x) => x.dispose());
    }
  }

  /** Cart frame + LeKiwi base, in a group that follows the chassis body every frame. */
  cart() {
    const T = this.T, S = CART, L = LEKIWI, g = this.cartGroup = new T.Group();
    g.matrixAutoUpdate = false; this.root.add(g);
    const grey = this.mat(0x9e9e97, { roughness: 0.55 }), black = this.mat(0x1c1c1c, { roughness: 0.5 });
    const add = (geo, mat, x, y, z, parent = g) => { const k = new T.Mesh(geo, mat); k.position.set(x, y, z); k.castShadow = true; k.receiveShadow = true; parent.add(k); return k; };
    // LeKiwi plates (bounding boxes of the plate STLs) at the XLeRobot MJCF heights
    for (const top of L.plateTop) add(new T.BoxGeometry(L.plate[0], L.plate[1], L.plate[2]), black, 0, 0, top - L.plate[2] / 2);
    // shelves: the bottom one rests on the LeKiwi top plate, the middle one halfway to the tray (schematic)
    const z0 = L.plateTop[1], th = 0.01, shelf = new T.BoxGeometry(2 * S.hx, 2 * S.hy, th);
    for (const z of [z0 + th / 2, (z0 + S.tray) / 2]) add(shelf, grey, 0, 0, z);
    // corner posts up to the cart's overall height
    const post = new T.BoxGeometry(S.post, S.post, S.height - z0), px = S.hx - S.post / 2, py = S.hy - S.post / 2;
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(post, grey, sx * px, sy * py, (S.height + z0) / 2);
    // head post and front camera (schematic: a 2 cm post from the tray's rear centre up to the camera, a small box)
    const F = FRONT_CAM.pos, postH = F[2] - 0.02 - S.tray;
    add(new T.BoxGeometry(S.post, S.post, postH), grey, F[0] - 0.03, F[1], S.tray + postH / 2);
    const head = add(new T.BoxGeometry(0.04, 0.06, 0.04), black, F[0] - 0.025, F[1], F[2]);   // behind the lens
    head.rotation.y = FRONT_CAM.tilt * Math.PI / 180;
    // omni wheels: hub + 2 rows × 6 barrel rollers (axis tangent to the rim), the second row turned by 30°
    const W = L.wheel, hubMat = this.mat(0x3a3b3d, { roughness: 0.5 }), rolMat = this.mat(0x111111, { roughness: 0.6 });
    const hub = new T.CylinderGeometry(W.hubR * 0.86, W.hubR * 0.86, W.hubW * 0.9, 24); hub.rotateX(Math.PI / 2);
    // the 12 rollers of a wheel merged into one geometry (one draw call per wheel and material)
    const list = [], mx = new T.Matrix4(), qt = new T.Quaternion(), one = new T.Vector3(1, 1, 1), zAx = new T.Vector3(0, 0, 1);
    for (let row = 0; row < W.rows; row++) {
      for (let i = 0; i < W.perRow; i++) {
        const phi = (i + row * 0.5) * 2 * Math.PI / W.perRow, r = new T.SphereGeometry(1, 12, 8);
        r.scale(W.rollerR, W.rollerR, W.rollerL / 2);
        // roller axis (local z of the ellipsoid) along the rim tangent (−sin φ, cos φ, 0)
        qt.setFromUnitVectors(zAx, new T.Vector3(-Math.sin(phi), Math.cos(phi), 0));
        r.applyMatrix4(mx.compose(new T.Vector3(W.ring * Math.cos(phi), W.ring * Math.sin(phi), (row ? -1 : 1) * W.rowZ), qt, one));
        list.push(r);
      }
    }
    const rollers = mergeGeometries(list); list.forEach((x) => x.dispose());
    this.wheels = [];
    for (let k = 0; k < 3; k++) {
      const { pos, axle } = wheelPose(k), mount = new T.Group();
      mount.position.set(pos[0], pos[1], pos[2]);
      mount.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(axle[0], axle[1], axle[2]));
      const spin = new T.Group(); mount.add(spin); g.add(mount);
      add(hub, hubMat, 0, 0, 0, spin);
      add(rollers, rolMat, 0, 0, 0, spin);
      this.wheels.push(spin);
    }
  }

  labels() {
    const T = this.T, M = MAP;
    for (const lab of M.labs) {
      const text = t(LABEL[lab.id]), c = document.createElement('canvas'), x = c.getContext('2d');
      c.width = 1024; c.height = 128;
      x.font = '600 56px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = 'rgba(255,255,255,0.88)';
      const w = Math.min(1000, x.measureText(text).width + 64);
      x.beginPath(); x.roundRect((1024 - w) / 2, 14, w, 100, 22); x.fill();
      x.fillStyle = '#1b1b1b'; x.fillText(text, 512, 66);
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      s.scale.set(1.6, 0.2, 1); s.position.set(lab.x, M.room[1] / 2 - 0.3, M.h + 0.25); s.renderOrder = 10;
      s.userData.label = text;
      this.root.add(s);
    }
  }

  /** Camera views (src/mobile/camera.js): Za vozíkem by default, the target is the cart. */
  camera(opts) {
    const sim = this.sim, cam = sim.camera, mj = sim.mj;
    cam.far = 30; cam.updateProjectionMatrix();
    this.rig = new CameraRig(sim, this.T, { reduced: !!opts.reduced, base: () => this.base(), map: MAP, fovy: FRONT_CAM.fovy,
      frontCam: mj.mj_name2id(this.m, mj.mjtObj.mjOBJ_CAMERA.value, 'front_cam'),
      insetTop: () => { const top = document.getElementById('ux-top'), cv = sim.renderer.domElement; return top ? Math.max(0, top.getBoundingClientRect().bottom - cv.getBoundingClientRect().top) : 0; } });
    this.resetView();
    // the shadow camera covers the cart and the arm (it follows the cart in update())
    this.sun = sim.scene.children.find((o) => o.isDirectionalLight && o.castShadow);
    if (this.sun) {
      Object.assign(this.sun.shadow.camera, { left: -0.7, right: 0.7, top: 0.7, bottom: -0.7, near: 0.05, far: 4 });
      this.sun.shadow.camera.updateProjectionMatrix();
      this.sunOff = this.sun.position.clone().sub(this.sun.target.position);
    }
  }

  /** Back to the default view: Za vozíkem, over the cart's right shoulder towards the door and lab B. */
  resetView() { this.rig.set('chase'); this.sim.controls.update(); }

  /** Chassis pose (x, y, yaw) and its body-frame velocity (u forward, v left, w yaw rate) from qpos / qvel. */
  base() {
    const q = this.d.qpos, v = this.d.qvel, yaw = q[this.qa[2]], c = Math.cos(yaw), s = Math.sin(yaw);
    const vx = v[this.va[0]], vy = v[this.va[1]];
    return { x: q[this.qa[0]], y: q[this.qa[1]], yaw, u: c * vx + s * vy, v: -s * vx + c * vy, w: v[this.va[2]] };
  }

  /** Per frame, after physics: cart frame pose, wheel spin, wall fade, shadow follow. */
  update(dt) {
    const b = this.base(), e = this.cartGroup.matrix.elements, xp = this.d.xpos, xm = this.d.xmat, i = this.chassis;
    e[0] = xm[9 * i]; e[4] = xm[9 * i + 1]; e[8] = xm[9 * i + 2]; e[12] = xp[3 * i];
    e[1] = xm[9 * i + 3]; e[5] = xm[9 * i + 4]; e[9] = xm[9 * i + 5]; e[13] = xp[3 * i + 1];
    e[2] = xm[9 * i + 6]; e[6] = xm[9 * i + 7]; e[10] = xm[9 * i + 8]; e[14] = xp[3 * i + 2];
    e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
    this.cartGroup.matrixWorldNeedsUpdate = true;
    // LeRobot wheel speeds (rad/s, positive = rim moving along the wheel's rolling direction). Rolling on the floor
    // about the outward axle, the wheel turns the other way round: angle −= ω dt.
    wheelSpeeds(b.u, b.v, b.w, this.w);
    for (let k = 0; k < 3; k++) { this.spin[k] -= this.w[k] * dt; this.wheels[k].rotation.z = this.spin[k]; }
    this.rig.update(dt);
    this.cutWalls(b);
    if (this.sun) {
      this.sun.target.position.set(b.x, 0, -b.y);
      this.sun.position.copy(this.sun.target.position).add(this.sunOff);
      this.sun.target.updateMatrixWorld();
    }
  }

  /**
   * Cutaway (main views only): a wall is drawn cut down to bench height when the camera is beyond its inner face
   * (an outer wall on the camera's side; the middle wall from either lab, so the other lab is never hidden behind
   * it), or when it stands between the camera and the cart or the orbit target. Shora cuts every wall (a map).
   */
  cutWalls(b) {
    const cp = this.sim.camera.position, tg = this.sim.controls.target, top = this.rig.view === 'top';
    const cam = [cp.x, -cp.z, cp.y], ends = [[b.x, b.y, 0.6], [tg.x, -tg.z, tg.y]];
    for (const w of this.walls) {
      const [p, s] = w.userData.box, k = s[0] < s[1] ? 0 : 1;   // the wall's thin axis
      const beyond = Math.abs(cam[k]) > Math.abs(p[k]) - s[k] && (Math.abs(p[k]) < 1e-9 || Math.sign(cam[k]) === Math.sign(p[k]));
      w.userData.hit = top || beyond || ends.some((e) => segBox(cam, e, p, s));
    }
    this.showWalls(this.rig.view !== 'front');
  }
  /** Draw the cut walls as cut (main views) or whole (the front camera's picture). */
  showWalls(cutaway) {
    for (const w of this.walls) {
      const cut = cutaway && w.userData.hit;
      w.visible = !cut;
      if (w.userData.cut) w.userData.cut.visible = cut;
    }
  }
  /** sim.onRender: the frame of the current view. */
  render() { this.rig.render((v) => this.showWalls(v !== 'front'), () => this.showWalls(true)); }

  /** Test hook: what is drawn (counts) and the current wheel speeds / angles. */
  /** Test hook: the view, camera and orbit target (MuJoCo frame), the sun's shadow target, the front picture. */
  camStats() {
    const r = this.rig, p = this.sim.camera.position, tg = this.sim.controls.target, f = r.front.position;
    r.frontPose();
    const st = this.sun ? this.sun.target.position : null, r3 = (v) => +v.toFixed(3);
    return { view: r.view, reduced: r.reduced, pos: [p.x, -p.z, p.y].map(r3), target: [tg.x, -tg.z, tg.y].map(r3),
      front: [f.x, -f.z, f.y].map(r3), frontRect: r.frontRect(), sun: st ? [st.x, -st.z].map(r3) : null, orbit: this.sim.controls.enabled };
  }

  stats() {
    return { walls: this.walls.length, cut: this.walls.filter((w) => w.userData.hit).map((w) => w.userData.name), cam: this.camStats(),
      wheelSpeeds: this.w.slice(), wheelAngles: this.spin.slice(), labels: this.root.children.filter((o) => o.isSprite).map((s) => s.userData.label) };
  }
}

/** Does the segment a → b pass through the box centred at p with half sizes s? (slab test) */
function segBox(a, b, p, s) {
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k], lo = p[k] - s[k] - a[k], hi = p[k] + s[k] - a[k];
    if (Math.abs(d) < 1e-12) { if (lo > 0 || hi < 0) return false; continue; }
    let u = lo / d, v = hi / d; if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}
