// Opponent AI with three personalities.
//  Začátečník – slow reactions, sloppy aim, forgets the weapon, never plans a push.
//  Pokročilý  – leads the target, uses the weapon sensibly, unsticks itself.
//  Mistr      – flanks around the weapon side, pushes toward the nearest hazard,
//               self-rights instantly and backs off to spin up.
import * as THREE from 'three';

export const LEVELS = {
  easy:   { id: 'easy', name: 'Začátečník', blurb: 'Pomalé reakce, učí se jezdit', handicap: 0.74, react: [0.22, 0.14], aimErr: 0.35, lead: 0, fireP: 0.12, selfRight: 2.2, flank: false, herd: false, spinUpAt: 2.5 },
  normal: { id: 'normal', name: 'Pokročilý', blurb: 'Míří, tlačí a používá zbraň', handicap: 0.88, react: [0.09, 0.06], aimErr: 0.08, lead: 0.25, fireP: 0.35, selfRight: 0.7, flank: false, herd: false, spinUpAt: 0.6 },
  hard:   { id: 'hard', name: 'Mistr', blurb: 'Obchází zbraň a tlačí do jámy', handicap: 1.0, react: [0.04, 0.03], aimErr: 0, lead: 0.4, fireP: 0.9, selfRight: 0.15, flank: true, herd: true, wary: true, spinUpAt: 0.2 },
  dummy:  { id: 'dummy', name: 'Figurína', blurb: 'Stojí a čeká', handicap: 1, react: [0.3, 0.1], aimErr: 0, lead: 0, fireP: 0, selfRight: 0.5, flank: false, herd: false, spinUpAt: 1e9, idle: true }
};

