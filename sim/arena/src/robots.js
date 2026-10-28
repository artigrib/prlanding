// Robots: the Robot class ties together the data-driven def (robots/catalog.js), the drivetrain
// (physics/drive.js), weapons (physics/weapons.js), damage (physics/damage.js) and the visuals
// (robots/visuals.js or a GLB). Local frame: +Z forward, +Y up, +X = the robot's left side.
import * as THREE from 'three';
import { BASES, buildDef, MODS, SLOTS, statsFor, MASS_LIMIT_G, RIDE, GRAVITY } from './robots/catalog.js';
import { buildPlaceholder } from './robots/visuals.js';
import { Drive, Battery } from './physics/drive.js';
import { Spinner, Arm } from './physics/weapons.js';
import { Damage, SIDES } from './physics/damage.js';

export { GRAVITY, MODS, SLOTS, statsFor, buildDef, MASS_LIMIT_G, BASES, SIDES, RIDE };

// default build of every base design (main.js iterates this for the robot picker)
export const ROBOTS = {};
for (const id of Object.keys(BASES)) ROBOTS[id] = buildDef(id);

const REST = 0.32;                 // suspension ray length (u)
const Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
let groupSeq = 0;

const WEAPON_LABEL = { flipper: 'Flipper', vertical: 'Zbraň', horizontal: 'Zbraň', grabber: 'Kleště' };

