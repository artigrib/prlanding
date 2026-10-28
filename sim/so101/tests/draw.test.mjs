// Drawing mission assists (src/draw.js) with real physics: plane mode, magnet, finger trace → planner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScene } from './mj-node.mjs';
import { ArmController } from '../src/controller.js';
import { World } from '../src/world.js';
import { MissionRunner, TRACE } from '../src/missions.js';
import { DrawAssist, PEN, closestOnTemplate } from '../src/draw.js';

const { mj, m, d } = await loadScene();
const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper']
  .map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
const world = new World(mj, m, d), ctl = new ArmController(mj, m, d, act), runner = new MissionRunner(world);
const ts = m.opt.timestep;
function reset() { mj.mj_resetDataKeyframe(m, d, 0); runner.select('trace'); runner.setup(); mj.mj_forward(m, d); ctl.cancel(); ctl.syncFromCtrl(); runner.start(); }
function run(sec, each) {
  const n = Math.round(sec / ts);
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) { if (each) each(ts * 4); ctl.update(ts * 4); ctl.actualTip(runner.ctx.tip); runner.ctx.gripOpen = false; }
    mj.mj_step(m, d);
    if (i % 4 === 0) runner.tick(ts * 4);
  }
}
// a wobbly hand-drawn star (±3 mm noise), sampled every ~4 mm
function handStar(seed = 3) {
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
  const out = [], C = TRACE.corners;
  for (let i = 1; i < C.length; i++) {
    const [ax, ay] = C[i - 1], [bx, by] = C[i], n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 0.004));
    for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n + rnd() * 0.006, ay + (by - ay) * k / n + rnd() * 0.006]);
  }
  out.push(C[C.length - 1].slice());
  return out;
}

test('magnet off = raw input; on = pulled toward the line, never pushed away', () => {
  const da = new DrawAssist(), c = [0, 0];
  da.help = 0;
  const g = da.point(0.2, 0.031);
  assert.equal(g[0], 0.2); assert.equal(g[1], 0.031);
  for (const lvl of [1, 2]) {
    da.help = lvl;
    for (const [x, y] of handStar(lvl)) {
      const d0 = closestOnTemplate(x, y, c), p = da.point(x, y), d1 = closestOnTemplate(p[0], p[1], c);
      assert.ok(d1 <= d0 + 1e-9, 'magnet never increases the deviation');
    }
  }
  da.penDown = false; da.help = 2;
  const q = da.point(0.2, 0.031);
  assert.equal(q[1], 0.031, 'pen up: no magnet');
});

test('paper-plane mode: the tip stays at drawing height while the pointer moves', () => {
  reset();
  const da = new DrawAssist(); da.help = 1;
  const pts = handStar(7);
  // lower the pen at the first point first
  da.reset(pts[0][0], pts[0][1]); da.penDown = false; da.point(pts[0][0], pts[0][1]);
  ctl.begin();
  run(1.5, (dt) => { const t = da.step(dt); ctl.setTarget(t[0], t[1], t[2]); });
  da.penDown = true; da.point(pts[0][0], pts[0][1]);
  run(1.0, (dt) => { const t = da.step(dt); ctl.setTarget(t[0], t[1], t[2]); });
  let k = 0, f = 0, zmin = 1, zmax = 0;
  const tip = new Float64Array(3);
  run(22, (dt) => {
    if (k < pts.length && f++ % 4 === 0) { da.point(pts[k][0], pts[k][1]); k += 1; }   // ~4 mm per 64 ms ≈ 6 cm/s hand
    const t = da.step(dt); ctl.setTarget(t[0], t[1], t[2]);
    ctl.actualTip(tip); zmin = Math.min(zmin, tip[2]); zmax = Math.max(zmax, tip[2]);
  });
  assert.ok(zmax - PEN.down < 0.006 && PEN.down - zmin < 0.006, `tip height within ±6 mm of the paper (${zmin.toFixed(4)}…${zmax.toFixed(4)})`);
  assert.ok(runner.won, 'hand-drawn star with magnet completes the mission (' + runner.last.text + ')');
  console.log('  plane mode: won in', runner.result.time.toFixed(1), 's, stars', runner.result.stars, 'prec', (runner.result.prec * 1000).toFixed(1), 'mm');
});

test('finger trace → planner path completes the mission', () => {
  reset();
  const plan = ctl.planPath(handStar(11).map(([x, y]) => [x, y, 0.009]), { grip: false, speed: 0.06 });
  assert.ok(plan.ok);
  ctl.run(plan);
  run(30);
  assert.ok(runner.won, runner.last.text);
});
