// Skid-steer drivetrain + battery.
//
// Model (per physics step, no allocations):
//  * Suspension: one ray per mount point (spring-damper). Its force is that contact's normal load N,
//    so weight transfer (nose lifts under acceleration, a wedge lifting your front, gyro precession
//    rolling a vertical spinner) changes each wheel's grip automatically.
//  * DC motor torque–speed line per side: F = F0·(a − v/v0), a = command·V_batt/V_REF.
//    Throttle 0 = ESC brake (back-EMF), reversing into motion plugs the motor (clamped).
//  * Tyre: friction circle on (drive force, lateral scrub force) with static→kinetic hysteresis:
//    ask for more than μs·N and the wheel breaks loose (wheelspin / sideways slide) until the demand
//    drops below μk·N. Skids (non-driven mounts) slide with a low kinetic μ.
//  * Turning: arcade stick → yaw-rate request. With the gyro it is a closed loop on the measured yaw
//    rate (like a heading-hold gyro in a real ESC); without, open loop (faster, twitchier).
//  * Battery: OCV(soc) − I·R. Drive + weapon current sag the voltage, which slows the motors.
import { BATTERY, V_REF } from '../robots/catalog.js';

export class Battery {
  constructor(spec = BATTERY) { this.spec = spec; this.reset(); }
  reset() { this.soc = 1; this.current = 0; this.volts = this.spec.vFull; this.sagLoad = 0; this.rMul = 1; }
  // current: total amps drawn this step
  update(dt, current) {
    const s = this.spec;
    this.current = current;
    this.soc = Math.max(0, this.soc - current * dt / (s.mAh * 3.6));
    const ocv = s.vEmpty + (s.vFull - s.vEmpty) * Math.pow(this.soc, 0.7);
    this.volts = Math.max(s.vEmpty * 0.75, ocv - current * s.rInt * this.rMul);
    this.sagLoad = current * s.rInt * this.rMul;
  }
  get factor() { return this.volts / V_REF; }
}

// scratch
const n = { x: 0, y: 0, z: 0 };
// tyre longitudinal force for wheel surface speed u (see Drive.apply)
function tyreF(u, vLong, vLat, mus, muk, N, s0) {
  const sl = u - vLong, sm = Math.hypot(sl, vLat);
  const mu = muk + (mus - muk) * Math.exp(-sm * 0.9);
  return mu * N * sl / Math.max(sm, s0);
}
// DC motor line (per wheel), clamped where the ESC current limit kicks in
function motorF(u, F0w, a, v0) {
  const f = F0w * (a - u / v0), lim = F0w * 1.25;
  return f > lim ? lim : f < -lim ? -lim : f;
}

export class Drive {
  constructor(def) {
    this.def = def;
    const mounts = def.mounts;
    this.n = mounts.length;
    this.load = new Float32Array(this.n);        // normal force per mount
    this.cx = new Float32Array(this.n); this.cy = new Float32Array(this.n); this.cz = new Float32Array(this.n); // contact points
    this.hit = new Uint8Array(this.n);
    this.nx = new Float32Array(this.n); this.ny = new Float32Array(this.n); this.nz = new Float32Array(this.n); // contact normals
    this.slip = new Uint8Array(this.n);          // 1 = wheel broken loose
    this.alive = new Uint8Array(this.n).fill(1); // wheel still attached
    this.wheelOmega = new Float32Array(2);       // visual wheel speed per side [left, right] rad/s
    this.uL = 0; this.uR = 0; this.yawI = 0; this.current = 0; this.slipping = 0; this.powerMul = 1;
    this.drivenPerSide = [0, 0];
    for (const [x, , d] of mounts) if (d) this.drivenPerSide[x > 0 ? 0 : 1]++;
    // half track of the driven wheels, and the "breakaway" differential a skid steer needs before
    // it turns at all: lateral scrub moment μ·N·|z| of every wheel vs. motor moment F0·hw
    let hw = 0, zs = 0, nd = 0;
    for (const [x, z, d] of mounts) if (d) { hw = Math.max(hw, Math.abs(x)); zs += Math.abs(z); nd++; }
    this.hw = hw || 0.4;
    const F0w = def.drive.fStall / Math.max(1, def.drive.motors), N = def.mass * 30 / mounts.length;
    this.breakaway = Math.min(0.7, def.drive.mu * N * (zs / Math.max(1, nd)) / (F0w * this.hw) * 0.85);
  }
  reset() { this.yawI = 0; this.slip.fill(0); this.alive.fill(1); this.wheelOmega.fill(0); this.uL = this.uR = 0; this.powerMul = 1; }
  drivenAlive(side) {
    let c = 0; const m = this.def.mounts;
    for (let i = 0; i < this.n; i++) if (m[i][2] && this.alive[i] && (side === undefined || (m[i][0] > 0 ? 0 : 1) === side)) c++;
    return c;
  }

