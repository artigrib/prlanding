// Weapons as physics.
//
// Spinner (vertical or horizontal): the blade is a flywheel state, not a body.
//   ω' = (τs·(a − ω/ωf) − drag)/I,  E = ½Iω².  The motor's reaction torque spins the chassis the other
//   way (horizontal spinners yaw on spin-up, verticals pitch), and the blade's angular momentum
//   L = Iω·axis makes the chassis precess when it turns (τ = −Ω×L): a vertical spinner leans and
//   lifts a wheel in tight turns.
//   A hit is a 1-D collision along the blade tangent between the blade (effective mass I/r² at the
//   contact radius) and the target: J = (1+e)·m_eff·v_rel·bite. The target gets J at the contact,
//   we get −J at the axle (self-recoil), the blade loses J·r/I of ω. Bite = how deep a tooth gets in
//   before the next one arrives (closing speed vs tooth spacing). Walls are infinite mass.
//   Jam: hit with almost no blade speed left while still touching → ESC stall cut-out; toggle to restart.
//
// Arm (flipper / lifter / grabber): a real rigid body on a revolute joint with an actuator torque
//   applied between arm and chassis (equal and opposite), with a torque–speed curve. The opponent
//   is launched by contact, not by a scripted impulse. A grabber additionally pins the opponent to
//   the forks with a spherical joint while it lifts.
import * as THREE from 'three';

const _p = new THREE.Vector3(), _a = new THREE.Vector3(), _t = new THREE.Vector3(), _r = new THREE.Vector3(),
  _ax = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const imp = { x: 0, y: 0, z: 0 }, pt = { x: 0, y: 0, z: 0 };
const D2R = Math.PI / 180;

// velocity of a body at a world point (into out)
function pointVel(body, p, out) {
  const l = body.linvel(), w = body.angvel(), c = body.worldCom();
  const rx = p.x - c.x, ry = p.y - c.y, rz = p.z - c.z;
  return out.set(l.x + w.y * rz - w.z * ry, l.y + w.z * rx - w.x * rz, l.z + w.x * ry - w.y * rx);
}

// ======================================================================= spinner
export class Spinner {
  constructor(robot, spec) {
    this.r = robot; this.s = spec;
    this.axisL = new THREE.Vector3().fromArray(spec.axis).normalize();
    this.axleL = new THREE.Vector3().fromArray(spec.axle);
    // sample points on the blade circle (local), front arc only, two radii
    const pts = [];
    const [a0, a1] = spec.arc, steps = Math.max(6, Math.round((a1 - a0) / 15));
    for (let i = 0; i <= steps; i++) {
      const th = (a0 + (a1 - a0) * i / steps) * D2R;
      for (const f of [1, 0.82]) {
        const rr = spec.radius * f;
        if (Math.abs(spec.axis[0]) > 0.5) pts.push(0, Math.sin(th) * rr, Math.cos(th) * rr);          // vertical: YZ plane
        else pts.push(Math.sin(th) * rr, 0, Math.cos(th) * rr);                                    // horizontal: XZ plane
      }
    }
    this.samples = new Float32Array(pts);
    this.nS = pts.length / 3;
    this.reset();
  }
  reset() {
    this.omega = 0; this.on = false; this.stalled = 0; this.jam = 0; this.hitCd = 0; this.current = 0;
    this.health = 1; this.lastHit = 0;
  }
  get energy() { return 0.5 * this.s.I * this.omega * this.omega; }
  get frac() { return Math.min(1, this.omega / (this.s.wFree * 0.9)); }   // 1 ≈ full working speed

