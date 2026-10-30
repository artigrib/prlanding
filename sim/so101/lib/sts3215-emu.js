// Feetech STS3215 emulator for the virtual SO-101 follower arm — printedrobotics.cz.
// Six emulated servos on one half-duplex bus, wired like the real arm (board -> base servo ->
// ... -> gripper servo, daisy-chained). Speaks the same packets as the real servos (see feetech.js),
// so the wizard cannot tell the VirtualTransport from a real USB adapter.
//
// Register map and encodings: LeRobot v0.6.1 tables.py (Apache-2.0), via feetech.js.
// Behaviour notes (what LeRobot relies on, from lerobot/motors/feetech/feetech.py v0.6.1):
//  - "Present_Position = Actual_Position - Homing_Offset" (_get_half_turn_homings docstring), wrapped
//    to 0..4095 (configure_motors clears Phase bit 4 for exactly that reason).
//  - Homing_Offset is sign-magnitude with sign bit 11, positions with bit 15, load with bit 10.
//  - EPROM (addresses < 40) is written with Lock = 0 (disable_torque writes Torque_Enable=0, Lock=0).
//  - setup_motor writes ID to the *old* ID and expects the status reply from that old ID.
//  - Torque_Limit (RAM) is loaded from Max_Torque_Limit (EPROM) at power-up and scales the output torque.
//  - Response_Status_Level 0 answers only PING/READ; REG_WRITE + ACTION apply a buffered write.
// Checked end to end against LeRobot 0.6.1 + feetech-servo-sdk 1.0.0 through a pty (tools/sil).
// Factory values marked "emulated" below are plausible defaults, not verified against a datasheet.

import {
  INST, BROADCAST_ID, ERR, REG, EPROM_END, READ_ONLY, PacketReader, statusPacket, checksum,
  encodeSM, decodeSM, toBytes, fromBytes, CODE_BAUD, STS3215_MODEL, RESOLUTION
} from './feetech.js';

const K = RESOLUTION / (2 * Math.PI);        // encoder steps per radian
const mod = (a, n) => ((a % n) + n) % n;
const AMBIENT = 28;                          // °C

import { VARIANTS } from './variants.js';
export { VARIANTS };

// Where each servo's horn sits relative to the joint zero (raw encoder value at q = 0).
// Different per servo, like a real assembly — calibration (homing offset) takes it out.
const MOUNT = [2311, 1858, 2140, 1630, 2405, 1925];

export const CABLE_BREAK = 3;   // 'cable' fault: plug between servo 3 (elbow) and 4 (wrist flex) is loose

export class Sts3215 {
  constructor(index, variant) {
    this.index = index;
    this.variant = variant;
    this.mount = MOUNT[index];
    this.mem = new Uint8Array(256);
    this.saved = new Uint8Array(EPROM_END);   // what survives a power cycle
    this.powered = false;
    this.temp = AMBIENT + index * 0.4;
    this.extraHeat = 0;     // °C/s, overheating fault
    this.extraLoad = 0;     // 0..1, overheating fault (stalled / overloaded joint)
    this.setpoint = 2048;
    this.lastPresent = null;
    this.pending = null;     // REG_WRITE buffer
    this.factory();
  }

  factory() {
    const v = VARIANTS[this.variant], m = new Uint8Array(EPROM_END);
    const set = (name, value) => { const [a, s] = REG[name]; m.set(toBytes(value, s), a); };
    set('Firmware_Major_Version', 3); set('Firmware_Minor_Version', 10);           // emulated
    set('Model_Number', STS3215_MODEL);
    set('ID', 1);                       // every new servo answers on ID 1
    set('Baud_Rate', 0);                // 1 000 000 Bd
    set('Return_Delay_Time', 250);      // 500 µs (LeRobot configure_motors comment)
    set('Response_Status_Level', 1);
    set('Min_Position_Limit', 0); set('Max_Position_Limit', 4095);
    set('Max_Temperature_Limit', 70);   // emulated
    set('Max_Voltage_Limit', v.maxV); set('Min_Voltage_Limit', v.minV);           // emulated
    set('Max_Torque_Limit', 1000);
    set('P_Coefficient', 32); set('D_Coefficient', 32); set('I_Coefficient', 0);  // emulated
    set('Protection_Current', 500); set('Overload_Torque', 80);                  // emulated
    set('Homing_Offset', 0); set('Operating_Mode', 0);
    this.saved.set(m);
  }

