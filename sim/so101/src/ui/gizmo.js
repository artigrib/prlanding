// "Chytrý pohyb" on the stage: draggable IK target gizmo (move / height arrow / wrist ring), the IK ghost
// arm, path previews for the planner, click-to-pick and the pen tool. Mouse, touch and pen via Pointer Events.

import { Kin } from '../kin.js';

const BLUE = 0x1f3bff, RED = 0xff2a1a, PATH_OK = 0x1f3bff;
const PEN_MAX = 2000;

export class Gizmo {
  constructor(ux) {
    const T = this.T = ux.T, app = this.app = ux.app;
    this.ux = ux; this.ctl = ux.ctl; this.d = app.d; this.m = app.m;
    this.kin = new Kin(ux.ctl.kin.c);        // ghost pose (separate scratch)
    this.enabled = true;
    this.v = new T.Vector3(); this.v2 = new T.Vector3(); this.v3 = new T.Vector3();
    this.ray = new T.Raycaster(); this.ndc = new T.Vector2();
    this.plane = new T.Plane(); this.hit = new T.Vector3();
    this.tip = new Float64Array(3); this.off = new Float64Array(3);
    this.pointers = new Map();
    this.drag = null; this.down = null;
    this.build();
    this.ghostBuild();
    this.bind();
  }

