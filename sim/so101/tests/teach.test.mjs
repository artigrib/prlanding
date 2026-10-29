// Teach & replay (src/ui/teach.js) with real MuJoCo physics in node: looping must restart from the snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScene } from './mj-node.mjs';
import { ArmController } from '../src/controller.js';
import { Teach } from '../src/ui/teach.js';

const { mj, m, d } = await loadScene();
const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper']
  .map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
const ctl = new ArmController(mj, m, d, act);
const mission = { id: 'bowl', n: '01', title: 'Přeneste kostku do misky' };
// minimal UX stand-in; beginReplayReset resets to the keyframe like app.reset() does
const ux = {
  mj, ctl, app: { d, m, act, stopDemo() {} }, runner: { m: mission, ctx: { s: {} } },
  beginReplayReset() { mj.mj_resetDataKeyframe(m, d, 0); mj.mj_forward(m, d); }
};
const teach = new Teach(ux);
const ts = m.opt.timestep;
const step = (sec) => { for (let i = 0, n = Math.round(sec / ts); i < n; i++) { teach.pre(); mj.mj_step(m, d); teach.sample(); } };

test('loop replay restarts from the recorded snapshot (time, pose, progress)', () => {
  // move away from the keyframe first, so the snapshot differs from it
  for (let i = 0; i < 6; i++) d.ctrl[act[i]] = [0.4, -0.6, 0.5, 1.0, 0.3, 1.0][i];
  step(1.5);
  teach.startRec();
  const snapTime = d.time, snapQ = Array.from(d.qpos.subarray(0, 6));
  for (let i = 0; i < 6; i++) d.ctrl[act[i]] = [-0.3, -0.2, 0.2, 1.2, -0.4, 0.2][i];
  step(2);
  teach.stopRec();
  assert.ok(teach.demo && teach.demo.t.length > 50);
  teach.loop = true;
  assert.ok(teach.startReplay());
  assert.ok(Math.abs(d.time - snapTime) < 1e-9, 'replay starts at the snapshot time');
  let minP = 1, restarts = 0, prevP = 0;
  for (let k = 0; k < 900; k++) {          // 3.6 s: past the end (2 s + 0.6 s) → one loop restart
    step(ts);
    const p = teach.progress();
    minP = Math.min(minP, p);
    if (p < prevP - 0.5) {
      restarts++;
      for (let i = 0; i < 6; i++) assert.ok(Math.abs(d.qpos[i] - snapQ[i]) < 0.02, 'pose after restart ' + i);
    }
    prevP = p;
  }
  assert.ok(teach.replaying, 'still replaying (loop)');
  assert.equal(restarts, 1, 'looped once');
  assert.ok(minP >= 0, 'progress never negative (' + minP + ')');
});

test('trim removes the idle start/end; JSON export → import round-trips the actions', () => {
  teach.stopReplay(); teach.loop = false;
  mj.mj_resetDataKeyframe(m, d, 0); mj.mj_forward(m, d);
  teach.startRec();
  step(1);                                                     // idle
  for (let i = 0; i < 6; i++) d.ctrl[act[i]] = [0.3, -0.5, 0.4, 1.0, 0.2, 1.0][i];
  for (let k = 0; k < 30; k++) { d.ctrl[act[0]] = 0.3 + k * 0.01; step(1 / 30); }   // moving
  step(1.5);                                                   // idle again
  teach.stopRec();
  const n0 = teach.demo.t.length, removed = teach.trim();
  assert.ok(removed > 40, 'removed ' + removed + ' of ' + n0);
  assert.equal(teach.demo.t[0], 0, 'trimmed demo starts at t = 0');
  const j = JSON.parse(JSON.stringify(teach.toJSON()));
  const a0 = teach.demo.act.map((a) => a.slice());
  ux.runner.m = { id: 'bowl', n: '01', title: 'x' };
  const n = teach.importJSON(j);
  assert.equal(n, a0.length);
  for (let i = 0; i < n; i += 7) for (let k = 0; k < 6; k++) assert.ok(Math.abs(teach.demo.act[i][k] - a0[i][k]) < 0.002, `frame ${i} joint ${k}`);
  assert.ok(teach.demo.snap && teach.demo.snap.qpos.length === d.qpos.length, 'snapshot imported');
  assert.throws(() => teach.importJSON({ hello: 1 }));
});

