// Feetech STS/SMS servo protocol ("protocol 0") — packet layer and bus client.
// printedrobotics.cz. Runs in the browser and in Node (unit tests): no DOM, no dependencies.
//
// Packet format (instruction):  0xFF 0xFF ID LEN INSTR PARAM... CHECKSUM
// Packet format (status reply): 0xFF 0xFF ID LEN ERROR PARAM... CHECKSUM
//   LEN = number of params + 2, CHECKSUM = ~(ID + LEN + INSTR/ERROR + PARAMS) & 0xFF.
// Verified against Feetech's scservo_sdk 1.0.0 (protocol_packet_handler.py: txPacket, rxPacket,
// readTxRx, writeTxRx, syncReadTx, syncWriteTxOnly), which is what LeRobot uses underneath.
//
// Control-table addresses, sign-magnitude bits, baud codes and model number are ported from
// LeRobot v0.6.1, src/lerobot/motors/feetech/tables.py
// (https://github.com/huggingface/lerobot/blob/v0.6.1/src/lerobot/motors/feetech/tables.py),
// Copyright 2024 The HuggingFace Inc. team, Apache License 2.0. See ../NOTICE.txt.

export const BROADCAST_ID = 0xFE;   // scservo_def.py BROADCAST_ID
export const MAX_ID = 0xFC;         // scservo_def.py MAX_ID

export const INST = { PING: 1, READ: 2, WRITE: 3, REG_WRITE: 4, ACTION: 5, SYNC_READ: 0x82, SYNC_WRITE: 0x83 };

// Status-packet error bits (scservo_sdk protocol_packet_handler.py ERRBIT_*)
export const ERR = { VOLTAGE: 1, ANGLE: 2, OVERHEAT: 4, OVERELE: 8, OVERLOAD: 32 };

// STS_SMS_SERIES_CONTROL_TABLE (LeRobot tables.py) — [address, size in bytes].
// Only the registers LeRobot reads/writes for an SO-101 (plus a few the wizard shows) are listed.
export const REG = {
  // EPROM (persisted only while Lock = 0)
  Firmware_Major_Version: [0, 1],
  Firmware_Minor_Version: [1, 1],
  Model_Number: [3, 2],           // read-only, STS3215 = 777 (MODEL_NUMBER_TABLE)
  ID: [5, 1],
  Baud_Rate: [6, 1],
  Return_Delay_Time: [7, 1],
  Response_Status_Level: [8, 1],
  Min_Position_Limit: [9, 2],
  Max_Position_Limit: [11, 2],
  Max_Temperature_Limit: [13, 1],
  Max_Voltage_Limit: [14, 1],
  Min_Voltage_Limit: [15, 1],
  Max_Torque_Limit: [16, 2],
  Phase: [18, 1],
  P_Coefficient: [21, 1],
  D_Coefficient: [22, 1],
  I_Coefficient: [23, 1],
  Protection_Current: [28, 2],
  Homing_Offset: [31, 2],
  Operating_Mode: [33, 1],
  Overload_Torque: [36, 1],
  // SRAM
  Torque_Enable: [40, 1],
  Acceleration: [41, 1],
  Goal_Position: [42, 2],
  Goal_Time: [44, 2],
  Goal_Velocity: [46, 2],
  Torque_Limit: [48, 2],
  Lock: [55, 1],
  Present_Position: [56, 2],      // read-only
  Present_Velocity: [58, 2],      // read-only
  Present_Load: [60, 2],          // read-only
  Present_Voltage: [62, 1],       // read-only, 0.1 V
  Present_Temperature: [63, 1],   // read-only, °C
  Status: [65, 1],                // read-only
  Moving: [66, 1],                // read-only
  Present_Current: [69, 2],       // read-only
  Maximum_Acceleration: [85, 1]
};
export const EPROM_END = 40;       // addresses < 40 are EPROM (tables.py "# EPROM" section)
export const READ_ONLY = new Set([0, 1, 2, 3, 4, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]);

// STS_SMS_SERIES_ENCODINGS_TABLE (LeRobot tables.py): sign-magnitude sign bit per register
export const SIGN_BIT = {
  Present_Load: 10, Homing_Offset: 11, Goal_Position: 15, Goal_Velocity: 15,
  Present_Position: 15, Present_Velocity: 15
};

// STS_SMS_SERIES_BAUDRATE_TABLE (LeRobot tables.py)
export const BAUD_CODE = { 1000000: 0, 500000: 1, 250000: 2, 128000: 3, 115200: 4, 57600: 5, 38400: 6, 19200: 7 };
export const CODE_BAUD = Object.fromEntries(Object.entries(BAUD_CODE).map(([b, c]) => [c, +b]));

export const STS3215_MODEL = 777;  // MODEL_NUMBER_TABLE["sts3215"]
export const RESOLUTION = 4096;     // MODEL_RESOLUTION["sts3215"]