  get id() { return this.mem[5]; }
  get baud() { return CODE_BAUD[this.mem[6]] || 0; }
  reg(name) { const [a, s] = REG[name]; const raw = fromBytes(this.mem, a, s); return name === 'Homing_Offset' ? decodeSM(raw, 11) : name === 'Goal_Position' ? decodeSM(raw, 15) : raw; }
  setReg(name, value, persist = false) {
    const [a, s] = REG[name];
    const v = name === 'Homing_Offset' ? encodeSM(value, 11) : name === 'Goal_Position' ? encodeSM(value, 15) : value;
    this.mem.set(toBytes(v, s), a);
    if (persist && a < EPROM_END) this.saved.set(toBytes(v, s), a);
  }

  // raw encoder <-> joint angle
  presentFromQ(q) { return mod(Math.round(this.mount + q * K) - this.reg('Homing_Offset'), RESOLUTION); }
  qFromPresent(p) {
    const actual = mod(p + this.reg('Homing_Offset'), RESOLUTION);
    return (mod(actual - this.mount + 2048, RESOLUTION) - 2048) / K;
  }

  powerOn(plant, supplyV) {
    this.powered = true;
    this.mem.fill(0);
    this.mem.set(this.saved);           // EPROM loads; RAM starts from defaults
    this.mem[REG.Lock[0]] = 1;          // write lock on after power-up (emulated)
    this.mem.set(this.mem.subarray(16, 18), 48);   // Torque_Limit (RAM) starts from Max_Torque_Limit (EPROM)
    this.pending = null;                // REG_WRITE buffer
    const p = this.presentFromQ(plant.q(this.index));
    this.setReg('Goal_Position', p);    // goal = where the horn is, so enabling torque does not jump
    this.setpoint = p; this.lastPresent = p;
    this.update(0, plant, supplyV);
  }
  powerOff(plant) { this.powered = false; plant.release(this.index); }

  /** Apply a WRITE to the control table. Returns nothing; side effects on torque. */
  write(addr, data, plant) {
    if (this.dropWrites > 0) { this.dropWrites--; return; }   // test hook: a write lost to bus noise
    const torqueWas = this.mem[40];
    for (let k = 0; k < data.length; k++) {
      const a = addr + k;
      if (a > 255 || READ_ONLY.has(a)) continue;
      this.mem[a] = data[k];
      // EPROM survives a power cycle only if the write lock (Lock, addr 55, RAM) is open
      if (a < EPROM_END && this.mem[REG.Lock[0]] === 0) this.saved[a] = data[k];
    }
    const torque = this.mem[40];
    if (torque && !torqueWas) this.setpoint = this.reg('Present_Position');
    if (!torque && torqueWas) plant.release(this.index);
  }

  clampGoal(g) {
    const lo = fromBytes(this.mem, 9, 2), hi = fromBytes(this.mem, 11, 2);
    if (lo < hi) g = Math.min(hi, Math.max(lo, g));
    return Math.min(RESOLUTION - 1, Math.max(0, g));
  }

  update(dt, plant, supplyV) {
    if (!this.powered) return;
    const m = this.mem, i = this.index;
    const q = plant.q(i);
    const present = this.presentFromQ(q);
    const torque = m[40] === 1;
    let load = torque ? plant.effort(i) : 0;
    if (this.extraLoad) load = Math.sign(load || 1) * Math.max(Math.abs(load), this.extraLoad);
    const volts = Math.max(0, supplyV - 0.25 * Math.abs(load));

    // thermal model: copper losses ~ load² while the motor is driven, slow cooling to ambient
    // (time constant ≈ 200 s: a plastic-cased servo stays hot for minutes after it trips)
    if (dt > 0) this.temp += ((torque ? 0.35 * load * load + this.extraHeat : 0) - (this.temp - AMBIENT) * 0.005) * dt;

    let err = m[65] & ~(ERR.VOLTAGE);
    const v10 = Math.round(volts * 10);
    if (v10 > m[14] || v10 < m[15]) err |= ERR.VOLTAGE;
    if (this.temp >= m[13]) err |= ERR.OVERHEAT;
    else if (this.temp < m[13] - 10) err &= ~ERR.OVERHEAT;
    // protection: over-voltage or over-temperature unloads the motor
    if (torque && ((err & ERR.OVERHEAT) || v10 > m[14])) { m[40] = 0; plant.release(i); }

    // registers
    const vel = dt > 0 && this.lastPresent != null ? (present - this.lastPresent) / dt : 0;
    this.lastPresent = present;
    m.set(toBytes(encodeSM(present, 15), 2), 56);
    m.set(toBytes(encodeSM(vel, 15), 2), 58);
    m.set(toBytes(encodeSM(load * 1000, 10), 2), 60);
    m[62] = Math.min(255, v10);
    m[63] = Math.min(255, Math.round(this.temp));
    m[65] = err;
    m[66] = Math.abs(vel) > 20 ? 1 : 0;
    m.set(toBytes(Math.round(Math.abs(load) * 1200 / 6.5), 2), 69);   // 6.5 mA units, rough

    // position loop: setpoint ramps to Goal_Position at Goal_Velocity (steps/s, 0 = full speed)
    if (m[40] === 1) {
      const goal = this.clampGoal(decodeSM(fromBytes(m, 42, 2), 15));
      // Goal_Velocity unit: 0.732 rpm (= 50 steps/s), or 0.0146 rpm (≈ 1 step/s) when Phase bit 2 is set
      const vmax = Math.abs(decodeSM(fromBytes(m, 46, 2), 15)) * (m[18] & 0x04 ? 1 : 50);
      if (vmax > 0 && dt > 0) {
        const step = vmax * dt, d = goal - this.setpoint;
        this.setpoint += Math.abs(d) <= step ? d : Math.sign(d) * step;
      } else this.setpoint = goal;
      // output torque: supply voltage and Torque_Limit (0.1 %; LeRobot lowers it for the gripper via Max_Torque_Limit)
      const tl = Math.min(1000, fromBytes(m, 48, 2)) / 1000;
      plant.setStrength(i, Math.min(1, volts / VARIANTS[this.variant].nominal) * tl);
      plant.drive(i, this.qFromPresent(Math.round(this.setpoint)));
    }
  }

