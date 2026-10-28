// Unit tests for the Feetech protocol layer and the STS3215 emulator.
// Run from the repo root:  node --test sim/so101/test/protocol.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checksum, packet, PacketReader, encodeSM, decodeSM, encodeReg, decodeReg, FeetechBus, INST, ERR,
  syncWritePacket, syncReadPacket, hex, BROADCAST_ID
} from '../lib/feetech.js';
import { VirtualArm, KinematicPlant, collide } from '../lib/sts3215-emu.js';
import { VirtualTransport } from '../lib/transport.js';
import * as S from '../lib/so101-setup.js';

function rig(opts = {}) {
  const plant = new KinematicPlant();
  const arm = new VirtualArm({ plant, ...opts });
  const t = new VirtualTransport(arm);
  const bus = new FeetechBus(t, { timeoutMs: 8 });
  return { arm, t, bus, plant, open: () => t.open() };
}
async function assembled(opts) {
  // six servos with IDs 1–6, daisy-chained
  const r = rig(opts); await r.open();
  for (let i = 5; i >= 0; i--) { r.arm.setWiring(i); await S.setupMotor(r.bus, r.t, i + 1); }
  r.arm.setWiring('chain');
  return r;
}

test('checksum matches the scservo_sdk formula ~(ID+LEN+INSTR+PARAMS) & 0xFF', () => {
  // Ping ID 1: FF FF 01 02 01 FB (example from the Feetech manual / SDK)
  assert.equal(hex(packet(1, INST.PING)), 'FF FF 01 02 01 FB');
  // Read Present_Position (56, 2) from ID 1: FF FF 01 04 02 38 02 BE
  assert.equal(hex(packet(1, INST.READ, [0x38, 0x02])), 'FF FF 01 04 02 38 02 BE');
  const p = packet(7, INST.WRITE, [42, 0x00, 0x08]);
  assert.equal(p[p.length - 1], (~(7 + 5 + 3 + 42 + 0 + 8)) & 0xFF);
  assert.equal(checksum(p), p[p.length - 1]);
});

test('packet reader: junk, split chunks, bad checksum, FF FF FF', () => {
  const r = new PacketReader();
  const a = packet(3, 0, [0x10, 0x20]);
  r.push([0x00, 0x13, 0xFF]); r.push([0xFF, ...a.slice(0, 3)]);   // junk then partial
  assert.equal(r.next(), null);
  r.push(a.slice(3));
  let p = r.next();
  assert.equal(p.id, 3); assert.deepEqual(p.params, [0x10, 0x20]); assert.equal(p.code, 0);
  const bad = packet(4, 0, [1]); bad[bad.length - 1] ^= 1;
  r.push(bad); r.push(packet(5, 0));
  p = r.next(); assert.ok(p.bad); assert.equal(p.id, 4);
  p = r.next(); assert.equal(p.id, 5);
  assert.equal(r.next(), null);
});

test('sign-magnitude encoding (LeRobot encoding table bits)', () => {
  assert.equal(encodeSM(-5, 11), 0x805); assert.equal(decodeSM(0x805, 11), -5);
  assert.equal(encodeSM(300, 15), 300);
  assert.deepEqual(encodeReg('Homing_Offset', -100), [100, 0x08]);
  assert.equal(decodeReg('Present_Load', [0xF4, 0x05]), -500);   // 0x5F4 = bit10 | 500
  assert.equal(decodeReg('Goal_Position', [0x00, 0x08]), 2048);
});

test('sync write / sync read packet layout', () => {
  const sw = syncWritePacket(42, 2, [[1, [0x00, 0x08]], [2, [0xFF, 0x07]]]);
  assert.equal(hex(sw.slice(0, 7)), 'FF FF FE 0A 83 2A 02');
  assert.equal(sw[3], 2 * 3 + 2 + 2);
  const sr = syncReadPacket(56, 2, [1, 2, 3]);
  assert.equal(hex(sr), hex(packet(BROADCAST_ID, 0x82, [56, 2, 1, 2, 3])));
  assert.throws(() => syncWritePacket(42, 2, [[1, [0]]]));
});

test('factory state: every new servo answers on ID 1, model 777', async () => {
  const r = rig(); await r.open();
  r.arm.setWiring(5);
  assert.equal((await r.bus.ping(1)).comm, 'ok');
  const m = await r.bus.readReg(1, 'Model_Number');
  assert.equal(m.value, 777);
  assert.equal((await r.bus.ping(6)).comm, 'timeout');
});

test('two factory servos on one bus: broadcast ping sees a collision, setup refuses', async () => {
  const r = rig(); await r.open();
  r.arm.setWiring('chain');                 // all six still on ID 1
  assert.equal((await r.bus.ping(1)).comm, 'corrupt');
  await assert.rejects(S.findSingleMotor(r.bus, r.t), (e) => e.code === 'multiple');
});

test('ID change: reply comes from the old ID, new ID persists across power cycle (Lock = 0)', async () => {
  const r = rig(); await r.open();
  r.arm.setWiring(5);
  const res = await S.setupMotor(r.bus, r.t, 6);
  assert.equal(res.from, 1);
  assert.equal((await r.bus.ping(6)).comm, 'ok');
  assert.equal((await r.bus.ping(1)).comm, 'timeout');
  r.arm.setWiring('none'); r.arm.setWiring(5);   // unplug + replug = power cycle
  assert.equal((await r.bus.ping(6)).comm, 'ok');
});