  step(dt, fire, opp, fx, battery) {
    const s = this.s, r = this.r, b = r.body;
    if (fire) {
      if (this.stalled > 0) { this.stalled = 0; this.on = true; }
      else this.on = !this.on;
    }
    this.hitCd = Math.max(0, this.hitCd - dt);
    // ---- motor (brushless + ESC: no brake, coasts down on bearing/air drag)
    const wMax = s.wFree * (0.55 + 0.45 * this.health);
    const a = this.on && !this.stalled ? battery.factor : 0;
    let tau = a > 0 ? s.tauStall * Math.max(-0.2, a - this.omega / wMax) : 0;
    const drag = s.I * (0.06 + 0.0006 * this.omega) * this.omega;   // bearings + air
    this.current = a > 0 ? Math.max(0, tau / s.tauStall) * s.iStall : 0;
    this.omega = Math.max(0, this.omega + (tau - drag) / s.I * dt);
    // world axis
    _ax.copy(this.axisL).applyQuaternion(r.q);
    // reaction torque on the chassis (motor pushes the blade one way, the frame the other)
    imp.x = -_ax.x * tau * dt; imp.y = -_ax.y * tau * dt; imp.z = -_ax.z * tau * dt;
    b.applyTorqueImpulse(imp, true);
    // gyroscopic precession: chassis must supply dL/dt = Ω × L; it receives the opposite
    const L = s.I * this.omega, w = r._ang;
    const gx = w.y * _ax.z - w.z * _ax.y, gy = w.z * _ax.x - w.x * _ax.z, gz = w.x * _ax.y - w.y * _ax.x;
    imp.x = -gx * L * dt; imp.y = -gy * L * dt; imp.z = -gz * L * dt;
    b.applyTorqueImpulse(imp, true);

    if (this.omega < s.wFree * 0.08 || this.hitCd > 0) { this.jam = Math.max(0, this.jam - dt); return; }
    // ---- contact search: opponent (cheap bounding check first), then static world
    const axle = r.toWorld(this.axleL.x, this.axleL.y, this.axleL.z, _a);
    let target = null, hitP = null;
    if (opp && opp.body) {
      const oc = opp.body.translation();
      const dx = oc.x - axle.x, dy = oc.y - axle.y, dz = oc.z - axle.z;
      const reach = s.radius + opp.boundR;
      if (dx * dx + dy * dy + dz * dz < reach * reach) {
        for (let i = 0; i < this.nS && !hitP; i++) {
          r.toWorld(this.samples[i * 3] + this.axleL.x, this.samples[i * 3 + 1] + this.axleL.y, this.samples[i * 3 + 2] + this.axleL.z, _p);
          pt.x = _p.x; pt.y = _p.y; pt.z = _p.z;
          for (const c of opp.colliders) if (c.containsPoint(pt)) { hitP = _p; target = opp; break; }
        }
      }
    }
    if (!hitP && (r.stepIndex & 1) === 0) {
      // walls / arena furniture (fixed + kinematic). Only outer samples, every other step.
      for (let i = 0; i < this.nS && !hitP; i += 2) {
        const ly = this.samples[i * 3 + 1];
        if (Math.abs(s.axis[0]) > 0.5 && ly < -s.radius * 0.45) continue;   // vertical blade grazing the floor is not a wall hit
        r.toWorld(this.samples[i * 3] + this.axleL.x, ly + this.axleL.y, this.samples[i * 3 + 2] + this.axleL.z, _p);
        pt.x = _p.x; pt.y = _p.y; pt.z = _p.z;
        let found = false;
        r.world.intersectionsWithPoint(pt, () => { found = true; return false; }, r.R.QueryFilterFlags.EXCLUDE_DYNAMIC, r.rayGroups);
        if (found) { hitP = _p; target = 'wall'; }
      }
    }
    if (!hitP) { this.jam = Math.max(0, this.jam - dt); return; }
    this.resolveHit(hitP, target, axle, fx, dt);
  }

