// Arena hazards. Each hazard is a real Rapier body (kinematic or fixed) for contact, plus a
// scripted "hit" impulse so it reads clearly at 150 g scale. Every hazard telegraphs before it
// acts (lamps, floor rings, HUD status) and reports through api.emit(type, detail):
//   'warn'   { hazard, x, z }                hazard is about to act (sound: siren / click)
//   'strike' { hazard, x, y, z, energy }     hazard fired (sound: thump / pneumatic)
//   'hit'    { hazard, robot, x, y, z, energy } a robot was struck (sparks, shake, crowd)
//   'pit-open' { x, z }                      pit release
// Interface (internal to maps/): build(group), attach(RAPIER, world, bodies), reset(),
// step(dt, robots, t, active), frame(dt), hazardAt(x, z), status?() -> string|null
import * as THREE from 'three';
import { ORANGE, INK, stripeTexture, plateTexture, worldUV, lampMaterial, boxGeo, merge, mesh, glowTexture, GRIP_FRICTION, BASE_Y } from './kit.js';

const _imp = { x: 0, y: 0, z: 0 }, _av = { x: 0, y: 0, z: 0 }, _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
const smooth = t => t * t * (3 - 2 * t);
const clamp01 = t => Math.max(0, Math.min(1, t));

// kick a robot: impulse in units of its mass (Δv), plus an added spin (rad/s)
export function kick(r, vx, vy, vz, sx = 0, sy = 0, sz = 0) {
  const b = r.body, m = b.mass();
  _imp.x = vx * m; _imp.y = vy * m; _imp.z = vz * m;
  b.applyImpulse(_imp, true);
  const w = b.angvel();
  _av.x = w.x + sx; _av.y = w.y + sy; _av.z = w.z + sz;
  b.setAngvel(_av, true);
}
const rnd = (a, b) => a + Math.random() * (b - a);

// a robot that is not in the arena any more (pit, outside) is ignored by hazards
const alive = p => p.y > -0.4 && p.y < 3;

// ---------------------------------------------------------------- saw blade texture (shared)
let sawTex = null;
function sawTexture() {
  if (sawTex) return sawTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  g.fillStyle = '#c8cacc';
  g.beginPath();
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + 0.7) / n * Math.PI * 2, a2 = (i + 1) / n * Math.PI * 2;
    g.lineTo(Math.cos(a0) * 104, Math.sin(a0) * 104);
    g.lineTo(Math.cos(a1) * 127, Math.sin(a1) * 127);
    g.lineTo(Math.cos(a2) * 104, Math.sin(a2) * 104);
  }
  g.closePath(); g.fill();
  g.strokeStyle = '#9a9c9f'; g.lineWidth = 3;
  for (let r = 30; r < 100; r += 14) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = ORANGE; g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.beginPath(); g.arc(Math.cos(a) * 60, Math.sin(a) * 60, 9, 0, Math.PI * 2); g.fill(); }
  sawTex = new THREE.CanvasTexture(c); sawTex.colorSpace = THREE.SRGBColorSpace;
  return sawTex;
}
function sawMaterial() {
  return new THREE.MeshStandardMaterial({ map: sawTexture(), alphaTest: 0.5, metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide });
}

