// STS3215 emulator behaviour that the real LeRobot stack relies on (tools/sil runs LeRobot 0.6.1 against it).
// Run from the repo root:  node --test sim/so101/test/sts3215-lerobot.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FeetechBus, INST, REG, packet, encodeReg, BROADCAST_ID, syncReadPacket, PacketReader } from '../lib/feetech.js';
import { VirtualArm, KinematicPlant } from '../lib/sts3215-emu.js';
import { VirtualTransport } from '../lib/transport.js';
import { EMULATED_FIRMWARE, FIRMWARE_ALLOW, checkFirmware } from '../lib/safety.js';

async function chain() {
  const plant = new KinematicPlant();
  const arm = new VirtualArm({ plant });
  arm.servos.forEach((s, i) => s.setReg('ID', i + 1, true));
  arm.setWiring('chain');
  const t = new VirtualTransport(arm); await t.open();
  return { arm, plant, t, bus: new FeetechBus(t, { timeoutMs: 8 }) };
}
const send = (arm, pkt) => { const r = new PacketReader(); for (const p of arm.receive(pkt, 1_000_000)) r.push(p); const out = []; let p; while ((p = r.next())) out.push(p); return out; };

test('Response_Status_Level 0: writes are silent, PING and READ still answer', async () => {
  const { arm, bus } = await chain();
  assert.equal((await bus.writeReg(2, 'Response_Status_Level', 0)).comm, 'ok');   // answered at the old level
  assert.equal((await bus.writeReg(2, 'Acceleration', 10)).comm, 'timeout');       // applied, but no status packet
  assert.equal(arm.servos[1].mem[REG.Acceleration[0]], 10);
  assert.equal((await bus.ping(2)).comm, 'ok');
  assert.equal((await bus.readReg(2, 'Acceleration')).value, 10);
  assert.equal(send(arm, syncReadPacket(56, 2, [2])).length, 1);                   // sync read still answers
});

test('REG_WRITE buffers a write until ACTION (scservo_sdk regWriteTxRx + action)', async () => {
  const { arm } = await chain();
  const r1 = send(arm, packet(3, INST.REG_WRITE, [REG.Acceleration[0], 77]));
  assert.equal(r1.length, 1); assert.equal(r1[0].id, 3);
  assert.notEqual(arm.servos[2].mem[REG.Acceleration[0]], 77);
  assert.equal(send(arm, packet(BROADCAST_ID, INST.ACTION)).length, 0);           // broadcast: no reply
  assert.equal(arm.servos[2].mem[REG.Acceleration[0]], 77);
});

test('Torque_Limit is loaded from Max_Torque_Limit at power-up and scales the output', async () => {
  const { arm, plant, bus } = await chain();
  // LeRobot so_follower.configure(): gripper Max_Torque_Limit = 500 (EPROM, Lock = 0)
  await bus.writeReg(6, 'Lock', 0);
  await bus.writeReg(6, 'Max_Torque_Limit', 500);
  arm.setWiring('none'); arm.setWiring('chain');                                   // power cycle
  assert.equal((await bus.readReg(6, 'Torque_Limit')).value, 500);
  assert.equal((await bus.readReg(5, 'Torque_Limit')).value, 1000);
  for (const id of [5, 6]) await bus.writeReg(id, 'Torque_Enable', 1);
  arm.update(0.01); arm.update(0.01);
  const ratio = () => plant.strength[5] / plant.strength[4];                       // gripper vs wrist_roll, same load
  assert.ok(Math.abs(ratio() - 0.5) < 1e-9, String(ratio()));
  await bus.writeReg(6, 'Torque_Limit', 1000);                                     // RAM write: full torque again
  arm.update(0.01);
  assert.ok(Math.abs(ratio() - 1) < 1e-9, String(ratio()));
});

test('LeRobot calibration sequence: reset, half-turn homing, limits, then degrees round trip', async () => {
  const { arm, plant, bus } = await chain();
  const ids = [1, 2, 3, 4, 5, 6];
  for (const id of ids) { await bus.writeReg(id, 'Torque_Enable', 0); await bus.writeReg(id, 'Lock', 0); }
  // reset_calibration(): Homing_Offset 0, limits 0..4095
  for (const id of ids) { await bus.writeReg(id, 'Homing_Offset', 0); await bus.writeReg(id, 'Min_Position_Limit', 0); await bus.writeReg(id, 'Max_Position_Limit', 4095); }
  const raw = await bus.syncReadReg('Present_Position', ids);
  for (const id of ids) await bus.writeReg(id, 'Homing_Offset', raw.get(id).value - 2047);   // _get_half_turn_homings
  const mid = await bus.syncReadReg('Present_Position', ids);
  for (const id of ids) assert.equal(mid.get(id).value, 2047);
  // the hand moves elbow_flex by +0.5 rad; present follows in the homed frame
  plant.hand(2, 0.5); arm.update(0.01);
  const moved = (await bus.readReg(3, 'Present_Position')).value;
  assert.equal(moved, 2047 + Math.round(0.5 * 4096 / (2 * Math.PI)));
  // limits written, torque on, a goal beyond the limit is clamped (write_calibration + send_action)
  await bus.writeReg(3, 'Min_Position_Limit', 1500); await bus.writeReg(3, 'Max_Position_Limit', 2600);
  await bus.writeReg(3, 'Torque_Enable', 1); await bus.writeReg(3, 'Lock', 1);
  await bus.syncWrite(REG.Goal_Position[0], 2, new Map([[3, encodeReg('Goal_Position', 3500)]]));
  arm.update(0.01);
  assert.equal((await bus.readReg(3, 'Present_Position')).value, 2600);
  // EPROM survives a power cycle because it was written with Lock = 0
  arm.setWiring('none'); arm.setWiring('chain');
  assert.equal((await bus.readReg(3, 'Homing_Offset')).value, raw.get(3).value - 2047);
  assert.equal((await bus.readReg(3, 'Max_Position_Limit')).value, 2600);
});

test('safety: the emulator firmware is never accepted as verified real firmware', async () => {
  const { bus } = await chain();
  const major = (await bus.readReg(1, 'Firmware_Major_Version')).value, minor = (await bus.readReg(1, 'Firmware_Minor_Version')).value;
  assert.deepEqual([major, minor], [EMULATED_FIRMWARE.major, EMULATED_FIRMWARE.minor]);
  assert.equal(FIRMWARE_ALLOW.length, 0);
  const r = checkFirmware({ 1: { major, minor, model: 777 } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'allow_list_empty');
});