// SO-101 follower motor map (LeRobot so_follower.py): name -> ID. Gripper uses RANGE_0_100,
// the others DEGREES (use_degrees=True is the default in config_so_follower.py).
export const SO101_MOTORS = [
  { name: 'shoulder_pan', id: 1 }, { name: 'shoulder_lift', id: 2 }, { name: 'elbow_flex', id: 3 },
  { name: 'wrist_flex', id: 4 }, { name: 'wrist_roll', id: 5 }, { name: 'gripper', id: 6 }
];

// ---------- value encoding ----------
// LeRobot encoding_utils.encode_sign_magnitude / decode_sign_magnitude
export function encodeSM(v, bit) {
  const max = (1 << bit) - 1;
  const m = Math.min(max, Math.abs(Math.round(v)));
  return v < 0 ? m | (1 << bit) : m;
}
export function decodeSM(raw, bit) {
  const m = raw & ((1 << bit) - 1);
  return raw & (1 << bit) ? -m : m;
}
export function toBytes(value, size) {
  return size === 1 ? [value & 0xFF] : size === 2 ? [value & 0xFF, (value >> 8) & 0xFF]
    : [value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >>> 24) & 0xFF];
}
export function fromBytes(bytes, off = 0, size = bytes.length) {
  let v = 0;
  for (let i = size - 1; i >= 0; i--) v = (v << 8) | bytes[off + i];
  return v >>> 0;
}
/** Encode a register value (applies sign-magnitude where LeRobot does). */
export function encodeReg(name, value) {
  const [, size] = REG[name];
  const v = name in SIGN_BIT ? encodeSM(value, SIGN_BIT[name]) : value;
  return toBytes(v, size);
}
export function decodeReg(name, bytes, off = 0) {
  const [, size] = REG[name];
  const raw = fromBytes(bytes, off, size);
  return name in SIGN_BIT ? decodeSM(raw, SIGN_BIT[name]) : raw;
}

// ---------- packets ----------
export function checksum(bytes, from = 2, to = bytes.length - 1) {
  let s = 0;
  for (let i = from; i < to; i++) s += bytes[i];
  return ~s & 0xFF;
}
/** Instruction packet (or, with `instr` = error byte, a status packet — same layout). */
export function packet(id, instr, params = []) {
  const p = new Uint8Array(params.length + 6);
  p[0] = 0xFF; p[1] = 0xFF; p[2] = id; p[3] = params.length + 2; p[4] = instr;
  p.set(params, 5);
  p[p.length - 1] = checksum(p);
  return p;
}
export const statusPacket = (id, error, params = []) => packet(id, error, params);

export const pingPacket = (id) => packet(id, INST.PING);
export const readPacket = (id, addr, len) => packet(id, INST.READ, [addr, len]);
export const writePacket = (id, addr, data) => packet(id, INST.WRITE, [addr, ...data]);
export const syncReadPacket = (addr, len, ids) => packet(BROADCAST_ID, INST.SYNC_READ, [addr, len, ...ids]);
/** entries: [[id, bytes], ...] — each `bytes` must have length `len`. */
export function syncWritePacket(addr, len, entries) {
  const params = [addr, len];
  for (const [id, data] of entries) {
    if (data.length !== len) throw new Error('sync write: wrong data length for ID ' + id);
    params.push(id, ...data);
  }
  return packet(BROADCAST_ID, INST.SYNC_WRITE, params);
}

/**
 * Streaming packet parser. push() bytes, then call next() until it returns null.
 * Yields {id, len, code, params, raw} for good packets (`code` is INSTR or ERROR),
 * or {bad: true, id, raw} when a complete packet fails its checksum (bus collision, noise).
 * Like scservo_sdk rxPacket: skips junk before 0xFF 0xFF, drops the header on a bad checksum.
 */
export class PacketReader {
  constructor(maxLen = 250) { this.buf = []; this.maxLen = maxLen; }
  push(bytes) { for (const b of bytes) this.buf.push(b); }
  get pending() { return this.buf.length; }
  clear() { this.buf.length = 0; }
  next() {
    const b = this.buf;
    for (;;) {
      let i = 0;
      while (i + 1 < b.length && !(b[i] === 0xFF && b[i + 1] === 0xFF)) i++;
      if (i) b.splice(0, i);
      if (b.length < 4) return null;
      if (b[2] === 0xFF) { b.shift(); continue; }          // FF FF FF ...: header shifted by one
      const len = b[3];
      if (len < 2 || len > this.maxLen) { b.splice(0, 2); continue; }
      const total = len + 4;
      if (b.length < total) return null;
      const raw = b.splice(0, total);
      if (raw[total - 1] !== checksum(raw)) return { bad: true, id: raw[2], raw: Uint8Array.from(raw) };
      return { id: raw[2], len, code: raw[4], params: raw.slice(5, total - 1), raw: Uint8Array.from(raw) };
    }
  }
}

