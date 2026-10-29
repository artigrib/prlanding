// SO-101 follower setup steps on a FeetechBus — printedrobotics.cz.
// A JavaScript re-implementation of what LeRobot v0.6.1 does in
//   lerobot/motors/motors_bus.py   (setup_motor, reset_calibration, set_half_turn_homings,
//                                   record_ranges_of_motion, _normalize, _unnormalize)
//   lerobot/motors/feetech/feetech.py (_find_single_motor_p0, configure_motors, disable/enable_torque,
//                                   write_calibration, _get_half_turn_homings)
//   lerobot/robots/so_follower/so_follower.py (setup_motors order, calibrate, configure)
// LeRobot: Copyright 2024 The HuggingFace Inc. team, Apache License 2.0 (see ../NOTICE.txt).
// No DOM here: the wizard and the Node tests both use it.

import { REG, ERR, STS3215_MODEL, BAUD_CODE, SO101_MOTORS, RESOLUTION, BROADCAST_ID, writePacket, syncWritePacket, encodeReg, decodeReg, fromBytes, decodeSM } from './feetech.js';
import { VARIANTS } from './variants.js';
import { SPEED } from './safety.js';

export const MOTORS = SO101_MOTORS;
export const IDS = MOTORS.map((m) => m.id);
export const FULL_TURN = 'wrist_roll';            // so_follower.calibrate: recorded as 0..4095
const MAX_RES = RESOLUTION - 1;

// Expected travel of each joint in encoder steps, from the SO-101 joint ranges in the MuJoCo
// Menagerie model (so101.xml) × 4096 / 2π. Used by diagnostics to spot a bad calibration.
export const EXPECTED_SPAN = { shoulder_pan: 2503, shoulder_lift: 2275, elbow_flex: 2203, wrist_flex: 2162, gripper: 1251 };

export class SetupError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const isOk = (r) => r && r.comm === 'ok';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function must(r, message) { if (!isOk(r)) throw new SetupError('comm', message); return r; }

/** feetech._find_single_motor_p0: broadcast ping at each baud rate until exactly one servo answers. */
export async function findSingleMotor(bus, transport, bauds = [1_000_000, ...Object.keys(BAUD_CODE).map(Number).filter((b) => b !== 1_000_000)]) {
  for (const baud of bauds) {
    await transport.setBaudRate(baud);
    const { ids, corrupt } = await bus.broadcastPing();
    if (!ids.size && !corrupt) continue;
    if (ids.size > 1 || corrupt) {
      throw new SetupError('multiple', `Odpovídá více serv najednou (${ids.size + corrupt}).`);
    }
    const [id] = ids.keys();
    const model = await bus.readReg(id, 'Model_Number');
    if (!isOk(model)) throw new SetupError('comm', 'Servo odpovědělo na ping, ale ne na čtení.');
    if (model.value !== STS3215_MODEL) throw new SetupError('model', `Nalezené servo má model ${model.value}, očekáváme ${STS3215_MODEL} (STS3215).`);
    return { baud, id };
  }
  throw new SetupError('none', 'Nenašli jsme žádné servo.');
}

/** motors_bus.setup_motor: give the only connected servo its target ID and the default baud rate. */
export async function setupMotor(bus, transport, targetId, log = () => {}) {
  const { baud, id } = await findSingleMotor(bus, transport);
  log(`Nalezeno servo: ID ${id}, ${baud.toLocaleString('cs-CZ')} Bd, model ${STS3215_MODEL} (STS3215)`);
  must(await bus.writeReg(id, 'Torque_Enable', 0), 'Vypnutí momentu se nepovedlo.');   // feetech._disable_torque
  must(await bus.writeReg(id, 'Lock', 0), 'Odemčení EPROM (Lock = 0) se nepovedlo.');
  const w = await bus.writeReg(id, 'ID', targetId);
  // The reply normally comes from the old ID (what LeRobot's SDK sees). If firmware answered from the
  // new ID instead, the reply looks foreign: accept it as long as the servo now answers on the new ID.
  if (!isOk(w) && id !== targetId && !isOk(await bus.ping(targetId))) throw new SetupError('comm', 'Zápis ID se nepovedl.');
  must(await bus.writeReg(targetId, 'Baud_Rate', BAUD_CODE[1_000_000]), 'Zápis rychlosti sběrnice se nepovedl.');
  await transport.setBaudRate(1_000_000);
  const p = await bus.ping(targetId);
  if (!isOk(p)) throw new SetupError('verify', `Servo po změně neodpovídá na ID ${targetId}.`);
  const lock = await bus.readReg(targetId, 'Lock');
  if (!isOk(lock) || lock.value !== 0) throw new SetupError('lock', 'Zámek EPROM se neotevřel – nové ID by se po vypnutí napájení ztratilo. Zkuste to znovu.');
  log(`ID ${id} → ${targetId} zapsáno a ověřeno`);
  return { from: id, baud };
}

