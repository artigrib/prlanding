// Mobile scene profile (lab transport, src/mobile/scene.js): the SO-101 on a planar cart in the map "Dvě laboratoře",
// compiled with the vendored MuJoCo in node. Also: the plain, object and conveyor scenes have no chassis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadObjectScene, loadScene } from './mj-node.mjs';
import { World } from '../src/world.js';
import { CART, LEKIWI, MAP, wheelSpeeds, wheelPose } from '../src/mobile/scene.js';

const { mj, m, d, xml } = await loadObjectScene('mobile');
const O = mj.mjtObj;
const id = (t, n) => mj.mj_name2id(m, O[t].value, n);
const nameOf = (t, i) => mj.mj_id2name(m, O[t].value, i);
const chassis = id('mjOBJ_BODY', 'chassis');
const ARM = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
const ts = m.opt.timestep;
function reset() { mj.mj_resetDataKeyframe(m, d, 0); mj.mj_forward(m, d); }
function run(sec) { for (let i = 0, n = Math.round(sec / ts); i < n; i++) mj.mj_step(m, d); }
const close = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

test('mobile scene compiles: chassis with 3 planar joints first in qpos, 3 velocity actuators after the arm', () => {
  assert.ok(chassis > 0, 'chassis body');
  assert.equal(new World(mj, m, d).scene, 'mobile');
  assert.equal(m.body_jntnum[chassis], 3);
  const j0 = m.body_jntadr[chassis];
  assert.deepEqual([0, 1, 2].map((k) => nameOf('mjOBJ_JOINT', j0 + k)), ['base_x', 'base_y', 'base_yaw']);
  assert.deepEqual([0, 1, 2].map((k) => m.jnt_type[j0 + k]), [2, 2, 3]);   // slide, slide, hinge
  assert.deepEqual([0, 1, 2].map((k) => m.jnt_qposadr[j0 + k]), [0, 1, 2]);
  // the arm's actuators keep indices 0–5 (ArmSim, controller, export), the base ones come after
  assert.deepEqual(ARM.map((n) => id('mjOBJ_ACTUATOR', n)), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(['base_vx', 'base_vy', 'base_wz'].map((n) => id('mjOBJ_ACTUATOR', n)), [6, 7, 8]);
  // the arm hangs under the chassis at the tray mount
  const base = id('mjOBJ_BODY', 'base');
  assert.equal(m.body_parentid[base], chassis);
  assert.deepEqual(Array.from(m.body_pos.subarray(3 * base, 3 * base + 3)).map((v) => +v.toFixed(5)), CART.arm);
  close(m.body_mass[chassis], CART.mass, 1e-9, 'chassis mass');
  // no table; legacy objects are compiled (ArmSim.ids() needs them)
  assert.equal(id('mjOBJ_GEOM', 'table'), -1);
  for (const n of ['cube', 'cube_b', 'ball', 'bowl', 'bowl2', 'goal']) assert.ok(id('mjOBJ_BODY', n) > 0, n);
});

test('mobile keyframe matches nq / nu and puts the cart in lab A facing the door, the arm at home', () => {
  assert.equal(m.nkey, 1);
  assert.equal(m.key_qpos.length, m.nq * m.nkey);
  assert.equal(m.key_ctrl.length, m.nu * m.nkey);
  const key = /<key name="home"\s+qpos="([^"]*)"\s+ctrl="([^"]*)"/.exec(xml);
  assert.equal(key[1].trim().split(/\s+/).length, m.nq);
  assert.equal(key[2].trim().split(/\s+/).length, m.nu);
  reset();
  assert.deepEqual(Array.from(d.qpos.subarray(0, 3)), MAP.start);
  assert.deepEqual(Array.from(d.qpos.subarray(3, 9)).map((v) => +v.toFixed(3)), [0, -1, 0.6, 1.2, 0, 0.3]);
  assert.deepEqual(Array.from(d.ctrl.subarray(6, 9)), [0, 0, 0]);
});

test('mobile scene at rest: 0 contacts, the cart and the arm hold still', () => {
  reset();
  const q0 = Array.from(d.qpos.subarray(0, 9));
  run(2);
  // no library items (rack vials) in this scene yet: every contact would be a modelling error
  const pairs = [];
  for (let c = 0; c < d.ncon; c++) { const k = d.contact.get(c); pairs.push(nameOf('mjOBJ_GEOM', k.geom1) + '/' + nameOf('mjOBJ_GEOM', k.geom2)); }
  assert.deepEqual(pairs, []);
  for (let i = 0; i < 3; i++) close(d.qpos[i], q0[i], 1e-4, 'chassis q' + i);
  for (let i = 3; i < 9; i++) close(d.qpos[i], q0[i], 0.01, 'arm q' + i);
  // the parked legacy objects float off the map
  for (const n of ['cube', 'cube_b', 'ball']) { const b = id('mjOBJ_BODY', n); assert.ok(d.xpos[3 * b] > 19 && Math.abs(d.xpos[3 * b + 2] - 0.1) < 1e-3, n); }
});

test('cart geometry: tray at 0.76 m, rack and crate inside the 45 × 35 cm footprint, shell clear of the floor', () => {
  reset();
  const tray = id('mjOBJ_GEOM', 'cart_tray');
  close(m.geom_pos[3 * tray + 2] + m.geom_size[3 * tray + 2], CART.tray, 1e-9, 'tray top');
  const shell = id('mjOBJ_GEOM', 'cart_shell');
  close(m.geom_pos[3 * shell + 2] - m.geom_size[3 * shell + 2], CART.shell[0], 1e-9, 'shell bottom');
  let n = 0;
  for (let g = 0; g < m.ngeom; g++) {
    if (m.geom_bodyid[g] !== chassis) continue;
    n++;
    const p = m.geom_pos.subarray(3 * g, 3 * g + 3), s = m.geom_size.subarray(3 * g, 3 * g + 3), nm = nameOf('mjOBJ_GEOM', g);
    assert.ok(Math.abs(p[0]) + s[0] <= CART.hx + 1e-9 && Math.abs(p[1]) + s[1] <= CART.hy + 1e-9, nm + ' outside the footprint');
    if (/^cart_(rack|crate)/.test(nm)) assert.ok(p[2] - s[2] >= CART.tray - 1e-9, nm + ' below the tray');
  }
  assert.equal(n, 2 + 13 + 5, 'shell, tray, 13 rack boxes, 5 crate boxes');
});

test('map "Dvě laboratoře": bench tops at 0.76 m, 0.8 m door under a 2.0 m lintel, cart fits through', () => {
  for (const b of MAP.benches) {
    const g = id('mjOBJ_GEOM', b.id);
    close(m.geom_pos[3 * g + 2] + m.geom_size[3 * g + 2], 0.76, 1e-9, b.id + ' top');
  }
  const s = id('mjOBJ_GEOM', 'wall_mid_s'), n = id('mjOBJ_GEOM', 'wall_mid_n'), l = id('mjOBJ_GEOM', 'door_lintel');
  const door = (m.geom_pos[3 * n + 1] - m.geom_size[3 * n + 1]) - (m.geom_pos[3 * s + 1] + m.geom_size[3 * s + 1]);
  close(door, MAP.door, 1e-9, 'door width');
  close(m.geom_pos[3 * l + 2] - m.geom_size[3 * l + 2], MAP.lintel, 1e-9, 'lintel');
  assert.ok(door > 2 * CART.hy, 'cart is narrower than the door');
});

test('velocity actuators move the chassis (world frame), ctrl 0 brakes it', () => {
  reset();
  d.ctrl[6] = 0.2; d.ctrl[8] = 0.5;
  run(1);
  const x1 = d.qpos[0], yaw1 = d.qpos[2];
  assert.ok(Math.abs(d.qvel[0] - 0.2) < 0.01 && Math.abs(d.qvel[2] - 0.5) < 0.02, `tracks: ${d.qvel[0]} ${d.qvel[2]}`);
  d.ctrl[6] = 0; d.ctrl[8] = 0;
  run(0.5);
  assert.ok(Math.abs(d.qvel[0]) < 1e-3 && Math.abs(d.qvel[2]) < 1e-3, 'braked');
  assert.ok(x1 - MAP.start[0] > 0.17 && yaw1 > 0.4, `moved ${x1} ${yaw1}`);
  for (let i = 0; i < m.nq; i++) assert.ok(Number.isFinite(d.qpos[i]));
});

test('wheel speeds: port of the LeRobot LeKiwi matrix (wheel_radius 0.05, base_radius 0.125, angles [240,0,120] − 90°)', () => {
  // forward 0.2 m/s: left wheel rolls along 150°, back along −90°, right along 30°
  const f = wheelSpeeds(0.2, 0, 0);
  close(f[0], Math.cos(150 * Math.PI / 180) * 0.2 / 0.05, 1e-12, 'left'); close(f[1], 0, 1e-12, 'back'); close(f[2], -f[0], 1e-12, 'right');
  // strafe left: the back wheel alone takes the sideways speed at full ratio
  close(wheelSpeeds(0, 0.1, 0)[1], -0.1 / 0.05, 1e-12, 'strafe back wheel');
  // spin: every wheel at base_radius · ω / wheel_radius
  for (const v of wheelSpeeds(0, 0, 1)) close(v, 0.125 / 0.05, 1e-12, 'spin');
  // wheel k sits at its rolling angle − 90° on the base circle: the back wheel behind the centre, axles radial
  const back = wheelPose(1);
  close(back.pos[0], -LEKIWI.baseRadius, 1e-12, 'back wheel x'); close(back.pos[1], 0, 1e-12, 'back wheel y');
  for (let k = 0; k < 3; k++) {
    const { pos, axle } = wheelPose(k), a = LEKIWI.angles[k] * Math.PI / 180;
    close(axle[0] * Math.cos(a) + axle[1] * Math.sin(a), 0, 1e-12, 'axle ⟂ rolling direction');
    assert.ok(Math.hypot(pos[0], pos[1]) + LEKIWI.wheel.width / 2 < CART.hy + 0.01, 'wheel under the cart');
  }
});

test('plain, object and conveyor scenes have no chassis (the cart exists only in the mobile profile)', async () => {
  const plain = await loadScene();
  assert.equal(plain.mj.mj_name2id(plain.m, plain.mj.mjtObj.mjOBJ_BODY.value, 'chassis'), -1);
  assert.notEqual(new World(plain.mj, plain.m, plain.d).scene, 'mobile');
  for (const p of ['objects', 'conveyor']) {
    const s = await loadObjectScene(p);
    assert.equal(s.mj.mj_name2id(s.m, s.mj.mjtObj.mjOBJ_BODY.value, 'chassis'), -1, p);
    assert.equal(s.mj.mj_name2id(s.m, s.mj.mjtObj.mjOBJ_ACTUATOR.value, 'base_vx'), -1, p);
    assert.equal(new World(s.mj, s.m, s.d).scene, p);
    assert.ok(!/so101_mobile/.test(s.xml), p + ' includes the plain arm');
  }
});