export class Robot {
  // opts.mods: [ 'slot:option', ... ] or { slot: option } — rebuilds the def with those modifications
  constructor(def, color, scene, opts = {}) {
    if (opts.mods || !def.drive) def = buildDef(def.id, opts.mods || def.modList);
    this.def = def;
    this.RIDE = RIDE; this.REST = REST; this.G = GRAVITY;
    this.mass = def.mass;
    this.printMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });
    this.printMats = [this.printMat];
    this.root = new THREE.Group(); scene.add(this.root);
    this.scene = scene;
    const ph = buildPlaceholder(def, this.printMat);
    this.visual = ph.group; this.parts = ph.parts; this.root.add(this.visual);
    this.mapWheelSides();
    this.drive = new Drive(def);
    this.battery = new Battery();
    this.damage = new Damage(this, def);
    this.weapon = def.spinner ? new Spinner(this, def.spinner) : def.arm ? new Arm(this, def.arm) : null;
    this.spinner = def.spinner ? this.weapon : null;
    this.arm = def.arm ? this.weapon : null;
    this.weaponLabel = WEAPON_LABEL[def.weaponKind] || 'Zbraň';
    const h = def.chassis.half;
    this.boundR = Math.hypot(h[0], h[1], h[2] + Math.abs(def.chassis.offset[2])) + (def.arm ? 0.5 : 0.1);
    // scratch (no per-step allocation)
    this._lin = new THREE.Vector3(); this._ang = new THREE.Vector3(); this._com = new THREE.Vector3();
    this._nrm = new THREE.Vector3(); this._side = new THREE.Vector3(); this._o = new THREE.Vector3(); this._o2 = new THREE.Vector3();
    this._prev = new THREE.Vector3(); this._ai = null;
    this.wheelSpin = [0, 0]; this.flipAnim = 0; this.bladeAngle = 0; this.handicap = 1; this.stepIndex = 0;
    this.debris = []; this.events = [];
    this._body = null;
    this.usesSurfaceGrip = true;      // tyre μ is scaled by the floor collider's friction (ice maps)
    this.resetState();
  }
  resetState() {
    this.flippedTime = 0; this.contacts = 0; this.score = 0; this.hits = 0; this.wiggle = 0;
    this.damageDealt = 0; this.wallHits = 0; this.inverted = false; this.vLong = 0; this.grabbedBy = null;
    this._hasPrev = false; this.events.length = 0;
    if (this.weapon) this.weapon.reset();
    if (this.drive) this.drive.reset();
    if (this.battery) this.battery.reset();
    if (this.damage) this.damage.reset();
  }
  setColor(hex) { this.printMats.forEach(m => m.color.set(hex)); }

  // ---- legacy weapon fields main.js / ai.js read
  get spin() { return this.spinner ? this.spinner.frac : 0; }
  set spin(v) { /* derived from the blade's ω */ }
  get weaponOn() { return this.spinner ? this.spinner.on && !this.spinner.stalled : this.arm ? this.arm.holding : false; }
  set weaponOn(v) { if (this.spinner) this.spinner.on = !!v; }
  get cooldown() { return this.arm ? this.arm.cooldown : this.spinner && this.spinner.stalled ? 1 : 0; }
  set cooldown(v) { if (this.arm) this.arm.cooldown = v; }
  get hitCooldown() { return this.spinner ? this.spinner.hitCd : 0; }
  set hitCooldown(v) {}

  // main.js removes the chassis body itself and then sets `r.body = null`: clean up our extra bodies then
  get body() { return this._body; }
  set body(b) {
    if (!b && this._body) this.detachPhysics(false);
    this._body = b;
  }

  attachPhysics(RAPIER, world) {
    this.R = RAPIER; this.world = world;
    const d = this.def;
    // collision-group bit per robot: rays and weapon queries skip our own colliders
    const bit = 1 << (groupSeq++ % 15);
    this.groups = (bit << 16) | 0xffff;
    this.rayGroups = (0xffff << 16) | (0xffff & ~bit);
    this._body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true)
      .setLinearDamping(0.05).setAngularDamping(0.4).setCanSleep(false));
    const armMass = d.arm ? d.arm.massG / 100 : 0;
    const bodyMass = this.mass - armMass;
    const [hx, hy, hz] = d.chassis.half, off = d.chassis.offset;
    this.colliders = [];
    const add = (desc) => { const c = world.createCollider(desc.setCollisionGroups(this.groups), this._body); this.colliders.push(c); return c; };
    const extras = d.id === 'vert150' || d.id === 'kosa' ? 0.3 : 0;   // weapon mass sits up front
    add(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(off[0], off[1], off[2])
      .setMass(bodyMass * (1 - extras)).setFriction(d.chassis.friction).setRestitution(0.08));
    if (d.id === 'vert150' && d.wedge === 'bez') {
      // no wedge: the weapon hub still carries the front mass
      add(RAPIER.ColliderDesc.cuboid(0.12, 0.1, 0.1).setTranslation(0, 0, 0.42).setMass(bodyMass * extras).setFriction(0.3).setRestitution(0.05));
    } else if (d.id === 'vert150') {
      // wedge in front of the blade: low leading edge so it can win the ground game
      // klin: two wedgelets either side of the blade slot; vidle: the narrow fork wedge
      const parts = d.wedge === 'klin' ? [[0.12, 0.5], [-0.5, -0.12]] : [[-0.2, 0.2]], tip = d.wedge === 'klin' ? -0.25 : -0.235;
      for (const [x0, x1] of parts) {
        const f = [];
        for (const x of [x0, x1]) f.push(x, tip, 0.7, x, tip + 0.03, 0.7, x, 0.12, 0.3, x, -0.2, 0.3);
        add(RAPIER.ColliderDesc.convexHull(new Float32Array(f)).setMass(bodyMass * extras / parts.length).setFriction(d.wedge === 'klin' ? 0.08 : 0.15).setRestitution(0.05));
      }
    } else if (d.id === 'kosa') {
      // weapon motor pod at the axle (the blade itself is swept, not a collider)
      const a = d.spinner.axle;
      add(RAPIER.ColliderDesc.cylinder(0.11, 0.12).setTranslation(a[0], a[1] + 0.09, a[2]).setMass(bodyMass * extras).setFriction(0.3).setRestitution(0.05));
    }
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    if (this.arm) { this.arm.attach(RAPIER, world, this); this.colliders.push(this.arm.collider); }
  }

  // remove everything we added to the world. withChassis=false when main.js already removed the chassis.
  detachPhysics(withChassis = true) {
    if (this.arm) this.arm.detach();
    for (const db of this.debris) {
      if (db.body && this.world) { try { this.world.removeRigidBody(db.body); } catch (_) {} }
      if (db.node.parent) db.node.parent.remove(db.node);
      db.node.traverse(o => { if (o.isMesh && o.userData.debrisGeo) o.geometry.dispose(); });
    }
    this.debris.length = 0;
    if (withChassis && this._body && this.world) { try { this.world.removeRigidBody(this._body); } catch (_) {} }
    if (withChassis) this._body = null;
    if (this.grabbedBy && this.grabbedBy.arm) this.grabbedBy.arm.releaseJoint();
  }

  reset(x, z, yaw) {
    this.resetState();
    // put knocked-off wheels back
    for (const db of this.debris) {
      if (db.body && this.world) { try { this.world.removeRigidBody(db.body); } catch (_) {} }
      if (db.restore) { db.restore.parent.add(db.node); db.node.position.copy(db.restore.p); db.node.quaternion.copy(db.restore.q); db.node.scale.copy(db.restore.s); }
      else if (db.node.parent) db.node.parent.remove(db.node);
    }
    this.debris.length = 0;
    _q.setFromAxisAngle(Y, yaw);
    const b = this._body;
    b.setTranslation({ x, y: RIDE + 0.02, z }, true);
    b.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (this.arm) this.arm.place();
    this.sync(0);
  }

  // frame vectors from the physics body (reused between calls: clone them if you need to keep a value)
  frame() {
    if (!this.q) { this.q = new THREE.Quaternion(); this.qi = new THREE.Quaternion(); this.pos = new THREE.Vector3(); this.up = new THREE.Vector3(); this.fwd = new THREE.Vector3(); }
    const r = this._body.rotation(); this.q.set(r.x, r.y, r.z, r.w); this.qi.copy(this.q).invert();
    const t = this._body.translation(); this.pos.set(t.x, t.y, t.z);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
    this.fwd.set(0, 0, 1).applyQuaternion(this.q);
    return this;
  }
  local(p, out = new THREE.Vector3()) { return out.copy(p).sub(this.pos).applyQuaternion(this.qi); }
  toWorld(lx, ly, lz, out = new THREE.Vector3()) { return out.set(lx, ly, lz).applyQuaternion(this.q).add(this.pos); }

  // one fixed physics step: suspension + drive, weapon, damage, battery
  step(dt, input, opp, fx) {
    const b = this._body, d = this.def;
    if (!b) return;
    this.stepIndex++;
    this.frame();
    const l = b.linvel(), a = b.angvel(), c = b.worldCom();
    this._lin.set(l.x, l.y, l.z); this._ang.set(a.x, a.y, a.z); this._com.set(c.x, c.y, c.z);
    this._side.set(1, 0, 0).applyQuaternion(this.q);
    // impact damage from the velocity change since the last step
    if (this._hasPrev) this.damage.impact(this._lin.x - this._prev.x, this._lin.y - this._prev.y, this._lin.z - this._prev.z, dt);
    this.damage.step(dt);

    // invertible robots (big wheels) drive on either side
    const inv = !!d.invertible && this.up.y < -0.35;
    this.inverted = inv;
    this._nrm.copy(this.up); if (inv) this._nrm.negate();
    const yawN = this._ang.dot(this._nrm);
    this.drive.command(input.throttle, input.turn, yawN, inv ? -1 : 1, this.handicap, dt);
    const driveC = this.drive.apply(dt, this, this.battery);
    this.contacts = driveC;

    // flipped / stranded / immobile (lost all drive) → the 10 s count-out in main.js
    const tilt = d.invertible ? Math.abs(this.up.y) : this.up.y;
    const immobile = this.drive.drivenAlive() === 0;
    if ((tilt < 0.25 && driveC === 0) || immobile) this.flippedTime += dt; else if (tilt > 0.5 || driveC > 0) this.flippedTime = 0;

    if (driveC === 0 && !immobile && tilt < 0.4 && Math.abs(this._lin.y) < 0.8 && this.restingOnSomething() && (Math.abs(input.throttle) + Math.abs(input.turn)) > 0.3) {
      // stranded: thrashing wheels rock the robot a bit, sometimes enough to roll back
      this.wiggle += dt;
      if (this.wiggle > 0.55) {
        this.wiggle = 0;
        b.applyImpulse({ x: 0, y: this.mass * 2.2, z: 0 }, true);
        const k = Math.sign(input.turn || 1) * (3 + Math.random() * 3);
        b.setAngvel({ x: a.x + this.fwd.x * k, y: a.y + this.fwd.y * k, z: a.z + this.fwd.z * k }, true);
      }
    }
    this.vLong = this._lin.dot(this.fwd);

    if (this.weapon) this.weapon.step(dt, !!input.fire, opp, fx, this.battery);
    this.battery.update(dt, this.drive.current + (this.weapon ? this.weapon.current : 0));
    this._prev.copy(this._lin); this._hasPrev = true;
  }

  // is anything right below the robot? (stops mid-air "wiggle" control)
  restingOnSomething() {
    const ray = this.ray, t = this.pos;
    ray.origin.x = t.x; ray.origin.y = t.y; ray.origin.z = t.z; ray.dir.x = 0; ray.dir.y = -1; ray.dir.z = 0;
    return !!this.world.castRay(ray, 0.6, true, undefined, this.rayGroups, undefined, this._body);
  }

  // knock a driven wheel loose on side 0 (left, +X) or 1 (right). Returns true if one came off.
  loseWheel(side) {
    const d = this.def, dr = this.drive;
    let idx = -1;
    for (let i = 0; i < d.mounts.length; i++) if (d.mounts[i][2] && dr.alive[i] && ((d.mounts[i][0] > 0 ? 0 : 1) === side)) { idx = i; if (d.mounts[i][1] > 0) break; }
    if (idx < 0) return false;
    dr.alive[idx] = 0;
    // pick the visual wheel nearest to that mount
    const mx = d.mounts[idx][0], mz = d.mounts[idx][1];
    let best = null, bd = 1e9;
    this.root.updateMatrixWorld(true);
    (this.parts.wheels || []).forEach((w, i) => {
      if (!w || w.userData.lost) return;
      w.getWorldPosition(_v); this.root.worldToLocal(_v);
      const dd = (_v.x - mx) ** 2 + (_v.z - mz) ** 2;
      if (dd < bd) { bd = dd; best = w; }
    });
    if (best && this.world && this.scene) this.spawnDebris(best, side);
    return true;
  }
  spawnDebris(node, side) {
    const R = this.R, d = this.def;
    this.frame();
    node.userData.lost = true;
    const restore = { parent: node.parent, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() };
    this.scene.attach(node);
    node.getWorldPosition(_v); node.getWorldQuaternion(_q);
    const lv = this._body.linvel();
    _w.set(side === 0 ? 1 : -1, 0, 0).applyQuaternion(this.q);
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(_v.x, _v.y + 0.05, _v.z)
      .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
      .setLinvel(lv.x + _w.x * 4, lv.y + 5, lv.z + _w.z * 4).setAngvel({ x: _w.x * 20, y: 8, z: _w.z * 20 }).setCcdEnabled(true));
    const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    this.world.createCollider(R.ColliderDesc.cylinder(0.06, d.wheelR).setRotation({ x: rq.x, y: rq.y, z: rq.z, w: rq.w })
      .setMass(0.05).setFriction(0.9).setRestitution(0.35), body);
    this.debris.push({ node, body, restore, t: 0 });
    this.events.push('wheel');
  }

  // ---- status for HUD / AI ------------------------------------------------------------
  // short Czech status line for the HUD
  statusText() {
    const k = this.def.weaponKind;
    if (this.spinner) {
      const s = this.spinner;
      if (s.stalled) return 'Zbraň zaseknutá – znovu zapnout';
      return s.on ? `Zbraň ${Math.round(s.frac * 100)} %` : 'Zbraň vypnutá';
    }
    if (k === 'grabber') {
      const a = this.arm;
      if (a.holding) return `Drží soupeře ${Math.max(0, Math.ceil(a.s.grab.hold - a.holdT))} s`;
      if (a.lifted) return 'Vidle nahoře';
      return a.cooldown > 0 ? 'Kleště nabíjí' : 'Kleště připraveny';
    }
    return this.cooldown > 0 ? 'Flipper nabíjí' : 'Flipper připraven';
  }
  // weapon effective zone in robot-local coords (for AI / aim assist)
  weaponZone() {
    const d = this.def;
    if (d.spinner) {
      const s = d.spinner, a = s.axle;
      return d.weaponKind === 'horizontal'
        ? { zMin: a[2] - 0.1, zMax: a[2] + s.radius + 0.5, xHalf: s.radius + 0.4 }
        : { zMin: a[2], zMax: a[2] + s.radius + 0.55, xHalf: 0.55 };
    }
    if (d.arm && d.arm.grab) { const g = d.arm.grab.zone; return { zMin: g[0], zMax: g[1], xHalf: g[2] }; }
    return { zMin: 0.3, zMax: 1.35, xHalf: 0.75 };
  }
  inWeaponZone(target) {
    if (!target || !target.body) return false;
    target.frame();
    const l = this.local(target.pos, _v), z = this.weaponZone();
    return l.z > z.zMin && l.z < z.zMax && Math.abs(l.x) < z.xHalf && l.y < 0.9 && l.y > -0.6;
  }
  // what a sensible pilot would press now (AI hook; main/ai decide whether to use it)
  suggestFire(target) {
    if (!this.weapon) return false;
    if (this.spinner) return this.spinner.stalled > 0 || !this.spinner.on;
    if (this.up && this.up.y < 0.35 && this.flippedTime > 0.3) return this.cooldown <= 0;
    if (this.arm.holding) return false;                     // keep holding until the clock runs out
    if (this.arm.lifted) return true;
    return this.cooldown <= 0 && this.inWeaponZone(target);
  }
  // physics-aware snapshot for the AI (one reused object)
  aiState() {
    const s = this._ai || (this._ai = { hp: {} });
    s.kind = this.def.weaponKind;
    s.weaponReady = this.spinner ? this.spinner.on && !this.spinner.stalled && this.spinner.frac > 0.6 : this.cooldown <= 0;
    s.weaponEnergy = this.spinner ? this.spinner.frac : this.cooldown <= 0 ? 1 : 0;
    s.stalled = !!(this.spinner && this.spinner.stalled);
    s.holding = !!(this.arm && this.arm.holding);
    s.grabbed = !!this.grabbedBy;
    s.battery = this.battery.soc; s.volts = this.battery.volts;
    s.health = this.damage.health01;
    for (const k of SIDES) s.hp[k] = this.damage.side01(k);
    s.wheelsLost = this.damage.wheelsLost;
    s.traction = this.contacts / Math.max(1, this.drive.drivenAlive());
    s.slipping = this.drive.slipping > 0;
    s.inverted = this.inverted; s.flippedTime = this.flippedTime;
    s.canSelfRight = !!this.arm || !!this.def.invertible;
    s.speed = Math.hypot(this._lin.x, this._lin.z);
    s.zone = this.weaponZone();
    return s;
  }

  // copy physics → meshes and animate parts
  sync(dt) {
    if (!this._body) return;
    const t = this._body.translation(), r = this._body.rotation();
    this.root.position.set(t.x, t.y, t.z); this.root.quaternion.set(r.x, r.y, r.z, r.w);
    const p = this.parts;
    for (const db of this.debris) {
      if (!db.body) continue;
      const bt = db.body.translation(), br = db.body.rotation();
      db.node.position.set(bt.x, bt.y, bt.z); db.node.quaternion.set(br.x, br.y, br.z, br.w);
    }
    if (!dt) return;
    const om = this.drive.wheelOmega;
    this.wheelSpin[0] += om[0] * dt; this.wheelSpin[1] += om[1] * dt;
    if (p.wheels) for (let i = 0; i < p.wheels.length; i++) {
      const w = p.wheels[i]; if (w.userData.lost) continue;
      w.rotation.x = this.wheelSpin[p.wheelSide ? p.wheelSide[i] : 0];
    }
    if (p.flipper && this.arm) {
      const ang = this.arm.angle;
      p.flipper.rotation.x = p.flipRest + ang;
      if (p.flipperOnlyWhenFiring) p.flipper.visible = ang < -0.06;
    }
    if (p.jaw && this.arm) {
      const want = this.arm.holding ? -0.05 : p.jawOpen;
      p.jaw.rotation.x += (want - p.jaw.rotation.x) * Math.min(1, dt * 14);
    }
    if (p.blade && this.spinner) {
      const s = this.spinner;
      this.bladeAngle += Math.min(s.omega, 42) * dt;
      if (p.bladeAxis === 'y') p.blade.rotation.y = this.bladeAngle; else p.blade.rotation.x = -this.bladeAngle;
      p.blur.material.opacity = Math.max(0, s.frac - 0.3) * 0.55;
    }
  }

  // which drive side each visual wheel is on (0 = left/+X, 1 = right)
  mapWheelSides() {
    const p = this.parts; if (!p.wheels) return;
    this.root.updateMatrixWorld(true);
    p.wheelSide = p.wheels.map(w => { w.getWorldPosition(_v); this.root.worldToLocal(_v); return _v.x > 0 ? 0 : 1; });
  }

  // swap the placeholder for a GLB (scaled to the placeholder's footprint)
  useModel(gltfScene) {
    // measure in the robot's local frame (the root may be posed/rotated already)
    const savedP = this.root.position.clone(), savedQ = this.root.quaternion.clone();
    this.root.position.set(0, 0, 0); this.root.quaternion.identity(); this.root.updateMatrixWorld(true);
    const info = this._useModel(gltfScene);
    this.mapWheelSides();
    this.root.position.copy(savedP); this.root.quaternion.copy(savedQ); this.root.updateMatrixWorld(true);
    return info;
  }
  _useModel(gltfScene) {
    if (this.def.glbNative) return this._useNativeModel(gltfScene);
    // fit into the footprint the model was tuned for (falls back to the procedural visual's bounds)
    const fit = this.def.glbFit, box = new THREE.Box3().setFromObject(this.visual);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    if (fit) { size.x = fit.size[0]; size.z = fit.size[1]; center.x = fit.center[0]; center.z = fit.center[1]; }
    const m = gltfScene;
    m.rotation.y = this.def.glbYaw || 0;
    m.updateMatrixWorld(true);
    const mb = new THREE.Box3().setFromObject(m), ms = mb.getSize(new THREE.Vector3());
    const s = Math.min(size.x / ms.x, size.z / ms.z) * 1.0;
    m.scale.setScalar(s); m.updateMatrixWorld(true);
    const mb2 = new THREE.Box3().setFromObject(m), mc = mb2.getCenter(new THREE.Vector3());
    m.position.set(center.x - mc.x, -RIDE - mb2.min.y, center.z - mc.z);
    const prints = [];
    m.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      // clone() shares materials between robots of the same model: give each robot its own print material
      if (mats.some(mt => mt.name === 'print')) {
        const own = mats.map(mt => {
          if (mt.name !== 'print') return mt;
          let c = prints.find(x => x.userData.src === mt);
          if (!c) { c = mt.clone(); c.userData.src = mt; c.userData.perRobot = true; prints.push(c); }
          return c;
        });
        o.material = Array.isArray(o.material) ? own : own[0];
      }
    });
    // animate named weapon nodes if the model has them
    // exact names first, then looser matches ("weapon_mount" must never win over "blade")
    const spinNode = this.def.weapon === 'spinner' && (findNode(m, /^(blade|disc|drum|spinner)$/i) ||
      findNode(m, /blade|disc|drum/i) || findNode(m, /spinner|weapon(?!_mount|_motor)/i));
    const flipNode = this.def.weaponKind === 'flipper' && (findNode(m, /^(flipper|lifter)$/i) || findNode(m, /flipper|lifter/i));
    const wheelNodes = [];
    if (this.def.glbWheels) m.traverse(o => { if (o !== m && this.def.glbWheels.test(o.name || '')) wheelNodes.push(o); });
    const oldParts = this.parts;
    this.root.remove(this.visual);
    this.visual = m; this.root.add(m);
    if (prints.length) { prints.forEach(mt => mt.color.copy(this.printMat.color)); this.printMats = prints; }
    this.parts = { wheels: wheelNodes.map(n => pivotAround(n, 'center')) };
    if (spinNode) {
      // spin about the motor axis when the model has one (blades are often asymmetric around their bbox)
      const motor = findNode(m, /weapon_motor|motor|hub/i);
      const piv = pivotAround(spinNode, 'center', motor);
      const blur = blurDisc(this.def.spinner.radius / s, oldParts.bladeAxis || 'x');
      this.parts.blade = piv; this.parts.blur = blur; this.parts.bladeAxis = oldParts.bladeAxis || 'x';
      piv.parent.add(blur); blur.position.copy(piv.position);
    }
    if (flipNode) { this.parts.flipper = pivotAround(flipNode, 'back'); this.parts.flipRest = this.parts.flipper.rotation.x; }
    else if (oldParts.flipper) {
      // model has no separate flipper part: reuse the placeholder's steel plate, shown only while it kicks
      this.root.add(oldParts.flipper);
      this.parts.flipper = oldParts.flipper; this.parts.flipRest = oldParts.flipRest;
      this.parts.flipperOnlyWhenFiring = true; oldParts.flipper.visible = false;
    }
    if (oldParts.jaw) { this.parts.jaw = oldParts.jaw; this.parts.jawOpen = oldParts.jawOpen; }
    if (oldParts.extras) for (const e of oldParts.extras) this.root.add(e);   // mod parts the GLB does not have
    return { scale: s, prints: prints.length, spin: spinNode ? spinNode.name : false, flip: flipNode ? flipNode.name : !!this.parts.flipper, wheels: wheelNodes.length };
  }
  // GLB authored in the sim frame (glbNative: tools/robots-cad): 1 u = 10 cm, origin = chassis origin,
  // +Z forward, +X left. Every animated node's origin is its pivot and it has no rest rotation:
  //   wheel_N (axle centre), blade (weapon axle), lifter | flipper (hinge), jaw (claw hinge, child of the lifter).
  // Nodes named opt_<slot>_<option> are shown only when that modification is fitted.
  _useNativeModel(m) {
    const d = this.def, oldParts = this.parts;
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.setScalar(1);
    const prints = [], byName = {}, wheelNodes = [];
    const wheelRe = d.glbWheels || /^wheel_\d+$/;
    m.traverse(o => {
      if (o !== m && o.name) {
        if (!byName[o.name]) byName[o.name] = o;
        if (wheelRe.test(o.name)) wheelNodes.push(o);
        const opt = /^opt_([a-z]+)_([a-z0-9]+)$/i.exec(o.name);
        if (opt) o.visible = d.mods ? d.mods[opt[1]] === opt[2] : false;
      }
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some(mt => mt.name === 'print')) {
        const own = mats.map(mt => {
          if (mt.name !== 'print') return mt;
          let c = prints.find(x => x.userData.src === mt);
          if (!c) { c = mt.clone(); c.userData.src = mt; c.userData.perRobot = true; prints.push(c); }
          return c;
        });
        o.material = Array.isArray(o.material) ? own : own[0];
      }
    });
    this.root.remove(this.visual);
    this.visual = m; this.root.add(m);
    if (prints.length) { prints.forEach(mt => mt.color.copy(this.printMat.color)); this.printMats = prints; }
    this.parts = { wheels: wheelNodes };
    const blade = d.spinner && byName.blade;
    if (blade) {
      const axis = oldParts.bladeAxis || (Math.abs(d.spinner.axis[1]) > 0.5 ? 'y' : 'x');
      const blur = blurDisc(d.spinner.radius, axis);
      blade.parent.add(blur); blur.position.copy(blade.position);
      this.parts.blade = blade; this.parts.blur = blur; this.parts.bladeAxis = axis;
    }
    const arm = d.arm && (byName.lifter || byName.flipper);
    if (arm) { this.parts.flipper = arm; this.parts.flipRest = arm.rotation.x; }
    const jaw = d.arm && byName.jaw;
    if (jaw) { this.parts.jaw = jaw; this.parts.jawOpen = oldParts.jawOpen != null ? oldParts.jawOpen : -0.42; jaw.rotation.x = this.parts.jawOpen; }
    if (oldParts.extras) for (const e of oldParts.extras) this.root.add(e);
    return { scale: 1, native: true, prints: prints.length, spin: blade ? blade.name : false, flip: arm ? arm.name : false, jaw: !!jaw, wheels: wheelNodes.length };
  }
}

function blurDisc(r, axis) {
  const b = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color: '#c8c8c2', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  if (axis === 'x') b.rotation.y = Math.PI / 2; else b.rotation.x = -Math.PI / 2;
  return b;
}

function findNode(root, re) {
  let hit = null;
  root.traverse(o => { if (!hit && re.test(o.name || '') && o !== root) hit = o; });
  return hit;
}
// wrap a node in a pivot group placed at its bbox centre (spinner) or back-top edge (flipper)
function pivotAround(node, where, axisRef) {
  const parent = node.parent;
  parent.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(node);
  const wp = where === 'center' ? bb.getCenter(new THREE.Vector3()) : new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y, bb.min.z);
  if (axisRef) { const c = new THREE.Box3().setFromObject(axisRef).getCenter(new THREE.Vector3()); wp.y = c.y; wp.z = c.z; }
  const lp = parent.worldToLocal(wp.clone());
  const piv = new THREE.Group(); piv.position.copy(lp); parent.add(piv);
  piv.updateMatrixWorld(true);
  piv.attach(node);
  return piv;
}