  resolveHit(p, target, axle, fx, dt) {
    const s = this.s, r = this.r, b = r.body;
    // tangent direction of the blade at p
    _r.copy(p).sub(axle);
    _r.addScaledVector(_ax, -_r.dot(_ax));          // in-plane arm
    const rad = Math.max(0.05, _r.length());
    _t.crossVectors(_ax, _r).normalize();
    const vTip = this.omega * rad;
    // relative velocity of the target along the tangent
    pointVel(b, p, _v1);
    if (target !== 'wall') pointVel(target.body, p, _v2); else _v2.set(0, 0, 0);
    const vRel = vTip - (_v2.dot(_t) - _v1.dot(_t));
    if (vRel <= 0.5) return;
    // bite: closing speed toward the axle vs. tooth spacing (fraction of a full tooth engagement)
    const closing = Math.max(0, -((_v2.x - _v1.x) * _r.x + (_v2.y - _v1.y) * _r.y + (_v2.z - _v1.z) * _r.z) / rad);
    const toothTime = 2 * Math.PI / (s.teeth * Math.max(1, this.omega));
    const bite = Math.min(1, 0.45 + (closing + 1.5) * toothTime * 18);
    const mb = s.I / (rad * rad);
    const mo = target === 'wall' ? Infinity : target.mass;
    const meff = mo === Infinity ? mb : mb * mo / (mb + mo);
    let J = (1 + s.e) * meff * vRel * bite;
    const E0 = this.energy;
    // the blade cannot give more than it has: cap so ω stays ≥ −e·ω
    const Jmax = (1 + s.e) * s.I * this.omega / rad;
    if (J > Jmax) J = Jmax;
    this.omega = Math.max(0, this.omega - J * rad / s.I);
    const dE = Math.max(0, E0 - this.energy);
    // impulse direction: blade tangent, plus a bit of lift for horizontal blades with an uppercut edge
    _p.copy(p);
    _t.multiplyScalar(1 - s.uppercut).add(_v1.copy(r.up).multiplyScalar(s.uppercut)).normalize();
    imp.x = _t.x * J; imp.y = _t.y * J; imp.z = _t.z * J;
    if (target !== 'wall') {
      // apply between the contact and the target's centre (some tumble, not an instant cartwheel)
      const oc = target.body.worldCom();
      pt.x = p.x + (oc.x - p.x) * 0.45; pt.y = p.y + (oc.y - p.y) * 0.45; pt.z = p.z + (oc.z - p.z) * 0.45;
      target.body.applyImpulseAtPoint(imp, pt, true);
      target.damage && target.damage.blade(p, dE, r);
    }
    // self-recoil through the axle
    imp.x = -imp.x; imp.y = -imp.y; imp.z = -imp.z;
    pt.x = axle.x; pt.y = axle.y; pt.z = axle.z;
    b.applyImpulseAtPoint(imp, pt, true);
    // own weapon takes a beating on every hit (bent blade → lower top speed)
    this.health = Math.max(0.3, this.health - dE / s.energyMax * 0.025 * (r.damage ? r.damage.weaponFragility : 1));
    // jam / stall
    // blade driven into something it cannot move while nearly stopped → ESC stall cut-out
    if (this.omega < s.wFree * 0.06) { this.jam += 0.4; if (this.jam > 1) { this.stalled = 1; this.jam = 0; } }
    this.hitCd = 0.05 + toothTime;
    this.lastHit = dE;
    const e01 = Math.min(1, dE / (s.energyMax * 0.6));
    if (target === 'wall') { if (dE > 4) { r.wallHits++; fx.wall ? fx.wall(r, p, e01) : (e01 > 0.25 && fx.hit(r, p, e01 * 0.5)); } return; }
    r.damageDealt += dE;
    if (e01 < 0.06) return;                         // a scrape, not a hit
    r.hits++; r.score += Math.round(1 + 3 * e01);
    fx.hit(r, p, e01);
  }
}

