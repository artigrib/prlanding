// Unit tests for src/kin.js:  node --test sim/so101/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScene } from './mj-node.mjs';
import { Kin, chainFromModel } from '../src/kin.js';

const { mj, m, d } = await loadScene();
const kin = new Kin(chainFromModel(mj, m));
const site = mj.mj_name2id(m, mj.mjtObj.mjOBJ_SITE.value, 'gripperframe');

// deterministic PRNG
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test('FK matches MuJoCo (site position and orientation)', () => {
  for (let n = 0; n < 50; n++) {
    const q = kin.lo.map((lo, i) => lo + (kin.hi[i] - lo) * rnd());
    for (let i = 0; i < 6; i++) d.qpos[i] = q[i];
    mj.mj_kinematics(m, d);
    const p = kin.fk(q);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(p[k] - d.site_xpos[3 * site + k]) < 1e-9, 'pos ' + k);
    for (let k = 0; k < 9; k++) assert.ok(Math.abs(kin.siteMat[k] - d.site_xmat[9 * site + k]) < 1e-9, 'mat ' + k);
  }
});

const home = [0, -1.0, 0.6, 1.2, 0, 0.3];
const targets = [
  [0.25, -0.11, 0.0125], [0.20, 0.15, 0.06], [0.18, 0.0, 0.08], [0.28, 0.05, 0.03],
  [0.12, -0.18, 0.02], [0.30, 0.0, 0.15], [0.18, 0.20, 0.03], [0.22, -0.05, 0.20]
];

test('IK reaches sample targets within 2 mm, pointing down when possible', () => {
  for (const t of targets) {
    const q = Float64Array.from(home);
    const r = kin.solveAuto(q, t, Math.PI / 2);
    assert.ok(r.err < 0.002, `target ${t} err ${(r.err * 1000).toFixed(2)} mm`);
    assert.ok(r.reachable);
    for (let i = 0; i < 6; i++) assert.ok(q[i] >= kin.lo[i] - 1e-12 && q[i] <= kin.hi[i] + 1e-12, 'limit ' + i);
  }
  // near cube: gripper must point (almost) straight down
  const q = Float64Array.from(home);
  kin.solve(q, [0.25, -0.11, 0.0125], Math.PI / 2);
  const a = kin.approach([0, 0, 0]);
  assert.ok(a[2] < -0.95, 'approach z ' + a[2]);
});

test('IK respects joint limits and reports unreachable targets', () => {
  for (const t of [[0.8, 0, 0.1], [0.0, 0.0, 0.6], [-0.4, 0.3, 0.0]]) {
    const q = Float64Array.from(home);
    const r = kin.solveAuto(q, t, Math.PI / 2);
    assert.equal(r.reachable, false, 'should be unreachable: ' + t);
    for (let i = 0; i < 6; i++) assert.ok(q[i] >= kin.lo[i] - 1e-12 && q[i] <= kin.hi[i] + 1e-12, 'limit ' + i);
    assert.ok(q.every(Number.isFinite));
  }
});

test('IK is continuous: small target moves give small joint moves', () => {
  const q = Float64Array.from(home);
  kin.solve(q, [0.2, 0, 0.05], Math.PI / 2);
  const prev = Float64Array.from(q);
  for (let k = 1; k <= 40; k++) {
    kin.solve(q, [0.2 + k * 0.001, k * 0.001, 0.05], Math.PI / 2, { iters: 8 });
    let mx = 0; for (let i = 0; i < 4; i++) mx = Math.max(mx, Math.abs(q[i] - prev[i]));
    assert.ok(mx < 0.08, 'jump ' + mx);
    prev.set(q);
  }
});
