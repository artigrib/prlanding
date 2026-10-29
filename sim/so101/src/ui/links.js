// Direct joint manipulation: grab any part of the arm and turn it.
//   hover / touch a link → that link lights up, a ring shows its joint axis + the current angle
//   drag → rotates that joint (pointer projected onto the joint's rotation plane), clamped with end-stop feedback
//   tap on the gripper jaws → open / close (same command as the gripper button); drag the moving jaw → opening
//   double-tap on any other link → that joint back to its home angle
//   keyboard: 1–6 select a joint (Shift+1–5 = missions), ←/→ rotate it, Esc deselects; Tab on the canvas cycles joints
// Scheme: empty space = camera orbit, objects = tap to pick, IK ball handles = move, links = rotate a joint.

import { t as tr } from '../i18n/index.js';
import { Kin } from '../kin.js';
import { store } from './store.js';

const NAMES = ['Otočení základny', 'Rameno', 'Loket', 'Zápěstí – náklon', 'Zápěstí – rotace', 'Chapadlo'];
const BODY_JOINT = { base: 0, shoulder: 0, upper_arm: 1, lower_arm: 2, wrist: 3, gripper: 4, camera_mount: 4, moving_jaw_so101_v1: 5 };
const JAW_BODIES = new Set(['gripper', 'moving_jaw_so101_v1']);

export class Links {
  constructor(ux) {
    const T = this.T = ux.T, app = this.app = ux.app;
    this.ux = ux; this.m = app.m; this.d = app.d;
    this.kin = new Kin(ux.ctl.kin.c);
    this.q = new Float64Array(6);
    const mj = ux.mj, name = (i) => mj.mj_id2name(this.m, mj.mjtObj.mjOBJ_BODY.value, i);
    this.parts = [];                  // { mesh, proxy, body, bname, j }
    this.byMesh = new Map();
    for (const [g, mesh] of app.geoms) {
      const b = this.m.geom_bodyid[g], bn = name(b), j = BODY_JOINT[bn];
      if (j == null) continue;
      // raycast against the light physics mesh even when the high-detail one is shown
      const proxy = new T.Mesh(mesh.geometry, new T.MeshBasicMaterial({ visible: false }));
      proxy.matrixAutoUpdate = false;
      const p = { mesh, proxy, g, body: b, bname: bn, j };
      this.parts.push(p); this.byMesh.set(proxy, p);
    }
    this.proxies = this.parts.map((p) => p.proxy);
    this.hl = new T.MeshStandardMaterial({ color: 0x1f3bff, roughness: 0.45, emissive: 0x1f3bff, emissiveIntensity: 0.35 });
    this.hlStop = new T.MeshStandardMaterial({ color: 0xff2a1a, roughness: 0.45, emissive: 0xff2a1a, emissiveIntensity: 0.4 });
    this.lit = []; this.litJ = -1;
    // ring on the joint axis
    const ringMat = this.ringMat = new T.MeshBasicMaterial({ color: 0x1f3bff, transparent: true, opacity: 0.85, depthTest: false });
    this.ring = new T.Mesh(new T.TorusGeometry(0.042, 0.0013, 6, 72), ringMat);
    this.needle = new T.Mesh(new T.BoxGeometry(0.042, 0.0022, 0.0022), ringMat);
    this.needle.geometry.translate(0.021, 0, 0);
    this.ringG = new T.Group(); this.ringG.add(this.ring, this.needle); this.ringG.visible = false; this.ringG.renderOrder = 5;
    this.ring.renderOrder = 5; this.needle.renderOrder = 5;
    app.world.add(this.ringG);
    this.label = document.createElement('div'); this.label.className = 'ux-jlabel'; this.label.hidden = true;
    ux.panel.stage.appendChild(this.label);
    this.ray = new T.Raycaster(); this.ndc = new T.Vector2();
    this.v = new T.Vector3(); this.v2 = new T.Vector3(); this.ax3 = new T.Vector3(); this.an3 = new T.Vector3();
    this.plane = new T.Plane(); this.hit3 = new T.Vector3(); this.r0 = new T.Vector3(); this.r1 = new T.Vector3();
    this.zAxis = new T.Vector3(0, 0, 1); this.qq = new T.Quaternion(); this.qw = new T.Quaternion(); this.qi = new T.Quaternion();
    this.sel = -1; this.pend = null; this.drag = null; this.lastTap = null;
    this.home = ux.ctl.home;
    this.range = ux.ctl.kin.c.range.map((r, i) => (i === 5 ? r : r));
    const cr = this.m.actuator_ctrlrange; this.lim = app.act.map((a) => [cr[2 * a], cr[2 * a + 1]]);
    // pull mode visuals: spring line + cursor dot (MuJoCo frame, in app.world)
    this.mode = store.get('grab-mode', 'pull') === 'joint' ? 'joint' : 'pull';
    this.realArmed = /[?&]real=1\b/.test(location.search);    // real hardware armed: no physics pulling
    this.springMat = new T.MeshBasicMaterial({ color: 0x1f3bff, transparent: true, opacity: 0.85, depthTest: false });
    this.spring = new T.Mesh(new T.CylinderGeometry(0.0012, 0.0012, 1, 8), this.springMat);
    this.cursor = new T.Mesh(new T.SphereGeometry(0.0045, 12, 8), this.springMat);
    this.spring.renderOrder = 6; this.cursor.renderOrder = 6; this.spring.visible = false; this.cursor.visible = false;
    app.world.add(this.spring, this.cursor);
    this.yAxis = new T.Vector3(0, 1, 0); this.gp = new Float64Array(3);
  }