export async function scanIds(bus, ids = IDS) {
  const out = {};
  for (const id of ids) out[id] = (await bus.ping(id)).comm;
  return out;
}

/** Read Torque_Enable of every servo: Map id -> 0 | 1 | null (no answer). */
export async function readTorque(bus, ids = IDS) {
  const r = await bus.syncReadReg('Torque_Enable', ids);
  return new Map(ids.map((id) => [id, isOk(r.get(id)) ? r.get(id).value : null]));
}

/**
 * Torque off with read-back: write Torque_Enable = 0, read it back, retry the servos that did not
 * confirm (up to `retries` times), then open the EPROM lock like feetech.disable_torque.
 * Returns {ok, unconfirmed: [ids]}.
 */
export async function disableTorque(bus, ids = IDS, { retries = 3 } = {}) {
  let left = ids.slice();
  for (let k = 0; k <= retries && left.length; k++) {
    for (const id of left) await bus.writeReg(id, 'Torque_Enable', 0);
    const tq = await readTorque(bus, left);
    left = left.filter((id) => tq.get(id) !== 0);
  }
  for (const id of ids) if (!left.includes(id)) await bus.writeReg(id, 'Lock', 0);
  return { ok: !left.length, unconfirmed: left };
}

/**
 * Emergency stop.
 * 1) Broadcast Torque_Enable = 0 straight to the wire, bypassing the transaction queue, three times.
 * 2) Through the queue: per-servo torque off with read-back (disableTorque), bounded by `timeoutMs`.
 * Returns {ok, unconfirmed, wire}: `wire` = at least one emergency packet left the host;
 * `ok` = every servo confirmed torque off by read-back.
 */
export async function stopAll(bus, ids = IDS, { timeoutMs = 1500 } = {}) {
  const pkt = writePacket(BROADCAST_ID, REG.Torque_Enable[0], [0]);
  let wire = false;
  for (let k = 0; k < 3; k++) {
    try { await bus.emergency(pkt); wire = true; } catch (e) { if (!wire && k === 0) break; }  // a hung port won't recover in ms
    if (k < 2) await sleep(5);
  }
  const deadline = sleep(timeoutMs).then(() => ({ ok: false, unconfirmed: ids.slice(), timeout: true }));
  const r = await Promise.race([disableTorque(bus, ids).catch(() => ({ ok: false, unconfirmed: ids.slice() })), deadline]);
  return { ...r, wire };
}

export const ARM_IDS = MOTORS.filter((m) => m.name !== 'gripper').map((m) => m.id);   // 1–5
export const GRIPPER_ID = MOTORS.find((m) => m.name === 'gripper').id;                  // 6
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Stage-one STOP (SR-6) = HOLD: the arm keeps its pose, the gripper lets go.
 * 1) Straight to the wire, bypassing the transaction queue (like stopAll): a Sync Write
 *    Goal_Position for joints 1–5 (from `lastKnown`, raw positions measured or last commanded, when
 *    given) and a Sync Write Torque_Enable = 0 for the gripper. Sync writes get no reply, so a packet
 *    slipped between two queued transactions cannot be mistaken for someone's answer.
 * 2) Through the queue: read Present_Position of joints 1–5 and write it as Goal_Position (goal :=
 *    present), switch the gripper off again if it did not confirm, read everything back.
 * Never switches torque ON: a joint that was limp stays limp. Returns
 * {wire, t1Ms, ok, goals: Map, torque: Map, gripperOff, timeout?}. `t1Ms` = trigger (`t0`,
 * performance.now() of the key/click) -> first emergency packet handed to the port (SR-15 T1).
 */
