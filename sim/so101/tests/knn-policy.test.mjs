// Tier (a) policy of mission 12 (src/policy/knn.js, src/policy/run.js): behaviour cloning of the player's decisions
// (bin, commit point on the belt, grasp height) by k-nearest neighbours within a class, executed by the tracking
// planner. Pure parts on synthetic episodes (recording-shaped: timestamps, env frames, per-item cuts); the executor
// with real MuJoCo physics on the mission's verification batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadObjectScene } from './mj-node.mjs';
import { ArmController } from '../src/controller.js';
import { World } from '../src/world.js';
import { MISSIONS, MissionRunner, TEACH, teachStars } from '../src/missions.js';
import { WASTE } from '../src/objects/wastebatch.js';
import { BELT_PICK } from '../src/objects/beltpick.js';
import { BELT, CONVEYOR_ITEMS, FRACTION_BIN } from '../src/objects/scene.js';
import { ENV_CLASSES } from '../src/policy/episodes.js';
import { KNN, USED, relYaw, obsOf, examplesFromDemo, train, decide, coverage, report, dist } from '../src/policy/knn.js';
import { knnSolve, KNN_LABEL } from '../src/policy/run.js';

const FR = Object.fromEntries(CONVEYOR_ITEMS.map((it) => [it.name, it.fraction]));
const st = (item, x, y, z, yaw) => ({ item, class: FR[item], pos: [x, y, z], yaw });

/**
 * A recording-shaped demo: per item a stretch of frames where it rides the belt as env.target (or as env.next behind
 * another item), then the jaws hold it (grasp frame), then it is released. Frames are not evenly spaced (30 fps with
 * dropped frames), so times must come from the timestamps. items: [{ item, bin, outcome, x, yGrasp, yaw, dz, before }]
 * (before: an item that is env.target before the grasp, the way the most-downstream rule reports it).
 */
function demoOf(items) {
  const D = { t: [], obs: [], env: [], segments: [] };
  let t = 0;
  const push = (e, tipZ) => { D.t.push(+t.toFixed(4)); D.obs.push([0, 0, 0, 0, 0, tipZ]); D.env.push(e); t += D.t.length % 7 ? 1 / 30 : 2 / 30; };
  for (const it of items) {
    const from = D.t.length;
    for (let k = 0; k < 6; k++) {
      const me = st(it.item, it.x, it.yGrasp - 0.02 + 0.003 * k, 0.03, it.yaw);
      push(it.before ? { belt: 0.02, target: st(it.before, 0.24, 0.2, 0.03, 0), next: me } : { belt: 0.02, target: me, next: null }, 0.2);
    }
    const grasp = D.t.length, held = st(it.item, it.x, it.yGrasp, 0.04, it.yaw);
    for (let k = 0; k < 6; k++) push({ belt: 0.02, target: held, next: null }, held.pos[2] + it.dz);
    const release = D.t.length - 1;
    for (let k = 0; k < 4; k++) push({ belt: 0.02, target: null, next: null }, 0.2);
    D.segments.push({ item: it.item, class: FR[it.item], outcome: it.outcome || 'sorted', bin: it.bin === undefined ? FRACTION_BIN[FR[it.item]] : it.bin,
      from, to: D.t.length - 1, grasp: it.outcome === 'missed' ? null : grasp, release: it.outcome === 'missed' ? null : release });
  }
  return D;
}
const tipOf = (q) => [0, 0, q[5]];   // the synthetic joint row carries the tip height in its last slot

test('constants: k = 3, label, the commit window is the planner\'s, the classes are the fractions', () => {
  assert.equal(KNN.k, 3);
  assert.equal(KNN_LABEL, 'Naučené pravidlo (kNN) + plánovač');
  assert.equal(KNN.yMin, BELT_PICK.yMin);
  assert.ok(KNN.yMax <= BELT_PICK.yMax - 0.009, 'a learned commit point the planner can still reach');
  assert.equal(KNN.latScale, BELT.hw);
  assert.deepEqual(USED, ['sorted', 'wrong']);
  const m = MISSIONS.find((x) => x.id === 'waste_teach');
  assert.equal(m.n, '12'); assert.equal(m.scene, 'conveyor'); assert.ok(m.teach && m.belt);
  assert.notEqual(TEACH.seed, WASTE.seed, 'the policy is verified on another batch than the demos');
});

