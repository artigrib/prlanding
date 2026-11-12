// Touch quick fixes (touch audit, quick fixes 1–8): handle hit cells, auto-framing at the side edges, drop
// detection, double tap, and the grasp hint that no longer says "close" above the cube's top face.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickHandle, nearestOnPolyline, touchScale, edgeShift, DropWatch, isDoubleTap, TOUCH_MIN, EDGE } from '../src/touch.js';
import { graspHint, GRASP } from '../src/missions.js';
import { heightText } from '../src/sidegeom.js';
import en from '../src/i18n/en.js';

test('handles: nearest centre within its radius wins; nothing outside', () => {
  const R = TOUCH_MIN / 2;
  // ball and down arrow 30 px apart (overlapping 22 px cells): each owns its half
  const at = (y) => pickHandle([{ k: 'move', d: Math.abs(y - 0), r: R }, { k: 'height', d: Math.abs(y - 30), r: R }]);
  assert.equal(at(10), 'move');
  assert.equal(at(20), 'height');
  assert.equal(at(50), 'height', 'the arrow cell reaches 22 px beyond its centre');
  assert.equal(at(53), null);
  assert.equal(pickHandle([]), null);
});

test('touch scale: arrows at least 48 px from the ball centre, capped', () => {
  assert.equal(touchScale(60), 1, 'already far enough: no change');
  assert.equal(touchScale(24), 2);
  assert.equal(touchScale(4), 3, 'looking straight down the arrow: capped');
  assert.equal(touchScale(0), 3);
});

test('ring hit: distance to a projected polyline', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(nearestOnPolyline(sq, 5, -3), 3);
  assert.equal(nearestOnPolyline(sq, 5, 5), 5);
});

test('auto-framing: starts inside the 24 px edge band, pulls back to 60 px, leaves the middle alone', () => {
  const w = 390;
  assert.equal(edgeShift(195, w), 0);
  assert.equal(edgeShift(30, w), 0, 'inside, not active: leave it');
  assert.equal(edgeShift(19, w), 19 - 2.5 * EDGE, 'audit case x = 19 px: pan so it moves right');
  assert.ok(edgeShift(380, w) > 0, 'right edge: pan the other way');
  assert.equal(edgeShift(40, w, true), 40 - 60, 'once started it keeps going to 60 px');
  assert.equal(edgeShift(60, w, true), 0);
  assert.equal(edgeShift(10, 100), 0, 'a view too narrow to frame is left alone');
});

test('drops: held → gone while still closed for 0.3 s; opening is a release, flickers are not drops', () => {
  const d = new DropWatch(0.3);
  assert.equal(d.update('cube', true, 0.05), null);
  assert.equal(d.update(null, true, 0.1), null);
  assert.equal(d.update('cube', true, 0.05), null, 'a short flicker while carrying');
  assert.equal(d.update(null, true, 0.1), null);
  assert.equal(d.update(null, true, 0.1), null);
  assert.equal(d.update(null, true, 0.15), 'cube', 'gone for 0.35 s with the jaws closed');
  assert.equal(d.update(null, true, 0.5), null, 'reported once');
  const r = new DropWatch(0.3);
  r.update('cube', true, 0.05);
  assert.equal(r.update(null, false, 0.5), null, 'opened: a release');
  assert.equal(r.update(null, true, 0.5), null);
});

test('double tap: second tap within 350 ms and 40 px', () => {
  assert.equal(isDoubleTap(null, { t: 0, x: 0, y: 0 }), false);
  assert.equal(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 200, x: 10, y: 10 }), true);
  assert.equal(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 500, x: 0, y: 0 }), false);
  assert.equal(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 100, x: 80, y: 0 }), false);
});

test('grasp hint: "close" only once the jaw tips are below the cube top; the side view agrees', () => {
  const CUBE = [0.25, -0.11, 0.0125], at = (z) => graspHint({ tip: [0.25, -0.11, z], gripOpen: true, touch: true }, CUBE);
  assert.equal(at(0.027), 'Ještě kousek níž – čelisti jsou nad kostkou', 'audit run 1: 27 mm, the grasp failed');
  assert.match(at(0.022), /^Teď sevřete/, 'audit run 2: 22 mm worked');
  assert.match(at(0.0125 + GRASP.top - 0.0005), /^Teď sevřete/);
  assert.equal(heightText(0.027 - 0.0125), '1 cm', 'side view: not "ve výšce" while the hint says lower');
  assert.equal(heightText(0.022 - 0.0125), 've výšce');
  assert.match(graspHint({ tip: [0.25, -0.11, 0.027], gripOpen: false, touch: true }, CUBE), /^Držíte/, 'closed: unchanged');
});

