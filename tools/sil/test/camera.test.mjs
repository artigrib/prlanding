// Tests for the SIL runner's virtual cameras (tools/sil/lib/camera.mjs, raster.mjs, png.mjs, zmq-pub.mjs).
//   node --test tools/sil/test/*.test.mjs
// No Python, no LeRobot, no model: the ZMQ side is checked with a minimal SUB client written here.
// tools/sil/camera_smoke.py checks the same against real libzmq (pyzmq) in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG, decodePNG, crc32 } from '../lib/png.mjs';
import { greeting, commandFrame, messageFrame, parseFrames, startZmqPub } from '../lib/zmq-pub.mjs';
import { extractScene, geomPoses, renderView, lookAt } from '../lib/raster.mjs';
import { CAMERA_PRESETS, parseCameraSpec, parseSize, cameraPoses } from '../lib/camera.mjs';
import { loadScene, MjPlant } from '../lib/plant.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
process.removeAllListeners('warning');

test('PNG: CRC-32 check value, lossless round trip, R/B swap for LeRobot', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
  const rgb = new Uint8Array(4 * 3 * 3).map((_, i) => (i * 37) & 255);
  const back = decodePNG(encodePNG(rgb, 4, 3));
  assert.equal(back.width, 4); assert.equal(back.height, 3);
  assert.deepEqual([...back.rgb], [...rgb]);
  const sw = decodePNG(encodePNG(rgb, 4, 3, { swapRB: true })).rgb;
  assert.deepEqual([sw[0], sw[1], sw[2]], [rgb[2], rgb[1], rgb[0]]);
});

test('ZMTP 3.0 framing: greeting, READY command, short and long message frames', () => {
  const g = greeting();
  assert.equal(g.length, 64);
  assert.deepEqual([g[0], g[9], g[10], g[11]], [0xFF, 0x7F, 3, 0]);
  assert.equal(g.toString('ascii', 12, 16), 'NULL');
  const r = commandFrame('READY', { 'Socket-Type': 'PUB' });
  assert.equal(r[0], 0x04); assert.equal(r[1], r.length - 2);
  assert.equal(r.toString('ascii', 3, 8), 'READY');
  const big = 'x'.repeat(70000);
  const { frames, rest } = parseFrames(Buffer.concat([messageFrame('hi'), messageFrame(big), Buffer.from([0x00, 5, 1])]));
  assert.equal(frames.length, 2); assert.equal(rest.length, 3);
  assert.equal(frames[0].body.toString(), 'hi'); assert.equal(frames[1].flags, 0x02); assert.equal(frames[1].body.length, 70000);
});

test('camera specs and sizes', () => {
  assert.deepEqual(parseCameraSpec('up'), { name: 'up', preset: 'up' });
  assert.deepEqual(parseCameraSpec('top=up'), { name: 'top', preset: 'up' });
  assert.throws(() => parseCameraSpec('nope'), /unknown camera view/);
  assert.throws(() => parseCameraSpec('a b=up'), /letters/);
  assert.deepEqual(parseSize('640x480'), [640, 480]);
  assert.throws(() => parseSize('640'), /WIDTHxHEIGHT/);
  for (const p of Object.values(CAMERA_PRESETS)) assert.ok(p.about);
});