export const hex = (bytes) => Array.from(bytes, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');

// ---------- bus client (what LeRobot's FeetechMotorsBus does over scservo_sdk) ----------
/**
 * Result objects: {comm: 'ok' | 'timeout' | 'corrupt', error?: number, data?: Uint8Array}.
 * All transactions are serialised (half-duplex bus; a live poll and a wizard action never interleave).
 */
export class FeetechBus {
  constructor(transport, { timeoutMs = 30, onPacket = null, skipEcho = false } = {}) {
    this.t = transport;
    this.skipEcho = skipEcho;
    this.timeoutMs = timeoutMs;
    this.onPacket = onPacket;           // (dir: 'tx'|'rx'|'bad', bytes) for the wire log
    this.reader = new PacketReader();
    this.chain = Promise.resolve();
  }

  /** Run fn exclusively on the bus. */
  lock(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  async _send(bytes) {
    this.reader.clear();
    this.t.drain();
    this.lastTx = bytes;
    this.onPacket && this.onPacket('tx', bytes);
    await this.t.write(bytes);
  }

  /** Read status packets until `want(pkt)` says done, or timeout. Returns collected packets. */
  async _collect(count, timeoutMs, idFilter) {
    const out = [];
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let p;
      while ((p = this.reader.next())) {
        // adapters that echo our own packet (none of the usual SO-101 boards do): opt-in skip
        if (this.skipEcho && !p.bad && this.lastTx && p.raw.length === this.lastTx.length && p.raw.every((x, i) => x === this.lastTx[i])) continue;
        this.onPacket && this.onPacket(p.bad ? 'bad' : 'rx', p.raw);
        if (idFilter && !p.bad && !idFilter(p.id)) continue;
        out.push(p);
        if (out.length >= count) return out;
      }
      const left = deadline - Date.now();
      if (left <= 0) return out;
      const chunk = await this.t.read(left);
      if (chunk.length) this.reader.push(chunk);
    }
  }

  _txrx(pkt, id) {
    return this.lock(async () => {
      await this._send(pkt);
      const [p] = await this._collect(1, this.timeoutMs);
      if (!p) return { comm: 'timeout' };
      if (p.bad) return { comm: 'corrupt' };
      if (p.id !== id) return { comm: 'corrupt' };
      return { comm: 'ok', error: p.code, data: Uint8Array.from(p.params) };
    });
  }

  ping(id) { return this._txrx(pingPacket(id), id); }

  /** Broadcast ping: every servo answers. Returns {ids: Map(id -> error byte), corrupt: n}. */
  broadcastPing(timeoutMs = 3 * this.timeoutMs) {
    return this.lock(async () => {
      await this._send(pingPacket(BROADCAST_ID));
      const pk = await this._collect(Infinity, timeoutMs);
      const ids = new Map(); let corrupt = 0;
      for (const p of pk) { if (p.bad) corrupt++; else ids.set(p.id, p.code); }
      return { ids, corrupt };
    });
  }

  read(id, addr, len) { return this._txrx(readPacket(id, addr, len), id); }

  async readReg(id, name) {
    const [addr, size] = REG[name];
    const r = await this.read(id, addr, size);
    if (r.comm === 'ok') r.value = decodeReg(name, r.data);
    return r;
  }

  /** Write raw bytes. Broadcast writes get no reply (resolves {comm:'ok'} after sending). */
  write(id, addr, data) {
    const pkt = writePacket(id, addr, data);
    if (id === BROADCAST_ID) return this.lock(async () => { await this._send(pkt); return { comm: 'ok' }; });
    return this._txrx(pkt, id);
  }

  writeReg(id, name, value) { return this.write(id, REG[name][0], encodeReg(name, value)); }

  /** Sync read: one request, each listed servo replies in turn. Returns Map(id -> {comm, error, data}). */
  syncRead(addr, len, ids) {
    return this.lock(async () => {
      await this._send(syncReadPacket(addr, len, ids));
      const pk = await this._collect(ids.length, this.timeoutMs + ids.length * 2);
      const res = new Map(ids.map((id) => [id, { comm: 'timeout' }]));
      for (const p of pk) {
        if (p.bad) { if (res.has(p.id) && res.get(p.id).comm === 'timeout') res.set(p.id, { comm: 'corrupt' }); continue; }
        if (!res.has(p.id)) continue;
        if (p.params.length !== len) { res.set(p.id, { comm: 'corrupt' }); continue; }
        res.set(p.id, { comm: 'ok', error: p.code, data: Uint8Array.from(p.params) });
      }
      return res;
    });
  }

  async syncReadReg(name, ids) {
    const [addr, size] = REG[name];
    const m = await this.syncRead(addr, size, ids);
    for (const r of m.values()) if (r.comm === 'ok') r.value = decodeReg(name, r.data);
    return m;
  }

  /** Sync write (no reply). values: Map or object id -> raw bytes */
  syncWrite(addr, len, entries) {
    const list = entries instanceof Map ? [...entries] : Object.entries(entries).map(([k, v]) => [+k, v]);
    return this.lock(async () => { await this._send(syncWritePacket(addr, len, list)); return { comm: 'ok' }; });
  }

  syncWriteReg(name, idToValue) {
    const [addr, size] = REG[name];
    const list = (idToValue instanceof Map ? [...idToValue] : Object.entries(idToValue)).map(([id, v]) => [+id, encodeReg(name, v)]);
    return this.syncWrite(addr, size, new Map(list));
  }
}