test('observation: yaw mod π relative to the belt, lateral offset from the belt axis', () => {
  assert.equal(relYaw(Math.PI / 2), 0);
  assert.equal(relYaw(Math.PI / 2 + Math.PI), 0, 'an item turned by π looks the same');
  assert.ok(Math.abs(relYaw(0) - Math.PI / 2) < 1e-4);
  assert.ok(Math.abs(relYaw(-0.1 + Math.PI / 2) - (Math.PI - 0.1)) < 1e-4, 'mod π stays in [0, π)');
  const o = obsOf(st('vial_glass1', 0.26, 0, 0.03, Math.PI / 2 + 0.2), 0.02);
  assert.deepEqual(o, { class: 'glass', yaw: 0.2, lat: 0.02, belt: 0.02 });
  // the yaw distance wraps: 0.05 and π − 0.05 are 0.1 apart
  const a = { yaw: 0.05, lat: 0, belt: 0.02 }, b = { yaw: Math.PI - 0.05, lat: 0, belt: 0.02 };
  assert.ok(Math.abs(dist(a, b) - 0.1 / KNN.yawScale) < 1e-9);
});

test('examples: the observation of the episode\'s own item at its grasp frame, times from the timestamps', () => {
  const D = demoOf([
    { item: 'cup_paper1', x: 0.25, yGrasp: -0.10, yaw: 2.0, dz: -0.004 },
    // before its grasp, env.target is another (more downstream) item: the socket is only in env.next
    { item: 'socket_s1', x: 0.23, yGrasp: 0.05, yaw: 1.0, dz: -0.006, before: 'vial_glass1' },
    { item: 'fork_plastic1', x: 0.24, yGrasp: 0.0, yaw: 1.6, dz: 0, outcome: 'missed', bin: null },
    { item: 'vial_glass2', x: 0.24, yGrasp: 0.3, yaw: 0.4, dz: 0.09, outcome: 'wrong', bin: 'bin_metal' }
  ]);
  const ex = examplesFromDemo(D, { tipOf });
  assert.deepEqual(ex.map((e) => [e.item, e.use]), [['cup_paper1', true], ['socket_s1', true], ['fork_plastic1', false], ['vial_glass2', true]]);
  const sock = ex[1];
  assert.equal(sock.class, 'metal');
  assert.deepEqual(sock.obs, obsOf(st('socket_s1', 0.23, 0.05, 0.04, 1.0), 0.02), 'not the vial that was env.target before the grasp');
  assert.equal(sock.y, 0.05); assert.equal(sock.dz, -0.006); assert.equal(sock.bin, 'bin_metal');
  const seg = D.segments[1];
  assert.equal(sock.t, D.t[seg.from], 'episode start in seconds of the recording');
  assert.ok(Math.abs(sock.tg - (D.t[seg.grasp] - D.t[seg.from])) < 1e-9, 'time to the grasp from the timestamps (uneven frames)');
  assert.notEqual(sock.tg, (seg.grasp - seg.from) / 30, 'frame counts would give another time here');
  // a commit point past the window and a grasp height beyond the limits are clipped
  assert.equal(ex[3].y, KNN.yMax); assert.equal(ex[3].dz, KNN.dzMax);
  assert.deepEqual(coverage(ex), { paper: 1, plastic: 0, glass: 1, metal: 1 });
});

test('class → bin is learned from the demonstrations (with the commit point and grasp height of the neighbours)', () => {
  const D = demoOf([
    { item: 'cup_paper1', x: 0.25, yGrasp: -0.10, yaw: 2.0, dz: -0.004 },
    { item: 'cup_plastic1', x: 0.24, yGrasp: -0.05, yaw: 0.3, dz: -0.02 },
    { item: 'fork_plastic1', x: 0.23, yGrasp: 0.02, yaw: 1.6, dz: 0.0 },
    { item: 'vial_glass1', x: 0.25, yGrasp: -0.08, yaw: 1.1, dz: -0.01 },
    { item: 'socket_s1', x: 0.24, yGrasp: -0.12, yaw: 0.2, dz: -0.006 },
    { item: 'nut_m1', x: 0.26, yGrasp: -0.06, yaw: 2.9, dz: -0.002 }
  ]);
  const model = train(examplesFromDemo(D, { tipOf }));
  assert.equal(model.n, 6);
  assert.deepEqual(model.coverage, { paper: 1, plastic: 2, glass: 1, metal: 2 });
  for (const it of CONVEYOR_ITEMS) {
    const d = decide(model, obsOf(st(it.name, 0.24, -0.2, 0.03, 1.3), 0.02));
    assert.equal(d.bin, FRACTION_BIN[it.fraction], it.name);
    assert.ok(d.nn.length >= 1 && d.nn.length <= 3 && d.by >= 1);
  }
  // plastic: two neighbours, the medians of their commit points and grasp heights
  const p = decide(model, obsOf(st('spoon_plastic1', 0.24, -0.2, 0.01, Math.PI / 2), 0.02));
  assert.equal(p.y, +((-0.05 + 0.02) / 2).toFixed(4));
  assert.equal(p.dz, -0.01);
  assert.deepEqual(p.nn, [3, 2], 'the fork lies along the belt like the spoon: nearest first');
});

