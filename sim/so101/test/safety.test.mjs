// Real-arm safety checks on the STS3215 emulator (VirtualTransport): two-stage STOP (hold vs limp
// register writes, latency T1), speed-cap clamping, permission expiry / session cap, firmware
// allow-list and the agent-link deadman. Spec: real-arm safety specification SR-6/7/12/13/14/15/19.
// Run from the repo root:  node --test sim/so101/test/safety.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FeetechBus, INST, BROADCAST_ID } from '../lib/feetech.js';
import { VirtualArm, KinematicPlant } from '../lib/sts3215-emu.js';
import { VirtualTransport } from '../lib/transport.js';
import * as S from '../lib/so101-setup.js';
import * as SF from '../lib/safety.js';
import { createAgentBridge, REAL_DEADMAN_MS } from '../../../backend/bridge-client/agent-bridge.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p95 = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };

async function powered({ timeoutMs = 8 } = {}) {
  const plant = new KinematicPlant([0.1, -0.2, 0.3, 0.1, 0, 0.8]);
  const arm = new VirtualArm({ plant });
  arm.servos.forEach((s, i) => { s.saved[5] = i + 1; });
  arm.setWiring('chain');
  const t = new VirtualTransport(arm);
  const tx = [];
  const bus = new FeetechBus(t, { timeoutMs, onPacket: (dir, b) => { if (dir === 'tx') tx.push(Uint8Array.from(b)); } });
  await t.open();
  const { units } = await S.configureFollower(bus, { real: true, speedDegS: 30 });
  const goals = await S.enableTorque(bus);
  return { arm, plant, t, bus, tx, units, goals };
}
const reg = (arm, name) => arm.servos.map((s) => s.reg(name));
/** Stream goals toward +delta steps on every arm joint while the emulator runs, like the wizard does. */
async function moving(r, steps = 10) {
  for (let k = 0; k < steps; k++) {
    const g = new Map(S.ARM_IDS.map((id) => [id, r.goals.get(id) + 40 * (k + 1)]));
    await r.bus.syncWriteReg('Goal_Position', g);
    r.arm.update(0.02);
  }
}

test('stage-one STOP = HOLD: goal := present on joints 1–5, gripper torque off, nothing else switched', async () => {
  const r = await powered();
  await moving(r);
  const t0 = performance.now();
  const lastKnown = new Map(S.ARM_IDS.map((id) => [id, r.arm.servos[id - 1].reg('Present_Position')]));
  const n = r.tx.length;
  const h = await S.holdAll(r.bus, { lastKnown, t0 });
  assert.ok(h.wire && h.ok, JSON.stringify(h));
  // the first two packets after the trigger are the emergency sync writes: goals, then gripper torque
  const [a, b] = r.tx.slice(n);
  assert.equal(a[2], BROADCAST_ID); assert.equal(a[4], INST.SYNC_WRITE); assert.equal(a[5], 42);
  assert.equal(b[4], INST.SYNC_WRITE); assert.equal(b[5], 40); assert.equal(b[7], S.GRIPPER_ID); assert.equal(b[8], 0);
  const tq = reg(r.arm, 'Torque_Enable');
  assert.deepEqual(tq, [1, 1, 1, 1, 1, 0], 'arm joints keep torque, gripper released');
  const goal = reg(r.arm, 'Goal_Position'), pres = reg(r.arm, 'Present_Position');
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(goal[i] - pres[i]) <= 1, `joint ${i + 1}: goal ${goal[i]} vs present ${pres[i]}`);
  // the arm stays put afterwards (no sag / drift in the emulator, overshoot after STOP 0°)
  const before = reg(r.arm, 'Present_Position');
  for (let k = 0; k < 50; k++) r.arm.update(0.02);
  const after = reg(r.arm, 'Present_Position');
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(after[i] - before[i]) <= 1, `joint ${i + 1} moved after hold`);
  assert.ok(h.t1Ms != null && h.t1Ms < 30, 'T1 ' + h.t1Ms);
});