test('software renderer: the arm, the cube and the bowl are in the picture, and the picture follows the arm', async () => {
  const sc = await loadScene();
  const { mj, m, d } = sc, plant = new MjPlant(sc);
  const scene = extractScene(m);
  assert.ok(scene.geoms.length > 20);
  const W = 160, H = 120, rgb = new Uint8Array(W * H * 3), z = new Float32Array(W * H);
  const count = (pred) => { let n = 0; for (let i = 0; i < rgb.length; i += 3) if (pred(rgb[i], rgb[i + 1], rgb[i + 2])) n++; return n; };
  const yellow = (r, g, b) => r > 150 && g > 110 && b < 60, red = (r, g, b) => r > 150 && g < 120 && b < 90;
  const [up] = cameraPoses(mj, m, d, [{ name: 'up', preset: 'up' }]);
  renderView(scene, geomPoses(m, d), up, { width: W, height: H, fovy: up.fovy }, rgb, z);
  const arm0 = count(yellow), cube0 = count(red);
  assert.ok(arm0 > 100, `arm pixels ${arm0}`); assert.ok(cube0 > 3, `cube pixels ${cube0}`);
  const before = rgb.slice();
  // turn shoulder_pan by 0.8 rad and let the physics follow
  for (let i = 0; i < 6; i++) plant.drive(i, plant.home[i]);
  plant.drive(0, 0.8);
  for (let k = 0; k < 400; k++) plant.step(0.004);
  renderView(scene, geomPoses(m, d), up, { width: W, height: H, fovy: up.fovy }, rgb, z);
  let changed = 0; for (let i = 0; i < rgb.length; i++) if (rgb[i] !== before[i]) changed++;
  assert.ok(changed > 300, `changed bytes ${changed}`);
  // the wrist camera rides on the gripper: it sees the jaws (yellow) in the lower part of its image
  const [wrist] = cameraPoses(mj, m, d, [{ name: 'w', preset: 'wrist' }]);
  renderView(scene, geomPoses(m, d), wrist, { width: W, height: H, fovy: wrist.fovy }, rgb, z);
  assert.ok(count(yellow) > 50);
  // lookAt: camera z axis points from the target back to the camera
  const c = lookAt([1, 0, 0], [0, 0, 0]);
  assert.deepEqual([c.mat[2], c.mat[5], c.mat[8]].map((v) => Math.round(v)), [1, 0, 0]);
});

/** Minimal ZMQ SUB client: handshake, subscribe to everything, resolve with the first message. */
function zmqFirstMessage(port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    let buf = Buffer.alloc(0), stage = 0;
    const t = setTimeout(() => { s.destroy(); reject(new Error('no ZMQ message')); }, timeoutMs);
    s.on('connect', () => { const g = greeting(); s.write(g); });
    s.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      if (stage === 0) { if (buf.length < 64) return; buf = buf.subarray(64); s.write(commandFrame('READY', { 'Socket-Type': 'SUB' })); stage = 1; }
      const { frames, rest } = parseFrames(buf); buf = rest;
      for (const f of frames) {
        if (f.flags & 0x04) { if (stage === 1) { s.write(messageFrame(Buffer.from([1]))); stage = 2; } continue; }
        clearTimeout(t); s.destroy(); resolve(f.body.toString()); return;
      }
    });
    s.on('error', reject);
  });
}

test('ZMQ PUB: a subscriber gets messages, a non-subscriber does not block it', async () => {
  const pub = await startZmqPub({ port: 0 });
  const stall = net.connect(pub.port, '127.0.0.1');            // connects and never handshakes
  const got = zmqFirstMessage(pub.port);
  const timer = setInterval(() => pub.send('{"hello":1}'), 20);
  try { assert.equal(await got, '{"hello":1}'); } finally { clearInterval(timer); stall.destroy(); pub.close(); }
});

test('runner with --camera: frames over ZMQ (LeRobot JSON format) and a PNG preview', { timeout: 60000, skip: process.platform === 'win32' && 'needs a pty' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silcam-'));
  const ctl = 20000 + Math.floor(Math.random() * 20000), zp = ctl + 1;
  const child = spawn(process.execPath, [path.join(ROOT, 'tools/sil/so101-virtual.mjs'), '--quiet', '--follower-port', path.join(dir, 'f'),
    '--ctl-port', String(ctl), '--camera', 'up', '--camera', 'grip=wrist', '--camera-port', String(zp), '--camera-size', '320x240', '--camera-fps', '5'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  try {
    for (let i = 0; i < 200 && !out.includes('control:'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /cameras: up \(up\), grip \(wrist\)/);
    const msg = JSON.parse(await zmqFirstMessage(zp));
    assert.deepEqual(Object.keys(msg.images).sort(), ['grip', 'up']);
    assert.ok(Math.abs(msg.timestamps.up - Date.now() / 1000) < 10);
    const img = decodePNG(Buffer.from(msg.images.up, 'base64'));
    assert.equal(img.width, 320); assert.equal(img.height, 240);
    const res = await fetch(`http://127.0.0.1:${ctl}/camera/up.png`);
    assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'image/png');
    const prev = decodePNG(Buffer.from(await res.arrayBuffer()));
    assert.equal(prev.width, 320);
    assert.equal((await fetch(`http://127.0.0.1:${ctl}/camera/nope.png`)).status, 404);
    const st = await (await fetch(`http://127.0.0.1:${ctl}/status`)).json();
    assert.ok(st.cameras.frames >= 1); assert.deepEqual(st.cameras.cameras, ['up=up', 'grip=wrist']);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
