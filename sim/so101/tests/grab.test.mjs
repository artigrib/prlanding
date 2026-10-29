// Physics grab (src/grab.js) in MuJoCo: pulling moves the chain, release holds, flicks stay stable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScene } from './mj-node.mjs';
import { Grab } from '../src/grab.js';

const { mj, m, d } = await loadScene();
const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper']
  .map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
const grab = new Grab(mj, m, d, act);
const ts = m.opt.timestep, gripper = mj.mj_name2id(m, mj.mjtObj.mjOBJ_BODY.value, 'gripper');
const site = mj.mj_name2id(m, mj.mjtObj.mjOBJ_SITE.value, 'gripperframe');
const q6 = () => grab.qadr.map((a) => d.qpos[a]);
// like the page: grab.apply once per 60 Hz frame, 4 physics steps per frame
function frames(n, each) { for (let f = 0; f < n; f++) { if (each) each(f); grab.apply(1 / 60); for (let k = 0; k < 4; k++) mj.mj_step(m, d); } }
function settle() { mj.mj_resetDataKeyframe(m, d, 0); mj.mj_forward(m, d); frames(60); }

test('pulling the gripper tip moves several joints toward the cursor', () => {
  settle();
  const q0 = q6(), s = Array.from(d.site_xpos.subarray(3 * site, 3 * site + 3));
  grab.start(gripper, s[0], s[1], s[2]);
  const T = [s[0] + 0.06, s[1] + 0.08, s[2] - 0.06];
  frames(90, () => grab.setTarget(...T));       // 1.5 s
  const p = grab.point([0, 0, 0]), err = Math.hypot(p[0] - T[0], p[1] - T[1], p[2] - T[2]);
  const moved = q6().map((v, i) => Math.abs(v - q0[i]));
  assert.ok(moved.filter((x) => x > 0.05).length >= 3, 'joints moved: ' + moved.map((x) => x.toFixed(2)));
  assert.ok(err < 0.03, 'grab point reaches near the cursor: ' + err.toFixed(3));
  grab.release();
});

test('release: the arm holds the new pose for 2 s (no snap-back, no sag)', () => {
  settle();
  const s = Array.from(d.site_xpos.subarray(3 * site, 3 * site + 3));
  grab.start(gripper, s[0], s[1], s[2]);
  frames(90, () => grab.setTarget(s[0] + 0.05, s[1] - 0.06, s[2] - 0.05));
  grab.release();
  frames(12);                                  // blend
  const q1 = q6();
  frames(120);                                 // 2 s
  const drift = q6().map((v, i) => Math.abs(v - q1[i]));
  assert.ok(Math.max(...drift.slice(0, 5)) < 0.02, 'drift ' + drift.map((x) => x.toFixed(3)));
  assert.ok(grab.blend >= 1);
});

test('fast flicks stay stable: no NaN, bounded joint speeds, limits respected', () => {
  settle();
  const s = Array.from(d.site_xpos.subarray(3 * site, 3 * site + 3));
  grab.start(gripper, s[0], s[1], s[2]);
  let vmax = 0;
  frames(120, (f) => {
    const a = f % 6 < 3 ? 1 : -1;                // 1 m jumps every 50 ms
    grab.setTarget(s[0] + 0.5 * a, s[1] - 0.6 * a, s[2] + 0.4 * a);
    for (let i = 0; i < 6; i++) vmax = Math.max(vmax, Math.abs(d.qvel[grab.dadr[i]]));
  });
  assert.ok(d.qpos.every(Number.isFinite) && d.qvel.every(Number.isFinite), 'finite state');
  assert.ok(vmax < 40, 'max joint speed ' + vmax.toFixed(1) + ' rad/s');
  assert.ok(grab.force <= 12 + 1e-9);
  for (let i = 0; i < 6; i++) { const q = d.qpos[grab.qadr[i]]; assert.ok(q > grab.lo[i] - 0.05 && q < grab.hi[i] + 0.05, 'limit ' + i); }
  grab.release();
});