export async function holdAll(bus, { lastKnown = null, t0 = nowMs(), timeoutMs = 1500, armIds = ARM_IDS, gripperId = GRIPPER_ID } = {}) {
  let wire = false, t1Ms = null;
  const goalsPkt = lastKnown && armIds.every((id) => Number.isInteger(lastKnown.get(id)))
    ? syncWritePacket(REG.Goal_Position[0], 2, armIds.map((id) => [id, encodeReg('Goal_Position', lastKnown.get(id))])) : null;
  const gripPkt = syncWritePacket(REG.Torque_Enable[0], 1, [[gripperId, [0]]]);
  for (const pkt of goalsPkt ? [goalsPkt, gripPkt] : [gripPkt]) {
    try { await bus.emergency(pkt); if (!wire) { wire = true; t1Ms = nowMs() - t0; } } catch (e) { if (!wire) break; }
  }
  if (!wire) return { wire, t1Ms, ok: false, goals: new Map(), torque: new Map(), gripperOff: false };
  const verify = (async () => {
    // a reply lost to bus noise must not leave a joint un-held: retry the missing ones
    const goals = new Map();
    for (let k = 0; k < 3 && goals.size < armIds.length; k++) {
      const pos = await bus.syncReadReg('Present_Position', armIds.filter((id) => !goals.has(id)));
      for (const [id, r] of pos) if (isOk(r)) goals.set(id, r.value);
    }
    if (goals.size) await bus.syncWriteReg('Goal_Position', goals);
    let tq = await readTorque(bus, [...armIds, gripperId]);
    for (let k = 0; k < 3 && tq.get(gripperId) !== 0; k++) {
      await bus.syncWrite(REG.Torque_Enable[0], 1, new Map([[gripperId, [0]]]));
      tq = await readTorque(bus, [gripperId]).then((m) => new Map([...tq, ...m]));
    }
    const back = new Map();
    for (let k = 0; k < 3 && back.size < goals.size; k++) {
      const r = await bus.syncReadReg('Goal_Position', [...goals.keys()].filter((id) => !back.has(id)));
      for (const [id, x] of r) if (isOk(x)) back.set(id, x.value);
    }
    const goalsOk = [...goals].every(([id, g]) => back.get(id) === g);
    const gripperOff = tq.get(gripperId) === 0;
    return { ok: goals.size === armIds.length && goalsOk && gripperOff, goals, torque: tq, gripperOff };
  })().catch(() => ({ ok: false, goals: new Map(), torque: new Map(), gripperOff: false }));
  const deadline = sleep(timeoutMs).then(() => ({ ok: false, goals: new Map(), torque: new Map(), gripperOff: false, timeout: true }));
  return { wire, t1Ms, ...(await Promise.race([verify, deadline])) };
}

/** SR-19: firmware and model of each servo: Map id -> {major, minor, model} | null. */
export async function readFirmware(bus, ids = IDS) {
  const out = new Map();
  for (const id of ids) {
    const r = await bus.read(id, 0, 5);           // Firmware_Major, Firmware_Minor, (2), Model_Number
    out.set(id, isOk(r) && r.data.length === 5 ? { major: r.data[0], minor: r.data[1], model: fromBytes(r.data, 3, 2) } : null);
  }
  return out;
}

/**
 * Enable torque safely: Goal_Position = Present_Position first (nothing jumps to a stale goal), then
 * Torque_Enable = 1 and Lock = 1 per servo (feetech.enable_torque), then read back.
 * `abort()` is checked before every write: STOP pressed meanwhile wins. On abort or any failure all
 * servos are switched off again (with read-back) before the error is rethrown.
 */