test('every new touch string has an English entry', () => {
  for (const s of ['Ještě kousek níž – čelisti jsou nad kostkou', 'Kostka vypadla – otevřete chapadlo a uchopte ji znovu',
    'Předmět vypadl – otevřete chapadlo a uchopte ho znovu', 'Tahat ruku prstem za díl', 'Zapnuto: prst na ruce ji fyzikálně táhne.',
    'Vypnuto: prst na ruce otáčí pohledem, klepnutí na čelisti otevře nebo zavře chapadlo.']) assert.ok(en.strings[s], s);
});

// ---------------- trackpad scheme (src/ui/touchpad.js) ----------------
import { PAD, padGain, Speed, tableDelta, classify, railSnap, scrubSnap, wrapDeg } from '../src/touch.js';

test('trackpad gain: 0.25 mm/px slow, 1.2 mm/px fast, smooth and monotonic between', () => {
  assert.equal(padGain(0), 0.25);
  assert.equal(padGain(150), 0.25);
  assert.equal(padGain(900), 1.2);
  assert.equal(padGain(5000), 1.2);
  let last = 0;
  for (let v = 0; v <= 1200; v += 10) { const g = padGain(v); assert.ok(g >= last - 1e-12, `monotonic at ${v}`); last = g; }
  assert.ok(Math.abs(padGain(525) - (0.25 + 1.2) / 2) < 1e-9, 'half-way at the midpoint (smoothstep)');
  // precision: the M02 3★ limit (4 mm) is 16 px of slow finger travel
  assert.equal(4 / padGain(100), 16);
});

test('finger speed from event times', () => {
  const s = new Speed(1);   // tiny time constant: the last sample wins
  s.reset(0);
  assert.ok(Math.abs(s.update(10, 10) - 1000) < 1, '10 px in 10 ms = 1000 px/s');
  assert.ok(Math.abs(s.update(1, 20) - 100) < 1);
});

test('finger → table motion is relative to the camera heading, on the table only', () => {
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
  // camera looking along +x: finger up = away (+x), finger right = camera right (−y)
  assert.ok(near(tableDelta(0, -100, 0.25, [1, 0]), [0.025, 0]));
  assert.ok(near(tableDelta(100, 0, 0.25, [1, 0]), [0, -0.025]));
  // camera looking along +y: finger up = +y, right = +x; the heading's length does not matter
  assert.ok(near(tableDelta(0, -40, 1, [0, 5]), [0, 0.04]));
  assert.ok(near(tableDelta(40, 0, 1, [0, 5]), [0.04, 0]));
});

test('gesture classification: tap < 8 px and < 300 ms, drag beyond 8 px', () => {
  assert.equal(classify(3, 120, true), 'tap');
  assert.equal(classify(3, 450, true), 'long');
  assert.equal(classify(9, 50, false), 'drag');
  assert.equal(classify(9, 50, true), 'drag');
  assert.equal(classify(2, 50, false), 'press');
  assert.equal(PAD.tapPx, 8); assert.equal(PAD.tapMs, 300);
});

test('height rail: detents capture ±2 mm, the nearest wins, outside the band the finger rules', () => {
  const det = [0.0105, 0.025];
  assert.deepEqual(railSnap(0.012, det), { z: 0.0105, at: 0 });
  assert.deepEqual(railSnap(0.0235, det), { z: 0.025, at: 1 });
  assert.deepEqual(railSnap(0.018, det), { z: 0.018, at: -1 });
  assert.deepEqual(railSnap(0.05, []), { z: 0.05, at: -1 });
  assert.equal(PAD.rail, 0.4, '0.4 mm per px: 15 cm ≈ 375 px');
});

test('wrist strip: 15° detents, magnet and "lícuje" within 3° of the faces', () => {
  assert.equal(wrapDeg(100, 90), 10); assert.equal(wrapDeg(-80, 90), 10); assert.equal(wrapDeg(45, 90), 45);
  // no selection: detents at multiples of 15° (±1°)
  assert.deepEqual(scrubSnap(30.6, null), { r: 30, mis: null, aligned: false, detent: 2 });
  assert.deepEqual(scrubSnap(37, null), { r: 37, mis: null, aligned: false, detent: null });
  // a cube square at roll 12°: off = raw − 12
  const at = (raw) => scrubSnap(raw, raw - 12, 90);
  assert.equal(at(14).aligned, true); assert.equal(at(14).r, 12);
  assert.equal(at(12 + 90 - 2).r, 12 + 90, 'every face counts (90° symmetry)');
  assert.equal(at(17).aligned, false); assert.equal(at(17).mis, 5);
  assert.equal(at(44.5).r, 45, 'away from the faces the 15° detents still hold');
});
