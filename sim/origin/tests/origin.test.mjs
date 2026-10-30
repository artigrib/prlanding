// ROBOTO ORIGIN sim: model/policy contract and a headless walk in node (vendored MuJoCo WASM + onnxruntime-web).
// node --test sim/origin/tests/origin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/policy.js';
import { loadModel, loadPolicy } from './origin-node.mjs';

const { mj, m, d } = await loadModel();
const id = (t, n) => mj.mj_name2id(m, mj.mjtObj[t].value, n);

test('vendored model has the 23 policy joints in MJCF/actuator order', () => {
  assert.equal(m.nu, 23);
  assert.equal(m.nq, 7 + 23);
  P.JOINTS.forEach((n, i) => {
    assert.equal(id('mjOBJ_ACTUATOR', n), i, n);
    assert.equal(m.jnt_qposadr[id('mjOBJ_JOINT', n)], 7 + i, n);
    assert.equal(m.actuator_ctrlrange[2 * i + 1], P.TAU_LIMIT);
  });
  assert.ok(Math.abs(m.opt.timestep - 0.002) < 1e-12, 'scene.xml timestep override');
  assert.ok(Math.abs(m.body_subtreemass[1] - 33.76) < 0.05, 'mass from rpo.xml ≈ 33.76 kg');
  assert.ok(id('mjOBJ_SENSOR', 'orientation') >= 0 && id('mjOBJ_SENSOR', 'angular-velocity') >= 0);
});

test('USD2URDF is a permutation and observation frame matches sim2sim layout', () => {
  assert.deepEqual([...P.USD2URDF].sort((a, b) => a - b), [...Array(23).keys()]);
  const q = P.DEFAULT_Q.map((v, j) => v + j * 0.01), dq = P.DEFAULT_Q.map((_, j) => -j);
  const act = Float32Array.from({ length: 23 }, (_, i) => i / 100);
  const o = P.obsFrame({ gyro: [0.1, 0.2, 0.3], quat: [1, 0, 0, 0], q, dq, act }, { vx: 0.5, vy: 0, yaw: -0.2 });
  assert.equal(o.length, 78);
  assert.deepEqual([...o.slice(3, 6)], [0, 0, -1]);
  assert.ok(Math.abs(o[6] - 0.5) < 1e-7 && Math.abs(o[8] + 0.2) < 1e-7);
  for (let i = 0; i < 23; i++) {
    const j = P.USD2URDF[i];
    assert.ok(Math.abs(o[9 + i] - j * 0.01) < 1e-6);
    assert.equal(o[32 + i], -j);
    assert.ok(Math.abs(o[55 + i] - i / 100) < 1e-7);
  }
  // 90° roll: gravity seen in the body frame moves to -y... (scipy r.apply(inverse=True) convention)
  const s = Math.SQRT1_2, g = P.quatRotateInverse([s, s, 0, 0], [0, 0, -1]);
  assert.ok(Math.abs(g[0]) < 1e-9 && Math.abs(g[1] + 1) < 1e-9 && Math.abs(g[2]) < 1e-9, String(g));
  const st = new P.ObsStack(); const f1 = new Float32Array(78).fill(1), f2 = new Float32Array(78).fill(2);
  st.push(f1); const b = st.push(f2);
  assert.equal(b[0], 1); assert.equal(b[78 * 9], 2); assert.equal(b.length, 780);
  const t = P.actionToTargets(new Float32Array(23).fill(1));
  P.USD2URDF.forEach((j) => assert.ok(Math.abs(t[j] - P.DEFAULT_Q[j] - 0.25) < 1e-12));
  assert.deepEqual(P.clampCmd({ vx: 9, vy: -9, yaw: 0.1 }), { vx: 0.6, vy: -0.4, yaw: 0.1 });
});

const pol = await loadPolicy();

test('onnxruntime-web output matches native onnxruntime (zero observation)', async () => {
  const a = await pol.run(new Float32Array(780));
  assert.equal(a.length, 23);
  // python3 onnxruntime 1.29: policy.onnx on zeros -> first four actions
  [-0.11717597, 0.12817226, 0.00226703, 0.18086354].forEach((v, i) => assert.ok(Math.abs(a[i] - v) < 1e-5, `${i}: ${a[i]}`));
});

async function walk(cmd, sec) {
  mj.mj_resetData(m, d);
  d.qpos[2] = 0.75; d.qpos[3] = 1;
  for (let j = 0; j < 23; j++) d.qpos[7 + j] = P.DEFAULT_Q[j];
  mj.mj_forward(m, d);
  const sQ = m.sensor_adr[id('mjOBJ_SENSOR', 'orientation')], sG = m.sensor_adr[id('mjOBJ_SENSOR', 'angular-velocity')];
  const st = new P.ObsStack(), act = new Float32Array(23), tgt = Float64Array.from(P.DEFAULT_Q);
  let minZ = 1;
  for (let k = 0; k < Math.round(sec / P.POLICY_DT); k++) {
    const sd = d.sensordata, q = [], dq = [];
    for (let j = 0; j < 23; j++) { q.push(d.qpos[7 + j]); dq.push(d.qvel[6 + j]); }
    const obs = st.push(P.obsFrame({ gyro: [sd[sG], sd[sG + 1], sd[sG + 2]], quat: [sd[sQ], sd[sQ + 1], sd[sQ + 2], sd[sQ + 3]], q, dq, act }, P.clampCmd(cmd)));
    act.set(await pol.run(obs));
    P.actionToTargets(act, tgt);
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 23; j++) d.ctrl[j] = P.pdTorque(j, tgt[j], d.qpos[7 + j], d.qvel[6 + j]);
      mj.mj_step(m, d);
    }
    minZ = Math.min(minZ, d.qpos[2]);
  }
  return { x: d.qpos[0], y: d.qpos[1], z: d.qpos[2], minZ };
}

test('policy walks forward at 0.5 m/s and stands at zero command (node, 2 ms physics)', async () => {
  const w = await walk({ vx: 0.5, vy: 0, yaw: 0 }, 4);
  assert.ok(w.x > 1.3 && w.minZ > 0.6, JSON.stringify(w));
  const s = await walk({ vx: 0, vy: 0, yaw: 0 }, 3);
  assert.ok(Math.hypot(s.x, s.y) < 0.3 && s.minZ > 0.6, JSON.stringify(s));
});