export async function enableTorque(bus, ids = IDS, { abort = () => false } = {}) {
  const check = () => { if (abort()) throw new SetupError('aborted', 'Zapínání momentu přerušil STOP.'); };
  try {
    check();
    const pos = await bus.syncReadReg('Present_Position', ids);
    const goals = new Map();
    for (const [id, r] of pos) { if (!isOk(r)) throw new SetupError('comm', `Servo ${id} neodpovídá, moment nezapínáme.`); goals.set(id, r.value); }
    check();
    await bus.syncWriteReg('Goal_Position', goals);
    for (const id of ids) {
      check(); must(await bus.writeReg(id, 'Torque_Enable', 1), `Servo ${id} nepotvrdilo zapnutí momentu.`);
      check(); must(await bus.writeReg(id, 'Lock', 1), `Servo ${id} nepotvrdilo zámek.`);
    }
    check();
    const tq = await readTorque(bus, ids);
    const off = ids.filter((id) => tq.get(id) !== 1);
    if (off.length) throw new SetupError('verify', `Servo ${off.join(', ')} nemá po zapnutí moment.`);
    check();
    return goals;
  } catch (e) {
    await disableTorque(bus, ids).catch(() => {});
    throw e;
  }
}

/** Goal_Velocity unit in °/s per Feetech STS memory table: 0.732 rpm, or 0.0146 rpm with Phase bit 2. */
export const velocityUnitDeg = (phase) => (phase & 0x04 ? 0.0146 : 0.732) * 6;

/**
 * so_follower.configure + feetech.configure_motors, with torque disabled (verified) and
 * read-compare-write so repeated calls do not rewrite EPROM. Like LeRobot this also clears Phase
 * bit 4, so Present_Position stays in 0..4095. Options:
 *  - real: gentler Acceleration (30 × 8.7 °/s² ≈ 260 °/s²) instead of LeRobot's 254.
 *  - speedDegS: servo-side Goal_Velocity cap (backstop only, set 25 % above the browser limit;
 *    unit from Phase bit 2 per Feetech's table, not verified on hardware). 0 = no cap (LeRobot).
 */
export async function configureFollower(bus, { real = false, speedDegS = 0, abort = () => false } = {}) {
  const check = () => { if (abort()) throw new SetupError('aborted', 'Nastavení přerušil STOP.'); };
  const off = await disableTorque(bus);
  if (!off.ok) throw new SetupError('verify', `Servo ${off.unconfirmed.join(', ')} nepotvrdilo vypnutí momentu.`);
  const ensure = async (id, name, value) => {
    check();
    const r = must(await bus.readReg(id, name), `Servo ${id}: čtení ${name} se nepovedlo.`);
    if (r.value !== value) must(await bus.writeReg(id, name, value), `Servo ${id}: zápis ${name} se nepovedl.`);
  };
  const units = {};
  for (const m of MOTORS) {
    const ph = must(await bus.readReg(m.id, 'Phase'), `Servo ${m.id}: čtení Phase se nepovedlo.`).value;
    if (ph & 0x10) await ensure(m.id, 'Phase', ph & ~0x10);
    units[m.id] = velocityUnitDeg(ph);
    await ensure(m.id, 'Return_Delay_Time', 0);
    await ensure(m.id, 'Maximum_Acceleration', 254);
    await ensure(m.id, 'Acceleration', real ? 30 : 254);
    await ensure(m.id, 'Operating_Mode', 0);           // position mode
    await ensure(m.id, 'P_Coefficient', 16);           // config_so_follower.py defaults
    await ensure(m.id, 'I_Coefficient', 0);
    await ensure(m.id, 'D_Coefficient', 32);
    if (m.name === 'gripper') {
      await ensure(m.id, 'Max_Torque_Limit', 500);     // 50 % torque to avoid burnout
      await ensure(m.id, 'Protection_Current', 250);
      await ensure(m.id, 'Overload_Torque', 25);
    }
  }
  await setSpeedCap(bus, speedDegS, units);
  return { units };
}