  /** Handle one instruction addressed to this servo. Returns [error, params] for the reply, or null. */
  execute(code, params, plant) {
    if (code === INST.PING) return [this.mem[65], []];
    if (code === INST.READ) {
      const [addr, len] = params;
      return [this.mem[65], Array.from(this.mem.subarray(addr, addr + len))];
    }
    // Response_Status_Level 0: only PING and READ are answered (the level is read before the write,
    // so the write that sets it to 0 is still answered at the old level, like the real servo)
    const quiet = this.mem[REG.Response_Status_Level[0]] === 0;
    if (code === INST.WRITE) {
      this.write(params[0], params.slice(1), plant);
      return quiet ? null : [this.mem[65], []];
    }
    if (code === INST.REG_WRITE) {     // buffered write, applied by ACTION (scservo_sdk regWriteTxRx / action)
      this.pending = { addr: params[0], data: params.slice(1) };
      return quiet ? null : [this.mem[65], []];
    }
    if (code === INST.ACTION) {
      if (this.pending) { const { addr, data } = this.pending; this.pending = null; this.write(addr, data, plant); }
      return quiet ? null : [this.mem[65], []];
    }
    return null;   // unknown instruction: no reply
  }
}

/** Physics hook used by the emulator. The browser passes the MuJoCo arm; tests pass a stub. */
export class KinematicPlant {
  constructor(q = [0, 0, 0, 0, 0, 0]) { this.qs = q.slice(); this.strength = [1, 1, 1, 1, 1, 1]; this.driven = [false, false, false, false, false, false]; }
  q(i) { return this.qs[i]; }
  effort(i) { return this.driven[i] ? 0.15 : 0; }
  drive(i, q) { this.driven[i] = true; this.qs[i] = q; }
  release(i) { this.driven[i] = false; }
  setStrength(i, s) { this.strength[i] = s; }
  hand(i, q) { if (!this.driven[i]) this.qs[i] = q; }
}

/** Wired-AND of simultaneous replies on the half-duplex line (idle = 0xFF). */
export function collide(packets) {
  if (packets.length === 1) return packets[0];
  const n = Math.max(...packets.map((p) => p.length));
  const out = new Uint8Array(n).fill(0xFF);
  for (const p of packets) for (let i = 0; i < p.length; i++) out[i] &= p[i];
  // Real replies are also skewed in time, so a clash never yields a valid packet: make sure the
  // checksum fails even when both servos happened to send identical bytes (e.g. two PING replies).
  if (out.length >= 6 && out[n - 1] === checksum(out)) out[n - 1] ^= 0x5A;
  return out;
}

/**
 * The virtual arm: six servos, a power supply, the wiring and training faults.
 * `receive(bytes, baud)` is what VirtualTransport calls; it returns the reply bytes.
 */
export class VirtualArm {
  constructor({ variant = '7.4', plant = new KinematicPlant() } = {}) {
    this.variant = variant;
    this.plant = plant;
    this.servos = [0, 1, 2, 3, 4, 5].map((i) => new Sts3215(i, variant));
    this.reader = new PacketReader();
    this.wiring = 'none';     // 'none' | 'chain' | servo index (only that servo plugged into the board)
    this.faults = { cable: false, supply: false, dupid: false, range: false, heat: false };
    this.saved = {};
    this.stats = { rx: 0, tx: 0 };
    this.refreshPower();
  }

