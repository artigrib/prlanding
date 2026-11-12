// The Teach recorder (src/ui/teach.js sample()) samples on a fixed 30 fps grid of simulated time, whatever the display
// rate: frames of 60 / 120 / 144 Hz, jittered frame times and throttled (clamped 50 ms) frames, driven like the page
// (sim/so101/core.js step(): a frame's dt goes into an accumulator that runs whole 4 ms physics steps, then the
// recorder samples once). No MuJoCo needed: the stand-in only has to advance d.time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Teach, RECORDER } from '../src/ui/teach.js';
import { parseDemo } from '../src/export/lerobot.js';
import { actionLag, alignActions, OLD_ACTION_LAG } from '../src/policy/episodes.js';

const TS = 0.004, FPS = 30;

/** Record `sec` seconds with frame times from frameDt(i); returns the recorded timestamps. */
function record(sec, frameDt) {
  const d = { time: 0, qpos: new Float64Array(6), qvel: new Float64Array(6), ctrl: new Float64Array(6), act: null,
    mocap_pos: new Float64Array(3), mocap_quat: new Float64Array(4) };
  const ux = { mj: {}, app: { d, m: {}, act: [0, 1, 2, 3, 4, 5], stopDemo() {} }, runner: { m: { id: 'bowl' }, ctx: { s: {} } } };
  const teach = new Teach(ux);
  teach.persist = () => {};                       // no localStorage in node
  // a recording usually starts at some arbitrary physics time, not on a grid line
  d.time = 1.2345;
  teach.startRec();
  let acc = 0, steps = 0;
  for (let i = 0; d.time - teach.demo.t0 < sec; i++) {
    let dt = frameDt(i);
    if (dt > 1 / 20) dt = 1 / 20;                 // core.js loop(): a slow frame is clamped
    acc += dt;
    while (acc >= TS) { steps++; d.time = 1.2345 + steps * TS; acc -= TS; }   // whole physics steps (float time as MuJoCo's)
    for (let k = 0; k < 6; k++) d.qpos[k] = Math.sin(d.time + k);
    teach.sample();
  }
  const D = teach.demo;
  return { t: D.t.slice(), recorder: D.recorder, n: D.obs.length };
}

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function check(name, { t }, sec, maxFrame) {
  const n = t.length, rate = (n - 1) / (t[n - 1] - t[0]);
  // the effective rate over the whole recording: 30 fps ± 1 %
  assert.ok(Math.abs(rate - FPS) < 0.3, `${name}: ${rate.toFixed(3)} fps`);
  assert.ok(Math.abs(n - sec * FPS) <= 2, `${name}: ${n} samples in ${sec} s`);
  // every sample in its own grid slot, never ahead of it, and no further behind than one frame (+ one physics step)
  const slots = t.map((x) => Math.floor(x * FPS + 1e-6));
  for (let i = 1; i < n; i++) assert.ok(slots[i] > slots[i - 1], `${name}: two samples in slot ${slots[i]}`);
  for (let i = 0; i < n; i++) {
    const late = t[i] - slots[i] / FPS;
    assert.ok(late >= -1e-6 && late < maxFrame + TS + 1e-9, `${name}: sample ${i} is ${(late * 1000).toFixed(2)} ms after its grid line`);
  }
  // intervals average 1/30 s; none longer than a slot plus a frame
  const gaps = t.slice(1).map((x, i) => x - t[i]);
  assert.ok(Math.max(...gaps) < 1 / FPS + maxFrame + TS + 1e-9, `${name}: gap ${Math.max(...gaps)}`);
}

test('recorder grid: 30 fps at 60, 120 and 144 Hz frames', () => {
  for (const hz of [60, 120, 144]) {
    const r = record(20, () => 1 / hz);
    check(`${hz} Hz`, r, 20, 1 / hz);
    assert.equal(r.recorder, RECORDER);
  }
});

test('recorder grid: 30 fps under jittered frame times (60 Hz ± 40 %, 144 Hz with dropped frames)', () => {
  const a = rng(7), b = rng(11);
  check('60 Hz jitter', record(20, () => (1 / 60) * (0.6 + 0.8 * a())), 20, (1 / 60) * 1.4);
  // 144 Hz with every ~10th frame dropped (one or two refreshes late)
  check('144 Hz drops', record(20, () => (b() < 0.1 ? (2 + Math.floor(b() * 2)) : 1) / 144), 20, 3 / 144);
});