/**
 * Goal_Velocity backstop for all servos (RAM register): 1.25 × the browser cap, in the unit given by
 * Phase bit 2 (velocityUnitDeg). TO VERIFY ON BENCH (spec B-5): the unit on real firmware.
 */
export async function setSpeedCap(bus, speedDegS, units) {
  // never above the owner maximum (SR-7): a bad caller cannot raise the firmware backstop past 75 °/s
  const cap = Math.min(speedDegS, SPEED.ownerMax);
  const vals = new Map(MOTORS.map((m) => [m.id, cap > 0 ? Math.min(32767, Math.ceil(cap * 1.25 / units[m.id])) : 0]));
  await bus.syncWriteReg('Goal_Velocity', vals);
  return vals;
}

/** motors_bus.reset_calibration */
export async function resetCalibration(bus, ids = IDS) {
  for (const id of ids) {
    await bus.writeReg(id, 'Homing_Offset', 0);
    await bus.writeReg(id, 'Min_Position_Limit', 0);
    await bus.writeReg(id, 'Max_Position_Limit', MAX_RES);
  }
}

/** motors_bus.set_half_turn_homings + feetech._get_half_turn_homings: present position becomes 2047. */
export async function setHalfTurnHomings(bus, ids = IDS) {
  await resetCalibration(bus, ids);
  const pos = await bus.syncReadReg('Present_Position', ids);
  const offsets = {};
  for (const id of ids) {
    const r = pos.get(id);
    if (!isOk(r)) throw new SetupError('comm', `Servo ${id} neodpovídá.`);
    offsets[id] = r.value - Math.trunc(MAX_RES / 2);
    await bus.writeReg(id, 'Homing_Offset', offsets[id]);
  }
  return offsets;
}

/** One sample of record_ranges_of_motion: updates mins/maxes in place, returns positions. */
export async function sampleRanges(bus, ids, mins, maxes) {
  const pos = await bus.syncReadReg('Present_Position', ids);
  const now = {};
  for (const id of ids) {
    const r = pos.get(id); if (!isOk(r)) continue;
    now[id] = r.value;
    mins[id] = id in mins ? Math.min(mins[id], r.value) : r.value;
    maxes[id] = id in maxes ? Math.max(maxes[id], r.value) : r.value;
  }
  return now;
}

/** Build the calibration like so_follower.calibrate (wrist_roll = full turn). */
export function buildCalibration(offsets, mins, maxes) {
  const cal = {};
  for (const m of MOTORS) {
    const full = m.name === FULL_TURN;
    cal[m.name] = { id: m.id, drive_mode: 0, homing_offset: offsets[m.id] | 0,
      range_min: full ? 0 : mins[m.id], range_max: full ? MAX_RES : maxes[m.id] };
  }
  const same = MOTORS.filter((m) => cal[m.name].range_min === cal[m.name].range_max).map((m) => m.name);
  if (same.length) throw new SetupError('same-min-max', 'Některé klouby mají stejné minimum a maximum: ' + same.join(', '));
  // never write limits the servo cannot hold (negative / wrapped positions, offsets beyond ±2047)
  const bad = MOTORS.filter((m) => { const c = cal[m.name]; return !(Number.isInteger(c.range_min) && Number.isInteger(c.range_max) && c.range_min >= 0 && c.range_min < c.range_max && c.range_max <= MAX_RES && Math.abs(c.homing_offset) <= 2047); }).map((m) => m.name);
  if (bad.length) throw new SetupError('range', 'Neplatné kalibrační hodnoty (mimo 0–4095): ' + bad.join(', ') + '. Spusťte kalibraci znovu.');
  return cal;
}

/** feetech.write_calibration */
export async function writeCalibration(bus, cal) {
  for (const c of Object.values(cal)) {
    await bus.writeReg(c.id, 'Homing_Offset', c.homing_offset);
    await bus.writeReg(c.id, 'Min_Position_Limit', c.range_min);
    await bus.writeReg(c.id, 'Max_Position_Limit', c.range_max);
  }
}