  isJaw(part) { return JAW_BODIES.has(part.bname); }
  enabled() { const ux = this.ux; return !ux.explode.on && !ux.teach.replaying && !ux.penTool; }

  // ---------- picking ----------
  setRay(e) {
    const r = this.app.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.app.camera);
  }
  /** Link under the pointer: { part, dist } or null. */
  hit(e) {
    if (!this.enabled()) return null;
    this.setRay(e);
    this.app.world.updateMatrixWorld();
    for (const p of this.parts) {
      p.proxy.geometry = this.ux.hd ? (this.ux.hd.lo.get(this.m.geom_dataid[p.g]) || p.mesh.geometry) : p.mesh.geometry;
      p.proxy.matrixWorld.copy(p.mesh.matrixWorld);
    }
    const h = this.ray.intersectObjects(this.proxies, false);
    if (!h.length) return null;
    return { part: this.byMesh.get(h[0].object), dist: h[0].distance, point: h[0].point.clone() };
  }

  // ---------- joint frame ----------
  actualQ() {
    const qp = this.d.qpos, m = this.m, act = this.app.act;
    for (let i = 0; i < 6; i++) this.q[i] = qp[m.jnt_qposadr[m.actuator_trnid[2 * act[i]]]];
    this.kin.fk(this.q);
    return this.q;
  }
  /** Joint axis + anchor in three.js world coordinates (into this.ax3 / this.an3). */
  frame(j) {
    this.actualQ();
    const k = this.kin, a = k.waxis, p = k.anchor;
    this.ax3.set(a[3 * j], a[3 * j + 2], -a[3 * j + 1]).normalize();
    this.an3.set(p[3 * j], p[3 * j + 2], -p[3 * j + 1]);
  }

  // ---------- highlight + ring ----------
  light(part, stop) {
    const want = part ? part.body : -1;
    if (this.litBody !== want || this.litStop !== !!stop) {
      for (const [mesh, mat] of this.lit) mesh.material = mat;
      this.lit.length = 0;
      if (part) for (const p of this.parts) if (p.body === part.body) { this.lit.push([p.mesh, p.mesh.material]); p.mesh.material = stop ? this.hlStop : this.hl; }
      this.litBody = want; this.litStop = !!stop;
    }
  }
  showRing(j, ref, stop) {
    if (j < 0) { this.ringG.visible = false; this.label.hidden = true; return; }
    this.frame(j);
    // ring centred on the axis, in the rotation plane; needle along `ref` (or the link direction)
    const W = this.app.world;
    W.updateMatrixWorld();
    this.v.copy(this.an3); W.worldToLocal(this.v);
    this.ringG.position.copy(this.v);
    const axL = this.v2.set(this.kin.waxis[3 * j], this.kin.waxis[3 * j + 1], this.kin.waxis[3 * j + 2]);
    this.qq.setFromUnitVectors(this.zAxis, axL.normalize());
    this.ringG.quaternion.copy(this.qq);
    if (ref) {
      // needle angle: ref (three world, from the anchor) expressed in the ring's local frame
      this.qw.copy(this.app.world.quaternion).invert(); this.qi.copy(this.qq).invert();
      this.v.copy(ref).applyQuaternion(this.qw).applyQuaternion(this.qi);
      this.needle.rotation.z = Math.atan2(this.v.y, this.v.x);
      this.needle.visible = true;
    } else this.needle.visible = false;
    this.ringG.visible = true;
    this.ringMat.color.setHex(stop ? 0xff2a1a : 0x1f3bff);
  }
  showLabel(j, x, y, stop) {
    const st = this.ux.panel.stage.getBoundingClientRect(), v = this.app.d.ctrl[this.app.act[j]];
    const val = j === 5 ? Math.round((v - this.lim[5][0]) / (this.lim[5][1] - this.lim[5][0]) * 100) + ' % otevřeno' : Math.round(v * 180 / Math.PI) + '°';
    const t = tr(`${NAMES[j]} · ${val}${stop ? ' · doraz' : ''}`); // translated here, not by the DOM observer (no per-frame flicker)
    if (this.label.textContent !== t) this.label.textContent = t;
    this.label.classList.toggle('stop', !!stop);
    this.label.hidden = false;
    this.label.style.transform = `translate(${Math.round(Math.min(x - st.left + 16, st.width - 200))}px, ${Math.round(Math.max(8, y - st.top - 40))}px)`;
  }
  clear() { this.light(null); this.showRing(-1); }

  // ---------- pointer (called from gizmo.js; return true = consumed) ----------
  hover(e) {
    const h = this.hit(e);
    if (!h) { if (!this.drag && this.sel < 0) this.clear(); return false; }
    this.light(h.part);
    if (this.pull()) { this.showRing(-1); this.showPullLabel(e.clientX, e.clientY); }
    else { this.showRing(h.part.j); this.showLabel(h.part.j, e.clientX, e.clientY); }
    if (JAW_BODIES.has(h.part.bname)) this.jawHint();
    return true;
  }
  down(e, h) {
    this.pend = { id: e.pointerId, x: e.clientX, y: e.clientY, part: h.part, point: h.point };
    this.light(h.part);
    if (this.pull()) this.showPullLabel(e.clientX, e.clientY); else { this.showRing(h.part.j); this.showLabel(h.part.j, e.clientX, e.clientY); }
    if (JAW_BODIES.has(h.part.bname)) this.jawHint();
    return true;
  }
  move(e) {
    const P = this.pend;
    if (P && e.pointerId === P.id) {
      if (Math.hypot(e.clientX - P.x, e.clientY - P.y) <= 6) return true;
      this.pend = null;
      this.startDrag(P);
    }
    const D = this.drag;
    if (!D || e.pointerId !== D.id) return false;
    if (D.pull) {
      // cursor on a camera-facing plane through the grab point → spring target
      this.setRay(e);
      if (this.ray.ray.intersectPlane(this.plane, this.hit3)) {
        this.v.copy(this.hit3); this.app.world.worldToLocal(this.v);
        this.ux.grab.setTarget(this.v.x, this.v.y, Math.max(0.004, this.v.z));
      }
      this.showPullLabel(e.clientX, e.clientY);
      return true;
    }
    let delta;
    this.setRay(e);
    if (D.edge) delta = ((e.clientX - D.x) - (e.clientY - D.y)) * 0.008;
    else {
      if (!this.ray.ray.intersectPlane(this.plane, this.hit3)) return true;
      this.r1.copy(this.hit3).sub(this.an3);
      // incremental signed angle around the axis (allows more than half a turn)
      const s = this.ax3.dot(this.v.copy(D.prev).cross(this.r1)), c = D.prev.dot(this.r1);
      D.acc += Math.atan2(s, c); D.prev.copy(this.r1);
      delta = D.acc;
    }
    const j = D.j, [lo, hi] = this.lim[j];
    let q = D.q0 + delta;
    const stop = q < lo || q > hi;
    q = Math.max(lo, Math.min(hi, q));
    this.app.setCtrl(j, q);
    if (j === 5) this.ux.ctl.grip = q;
    this.light(D.part, stop); this.showRing(j, this.r1.lengthSq() ? this.r1 : null, stop); this.showLabel(j, e.clientX, e.clientY, stop);
    if (stop && !D.stopNoted) { D.stopNoted = true; this.ux.sound.blip(160, 0.06, 'square', 0.05); this.ux.sound.vibrate(15); }
    if (!stop) D.stopNoted = false;
    return true;
  }
  up(e, cancelled) {
    const P = this.pend;
    if (P && e.pointerId === P.id) {
      this.pend = null;
      if (!cancelled) this.tap(P.part, e);
      return true;
    }
    const D = this.drag;
    if (D && e.pointerId === D.id) {
      this.drag = null;
      if (D.pull) this.endPull();
      this.ux.onboarding.notify('link');
      setTimeout(() => { if (!this.drag && !this.pend && this.sel < 0) this.clear(); }, 900);
      return true;
    }
    return false;
  }
  cancelPress() { if (this.drag && this.drag.pull) this.endPull(); this.pend = null; this.drag = null; this.clear(); }

  startDrag(P) {
    const ux = this.ux, j = P.part.j;
    ux.ctl.cancel(); ux.pending = null; ux.app.stopDemo(); ux.runner.start();
    if (this.pull() && P.point) { this.startPull(P); return; }
    // the controller's commanded grip / joint follow the hand from here on
    this.frame(j);
    this.setRay({ clientX: P.x, clientY: P.y });
    const dirDot = Math.abs(this.ray.ray.direction.dot(this.ax3));
    const D = this.drag = { id: P.id, j, part: P.part, q0: this.app.d.ctrl[this.app.act[j]], acc: 0, prev: new this.T.Vector3(), x: P.x, y: P.y, edge: dirDot < 0.2 };
    if (!D.edge) {
      this.plane.setFromNormalAndCoplanarPoint(this.ax3, this.an3);
      if (this.ray.ray.intersectPlane(this.plane, this.hit3)) D.prev.copy(this.hit3).sub(this.an3);
      else D.edge = true;
    }
    if (ux.mode === 'smart') ux.ctl.syncFromCtrl();
  }

  // ---------- pull mode (physics grab, default) ----------
  /** 'pull' (whole chain gives way, default) or 'joint' (one joint at a time). Never pull with ?real=1 armed. */
  pull() { return this.mode === 'pull' && !this.realArmed; }
  setMode(m) { this.mode = m === 'joint' ? 'joint' : 'pull'; store.set('grab-mode', this.mode); }
  startPull(P) {
    const ux = this.ux, W = this.app.world;
    W.updateMatrixWorld();
    this.v.copy(P.point); W.worldToLocal(this.v);
    ux.grab.start(P.part.body, this.v.x, this.v.y, this.v.z);
    // camera-facing plane through the grab point
    this.plane.setFromNormalAndCoplanarPoint(this.app.camera.getWorldDirection(this.v2).negate(), P.point);
    this.drag = { id: P.id, pull: true, part: P.part, x: P.x, y: P.y, stopNoted: false };
    this.spring.visible = true;
    this.ux.onboarding.notify('link');
  }
  endPull() {
    const ux = this.ux;
    ux.grab.release();
    this.spring.visible = false;
    if (ux.mode === 'smart') ux.ctl.syncFromCtrl();
  }
  showPullLabel(x, y) {
    const st = this.ux.panel.stage.getBoundingClientRect(), g = this.ux.grab;
    const lim = g.active && g.atLimit >= 0, t = lim ? `${NAMES[g.atLimit]} · doraz` : (g.active ? 'Táhněte – ruka povolí' : 'Uchopte a táhněte');
    if (this.label.textContent !== t) this.label.textContent = t;
    this.label.classList.toggle('stop', lim);
    this.label.hidden = false;
    this.label.style.transform = `translate(${Math.round(Math.min(x - st.left + 16, st.width - 200))}px, ${Math.round(Math.max(8, y - st.top - 40))}px)`;
  }
  /** per frame: spring line from the grab point to the cursor; colour / thickness = force */
  tickPull() {
    const g = this.ux.grab, D = this.drag;
    if (!g.active || !D || !D.pull) return;
    const p = g.point(this.gp), t = g.target, S = this.spring;
    const dx = t[0] - p[0], dy = t[1] - p[1], dz = t[2] - p[2], L = Math.hypot(dx, dy, dz) || 1e-6;
    const f = Math.min(1, g.force / 12);
    S.position.set((p[0] + t[0]) / 2, (p[1] + t[1]) / 2, (p[2] + t[2]) / 2);
    this.v2.set(dx / L, dy / L, dz / L); S.quaternion.setFromUnitVectors(this.yAxis, this.v2);
    S.scale.set(0.6 + 1.6 * f, L, 0.6 + 1.6 * f);
    this.springMat.color.setRGB(0.12 + 0.85 * f, 0.23 + 0.05 * f, 1 - 0.9 * f);   // blue → red with force
    this.cursor.position.set(t[0], t[1], t[2]); this.cursor.visible = true;
    const lim = g.atLimit >= 0;
    if (lim && !D.stopNoted) { D.stopNoted = true; this.ux.sound.blip(160, 0.06, 'square', 0.05); this.ux.sound.vibrate([12, 30, 12]); this.light(D.part, true); }
    if (!lim && D.stopNoted) { D.stopNoted = false; this.light(D.part, false); }
  }

  tap(part, e) {
    const ux = this.ux, j = part.j, now = performance.now();
    if (JAW_BODIES.has(part.bname)) {          // jaws: tap = open / close (double-tap is just two toggles)
      ux.toggleGrip(); this.lastTap = null;
      this.showLabel(5, e.clientX, e.clientY);
      return;
    }
    const L = this.lastTap;
    if (L && L.j === j && now - L.t < 380) {    // double-tap: this joint back home
      this.lastTap = null;
      ux.ctl.cancel(); ux.pending = null;
      this.app.setCtrl(j, this.home[j]);
      if (ux.mode === 'smart') ux.ctl.syncFromCtrl();
      ux.panel.toast(`${NAMES[j]}: zpět do výchozí polohy`);
      return;
    }
    this.lastTap = { j, t: now };
    this.select(j, e);
  }

  jawHint() {
    if (this.jawHinted) return; this.jawHinted = true;
    if (store.get('tip-jaw', false)) return;
    store.set('tip-jaw', true);
    this.ux.panel.toast(this.ux.touch ? 'Klepnutím chapadlo otevřete / zavřete, tažením nastavíte rozevření' : 'Klepnutím otevřete / zavřete, tažením nastavíte rozevření');
  }

  // ---------- keyboard ----------
  select(j, e) {
    this.sel = j;
    const part = this.parts.find((p) => p.j === j && (j !== 0 || p.bname === 'shoulder')) || this.parts.find((p) => p.j === j);
    this.light(part); this.showRing(j);
    const c = this.app.renderer.domElement.getBoundingClientRect();
    this.showLabel(j, e ? e.clientX : c.left + c.width / 2, e ? e.clientY : c.top + 60);
    this.ux.srSay(`Vybrán kloub ${j + 1}: ${NAMES[j]}. Šipky vlevo a vpravo jím otáčí, Esc výběr zruší.`);
  }
  deselect() { this.sel = -1; this.clear(); }
  nudge(dir, big) {
    const j = this.sel; if (j < 0) return false;
    const ux = this.ux; ux.ctl.cancel(); ux.pending = null; ux.runner.start();
    const step = (big ? 10 : 2) * Math.PI / 180 * (j === 5 ? 1.5 : 1);
    const [lo, hi] = this.lim[j], v = this.app.d.ctrl[this.app.act[j]] + dir * step;
    const stop = v < lo || v > hi;
    this.app.setCtrl(j, Math.max(lo, Math.min(hi, v)));
    if (ux.mode === 'smart') ux.ctl.syncFromCtrl();
    const c = this.app.renderer.domElement.getBoundingClientRect();
    this.showRing(j, null, stop); this.showLabel(j, c.left + c.width / 2, c.top + 60, stop);
    if (stop) ux.sound.blip(160, 0.06, 'square', 0.05);
    return true;
  }
  /** keep the ring on the moving joint */
  tick() {
    if (this.sel >= 0 && !this.drag) this.showRing(this.sel, null, false);
    if (this.drag && this.drag.pull) this.tickPull(); else if (this.cursor.visible) { this.cursor.visible = false; this.spring.visible = false; }
  }
}