test('stage-two STOP = LIMP: torque off on all six with read-back (after a hold)', async () => {
  const r = await powered();
  await S.holdAll(r.bus, {});
  const l = await S.stopAll(r.bus);
  assert.ok(l.ok && l.wire);
  assert.deepEqual(reg(r.arm, 'Torque_Enable'), [0, 0, 0, 0, 0, 0]);
});

test('HOLD never switches torque on (a limp arm stays limp)', async () => {
  const r = await powered();
  await S.stopAll(r.bus);
  const h = await S.holdAll(r.bus, {});
  assert.ok(h.wire);
  assert.deepEqual(reg(r.arm, 'Torque_Enable'), [0, 0, 0, 0, 0, 0]);
});

test('STOP latency T1 (trigger -> emergency packet on the port) is not delayed by a stuck transaction', async () => {
  const r = await powered({ timeoutMs: 60 });
  const t1 = [];
  for (let k = 0; k < 30; k++) {
    await moving(r, 2);
    const slow = r.bus.ping(42);                 // nobody answers: the queue is blocked for 60 ms
    const t0 = performance.now();
    const h = await S.holdAll(r.bus, { t0, lastKnown: new Map(S.ARM_IDS.map((id) => [id, r.arm.servos[id - 1].reg('Present_Position')])) });
    t1.push(h.t1Ms);
    await slow;
    await S.enableTorque(r.bus);                // gripper back on for the next round
  }
  const q = p95(t1);
  console.log(`# emulator STOP T1: p95 ${q.toFixed(2)} ms, max ${Math.max(...t1).toFixed(2)} ms over ${t1.length} presses`);
  assert.ok(q < 30, 'p95 T1 ' + q);          // SR-15 target T1 ≤ 30 ms p95
  assert.ok(Math.max(...t1) < 60, 'T1 must not wait for the blocked transaction');
});

test('HOLD with a dead port reports wire=false quickly (caller closes the port and says so)', async () => {
  const r = await powered();
  r.t.write = () => new Promise(() => {});      // the port stops taking data
  const t0 = performance.now();
  const h = await S.holdAll(r.bus, {});
  assert.equal(h.wire, false);
  assert.ok(performance.now() - t0 < 700);
});

test('speed caps: default 30, teacher 20, owner max 60; firmware backstop 1.25 × and clamped', async () => {
  assert.equal(SF.clampSpeed(90), 60);
  assert.equal(SF.clampSpeed(90, 'teacher'), 20);
  assert.equal(SF.clampSpeed(5), SF.SPEED.min);
  assert.equal(SF.clampSpeed('nonsense'), 30);
  assert.equal(SF.PROFILES.owner.defaultSpeed, 30);
  assert.equal(SF.PROFILES.teacher.defaultSpeed, 20);
  assert.equal(SF.firmwareCapDeg(30), 37.5);
  assert.equal(SF.firmwareCapDeg(90), 75);
  const r = await powered();
  const unit = S.velocityUnitDeg(0);              // 0.732 rpm = 4.392 °/s per unit (TO VERIFY ON BENCH)
  let v = await S.setSpeedCap(r.bus, 30, r.units);
  assert.equal(v.get(1), Math.ceil(30 * 1.25 / unit));
  v = await S.setSpeedCap(r.bus, 90, r.units);   // a caller asking for 90 °/s gets the 60 °/s backstop
  assert.equal(v.get(1), Math.ceil(60 * 1.25 / unit));
  assert.deepEqual(reg(r.arm, 'Goal_Velocity'), Array(6).fill(Math.ceil(60 * 1.25 / unit)));
  // Phase bit 2 selects the 0.0146 rpm unit
  assert.equal(S.velocityUnitDeg(0x04), 0.0146 * 6);
});