// ---------------------------------------------------------------- warning ring on the floor
let ringTex = null;
function warnRing(group, x, z, r) {
  if (!ringTex) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.translate(128, 128);
    for (let i = 0; i < 24; i++) {
      g.fillStyle = i % 2 ? INK : ORANGE;
      g.beginPath(); g.arc(0, 0, 126, i / 24 * Math.PI * 2, (i + 1) / 24 * Math.PI * 2); g.arc(0, 0, 108, (i + 1) / 24 * Math.PI * 2, i / 24 * Math.PI * 2, true); g.fill();
    }
    ringTex = new THREE.CanvasTexture(c); ringTex.colorSpace = THREE.SRGBColorSpace;
  }
  const mat = new THREE.MeshStandardMaterial({ map: ringTex, transparent: true, roughness: 0.7, depthWrite: false, emissive: ORANGE, emissiveIntensity: 0, emissiveMap: ringTex, polygonOffset: true, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.005, z); m.receiveShadow = true; m.renderOrder = 1;
  group.add(m);
  return mat;
}
// pulsing additive glow under a hazard while it warns
function glowDisc(group, x, z, r, color = ORANGE) {
  const mat = new THREE.MeshBasicMaterial({ map: glowTexture(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); m.renderOrder = 4;
  group.add(m);
  return mat;
}

// ================================================================= HAMMER
// A steel hammer on a column in the arena corner. It strikes when a robot loiters in its zone
// (like a hazard operator would) or at the latest every `period` seconds. The head stops just
// above a robot's lid, the hit itself is a scripted bounce + tumble that can flip a robot.
export class Hammer {
  constructor({ pivot, target, height = 0.95, period = 11, name = 'Kladivo' }) {
    this.name = name; this.id = 'hammer';
    this.px = pivot[0]; this.pz = pivot[1]; this.py = height;
    this.tx = target[0]; this.tz = target[1];
    const dx = this.tx - this.px, dz = this.tz - this.pz;
    this.L = Math.hypot(dx, dz); this.dx = dx / this.L; this.dz = dz / this.L;
    this.axis = new THREE.Vector3(-this.dz, 0, this.dx);   // rotating +θ lifts the arm
    this.yaw = Math.atan2(this.dx, this.dz);
    this.period = period; this.zoneR = 1.35;
    this.up = 1.2; this.theta = this.up;
    this.reset();
  }
  reset() { this.state = 'idle'; this.st = 0; this.loiter = 0; this.since = 0; this.theta = this.up; this.didHit = false; (this.victims ||= []).length = 0; }
  build(group) {
    const g = new THREE.Group(); g.position.set(this.px, this.py, this.pz); group.add(g);
    // column + base plate (static)
    const steel = new THREE.MeshStandardMaterial({ color: '#5d6166', metalness: 0.7, roughness: 0.35 });
    const col = mesh(merge([boxGeo(-0.22, 0.22, -this.py, 0.15, -0.22, 0.22), boxGeo(-0.45, 0.45, -this.py, -this.py + 0.04, -0.45, 0.45)]), steel, { cast: true });
    g.add(col);
    // swinging arm: built along +z in a yawed frame, rotated about the hinge axis
    this.arm = new THREE.Group(); g.add(this.arm);
    const yawed = new THREE.Group(); yawed.rotation.y = this.yaw; this.arm.add(yawed);
    const dark = new THREE.MeshStandardMaterial({ color: '#2b2d30', metalness: 0.6, roughness: 0.4 });
    yawed.add(mesh(boxGeo(-0.09, 0.09, -0.09, 0.09, 0, this.L), dark, { cast: true }));
    const stripes = stripeTexture(INK, ORANGE); stripes.repeat.set(3, 3);
    const headMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: stripes, metalness: 0.3, roughness: 0.45 });
    const head = mesh(boxGeo(-0.45, 0.45, -0.55, 0.05, this.L - 0.45, this.L + 0.45), headMat, { cast: true });
    yawed.add(head);
    // lamp on the column
    this.lamp = lampMaterial(ORANGE);
    const lamp = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 12), this.lamp); lamp.position.y = 0.26; g.add(lamp);
    this.ring = warnRing(group, this.tx, this.tz, this.zoneR);
    this.glow = glowDisc(group, this.tx, this.tz, this.zoneR * 1.3);
    this.applyPose();
  }
  attach(RAPIER, world, bodies) {
    this.RAPIER = RAPIER;
    const col = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.22, (this.py + 0.15) / 2, 0.22).setTranslation(this.px, (this.py + 0.15) / 2, this.pz).setFriction(0.3), col);
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.px, this.py, this.pz));
    _q.setFromAxisAngle(_ax.set(0, 1, 0), this.yaw);
    const rot = { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
    // local frame = world frame at θ = 0; arm along (dx, dz)
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.45, 0.3, 0.45).setRotation(rot).setTranslation(this.dx * this.L, -0.25, this.dz * this.L).setFriction(0.4), b);
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.09, 0.09, this.L / 2).setRotation(rot).setTranslation(this.dx * this.L / 2, 0, this.dz * this.L / 2), b);
    this.body = b; bodies.push(b, col);
    this.applyPose(true);
  }
  applyPose(teleport) {
    _q.setFromAxisAngle(this.axis, this.theta);
    if (this.arm) this.arm.quaternion.copy(_q);
    if (this.body) {
      const r = { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
      if (teleport) this.body.setRotation(r, true); else this.body.setNextKinematicRotation(r);
    }
  }
  step(dt, robots, t, active, api) {
    this.st += dt;
    if (!active) { if (this.state !== 'idle') this.reset(); this.applyPose(); return; }
    this.since += dt;
    // who is under the hammer?
    let inside = false;
    for (const r of robots) {
      if (!r.body) continue;
      const p = r.body.translation();
      if (alive(p) && Math.hypot(p.x - this.tx, p.z - this.tz) < this.zoneR) inside = true;
    }
    switch (this.state) {
      case 'idle':
        this.loiter = inside ? this.loiter + dt : Math.max(0, this.loiter - dt * 0.5);
        if ((this.loiter > 0.35 && this.since > 3.5) || this.since > this.period) {
          this.state = 'warn'; this.st = 0; api.emit('warn', { hazard: 'hammer', x: this.tx, z: this.tz });
        }
        this.theta = this.up; break;
      case 'warn':  // wind-up
        this.theta = this.up + 0.18 * smooth(clamp01(this.st / 0.9));
        if (this.st > 0.9) { this.state = 'strike'; this.st = 0; this.didHit = false; }
        break;
      case 'strike': {
        const k = clamp01(this.st / 0.11);
        this.theta = (this.up + 0.18) * (1 - k * k);
        if (k >= 1 && !this.didHit) {
          this.didHit = true;
          api.emit('strike', { hazard: 'hammer', x: this.tx, y: 0.4, z: this.tz, energy: 1 });
          for (const r of robots) {
            if (!r.body) continue;
            const p = r.body.translation();
            const dx = p.x - this.tx, dz = p.z - this.tz, d = Math.hypot(dx, dz);
            if (!alive(p) || d > 1.05 || p.y > 1.2) continue;
            // smash: shoved out from under the head now, the rebound + tumble comes when the
            // head lifts (an upward kick right now would just hit the head)
            const ux = d > 0.05 ? dx / d : this.dx, uz = d > 0.05 ? dz / d : this.dz;
            kick(r, ux * 3, -1.5, uz * 3, 0, rnd(-4, 4), 0);
            this.victims.push(r);
            api.emit('hit', { hazard: 'hammer', robot: r, x: p.x, y: p.y + 0.4, z: p.z, energy: 1 });
          }
        }
        if (this.st > 0.11) { this.state = 'hold'; this.st = 0; }
        break;
      }
      case 'hold':
        this.theta = 0;
        if (this.st > 0.18) { this.state = 'lift'; this.st = 0; }
        break;
      case 'lift':
        // rebound + tumble once the head is clear
        if (this.victims.length && this.st > 0.3) {
          for (const r of this.victims) {
            if (!r.body) continue;
            const p = r.body.translation();
            if (!alive(p)) continue;
            const s = Math.random() < 0.5 ? -1 : 1;
            kick(r, 0, 7, 0, -this.dz * s * rnd(9, 15), 0, this.dx * s * rnd(9, 15));
          }
          this.victims.length = 0;
        }
        this.theta = this.up * smooth(clamp01(this.st / 1.2));
        if (this.st > 1.2) { this.state = 'idle'; this.st = 0; this.since = 0; this.loiter = 0; }
        break;
    }
    this.applyPose();
  }
  frame(dt) {
    const warn = this.state === 'warn', hot = this.state === 'strike' || this.state === 'hold';
    this.blink = (this.blink || 0) + dt;
    const on = warn ? (Math.sin(this.blink * 28) > 0 ? 1 : 0.1) : hot ? 1 : 0.08 + 0.06 * Math.sin(this.blink * 2);
    this.lamp.setLevel(on);
    this.ring.emissiveIntensity = warn ? on * 1.4 : hot ? 1.2 : 0;
    this.glow.opacity = warn ? on * 0.55 : hot ? 0.8 : 0;
  }
  hazardAt(x, z) { return Math.hypot(x - this.tx, z - this.tz) < this.zoneR + 0.3 && this.state !== 'lift'; }
  status() { return this.state === 'warn' ? 'Pozor, kladivo!' : null; }
}

