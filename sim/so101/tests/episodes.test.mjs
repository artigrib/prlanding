// Per-item episodes and environment state of the waste missions (src/policy/episodes.js), the Teach recorder on the
// conveyor (src/ui/teach.js: env frames, cuts, the belt speed in replay and snapshots), backward compatibility of
// older demos. Pure parts on synthetic events; the recorder with real MuJoCo physics and the scripted planner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadObjectScene } from './mj-node.mjs';
import { ArmController } from '../src/controller.js';
import { World } from '../src/world.js';
import { MISSIONS, MissionRunner } from '../src/missions.js';
import { WASTE, FRACTIONS } from '../src/objects/wastebatch.js';
import { beltSolve, BELT_PICK } from '../src/objects/beltpick.js';
import { CONVEYOR_ITEMS } from '../src/objects/scene.js';
import { Teach } from '../src/ui/teach.js';
import { buildDataset, ENV_KEY } from '../src/export/lerobot.js';
import {
  ENV_CLASSES, ENV_NAMES, ENV_DIM, EPISODE, envOf, envVector, validEnv, validSegments, cutEpisodes, cutFrames, trimSegments,
  packEnv, unpackEnv
} from '../src/policy/episodes.js';

const FR = Object.fromEntries(CONVEYOR_ITEMS.map((it) => [it.name, it.fraction]));
const ev = (e, name, t, from, x = {}) => Object.assign({ ev: e, name, fraction: FR[name], t, from }, x);

test('constants: classes are the mission fractions, the window is the planner\'s, 18 named env floats', () => {
  assert.deepEqual(ENV_CLASSES, FRACTIONS);
  assert.equal(WASTE.window, BELT_PICK.yMin);
  assert.equal(ENV_DIM, 18);
  assert.equal(ENV_NAMES.length, 18);
  assert.deepEqual(ENV_NAMES.slice(0, 9), ['target.x', 'target.y', 'target.z', 'target.yaw_sin', 'target.yaw_cos', 'target.paper', 'target.plastic', 'target.glass', 'target.metal']);
  assert.ok(ENV_NAMES.slice(9).every((n, i) => n === ENV_NAMES[i].replace('target.', 'next.')));
});