export async function readCalibration(bus) {
  const cal = {};
  for (const m of MOTORS) {
    const off = await bus.readReg(m.id, 'Homing_Offset');
    const lo = await bus.readReg(m.id, 'Min_Position_Limit');
    const hi = await bus.readReg(m.id, 'Max_Position_Limit');
    if (!isOk(off) || !isOk(lo) || !isOk(hi)) return null;
    cal[m.name] = { id: m.id, drive_mode: 0, homing_offset: off.value, range_min: lo.value, range_max: hi.value };
  }
  return cal;
}

// motors_bus._normalize / _unnormalize — gripper RANGE_0_100, other joints DEGREES (use_degrees=True)
export function normalize(name, c, raw) {
  if (name === 'gripper') {
    const v = Math.min(c.range_max, Math.max(c.range_min, raw));
    return ((v - c.range_min) / (c.range_max - c.range_min)) * 100;
  }
  return (raw - (c.range_min + c.range_max) / 2) * 360 / MAX_RES;
}
export function unnormalize(name, c, val) {
  if (name === 'gripper') return Math.trunc((Math.min(100, Math.max(0, val)) / 100) * (c.range_max - c.range_min) + c.range_min);
  return Math.trunc(val * MAX_RES / 360 + (c.range_min + c.range_max) / 2);
}
/** Allowed normalized interval for a joint (degrees or %), optionally shrunk by a safety margin. */
export function normRange(name, c, margin = 0) {
  if (name === 'gripper') return [margin * 100, 100 - margin * 100];
  const half = (c.range_max - c.range_min) / 2 * 360 / MAX_RES;
  return [-half * (1 - 2 * margin), half * (1 - 2 * margin)];
}

/** LeRobot calibration file (~/.cache/huggingface/lerobot/calibration/robots/so_follower/<id>.json) */
export const calibrationJson = (cal) => JSON.stringify(cal, null, 4);

// ---------- diagnostics ----------
const NAME_CS = { shoulder_pan: 'otočení základny', shoulder_lift: 'rameno', elbow_flex: 'loket', wrist_flex: 'náklon zápěstí', wrist_roll: 'rotace zápěstí', gripper: 'chapadlo' };
export const jointCs = (name) => NAME_CS[name] || name;
const byId = (id) => MOTORS.find((m) => m.id === id);
const listIds = (ids) => ids.map((id) => `${id} (${jointCs(byId(id).name)})`).join(', ');
const fmtV = (v) => v.toFixed(1).replace('.', ',') + ' V';

/** Read everything the Diagnostika panel needs for one servo. */
export async function readServo(bus, id) {
  const live = await bus.read(id, 56, 11);      // Present_Position .. Moving (56–66)
  const lim = await bus.read(id, 9, 7);         // Min/Max_Position_Limit, Max_Temperature, Max/Min_Voltage
  const off = await bus.readReg(id, 'Homing_Offset');
  const tq = await bus.readReg(id, 'Torque_Enable');
  if (!isOk(live) || !isOk(lim)) return null;
  const d = live.data, l = lim.data;
  return {
    position: decodeSM(fromBytes(d, 0, 2), 15), load: decodeSM(fromBytes(d, 4, 2), 10) / 10,
    voltage: d[6] / 10, temperature: d[7], status: d[9] | live.error, moving: d[10],
    min: fromBytes(l, 0, 2), max: fromBytes(l, 2, 2), maxTemp: l[4], maxV: l[5] / 10, minV: l[6] / 10,
    offset: isOk(off) ? off.value : null, torque: isOk(tq) ? tq.value : null
  };
}

/**
 * Detect typical setup faults from register reads only (works on the real arm too).
 * Returns [{code, level: 'err'|'warn'|'ok', title, text, fix}].
 */