test('an unseen class is let through: no bin, cause "neznámá třída – nechal projet"', () => {
  const model = train(examplesFromDemo(demoOf([{ item: 'socket_s1', x: 0.24, yGrasp: -0.1, yaw: 0, dz: 0 }]), { tipOf }));
  const d = decide(model, obsOf(st('vial_glass1', 0.24, -0.1, 0.03, 0), 0.02));
  assert.deepEqual(d, { bin: null, why: 'unknown', nn: [] });
  assert.equal(decide(model, obsOf(st('nut_m1', 0.24, -0.1, 0.01, 0), 0.02)).bin, 'bin_metal');
  const rows = report([{ name: 'vial_glass1', fraction: 'glass', state: 'tote', bin: null }],
    [{ ev: 'skip', name: 'vial_glass1', why: 'unknown' }], { vial_glass1: d });
  assert.deepEqual([rows[0].ok, rows[0].cause], [false, 'unknown']);
  assert.equal(decide(train([]), obsOf(st('nut_m1', 0.24, 0, 0.01, 0), 0.02)).bin, null, 'no demos at all: everything passes');
});

test('a wrong demonstration reproduces the contamination (and the card names the demo it copied)', () => {
  const D = demoOf([
    { item: 'vial_glass1', x: 0.24, yGrasp: -0.1, yaw: 0.5, dz: -0.01, outcome: 'wrong', bin: 'bin_plastic' },
    { item: 'socket_s1', x: 0.24, yGrasp: -0.1, yaw: 0, dz: 0 }
  ]);
  const ex = examplesFromDemo(D, { tipOf }), model = train(ex);
  const d = decide(model, obsOf(st('vial_glass3', 0.25, -0.2, 0.03, 2.5), 0.02));
  assert.equal(d.bin, 'bin_plastic', 'the policy copies the glass → plastic demo');
  assert.equal(d.by, 1);
  const rows = report([{ name: 'vial_glass3', fraction: 'glass', state: 'bin', bin: 'bin_plastic' }], [{ ev: 'held', name: 'vial_glass3' }], { vial_glass3: d });
  assert.deepEqual([rows[0].ok, rows[0].cause, rows[0].by], [false, 'wrong', 1]);
  // the majority of the 3 nearest wins over one wrong demo; deleting the wrong one (off) cleans the rule
  const D2 = demoOf([
    { item: 'vial_glass1', x: 0.24, yGrasp: -0.1, yaw: 0.5, dz: -0.01, outcome: 'wrong', bin: 'bin_plastic' },
    { item: 'vial_glass2', x: 0.25, yGrasp: -0.1, yaw: 0.6, dz: -0.01 },
    { item: 'vial_glass3', x: 0.23, yGrasp: -0.1, yaw: 0.4, dz: -0.01 }
  ]);
  const ex2 = examplesFromDemo(D2, { tipOf });
  assert.equal(decide(train(ex2), obsOf(st('vial_glass1', 0.24, -0.2, 0.03, 0.5), 0.02)).bin, 'bin_glass');
  ex[0].off = true;
  assert.equal(decide(train(ex), obsOf(st('vial_glass3', 0.25, -0.2, 0.03, 2.5), 0.02)).bin, null, 'without the wrong demo glass is unseen again');
});

test('deterministic: the same episodes give the same model and decisions; ties go to the nearest; fast', () => {
  const items = [];
  const names = CONVEYOR_ITEMS.map((it) => it.name);
  let s = 7; const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = 0; i < 50; i++) {
    const item = names[i % names.length];
    items.push({ item, x: 0.2 + 0.08 * r(), yGrasp: -0.15 + 0.3 * r(), yaw: 6 * r(), dz: -0.02 + 0.03 * r(), outcome: r() < 0.2 ? 'wrong' : 'sorted', bin: r() < 0.2 ? 'bin_metal' : undefined });
  }
  const D = demoOf(items);
  const a = examplesFromDemo(D, { tipOf }), b = examplesFromDemo(JSON.parse(JSON.stringify(D)), { tipOf });
  assert.deepEqual(a, b);
  const t0 = performance.now(), m1 = train(a), ms = performance.now() - t0;
  const m2 = train(b);
  assert.deepEqual(m1, m2);
  assert.equal(m1.n, 50);
  assert.ok(ms < 50, `training 50 episodes took ${ms.toFixed(2)} ms`);
  for (let i = 0; i < 40; i++) {
    const o = obsOf(st(names[i % names.length], 0.2 + 0.08 * r(), 0, 0.03, 6 * r()), 0.02);
    assert.deepEqual(decide(m1, o), decide(m2, o));
  }
  // a 1 : 1 tie (two neighbours): the nearest one's bin
  const T = examplesFromDemo(demoOf([
    { item: 'socket_s1', x: 0.24, yGrasp: -0.1, yaw: Math.PI / 2 + 0.10, dz: 0, outcome: 'wrong', bin: 'bin_paper' },
    { item: 'socket_l1', x: 0.24, yGrasp: -0.1, yaw: Math.PI / 2 + 1.20, dz: 0 }
  ]), { tipOf });
  assert.equal(decide(train(T), obsOf(st('nut_m1', 0.24, 0, 0.01, Math.PI / 2 + 1.1), 0.02)).bin, 'bin_metal');
  assert.equal(decide(train(T), obsOf(st('nut_m1', 0.24, 0, 0.01, Math.PI / 2 + 0.2), 0.02)).bin, 'bin_paper');
});