  get supplyV() {
    const v = VARIANTS[this.variant];
    if (!this.faults.supply) return v.supply;
    return this.variant === '7.4' ? 12.0 : 5.0;   // wrong adapter: 12 V on 7.4 V servos, or 5 V on 12 V servos
  }

  isPowered(i) {
    if (this.wiring === 'chain') return !(this.faults.cable && i >= CABLE_BREAK);
    return this.wiring === i;
  }
  refreshPower() {
    this.servos.forEach((s, i) => {
      const on = this.isPowered(i);
      if (on && !s.powered) s.powerOn(this.plant, this.supplyV);
      else if (!on && s.powered) s.powerOff(this.plant);
    });
  }
  setWiring(w) { this.wiring = w; this.refreshPower(); }

  setFault(name, on) {
    if (!(name in this.faults) || this.faults[name] === !!on) return;
    this.faults[name] = !!on;
    const s = this.servos;
    if (name === 'cable') this.refreshPower();
    if (name === 'dupid') {
      // the gripper servo kept its factory ID 1 (its ID step was skipped) -> clashes with shoulder_pan
      const g = s[5];
      if (on) { this.saved.dupid = g.mem[5]; g.mem[5] = 1; g.saved[5] = 1; }
      else { const id = this.saved.dupid ?? 6; g.mem[5] = id; g.saved[5] = id; }
    }
    if (name === 'range') {
      // elbow calibrated without moving it through its full range
      const e = s[2];
      if (on) {
        this.saved.range = [e.reg('Min_Position_Limit'), e.reg('Max_Position_Limit')];
        const [lo, hi] = this.saved.range, mid = Math.round(lo < hi && hi - lo < 4095 ? (lo + hi) / 2 : 2047) + 160;
        e.setReg('Min_Position_Limit', mid - 230, true); e.setReg('Max_Position_Limit', mid + 230, true);
      } else if (this.saved.range) {
        e.setReg('Min_Position_Limit', this.saved.range[0], true); e.setReg('Max_Position_Limit', this.saved.range[1], true);
      }
    }
    if (name === 'heat') {
      // shoulder lift stalled against an obstacle / overloaded: hot within ~25 s
      s[1].extraHeat = on ? 1.7 : 0; s[1].extraLoad = on ? 0.85 : 0;
    }
  }

  update(dt) {
    this.refreshPower();
    const v = this.supplyV;
    for (const s of this.servos) s.update(dt, this.plant, v);
  }

  /** Bytes in from the adapter -> list of reply packets (Uint8Array) in wire order. */
  receive(bytes, baud) {
    this.reader.push(bytes);
    const out = [];
    let p;
    while ((p = this.reader.next())) {
      if (p.bad) continue;                       // servos silently drop packets with a bad checksum
      this.stats.rx++;
      const live = this.servos.filter((s) => s.powered && s.baud === baud);
      const reply = (group, fn) => {
        const pk = [];
        for (const s of group) {
          s.update(0, this.plant, this.supplyV);     // registers are live on a real servo
          const id = s.id; const r = fn(s); if (r) pk.push(statusPacket(id, r[0], r[1])); }
        if (pk.length) { out.push(collide(pk)); this.stats.tx++; }
      };
      const params = Array.from(p.params);
      if (p.code === INST.SYNC_WRITE) {
        const [addr, len] = params;
        for (let o = 2; o + len < params.length + 1; o += len + 1) {
          const id = params[o], data = params.slice(o + 1, o + 1 + len);
          if (data.length !== len) break;
          for (const s of live) if (s.id === id) s.write(addr, data, this.plant);
        }
      } else if (p.code === INST.SYNC_READ) {
        if (p.id !== BROADCAST_ID) continue;
        const [addr, len, ...ids] = params;
        for (const id of ids) reply(live.filter((s) => s.id === id), (s) => s.execute(INST.READ, [addr, len], this.plant));
      } else if (p.id === BROADCAST_ID) {
        if (p.code === INST.PING) {
          // every servo answers; same IDs collide
          const ids = [...new Set(live.map((s) => s.id))].sort((a, b) => a - b);
          for (const id of ids) reply(live.filter((s) => s.id === id), (s) => s.execute(INST.PING, [], this.plant));
        } else for (const s of live) s.execute(p.code, params, this.plant);   // broadcast WRITE / ACTION: no reply
      } else {
        reply(live.filter((s) => s.id === p.id), (s) => s.execute(p.code, params, this.plant));
      }
    }
    return out;
  }
}
