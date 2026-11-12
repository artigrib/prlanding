// Kinematic replay of simulator demonstrations, with virtual camera frames — printedrobotics.cz.
//
// Input: a demo JSON downloaded from the browser sim (Teach, format printedrobotics.cz/so101-sim-demo@1). The demo
// starts from a full MuJoCo snapshot and holds the commanded joint targets (action) of every recorded frame.
// The replay runs the same code the browser's "Přehrát" runs (src/ui/teach.js importJSON → startReplay → pre), on
// the same compiled scene (tools/sil/lib/plant.mjs loadScene), in node:
//   - the snapshot is restored; on the conveyor the mission's batch starts again from the first frame (same seed:
//     same items, order, yaws and spawn times);
//   - "kinematic": the recorded action is written straight into MuJoCo's ctrl (linear interpolation in time), as
//     the browser does. The STS3215 servo emulation of the SIL runner (sim/so101/lib/sts3215-emu.js) is NOT in the
//     loop: it is not bit-identical to the browser's direct ctrl, so a replay through it would drift further;
//   - the items, the belt and the arm's contacts are simulated again (MuJoCo, 4 ms steps). Nothing forces the
//     replay to match the recording, so the replay is compared with it: joint and item pose error per recorded
//     frame, and each item's outcome (sorted / wrong / dropped / missed) in both runs.
// Output: a new demo JSON on an exact 30 fps grid whose observation.state, env and per-item segments are what the
// REPLAY did (so they match the camera images), with the recorded action; plus, per frame and camera, an RGB image
// from the software renderer (tools/sil/lib/raster.mjs). src/export/lerobot.js and tools/hf/demos_to_lerobot.py turn
// that into a LeRobot dataset with observation.images.<camera>.

import fs from 'node:fs';
import path from 'node:path';
import { loadScene, MjPlant, SO101, JOINT_NAMES } from './plant.mjs';
import { extractScene, geomPoses, renderView } from './raster.mjs';
import { cameraPoses, parseCameraSpec, sceneView, CAMERA_PRESETS } from './camera.mjs';
import { encodePNG } from './png.mjs';

export const FPS = 30;
export const REPLAY_FORMAT = 'printedrobotics.cz/so101-sil-replay@1';
const imp = (rel) => import(path.join(SO101, rel));

/** Scene profile a mission needs (the page's rule, sim/so101/app.js sceneOfId: `belt` missions = conveyor). */
export function sceneOfMission(m) { return !m ? 'plain' : m.scene === 'conveyor' || m.belt ? 'conveyor' : m.objects ? 'objects' : 'plain'; }

/**
 * Build a replay session for one scene: MuJoCo + World + MissionRunner + ArmController + Teach with the same
 * stand-in for the page (src/ux.js) that the node tests use (sim/so101/tests/episodes.test.mjs).
 */
export async function replaySession(scene = 'conveyor') {
  // sim/so101 modules are ES modules without a package.json "type" (shared with the browser): keep node quiet about it
  process.removeAllListeners('warning');
  process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') console.warn(w); });
  const sc = await loadScene(SO101, { scene });
  const [{ World }, { MissionRunner, MISSIONS }, { ArmController }, { Teach }, EP] = await Promise.all([
    imp('src/world.js'), imp('src/missions.js'), imp('src/controller.js'), imp('src/ui/teach.js'), imp('src/policy/episodes.js')]);
  const { mj, m, d } = sc, plant = new MjPlant(sc);
  const act = JOINT_NAMES.map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
  const world = new World(mj, m, d); world.sizes(sc.sizes);
  const ctl = new ArmController(mj, m, d, act);
  const runner = new MissionRunner(world);
  const reset = () => {
    mj.mj_resetDataKeyframe(m, d, 0);
    runner.setup(); mj.mj_forward(m, d); if (world.belt) world.belt.sync();
    ctl.cancel(); ctl.syncFromCtrl();
  };
  const ux = {
    mj, ctl, world, runner, app: { d, m, act, stopDemo() {}, reset }, wasteRun: () => (runner.ctx.s && runner.ctx.s.run) || null,
    beginReplayReset(demo) { runner.select(demo.mission.id); reset(); }
  };
  const teach = new Teach(ux);
  return { sc, mj, m, d, plant, world, ctl, runner, teach, act, ux, MISSIONS, EP, scene, reset };
}

