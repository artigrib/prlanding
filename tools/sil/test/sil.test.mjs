// Tests for the SO-101 software-in-the-loop runner (tools/sil). Run from the repo root:
//   node --test tools/sil/test/*.test.mjs
// The end-to-end test starts the runner (MuJoCo WASM + emulated servos + pty via python3) and talks
// to the virtual serial port; it is skipped where there is no pty (Windows) or no python3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tty from 'node:tty';
import { fileURLToPath } from 'node:url';
import { wsAccept, wsFrame } from '../lib/server.mjs';
import { sweepSegments, parseTrajectory, HandMover, middle, PICK_PLACE } from '../lib/motion.mjs';
import { HandPlant } from '../lib/plant.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RANGE = [[-1.92, 1.92], [-1.75, 1.75], [-1.69, 1.69], [-1.66, 1.66], [-2.74, 2.84], [-0.17, 1.75]];

test('WebSocket handshake and frames follow RFC 6455', () => {
  assert.equal(wsAccept('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');   // RFC 6455 §1.3 example
  assert.deepEqual([...wsFrame('hi')], [0x81, 2, 0x68, 0x69]);
  const mid = wsFrame('x'.repeat(300));
  assert.deepEqual([...mid.subarray(0, 4)], [0x81, 126, 1, 44]);
  assert.equal(wsFrame('x'.repeat(70000))[1], 127);
});

test('calibration sweep reaches both ends of every joint except wrist_roll, and ends in the middle', () => {
  const segs = sweepSegments(RANGE);
  const mid = middle(RANGE);
  for (const j of [0, 1, 2, 3, 5]) {
    const vals = segs.map((s) => s.q[j]);
    assert.ok(Math.min(...vals) < RANGE[j][0] + 0.1, `joint ${j} low end`);
    assert.ok(Math.max(...vals) > RANGE[j][1] - 0.1, `joint ${j} high end`);
  }
  assert.ok(segs.every((s) => s.q[4] === mid[4]), 'wrist_roll is a full-turn motor in LeRobot: not swept');
  assert.deepEqual(segs.at(-1).q, mid);
  // shoulder_lift is swept with the elbow folded (otherwise the follower stops on the table)
  const liftLow = segs.find((s) => s.q[1] < -1.6 && s.q[2] < -1.5);
  assert.ok(liftLow);
});

test('trajectory files: JSON frames and CSV with absolute times', () => {
  const j = parseTrajectory(JSON.stringify([{ q: [0, 0, 0, 0, 0, 0], t: 1 }, { q: [0.1, 0, 0, 0, 0, 1], t: 0.5 }]));
  assert.equal(j.length, 2); assert.equal(j[1].t, 0.5);
  const c = parseTrajectory('t,q0,q1,q2,q3,q4,q5\n0.5,0,0,0,0,0,0\n1.25,0.1,0,0,0,0,1\n');
  assert.deepEqual(c.map((f) => f.t), [0.5, 0.75]);
  assert.throws(() => parseTrajectory('[{"q":[1,2,3]}]'), /6 numbers/);
  assert.throws(() => parseTrajectory('0,1,2\n'), /t,q0/);
});

test('HandMover plays segments smoothly, loops and reports idle', () => {
  const plant = new HandPlant(RANGE, [0, 0, 0, 0, 0, 0]);
  const h = new HandMover(plant);
  let loops = 0, idle = null;
  h.onLoop = () => loops++; h.onIdle = (n) => { idle = n; };
  h.play([{ q: [0.5, 0, 0, 0, 0, 0], t: 1 }], { name: 'x' });
  for (let i = 0; i < 50; i++) h.tick(0.01);
  assert.ok(plant.q(0) > 0.1 && plant.q(0) < 0.4, 'halfway after 0.5 s (smoothstep)');
  for (let i = 0; i < 60; i++) h.tick(0.01);
  assert.equal(plant.q(0), 0.5); assert.equal(idle, 'x');
  h.play(PICK_PLACE, { loop: true, name: 'pickplace' });
  for (let i = 0; i < 2500; i++) h.tick(0.01);
  assert.ok(loops >= 2);
  plant.drive(0, 0.2); h.nudge(0, 0.3);                                    // torque on: a hand cannot move it
  assert.equal(plant.q(0), 0.2);
});

const canPty = process.platform !== 'win32' && spawnSync('python3', ['-c', 'import pty, termios'], { stdio: 'ignore' }).status === 0;

test('runner end to end: virtual serial port answers PING/READ, control and mirror are localhost-only', { skip: !canPty && 'needs python3 + pty', timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sil-'));
  const link = path.join(dir, 'follower'), ctl = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(ROOT, 'tools/sil/so101-virtual.mjs'), '--quiet', '--mirror', '--follower-port', link, '--ctl-port', String(ctl)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  try {
    for (let i = 0; i < 200 && !out.includes('control:'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(out.includes('control:'), out);
    const fd = fs.openSync(link, fs.constants.O_RDWR | fs.constants.O_NOCTTY);
    const rs = new tty.ReadStream(fd);
    const got = [];
    rs.on('data', (b) => got.push(...b));
    const txrx = async (bytes, n) => { got.length = 0; fs.writeSync(fd, Buffer.from(bytes)); for (let i = 0; i < 100 && got.length < n; i++) await new Promise((r) => setTimeout(r, 10)); return got.slice(); };
    assert.deepEqual(await txrx([0xFF, 0xFF, 0x03, 0x02, 0x01, 0xF9], 6), [0xFF, 0xFF, 0x03, 0x02, 0x00, 0xFA]);   // PING ID 3
    const model = await txrx([0xFF, 0xFF, 0x01, 0x04, 0x02, 0x03, 0x02, 0xF3], 8);                            // READ Model_Number
    assert.equal(model[5] | (model[6] << 8), 777);
    rs.destroy();
    // control: needs the X-SIL header (a web page cannot add it cross-origin without a preflight)
    const base = `http://127.0.0.1:${ctl}`;
    assert.equal((await fetch(base + '/cmd', { method: 'POST', body: 'cube' })).status, 403);
    const ok = await fetch(base + '/cmd', { method: 'POST', headers: { 'X-SIL': '1' }, body: 'middle follower' });
    assert.equal((await ok.json()).ok, true);
    const st = await (await fetch(base + '/status')).json();
    assert.equal(st.follower.servos.length, 6); assert.equal(st.follower.servos[2].id, 3);
    // mirror: JSON frames with the follower's joint angles
    const ws = new WebSocket(`ws://127.0.0.1:${ctl}/mirror`);
    const frame = await new Promise((res, rej) => { ws.onmessage = (e) => res(JSON.parse(e.data)); ws.onerror = rej; setTimeout(() => rej(new Error('no mirror frame')), 5000); });
    ws.close();
    assert.equal(frame.follower.q.length, 6); assert.equal(frame.cube.length, 7);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