// ================================================================= SAW STRIP
// A slot in the floor along x or z; discs rise, spin and throw robots, then sink back.
export class SawStrip {
  constructor({ x, z, axis = 'x', len = 3.6, n = 3, radius = 0.62, up = 3, down = 5, offset = 0 }) {
    this.cx = x; this.cz = z; this.axis = axis; this.len = len; this.n = n; this.R = radius;
    this.tUp = up; this.tDown = down; this.offset = offset;
    this.ux = axis === 'x' ? 1 : 0; this.uz = axis === 'x' ? 0 : 1;
    this.yDown = -radius - 0.08; this.yUp = -0.14;
    this.reset();
  }
  reset() { this.h = 0; this.state = 'down'; this.st = -this.offset; this.cool = new Map(); this.spinA = 0; this.y = this.yDown; }
  build(group) {
    // slot + stripes
    const L = this.len + 0.3, W = 0.12;
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(this.axis === 'x' ? L : W, this.axis === 'x' ? W : L), new THREE.MeshBasicMaterial({ color: '#050505', polygonOffset: true, polygonOffsetFactor: -2 }));
    slot.rotation.x = -Math.PI / 2; slot.position.set(this.cx, 0.004, this.cz); group.add(slot);
    const st = stripeTexture(INK, ORANGE), sg = [], lg = [];
    for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(L, 0.14);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * L / 0.6);
      g.rotateX(-Math.PI / 2); g.rotateY(this.axis === 'x' ? 0 : Math.PI / 2);
      g.translate(this.cx + (this.axis === 'x' ? 0 : s * 0.16), 0.004, this.cz + (this.axis === 'x' ? s * 0.16 : 0));
      sg.push(g);
      const lx = this.cx + this.ux * s * (L / 2 + 0.15), lz = this.cz + this.uz * s * (L / 2 + 0.15);
      lg.push(boxGeo(lx - 0.08, lx + 0.08, 0, 0.06, lz - 0.08, lz + 0.08));
    }
    group.add(mesh(merge(sg), new THREE.MeshStandardMaterial({ map: st, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 })));
    // lamps at both ends
    this.lamp = lampMaterial(ORANGE);
    group.add(mesh(merge(lg), this.lamp));
    this.glow = glowDisc(group, this.cx, this.cz, this.len * 0.7);
    // discs: one instanced mesh
    const geo = new THREE.CircleGeometry(this.R, 32);
    this.discs = new THREE.InstancedMesh(geo, sawMaterial(), this.n);
    this.discs.castShadow = true; this.discs.frustumCulled = false;
    group.add(this.discs);
    this.m4 = new THREE.Matrix4(); this.pv = new THREE.Vector3(); this.sv = new THREE.Vector3(1, 1, 1); this.qv = new THREE.Quaternion(); this.qb = new THREE.Quaternion();
    // disc plane contains the strip direction: for an x strip it faces ±z (default circle faces +z)
    this.qb.setFromAxisAngle(_ax.set(0, 1, 0), this.axis === 'x' ? 0 : Math.PI / 2);
    this.frame(0);
  }
  attach(RAPIER, world, bodies) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.cx, this.yDown, this.cz));
    // cylinder axis (Y) turned to the disc normal
    _q.setFromAxisAngle(_ax.set(this.axis === 'x' ? 1 : 0, 0, this.axis === 'x' ? 0 : 1), Math.PI / 2);
    const rot = { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
    for (let i = 0; i < this.n; i++) {
      const o = (i - (this.n - 1) / 2) * (this.len / this.n);
      world.createCollider(RAPIER.ColliderDesc.cylinder(0.05, this.R).setRotation(rot).setTranslation(this.ux * o, 0, this.uz * o).setFriction(0.1), b);
    }
    this.body = b; bodies.push(b);
    this.pos = { x: this.cx, y: this.yDown, z: this.cz };
  }
  step(dt, robots, t, active, api) {
    if (!active) { if (this.state !== 'down' || this.st > 0) this.reset(); this.move(); return; }
    this.st += dt;
    switch (this.state) {
      case 'down': if (this.st > this.tDown) { this.state = 'warn'; this.st = 0; api.emit('warn', { hazard: 'saw', x: this.cx, z: this.cz }); } break;
      case 'warn': if (this.st > 0.9) { this.state = 'rise'; this.st = 0; api.emit('strike', { hazard: 'saw', x: this.cx, y: 0, z: this.cz, energy: 0.6 }); } break;
      case 'rise': if (this.st > 0.25) { this.state = 'up'; this.st = 0; } break;
      case 'up': if (this.st > this.tUp) { this.state = 'sink'; this.st = 0; } break;
      case 'sink': if (this.st > 0.5) { this.state = 'down'; this.st = 0; } break;
    }
    const h = this.state === 'warn' ? 0.12 * clamp01(this.st / 0.9)
      : this.state === 'rise' ? 0.12 + 0.88 * smooth(clamp01(this.st / 0.25))
      : this.state === 'up' ? 1 : this.state === 'sink' ? 1 - smooth(clamp01(this.st / 0.5)) : 0;
    this.h = h;
    this.y = this.yDown + (this.yUp - this.yDown) * h;
    this.move();
    if (h < 0.5) return;
    for (const r of robots) {
      if (!r.body) continue;
      const c = this.cool.get(r) || 0;
      if (c > 0) { this.cool.set(r, c - dt); continue; }
      const p = r.body.translation();
      if (!alive(p) || p.y > 1.1) continue;
      const rx = p.x - this.cx, rz = p.z - this.cz;
      const along = rx * this.ux + rz * this.uz, perp = rx * this.uz - rz * this.ux;
      if (Math.abs(along) > this.len / 2 + 0.35 || Math.abs(perp) > 0.62) continue;
      // thrown up and away from the slot, dragged along the spin direction
      const s = Math.sign(perp) || 1;
      const px = this.uz * s, pz = -this.ux * s;
      kick(r, px * 4 + this.ux * 2.5, 6.5, pz * 4 + this.uz * 2.5, rnd(-8, 8), rnd(-6, 6), rnd(-8, 8));
      this.cool.set(r, 0.35);
      api.emit('hit', { hazard: 'saw', robot: r, x: p.x - px * 0.4, y: 0.25, z: p.z - pz * 0.4, energy: 0.75 });
    }
  }
  move() { if (this.body) { this.pos.y = this.y; this.body.setNextKinematicTranslation(this.pos); } }
  frame(dt) {
    this.blink = (this.blink || 0) + dt;
    const warn = this.state === 'warn';
    const on = warn ? (Math.sin(this.blink * 26) > 0 ? 1 : 0.1) : this.h > 0.3 ? 0.9 : 0.05;
    this.lamp.setLevel(on);
    this.glow.opacity = warn ? on * 0.4 : this.h > 0.3 ? 0.35 : 0;
    this.spinA -= dt * (this.h > 0 ? 30 : 0);
    for (let i = 0; i < this.n; i++) {
      const o = (i - (this.n - 1) / 2) * (this.len / this.n);
      this.qv.setFromAxisAngle(_ax.set(0, 0, 1), this.spinA + i).premultiply(this.qb);
      this.m4.compose(this.pv.set(this.cx + this.ux * o, this.y, this.cz + this.uz * o), this.qv, this.sv);
      this.discs.setMatrixAt(i, this.m4);
    }
    this.discs.instanceMatrix.needsUpdate = true;
  }
  hazardAt(x, z) {
    if (this.state === 'down' && this.st < this.tDown - 1.2) return false;
    const rx = x - this.cx, rz = z - this.cz;
    return Math.abs(rx * this.ux + rz * this.uz) < this.len / 2 + 0.6 && Math.abs(rx * this.uz - rz * this.ux) < 0.9;
  }
}