const deg = (v) => Math.round(v * 180 / Math.PI * 100) / 100;
/** Joint vector (rad, gripper in its ctrl range) → the demo JSON's units (degrees, gripper 0–100 % open). */
export function toDemoUnits(v, grip) {
  const [lo, hi] = grip;
  return v.map((x, i) => (i === 5 ? Math.round((x - lo) / (hi - lo) * 1000) / 10 : deg(x)));
}
const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Replay one demo JSON. opts:
 *   cameras: ['up', 'wrist', 'top=up', …] (tools/sil/lib/camera.mjs presets; [] = no images);
 *   width, height: image size; onImage(cam, k, rgb): called per grid frame k and camera (RGB, width*height*3);
 *   preEvery: physics steps between ctrl updates (4 = once per 16 ms frame, the rate of the page and of the recorder in
 *     the node tests: the smallest error measured; 1 = every 4 ms step);
 *   checkEvery: physics steps between mission checks (4 = the page's 16 ms frame).
 * Returns { demo (replayed demo JSON), report } — report: divergence, item outcomes, render timing.
 */
export async function replayDemo(S, j, { cameras = ['up', 'wrist'], width = 320, height = 240, onImage = null, preEvery = 4, checkEvery = 4 } = {}) {
  const { mj, m, d, teach, runner, world, ctl, act, EP, plant } = S;
  const pr = (j && j.printedrobotics) || {};
  const mission = S.MISSIONS.find((x) => x.id === pr.mission);
  if (!mission) throw new Error(`demo of an unknown mission: ${pr.mission}`);
  if (sceneOfMission(mission) !== S.scene) throw new Error(`demo of mission ${mission.id} needs the ${sceneOfMission(mission)} scene, not ${S.scene}`);
  if (pr.snapshot == null) throw new Error('demo has no scene snapshot (printedrobotics.snapshot): cannot replay it exactly');
  teach.importJSON(j);                       // validates everything (frames, env, segments, snapshot length)
  const D = teach.demo, T = D.t, n0 = T.length, ts = m.opt.timestep, grip = ctl.kin.c.range[5];
  const recEnv = D.env || null, recSegs = D.segments || null;
  if (!teach.startReplay()) throw new Error('replay failed to start');
  const rt0 = d.time, tEnd = T[n0 - 1];
  const cams = cameras.map(parseCameraSpec);
  const view = sceneView(S.sc), scene = cams.length ? extractScene(m, view.opts) : null;
  const rgb = new Uint8Array(width * height * 3), zbuf = new Float32Array(width * height);
  const frames = [], env = recEnv ? [] : null, rt = [], qbuf = new Array(6);
  const errJ = [], errG = [], errItem = [], errYaw = [], perItem = new Map();   // perItem: item -> [max mm, time of it]
  let renderMs = 0, renders = 0, k = 0, j0 = 0;
  const actionAt = (t) => {       // the recorded command at time t (Teach.pre's interpolation)
    let i = 0; while (i < n0 - 2 && T[i + 1] < t) i++;
    const i2 = Math.min(n0 - 1, i + 1), span = T[i2] - T[i] || 1, f = Math.max(0, Math.min(1, (t - T[i]) / span));
    return D.act[i].map((a, q) => a + (D.act[i2][q] - a) * f);
  };
  const qNow = () => { for (let i = 0; i < 6; i++) qbuf[i] = d.qpos[i]; return qbuf; };   // as Teach.sample()
  const buf = [0, 0, 0];
  for (let step = 0; ; step++) {
    const t = d.time - rt0;
    // divergence: the replay at the recorded frames' times (the recorder samples after a mission check)
    while (j0 < n0 && T[j0] <= t + ts / 2) {
      if (Math.abs(T[j0] - t) <= ts / 2) {
        const q = toDemoUnits(qNow(), grip), o = toDemoUnits(D.obs[j0], grip);
        for (let i = 0; i < 5; i++) errJ.push(Math.abs(q[i] - o[i]));
        errG.push(Math.abs(q[5] - o[5]));
        if (recEnv) for (const s of [recEnv[j0].target, recEnv[j0].next]) {
          if (!s || !world.o[s.item]) continue;
          const p = world.com(s.item, buf);
          const e = Math.hypot(p[0] - s.pos[0], p[1] - s.pos[1], p[2] - s.pos[2]) * 1000;
          errItem.push(e);
          if (!perItem.has(s.item) || perItem.get(s.item)[0] < e) perItem.set(s.item, [e, T[j0]]);
          errYaw.push(Math.abs(Math.atan2(Math.sin(world.yaw(s.item) - s.yaw), Math.cos(world.yaw(s.item) - s.yaw))) * 180 / Math.PI);
        }
      }
      j0++;
    }
    // dataset frame k at t = k / 30 (the physics step nearest to it)
    if (k / FPS <= tEnd + 1e-9 && t + ts / 2 >= k / FPS) {
      const run = S.ux.wasteRun();
      frames.push({ frame_index: k, timestamp: k / FPS, 'observation.state': toDemoUnits(qNow(), grip), action: toDemoUnits(actionAt(k / FPS), grip),
        ...(env ? { env: run ? EP.envOf(run, world, buf) : { belt: Math.round(world.belt.speed * 1e4) / 1e4, target: null, next: null } } : {}) });
      if (env) env.push(frames[frames.length - 1].env);
      rt.push(run ? run.t : null);
      if (scene) {
        const t0 = performance.now(), poses = geomPoses(m, d, view.hide()), cp = cameraPoses(mj, m, d, cams);
        for (const c of cp) {
          renderView(scene, poses, c, { width, height, fovy: c.fovy, floorZ: view.floorZ }, rgb, zbuf);
          if (onImage) onImage(c.name, k, rgb);
        }
        renderMs += performance.now() - t0; renders++;
      }
      k++;
    }
    if (t > tEnd + ts) break;
    // the page's order (sim/so101/tests/episodes.test.mjs run()): commands, then the belt and physics, then the check
    if (step % preEvery === 0) teach.pre();
    if (step % checkEvery === 0) { ctl.actualTip(runner.ctx.tip); runner.ctx.gripOpen = d.ctrl[act[5]] > 0.5; }
    plant.mjStep();
    if (step % checkEvery === 0) runner.tick(ts * checkEvery);
  }
  teach.stopReplay();
  // per-item episodes of the replay, from its own mission events (the same cut as the recorder)
  const run = S.ux.wasteRun();
  const segments = env && run ? EP.cutFrames(EP.cutEpisodes(run.events, { end: run.t }), rt) : null;
  const outcome = (segs) => Object.fromEntries((segs || []).map((s) => [s.item, s.outcome]));
  const was = outcome(recSegs), now = outcome(segments);
  const items = [...new Set([...Object.keys(was), ...Object.keys(now)])].sort().map((it) => ({ item: it, recorded: was[it] || null, replay: now[it] || null,
    ...(perItem.has(it) ? { maxMm: r3(perItem.get(it)[0]), atS: r3(perItem.get(it)[1]) } : {}) }));
  const stat = (a) => ({ max: r3(a.length ? Math.max(...a) : 0), p95: r3(pct(a, 0.95)), mean: r3(a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0), n: a.length });
  const report = {
    mission: mission.id, recordedFrames: n0, frames: frames.length, seconds: r3(tEnd), preEvery,
    divergence: { jointsDeg: stat(errJ), gripperPct: stat(errG), itemMm: stat(errItem), itemYawDeg: stat(errYaw) },
    items, sameOutcome: items.filter((x) => x.recorded === x.replay).length,
    // render timing: dataset frames (all cameras each) and single images per second of rendering, PNG encoding excluded
    render: cams.length ? { cameras: cams.map((c) => `${c.name}=${c.preset}`), width, height, frames: renders, images: renders * cams.length, ms: Math.round(renderMs),
      framesPerS: r3(renders / (renderMs / 1000)), imagesPerS: r3(renders * cams.length / (renderMs / 1000)) } : null
  };
  const out = JSON.parse(JSON.stringify(j));
  out.episodes = [{ episode_index: 0, task: j.episodes[0].task, length: frames.length, frames }];
  out.printedrobotics = Object.assign({}, pr, segments ? { segments } : {}, {
    replay: {
      format: REPLAY_FORMAT,
      note: 'Kinematic replay in the SIL runner (tools/sil/replay.mjs): recorded actions written to MuJoCo ctrl, physics ' +
        'simulated again; observation.state, env and segments are the replay\'s, on an exact 30 fps grid (nearest 4 ms step).',
      recorded_segments: recSegs, divergence: report.divergence, items,
      cameras: cams.map((c) => ({ name: c.name, preset: c.preset, about: CAMERA_PRESETS[c.preset].about })), width, height,
      renderer: 'tools/sil/lib/raster.mjs (flat-shaded software rasteriser, no textures or shadows)'
    }
  });
  if (!segments) delete out.printedrobotics.segments;
  return { demo: out, report };
}

/** Per-frame channel sums of an RGB image: [min r g b, max r g b, sum r g b, sum² r g b, pixels] (image stats). */
export function imageSums(rgb) {
  const mn = [255, 255, 255], mx = [0, 0, 0], s = [0, 0, 0], q = [0, 0, 0];
  for (let i = 0; i < rgb.length; i += 3) {
    for (let c = 0; c < 3; c++) { const v = rgb[i + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; s[c] += v; q[c] += v * v; }
  }
  return [...mn, ...mx, ...s, ...q, rgb.length / 3];
}

/**
 * Replay demo files into a folder: OUT/replay-NNN.json (replayed demo JSON, with per-frame image sums for the
 * dataset stats) and OUT/images/NNN/<camera>/frame_KKKKKK.png. Returns the reports.
 */
export async function replayToFolder(demoFiles, out, { cameras = ['up', 'wrist'], width = 320, height = 240, preEvery = 4, pngLevel = 6, log = () => {} } = {}) {
  fs.mkdirSync(out, { recursive: true });
  const sessions = new Map(), reports = [];
  const { MISSIONS } = await imp('src/missions.js');
  for (const [i, file] of demoFiles.entries()) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const mission = MISSIONS.find((x) => x.id === (j.printedrobotics || {}).mission);
    const scene = sceneOfMission(mission);
    if (!sessions.has(scene)) sessions.set(scene, await replaySession(scene));
    const S = sessions.get(scene), tag = String(i).padStart(3, '0'), sums = {};
    let pngMs = 0;
    const onImage = (cam, k, rgb) => {
      (sums[cam] ||= []).push(imageSums(rgb));
      const dir = path.join(out, 'images', tag, cam);
      if (k === 0) fs.mkdirSync(dir, { recursive: true });
      const t0 = performance.now();
      fs.writeFileSync(path.join(dir, `frame_${String(k).padStart(6, '0')}.png`), encodePNG(rgb, width, height, { level: pngLevel }));
      pngMs += performance.now() - t0;
    };
    const t0 = performance.now();
    const { demo, report } = await replayDemo(S, j, { cameras, width, height, onImage, preEvery });
    report.file = path.basename(file); report.wallS = r3((performance.now() - t0) / 1000); report.pngMs = Math.round(pngMs);
    demo.printedrobotics.replay.images = { dir: `images/${tag}`, pattern: '<camera>/frame_{frame_index:06d}.png', sums };
    fs.writeFileSync(path.join(out, `replay-${tag}.json`), JSON.stringify(demo));
    reports.push(report);
    log(`${report.file}: ${report.frames} frames, joints max ${report.divergence.jointsDeg.max}°, items max ${report.divergence.itemMm.max} mm, ` +
      `same outcome ${report.sameOutcome}/${report.items.length}` + (report.render ? `, render ${report.render.imagesPerS} images/s (${report.render.cameras.length} cameras, ${width}x${height})` : ''));
  }
  return reports;
}