  // side commands from stick + measured yaw rate about the robot's own up axis
  command(throttle, turn, yawBody, upSign, handicap, dt) {
    const d = this.def, v0 = d.drive.vFree;
    const hw = this.hw;
    // stick → requested yaw about world up (turn + = right = clockwise from above = −y)
    const want = -turn * d.yawRate * (1 - 0.22 * Math.abs(throttle));
    let diff;
    if (d.gyro) {
      // feed-forward + PI yaw-rate loop: tyre scrub needs extra differential, the integrator
      // removes the "sticky" dead band of a 4WD skid steer on small corrections
      const err = want - yawBody;
      this.yawI = Math.max(-0.6, Math.min(0.6, this.yawI * (1 - dt * 1.5) + err * dt));
      if (turn === 0 && Math.abs(err) < 0.3) this.yawI *= 1 - dt * 8;
      diff = (want * 2.2 + err * 1.6 + this.yawI * 5) * hw / v0;
    } else {
      diff = want * 3.2 * hw / v0;
    }
    // feed-forward breakaway (smoothly in): small corrections still turn the robot
    diff += Math.sign(want) * this.breakaway * Math.min(1, Math.abs(want) / 1.2);
    if (diff > 1) diff = 1; else if (diff < -1) diff = -1;
    // steering has priority: throttle gives way so the differential is never clipped
    let th = throttle * handicap * (throttle < 0 ? 0.9 : 1);
    const room = 1 - Math.abs(diff);
    if (th > room) th = room; else if (th < -room) th = -room;
    this.uL = th - diff; this.uR = th + diff;
    if (upSign < 0) { const t = this.uL; this.uL = this.uR; this.uR = t; }   // auto-invert: wheels on the other side face the floor
  }