// ================================================================= KILL SAW (always on, in a wall)
export class KillSaw {
  // x, z: centre on the wall's inner face; nx, nz: normal pointing into the arena
  constructor({ x, z, nx, nz, radius = 0.75 }) {
    this.x = x; this.z = z; this.nx = nx; this.nz = nz; this.R = radius; this.cool = new Map(); this.a = 0; this.cy = 0.18;
  }
  reset() { this.cool.clear(); }
  build(group) {
    const g = new THREE.Group(); g.position.set(this.x, this.cy, this.z);
    g.rotation.y = Math.atan2(this.nx, this.nz) + Math.PI / 2;   // disc plane contains the normal
    group.add(g);
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(this.R, 32), sawMaterial()); this.disc.castShadow = true;
    g.add(this.disc);
    // housing: dark box behind the wall + orange guard frame on the floor
    // (local -x points into the arena, +x into the wall)
    g.add(mesh(boxGeo(0.1, this.R + 0.2, -this.cy, this.R - this.cy + 0.25, -0.16, 0.16), new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.6 }), { cast: true }));
    this.glow = glowDisc(group, this.x + this.nx * 0.4, this.z + this.nz * 0.4, 1.0);
    this.glow.opacity = 0.25;
  }
  attach(RAPIER, world, bodies) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // flat cylinder; axis perpendicular to both the wall normal and up
    _q.setFromAxisAngle(_ax.set(this.nx, 0, this.nz), Math.PI / 2);
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.05, this.R).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }).setTranslation(this.x, this.cy, this.z).setFriction(0.1), b);
    bodies.push(b);
  }
  step(dt, robots, t, active, api) {
    for (const r of robots) {
      if (!r.body) continue;
      const c = this.cool.get(r) || 0;
      if (c > 0) { this.cool.set(r, c - dt); continue; }
      const p = r.body.translation();
      if (!alive(p) || p.y > 1.2) continue;
      const dx = p.x - this.x, dz = p.z - this.z;
      const out = dx * this.nx + dz * this.nz, side = Math.abs(dx * this.nz - dz * this.nx);
      if (out < 0 || out > this.R + 0.5 || side > 0.62) continue;
      kick(r, this.nx * 7, 5, this.nz * 7, rnd(-10, 10), rnd(-8, 8), rnd(-10, 10));
      this.cool.set(r, 0.4);
      api.emit('hit', { hazard: 'killsaw', robot: r, x: this.x + this.nx * 0.5, y: 0.3, z: this.z + this.nz * 0.5, energy: 0.9 });
    }
  }
  frame(dt) { this.a += dt * 34; this.disc.rotation.z = this.a; }
  hazardAt(x, z) { const dx = x - this.x, dz = z - this.z; return Math.hypot(dx, dz) < this.R + 1.0; }
}