test('recorder grid: throttled frames (longer than a slot) record once per frame and keep the grid', () => {
  // 50 ms frames (core.js clamps longer ones to 1/20 s): a slot is skipped every third frame, never two samples in one
  const r = record(10, () => 0.05), n = r.t.length;
  assert.ok(Math.abs(n - 10 / 0.05) <= 2, `${n} samples (one per 50 ms frame)`);
  const slots = r.t.map((x) => Math.floor(x * FPS + 1e-6));
  for (let i = 1; i < n; i++) assert.ok(slots[i] > slots[i - 1]);
  // back to 60 Hz: 30 fps again right away
  let i0 = 0;
  const mixed = record(12, (i) => { if (i < 60) return 0.05; if (!i0) i0 = i; return 1 / 60; });
  const tail = mixed.t.filter((x) => x > 4), rate = (tail.length - 1) / (tail.at(-1) - tail[0]);
  assert.ok(Math.abs(rate - FPS) < 0.3, `after throttling: ${rate} fps`);
});

test('recorder grid: the old rule (a sample 1/30 s after the previous one) gave ~20.8 fps at 16 ms frames', () => {
  // documents what recorder 1 did, for the record in the demo JSON (printedrobotics.recorder)
  let next = 0, n = 0;
  for (let t = 0; t < 10; t += 0.016) if (t >= next - 1e-9) { next = t + 1 / FPS; n++; }
  assert.ok(Math.abs(n / 10 - 20.8) < 0.2, `${n / 10} fps`);
  const r = record(10, () => 0.016);
  assert.ok(Math.abs((r.t.length - 1) / (r.t.at(-1) - r.t[0]) - FPS) < 0.3);
});

// ---------------------------------------------------------------- recorder 3: observe, then command ----------------
/**
 * A page-like loop that changes the command every frame (pre, before physics) and logs the command every 4 ms physics
 * step ran on. Returns the demo and the log [{ t: step start (recording time), c: ctrl[0], f: frame }].
 */
function recordCommands(sec, frameDt, stop = true) {
  const d = { time: 0, qpos: new Float64Array(6), qvel: new Float64Array(6), ctrl: new Float64Array(6), act: null,
    mocap_pos: new Float64Array(3), mocap_quat: new Float64Array(4) };
  const ux = { mj: {}, app: { d, m: {}, act: [0, 1, 2, 3, 4, 5], stopDemo() {} }, runner: { m: { id: 'bowl' }, ctx: { s: {} } } };
  const teach = new Teach(ux);
  teach.persist = () => {};
  const T0 = 0.7531;
  d.time = T0;
  teach.startRec();
  const log = [];
  let acc = 0, steps = 0;
  for (let i = 0; d.time - T0 < sec; i++) {
    for (let k = 0; k < 6; k++) d.ctrl[k] = i + k / 10;          // pre(): this frame's command, a new one every frame
    acc += frameDt(i);
    while (acc >= TS) { log.push({ t: steps * TS, c: d.ctrl[0], f: i }); steps++; d.time = T0 + steps * TS; acc -= TS; }
    for (let k = 0; k < 6; k++) d.qpos[k] = Math.cos(d.time + k);
    teach.sample();
  }
  if (stop) teach.stopRec();
  return { teach, D: teach.demo, log, d };
}