test('cutEpisodes: one episode per item, from the window (after the previous release) to 0.5 s after the release', () => {
  const events = [
    ev('belt', 'cup_paper1', 0, 'queued'), ev('window', 'cup_paper1', 5),
    ev('held', 'cup_paper1', 8, 'belt'), ev('moving', 'cup_paper1', 11, 'held'), ev('bin', 'cup_paper1', 11.6, 'moving', { bin: 'bin_paper', ok: true }),
    ev('belt', 'socket_s1', 10, 'queued'), ev('window', 'socket_s1', 15),
    ev('held', 'socket_s1', 17, 'belt'), ev('moving', 'socket_s1', 19, 'held'), ev('bin', 'socket_s1', 19.6, 'moving', { bin: 'bin_glass', ok: false }),
    // grasped early (before the window), dropped onto the table
    ev('belt', 'vial_glass1', 20, 'queued'), ev('held', 'vial_glass1', 21, 'belt'), ev('table', 'vial_glass1', 23, 'held'),
    // never grasped: it rode into the end tote while the arm was busy
    ev('belt', 'fork_plastic1', 4, 'queued'), ev('window', 'fork_plastic1', 9), ev('tote', 'fork_plastic1', 30, 'belt'),
    // still in the jaws / still riding when the recording stops: no episode
    ev('belt', 'nut_m1', 30, 'queued'), ev('window', 'nut_m1', 35), ev('held', 'nut_m1', 38, 'belt'),
    ev('belt', 'spoon_plastic1', 40, 'queued')
  ];
  const cuts = cutEpisodes(events, { end: 41 });
  const by = Object.fromEntries(cuts.map((c) => [c.item, c]));
  assert.deepEqual(Object.keys(by).sort(), ['cup_paper1', 'fork_plastic1', 'socket_s1', 'vial_glass1']);
  assert.deepEqual([by.cup_paper1.t0, by.cup_paper1.t1, by.cup_paper1.outcome, by.cup_paper1.bin], [5, 11 + EPISODE.post, 'sorted', 'bin_paper']);
  // its window opened at 15 s, after the arm had let go of the cup (11 s)
  assert.deepEqual([by.socket_s1.t0, by.socket_s1.t1, by.socket_s1.outcome, by.socket_s1.bin], [15, 19.5, 'wrong', 'bin_glass']);
  // grasped before its window: from its spawn (20 s; the arm was free since 19 s)
  assert.deepEqual([by.vial_glass1.t0, by.vial_glass1.t1, by.vial_glass1.outcome], [20, 23.5, 'dropped']);
  // a miss: from after the last release before it (the vial at 23 s) to the moment it fell into the tote
  assert.deepEqual([by.fork_plastic1.t0, by.fork_plastic1.t1, by.fork_plastic1.outcome, by.fork_plastic1.bin], [23, 30, 'missed', null]);
  assert.deepEqual(cuts.map((c) => c.item), ['cup_paper1', 'socket_s1', 'vial_glass1', 'fork_plastic1'], 'sorted by start');
  // the end clips: at 11.2 s the cup was released but its 0.5 s tail is cut; the socket was not resolved yet
  const early = cutEpisodes(events, { end: 11.7 });
  assert.deepEqual(early.map((c) => [c.item, c.t1]), [['cup_paper1', 11.5]]);
  // a re-grasp after a drop back onto the belt: one episode up to the last release
  const re = cutEpisodes([ev('belt', 'cup_plastic1', 0, 'queued'), ev('window', 'cup_plastic1', 5), ev('held', 'cup_plastic1', 7, 'belt'),
    ev('belt', 'cup_plastic1', 8, 'held'), ev('held', 'cup_plastic1', 10, 'belt'), ev('moving', 'cup_plastic1', 12, 'held'),
    ev('bin', 'cup_plastic1', 12.6, 'moving', { bin: 'bin_plastic', ok: true })]);
  assert.deepEqual(re.map((c) => [c.t0, c.t1, c.grasp, c.outcome]), [[5, 12.5, 7, 'sorted']]);
});

test('cutFrames maps run time to frames (and drops too-short cuts); trimSegments shifts and clips', () => {
  const rt = [null, null, ...Array.from({ length: 100 }, (_, i) => i * 0.1)];   // run clock starts at frame 2
  const f = cutFrames([{ item: 'cup_paper1', class: 'paper', outcome: 'sorted', bin: 'bin_paper', t0: 1, t1: 2, grasp: 1.3, release: 1.5 },
    { item: 'nut_m1', class: 'metal', outcome: 'missed', bin: null, t0: 3, t1: 3.2, grasp: null, release: null }], rt);
  assert.deepEqual(f, [{ item: 'cup_paper1', class: 'paper', outcome: 'sorted', bin: 'bin_paper', from: 12, to: 22, grasp: 15, release: 17 }]);
  assert.deepEqual(trimSegments(f, 16, 80), [{ ...f[0], from: 0, to: 6, grasp: 0, release: 1 }]);
  assert.deepEqual(trimSegments(f, 20, 80), [], 'too short after the trim');
  assert.deepEqual(validSegments(f, 102), f);
  for (const bad of [{ ...f[0], grasp: 30 }, { ...f[0], release: 1.5 }, { ...f[0], to: 102 }, { ...f[0], from: 20 }, { ...f[0], outcome: 'great' }, { ...f[0], class: 'glass' }, { ...f[0], item: 'cube' }, { ...f[0], from: 1.5 }]) {
    assert.equal(validSegments([bad], 102), null, JSON.stringify(bad));
  }
});