// ================================================================= FLOOR FLIPPER
// A hinged steel panel set in the floor (hole in the floor, shallow well beneath). A robot that
// sits on it for a moment gets launched; the hinge is the `hinge` edge: 'x0' | 'x1' | 'z0' | 'z1'.
export class FloorFlipper {
  constructor({ x0, x1, z0, z1, hinge = 'x0', angle = 0.95, cool = 2.6 }) {
    Object.assign(this, { x0, x1, z0, z1, hinge, angle, cooldown: cool });
    const hx = hinge === 'x0' ? x0 : hinge === 'x1' ? x1 : (x0 + x1) / 2;
    const hz = hinge === 'z0' ? z0 : hinge === 'z1' ? z1 : (z0 + z1) / 2;
    this.hx = hx; this.hz = hz;
    // direction from hinge into the panel
    this.dx = hinge === 'x0' ? 1 : hinge === 'x1' ? -1 : 0; this.dz = hinge === 'z0' ? 1 : hinge === 'z1' ? -1 : 0;
    this.len = this.dx ? x1 - x0 : z1 - z0; this.wid = this.dx ? z1 - z0 : x1 - x0;
    this.axis = new THREE.Vector3(this.dz, 0, -this.dx);   // +θ lifts the free edge
    this.reset();
  }
  // floor hole to leave out of the floor rects (the map does that)
  get hole() { return { x0: this.x0, x1: this.x1, z0: this.z0, z1: this.z1 }; }
  reset() { this.state = 'idle'; this.st = 0; this.load = 0; this.theta = 0; this.cool = 0; }
  build(group) {
    const g = new THREE.Group(); g.position.set(this.hx, 0, this.hz); group.add(g);
    this.pivot = g;
    const st = stripeTexture(INK, ORANGE);
    const plate = new THREE.MeshStandardMaterial({ color: '#c4c8cc', map: plateTexture(), metalness: 0.6, roughness: 0.4 });
    const geo = this.dx ? boxGeo(0, this.len, -0.1, 0, -this.wid / 2, this.wid / 2) : boxGeo(-this.wid / 2, this.wid / 2, -0.1, 0, 0, this.len);
    const m = mesh(worldUV(geo, 2), plate, { cast: true });
    if (this.dx < 0 || this.dz < 0) m.scale.set(this.dx < 0 ? -1 : 1, 1, this.dz < 0 ? -1 : 1);
    g.add(m);
    // stripe border on the plate (slightly above it, moves with it)
    const border = [];
    const L = this.len, W = this.wid;
    const sgeo = (len, x, z, rot) => { const pg = new THREE.PlaneGeometry(len, 0.14); const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 0.6); pg.rotateX(-Math.PI / 2); pg.rotateY(rot); pg.translate(x, 0.004, z); return pg; };
    if (this.dx) { const s = this.dx; border.push(sgeo(L, s * L / 2, -W / 2 + 0.07, 0), sgeo(L, s * L / 2, W / 2 - 0.07, 0), sgeo(W, s * (L - 0.07), 0, Math.PI / 2)); }
    else { const s = this.dz; border.push(sgeo(L, -W / 2 + 0.07, s * L / 2, Math.PI / 2), sgeo(L, W / 2 - 0.07, s * L / 2, Math.PI / 2), sgeo(W, 0, s * (L - 0.07), 0)); }
    g.add(mesh(merge(border), new THREE.MeshStandardMaterial({ map: st, roughness: 0.7 })));
    // well under the panel
    const well = mesh(boxGeo(this.x0, this.x1, -0.5, -0.45, this.z0, this.z1), new THREE.MeshLambertMaterial({ color: '#141414' }));
    group.add(well);
    // pneumatic ram (visual only)
    this.ram = mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 8), new THREE.MeshStandardMaterial({ color: '#c0c3c6', metalness: 0.8, roughness: 0.25 }));
    group.add(this.ram);
    this.lamp = lampMaterial(ORANGE);
    const lp = mesh(new THREE.BoxGeometry(0.18, 0.05, 0.18), this.lamp);
    lp.position.set(this.hx + (this.dx ? 0 : W / 2 + 0.2), 0.025, this.hz + (this.dx ? W / 2 + 0.2 : 0));
    group.add(lp);
    this.glow = glowDisc(group, (this.x0 + this.x1) / 2, (this.z0 + this.z1) / 2, Math.max(L, W) * 0.75);
    this.applyPose();
  }
  attach(RAPIER, world, bodies) {
    const well = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.cuboid((this.x1 - this.x0) / 2, 0.25, (this.z1 - this.z0) / 2).setTranslation((this.x0 + this.x1) / 2, -0.7, (this.z0 + this.z1) / 2).setFriction(GRIP_FRICTION), well);
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.hx, 0, this.hz));
    const hx = this.dx ? this.len / 2 : this.wid / 2, hz = this.dx ? this.wid / 2 : this.len / 2;
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx - 0.01, 0.05, hz - 0.01).setTranslation(this.dx * this.len / 2, -0.05, this.dz * this.len / 2).setFriction(GRIP_FRICTION), b);
    this.body = b; bodies.push(b, well);
    this.applyPose(true);
  }
  applyPose(teleport) {
    _q.setFromAxisAngle(this.axis, this.theta);
    if (this.pivot) {
      this.pivot.quaternion.copy(_q);
      // ram from the well floor to the panel's middle
      const mx = this.hx + this.dx * this.len * 0.5 * Math.cos(this.theta), mz = this.hz + this.dz * this.len * 0.5 * Math.cos(this.theta);
      const my = this.len * 0.5 * Math.sin(this.theta) - 0.1;
      const by = -0.45, h = Math.max(0.05, my - by);
      this.ram.position.set(mx, by + h / 2, mz); this.ram.scale.y = h;
    }
    if (this.body) {
      const r = { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
      if (teleport) this.body.setRotation(r, true); else this.body.setNextKinematicRotation(r);
    }
  }
  on(p) { return p.x > this.x0 - 0.15 && p.x < this.x1 + 0.15 && p.z > this.z0 - 0.15 && p.z < this.z1 + 0.15 && p.y > -0.5 && p.y < 0.9; }
  step(dt, robots, t, active, api) {
    if (!active) { if (this.state !== 'idle' || this.theta) this.reset(); this.applyPose(); return; }
    this.st += dt; this.cool -= dt;
    let any = false;
    for (const r of robots) if (r.body && this.on(r.body.translation())) any = true;
    switch (this.state) {
      case 'idle':
        this.load = any ? this.load + dt : 0;
        if (this.load > 0.3 && this.cool <= 0) { this.state = 'warn'; this.st = 0; api.emit('warn', { hazard: 'flipper', x: this.hx, z: this.hz }); }
        this.theta = 0; break;
      case 'warn': if (this.st > 0.45) {
        this.state = 'fire'; this.st = 0;
        api.emit('strike', { hazard: 'flipper', x: (this.x0 + this.x1) / 2, y: 0, z: (this.z0 + this.z1) / 2, energy: 0.8 });
        for (const r of robots) {
          if (!r.body) continue;
          const p = r.body.translation();
          if (!this.on(p)) continue;
          // further from the hinge = more lift; rotation about the hinge axis flips the robot
          const f = 0.45 + 0.55 * clamp01(((p.x - this.hx) * this.dx + (p.z - this.hz) * this.dz) / this.len);
          kick(r, -this.dx * 2.2 * f, 8 + 4 * f, -this.dz * 2.2 * f, this.axis.x * 9 * f, rnd(-2, 2), this.axis.z * 9 * f);
          api.emit('hit', { hazard: 'flipper', robot: r, x: p.x, y: p.y, z: p.z, energy: 0.6 });
        }
      } break;
      case 'fire': this.theta = this.angle * smooth(clamp01(this.st / 0.12)); if (this.st > 0.12) { this.state = 'hold'; this.st = 0; } break;
      case 'hold': this.theta = this.angle; if (this.st > 0.4) { this.state = 'back'; this.st = 0; } break;
      case 'back': this.theta = this.angle * (1 - smooth(clamp01(this.st / 0.8))); if (this.st > 0.8) { this.state = 'idle'; this.st = 0; this.cool = this.cooldown; this.load = 0; } break;
    }
    this.applyPose();
  }
  frame(dt) {
    this.blink = (this.blink || 0) + dt;
    const warn = this.state === 'warn';
    const on = warn ? (Math.sin(this.blink * 30) > 0 ? 1 : 0.1) : this.state === 'idle' ? (this.cool > 0 ? 0.05 : 0.25 + 0.15 * Math.sin(this.blink * 3)) : 1;
    this.lamp.setLevel(on);
    this.glow.opacity = warn ? on * 0.5 : 0;
  }
  hazardAt(x, z) { return x > this.x0 - 0.3 && x < this.x1 + 0.3 && z > this.z0 - 0.3 && z < this.z1 + 0.3; }
}