test('recorder 3: action[t] is the command in force over [t, t + Δ), Δ = until the next frame that ran physics', () => {
  assert.equal(RECORDER, 3);
  // 60 Hz, 144 Hz, 500 Hz (2 ms frames: every other frame runs no physics step), jittered 60 Hz
  const r = rng(5);
  for (const [name, fdt] of [['60 Hz', () => 1 / 60], ['144 Hz', () => 1 / 144], ['500 Hz', () => 1 / 500], ['jitter', () => (1 / 60) * (0.6 + 0.8 * r())]]) {
    const { D, log } = recordCommands(5, fdt);
    const n = D.t.length;
    assert.ok(n > 140, `${name}: ${n} samples`);
    assert.equal(D.pend, null, `${name}: nothing left pending after stop`);
    for (let i = 0; i < n - 1; i++) {
      const t = D.t[i];
      // every physics step that starts in [t, next frame's end) ran on act[i]; at least the first one exists
      const over = log.filter((s) => s.t >= t - 1e-9 && s.t < t + 1e-9 + TS);
      assert.ok(over.length >= 1, `${name}: a step starts at sample ${i}`);
      assert.equal(D.act[i][0], over[0].c, `${name}: sample ${i} at ${t.toFixed(4)} s`);
      assert.equal(D.act[i][3], over[0].c + 0.3);
      const frame = log.filter((s) => s.f === over[0].f);          // [t, t + Δ): every step of that frame
      assert.ok(frame[0].t >= t - 1e-9 && frame.every((s) => s.c === D.act[i][0]));
      // and it is not the command of the frame that ended at t (recorder 2's action)
      const before = log.filter((s) => s.t < t - 1e-9).at(-1);   // none for a sample at the very start
      if (before) assert.notEqual(D.act[i][0], before.c, `${name}: sample ${i} is not the previous frame's command`);
      // the observation is the state at t, read before that command acted
      assert.equal(D.obs[i][0], Math.cos(t + 0.7531));
    }
  }
});

test('recorder 3: the last sample keeps the command in force when the recording stops; sample count unchanged', () => {
  const { teach, D, d } = recordCommands(2, () => 1 / 60, false);
  const n = D.t.length, i = D.pend;
  assert.equal(i, n - 1, 'the last sample waits for its command');
  d.ctrl[0] = 123.5;                                 // e.g. the controller's next command already written
  teach.stopRec();
  assert.equal(D.act[n - 1][0], 123.5);
  assert.equal(D.t.length, n);
  assert.ok(Math.abs(n - 2 * FPS) <= 2, 'still one sample per 30 fps slot');
});

test('older recorders: actions read one 60 Hz frame later (replay and export), recorder 3 as stored', () => {
  assert.equal(actionLag(3), 0);
  for (const r of [1, 2, undefined, null, '3', 2.5]) assert.equal(actionLag(r), OLD_ACTION_LAG);
  assert.equal(OLD_ACTION_LAG, 1 / 60);
  const T = [0, 1 / 30, 2 / 30, 3 / 30], A = T.map((t) => [t * 30, 0, 0, 0, 0, 100 - t]);
  assert.deepEqual(alignActions(T, A, 0), A);
  const B = alignActions(T, A, 1 / 60);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(B[i][0] - (i + 0.5)) < 1e-12, `row ${i}: halfway to the next sample`);
  assert.deepEqual(B[3], A[3], 'clamped at the end');
  // the exporter applies it by printedrobotics.recorder
  const demo = (rec) => ({ fps: 30, printedrobotics: { mission: 'bowl', ...(rec ? { recorder: rec } : {}) }, episodes: [{ frames: T.map((t, i) => ({ frame_index: i, timestamp: t, 'observation.state': A[i], action: A[i] })) }] });
  assert.deepEqual(parseDemo(demo(3)).action, A);
  for (const rec of [null, 1, 2]) assert.deepEqual(parseDemo(demo(rec)).action, B);
  // a recorder 3 recording read as recorder 2 would be shifted: replay of the recorder 2 meaning (Teach.pre)
  const { teach, D } = recordCommands(1, () => 1 / 60);
  D.recorder = 2;
  const c = new Float64Array(6);
  teach.app = { act: [0, 1, 2, 3, 4, 5] }; teach.d = { time: 0, ctrl: c }; teach.replaying = true; teach.rt0 = 0; teach.k = 0; teach.ka = 0;
  teach.belt = () => null;
  teach.d.time = D.t[3]; teach.pre();
  const want = alignActions(D.t, D.act, 1 / 60)[3][0];
  assert.ok(Math.abs(c[0] - want) < 1e-9, `${c[0]} vs ${want}`);
  D.recorder = 3; teach.k = 0; teach.ka = 0; teach.pre();
  assert.equal(c[0], D.act[3][0]);
});