test('ID written with Lock = 1 is lost after a power cycle', async () => {
  const r = rig(); await r.open();
  r.arm.setWiring(0);
  const w = await r.bus.writeReg(1, 'ID', 9);      // no Lock=0 first
  assert.equal(w.comm, 'ok');
  assert.equal((await r.bus.ping(9)).comm, 'ok');
  r.arm.setWiring('none'); r.arm.setWiring(0);
  assert.equal((await r.bus.ping(9)).comm, 'timeout');
  assert.equal((await r.bus.ping(1)).comm, 'ok');
});

test('sync read and sync write across six servos', async () => {
  const { bus, arm, plant } = await assembled();
  const ids = [1, 2, 3, 4, 5, 6];
  const vol = await bus.syncReadReg('Present_Voltage', ids);
  for (const id of ids) assert.equal(vol.get(id).value, 50);       // 5 V supply for 7.4 V servos
  await S.enableTorque(bus, ids);
  const pos = await bus.syncReadReg('Present_Position', ids);
  const goals = new Map(ids.map((id) => [id, pos.get(id).value + 100]));
  await bus.syncWriteReg('Goal_Position', goals);
  arm.update(0.01);
  const after = await bus.syncReadReg('Present_Position', ids);
  for (const id of ids) assert.equal(after.get(id).value, goals.get(id));
  assert.ok(plant.driven.every(Boolean));
});

test('calibration: half-turn homing gives 2047, limits clamp the goal', async () => {
  const { bus, arm, plant } = await assembled();
  await S.disableTorque(bus);
  const offs = await S.setHalfTurnHomings(bus);
  const pos = await bus.syncReadReg('Present_Position', S.IDS);
  for (const id of S.IDS) assert.equal(pos.get(id).value, 2047, 'id ' + id);
  assert.ok(Object.values(offs).some((o) => o < 0));                // negative offsets use bit 11
  const mins = {}, maxes = {};
  await S.sampleRanges(bus, S.IDS, mins, maxes);
  for (let i = 0; i < 6; i++) plant.hand(i, -0.8);
  await S.sampleRanges(bus, S.IDS, mins, maxes);
  for (let i = 0; i < 6; i++) plant.hand(i, 0.9);
  await S.sampleRanges(bus, S.IDS, mins, maxes);
  const cal = S.buildCalibration(offs, mins, maxes);
  assert.equal(cal.wrist_roll.range_min, 0); assert.equal(cal.wrist_roll.range_max, 4095);
  await S.writeCalibration(bus, cal);
  assert.deepEqual(await S.readCalibration(bus), cal);
  await S.enableTorque(bus);
  await bus.writeReg(3, 'Goal_Position', 4000);                    // beyond Max_Position_Limit
  arm.update(0.01);
  assert.equal((await bus.readReg(3, 'Present_Position')).value, cal.elbow_flex.range_max);
  // DEGREES normalisation round trip
  const c = cal.shoulder_pan;
  assert.equal(Math.round(S.normalize('shoulder_pan', c, S.unnormalize('shoulder_pan', c, 30))), 30);
});

test('duplicate ID collides (wired-AND) and fails the checksum', () => {
  const a = packet(1, 0, [1, 2]), b = packet(1, 0, [1, 2]);
  const c = collide([a, b]);
  const r = new PacketReader(); r.push(c);
  assert.ok(r.next().bad);
});

test('diagnostics: healthy arm', async () => {
  const { bus } = await assembled();
  const f = await S.diagnose(bus, { variant: '7.4' });
  // fresh arm is not calibrated yet -> warning only
  assert.deepEqual(f.map((x) => x.code), ['uncalibrated']);
});

for (const [fault, code] of [['cable', 'cable'], ['dupid', 'dup-id'], ['supply', 'overvolt'], ['range', 'range'], ['heat', 'overheat']]) {
  test(`diagnostics detects fault "${fault}"`, async () => {
    const { bus, arm } = await assembled();
    await S.disableTorque(bus);
    const offs = await S.setHalfTurnHomings(bus);
    const mins = {}, maxes = {};
    for (const q of [0, -1.5, 1.5]) { for (let i = 0; i < 6; i++) arm.plant.hand(i, q); await S.sampleRanges(bus, S.IDS, mins, maxes); }
    await S.writeCalibration(bus, S.buildCalibration(offs, mins, maxes));
    await S.enableTorque(bus);
    arm.setFault(fault, true);
    for (let k = 0; k < 400; k++) arm.update(0.1);                    // 40 s (overheating trips after ≈ 22 s)
    const f = await S.diagnose(bus, { variant: '7.4' });
    assert.ok(f.some((x) => x.code === code), JSON.stringify(f.map((x) => x.code)));
    arm.setFault(fault, false);
  });
}

test('undervoltage on 12 V servos is reported and weakens the servo', async () => {
  const { bus, arm, plant } = await assembled({ variant: '12' });
  await S.enableTorque(bus);
  arm.setFault('supply', true); arm.update(0.1);
  const f = await S.diagnose(bus, { variant: '12' });
  assert.ok(f.some((x) => x.code === 'undervolt'));
  assert.ok(plant.strength[1] < 0.5);
  const st = await bus.readReg(2, 'Status');
  assert.ok(st.value & ERR.VOLTAGE);
});

test('emergency stop turns torque off on every servo', async () => {
  const { bus } = await assembled();
  await S.enableTorque(bus);
  await S.stopAll(bus);
  const tq = await bus.syncReadReg('Torque_Enable', S.IDS);
  for (const id of S.IDS) assert.equal(tq.get(id).value, 0);
});