test('envOf: the held item, else the most downstream belt item, then the next one; envVector and validation', () => {
  const pos = { cup_paper1: [0.24, 0.1, 0.03], socket_s1: [0.24, -0.05, 0.02], nut_m1: [0.24, -0.25, 0.01], vial_glass1: [0.12, -0.17, 0.05] };
  const w = { belt: { speed: 0.02 }, com: (n, o) => { o[0] = pos[n][0]; o[1] = pos[n][1]; o[2] = pos[n][2]; return o; }, yaw: () => Math.PI / 2 };
  const run = { items: [{ name: 'cup_paper1', state: 'belt' }, { name: 'socket_s1', state: 'belt' }, { name: 'nut_m1', state: 'stuck' },
    { name: 'vial_glass1', state: 'bin' }, { name: 'fork_plastic1', state: 'queued' }] };
  let e = envOf(run, w);
  assert.equal(e.belt, 0.02);
  assert.deepEqual([e.target.item, e.target.class, e.next.item], ['cup_paper1', 'paper', 'socket_s1']);
  run.items[1].state = 'held';
  e = envOf(run, w);
  assert.deepEqual([e.target.item, e.next.item], ['socket_s1', 'cup_paper1']);
  const v = envVector(e);
  assert.equal(v.length, 18);
  assert.deepEqual(v.slice(0, 3), [0.24, -0.05, 0.02]);
  assert.ok(Math.abs(v[3] - 1) < 1e-9 && Math.abs(v[4]) < 1e-4, 'yaw sin / cos');
  assert.deepEqual(v.slice(5, 9), [0, 0, 0, 1], 'socket = metal');
  assert.deepEqual(v.slice(14, 18), [1, 0, 0, 0], 'cup = paper');
  assert.deepEqual(envVector({ belt: 0, target: null, next: null }), new Array(18).fill(0), 'nothing on the belt');
  run.items.forEach((it) => { it.state = 'queued'; });
  assert.deepEqual(envOf(run, w), { belt: 0.02, target: null, next: null });
  // validation in the validFrames style: whole list or nothing
  const good = [e, { belt: 0, target: null, next: null }];
  assert.deepEqual(validEnv(good, 2), good);
  assert.equal(validEnv(good, 3), null, 'count');
  const spoil = (fn) => { const g = JSON.parse(JSON.stringify(good)); fn(g); return validEnv(g, 2); };
  assert.equal(spoil((g) => { g[0].target.pos = [0, 0]; }), null, 'pos length');
  assert.equal(spoil((g) => { g[0].target.pos[1] = 'x'; }), null, 'pos type');
  assert.equal(spoil((g) => { g[0].target.class = 'glass'; }), null, 'class does not match the item');
  assert.equal(spoil((g) => { g[0].target.item = 'cube'; }), null, 'unknown item');
  assert.equal(spoil((g) => { g[1].belt = 5; }), null, 'belt speed');
  assert.equal(spoil((g) => { delete g[1].next; }), null, 'missing key');
  assert.equal(spoil((g) => { g[1] = null; }), null, 'null frame');
  // compact form for localStorage / links round-trips
  assert.deepEqual(good.map(packEnv).map(unpackEnv), good);
  assert.equal(validEnv([unpackEnv([0, 99, 0, 0, 0, 0, -1, 0, 0, 0, 0])], 1), null, 'bad item index');
});

// ---------------------------------------------------------------- the recorder on the conveyor (MuJoCo) -------------
const { mj, m, d, sizes } = await loadObjectScene('conveyor');
const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'].map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
const world = new World(mj, m, d); world.sizes(sizes);
const ctl = new ArmController(mj, m, d, act);
const runner = new MissionRunner(world);
const ts = m.opt.timestep, belt = world.belt;
function reset() {
  mj.mj_resetDataKeyframe(m, d, 0);
  runner.setup(); mj.mj_forward(m, d); belt.sync();
  ctl.cancel(); ctl.syncFromCtrl();
}
// UX stand-in: what Teach uses of src/ux.js (app.reset → keyframe + mission setup, as the page does)
const ux = {
  mj, ctl, world, runner, app: { d, m, act, stopDemo() {}, reset }, wasteRun: () => runner.ctx.s.run || null,
  beginReplayReset(demo) { runner.select(demo.mission.id); reset(); }
};
const teach = new Teach(ux);
// the page's order: teach.pre + controller, belt + physics; every 4th step (a 16 ms frame) the mission check, then
// teach.sample (src/ux.js check())
function run(sec, each) {
  const n = Math.round(sec / ts), every = 4;
  for (let i = 0; i < n; i++) {
    if (i % every === 0) { teach.pre(); if (!teach.replaying) ctl.update(ts * every); ctl.actualTip(runner.ctx.tip); runner.ctx.gripOpen = d.ctrl[act[5]] > 0.5; }
    belt.step(ts); mj.mj_step(m, d);
    if (i % every === 0) { runner.tick(ts * every); teach.sample(); if (each) each(); }
  }
}
runner.select('waste_hand');

