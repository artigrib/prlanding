// Damage model: armour hit points per side of the chassis (robot-local: front/back/left/right/top/bottom).
//  * Blade hits deal energy-based damage (ΔE of the blade) to the side that was struck.
//  * Any sudden change of velocity (wall slam, landing after a flip, ram) deals impact damage
//    ∝ m·(Δv − threshold)² to the side the push came from.
//  * A side at 0 HP breaks something: left/right → a wheel on that side is knocked loose (it flies off
//    as debris and that corner drops onto the frame), front → weapon bent (spinner top speed / flipper
//    torque drop), back → battery lead damaged (more voltage sag), top/bottom → electronics shaken
//    (less drive power). The side then keeps 40 % so it can break again.
import * as THREE from 'three';

export const SIDES = ['front', 'back', 'left', 'right', 'top', 'bottom'];
const _l = new THREE.Vector3();
const IMPACT_DV = 5.2;           // u/s velocity change per step that starts to hurt
const BLADE_K = 0.38;            // HP per unit of blade energy delivered
const IMPACT_K = 0.55;

export class Damage {
  constructor(robot, def) {
    this.r = robot; this.def = def;
    this.max = { ...def.hp };
    this.absorb = def.armourAbsorb;
    this.weaponFragility = 1;
    this.hp = {}; this.reset();
  }
  reset() {
    for (const s of SIDES) this.hp[s] = this.max[s];
    this.wheelsLost = 0; this.broken = []; this.lastSide = null; this.lastAmount = 0; this.recent = 0; this.taken = 0; this.quiet = 0;
  }
  get health01() {
    let a = 0, b = 0;
    for (const s of SIDES) { a += this.hp[s]; b += this.max[s]; }
    return a / b;
  }
  side01(s) { return this.hp[s] / this.max[s]; }

  // which side of the chassis a world point (or a robot-local direction) is on
  sideOfLocal(l) {
    const h = this.def.chassis.half;
    const ax = Math.abs(l.x) / h[0], ay = Math.abs(l.y) / h[1] * 0.6, az = Math.abs(l.z) / h[2];
    if (ax >= ay && ax >= az) return l.x > 0 ? 'left' : 'right';
    if (az >= ay) return l.z > 0 ? 'front' : 'back';
    return l.y > 0 ? 'top' : 'bottom';
  }

  blade(p, dE, attacker) {
    const l = this.r.local(p, _l);
    const side = this.sideOfLocal(l);
    this.quiet = 0.12;                                      // the impact model must not count the same hit
    this.apply(side, dE * BLADE_K, attacker);
  }
  // dvx.. = world velocity change this step (already minus gravity/drive)
  impact(dvx, dvy, dvz, dt) {
    if (this.quiet > 0) { this.quiet -= dt; return; }
    const dv = Math.hypot(dvx, dvy, dvz);
    if (dv < IMPACT_DV) return;
    // the push came from the side opposite to the velocity change
    _l.set(-dvx, -dvy, -dvz).applyQuaternion(this.r.qi);
    const side = this.sideOfLocal(_l);
    const x = dv - IMPACT_DV;
    this.apply(side, this.r.mass * x * x * IMPACT_K, null);
    this.quiet = 0.06;
  }

  apply(side, amount, attacker) {
    amount *= 1 - this.absorb;
    if (amount < 0.5) return;
    this.hp[side] -= amount; this.taken += amount;
    this.lastSide = side; this.lastAmount = amount; this.recent = 0.6;
    if (this.hp[side] <= 0) {
      this.hp[side] = this.max[side] * 0.4;
      this.breakSide(side);
    }
  }

  breakSide(side) {
    const r = this.r;
    this.broken.push(side);
    if (side === 'left' || side === 'right') { if (r.loseWheel(side === 'left' ? 0 : 1)) this.wheelsLost++; }
    else if (side === 'front') { if (r.weapon) r.weapon.health = Math.max(0.3, r.weapon.health - 0.35); }
    else if (side === 'back') { r.battery.rMul = Math.min(3, r.battery.rMul + 0.8); }
    else { r.drive.powerMul = Math.max(0.55, r.drive.powerMul - 0.15); }
    r.events.push(side);
  }
  step(dt) { this.recent = Math.max(0, this.recent - dt); }
}
