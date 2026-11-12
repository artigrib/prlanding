// Driving the cart (lab transport campaign PR 2): src/mobile/base.js (speed levels, LeRobot clamp, ramp, world
// mapping), src/mobile/keys.js (keymap by mode vs the arm shortcuts in src/ux.js), src/mobile/camera.js (damping),
// the front camera in the scene, the EN strings, and a MuJoCo run: 1 m forward through the same command path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEED_LEVELS, RAMP, LEROBOT, bodyToWheelRaw, degpsToRaw, clampBody, topSpeeds, ramp, toWorld, BaseDrive, CARRY_POSE, DRIVE_ACTIONS } from '../src/mobile/base.js';
import { keyAction, keyRelease, driveKeySet, DRIVE_KEYS, GLOBAL_KEYS, LEVEL_KEYS } from '../src/mobile/keys.js';
import { smoothDamp, angDiff, SMOOTH_T, VIEW_ORDER, VIEW_LABEL } from '../src/mobile/camera.js';
import { FRONT_CAM, CART } from '../src/mobile/scene.js';
import { STRINGS } from '../src/mobile/drive.js';
import { loadObjectScene } from './mj-node.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const close = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b} (±${eps})`);

test('speed levels and ramp are the sourced numbers (LeRobot speed_levels, design §3.1)', () => {
  assert.deepEqual(SPEED_LEVELS, [{ xy: 0.1, theta: 30 }, { xy: 0.2, theta: 60 }, { xy: 0.3, theta: 90 }]);
  assert.deepEqual(RAMP, { lin: 3, ang: 6 });
  assert.equal(LEROBOT.maxRaw, 3000);
  close(LEROBOT.stepsPerDeg, 4096 / 360, 1e-12, 'steps per degree');
});

// Printed by LeRobot's own LeKiwi._body_to_wheel_raw (lekiwi.py @ e6ffde60, numpy, Python round()) for these
// inputs: [x m/s, y m/s, theta deg/s] → [left, back, right] raw ticks/s.
const LEROBOT_RAW = [
  [[0.1, 0, 0], [-1129, 0, 1129]], [[0.2, 0, 0], [-2258, 0, 2258]], [[0.3, 0, 0], [-3000, 0, 3000]],
  [[0, 0.3, 0], [1500, -3000, 1500]], [[0, 0, 90], [2560, 2560, 2560]], [[0, 0, 30], [853, 853, 853]],
  [[0.3, 0.3, 90], [428, -513, 3000]], [[-0.2, 0.1, -60], [1090, -2726, -3000]], [[0.1, -0.2, 30], [-1369, 3000, 588]],
  [[1, 0, 0], [-3000, 0, 3000]], [[0, -1, 0], [-1500, 3000, -1500]], [[0, 0, 200], [3000, 3000, 3000]],
  [[0.05, 0.02, 5], [-292, -119, 837]]
];

test('bodyToWheelRaw equals LeRobot _body_to_wheel_raw (matrix, proportional clamp at 3000, rounding)', () => {
  for (const [[x, y, th], want] of LEROBOT_RAW) assert.deepEqual(bodyToWheelRaw(x, y, th), want, JSON.stringify([x, y, th]));
  // Python round(): halves go to even; _degps_to_raw clamps to ±0x7FFF
  assert.equal(degpsToRaw(2.5 / LEROBOT.stepsPerDeg), 2);
  assert.equal(degpsToRaw(3.5 / LEROBOT.stepsPerDeg), 4);
  assert.equal(degpsToRaw(1e6), 0x7FFF);
  assert.equal(degpsToRaw(-1e6), -0x7FFF);
});