test('conveyor recording: env on every frame, one episode per sorted item, a belt pause recorded and replayed', async () => {
  reset();
  teach.startRec(); runner.start();
  ctl.run(beltSolve(ctl, world, { stop: () => false }));
  run(26);
  belt.speed = 0; run(3); belt.speed = WASTE.speed;    // Pás ⏸ for 3 s
  run(20);
  teach.stopRec();
  const D = teach.demo, n = D.t.length;
  assert.ok(n > 1000, `${n} frames`);
  assert.equal(D.env.length, n, 'env on every frame');
  assert.ok(!('rt' in D), 'the run clock is dropped after the cut');
  assert.ok(D.env.some((e) => e.belt === 0) && D.env.some((e) => e.belt === WASTE.speed), 'the pause is in the frames');
  const segs = D.segments, sorted = segs.filter((s) => s.outcome === 'sorted');
  console.log('  episodes:', segs.map((s) => `${s.item} ${s.outcome} ${(D.t[s.to] - D.t[s.from]).toFixed(1)} s`).join(' · '));
  assert.ok(sorted.length >= 3, `sorted episodes: ${JSON.stringify(segs)}`);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], fr = D.env.slice(s.from, s.to + 1);
    const own = fr.filter((e) => e.target && e.target.item === s.item).length;
    assert.ok(own / fr.length > 0.6, `${s.item}: target in ${own} of ${fr.length} frames`);
    assert.ok(s.to - s.from + 1 >= EPISODE.minLen);
    if (i) assert.ok(s.from >= segs[i - 1].from, 'ordered');
    if (s.outcome === 'sorted') {
      assert.ok(s.grasp > s.from && s.release > s.grasp && s.release < s.to, `grasp ${s.grasp} / release ${s.release} inside ${s.from}…${s.to}`);
      assert.equal(D.env[s.grasp + 1].target.item, s.item, 'held → it is the target');
    }
  }
  // the sorted episodes of the planner do not overlap: each starts after the previous release
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].from > sorted[i - 1].to - Math.round(EPISODE.post * 30) - 1, 'no overlap');
  // JSON: env per frame, segments, the belt speed in the snapshot; import round-trips them
  const j = JSON.parse(JSON.stringify(teach.toJSON()));
  assert.equal(j.printedrobotics.mission, 'waste_hand');
  assert.equal(j.printedrobotics.snapshot.belt, WASTE.speed);
  assert.deepEqual(j.printedrobotics.segments, segs);
  assert.deepEqual(Object.keys(j.episodes[0].frames[0]).sort(), ['action', 'env', 'frame_index', 'observation.state', 'timestamp']);
  const envs = D.env.map((e) => JSON.parse(JSON.stringify(e)));
  teach.demo = null;
  assert.equal(teach.importJSON(j), n);
  assert.deepEqual(teach.demo.env, envs);
  assert.deepEqual(teach.demo.segments, segs);
  // LeRobot: one episode per item, observation.environment_state of 18
  const files = await buildDataset([j]);
  const info = JSON.parse(files['meta/info.json']);
  assert.equal(info.total_episodes, segs.length);
  assert.deepEqual(info.features[ENV_KEY].shape, [18]);
  assert.equal(JSON.parse(files['meta/tasks.jsonl']).task, 'Sort the waste into bins by material');
  if (process.env.LEROBOT_OUT_REC) {   // write the dataset of this recording (checked with LeRobot itself, see docs)
    const fs = await import('node:fs'), path = await import('node:path');
    for (const [f, v] of Object.entries(files)) {
      const out = path.join(process.env.LEROBOT_OUT_REC, f);
      fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, v);
    }
    fs.writeFileSync(path.join(process.env.LEROBOT_OUT_REC, '..', 'demo-waste_hand.json'), JSON.stringify(j));
  }
  // replay: the batch runs again and the belt stands where it stood in the recording
  assert.ok(teach.startReplay());
  assert.ok(runner.started, 'the replayed batch runs');
  const stood = [];
  run(30, () => { if (teach.replaying && teach.k > 0 && D.env[teach.k].belt === 0) stood.push(belt.speed); });
  assert.ok(stood.length > 60 && stood.every((v) => v === 0), `belt commanded 0 for ${stood.length} frames of the pause`);
  assert.ok(runner.ctx.s.run.next >= 3, 'items spawned during the replay');
  teach.stopReplay();
});

