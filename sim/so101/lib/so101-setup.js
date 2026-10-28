// SO-101 follower setup steps on a FeetechBus — printedrobotics.cz.
// A JavaScript re-implementation of what LeRobot v0.6.1 does in
//   lerobot/motors/motors_bus.py   (setup_motor, reset_calibration, set_half_turn_homings,
//                                   record_ranges_of_motion, _normalize, _unnormalize)
//   lerobot/motors/feetech/feetech.py (_find_single_motor_p0, configure_motors, disable/enable_torque,
//                                   write_calibration, _get_half_turn_homings)
//   lerobot/robots/so_follower/so_follower.py (setup_motors order, calibrate, configure)
// LeRobot: Copyright 2024 The HuggingFace Inc. team, Apache License 2.0 (see ../NOTICE.txt).
// No DOM here: the wizard and the Node tests both use it.

import { REG, ERR, STS3215_MODEL, BAUD_CODE, SO101_MOTORS, RESOLUTION, decodeReg, fromBytes, decodeSM } from './feetech.js';
import { VARIANTS } from './sts3215-emu.js';

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
  await bus.writeReg(id, 'Torque_Enable', 0);      // feetech._disable_torque
  await bus.writeReg(id, 'Lock', 0);               // open EPROM write lock
  const w = await bus.writeReg(id, 'ID', targetId);
  if (!isOk(w)) throw new SetupError('comm', 'Zápis ID se nepovedl.');
  await bus.writeReg(targetId, 'Baud_Rate', BAUD_CODE[1_000_000]);
  await transport.setBaudRate(1_000_000);
  const p = await bus.ping(targetId);
  if (!isOk(p)) throw new SetupError('verify', `Servo po změně neodpovídá na ID ${targetId}.`);
  log(`ID ${id} → ${targetId} zapsáno a ověřeno`);
  return { from: id, baud };
}

export async function scanIds(bus, ids = IDS) {
  const out = {};
  for (const id of ids) out[id] = (await bus.ping(id)).comm;
  return out;
}

export async function disableTorque(bus, ids = IDS) {
  for (const id of ids) { await bus.writeReg(id, 'Torque_Enable', 0); await bus.writeReg(id, 'Lock', 0); }
}

/** Emergency stop: broadcast + sync write torque off, no replies awaited beyond the bus lock. */
export async function stopAll(bus, ids = IDS) {
  const off = new Map(ids.map((id) => [id, 0]));
  await bus.syncWriteReg('Torque_Enable', off);
  await bus.write(0xFE, REG.Torque_Enable[0], [0]);
}

/**
 * Enable torque safely: first make Goal_Position = Present_Position for every servo,
 * so nothing jumps to a stale goal, then Torque_Enable = 1 and Lock = 1 (feetech.enable_torque).
 */
export async function enableTorque(bus, ids = IDS) {
  const pos = await bus.syncReadReg('Present_Position', ids);
  const goals = new Map();
  for (const [id, r] of pos) { if (!isOk(r)) throw new SetupError('comm', `Servo ${id} neodpovídá, moment nezapínáme.`); goals.set(id, r.value); }
  await bus.syncWriteReg('Goal_Position', goals);
  for (const id of ids) { await bus.writeReg(id, 'Torque_Enable', 1); await bus.writeReg(id, 'Lock', 1); }
  return goals;
}

/** so_follower.configure + feetech.configure_motors (with torque disabled). */
export async function configureFollower(bus, { maxVelocity = 0 } = {}) {
  await disableTorque(bus);
  for (const m of MOTORS) {
    await bus.writeReg(m.id, 'Return_Delay_Time', 0);
    await bus.writeReg(m.id, 'Maximum_Acceleration', 254);
    await bus.writeReg(m.id, 'Acceleration', 254);
    await bus.writeReg(m.id, 'Operating_Mode', 0);           // position mode
    await bus.writeReg(m.id, 'P_Coefficient', 16);           // config_so_follower.py defaults
    await bus.writeReg(m.id, 'I_Coefficient', 0);
    await bus.writeReg(m.id, 'D_Coefficient', 32);
    if (m.name === 'gripper') {
      await bus.writeReg(m.id, 'Max_Torque_Limit', 500);     // 50 % torque to avoid burnout
      await bus.writeReg(m.id, 'Protection_Current', 250);
      await bus.writeReg(m.id, 'Overload_Torque', 25);
    }
    // extra safety layer of this wizard (not in LeRobot): servo-side speed cap, steps/s (0 = no cap)
    await bus.writeReg(m.id, 'Goal_Velocity', maxVelocity);
  }
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