// ======================================================================= arm (flipper / lifter / grabber)
export class Arm {
  constructor(robot, spec) {
    this.r = robot; this.s = spec;
    this.pivotL = new THREE.Vector3().fromArray(spec.pivot);
    this.reset();
  }
  reset() {
    this.angle = 0; this.rate = 0; this.target = 0; this.kickT = 0; this.cooldown = 0; this.current = 0;
    this.health = 1; this.holding = false; this.holdT = 0; this.lifted = false; this.contactT = 0;
    this.releaseJoint();
  }
  // physics bodies: arm body + revolute joint to the chassis
  attach(R, world, robot) {
    const s = this.s, cb = robot.body;
    this.R = R; this.world = world;
    const tr = cb.translation(), rot = cb.rotation();
    this.body = world.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(false)
      .setTranslation(tr.x, tr.y, tr.z).setRotation(rot).setAngularDamping(0.5));
    const massU = s.massG / 100;
    const col = R.ColliderDesc.convexHull(new Float32Array(s.hull)).setMass(massU).setFriction(s.friction).setRestitution(0.02)
      .setCollisionGroups(robot.groups);
    this.collider = world.createCollider(col, this.body);
    const jd = R.JointData.revolute({ x: s.pivot[0], y: s.pivot[1], z: s.pivot[2] }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    this.joint = world.createImpulseJoint(jd, cb, this.body, true);
    this.joint.setContactsEnabled(false);
    // hard stops: rest (wedge on its stop) and fully raised
    this.joint.setLimits(-s.range - 0.08, 0.02);
    this.place();
  }
  detach() {
    this.releaseJoint();
    if (this.body && this.world) { try { this.world.removeRigidBody(this.body); } catch (_) {} }
    this.body = null; this.collider = null; this.joint = null;
  }
  // put the arm at its rest pose relative to the chassis (after reset/teleport)
  place() {
    if (!this.body) return;
    const cb = this.r.body, q = cb.rotation(), t = cb.translation();
    _q.set(q.x, q.y, q.z, q.w);
    _p.copy(this.pivotL).applyQuaternion(_q).add(_v1.set(t.x, t.y, t.z));
    this.body.setTranslation({ x: _p.x, y: _p.y, z: _p.z }, true);
    this.body.setRotation(q, true);
    const l = cb.linvel(); this.body.setLinvel(l, true); this.body.setAngvel(cb.angvel(), true);
  }
  // relative hinge angle (positive = tip down, negative = raised) and rate
  measure() {
    const a = this.r.body.rotation(), b = this.body.rotation();
    _q.set(a.x, a.y, a.z, a.w).invert();
    _q2.set(b.x, b.y, b.z, b.w).premultiply(_q);
    this.angle = 2 * Math.atan2(_q2.x, _q2.w);
    if (this.angle > Math.PI) this.angle -= 2 * Math.PI;
    const wa = this.r.body.angvel(), wb = this.body.angvel();
    _ax.set(1, 0, 0).applyQuaternion(this.r.q);
    this.rate = (wb.x - wa.x) * _ax.x + (wb.y - wa.y) * _ax.y + (wb.z - wa.z) * _ax.z;
  }