// ================================================================= PIT RELEASE
// A pit hidden under a cover; the cover drops at `openAt` seconds of fight time (with a
// countdown on the HUD via status()). Robots on the cover ride it down into the pit.
export class PitRelease {
  constructor({ x0, x1, z0, z1, openAt = 60, warnFor = 6, surface }) {
    Object.assign(this, { x0, x1, z0, z1, openAt, warnFor, surface });
    this.cx = (x0 + x1) / 2; this.cz = (z0 + z1) / 2;
    this.reset();
  }
  get pit() { return { x0: this.x0, x1: this.x1, z0: this.z0, z1: this.z1 }; }
  reset() { this.y = 0; this.open = false; this.t = 0; this.warned = false; }
  build(group) {
    const w = this.x1 - this.x0, d = this.z1 - this.z0;
    const top = new THREE.PlaneGeometry(w - 0.02, d - 0.02); top.rotateX(-Math.PI / 2);
    // world-aligned UVs so the floor pattern continues across the cover
    const uv = top.attributes.uv, p = top.attributes.position;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + this.cx) / 2, -(p.getZ(i) + this.cz) / 2);
    this.g = new THREE.Group(); this.g.position.set(this.cx, 0, this.cz); group.add(this.g);
    this.g.add(mesh(top, this.surface));
    const side = mesh(boxGeo(-w / 2 + 0.01, w / 2 - 0.01, -0.12, -0.002, -d / 2 + 0.01, d / 2 - 0.01), new THREE.MeshLambertMaterial({ color: '#1d1d1d' }));
    this.g.add(side);
    // seam + corner lamps
    const seam = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)), new THREE.LineBasicMaterial({ color: '#111', transparent: true, opacity: 0.7 }));
    seam.position.set(this.cx, 0.006, this.cz); group.add(seam);
    this.lamp = lampMaterial(ORANGE);
    const lg = [];
    for (const [x, z] of [[this.x0, this.z0], [this.x1, this.z0], [this.x0, this.z1], [this.x1, this.z1]]) lg.push(boxGeo(x - 0.1, x + 0.1, 0, 0.04, z - 0.1, z + 0.1));
    group.add(mesh(merge(lg), this.lamp));
    this.glow = glowDisc(group, this.cx, this.cz, Math.max(w, d) * 0.8);
  }
  attach(RAPIER, world, bodies) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.cx, 0, this.cz));
    world.createCollider(RAPIER.ColliderDesc.cuboid((this.x1 - this.x0) / 2 - 0.01, 0.06, (this.z1 - this.z0) / 2 - 0.01).setTranslation(0, -0.06, 0).setFriction(GRIP_FRICTION), b);
    this.body = b; bodies.push(b); this.pos = { x: this.cx, y: 0, z: this.cz };
  }
  step(dt, robots, t, active, api) {
    if (!active) { if (this.open || this.t) this.reset(); this.move(); return; }
    this.t = t;
    if (!this.warned && t > this.openAt - this.warnFor) { this.warned = true; api.emit('warn', { hazard: 'pit', x: this.cx, z: this.cz }); }
    if (!this.open && t >= this.openAt) { this.open = true; api.emit('pit-open', { x: this.cx, z: this.cz }); api.emit('strike', { hazard: 'pit', x: this.cx, y: 0, z: this.cz, energy: 0.4 }); }
    if (this.open && this.y > BASE_Y + 0.15) this.y = Math.max(BASE_Y + 0.15, this.y - dt * (0.6 + (-this.y) * 4));
    this.move();
  }
  move() { if (this.body) { this.pos.y = this.y; this.body.setNextKinematicTranslation(this.pos); } }
  frame(dt) {
    this.blink = (this.blink || 0) + dt;
    this.g.position.y = this.y;
    const warn = this.warned && !this.open;
    const on = warn ? (Math.sin(this.blink * (10 + 20 * clamp01((this.t - this.openAt + this.warnFor) / this.warnFor))) > 0 ? 1 : 0.1) : this.open ? 0.9 : 0.06;
    this.lamp.setLevel(on);
    this.glow.opacity = warn ? on * 0.35 : 0;
  }
  hazardAt(x, z) { return (this.open || this.warned) && x > this.x0 - 0.5 && x < this.x1 + 0.5 && z > this.z0 - 0.5 && z < this.z1 + 0.5; }
  // the pit only counts once open
  isPit(x, z) { return this.open && x > this.x0 && x < this.x1 && z > this.z0 && z < this.z1; }
  status() {
    if (this.open) return null;
    const left = Math.ceil(this.openAt - this.t);
    return this.warned ? `Jáma se otevře za ${left} s` : null;
  }
}