test('clampBody keeps the direction and gives the top speeds of design §1.2 (0.266 / 0.230 m/s, 105 °/s)', () => {
  const top = topSpeeds();
  close(top.rim, 0.2301, 1e-4, 'rim speed');
  close(top.forward, 0.2657, 1e-4, 'forward');
  close(top.strafe, 0.2301, 1e-4, 'strafe');
  close(top.spinDeg, 105.47, 0.01, 'spin');
  // level 3 forward (0.3 m/s) is clamped like the real driver; levels 1–2 and all turn rates pass
  close(clampBody(0.3, 0, 0).u, top.forward, 1e-9, 'level 3 forward');
  assert.equal(clampBody(0.2, 0, 0).scale, 1);
  assert.equal(clampBody(0, 0, 90 * Math.PI / 180).scale, 1);
  // the clamped body command maps back onto LeRobot's clamped wheel ticks (within rounding)
  for (const [[x, y, th], want] of LEROBOT_RAW) {
    const c = clampBody(x, y, th * Math.PI / 180), raw = bodyToWheelRaw(c.u, c.v, c.w * 180 / Math.PI, Infinity);
    raw.forEach((r, k) => close(r, want[k], 1, 'wheel ' + k + ' of ' + JSON.stringify([x, y, th])));
    // direction kept: the scale is the same on every axis
    if (Math.hypot(x, y)) close(Math.atan2(c.v, c.u), Math.atan2(y, x), 1e-12, 'heading');
  }
});

test('ramp: at most 3 m/s² (|Δ(u, v)|) and 6 rad/s², exact arrival', () => {
  const ts = 0.004, cur = { u: 0, v: 0, w: 0 }, tgt = { u: 0.2, v: 0.1, w: 1 };
  let prev = { ...cur }, n = 0;
  while ((cur.u !== tgt.u || cur.v !== tgt.v || cur.w !== tgt.w) && n < 1000) {
    ramp(cur, tgt, ts); n++;
    assert.ok(Math.hypot(cur.u - prev.u, cur.v - prev.v) <= RAMP.lin * ts + 1e-12, 'linear step');
    assert.ok(Math.abs(cur.w - prev.w) <= RAMP.ang * ts + 1e-12, 'angular step');
    prev = { ...cur };
  }
  // 0.2236 m/s at 3 m/s² → 74.5 ms (19 steps); 1 rad/s at 6 rad/s² → 166.7 ms (42 steps)
  assert.equal(n, 42);
  assert.deepEqual(cur, tgt);
});

test('toWorld: body → world frame by the heading', () => {
  const r = (a) => a.map((v) => +v.toFixed(12));
  assert.deepEqual(r(toWorld(0.2, 0, 0.5, 0)), [0.2, 0, 0.5]);
  assert.deepEqual(r(toWorld(0.2, 0, 0, Math.PI / 2)), [0, 0.2, 0]);
  assert.deepEqual(r(toWorld(0, 0.1, 0, Math.PI / 2)), [-0.1, 0, 0]);
  assert.deepEqual(r(toWorld(0.1, 0.1, 0, Math.PI)), [-0.1, -0.1, 0]);
});

test('BaseDrive: keys sum like LeRobot, Space brakes, the command ramps and stays inside the clamp', () => {
  const d = new BaseDrive();
  assert.equal(d.level, 0);                       // LeRobot starts slow
  d.setLevel(1); d.press('forward'); d.press('back');
  d.step(0.004, 0); assert.deepEqual(d.target, { u: 0, v: 0, w: 0 });   // forward + back cancel
  d.release('back'); d.press('turnLeft');
  for (let i = 0; i < 200; i++) d.step(0.004, 0);
  // forward 0.2 m/s while turning 60 °/s needs 0.304 m/s at the right wheel's rim: LeRobot scales both down
  const k = clampBody(0.2, 0, 60 * Math.PI / 180).scale;
  close(k, 0.2301 / (0.2 * Math.cos(Math.PI / 6) + 0.125 * Math.PI / 3), 1e-4, 'scale');
  close(d.cmd.u, 0.2 * k, 1e-12, 'u'); close(d.cmd.w, 60 * Math.PI / 180 * k, 1e-12, 'w');
  d.setLevel(2); d.release('turnLeft'); d.press('left');
  for (let i = 0; i < 200; i++) {
    d.step(0.004, 0);
    const raw = bodyToWheelRaw(d.cmd.u, d.cmd.v, d.cmd.w * 180 / Math.PI, Infinity);
    assert.ok(Math.max(...raw.map(Math.abs)) <= LEROBOT.maxRaw + 1, 'inside the clamp');
  }
  assert.ok(d.scale < 1, 'forward + left at 0.3 m/s is clamped');
  d.brake();
  let t = 0; while (d.moving() && t < 1) { d.step(0.004, 0); t += 0.004; }
  close(t, Math.hypot(0.3, 0.3) * clampBody(0.3, 0.3, 0).scale / 3, 0.0081, 'brake time at 3 m/s²');
  d.press('forward'); assert.equal(d.braked, false);
  assert.deepEqual(DRIVE_ACTIONS.sort(), ['back', 'forward', 'left', 'right', 'turnLeft', 'turnRight']);
  assert.deepEqual(CARRY_POSE, [0, -1.74, -1.69, 0, 0, 0]);   // design §4.4
});