test('a paused belt survives a replay (snapshot), and a batch under way restarts when the recording starts', () => {
  reset();
  runner.start(); run(0.5);
  assert.ok(runner.ctx.s.run.next > 0, 'an item is on the belt');
  belt.speed = 0;
  teach.startRec();               // resets the batch (the page then starts it): the belt runs again from the setup
  assert.equal(ux.wasteRun(), null, 'fresh mission state');
  assert.equal(belt.speed, WASTE.speed);
  belt.speed = 0;                 // pause before anything moves …
  teach.stopRec(); teach.demo = null;
  reset(); belt.speed = 0;
  teach.startRec(); runner.start();
  run(2);
  teach.stopRec();
  assert.equal(teach.demo.snap.belt, 0);
  assert.ok(teach.demo.env.every((e) => e.belt === 0));
  belt.speed = WASTE.speed;
  assert.ok(teach.startReplay());
  assert.equal(belt.speed, 0, 'restored from the snapshot (the mission setup had set 2 cm/s)');
  run(1);
  assert.equal(belt.speed, 0, 'still paused during the replay');
  teach.stopReplay();
});

test('backward compatibility: older demos (no env, no segments, no belt in the snapshot) still load', () => {
  reset();
  teach.startRec(); runner.start(); run(1); teach.stopRec();
  const j = JSON.parse(JSON.stringify(teach.toJSON()));
  // an older file: the same demo without the new fields
  for (const f of j.episodes[0].frames) delete f.env;
  delete j.printedrobotics.segments; delete j.printedrobotics.env_note; delete j.printedrobotics.snapshot.belt;
  const n = teach.importJSON(j);
  assert.equal(n, j.episodes[0].frames.length);
  assert.ok(!teach.demo.env && !teach.demo.segments, 'no env');
  assert.equal(teach.demo.snap.belt, null);
  assert.ok(teach.startReplay(), 'replays'); run(0.5); teach.stopReplay();
  // env on some frames only, or damaged, or segments without env: rejected like a partial snapshot
  const k = JSON.parse(JSON.stringify(teach.toJSON()));
  k.episodes[0].frames[0].env = { belt: 0.02, target: null, next: null };
  assert.throws(() => teach.importJSON(k), /bad env/);
  const s = JSON.parse(JSON.stringify(k)); delete s.episodes[0].frames[0].env; s.printedrobotics.segments = [];
  assert.throws(() => teach.importJSON(s), /bad env/);
  // localStorage: an entry saved before env existed loads; one with env round-trips
  const mem = new Map();
  globalThis.localStorage = { getItem: (key) => (mem.has(key) ? mem.get(key) : null), setItem: (key, v) => mem.set(key, String(v)) };
  try {
    teach.persist();
    const old = JSON.parse(mem.get('pr-sim-demo'));
    assert.ok(!('env' in old), 'an env-free demo is saved as before');
    delete old.snap.belt; mem.set('pr-sim-demo', JSON.stringify(old));
    teach.demo = null;
    assert.ok(teach.load(), 'older entry loads');
    teach.startRec(); runner.start(); run(1); teach.stopRec();
    const env = JSON.parse(JSON.stringify(teach.demo.env));
    teach.demo = null;
    assert.ok(teach.load());
    assert.deepEqual(teach.demo.env, env, 'env survives localStorage');
    const bad = JSON.parse(mem.get('pr-sim-demo')); bad.env[3] = [1, 2];
    mem.set('pr-sim-demo', JSON.stringify(bad));
    teach.demo = null;
    assert.equal(teach.load(), false, 'damaged env: forgotten');
  } finally { delete globalThis.localStorage; }
});

test('MISSIONS: waste_hand is a belt mission (the recorder keys on it)', () => {
  assert.ok(MISSIONS.find((x) => x.id === 'waste_hand').belt);
});