test('motion permission: 10 min owner / 5 min teacher, renewals, 3 min idle, session cap + cool-down', () => {
  let t = 0;
  const p = new SF.MotionPermission({ now: () => t });
  assert.equal(p.check().reason, 'not_armed');
  assert.ok(p.arm('owner').ok);
  // touched every 2 min -> no idle expiry; at 10:00 without renewal -> expired
  t = 9 * 60e3 + 59e3; p.lastMotion = t - 60e3;  // keep idle out of the way for this check
  assert.ok(p.check().ok);
  t = 10 * 60e3 + 1000; p.lastMotion = t - 60e3;
  assert.equal(p.check().reason, 'expired');
  assert.equal(p.armed, false);

  t = 0; const q = new SF.MotionPermission({ now: () => t });
  q.arm('owner');
  t = 3 * 60e3; assert.equal(q.check().reason, 'idle');

  t = 0; const s = new SF.MotionPermission({ now: () => t });
  s.arm('owner');
  for (t = 0; t < 45 * 60e3 - 60e3; t += 2 * 60e3) { assert.ok(s.check().ok, 'armed at ' + t); s.touch(); }
  assert.ok(s.status().leftMs <= s.status().sessionLeftMs, 'renewal never passes the session cap');
  t = 45 * 60e3; assert.equal(s.check().reason, 'session');
  assert.equal(s.arm('owner').reason, 'cooldown');
  t += 5 * 60e3; assert.ok(s.arm('owner').ok, 'after the 5-min cool-down arming works again');

  t = 0; const tp = new SF.MotionPermission({ now: () => t });
  tp.arm('teacher');
  assert.equal(tp.status().leftMs, 3 * 60e3);   // idle limit is shorter than 5 min: shown as the time left
  t = 2 * 60e3; tp.touch(); t = 4 * 60e3; tp.touch();
  t = 4 * 60e3 + 5 * 60e3 + 1; assert.equal(tp.check().reason, 'expired');
  t = 0; const tc = new SF.MotionPermission({ now: () => t }); tc.arm('teacher');
  for (t = 0; t < 20 * 60e3; t += 60e3) { assert.ok(tc.check().ok); tc.touch(); }
  assert.equal(tc.check().reason, 'session');
  assert.equal(SF.fmtLeft(270e3), '4:30');
});

test('STOP latch: hold, then limp; only release() clears it; Space window', () => {
  let t = 0;
  const l = new SF.StopLatch({ now: () => t });
  assert.equal(l.spaceIsStop(false), false);
  assert.equal(l.spaceIsStop(true), true);
  assert.equal(l.press(), 'hold');
  assert.ok(l.latched);
  t = 1500; assert.equal(l.spaceIsStop(false), true);
  t = 2500; assert.equal(l.spaceIsStop(false), false);
  assert.equal(l.press(), 'limp');
  assert.equal(l.press(), 'limp');
  assert.equal(l.release(), 'limp');
  assert.equal(l.latched, false);
  assert.equal(l.press(), 'hold');
  assert.equal(l.holdLong(), 'limp');
});

test('firmware allow-list: empty list keeps every real arm in shadow; emulator readings via the bus', async () => {
  const r = await powered();
  const fw = await S.readFirmware(r.bus);
  assert.deepEqual(fw.get(1), { major: 3, minor: 10, model: 777 });
  const none = SF.checkFirmware(fw);
  assert.equal(none.ok, false); assert.equal(none.reason, 'allow_list_empty'); assert.equal(none.unknown.length, 6);
  assert.equal(SF.checkFirmware(fw, [SF.EMULATED_FIRMWARE]).ok, true);
  const other = SF.checkFirmware(fw, [{ major: 3, minor: 9, model: 777 }]);
  assert.equal(other.reason, 'unknown_firmware'); assert.equal(other.unknown[0].version, '3.10');
  const m = new Map(fw); m.set(4, null);
  assert.deepEqual(SF.checkFirmware(m, [SF.EMULATED_FIRMWARE]).missing, [4]);
  const wrongModel = new Map(fw); wrongModel.set(2, { major: 3, minor: 10, model: 778 });
  assert.equal(SF.checkFirmware(wrongModel, [SF.EMULATED_FIRMWARE]).ok, false);
  assert.equal(SF.FIRMWARE_ALLOW.length, 0, 'fill only from bench reports');
});

