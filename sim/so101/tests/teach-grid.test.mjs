// The Teach recorder (src/ui/teach.js sample()) samples on a fixed 30 fps grid of simulated time, whatever the display
// rate: frames of 60 / 120 / 144 Hz, jittered frame times and throttled (clamped 50 ms) frames, driven like the page
// (sim/so101/core.js step(): a frame's dt goes into an accumulator that runs whole 4 ms physics steps, then the
// recorder samples once). No MuJoCo needed: the stand-in only has to advance d.time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Teach, RECORDER } from '../src/ui/teach.js';

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
