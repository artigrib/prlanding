// SIL runner on the conveyor scene (tier b of the waste-sorting campaign): the conveyor profile in the headless plant,
// the mirror frame with items and slats (and the page side that applies it), the kinematic replay of a recorded demo
// into camera frames (deterministic, measured against the recording) and the LeRobot dataset with images.
//   node --test tools/sil/test/conveyor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScene, MjPlant, SO101 } from '../lib/plant.mjs';
import { replaySession, replayDemo, replayToFolder, imageSums } from '../lib/replay.mjs';
import { writeImageDataset, readReplays } from '../lib/dataset.mjs';
import { sceneView, FRACTION_RGB } from '../lib/camera.mjs';
import { extractScene } from '../lib/raster.mjs';
import { decodePNG } from '../lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
process.removeAllListeners('warning');
const { applyFrame } = await import(path.join(SO101, 'src/mirror.js'));
const { BELT, CONVEYOR_ITEMS } = await import(path.join(SO101, 'src/objects/scene.js'));
const { beltSolve } = await import(path.join(SO101, 'src/objects/beltpick.js'));

test('plant: the conveyor profile loads (belt, 11 slats, the 11-item pool parked) and the belt moves the slats', async () => {
  const sc = await loadScene(SO101, { scene: 'conveyor' }), p = new MjPlant(sc);
  assert.equal(sc.scene, 'conveyor');
  assert.ok(p.belt, 'belt');
  assert.equal(p.belt.slats.length, BELT.n);
  assert.deepEqual(p.items.map((it) => it.name), CONVEYOR_ITEMS.map((it) => it.name));
  assert.equal(Object.keys(p.itemPoses({ out: true })).length, 0, 'every item parked at the start');
  assert.equal(p.qs().length, 6);
  p.belt.speed = 0.02;
  const y0 = p.belt.centre(0);
  for (let i = 0; i < 250; i++) p.mjStep();   // 1 s: ramped up (0.4 s at 0.05 m/s²), then 2 cm/s
  assert.ok(Math.abs(p.belt.v - 0.02) < 1e-9, `belt ${p.belt.v}`);
  const dy = p.belt.centre(0) - y0;
  assert.ok(Math.abs(dy - 0.02 * (1 - 0.2)) < 0.002, `slat 0 moved ${dy} m`);
  // the plain scene is what it was: no belt, no items
  const plain = new MjPlant(await loadScene());
  assert.equal(plain.belt, null); assert.equal(plain.items.length, 0);
  assert.ok(!('items' in plain.mirrorFrame()) && !('belt' in plain.mirrorFrame()));
  await assert.rejects(loadScene(SO101, { scene: 'moon' }), /unknown scene/);
});

test('mirror frame: items + mocap + slats; the page applies it to its own copy of the scene and refuses another scene', async () => {
  const S = await replaySession('conveyor');
  const { world, plant, d } = S;
  S.runner.select('waste_hand'); S.reset();
  world.spawn('cup_paper1', { yaw: 0.4 }); world.spawn('socket_s1', { y: 0, yaw: 1, force: true });
  world.belt.speed = 0.02;
  for (let i = 0; i < 300; i++) plant.mjStep();
  const f = JSON.parse(JSON.stringify(plant.mirrorFrame()));
  assert.equal(f.scene, 'conveyor');
  assert.equal(Object.keys(f.items).length, 11);
  assert.deepEqual(Object.keys(plant.itemPoses({ out: true })).sort(), ['cup_paper1', 'socket_s1']);
  assert.equal(f.belt.slats.length, BELT.n);
  assert.equal(f.mocap.pos.length, d.mocap_pos.length);
  // the page: another compiled conveyor scene (ArmSim's fields: mj, m, d, qadr, act, cubeBody, belt)
  const pg = await loadScene(SO101, { scene: 'conveyor' }), pp = new MjPlant(pg);
  const sim = { mj: pg.mj, m: pg.m, d: pg.d, qadr: pp.qadr, act: pp.act, cubeBody: pp.cubeBody, belt: pg.belt };
  const r = applyFrame(sim, f, 'conveyor');
  assert.ok(r.ok);
  assert.deepEqual(r.out.sort(), ['cup_paper1', 'socket_s1']);
  for (const it of pp.items) assert.deepEqual(Array.from(pg.d.qpos.subarray(it.q, it.q + 7)), f.items[it.name], it.name);
  pg.belt.slats.forEach((s, i) => { assert.equal(pg.d.qpos[s.q], f.belt.slats[i]); assert.equal(pg.belt.carrying(i), plant.belt.carrying(i)); });
  assert.deepEqual(pp.qs(), f.follower.q);
  // a cup on the belt is where the runner has it, drawn by the page's MuJoCo (xpos after mj_forward)
  S.mj.mj_forward(S.m, d);
  const b = pp.items.find((it) => it.name === 'cup_paper1').body;
  assert.ok(Math.abs(pg.d.xpos[3 * b + 1] - d.xpos[3 * b + 1]) < 1e-9);
  // another scene is not drawn; a plain-scene frame (older runner: no scene field) is refused here too
  assert.deepEqual(applyFrame(sim, { ...f, scene: 'plain' }, 'conveyor'), { ok: false, why: 'scene', scene: 'plain' });
  delete f.scene;
  assert.equal(applyFrame(sim, f, 'conveyor').why, 'scene');
  assert.equal(applyFrame(sim, { follower: { q: [1, 2] } }, 'conveyor').why, 'frame');
});