  step(dt, fire, opp, fx, battery) {
    const s = this.s, r = this.r;
    if (!this.body) return;
    this.measure();
    this.cooldown = Math.max(0, this.cooldown - dt);
    const grab = s.grab;
    if (fire && this.cooldown <= 0) {
      if (grab && r.up.y < 0.35 && !this.holding) {
        // upside down: the forks slam against the floor to roll back over
        this.kickT = 0.2; this.kickStart = true; this.cooldown = 0.9; fx.flip(r); this.kickContact = true; this.lifted = false;
      } else if (grab) this.toggleGrab(opp, fx);
      else { this.kickT = s.kick; this.kickStart = true; this.cooldown = s.cooldown * (r.handicap < 1 ? 1.4 : 1); fx.flip(r); r.flipAnim = 1; this.kickContact = false; }
    }
    // ---- target angle
    if (grab && this.kickT > 0) { this.kickT -= dt; this.target = -s.range; }
    else if (grab) {
      if (this.holding) {
        this.holdT += dt;
        this.target = -s.range * grab.lift * (0.6 + 0.4 * this.health) - 0.05;
        // pinned too long (rules) or the opponent got ripped out of the forks
        if (this.holdT > grab.hold || this.grabStretch() > 0.45) this.release(fx);
      } else this.target = this.lifted ? -s.range * 0.6 : 0;
    } else {
      if (this.kickT > 0) {
        this.kickT -= dt; this.target = -s.range;
        // stroke complete: stop driving into the end stop (that only kicks our own chassis)
        if (this.angle < -s.range * 0.95) this.kickT = 0;
      } else this.target = 0;
    }
    // ---- actuator: PD toward target, torque–speed limited, equal & opposite on the chassis
    const kicking = this.kickT > 0;
    const tMax = (kicking ? s.torque * (grab ? 1.6 : 1) : grab ? s.torque * 0.7 : s.hold) * this.health * Math.min(1.1, battery.factor);
    const err = this.target - this.angle;
    let tau = kicking ? -tMax : (err * (grab ? 60 : 90) - this.rate * (grab ? 6 : 4));
    // motor curve: no more torque in the direction it is already spinning at full speed
    const spd = s.speed;
    if (tau * this.rate > 0) tau *= Math.max(0, 1 - Math.abs(this.rate) / spd);
    if (tau > tMax) tau = tMax; else if (tau < -tMax) tau = -tMax;
    this.current = Math.abs(tau) / Math.max(1, s.torque) * 6; this.tau = tau;
    _ax.set(1, 0, 0).applyQuaternion(r.q);
    imp.x = _ax.x * tau * dt; imp.y = _ax.y * tau * dt; imp.z = _ax.z * tau * dt;
    this.body.applyTorqueImpulse(imp, true);
    // equal and opposite on the chassis
    imp.x = -imp.x; imp.y = -imp.y; imp.z = -imp.z;
    r.body.applyTorqueImpulse(imp, true);

    // ---- launch: the plate is simulated, but Rapier's contact solver under-transfers momentum from a
    // light, fast plate into a heavy robot, so the energy hand-over at first contact is analytic:
    // the actuator's stroke energy E goes into the opponent as J = √(2·E·m), applied at its near
    // edge (so it rotates over) and reacted equally through our hinge (into the floor).
    if (kicking && !this.kickContact && opp && opp.body && !grab && this.touches(opp)) {
      this.kickContact = true;
      const om = opp.mass, E = s.kickEnergy * this.health * Math.min(1.1, battery.factor) * (r.handicap < 1 ? 0.8 : 1);
      const J = Math.sqrt(2 * E * om);
      opp.frame();
      _v1.copy(r.up).multiplyScalar(0.86).addScaledVector(r.fwd, 0.22).normalize().multiplyScalar(J);
      _v2.copy(r.pos).sub(opp.pos); _v2.y = 0;
      if (_v2.lengthSq() > 1e-6) _v2.setLength(0.3);
      _p.copy(opp.pos).add(_v2);
      imp.x = _v1.x; imp.y = _v1.y; imp.z = _v1.z; pt.x = _p.x; pt.y = _p.y; pt.z = _p.z;
      opp.body.applyImpulseAtPoint(imp, pt, true);
      const pv = this.body.translation();
      imp.x = -imp.x; imp.y = -imp.y; imp.z = -imp.z; pt.x = pv.x; pt.y = pv.y; pt.z = pv.z;
      r.body.applyImpulseAtPoint(imp, pt, true);
      r.hits++; r.score += 3;
      if (opp.damage) opp.damage.apply(opp.damage.sideOfLocal(opp.local(_p, _v2)), E * 0.12, r);
      fx.hit(r, _p, 0.6);
    }
    // ---- self-righting assist: a flipped flipper kicking against the floor rolls the robot back
    if (this.kickStart && (this.kickStart = false, true) && r.up.y < 0.35 && r.restingOnSomething()) {
      const m = r.mass;
      r.body.applyImpulse({ x: 0, y: m * 5.5, z: 0 }, true);
      _v1.crossVectors(r.up, _v2.set(0, 1, 0));
      if (_v1.lengthSq() < 0.05) _v1.copy(r.fwd);
      _v1.normalize().multiplyScalar(6);
      const w = r.body.angvel();
      r.body.setAngvel({ x: w.x + _v1.x, y: w.y + _v1.y, z: w.z + _v1.z }, true);
    }
  }

  touches(opp) {
    let hit = false;
    for (const c of opp.colliders) {
      if (hit) break;
      this.world.contactPair(this.collider, c, m => { if (m.numContacts() > 0) hit = true; });
    }
    return hit;
  }