export async function diagnose(bus, { variant = '7.4' } = {}) {
  const V = VARIANTS[variant];
  const out = [];
  const comm = await scanIds(bus);
  const bp = await bus.broadcastPing();
  const ok = IDS.filter((id) => comm[id] === 'ok');
  const missing = IDS.filter((id) => comm[id] === 'timeout');
  const garbled = IDS.filter((id) => comm[id] === 'corrupt');

  if (!ok.length && !garbled.length && !bp.ids.size && !bp.corrupt) {
    out.push({ code: 'no-response', level: 'err', title: 'Neodpovídá žádné servo',
      text: 'Na sběrnici se neozvalo ani jedno servo.',
      fix: 'Zkontrolujte, že je zapnutý zdroj serv (USB kabel serva nenapájí), že je připojený kabel z desky k prvnímu servu a že jste vybrali správný port.' });
    return out;
  }
  let explained = [];
  if (garbled.length) {
    const guess = missing.length ? ` Chybí přitom ${missing.length === 1 ? 'servo' : 'serva'} ${listIds(missing)} – ${missing.length === 1 ? 'to má' : 'jedno z nich má'} nejspíš také ID ${garbled[0]}.` : '';
    out.push({ code: 'dup-id', level: 'err', title: `Duplicitní ID ${garbled.join(', ')}`,
      text: `Na ID ${garbled.join(', ')} odpovídá více serv najednou, jejich odpovědi se na sběrnici přepisují a nedají se přečíst (chybný kontrolní součet).${guess}`,
      fix: 'Odpojte ruku od desky, připojte samostatně jen servo, které nemá správné ID, a nastavte mu ID znovu (krok 2 průvodce). Pak serva znovu zapojte do řetězu.' });
    explained = missing.slice(0, 1);
  }
  const rest = missing.filter((id) => !explained.includes(id));
  if (rest.length) {
    const first = rest[0];
    const tail = rest.length === IDS.length - first + 1 && rest.every((id, k) => id === first + k) && first > 1;
    if (tail) {
      out.push({ code: 'cable', level: 'err', title: `Serva ${first}–${IDS.length} neodpovídají`,
        text: `Serva 1–${first - 1} odpovídají, ale všechna serva za servem ${first - 1} mlčí. Serva jsou zapojená do řetězu, takže jde skoro jistě o kabel nebo konektor mezi servem ${first - 1} (${jointCs(byId(first - 1).name)}) a servem ${first} (${jointCs(byId(first).name)}).`,
        fix: `Vypněte napájení, zkontrolujte a pořádně zacvakněte kabel mezi servem ${first - 1} a ${first}, případně ho vyměňte za náhradní. Kabel nesmí být přiskřípnutý v kloubu.` });
    } else {
      out.push({ code: 'no-reply', level: 'err', title: `Neodpovídá ${rest.length === 1 ? 'servo' : 'serva'} ${rest.join(', ')}`,
        text: `Servo ${listIds(rest)} na své ID neodpovídá.`,
        fix: 'Zkontrolujte kabely u tohoto serva (oba konektory). Pokud jste ho měnili, má možná ještě tovární ID 1 – nastavte ID znovu.' });
    }
  }

  const st = {};
  for (const id of ok) st[id] = await readServo(bus, id);
  const good = ok.filter((id) => st[id]);

  const hiV = good.filter((id) => st[id].voltage > V.okHi), loV = good.filter((id) => st[id].voltage < V.okLo);
  if (hiV.length) {
    const v = st[hiV[0]].voltage;
    out.push({ code: 'overvolt', level: 'err', title: `Příliš vysoké napětí: ${fmtV(v)}`,
      text: `Serva hlásí ${fmtV(v)}, ale pro serva ${V.label} čekáme ${fmtV(V.okLo)}–${fmtV(V.okHi)}. Servo vypnulo moment a hlásí chybu napětí. Nejspíš je připojený zdroj 12 V k servům 7,4 V.`,
      fix: 'Okamžitě odpojte zdroj – vyšší napětí může serva trvale poškodit. Použijte zdroj ze sady (5 V pro serva 7,4 V) a zkontrolujte štítek na servech.' });
  } else if (loV.length) {
    const v = st[loV[0]].voltage;
    out.push({ code: 'undervolt', level: variant === '12' ? 'err' : 'warn', title: `Příliš nízké napětí: ${fmtV(v)}`,
      text: `Serva hlásí ${fmtV(v)}, pro serva ${V.label} čekáme ${fmtV(V.okLo)}–${fmtV(V.okHi)}. Na nízké napětí mají serva malou sílu: rameno neudrží vlastní váhu a klouby nedojedou do cíle.`,
      fix: variant === '12' ? 'Serva 12 V potřebují zdroj 12 V (alespoň 5 A). Zkontrolujte, že nemáte připojený zdroj 5 V z ovládací (leader) ruky.' : 'Zkontrolujte zdroj a jeho proudovou rezervu (alespoň 4 A) a přechodový odpor konektorů.' });
  }

  const hot = good.filter((id) => st[id].temperature >= st[id].maxTemp || (st[id].status & ERR.OVERHEAT));
  const warm = good.filter((id) => !hot.includes(id) && st[id].temperature >= 55);
  if (hot.length) {
    const s = st[hot[0]];
    out.push({ code: 'overheat', level: 'err', title: `Přehřáté servo ${listIds(hot)}`,
      text: `Teplota ${s.temperature} °C dosáhla limitu ${s.maxTemp} °C, servo vypnulo moment, aby se nespálilo. Zátěž ${Math.abs(s.load).toFixed(0)} %: kloub se nejspíš opírá o překážku nebo nese příliš velký náklad.`,
      fix: 'Vypněte moment (STOP), uvolněte kloub, nechte servo vychladnout pod 50 °C a hledejte příčinu: zaseknutý kloub, ruka tlačí do stolu, příliš těžký předmět. Nepřetěžujte chapadlo dlouhým svíráním.' });
  } else if (warm.length) {
    out.push({ code: 'warm', level: 'warn', title: `Servo se zahřívá: ${listIds(warm)}`,
      text: `Teplota ${st[warm[0]].temperature} °C. Pod zátěží je to normální, nad 70 °C se servo vypne.`,
      fix: 'Dejte ruce pauzu a ulehčete kloubu (ruku neopírejte o stůl).' });
  }

  const narrow = [], uncal = [];
  for (const id of good) {
    const name = byId(id).name; if (name === FULL_TURN) continue;
    const s = st[id];
    if (s.min === 0 && s.max === MAX_RES) uncal.push(id);
    else if (s.max - s.min < 0.6 * EXPECTED_SPAN[name]) narrow.push(id);
  }
  if (narrow.length) {
    const s = st[narrow[0]], name = byId(narrow[0]).name;
    out.push({ code: 'range', level: 'err', title: `Špatný kalibrační rozsah: ${listIds(narrow)}`,
      text: `Kloub ${jointCs(name)} má zapsaný rozsah ${s.min}–${s.max} (${Math.round((s.max - s.min) * 360 / RESOLUTION)}°), čekáme zhruba ${Math.round(EXPECTED_SPAN[name] * 360 / RESOLUTION)}°. Při kalibraci jste ho nejspíš neprojeli celým rozsahem. Servo teď nedovolí pohyb mimo tento úsek a úhly jsou posunuté.`,
      fix: 'Spusťte kalibraci znovu (krok 3) a každým kloubem pomalu dojeďte až na oba dorazy.' });
  }
  if (uncal.length) {
    out.push({ code: 'uncalibrated', level: 'warn', title: `Nezkalibrováno: ${listIds(uncal)}`,
      text: 'Tato serva mají tovární rozsah 0–4095, kalibrace do nich ještě nebyla zapsaná.',
      fix: 'Projděte krok 3 průvodce (kalibrace).' });
  }

  const overload = good.filter((id) => st[id].status & ERR.OVERLOAD);
  if (overload.length) out.push({ code: 'overload', level: 'err', title: `Přetížení: ${listIds(overload)}`, text: 'Servo hlásí přetížení.', fix: 'Uvolněte kloub a zkontrolujte, že nic nebrání pohybu.' });

  if (!out.some((f) => f.level === 'err' || f.level === 'warn')) {
    out.push({ code: 'all-ok', level: 'ok', title: 'Vše v pořádku',
      text: `Všech 6 serv odpovídá, napětí ${good.length ? fmtV(st[good[0]].voltage) : '—'}, teploty i kalibrační rozsahy jsou v normě.`, fix: '' });
  }
  return out;
}