test('stars of mission 12: hotovo, purity of the policy run, at most S.demos demonstrations', () => {
  const S = MISSIONS.find((x) => x.id === 'waste_teach').stars;
  assert.equal(teachStars(S, { purity: 1, demos: S.demos }), 3);
  assert.equal(teachStars(S, { purity: 1, demos: S.demos + 1 }), 2);
  assert.equal(teachStars(S, { purity: 0.9, demos: 4 }), 2);
  assert.equal(teachStars(S, { purity: 0.5, demos: 20 }), 1);
  assert.equal(teachStars(S, { purity: 1, demos: 0 }), 2, 'no demonstrations: no data-efficiency star');
});

// ---------------- with MuJoCo: the executor on the verification batch ----------------
const { mj, m, d, sizes } = await loadObjectScene('conveyor');
const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'].map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
const world = new World(mj, m, d); world.sizes(sizes);
const ctl = new ArmController(mj, m, d, act);
const ts = m.opt.timestep, belt = world.belt;

test('knnSolve on the verification batch: the rule decides, the planner moves; unseen classes pass, a wrong demo contaminates', () => {
  // a model that knows metal (right) and glass (wrong: into plastic), nothing else
  const model = train(examplesFromDemo(demoOf([
    { item: 'socket_l1', x: 0.24, yGrasp: -0.12, yaw: 0.3, dz: -0.006 },
    { item: 'vial_glass1', x: 0.24, yGrasp: -0.10, yaw: 1.0, dz: -0.01, outcome: 'wrong', bin: 'bin_plastic' }
  ]), { tipOf }));
  const runner = new MissionRunner(world);
  mj.mj_resetDataKeyframe(m, d, 0);
  runner.ctx.policy = { verify: true, demos: model.n };
  runner.select('waste_teach'); runner.setup(); mj.mj_forward(m, d);
  ctl.cancel(); ctl.syncFromCtrl();
  runner.start();
  const log = [], run = () => runner.ctx.s.run;
  const plan = knnSolve(ctl, world, model, { stop: () => false, log: (e) => log.push(e) });
  assert.equal(plan.kind, 'knn');
  ctl.run(plan);
  // the verification batch (seed 2) starts vial_glass3, spoon_plastic1, vial_glass1, …: 45 s covers the first ones
  const n = Math.round(45 / ts);
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) { ctl.update(ts * 4); ctl.actualTip(runner.ctx.tip); runner.ctx.gripOpen = ctl.gripOpen(); }
    belt.step(ts); mj.mj_step(m, d);
    if (i % 4 === 0) runner.tick(ts * 4);
  }
  ctl.cancel();
  const dec = plan.decisions;
  assert.equal(run().o.seed, TEACH.seed);
  assert.equal(dec.vial_glass3 && dec.vial_glass3.bin, 'bin_plastic', 'glass goes where the (wrong) demo put it');
  assert.equal(dec.spoon_plastic1 && dec.spoon_plastic1.bin, null, 'plastic was never shown');
  assert.ok(log.some((e) => e.ev === 'skip' && e.name === 'spoon_plastic1' && e.why === 'unknown'), 'the spoon is let through');
  assert.ok(!log.some((e) => e.ev === 'commit' && e.name === 'spoon_plastic1'));
  const vial = run().item('vial_glass3');
  assert.ok(log.some((e) => e.ev === 'commit' && e.name === 'vial_glass3' && e.bin === 'bin_plastic'), 'the planner was sent to the plastic bin');
  if (vial.state === 'bin') assert.equal(vial.bin, 'bin_plastic', 'contamination: a glass vial in the plastic bin');
  const rows = report(run().items, log, dec);
  const sp = rows.find((r) => r.item === 'spoon_plastic1');
  assert.equal(sp.cause, 'unknown');
});
