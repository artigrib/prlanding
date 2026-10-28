// Robot definitions, placeholder meshes, physics (raycast suspension + arcade skid-steer)
// and weapons. Local frame: +Z forward, +Y up, +X left side of the robot... (right-handed).
import * as THREE from 'three';

export const GRAVITY = 30;               // units/s² (1 unit = 10 cm), arcade-tuned
const RIDE = 0.27;                        // chassis origin height above the floor at rest

export const ROBOTS = {
  svrn: {
    id: 'svrn', name: 'Project SVRN', short: 'SVRN', weapon: 'flipper',
    blurb: 'Pohon 4×4, klín a flipper',
    mass: 1.5, vmax: 6.6, yawMax: 4.3, mu: 1.15,
    chassis: [0.54, 0.15, 0.45],                                   // collider half extents (incl. wheels)
    mounts: [[0.4, 0.3, 1], [-0.4, 0.3, 1], [0.4, -0.3, 1], [-0.4, -0.3, 1]],   // x, z, drives
    wheels: [[0.48, 0.28], [-0.48, 0.28], [0.48, -0.28], [-0.48, -0.28]], wheelR: 0.2,
    glbYaw: 0, glbWheels: /^(SV06|SV07)_\d+$/   // printed hubs + TPU tyres in svrn.glb
  },
  vert150: {
    id: 'vert150', name: 'Vertikální spinner 150 g', short: 'VERT', weapon: 'spinner',
    preparing: true,   // kit not on sale yet: end screen asks to be notified instead of "build it"
    blurb: 'Dvoukolový vertikální spinner',
    mass: 1.5, vmax: 6.1, yawMax: 5.0, mu: 1.0, invertible: true,
    chassis: [0.56, 0.12, 0.4],
    mounts: [[0.42, -0.15, 1], [-0.42, -0.15, 1], [0.16, 0.36, 0], [-0.16, 0.36, 0]],
    wheels: [[0.48, -0.15], [-0.48, -0.15]], wheelR: 0.25,
    glbYaw: 0, glbWheels: /^wheel_\d+(_tyre|_hub)?$/i
  }
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Vector3(), _o2 = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V = o => new THREE.Vector3(o.x, o.y, o.z);

// ---------------------------------------------------------------- visuals
function placeholder(def, printMat) {
  const g = new THREE.Group();
  const ink = new THREE.MeshStandardMaterial({ color: '#1d1d1d', roughness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: '#b9bab5', roughness: 0.35, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2A2A2A', roughness: 0.6 });
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const parts = { wheels: [] };
  const wheelGeo = new THREE.CylinderGeometry(def.wheelR, def.wheelR, 0.12, 20); wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(def.wheelR * 0.45, def.wheelR * 0.45, 0.13, 6); hubGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of def.wheels) {
    const w = new THREE.Group(); w.position.set(x, -RIDE + def.wheelR, z); g.add(w);
    add(wheelGeo, ink, 0, 0, 0, w); add(hubGeo, printMat, 0, 0, 0, w);
    parts.wheels.push(w);
  }
  if (def.id === 'svrn') {
    add(new THREE.BoxGeometry(0.82, 0.26, 0.86), printMat, 0, -0.01, -0.02);
    add(new THREE.BoxGeometry(0.62, 0.04, 0.56), dark, 0, 0.13, -0.08);            // lid
    add(new THREE.BoxGeometry(0.06, 0.05, 0.06), new THREE.MeshStandardMaterial({ color: '#E8461E' }), 0.22, 0.165, -0.28); // switch
    // wedge / flipper plate, hinged at the top front edge
    const pivot = new THREE.Group(); pivot.position.set(0, 0.12, 0.42); g.add(pivot);
    const tip = new THREE.Vector3(0, -0.255 - 0.12, 0.86 - 0.42);
    const len = tip.length(), ang = Math.atan2(-tip.y, tip.z);
    const plate = add(new THREE.BoxGeometry(0.98, 0.035, len), steel, 0, 0, len / 2, pivot);
    plate.rotation.x = 0; pivot.rotation.x = ang;
    parts.flipper = pivot; parts.flipRest = ang;
    // side armour (TPU in the real kit)
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.18, 0.5), dark, s * 0.555, -0.02, 0);
  } else {
    add(new THREE.BoxGeometry(0.74, 0.2, 0.74), printMat, 0, -0.02, -0.08);
    add(new THREE.BoxGeometry(0.6, 0.03, 0.58), dark, 0, 0.095, -0.1);
    // forks
    for (const s of [-1, 1]) {
      const f = add(new THREE.BoxGeometry(0.07, 0.2, 0.42), printMat, s * 0.13, -0.03, 0.42);
      f.rotation.x = -0.12;
    }
    const axle = new THREE.Group(); axle.position.set(0, 0, 0.5); g.add(axle);
    const blade = new THREE.Group(); axle.add(blade);
    add(new THREE.BoxGeometry(0.075, 0.56, 0.11), steel, 0, 0, 0, blade);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.09, 0.16), steel, 0, s * 0.24, s * 0.03, blade); // teeth
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 12).rotateZ(Math.PI / 2), dark, 0, 0, 0, axle);
    const blur = new THREE.Mesh(new THREE.CircleGeometry(0.29, 32), new THREE.MeshBasicMaterial({ color: '#c8c8c2', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    blur.rotation.y = Math.PI / 2; axle.add(blur);
    parts.blade = blade; parts.blur = blur;
    add(new THREE.BoxGeometry(0.06, 0.05, 0.06), new THREE.MeshStandardMaterial({ color: '#E8461E' }), -0.22, 0.12, -0.32);
  }
  return { group: g, parts };
}

// ---------------------------------------------------------------- robot
export class Robot {
  constructor(def, color, scene) {
    this.def = def;
    this.printMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });
    this.printMats = [this.printMat];
    this.root = new THREE.Group(); scene.add(this.root);
    const ph = placeholder(def, this.printMat);
    this.visual = ph.group; this.parts = ph.parts; this.root.add(this.visual);
    this.wheelSpin = 0; this.flipAnim = 0; this.bladeAngle = 0; this.handicap = 1;
    this.resetState();
  }
  resetState() {
    this.spin = 0; this.weaponOn = false; this.cooldown = 0; this.hitCooldown = 0;
    this.flippedTime = 0; this.contacts = 0; this.score = 0; this.hits = 0; this.wiggle = 0;
  }
  setColor(hex) { this.printMats.forEach(m => m.color.set(hex)); }

  attachPhysics(RAPIER, world) {
    this.R = RAPIER; this.world = world;
    const d = this.def;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true)
      .setLinearDamping(0.05).setAngularDamping(0.4).setCanSleep(false));
    const [hx, hy, hz] = d.chassis;
    const cz = d.id === 'vert150' ? -0.05 : 0;
    this.colliders = [];
    const chassis = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, d.id === 'vert150' ? -0.01 : 0, cz)
      .setMass(d.mass * 0.88).setFriction(0.35).setRestitution(0.08);
    this.colliders.push(world.createCollider(chassis, this.body));
    if (d.id === 'svrn') {
      const pts = [];
      for (const s of [-1, 1]) pts.push(s * 0.5, 0.11, 0.42, s * 0.5, -0.15, 0.42, s * 0.5, -0.255, 0.86, s * 0.5, -0.215, 0.86);
      const wedge = RAPIER.ColliderDesc.convexHull(new Float32Array(pts)).setMass(d.mass * 0.12).setFriction(0.04).setRestitution(0.02);
      this.colliders.push(world.createCollider(wedge, this.body));
    } else {
      const fork = RAPIER.ColliderDesc.cuboid(0.2, 0.17, 0.17).setTranslation(0, -0.03, 0.47).setMass(d.mass * 0.12).setFriction(0.2).setRestitution(0.05);
      this.colliders.push(world.createCollider(fork, this.body));
    }
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  reset(x, z, yaw) {
    this.resetState();
    _q.setFromAxisAngle(Y, yaw);
    this.body.setTranslation({ x, y: RIDE + 0.02, z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.sync(0);
  }

  // frame vectors from the physics body
  // (vectors are reused between calls: clone them if you need to keep a value)
  frame() {
    if (!this.q) { this.q = new THREE.Quaternion(); this.qi = new THREE.Quaternion(); this.pos = new THREE.Vector3(); this.up = new THREE.Vector3(); this.fwd = new THREE.Vector3(); }
    const r = this.body.rotation(); this.q.set(r.x, r.y, r.z, r.w); this.qi.copy(this.q).invert();
    const t = this.body.translation(); this.pos.set(t.x, t.y, t.z);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
    this.fwd.set(0, 0, 1).applyQuaternion(this.q);
    return this;
  }
  local(p, out = new THREE.Vector3()) { return out.copy(p).sub(this.pos).applyQuaternion(this.qi); }
  toWorld(lx, ly, lz, out = new THREE.Vector3()) { return out.set(lx, ly, lz).applyQuaternion(this.q).add(this.pos); }

  // one fixed physics step: suspension, drive, weapon
  step(dt, input, opp, fx) {
    const R = this.R, b = this.body, d = this.def;
    this.frame();
    const m = b.mass();
    const lin = V(b.linvel()), ang = V(b.angvel()), com = V(b.worldCom());
    const rest = 0.32, k = m / 4 * GRAVITY / (rest - RIDE), c = 2 * Math.sqrt(k * m / 4) * 0.75;
    let load = 0, driveC = 0, driveN = 0;
    // invertible robots (big wheels) drive on either side
    const inv = d.invertible && this.up.y < -0.35;
    const nrm = inv ? this.up.clone().negate() : this.up;
    const down = nrm.clone().negate();
    this.inverted = inv;
    for (const [mx, mz, drives] of d.mounts) {
      if (drives) driveN++;
      const o = this.toWorld(mx, 0, mz, _o2);
      const ray = this.ray;
      ray.origin.x = o.x; ray.origin.y = o.y; ray.origin.z = o.z; ray.dir.x = down.x; ray.dir.y = down.y; ray.dir.z = down.z;
      const hit = this.world.castRay(ray, rest + 0.06, true, undefined, undefined, undefined, b);
      if (!hit || hit.timeOfImpact > rest) continue;
      const comp = rest - hit.timeOfImpact;
      const vp = _v.copy(ang).cross(_w.copy(o).sub(com)).add(lin);
      const F = Math.max(0, k * comp - c * vp.dot(nrm));
      b.applyImpulseAtPoint({ x: nrm.x * F * dt, y: nrm.y * F * dt, z: nrm.z * F * dt }, o, true);
      load += F;
      if (drives && nrm.y > 0.35) driveC++;
    }
    this.contacts = driveC;
    const grounded = driveC / driveN;

    // flipped / stranded detection
    const tilt = d.invertible ? Math.abs(this.up.y) : this.up.y;
    if (tilt < 0.25 && driveC === 0) this.flippedTime += dt; else if (tilt > 0.5 || driveC > 0) this.flippedTime = 0;

    if (grounded > 0) {
      const fl = _o.set(this.fwd.x, 0, this.fwd.z);
      if (fl.lengthSq() > 1e-4) {
        fl.normalize();
        const side = new THREE.Vector3(fl.z, 0, -fl.x);
        const Fmax = d.mu * Math.max(load, m * GRAVITY * 0.5) * grounded;
        const target = input.throttle * d.vmax * this.handicap * (input.throttle < 0 ? 0.85 : 1);
        const vL = lin.dot(fl), vS = lin.dot(side);
        const FL = clamp((target - vL) * 9 * m, -Fmax, Fmax);
        const FS = clamp(-vS * 14 * m, -Fmax, Fmax);
        b.applyImpulse({ x: (fl.x * FL + side.x * FS) * dt, y: 0, z: (fl.z * FL + side.z * FS) * dt }, true);
        // yaw: blend toward the commanded rate (skid steer); spinning vert is gyroscopically slower
        const gyro = d.weapon === 'spinner' ? 1 - 0.35 * this.spin : 1;
        const want = -input.turn * d.yawMax * gyro * (1 - 0.25 * Math.abs(input.throttle));
        const wy = ang.y, blend = Math.min(1, 14 * dt) * grounded;
        b.setAngvel({ x: ang.x, y: wy + (want - wy) * blend, z: ang.z }, true);
      }
    } else if ((d.invertible ? Math.abs(this.up.y) : this.up.y) < 0.4 && Math.abs(lin.y) < 0.8 && this.restingOnSomething() && (Math.abs(input.throttle) + Math.abs(input.turn)) > 0.3) {
      // stranded: driving the wheels rocks the robot a bit — sometimes enough to roll back
      this.wiggle += dt;
      if (this.wiggle > 0.55) {
        this.wiggle = 0;
        b.applyImpulse({ x: 0, y: m * 2.2, z: 0 }, true);
        const ax = this.fwd.clone().multiplyScalar(Math.sign(input.turn || 1) * (3 + Math.random() * 3));
        b.setAngvel({ x: ang.x + ax.x, y: ang.y + ax.y, z: ang.z + ax.z }, true);
      }
    }
    this.vLong = lin.dot(this.fwd);

    // weapons
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    if (d.weapon === 'flipper') this.stepFlipper(input, opp, fx, m);
    else this.stepSpinner(dt, input, opp, fx, m);
  }

  // is anything right below the robot? (stops mid-air "wiggle" control)
  restingOnSomething() {
    const ray = this.ray, t = this.pos;
    ray.origin.x = t.x; ray.origin.y = t.y; ray.origin.z = t.z; ray.dir.x = 0; ray.dir.y = -1; ray.dir.z = 0;
    return !!this.world.castRay(ray, 0.6, true, undefined, undefined, undefined, this.body);
  }

  stepFlipper(input, opp, fx, m) {
    if (!input.fire || this.cooldown > 0) return;
    this.cooldown = this.handicap < 1 ? 1.6 : 0.9; this.flipAnim = 1; fx.flip(this);
    const b = this.body;
    if (this.up.y < 0.35) {
      // self-righting: kick off the floor and roll back onto the wheels
      b.applyImpulse({ x: 0, y: m * 7.5, z: 0 }, true);
      let axis = new THREE.Vector3().crossVectors(this.up, Y);
      if (axis.lengthSq() < 0.05) axis.copy(this.fwd);
      axis.normalize().multiplyScalar(7.5);
      b.setAngvel({ x: axis.x, y: axis.y, z: axis.z }, true);
      return;
    }
    opp.frame();
    const l = this.local(opp.pos);
    if (l.z > 0.3 && l.z < 1.4 && Math.abs(l.x) < 0.85 && l.y < 0.9 && l.y > -0.5) {
      const om = opp.body.mass();
      const j = this.up.clone().multiplyScalar(7.4).add(this.fwd.clone().multiplyScalar(1.6)).multiplyScalar(om);
      // lift the near edge so the opponent rotates over
      const p = opp.pos.clone().add(this.pos.clone().sub(opp.pos).setY(0).setLength(0.32));
      opp.body.applyImpulseAtPoint({ x: j.x, y: j.y, z: j.z }, p, true);
      this.body.applyImpulse({ x: 0, y: -m * 2, z: 0 }, true);
      this.hits++; this.score += 3; fx.hit(this, p, 0.6);
    }
  }

  stepSpinner(dt, input, opp, fx, m) {
    if (input.fire) this.weaponOn = !this.weaponOn;
    this.spin = clamp(this.spin + (this.weaponOn ? 0.5 : -0.3) * dt, 0, 1);
    if (this.spin < 0.5 || this.hitCooldown > 0) return;
    // sample the front arc of the blade
    for (let i = 0; i <= 8; i++) {
      const th = THREE.MathUtils.degToRad(-80 + i * 15);
      for (const r of [0.28, 0.34]) {
        const p = this.toWorld(0, Math.sin(th) * r, 0.5 + Math.cos(th) * r);
        if (!opp.colliders.some(c => c.containsPoint(p))) continue;
        const e = this.spin, om = opp.body.mass();
        const dir = this.fwd.clone().setY(0).normalize().multiplyScalar(0.75).add(new THREE.Vector3(0, 0.7, 0)).normalize();
        const J = 6.4 * e * om;
        // apply between the contact and the opponent's centre: a toss with some tumble, not an instant flip
        const at = p.clone().lerp(V(opp.body.worldCom()), 0.6);
        opp.body.applyImpulseAtPoint({ x: dir.x * J, y: dir.y * J, z: dir.z * J }, at, true);
        const rc = this.fwd.clone().multiplyScalar(-0.55 * J).add(new THREE.Vector3(0, 0.22 * J, 0));
        this.body.applyImpulseAtPoint({ x: rc.x, y: rc.y, z: rc.z }, this.toWorld(0, 0, 0.5), true);
        this.spin *= 0.15; this.hitCooldown = 0.35; this.hits++; this.score += Math.round(1 + 3 * e);
        fx.hit(this, p, e);
        return;
      }
    }
  }

  // copy physics → meshes and animate parts
  sync(dt) {
    if (!this.body) return;
    const t = this.body.translation(), r = this.body.rotation();
    this.root.position.set(t.x, t.y, t.z); this.root.quaternion.set(r.x, r.y, r.z, r.w);
    const p = this.parts;
    if (dt) {
      this.wheelSpin += (this.vLong || 0) / this.def.wheelR * dt;
      p.wheels && p.wheels.forEach(w => { w.rotation.x = this.wheelSpin; });
      if (p.flipper) {
        this.flipAnim = Math.max(0, this.flipAnim - dt * 3.2);
        const k = this.flipAnim > 0.7 ? (1 - this.flipAnim) / 0.3 : this.flipAnim / 0.7;
        p.flipper.rotation.x = p.flipRest - k * 1.25;
      }
      if (p.blade) {
        this.bladeAngle += this.spin * 70 * dt;
        p.blade.rotation.x = this.bladeAngle;
        p.blur.material.opacity = Math.max(0, this.spin - 0.3) * 0.55;
      }
    }
  }

  // swap the placeholder for a GLB (scaled to the placeholder's footprint)
  useModel(gltfScene) {
    // measure in the robot's local frame (the root may be posed/rotated already)
    const savedP = this.root.position.clone(), savedQ = this.root.quaternion.clone();
    this.root.position.set(0, 0, 0); this.root.quaternion.identity(); this.root.updateMatrixWorld(true);
    const info = this._useModel(gltfScene);
    this.root.position.copy(savedP); this.root.quaternion.copy(savedQ); this.root.updateMatrixWorld(true);
    return info;
  }
  _useModel(gltfScene) {
    const box = new THREE.Box3().setFromObject(this.visual);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
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
      mats.forEach(mt => { if (mt.name === 'print' && !prints.includes(mt)) prints.push(mt); });
    });
    // animate named weapon nodes if the model has them
    // exact names first, then looser matches ("weapon_mount" must never win over "blade")
    const spinNode = this.def.weapon === 'spinner' && (findNode(m, /^(blade|disc|drum|spinner)$/i) ||
      findNode(m, /blade|disc|drum/i) || findNode(m, /spinner|weapon(?!_mount|_motor)/i));
    const flipNode = this.def.weapon === 'flipper' && (findNode(m, /^(flipper|lifter)$/i) || findNode(m, /flipper|lifter/i));
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
      const blur = new THREE.Mesh(new THREE.CircleGeometry(0.29 / s, 32), new THREE.MeshBasicMaterial({ color: '#c8c8c2', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      blur.rotation.y = Math.PI / 2;
      this.parts.blade = piv; this.parts.blur = blur;
      piv.parent.add(blur); blur.position.copy(piv.position);
    }
    if (flipNode) { this.parts.flipper = pivotAround(flipNode, 'back'); this.parts.flipRest = this.parts.flipper.rotation.x; }
    else if (oldParts.flipper) {
      // model has no separate flipper part: keep the placeholder's steel flipper plate on top of it
      this.root.add(oldParts.flipper);
      this.parts.flipper = oldParts.flipper; this.parts.flipRest = oldParts.flipRest;
    }
    return { scale: s, prints: prints.length, spin: spinNode ? spinNode.name : false, flip: flipNode ? flipNode.name : !!this.parts.flipper, wheels: wheelNodes.length };
  }
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