const _l = new THREE.Vector3(), _t = new THREE.Vector3();
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export function createBrain(levelId, map) {
  const L = LEVELS[levelId] || LEVELS.normal;
  const s = { t: 0, stuck: 0, backing: 0, backTurn: 1, err: 0, errT: 0, wander: 0, calm: 0, commit: 0 };
  const cmd = { throttle: 0, turn: 0, fire: false };
  return {
    level: L,
    reset() { Object.assign(s, { t: 0, stuck: 0, backing: 0, err: 0, errT: 0, calm: 0, commit: 0 }); },
    think(ai, op, dt, time) {
      const me = ai.frame(), o = op.frame();
      s.t -= dt; s.errT -= dt;
      // standoff breaker: no contact for 6 s -> commit to a straight attack for 3 s (no flanking, no backing off)
      const gap = Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z);
      if (gap < 1.2) s.calm = 0; else s.calm += dt;
      if (s.commit > 0) s.commit -= dt;
      else if (s.calm > 6 && !L.idle) { s.commit = 3; s.calm = 0; }
      const committed = s.commit > 0;
      cmd.fire = false;
      const flipper = ai.def.weapon === 'flipper', spinner = ai.def.weapon === 'spinner';
      if (spinner && !ai.weaponOn && time > L.spinUpAt) cmd.fire = true;
      // self-righting (a flipped flipper bot fires to roll back)
      if (flipper && me.up.y < 0.35 && ai.flippedTime > L.selfRight && ai.cooldown <= 0) cmd.fire = true;
      const hooks = typeof ai.suggestFire === 'function';
      if (hooks) {
        // physics agent's hook says what a sensible pilot would press; the level decides how often we listen
        cmd.fire = false;
        const upside = me.up.y < 0.35 && !ai.def.invertible;
        if (spinner) cmd.fire = time > L.spinUpAt && ai.suggestFire(o);
        else if (upside) cmd.fire = ai.flippedTime > L.selfRight && ai.suggestFire(o);
      }
      if (L.idle) { cmd.throttle = 0; cmd.turn = 0; return cmd; }
      if (s.t > 0) return cmd;
      s.t = L.react[0] + Math.random() * L.react[1];
      if (hooks && flipper && me.up.y >= 0.35) {
        if (ai.suggestFire(o) && Math.random() < L.fireP) cmd.fire = true;
      } else if (flipper && ai.cooldown <= 0) {
        const l = me.local(o.pos, _l);
        const window = L.flank ? 1.25 : 1.15;
        if (l.z > 0.35 && l.z < window && Math.abs(l.x) < 0.7 && Math.random() < L.fireP) cmd.fire = true;
      }
      const v = ai.body.linvel(), speed = Math.hypot(v.x, v.z);
      if (s.backing > 0) {
        s.backing -= s.t;
        cmd.throttle = -0.8; cmd.turn = s.backTurn * 0.7; return cmd;
      }
      // where to drive
      const pv = op.body.linvel();
      _t.set(o.pos.x + pv.x * L.lead, 0, o.pos.z + pv.z * L.lead);
      const dist = Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z);
      if (L.flank && !committed && dist > 1.8 && op.def.weapon === 'spinner' && (op.spin || 0) > 0.5) {
        // avoid the opponent's weapon face: aim at a point beside / behind it
        const ofx = o.fwd.x, ofz = o.fwd.z, n = Math.hypot(ofx, ofz) || 1;
        const tox = (me.pos.x - o.pos.x) / (dist || 1), toz = (me.pos.z - o.pos.z) / (dist || 1);
        const facing = (ofx * tox + ofz * toz) / n;           // 1 = it is looking at us
        if (facing > 0.4) {
          const side = (ofx * toz - ofz * tox) > 0 ? 1 : -1;
          _t.x += (-ofz / n) * side * 1.2 - (ofx / n) * 0.4;
          _t.z += (ofx / n) * side * 1.2 - (ofz / n) * 0.4;
        }
      }
      if (L.herd && dist < 2.2 && map.hazards && map.hazards.length) {
        // line up so the shove carries the opponent toward the nearest hazard
        let best = null, bd = 1e9;
        for (const h of map.hazards) { const dd = Math.hypot(h.x - o.pos.x, h.z - o.pos.z); if (dd < bd) { bd = dd; best = h; } }
        if (best && bd < 7) {
          const hx = (best.x - o.pos.x) / bd, hz = (best.z - o.pos.z) / bd;
          // stand behind the opponent on the far side from the hazard, then drive through it
          const bx = o.pos.x - hx * 0.9, bz = o.pos.z - hz * 0.9;
          const behind = ((me.pos.x - o.pos.x) * hx + (me.pos.z - o.pos.z) * hz) < -0.3;
          if (!behind) _t.set(bx, 0, bz); else _t.set(o.pos.x + hx * 1.2, 0, o.pos.z + hz * 1.2);
        }
      }
      // grabber holding the opponent: carry it to the nearest pit (not the beginner)
      const holding = ai.arm && ai.arm.holding;
      if (holding && levelId !== 'easy' && map.hazards && map.hazards.length) {
        let best = map.hazards[0], bd = 1e9;
        for (const h of map.hazards) { const dd = Math.hypot(h.x - me.pos.x, h.z - me.pos.z); if (dd < bd) { bd = dd; best = h; } }
        _t.set(best.x, 0, best.z);
        // opponent dangling over the hazard: let go and back off
        if (map.hazardAt(o.pos.x, o.pos.z)) { cmd.fire = true; s.backing = 0.5; s.backTurn = 0; }
      }
      // wary (master): never get pinned between the opponent and a pit – slip sideways out of the line
      if (L.wary && !committed && !holding && map.hazards && map.hazards.length) {
        for (const h of map.hazards) {
          const hx = h.x - me.pos.x, hz = h.z - me.pos.z, hd = Math.hypot(hx, hz);
          if (hd > 2.8 || hd < 1e-3) continue;
          const ox = me.pos.x - o.pos.x, oz = me.pos.z - o.pos.z, od = Math.hypot(ox, oz) || 1;
          if ((ox * hx + oz * hz) / (od * hd) < 0.45) continue;
          // perpendicular to the hazard direction, on the side away from the opponent's approach
          let px = -hz / hd, pz = hx / hd;
          if (px * (o.pos.x - me.pos.x) + pz * (o.pos.z - me.pos.z) > 0) { px = -px; pz = -pz; }
          _t.set(me.pos.x + px * 2 - hx / hd * 0.8, 0, me.pos.z + pz * 2 - hz / hd * 0.8);
          break;
        }
      }
      if (s.errT <= 0) { s.err = (Math.random() - 0.5) * 2 * L.aimErr; s.errT = 0.6 + Math.random(); }
      // spinner with a slow blade keeps its distance while it spins up (master only)
      let retreat = !committed && L.flank && spinner && ai.weaponOn && ai.spin < 0.55 && dist < 2.5;
      const heading = Math.atan2(me.fwd.x, me.fwd.z);
      const want = Math.atan2(_t.x - me.pos.x, _t.z - me.pos.z) + s.err;
      const a = wrap(want - heading);
      cmd.turn = THREE.MathUtils.clamp(-a * 2.4, -1, 1);
      cmd.throttle = Math.cos(a) > 0.6 ? (committed ? 1 : 0.9) : Math.cos(a) > 0 ? 0.45 : 0.1;
      if (retreat) { cmd.throttle = -0.6; }
      if (levelId === 'easy' && Math.random() < 0.08) cmd.throttle *= 0.3;   // hesitates
      // keep out of hazards ourselves (look ahead along our velocity)
      const ax = me.pos.x + me.fwd.x * 1.1 + v.x * 0.3, az = me.pos.z + me.fwd.z * 1.1 + v.z * 0.3;
      if (!holding && map.hazardAt(ax, az) && !map.hazardAt(o.pos.x, o.pos.z)) { cmd.throttle = -0.6; cmd.turn = a > 0 ? 1 : -1; }
      // never follow the opponent over the edge: right at a pit / exit we stop and let momentum finish the job
      // (the beginner forgets this now and then)
      const vx = v.x * 0.18, vz = v.z * 0.18;
      const cx = me.pos.x + me.fwd.x * 0.8 + vx, cz = me.pos.z + me.fwd.z * 0.8 + vz;
      const b = map.bounds || { x0: -6, x1: 6, z0: -6, z1: 6 };
      const edge = (map.inPit && map.inPit(cx, cz)) || cx < b.x0 + 0.2 || cx > b.x1 - 0.2 || cz < b.z0 + 0.2 || cz > b.z1 - 0.2;
      if (edge && cmd.throttle > 0 && !(levelId === 'easy' && Math.random() < 0.35)) { cmd.throttle = -0.5; }
      const close = dist < 1.6;
      if (cmd.throttle > 0.5 && speed < 0.6) s.stuck += close ? 0.05 : 0.1; else s.stuck = Math.max(0, s.stuck - 0.05);
      if (s.stuck > (L.flank ? 0.8 : 1.1)) { s.stuck = 0; s.backing = 0.7; s.backTurn = Math.random() < 0.5 ? -1 : 1; }
      return cmd;
    }
  };
}