  // ---- grabber
  toggleGrab(opp, fx) {
    const r = this.r, g = this.s.grab;
    if (this.holding) { this.release(fx); return; }
    if (this.lifted) { this.lifted = false; this.cooldown = 0.25; return; }
    // is the opponent in the jaws? touching the forks, or overlapping the space just above them
    if (opp && opp.body && (this.touches(opp) || this.inJaws(opp))) {
      {
        opp.frame();
        const l = r.local(opp.pos, _p);
        // pin point: on the forks, 0.48 u in front of the hinge, in arm-local coords
        const anchorArm = { x: 0, y: -0.2, z: Math.max(0.3, Math.min(0.55, l.z - this.pivotL.z - 0.1)) };
        _v1.set(anchorArm.x, anchorArm.y, anchorArm.z);
        const bq = this.body.rotation(), bt = this.body.translation();
        _q.set(bq.x, bq.y, bq.z, bq.w);
        _v1.applyQuaternion(_q).add(_v2.set(bt.x, bt.y, bt.z));
        const lo = opp.local(_v1, _v2);
        // opponent anchor in its body frame (relative to its origin)
        const jd = this.R.JointData.spherical(anchorArm, { x: lo.x, y: lo.y, z: lo.z });
        this.grabJoint = this.world.createImpulseJoint(jd, this.body, opp.body, true);
        this.grabJoint.setContactsEnabled(true);
        this.grabbed = opp; this.holding = true; this.holdT = 0;
        this.anchorArm = anchorArm; this.anchorOpp = { x: lo.x, y: lo.y, z: lo.z };
        r.hits++; r.score += 2; opp.grabbedBy = r;
        fx.grab ? fx.grab(r, opp) : fx.hit(r, _v1, 0.35);
        fx.flip(r);
        return;
      }
    }
    // nothing in the jaws: plain lifter stroke (stays up until the next press)
    this.lifted = true; fx.flip(r);
  }
  inJaws(opp) {
    const bq = this.body.rotation(), bt = this.body.translation();
    _q.set(bq.x, bq.y, bq.z, bq.w);
    // the jaw reaches a little past the fork tips and above them
    for (let zi = 0; zi < 4; zi++) for (let xi = -1; xi <= 1; xi++) for (let yi = 0; yi < 3; yi++) {
      _v1.set(xi * 0.3, -0.28 + yi * 0.2, 0.4 + zi * 0.16).applyQuaternion(_q);
      pt.x = _v1.x + bt.x; pt.y = _v1.y + bt.y; pt.z = _v1.z + bt.z;
      for (const c of opp.colliders) if (c.containsPoint(pt)) return true;
    }
    return false;
  }
  grabStretch() {
    if (!this.grabJoint || !this.grabbed || !this.grabbed.body) return 0;
    const a = this.anchorArm, bq = this.body.rotation(), bt = this.body.translation();
    _q.set(bq.x, bq.y, bq.z, bq.w);
    _v1.set(a.x, a.y, a.z).applyQuaternion(_q).add(_v2.set(bt.x, bt.y, bt.z));
    const o = this.grabbed, oq = o.body.rotation(), ot = o.body.translation();
    _q.set(oq.x, oq.y, oq.z, oq.w);
    _v2.set(this.anchorOpp.x, this.anchorOpp.y, this.anchorOpp.z).applyQuaternion(_q).add(_p.set(ot.x, ot.y, ot.z));
    return _v1.distanceTo(_v2);
  }
  release(fx) {
    const had = this.holding;
    this.releaseJoint();
    if (had) this.cooldown = this.s.grab.cooldown;
    this.holding = false; this.holdT = 0;
  }
  releaseJoint() {
    if (this.grabJoint && this.world) { try { this.world.removeImpulseJoint(this.grabJoint, true); } catch (_) {} }
    if (this.grabbed) this.grabbed.grabbedBy = null;
    this.grabJoint = null; this.grabbed = null;
  }
}