// ux.js keys(): the arm / sim shortcuts by e.key (lower-cased), plus the digits it reads by e.code
function armKeys() {
  const src = fs.readFileSync(path.join(DIR, 'src/ux.js'), 'utf8');
  const body = src.slice(src.indexOf('  keys() {'), src.indexOf('// ================= test hooks'));
  const map = new Map();
  for (const line of body.split('\n')) {
    const cases = [...line.matchAll(/case '((?:\\'|[^'])+)':/g)].map((m) => m[1]);
    if (!cases.length) continue;
    const what = line.slice(line.lastIndexOf(':') + 1).trim();
    for (const c of cases) map.set(c.length === 1 ? c.toLowerCase() : c.toLowerCase(), what);
  }
  for (const k of ['1', '2', '3', '4', '5', '6']) map.set(k, 'links.select (joint)');
  return map;
}

test('keymap: J, W, Z are free in ux.js; Ruka mode takes none of the arm keys; global keys mean the same', () => {
  const arm = armKeys();
  assert.ok(arm.size > 20, 'parsed ux.js keys() (' + arm.size + ')');
  for (const k of ['j', 'w', 'z']) assert.ok(!arm.has(k), k + ' is free in ux.js');
  // the keys ux.js gives the arm / sim and Jízda shadows: exactly these (design §3.1 table)
  const shadow = [...driveKeySet()].filter((k) => arm.has(k) && !(k in GLOBAL_KEYS)).sort();
  assert.deepEqual(shadow, [' ', '1', '2', '3', 'a', 'arrowdown', 'arrowleft', 'arrowright', 'arrowup', 'd', 'e', 'q', 's', 'x'].sort());
  // Ruka: nothing but the global keys is taken, so every arm shortcut reaches the arm
  for (const k of arm.keys()) {
    const key = k.length === 1 ? k : k.replace(/^arrow(\w)/, (m, c) => 'Arrow' + c.toUpperCase());
    const a = keyAction(key, /^[0-9]$/.test(k) ? 'Digit' + k : '', 'arm');
    if (k in GLOBAL_KEYS) continue;
    assert.equal(a, null, 'Ruka mode leaves ' + JSON.stringify(k) + ' to the arm');
  }
  // global keys: J is free, C and R mean in ux.js what they mean here
  assert.ok(/cycleView/.test(arm.get('c')), 'C = camera in ux.js');
  assert.ok(/reset/.test(arm.get('r')), 'R = reset in ux.js');
  assert.deepEqual(GLOBAL_KEYS, { j: 'mode', c: 'view', r: 'reset' });
  // Jízda: no key has two drive meanings, and LeRobot's own keys are there (w/s/a/d, z/x)
  const lerobot = { w: 'forward', s: 'back', a: 'left', d: 'right', z: 'turnLeft', x: 'turnRight' };
  for (const [k, v] of Object.entries(lerobot)) assert.equal(DRIVE_KEYS[k], v, k);
  const drv = Object.keys(DRIVE_KEYS);
  for (const k of [...Object.keys(LEVEL_KEYS), ' ', ...Object.keys(GLOBAL_KEYS)]) assert.ok(!drv.includes(k), k + ' is not also a drive key');
});

test('keyAction / keyRelease by mode (upper case, arrows, Czech-layout digits by e.code)', () => {
  assert.deepEqual(keyAction('W', 'KeyW', 'drive'), { type: 'drive', action: 'forward' });
  assert.deepEqual(keyAction('ArrowLeft', 'ArrowLeft', 'drive'), { type: 'drive', action: 'left' });
  assert.deepEqual(keyAction('ě', 'Digit2', 'drive'), { type: 'level', level: 1 });
  assert.deepEqual(keyAction('3', '', 'drive'), { type: 'level', level: 2 });
  assert.equal(keyAction('4', 'Digit4', 'drive'), null);
  assert.deepEqual(keyAction(' ', 'Space', 'drive'), { type: 'brake' });
  assert.deepEqual(keyAction('j', 'KeyJ', 'arm'), { type: 'mode' });
  assert.deepEqual(keyAction('J', 'KeyJ', 'drive'), { type: 'mode' });
  assert.deepEqual(keyAction('c', 'KeyC', 'arm'), { type: 'view' });
  assert.equal(keyAction('w', 'KeyW', 'arm'), null);
  assert.equal(keyAction(' ', 'Space', 'arm'), null);
  assert.equal(keyRelease('W'), 'forward');
  assert.equal(keyRelease('j'), null);
});

test('camera damping: critically damped (no overshoot), settles in about the smooth time, wraps angles', () => {
  assert.equal(SMOOTH_T, 0.25);
  const s = { x: 0, v: 0 }; let max = 0, t95 = null;
  for (let i = 1; i <= 120; i++) {
    smoothDamp(s, 1, SMOOTH_T, 1 / 60); max = Math.max(max, s.x);
    if (t95 == null && s.x >= 0.95) t95 = i / 60;
  }
  assert.ok(max <= 1 + 1e-12, 'no overshoot ' + max);
  assert.ok(t95 > 0.2 && t95 < 0.7, '95 % after ' + t95 + ' s');
  // large frame steps stay stable
  const b = { x: 0, v: 0 }; for (let i = 0; i < 10; i++) smoothDamp(b, 1, SMOOTH_T, 0.5);
  assert.ok(Math.abs(b.x - 1) < 1e-3 && b.x <= 1);
  close(angDiff(3, -3), 2 * Math.PI - 6, 1e-12, 'wrap');
  close(angDiff(-3, 3), 6 - 2 * Math.PI, 1e-12, 'wrap back');
  assert.deepEqual(VIEW_ORDER, ['chase', 'top', 'front']);
  assert.deepEqual(Object.values(VIEW_LABEL), ['Za vozíkem', 'Shora', 'Kamera vozíku']);
});

test('every Czech string of the driving UI has an English entry', async () => {
  const en = (await import('../src/i18n/en.js')).default.strings;
  for (const s of [...STRINGS, ...Object.values(VIEW_LABEL), 'Ruka']) assert.ok(s in en, 'EN for ' + JSON.stringify(s));
});

// ---------------------------------------------------------------- MuJoCo: the command path on the compiled scene
const { mj, m, d } = await loadObjectScene('mobile');
const O = mj.mjtObj;
const act = ['base_vx', 'base_vy', 'base_wz'].map((n) => mj.mj_name2id(m, O.mjOBJ_ACTUATOR.value, n));
const ts = m.opt.timestep;
function drive(dr, sec, sample) {
  for (let i = 0, n = Math.round(sec / ts); i < n; i++) {
    const w = dr.step(ts, d.qpos[2]);
    d.ctrl[act[0]] = w[0]; d.ctrl[act[1]] = w[1]; d.ctrl[act[2]] = w[2];
    mj.mj_step(m, d);
    if (sample) sample();
  }
}
function reset() { mj.mj_resetDataKeyframe(m, d, 0); CARRY_POSE.forEach((q, i) => { d.ctrl[i] = q; }); mj.mj_forward(m, d); }

test('front camera: XLeRobot head position, fovy 61, tilted so the picture starts at the cart front; wrist_cam keeps id 0', () => {
  assert.equal(mj.mj_name2id(m, O.mjOBJ_CAMERA.value, 'wrist_cam'), 0);
  const f = mj.mj_name2id(m, O.mjOBJ_CAMERA.value, 'front_cam');
  assert.equal(f, 1);
  close(m.cam_fovy[f], 61, 1e-9, 'fovy');
  assert.deepEqual(FRONT_CAM.pos, [-0.075, 0, 1.125]);
  close(FRONT_CAM.tilt, 20.08, 0.01, 'tilt (deg)');
  reset();
  const p = Array.from(d.cam_xpos.subarray(3 * f, 3 * f + 3)), M = d.cam_xmat.subarray(9 * f, 9 * f + 9);
  close(p[0], -1.25 - 0.075, 1e-9, 'x'); close(p[2], 1.125, 1e-9, 'z');
  // viewing direction −z of the camera: forward and down by the tilt; the lower picture edge hits the tray front
  const fwd = [-M[2], -M[5], -M[8]], down = Math.asin(-fwd[2]) * 180 / Math.PI;
  close(down, FRONT_CAM.tilt, 1e-3, 'looks down by the tilt');
  close(Math.atan2(p[2] - CART.tray, CART.hx - FRONT_CAM.pos[0]) * 180 / Math.PI, down + 30.5, 1e-3, 'lower edge at the cart front');
});

test('MuJoCo: level 2, 5 s forward, release → 1.00 m (±2 cm), no drift, accel ≤ 3 m/s² + tracking', () => {
  reset();
  drive(new BaseDrive(), 1.5);   // the arm folds into the carry pose first
  const x0 = d.qpos[0], y0 = d.qpos[1];
  const dr = new BaseDrive(); dr.setLevel(1); dr.press('forward');
  let vPrev = 0, aMax = 0, vMax = 0;
  const sample = () => { const v = d.qvel[0]; aMax = Math.max(aMax, Math.abs(v - vPrev) / ts); vPrev = v; vMax = Math.max(vMax, v); };
  drive(dr, 5, sample);
  dr.release('forward');
  drive(dr, 1.5, sample);
  close(d.qpos[0] - x0, 1.0, 0.02, 'distance');
  close(d.qpos[1] - y0, 0, 0.002, 'lateral drift');
  close(d.qpos[2], 0, 0.2 * Math.PI / 180, 'yaw drift');
  close(vMax, 0.2, 0.2 * 0.05, 'top speed within 5 % of the level');
  assert.ok(Math.abs(d.qvel[0]) < 1e-3, 'stopped');
  assert.ok(aMax < 3 * 1.5, 'measured acceleration ' + aMax.toFixed(2) + ' m/s²');
});

test('MuJoCo: level 3 forward tops out at the LeRobot clamp (0.266 m/s); spin level 3 = 90 °/s; heading-relative', () => {
  reset();
  const dr = new BaseDrive(); dr.setLevel(2); dr.press('forward');
  drive(dr, 2);
  close(d.qvel[0], topSpeeds().forward, topSpeeds().forward * 0.03, 'clamped forward speed');
  dr.release('forward'); dr.press('turnLeft');
  drive(dr, 2);
  close(d.qvel[2] * 180 / Math.PI, 90, 90 * 0.03, 'spin');
  // after turning, "forward" follows the heading
  dr.release('turnLeft'); drive(dr, 0.5);
  const yaw = d.qpos[2]; dr.press('forward'); drive(dr, 1);
  close(Math.atan2(d.qvel[1], d.qvel[0]), yaw, 0.02, 'moves along the heading');
});
