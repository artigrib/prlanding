// Camera rig: broadcast TV, chase, top-down, robot-mounted FPV and a cinematic orbit (replays).
// Every mode produces a desired pose; switching modes blends from the previous pose.
import * as THREE from 'three';

export const CAM_MODES = [
  { id: 'tv', name: 'TV přenos' },
  { id: 'chase', name: 'Za robotem' },
  { id: 'top', name: 'Shora' },
  { id: 'fpv', name: 'Z robota (FPV)' }
];

const _p = new THREE.Vector3(), _l = new THREE.Vector3(), _u = new THREE.Vector3(), _n = new THREE.Vector3(), _f = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ease = t => t * t * (3 - 2 * t);
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class CameraRig {
  constructor(camera, { reduceMotion = false } = {}) {
    this.camera = camera;
    this.mode = 'tv';
    this.reduce = reduceMotion;
    this.dummy = new THREE.PerspectiveCamera();
    this.blend = 1; this.fromPos = new THREE.Vector3(); this.fromQ = new THREE.Quaternion(); this.fromFov = 38;
    this.tv = { target: new THREE.Vector3(), dist: 20, init: false };
    this.chase = { pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, init: false };
    this.orbit = { center: new THREE.Vector3(), angle: 0.6, radius: 4.6, height: 2.3 };
    this.fit = { key: '', d: 0, pts: Array.from({ length: 8 }, () => new THREE.Vector3()) };
    this.shakeAmt = 0;
  }
  set(mode, instant = false) {
    if (mode === this.mode && !instant) return;
    const c = this.camera;
    this.fromPos.copy(c.position); this.fromQ.copy(c.quaternion); this.fromFov = c.fov;
    this.blend = instant ? 1 : 0;
    this.mode = mode;
    this.chase.init = false;
  }
  shake(a) { if (!this.reduce) this.shakeAmt = Math.max(this.shakeAmt, a); }
  invalidate() { this.fit.key = ''; }

  // distance at which the box [x0..x1]×[z0..z1] fits the free screen band at elevation `el`
  fitDistance(x0, x1, z0, z1, target, el, band) {
    const { top, bottom, left, right = 0, w, h } = band;
    const key = [x0, x1, z0, z1].map(v => Math.round(v * 8)).join() + `|${el.toFixed(3)}|${top}|${bottom}|${left}|${right}|${w}|${h}|${this.camera.fov}`;
    if (key === this.fit.key) return this.fit.d;
    const cam = this.camera, dir = _f.set(0, Math.sin(el), Math.cos(el));
    const save = cam.position.clone(), saveQ = cam.quaternion.clone(), saveN = cam.near, saveF = cam.far;
    cam.near = 0.1; cam.far = 400; cam.updateProjectionMatrix();
    let i = 0;
    for (const x of [x0, x1]) for (const z of [z0, z1]) for (const y of [-0.5, 1.2]) this.fit.pts[i++].set(x, y, z);
    const fits = d => {
      cam.position.copy(target).addScaledVector(dir, d); cam.up.copy(UP); cam.lookAt(target); cam.updateMatrixWorld();
      for (const p of this.fit.pts) {
        const n = _n.copy(p).project(cam);
        const sx = (n.x + 1) / 2 * w, sy = (1 - n.y) / 2 * h;
        if (n.z > 1 || sx < left + 6 || sx > w - right - 6 || sy < top + 4 || sy > h - bottom - 4) return false;
      }
      return true;
    };
    let lo = 3, hi = 140;
    for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
    cam.position.copy(save); cam.quaternion.copy(saveQ); cam.near = saveN; cam.far = saveF; cam.updateProjectionMatrix();
    this.fit.key = key; this.fit.d = hi;
    return hi;
  }

  // ctx: { focus, other (robots with .root), bounds {x0,x1,z0,z1}, band, follow, snap, orbitCenter }
  update(dt, ctx) {
    const cam = this.camera, d = this.dummy;
    let fov = 38, near = 0.1, far = 90;   // tight near/far: phones with 16-bit depth buffers z-fight otherwise
    const up = _u.copy(UP);
    const focus = ctx.focus && ctx.focus.root, other = ctx.other && ctx.other.root;
    let mode = this.mode;
    if ((mode === 'chase' || mode === 'fpv') && !focus) mode = 'tv';
    const snap = ctx.snap;

    if (mode === 'tv' || mode === 'top') {
      const top = mode === 'top';
      const el = THREE.MathUtils.degToRad(top ? 89 : ctx.portrait ? 64 : 52);
      let { x0, x1, z0, z1 } = ctx.bounds;
      x0 -= 0.3; x1 += 0.3; z0 -= 0.3; z1 += 0.3;
      if (ctx.follow && focus && other && !top) {
        // phones: frame both robots (min 8 × 8 units) so they stay readable
        const a = focus.position, b = other.position;
        const cx = THREE.MathUtils.clamp((a.x + b.x) / 2, x0 + 4, x1 - 4), cz = THREE.MathUtils.clamp((a.z + b.z) / 2, z0 + 4, z1 - 4);
        const hx = Math.max(4.2, Math.abs(a.x - b.x) / 2 + 1.8), hz = Math.max(4.2, Math.abs(a.z - b.z) / 2 + 1.8);
        x0 = Math.max(x0, cx - hx); x1 = Math.min(x1, cx + hx); z0 = Math.max(z0, cz - hz); z1 = Math.min(z1, cz + hz);
      }
      const tgt = _l.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      cam.fov = fov; cam.updateProjectionMatrix();
      const dist = this.fitDistance(x0, x1, z0, z1, tgt, el, ctx.band);
      const s = this.tv, k = snap || !s.init ? 1 : damp(2.2, dt);
      s.init = true;
      s.target.lerp(tgt, k); s.dist += (dist - s.dist) * k;
      _p.copy(s.target).addScaledVector(_f.set(0, Math.sin(el), Math.cos(el)), s.dist);
      _l.copy(s.target);
      if (top) up.set(0, 0, -1);
      near = Math.max(0.1, s.dist - 26); far = s.dist + 30;
    } else if (mode === 'chase') {
      const s = this.chase, rp = focus.position;
      _f.set(0, 0, 1).applyQuaternion(focus.quaternion); _f.y = 0;
      if (_f.lengthSq() > 0.04) {
        const want = Math.atan2(_f.x, _f.z);
        if (!s.init) s.yaw = want;
        let da = want - s.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
        s.yaw += da * (snap || !s.init ? 1 : damp(4, dt));
      }
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      const py = Math.max(rp.y, -2);
      _p.set(rp.x - fx * 3.3, py + 1.9, rp.z - fz * 3.3);
      _l.set(rp.x + fx * 1.4, py + 0.15, rp.z + fz * 1.4);
      if (!s.init || snap) { s.pos.copy(_p); s.look.copy(_l); s.init = true; }
      else { s.pos.lerp(_p, damp(7, dt)); s.look.lerp(_l, damp(9, dt)); }
      _p.copy(s.pos); _l.copy(s.look);
      fov = 58;
    } else if (mode === 'fpv') {
      // mounted on the robot's lid; when it is on its back the "camera mount" self-levels
      focus.updateMatrixWorld();
      const rUp = _n.set(0, 1, 0).applyQuaternion(focus.quaternion);
      _f.set(0, 0, 1).applyQuaternion(focus.quaternion);
      if (rUp.y > 0.25) {
        _p.set(0, 0.46, 0.22); focus.localToWorld(_p);
        _l.set(0, 0.12, 4); focus.localToWorld(_l);
        up.copy(rUp);
      } else {
        _f.y = 0; if (_f.lengthSq() < 1e-4) _f.set(0, 0, 1); _f.normalize();
        const rp = focus.position;
        _p.set(rp.x - _f.x * 0.2, rp.y + 0.5, rp.z - _f.z * 0.2);
        _l.set(rp.x + _f.x * 4, rp.y + 0.1, rp.z + _f.z * 4);
      }
      fov = 74; near = 0.04; far = 60;
    } else if (mode === 'orbit') {
      const o = this.orbit;
      if (!this.reduce && o.auto !== false) o.angle += dt * 0.32;
      const c = ctx.orbitCenter || o.center;
      _p.set(c.x + Math.sin(o.angle) * o.radius, Math.max(0, c.y) + o.height, c.z + Math.cos(o.angle) * o.radius);
      _l.set(c.x, c.y + 0.1, c.z);
      fov = 42;
    }

    d.position.copy(_p); d.up.copy(up); d.lookAt(_l);
    if (this.blend < 1 && !snap) {
      this.blend = Math.min(1, this.blend + dt / (this.reduce ? 0.25 : 0.65));
      const e = ease(this.blend);
      cam.position.lerpVectors(this.fromPos, d.position, e);
      cam.quaternion.slerpQuaternions(this.fromQ, d.quaternion, e);
      cam.fov = this.fromFov + (fov - this.fromFov) * e;
    } else {
      this.blend = 1;
      cam.position.copy(d.position); cam.quaternion.copy(d.quaternion); cam.fov = fov;
    }
    if (this.blend < 1) { near = Math.min(near, 0.1); far = Math.max(far, 200); }
    cam.near = near; cam.far = far;
    cam.updateProjectionMatrix();
    if (this.shakeAmt > 0) {
      const a = this.shakeAmt * (mode === 'fpv' ? 0.25 : 1);
      cam.position.x += (Math.random() - 0.5) * a; cam.position.y += (Math.random() - 0.5) * a;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.4);
    }
  }
}