test('camera view of the conveyor: belt frame and slats drawn, items in their fraction colour, turned-down slats hidden', async () => {
  const sc = await loadScene(SO101, { scene: 'conveyor' });
  const v = sceneView(sc), scene = extractScene(sc.m, v.opts), p = new MjPlant(sc);
  sc.belt.speed = 0.02;
  for (let i = 0; i < 500; i++) p.mjStep();   // 2 s: a slat has passed the head drum
  const bodies = new Set(scene.geoms.map((g) => sc.m.geom_bodyid[g.id]));
  for (const s of sc.belt.slats) assert.ok(bodies.has(s.body), 'slat drawn');
  const cup = sc.mj.mj_name2id(sc.m, sc.mj.mjtObj.mjOBJ_BODY.value, 'cup_paper1');
  assert.deepEqual(scene.geoms.find((g) => sc.m.geom_bodyid[g.id] === cup).rgb, FRACTION_RGB.paper);
  const hidden = v.hide();
  assert.ok(hidden.length >= 1, 'one slat is past the head drum');
  sc.belt.slats.forEach((s, i) => { if (!sc.belt.carrying(i)) assert.ok(hidden.includes(sc.m.body_geomadr[s.body])); });
  const plain = await loadScene();
  assert.deepEqual(sceneView(plain).hide(), []);
});

// ---------------------------------------------------------------- kinematic replay ---------------------------------
/** A "live" run, recorded by Teach in the page's order (as sim/so101/tests/episodes.test.mjs): the scripted planner. */
async function recordLive(S, sec) {
  const { m, d, teach, runner, ctl, act, world } = S;
  runner.select('waste_hand'); S.reset();
  teach.startRec(); runner.start();
  ctl.run(beltSolve(ctl, world, { stop: () => false }));
  const ts = m.opt.timestep, n = Math.round(sec / ts);
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) { teach.pre(); ctl.update(ts * 4); ctl.actualTip(runner.ctx.tip); runner.ctx.gripOpen = d.ctrl[act[5]] > 0.5; }
    S.plant.mjStep();
    if (i % 4 === 0) { runner.tick(ts * 4); teach.sample(); }
  }
  teach.stopRec();
  ctl.cancel();
  return JSON.parse(JSON.stringify(teach.toJSON()));
}

const S = await replaySession('conveyor');
const live = await recordLive(S, 26);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sil-replay-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

test('replay: deterministic, close to the recording, same item outcomes; frames on an exact 30 fps grid', async () => {
  const segs = live.printedrobotics.segments;
  assert.ok(segs.some((s) => s.outcome === 'sorted'), `live run sorted an item: ${JSON.stringify(segs)}`);
  const sums = [];
  const opts = { cameras: ['up', 'wrist'], width: 64, height: 48, onImage: (c, k, rgb) => sums.push(imageSums(rgb)) };
  const a = await replayDemo(S, live, opts);
  const n1 = sums.length;
  const b = await replayDemo(S, live, opts);
  assert.deepEqual(b.demo, a.demo, 'second replay identical');
  assert.deepEqual(sums.slice(n1), sums.slice(0, n1), 'identical images');
  const r = a.report, dv = r.divergence;
  console.log('  divergence:', JSON.stringify(dv), 'outcomes', JSON.stringify(r.items));
  assert.ok(dv.jointsDeg.p95 < 3 && dv.jointsDeg.max < 15, 'joints');
  assert.ok(dv.itemMm.n > 100 && dv.itemMm.p95 < 10, 'items');
  assert.equal(r.sameOutcome, r.items.length, 'every item ended as in the recording');
  const fr = a.demo.episodes[0].frames;
  assert.equal(fr.length, r.frames);
  fr.forEach((f, k) => { assert.equal(f.frame_index, k); assert.equal(f.timestamp, k / 30); });
  assert.equal(fr.length, Math.floor(live.episodes[0].frames.at(-1).timestamp * 30 + 1e-6) + 1);
  assert.equal(n1, 2 * fr.length, 'one image per frame and camera');
  // the replay's own env and segments (cut from the replay's mission events)
  assert.ok(fr.every((f) => f.env && 'target' in f.env));
  assert.deepEqual(a.demo.printedrobotics.segments.map((s) => [s.item, s.outcome]), segs.map((s) => [s.item, s.outcome]));
  assert.equal(a.demo.printedrobotics.replay.format, 'printedrobotics.cz/so101-sil-replay@1');
  assert.ok(r.render.imagesPerS > 0);
  await assert.rejects(replayDemo(S, { ...live, printedrobotics: { ...live.printedrobotics, mission: 'bowl' } }), /plain scene/);
});