  // apply suspension + tyre forces. ctx: { body, world, ray, groups, frame vectors, lin, ang, com, m, nrm }
  // Returns number of driven wheels in contact.
  apply(dt, r, battery) {
    const d = this.def, b = r.body, dr = d.drive;
    const m = r.mass, lin = r._lin, ang = r._ang, com = r._com, nrm = r._nrm;
    const RIDE = r.RIDE, rest = r.REST, TRAVEL = rest - RIDE;
    const k = m / 4 * r.G / TRAVEL, c = 2 * Math.sqrt(k * m / 4) * 0.75;
    let contacts = 0, drivenC = 0;
    const ray = r.ray, sx = r._side;
    // wheels touch the floor at the lowest point of their circle: world-down projected into the
    // wheel plane (⟂ body X). That keeps round wheels on the floor through pitch (wheelies, being
    // wedged), which body-down rays would not.
    let wdx = -sx.y * sx.x, wdy = -1 + sx.y * sx.y, wdz = -sx.y * sx.z;
    const wl = Math.hypot(wdx, wdy, wdz);
    const wheelsOk = wl > 0.3 && (d.invertible ? Math.abs(r.up.y) > 0.2 : r.up.y > 0.2);
    if (wl > 1e-6) { wdx /= wl; wdy /= wl; wdz /= wl; }
    const R = d.wheelR, axleY = -RIDE + R;
    // ---- suspension
    for (let i = 0; i < this.n; i++) {
      this.hit[i] = 0; this.load[i] = 0;
      const mt = d.mounts[i];
      const wheel = mt[2] && this.alive[i];
      if (mt[2] && !this.alive[i]) continue;          // lost wheel: that corner sits on the frame
      if (wheel && !wheelsOk) continue;
      let dx, dy, dz, len;
      if (wheel) { dx = wdx; dy = wdy; dz = wdz; len = R + TRAVEL; }
      else { dx = -nrm.x; dy = -nrm.y; dz = -nrm.z; len = rest; }
      const o = r.toWorld(mt[0], wheel ? axleY : 0, mt[1], r._o2);
      ray.origin.x = o.x; ray.origin.y = o.y; ray.origin.z = o.z; ray.dir.x = dx; ray.dir.y = dy; ray.dir.z = dz;
      const hit = r.world.castRay(ray, len + 0.06, true, undefined, r.rayGroups, undefined, b);
      if (!hit || hit.timeOfImpact > len) continue;
      const comp = len - hit.timeOfImpact;
      const rx = o.x - com.x, ry = o.y - com.y, rz = o.z - com.z;
      const vx = lin.x + ang.y * rz - ang.z * ry, vy = lin.y + ang.z * rx - ang.x * rz, vz = lin.z + ang.x * ry - ang.y * rx;
      const vn = -(vx * dx + vy * dy + vz * dz);
      const F = Math.max(0, k * comp - c * vn);
      n.x = -dx * F * dt; n.y = -dy * F * dt; n.z = -dz * F * dt;
      b.applyImpulseAtPoint(n, o, true);
      this.load[i] = F; this.hit[i] = 1; contacts++;
      this.cx[i] = o.x + dx * hit.timeOfImpact; this.cy[i] = o.y + dy * hit.timeOfImpact; this.cz[i] = o.z + dz * hit.timeOfImpact;
      this.nx[i] = -dx; this.ny[i] = -dy; this.nz[i] = -dz;
      if (wheel) drivenC++;
    }
    // ---- tyres
    const fx = r.fwd;
    const v0 = dr.vFree, vb = battery.factor * this.powerMul;
    const F0w = dr.fStall / Math.max(1, dr.motors);   // per driven wheel
    const share = m / Math.max(1, contacts);
    let amps = 0, slipping = 0;
    let vSideL = 0, nL = 0, vSideR = 0, nR = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.hit[i]) continue;
      const mt = d.mounts[i], N = this.load[i];
      const px = this.cx[i], py = this.cy[i], pz = this.cz[i];
      const rx = px - com.x, ry = py - com.y, rz = pz - com.z;
      const vx = lin.x + ang.y * rz - ang.z * ry, vy = lin.y + ang.z * rx - ang.x * rz, vz = lin.z + ang.x * ry - ang.y * rx;
      // rolling direction: body forward projected onto the contact plane
      const cnx = this.nx[i], cny = this.ny[i], cnz = this.nz[i];
      const fn = fx.x * cnx + fx.y * cny + fx.z * cnz;
      let tx = fx.x - fn * cnx, ty = fx.y - fn * cny, tz = fx.z - fn * cnz;
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const vLong = vx * tx + vy * ty + vz * tz;
      const vLat = vx * sx.x + vy * sx.y + vz * sx.z;
      let FL, FS, cap;
      if (mt[2]) {
        const left = mt[0] > 0;
        const a = (left ? this.uL : this.uR) * vb;
        // Combined-slip tyre: the patch slips with s = (u − vLong, −vLat) where u = wheel surface speed.
        // Friction opposes s, |F| = μ(|s|)·N·min(1, |s|/s0); μ falls from μs to μk as the slip grows
        // (wheelspin). Quasi-static wheel: find u where motor force = tyre longitudinal force.
        const s0 = dr.s0, mus = dr.mu, muk = dr.mu * dr.kin;
        let lo = Math.min(vLong, a * v0) - 1, hi = Math.max(vLong, a * v0) + 1;
        for (let it = 0; it < 14; it++) { const mid = (lo + hi) * 0.5; if (motorF(mid, F0w, a, v0) > tyreF(mid, vLong, vLat, mus, muk, N, s0)) lo = mid; else hi = mid; }
        const u = (lo + hi) * 0.5, sl = u - vLong, sm = Math.hypot(sl, vLat);
        const mu = muk + (mus - muk) * Math.exp(-sm * 0.9);
        const k = mu * N / Math.max(sm, s0);
        FL = k * sl; FS = -k * vLat;
        // explicit-step safety: never push past the velocity that removes the slip
        const capL = Math.abs(sl) * share / dt * 0.8, capS = Math.abs(vLat) * share / dt * dr.latStiff;
        if (FL > capL) FL = capL; else if (FL < -capL) FL = -capL;
        if (FS > capS) FS = capS; else if (FS < -capS) FS = -capS;
        FL -= Math.sign(vLong) * dr.crr * N;
        amps += Math.min(1.25, Math.abs(motorF(u, F0w, a, v0) / F0w)) * dr.iStall;
        const spinning = Math.abs(sl) > 0.9;
        this.slip[i] = spinning || Math.abs(vLat) > 0.9 ? 1 : 0;
        if (this.slip[i]) slipping++;
        if (left) { vSideL += u; nL++; } else { vSideR += u; nR++; }
      } else {
        // skid / frame corner: kinetic sliding friction against the planar velocity
        cap = dr.skidMu * N;
        FL = -vLong * share / dt * 0.5; FS = -vLat * share / dt * 0.5;
        const mag = Math.hypot(FL, FS);
        if (mag > cap) { const s = cap / mag; FL *= s; FS *= s; }
      }
      n.x = (tx * FL + sx.x * FS) * dt; n.y = (ty * FL + sx.y * FS) * dt; n.z = (tz * FL + sx.z * FS) * dt;
      // forces act at the contact patch, below the centre of mass → pitch/roll moments → weight transfer
      r._o.set(px, py, pz);
      b.applyImpulseAtPoint(n, r._o, true);
    }
    // wheel visual speeds (free-spinning in the air)
    const tgtL = nL ? vSideL / nL / R : this.uL * vb * v0 / R, tgtR = nR ? vSideR / nR / R : this.uR * vb * v0 / R;
    const kk = Math.min(1, dt * (nL ? 30 : 6));
    this.wheelOmega[0] += (tgtL - this.wheelOmega[0]) * kk;
    this.wheelOmega[1] += (tgtR - this.wheelOmega[1]) * Math.min(1, dt * (nR ? 30 : 6));
    // motors still draw current while spinning in the air (small)
    if (!drivenC) amps += (Math.abs(this.uL) + Math.abs(this.uR)) * 0.2 * dr.iStall;
    this.current = amps; this.slipping = slipping;
    return drivenC;
  }
}