  // ---------- visuals ----------
  build() {
    const T = this.T, W = this.app.world;
    const mat = this.mat = new T.MeshStandardMaterial({ color: BLUE, roughness: 0.3, emissive: BLUE, emissiveIntensity: 0.25 });
    const root = this.root = new T.Group();
    const ball = new T.Mesh(new T.SphereGeometry(0.0105, 28, 18), mat);
    ball.renderOrder = 3;
    // height arrow (MuJoCo z up)
    const stem = new T.Mesh(new T.CylinderGeometry(0.0012, 0.0012, 0.024, 8), mat);
    stem.rotation.x = Math.PI / 2; stem.position.z = 0.022;
    const cone = new T.Mesh(new T.ConeGeometry(0.0065, 0.014, 20), mat);
    cone.rotation.x = Math.PI / 2; cone.position.z = 0.038;
    const cone2 = cone.clone(); cone2.rotation.x = -Math.PI / 2; cone2.position.z = -0.038;
    const stem2 = stem.clone(); stem2.position.z = -0.022;
    // wrist ring (horizontal) with a notch that shows the jaw direction
    const ringMat = this.ringMat = new T.MeshStandardMaterial({ color: BLUE, roughness: 0.4, transparent: true, opacity: 0.75 });
    const ring = new T.Mesh(new T.TorusGeometry(0.03, 0.0016, 8, 64), ringMat);
    const notch = this.notch = new T.Group();
    const nb = new T.Mesh(new T.BoxGeometry(0.012, 0.004, 0.004), mat); nb.position.x = 0.03;
    const nb2 = nb.clone(); nb2.position.x = -0.03;
    notch.add(nb, nb2);
    root.add(ball, stem, cone, stem2, cone2, ring, notch);
    // invisible, larger hit proxies (touch friendly)
    const inv = new T.MeshBasicMaterial({ visible: false });
    this.hMove = new T.Mesh(new T.SphereGeometry(0.02, 12, 8), inv);
    this.hUp = new T.Mesh(new T.CylinderGeometry(0.009, 0.009, 0.03, 8), inv); this.hUp.rotation.x = Math.PI / 2; this.hUp.position.z = 0.036;
    // the lower arrow usually sits right over the object the user wants to click: keep its hit area tight
    this.hDown = new T.Mesh(new T.CylinderGeometry(0.007, 0.007, 0.022, 8), inv); this.hDown.rotation.x = Math.PI / 2; this.hDown.position.z = -0.04;
    this.hRing = new T.Mesh(new T.TorusGeometry(0.03, 0.007, 6, 32), inv);
    root.add(this.hMove, this.hUp, this.hDown, this.hRing);
    this.handles = [this.hMove, this.hUp, this.hDown, this.hRing];
    W.add(root);

    // drop line + floor marker (unscaled, world units)
    const lineMat = this.lineMat = new T.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.45, depthWrite: false });
    this.drop = new T.Mesh(new T.CylinderGeometry(0.0007, 0.0007, 1, 6), lineMat);
    this.drop.rotation.x = Math.PI / 2;
    this.foot = new T.Mesh(new T.RingGeometry(0.006, 0.0085, 32), lineMat);
    W.add(this.drop, this.foot);

    // pen stroke preview (preallocated)
    const pp = this.penPos = new Float32Array(PEN_MAX * 3);
    const pg = this.penGeo = new T.BufferGeometry();
    pg.setAttribute('position', new T.BufferAttribute(pp, 3).setUsage(T.DynamicDrawUsage));
    pg.setDrawRange(0, 0);
    this.penLine = new T.Line(pg, new T.LineBasicMaterial({ color: 0xe8461e }));
    this.penLine.frustumCulled = false;
    W.add(this.penLine);
    this.stroke = [];

    this.path = null; this.pathT = 0;
  }

  ghostBuild() {
    const T = this.T, m = this.m;
    // polygon offset: where the ghost coincides with the real arm, the real arm wins (no speckles)
    this.ghostMat = new T.MeshStandardMaterial({ color: BLUE, transparent: true, opacity: 0.2, depthWrite: false, roughness: 0.6,
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 });
    const bodies = this.kin.c.bodies;
    const index = new Map(bodies.map((b, i) => [b.id, i]));
    this.ghosts = [];
    const G = new T.Group(); G.visible = false; this.ghost = G;
    for (const [g, mesh] of this.app.geoms) {
      const k = index.get(m.geom_bodyid[g]);
      if (k == null || bodies[k].parent < 0) continue;     // the base never moves: no ghost needed
      const gm = new T.Mesh(mesh.geometry, this.ghostMat);
      gm.matrixAutoUpdate = false; gm.renderOrder = 2;
      const q = m.geom_quat.subarray(4 * g, 4 * g + 4), p = m.geom_pos.subarray(3 * g, 3 * g + 3);
      const L = new Float64Array(9); quat2mat(q, L);
      this.ghosts.push({ mesh: gm, k, p: Float64Array.from(p), L, g });
      G.add(gm);
    }
    this.app.world.add(G);
    this.ghostAlpha = 0;
  }

  setColor(ok) {
    if (ok === this.okCol) return; this.okCol = ok;
    const c = ok ? BLUE : RED;
    this.mat.color.setHex(c); this.mat.emissive.setHex(c); this.ringMat.color.setHex(c);
    this.lineMat.color.setHex(c); this.ghostMat.color.setHex(c);
  }

  /** Per frame, after physics. */
  sync(dt) {
    const ctl = this.ctl, smart = this.ux.mode === 'smart' && this.enabled;
    this.root.visible = this.drop.visible = this.foot.visible = smart && !this.ux.teach.replaying;
    let p;
    if (ctl.active) p = ctl.target;
    else { p = ctl.actualTip(this.tip); }
    if (this.root.visible) {
      this.root.position.set(p[0], p[1], p[2]);
      // keep a constant on-screen size
      this.v.set(p[0], p[2], -p[1]);
      const dist = this.app.camera.position.distanceTo(this.v);
      const s = Math.max(0.55, Math.min(1.8, dist / 0.75)) * (this.ux.touch ? 1.25 : 1);
      this.root.scale.setScalar(s);
      this.drop.scale.set(1, Math.max(0.0001, p[2]), 1);
      this.drop.position.set(p[0], p[1], p[2] / 2);
      this.foot.position.set(p[0], p[1], 0.0006);
      this.foot.scale.setScalar(s);
      // ring notch = jaw closing direction (from the actual pose)
      const k = this.ctl.kin, gi = k.c.site.body; ctl.actualTip(this.tip);
      this.notch.rotation.z = Math.atan2(k.xmat[9 * gi + 3], k.xmat[9 * gi]);
      const bad = ctl.active && !ctl.reachable;
      this.setColor(!bad);
      if (bad) this.mat.emissiveIntensity = 0.4 + 0.3 * Math.sin(performance.now() / 120);
      else this.mat.emissiveIntensity = 0.25;
    }
    this.syncGhost(dt, smart);
    this.syncPath(dt);
  }

  syncGhost(dt, smart) {
    const ctl = this.ctl;
    let want = 0;
    if (smart && ctl.active) {
      const qp = this.d.qpos; let mx = 0;
      for (let i = 0; i < 5; i++) mx = Math.max(mx, Math.abs(ctl.qGoal[i] - qp[i]));
      want = !ctl.reachable ? 0.32 : Math.min(0.22, mx * 1.2);
      if (this.drag) want = Math.max(want, 0.12);
    }
    const a = this.ghostAlpha += (want - this.ghostAlpha) * Math.min(1, dt * 10);
    this.ghost.visible = a > 0.01;
    if (!this.ghost.visible) return;
    this.ghostMat.opacity = a;
    const k = this.kin; k.fk(ctl.qGoal);
    for (const g of this.ghosts) {
      const P = k.xpos, M = k.xmat, o3 = 3 * g.k, o9 = 9 * g.k, L = g.L, p = g.p, e = g.mesh.matrix.elements;
      for (let r = 0; r < 3; r++) {
        const m0 = M[o9 + 3 * r], m1 = M[o9 + 3 * r + 1], m2 = M[o9 + 3 * r + 2];
        e[12 + r] = P[o3 + r] + m0 * p[0] + m1 * p[1] + m2 * p[2];
        e[r] = m0 * L[0] + m1 * L[3] + m2 * L[6];
        e[4 + r] = m0 * L[1] + m1 * L[4] + m2 * L[7];
        e[8 + r] = m0 * L[2] + m1 * L[5] + m2 * L[8];
      }
      e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
      g.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  /** drawing mission: the floor ring marks where the marker lands; green / orange / red by deviation */
  drawCursor(d) {
    this.foot.position.set(d.goal[0], d.goal[1], 0.0012);
    const g = d.grade();
    this.lineMat.color.setHex(!d.penDown ? 0x8a8a84 : g === 'ok' ? 0x1fa34a : g === 'warn' ? 0xf09a00 : 0xff2a1a);
    this.lineMat.opacity = 0.9;
    this.foot.scale.setScalar(1.7);
    this.okCol = null;   // let setColor() restore the normal colour later
  }

  // ---------- planner path preview ----------
  showPath(plan, animate) {
    const T = this.T;
    this.clearPath();
    const pts = plan.path.map((p) => new T.Vector3(p[0], p[1], p[2]));
    const curve = new T.CurvePath();
    for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 1e-4) curve.add(new T.LineCurve3(pts[i - 1], pts[i]));
    if (!curve.curves.length) return;
    const segs = Math.min(400, Math.max(24, Math.round(curve.getLength() / 0.004)));
    const geo = new T.TubeGeometry(curve, segs, 0.0016, 6, false);
    const col = plan.ok ? PATH_OK : RED;
    const mat = new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false });
    const tube = new T.Mesh(geo, mat);
    const g = new T.Group(); g.add(tube);
    // markers at grasp / release points and at unreachable points
    const dot = new T.SphereGeometry(0.004, 12, 8);
    const marks = plan.steps.filter((s) => s.k === 'grip');
    let last = null;
    for (const st of plan.steps) {
      if (st.k === 'move') last = st.pts[st.pts.length - 1];
      if (st.k === 'grip' && last) {
        const mm = new T.Mesh(dot, new T.MeshBasicMaterial({ color: st.open ? 0xffffff : col }));
        mm.position.set(last[0], last[1], last[2]); g.add(mm);
      }
    }
    for (const b of plan.bad) { const mm = new T.Mesh(dot, new T.MeshBasicMaterial({ color: RED })); mm.position.set(b[0], b[1], b[2]); mm.scale.setScalar(1.6); g.add(mm); }
    void marks;
    this.app.world.add(g);
    this.path = { g, geo, mat, total: geo.index.count, t: animate ? 0 : 1, t0: performance.now(), fade: 0 };
    geo.setDrawRange(0, animate ? 0 : geo.index.count);
  }
  fadePath() { if (this.path) this.path.fade = 1; }
  clearPath() {
    if (!this.path) return;
    this.app.world.remove(this.path.g);
    this.path.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.path = null;
  }
  syncPath(dt) {
    const P = this.path; if (!P) return;
    if (P.t < 1) {
      P.t = Math.min(1, (performance.now() - P.t0) / 600);   // wall clock: same speed at any frame rate
      const n = Math.floor(P.total * P.t / 3) * 3; P.geo.setDrawRange(0, n);
    }
    if (P.fade) {
      P.mat.opacity -= dt * 1.5;
      if (P.mat.opacity <= 0) this.clearPath();
    }
  }

  // ---------- pointer input ----------
  bind() {
    const canvas = this.canvas = this.app.renderer.domElement, stage = canvas.parentElement;
    const opt = { capture: true };
    stage.addEventListener('pointerdown', (e) => this.onDown(e), opt);
    stage.addEventListener('pointermove', (e) => this.onMove(e), opt);
    stage.addEventListener('pointerup', (e) => this.onUp(e), opt);
    stage.addEventListener('pointercancel', (e) => this.onUp(e, true), opt);
    stage.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });
    canvas.addEventListener('contextmenu', (e) => { if (this.drag) e.preventDefault(); });
  }

  setRay(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.app.camera);
  }
  hitHandle(e) {
    if (!this.root.visible) return null;
    this.setRay(e);
    this.root.updateMatrixWorld();
    const h = this.ray.intersectObjects(this.handles, false);
    if (!h.length) { this.handleDist = Infinity; return null; }
    const o = h[0].object;
    this.handleDist = h[0].distance;
    return o === this.hMove ? 'move' : o === this.hRing ? 'roll' : 'height';
  }
  // MuJoCo-frame point where the current ray meets a three.js plane
  rayPlane(out) {
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return false;
    this.app.world.worldToLocal(this.v3.copy(this.hit));
    out[0] = this.v3.x; out[1] = this.v3.y; out[2] = this.v3.z;
    return true;
  }
  horizPlane(z) { this.plane.set(this.v.set(0, 1, 0), -z); }   // MuJoCo z = three y

  onDown(e) {
    if (e.target !== this.canvas || this.forwarding) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pend && e.pointerId !== this.pend.id) {
      // a second finger while pressing a handle: it is a drag (and a twist), not a tap
      const P = this.pend; this.pend = null;
      this.startDrag(P.kind, { pointerId: P.id, clientX: P.x, clientY: P.y });
    }
    const lk = this.ux.links;
    if ((lk.pend || lk.drag) && e.pointerType === 'touch') {
      // two fingers = camera: hand the first finger over to OrbitControls too, so pinch-zoom works
      const id = (lk.pend || lk.drag).id, f = this.pointers.get(id);
      lk.cancelPress();
      if (f) {
        this.forwarding = true;
        try {
          this.canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', isPrimary: true,
            clientX: f.x, clientY: f.y, button: 0, buttons: 1, bubbles: true, cancelable: true }));
        } finally { this.forwarding = false; }
      }
      return;   // this (second) pointerdown continues to OrbitControls
    }
    if (this.drawing && e.pointerId !== this.drawing.id) { this.drawing = null; return; }
    if (this.drag) {
      // second finger while dragging: twist = wrist rotation
      if (e.pointerType === 'touch' && this.pointers.size === 2) {
        this.drag.twist = { a0: this.twistAngle(), r0: this.ctl.roll };
      }
      e.stopPropagation(); e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const ux = this.ux;
    if (ux.mode === 'smart') {
      const kind = this.hitHandle(e);
      if (kind) {
        // tap = pick, drag = move: the drag only starts after the pointer travelled > 6 px, so a tap on an
        // object behind / under a handle still picks it (P0-1). A closer object wins outright.
        const hd = this.handleDist, pk = this.pickAt(e), pd = pk ? this.pickDist : Infinity;
        if (!(pk && pk.name !== 'table' && pd < hd - 0.002)) {
          // the ball sits at the fingertips: a TAP on jaw geometry under it toggles the gripper (a drag still moves the ball)
          const lh = lk.enabled() ? lk.hit(e) : null, jaw = !!(lh && lk.isJaw(lh.part));
          this.pend = { kind, id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), pick: pk && pk.name !== 'table' ? pk : null, jaw };
          try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
          e.stopPropagation(); e.preventDefault(); return;
        }
      }
      if (ux.penTool) {
        const p = this.tablePoint(e);
        if (p) { this.startStroke(e, p); e.stopPropagation(); e.preventDefault(); return; }
      }
      // drawing mission: a drag on the paper moves the marker in the paper plane
      if (ux.drawMode()) {
        const p = this.tablePoint(e);
        if (p && ux.onPaper(p)) {
          this.drawing = { id: e.pointerId };
          try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
          ux.drawPoint(p[0], p[1]);
          e.stopPropagation(); e.preventDefault(); return;
        }
      }
    }
    // any part of the arm: rotate that joint (objects in front of it still win)
    if (lk.enabled()) {
      const lh = lk.hit(e);
      if (lh) {
        const pk = this.pickAt(e);
        if (!(pk && pk.name !== 'table' && this.pickDist < lh.dist)) {
          lk.down(e, lh);
          try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
          e.stopPropagation(); e.preventDefault(); return;
        }
      }
    }
    this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  }

  startDrag(kind, e) {
    const ctl = this.ctl;
    ctl.begin(); ctl.dragging = true;
    const t = ctl.target;
    this.drag = { kind, id: e.pointerId };
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    this.canvas.style.cursor = 'grabbing';
    this.setRay(e);
    if (kind === 'move') {
      // horizontal drag plane; when the view is nearly level, a vertical plane facing the camera
      const dir = this.app.camera.getWorldDirection(this.v2);
      if (Math.abs(dir.y) < 0.35) {
        dir.y = 0; dir.normalize();
        this.plane.setFromNormalAndCoplanarPoint(dir, this.v.set(t[0], t[2], -t[1]));
        this.drag.vertical = true;
      } else this.horizPlane(t[2]);
      const p = [0, 0, 0];
      if (this.rayPlane(p)) { this.off[0] = t[0] - p[0]; this.off[1] = t[1] - p[1]; this.off[2] = t[2] - p[2]; }
      else this.off.fill(0);
      this.drag.plane = this.plane.clone();
    } else if (kind === 'height') {
      this.drag.z0 = t[2]; this.drag.s0 = this.lineParam(t);
    } else {
      this.horizPlane(t[2]); this.drag.plane = this.plane.clone();
      const p = [0, 0, 0]; this.rayPlane(p);
      this.drag.a0 = Math.atan2(p[1] - t[1], p[0] - t[0]); this.drag.r0 = ctl.roll;
    }
    this.ux.onUserMove('drag-' + kind);
  }

  // parameter along the vertical line through t closest to the current ray (MuJoCo z)
  lineParam(t) {
    // closest point between the pointer ray and the vertical line through the target.
    // MuJoCo (x, y, z) is three (x, z, -y), so the line is Q = (t0, s, -t1), direction (0, 1, 0).
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const wx = o.x - t[0], wy = o.y, wz = o.z + t[1];
    const b = d.y, dd = d.x * wx + d.y * wy + d.z * wz, e = wy, den = 1 - b * b;
    if (den < 1e-4) return this.drag ? this.drag.s0 : 0;   // looking straight down the line
    return (e - b * dd) / den;
  }

  twistAngle() {
    const it = this.pointers.values(); const a = it.next().value, b = it.next().value;
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  onMove(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ux.links.move(e)) { e.stopPropagation(); e.preventDefault(); return; }
    if (this.drawing && e.pointerId === this.drawing.id) {
      e.stopPropagation(); e.preventDefault();
      const p = this.tablePoint(e); if (p) this.ux.drawPoint(p[0], p[1]);
      return;
    }
    const P = this.pend;
    if (P && e.pointerId === P.id) {
      e.stopPropagation(); e.preventDefault();
      if (Math.hypot(e.clientX - P.x, e.clientY - P.y) <= 6) return;
      this.pend = null;
      this.startDrag(P.kind, { pointerId: P.id, clientX: P.x, clientY: P.y });   // plane/offset from the press point
    }
    const D = this.drag;
    if (D) {
      e.stopPropagation(); e.preventDefault();
      const ctl = this.ctl, t = ctl.target;
      if (D.twist && this.pointers.size >= 2) {
        ctl.setRoll(D.twist.r0 - (this.twistAngle() - D.twist.a0));
        return;
      }
      if (e.pointerId !== D.id) return;
      this.setRay(e);
      if (D.kind === 'move' && this.ux.drawMode()) {   // paper-plane mode: the ball slides on the paper
        const p = this.tablePoint(e); if (p) this.ux.drawPoint(p[0], p[1]);
      } else if (D.kind === 'move') {
        this.plane.copy(D.plane);
        const p = this.tip;
        if (this.rayPlane(p)) this.ux.userSetTarget(p[0] + this.off[0], p[1] + this.off[1], D.vertical ? p[2] + this.off[2] : t[2]);
      } else if (D.kind === 'height') {
        const s = this.lineParam(t);
        this.ux.userSetTarget(t[0], t[1], D.z0 + (s - D.s0));
      } else {
        this.plane.copy(D.plane);
        const p = this.tip;
        if (this.rayPlane(p)) {
          const a = Math.atan2(p[1] - t[1], p[0] - t[0]);
          ctl.setRoll(D.r0 + wrapPi(a - D.a0));
        }
      }
      return;
    }
    if (this.strokeOn) { e.stopPropagation(); this.addStroke(e); return; }
    // hover feedback (mouse only)
    if (e.pointerType === 'mouse' && !e.buttons) {
      const now = performance.now();
      if (now - (this.hoverT || 0) < 50) return; this.hoverT = now;
      let cur = '';
      if (this.ux.mode === 'smart' && this.hitHandle(e)) { cur = 'grab'; this.ux.links.clear(); }
      else if (this.ux.drawMode() && (() => { const p = this.tablePoint(e); return p && this.ux.onPaper(p); })()) cur = 'crosshair';
      else if (this.ux.links.enabled() && this.ux.links.hover(e)) cur = 'grab';
      else if (this.ux.penTool && this.tablePoint(e)) cur = 'crosshair';
      else if (this.pickAt(e)) cur = 'pointer';
      this.hover = cur === 'grab';
      if (this.canvas.style.cursor !== cur) this.canvas.style.cursor = cur;
    }
  }

  onUp(e, cancelled) {
    this.pointers.delete(e.pointerId);
    if (this.ux.links.up(e, cancelled)) { e.stopPropagation(); return; }
    if (this.drawing && e.pointerId === this.drawing.id) { this.drawing = null; e.stopPropagation(); return; }
    const P = this.pend;
    if (P && e.pointerId === P.id) {
      this.pend = null; e.stopPropagation();
      if (!cancelled && P.pick) this.ux.onPick(P.pick.name, P.pick.point);
      else if (!cancelled && P.jaw) this.ux.toggleGrip();
      return;
    }
    const D = this.drag;
    if (D) {
      e.stopPropagation();
      if (D.twist && this.pointers.size < 2) D.twist = null;
      if (e.pointerId === D.id) {
        this.drag = null; this.ctl.dragging = false;
        this.canvas.style.cursor = '';
        this.ux.onDragEnd(D.kind);
      }
      return;
    }
    if (this.strokeOn && e.pointerId === this.strokeId) { e.stopPropagation(); this.endStroke(cancelled); return; }
    const dn = this.down; this.down = null;
    if (!dn || dn.id !== e.pointerId || cancelled) return;
    if (Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 7) return;   // no time limit: a slow press without motion is still a click
    const hit = this.pickAt(e);
    if (hit) this.ux.onPick(hit.name, hit.point);
  }

  onWheel(e) {
    if (this.ux.mode !== 'smart' || e.target !== this.canvas) return;
    if (!(this.drag || this.hitHandle(e))) return;
    e.preventDefault(); e.stopPropagation();
    if (!this.ctl.active) this.ctl.begin();
    this.ctl.setRoll(this.ctl.roll + Math.sign(e.deltaY) * 0.12);
    this.ux.onUserMove('wheel');
  }

  /** Raycast pickable mission objects + the table. Returns { name, point:[x,y,z] } (MuJoCo frame) or null. */
  pickAt(e) {
    this.setRay(e);
    this.app.world.updateMatrixWorld();   // object poses may have changed since the last rendered frame
    const list = this.ux.pickables();
    const h = this.ray.intersectObjects(list, true);
    if (!h.length) return null;
    let o = h[0].object; while (o && !o.userData.pick) o = o.parent;
    if (!o) return null;
    this.pickDist = h[0].distance;
    this.app.world.worldToLocal(this.v3.copy(h[0].point));
    return { name: o.userData.pick, point: [this.v3.x, this.v3.y, this.v3.z] };
  }

  tablePoint(e) {
    this.setRay(e);
    this.horizPlane(0.0);
    const p = [0, 0, 0];
    if (!this.rayPlane(p)) return null;
    if (p[0] < -0.25 || p[0] > 0.54 || Math.abs(p[1]) > 0.32) return null;
    return p;
  }

  // ---------- pen tool ----------
  startStroke(e, p) {
    this.strokeOn = true; this.strokeId = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    this.stroke = [[p[0], p[1]]];
    this.penN = 0; this.pushPen(p);
  }
  addStroke(e) {
    const p = this.tablePoint(e); if (!p) return;
    const l = this.stroke[this.stroke.length - 1];
    if (Math.hypot(p[0] - l[0], p[1] - l[1]) < 0.004) return;
    if (this.stroke.length > 400) return;
    this.stroke.push([p[0], p[1]]); this.pushPen(p);
  }
  pushPen(p) {
    if (this.penN >= PEN_MAX) return;
    const o = 3 * this.penN++; this.penPos[o] = p[0]; this.penPos[o + 1] = p[1]; this.penPos[o + 2] = 0.002;
    this.penGeo.attributes.position.needsUpdate = true; this.penGeo.setDrawRange(0, this.penN);
  }
  endStroke(cancelled) {
    this.strokeOn = false;
    const s = this.stroke; this.stroke = [];
    if (!cancelled && s.length >= 2) this.ux.onStroke(s);
    this.penGeo.setDrawRange(0, 0); this.penN = 0;
  }

  /** Client (CSS px) position of a MuJoCo point — onboarding bubbles and tests. */
  project(p, out) {
    const r = this.canvas.getBoundingClientRect();
    this.v.set(p[0], p[1], p[2]);
    this.app.world.localToWorld(this.v).project(this.app.camera);
    out = out || {};
    out.x = r.left + (this.v.x + 1) / 2 * r.width; out.y = r.top + (1 - this.v.y) / 2 * r.height;
    out.visible = this.v.z < 1 && out.x >= r.left && out.x <= r.right && out.y >= r.top && out.y <= r.bottom;
    return out;
  }
}

function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function quat2mat(q, o) {
  const [w, x, y, z] = q;
  o[0] = 1 - 2 * (y * y + z * z); o[1] = 2 * (x * y - w * z); o[2] = 2 * (x * z + w * y);
  o[3] = 2 * (x * y + w * z); o[4] = 1 - 2 * (x * x + z * z); o[5] = 2 * (y * z - w * x);
  o[6] = 2 * (x * z - w * y); o[7] = 2 * (y * z + w * x); o[8] = 1 - 2 * (x * x + y * y);
}