test('replay folder -> LeRobot v2.1 dataset with observation.images.<camera> (PNG in Parquet), stats per channel', async () => {
  const demoFile = path.join(tmp, 'demo.json');
  fs.writeFileSync(demoFile, JSON.stringify(live));
  const out = path.join(tmp, 'rep');
  const reports = await replayToFolder([demoFile], out, { cameras: ['up', 'wrist'], width: 64, height: 48 });
  assert.equal(reports.length, 1);
  const [rep] = readReplays(out), n = rep.episodes[0].frames.length;
  assert.equal(fs.readdirSync(path.join(out, 'images/000/up')).length, n);
  const png = decodePNG(fs.readFileSync(path.join(out, 'images/000/wrist/frame_000010.png')));
  assert.deepEqual([png.width, png.height], [64, 48]);
  assert.deepEqual(rep.printedrobotics.replay.images.sums.wrist[10], imageSums(png.rgb), 'sums from the very image');
  const info = await writeImageDataset(out, path.join(out, 'lerobot'));
  const segs = rep.printedrobotics.segments;
  assert.equal(info.total_episodes, segs.length);
  for (const c of ['up', 'wrist']) assert.deepEqual(info.features['observation.images.' + c], { dtype: 'image', shape: [48, 64, 3], names: ['height', 'width', 'channels'] });
  assert.deepEqual(info.features['observation.environment_state'].shape, [18]);
  const st = JSON.parse(fs.readFileSync(path.join(out, 'lerobot/meta/stats.json'), 'utf8'))['observation.images.up'];
  assert.equal(st.mean.length, 3); assert.equal(st.mean[0].length, 1); assert.equal(st.mean[0][0].length, 1);
  assert.ok(st.mean.every(([[v]]) => v > 0 && v < 1) && st.max.every(([[v]]) => v <= 1));
  const ep0 = JSON.parse(fs.readFileSync(path.join(out, 'lerobot/meta/episodes.jsonl'), 'utf8').split('\n')[0]);
  const pq = fs.readFileSync(path.join(out, 'lerobot/data/chunk-000/episode_000000.parquet')), txt = pq.toString('latin1');
  assert.ok(txt.includes('observation.images.up') && txt.includes('"_type":"Image"'));
  // the PNGs of the episode's frames are in it (Snappy-compressed pages; tools/hf/test_demos_to_lerobot.py reads them
  // back with pyarrow and compares them byte for byte)
  let bytes = 0;
  for (const c of ['up', 'wrist']) for (let k = segs[0].from; k <= segs[0].to; k++) bytes += fs.statSync(path.join(out, `images/000/${c}/frame_${String(k).padStart(6, '0')}.png`)).size;
  assert.equal(ep0.length, segs[0].to - segs[0].from + 1);
  assert.ok(pq.length > 0.5 * bytes, `parquet ${pq.length} B, PNGs ${bytes} B`);
  // cameras + joints only (what a real arm has): no environment state
  const noEnv = await writeImageDataset(out, path.join(out, 'lerobot-noenv'), { envState: false });
  assert.ok(!noEnv.features['observation.environment_state']);
  assert.equal(noEnv.total_episodes, info.total_episodes);
});

test('runner --scene conveyor --batch: mirror frames carry the items and slats, the batch spawns on schedule', { skip: (process.platform === 'win32' || spawnSync('python3', ['-c', 'import pty, termios'], { stdio: 'ignore' }).status !== 0) && 'needs python3 + pty', timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sil-conv-'));
  const ctl = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(ROOT, 'tools/sil/so101-virtual.mjs'), '--quiet', '--mirror', '--scene', 'conveyor', '--batch', '1',
    '--follower-port', path.join(dir, 'follower'), '--ctl-port', String(ctl)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (b) => { out += b; });
  try {
    for (let i = 0; i < 300 && !out.includes('control:'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(out.includes('scene conveyor: belt 0.02 m/s') && out.includes('batch seed 1'), out);
    await new Promise((r) => setTimeout(r, 1500));
    const ws = new WebSocket(`ws://127.0.0.1:${ctl}/mirror`);
    const f = await new Promise((res, rej) => { ws.onmessage = (e) => res(JSON.parse(e.data)); ws.onerror = rej; setTimeout(() => rej(new Error('no mirror frame')), 5000); });
    ws.close();
    assert.equal(f.scene, 'conveyor');
    assert.equal(Object.keys(f.items).length, 11);
    assert.equal(Object.values(f.items).filter((p) => p[2] > -0.5).length, 1, 'the first batch item is on the belt');
    assert.equal(f.belt.slats.length, BELT.n); assert.ok(Math.abs(f.belt.v - 0.02) < 1e-6);
    assert.equal(f.follower.torque.length, 6);
    const st = await (await fetch(`http://127.0.0.1:${ctl}/status`)).json();
    assert.equal(st.batch.seed, 1); assert.equal(st.batch.spawned, 1);
    const post = (c) => fetch(`http://127.0.0.1:${ctl}/cmd`, { method: 'POST', headers: { 'X-SIL': '1' }, body: c }).then((r) => r.json());
    assert.equal((await post('belt 0')).ok, true);
    assert.equal((await post('cube')).ok, false, 'no cube in the conveyor cell');
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