// ---------- agent-link deadman (agent-bridge.js, real mode) ----------
class FakeWS {
  constructor() { this.readyState = 1; this.sent = []; this.closed = null; FakeWS.last = this; setTimeout(() => this.onopen && this.onopen(), 0); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code, why) { this.closed = { code, why }; }
  rx(m) { this.onmessage({ data: JSON.stringify({ v: 1, ...m }) }); }
}
async function pairedBridge(opts) {
  const ev = { stops: [], lost: [], dead: [] };
  const handler = {
    info: async () => ({}),
    stop: async (a) => { ev.stops.push({ at: performance.now(), reason: a.reason }); return { status: 'held' }; },
    onLinkLost: (why) => ev.lost.push({ at: performance.now(), why }),
    home: (args, { signal }) => new Promise((res) => signal.addEventListener('abort', () => res({ status: 'stopped' })))
  };
  const b = createAgentBridge({ handler, WebSocketImpl: FakeWS, reconnect: false, ui: { onDeadman: (e) => ev.dead.push(e) }, ...opts });
  b.connect();
  await sleep(5);
  const ws = FakeWS.last;
  ws.rx({ t: 'welcome', hb: 5, code: 'ABCD1234' });
  ws.rx({ t: 'paired', client: { name: 'test' } });
  return { b, ws, ev };
}

test('agent link, real mode: 1 s deadman -> hold + onLinkLost, socket kept, aborted call answered CANCELLED', async () => {
  const { b, ws, ev } = await pairedBridge({ localDeadmanMs: REAL_DEADMAN_MS });
  ws.rx({ t: 'call', id: 'm1', tool: 'home', args: {} });
  const silentFrom = performance.now();
  await sleep(600);
  assert.ok(ws.sent.filter((m) => m.t === 'ping').length >= 2, 'pings every 250 ms');
  assert.equal(ev.stops.length, 0);
  await sleep(700);
  assert.equal(ev.lost.length, 1); assert.equal(ev.lost[0].why, 'deadman');
  const latency = ev.lost[0].at - silentFrom;
  console.log(`# deadman hold after ${latency.toFixed(0)} ms of silence`);
  assert.ok(latency >= 1000 && latency <= 1100, 'hold within 1.0–1.1 s: ' + latency);
  assert.ok(ev.stops.some((s) => s.reason === 'deadman'));
  assert.equal(ws.closed, null, 'server semantics unchanged: the socket stays open');
  const res = ws.sent.find((m) => m.t === 'result' && m.id === 'm1');
  assert.equal(res.ok, false); assert.equal(res.error.code, 'CANCELLED');
  assert.ok(b.deadmanTripped && ev.dead.at(-1).tripped);
  b.disconnect();
});

test('agent link, real mode: any inbound message clears the trip (the aborted motion stays aborted)', async () => {
  const { b, ws, ev } = await pairedBridge({ localDeadmanMs: 300, pingMs: 100 });
  await sleep(450);
  assert.ok(b.deadmanTripped);
  ws.rx({ t: 'pong' });
  assert.equal(b.deadmanTripped, false);
  assert.equal(ev.dead.at(-1).tripped, false);
  b.disconnect();
});

test('agent link, sim mode: no local deadman (relay hb semantics only)', async () => {
  const { b, ws, ev } = await pairedBridge({});
  await sleep(1300);
  assert.equal(ev.lost.length, 0);
  assert.equal(ws.sent.filter((m) => m.t === 'ping').length, 0);
  b.disconnect();
});