test('share link: #ukazka= hash round-trips the demonstration', async () => {
  globalThis.location = { origin: 'https://printedrobotics.cz', pathname: '/sim/so101/', hash: '' };
  const a0 = teach.demo.act.map((a) => a.slice()), n0 = teach.demo.t.length;
  const url = await teach.shareURL();
  assert.ok(url.startsWith('https://printedrobotics.cz/sim/so101/#ukazka='), url.slice(0, 60));
  assert.ok(url.length < 60000, 'link length ' + url.length);
  teach.demo = null;
  globalThis.location.hash = url.slice(url.indexOf('#'));
  const n = await teach.loadFromHash();
  assert.equal(n, n0);
  for (let i = 0; i < n; i += 9) for (let k = 0; k < 6; k++) assert.ok(Math.abs(teach.demo.act[i][k] - a0[i][k]) < 2e-4);
  console.log('  share link length', url.length, 'chars for', n, 'frames');
});

// ---------- malformed input (shared link, imported file, localStorage) ----------
async function hashOf(obj) {
  const gz = await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  let bin = ''; const u8 = new Uint8Array(gz); for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return '#ukazka=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function goodPayload() {
  const n = 10, row = [0, -1, 0.6, 1.2, 0, 0.3];
  const s = { qpos: Array.from(d.qpos), qvel: Array.from(d.qvel), ctrl: Array.from(d.ctrl), act: d.act && d.act.length ? Array.from(d.act) : null,
    mpos: Array.from(d.mocap_pos), mquat: Array.from(d.mocap_quat), time: 0 };
  return { v: 1, m: 'bowl', t: Array.from({ length: n }, (_, i) => i / 30), a: Array.from({ length: n }, () => row.slice()), o: Array.from({ length: n }, () => row.slice()), s };
}
const cases = {
  'qvel null': (p) => { p.s.qvel = null; },
  'qvel longer than the model': (p) => { p.s.qvel.push(0, 0, 0); },
  'qpos with a string': (p) => { p.s.qpos[3] = 'x'; },
  'qpos with NaN (null)': (p) => { p.s.qpos[2] = null; },
  'mquat missing': (p) => { delete p.s.mquat; },
  'action row too short': (p) => { p.a[4] = [0, 1, 2]; },
  'action row with strings': (p) => { p.a[2] = ['a', 'b', 'c', 'd', 'e', 'f']; },
  'observation row not an array': (p) => { p.o[1] = 'hello'; },
  't not monotonic': (p) => { p.t[5] = 0.01; },
  't with Infinity (null)': (p) => { p.t[3] = null; },
  'frame counts differ': (p) => { p.a.pop(); },
  'unknown mission': (p) => { p.m = 'nope'; }
};

test('shared link: every malformed payload is rejected without throwing; a valid one loads', async () => {
  globalThis.location = { origin: 'https://x', pathname: '/sim/so101/', search: '', hash: '' };
  for (const [name, spoil] of Object.entries(cases)) {
    const p = goodPayload(); spoil(p);
    globalThis.location.hash = await hashOf(p);
    teach.demo = null;
    const n = await teach.loadFromHash();
    assert.equal(n, 0, name);
    assert.equal(teach.demo, null, name + ': nothing loaded');
  }
  globalThis.location.hash = '#ukazka=' + 'A'.repeat(500001);
  assert.equal(await teach.loadFromHash(), 0, 'oversized hash');
  // gzip bomb: 6 MB of spaces compresses to a few kB
  globalThis.location.hash = await hashOf({ pad: ' '.repeat(6 * 1024 * 1024) });
  assert.equal(await teach.loadFromHash(), 0, 'decompressed size cap');
  globalThis.location.hash = await hashOf(goodPayload());
  assert.equal(await teach.loadFromHash(), 10, 'valid payload');
  assert.ok(teach.startReplay(), 'valid payload replays');
  teach.stopReplay();
});

test('imported JSON: partial / malformed snapshot or frames are rejected', () => {
  const good = () => JSON.parse(JSON.stringify(teach.toJSON()));
  const spoils = {
    'partial snapshot (qvel null)': (j) => { j.printedrobotics.snapshot.qvel = null; },
    'snapshot qpos too short': (j) => { j.printedrobotics.snapshot.qpos.length = 3; },
    'frame with short action': (j) => { j.episodes[0].frames[2].action = [1, 2]; },
    'timestamp not a number': (j) => { j.episodes[0].frames[3].timestamp = 'soon'; },
    'timestamps going back': (j) => { j.episodes[0].frames[4].timestamp = -1; }
  };
  for (const [name, spoil] of Object.entries(spoils)) {
    const j = good(); spoil(j);
    assert.throws(() => teach.importJSON(j), name);
  }
  assert.ok(teach.importJSON(good()) >= 5, 'valid file imports');
});

test('a corrupted demonstration in memory does not throw from startReplay', () => {
  teach.demo.snap.qvel = null;                     // e.g. a future bug elsewhere
  ux.panel = { toast() { this.msg = arguments[0]; } };
  assert.doesNotThrow(() => assert.equal(teach.startReplay(), false));
  assert.equal(teach.demo, null);
  assert.ok(/poškozená/.test(ux.panel.msg));
});
