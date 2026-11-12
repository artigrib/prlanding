#!/usr/bin/env node
// Kinematic replay of simulator demonstrations into camera frames and a LeRobot dataset — printedrobotics.cz.
//
//   node tools/sil/replay.mjs demo.json [more.json …] -o OUT [--camera up --camera wrist] [--camera-size 320x240]
//
// For every demo JSON downloaded from the browser sim (Teach → "Stáhnout ukázku"), the recorded actions are replayed
// in the same MuJoCo scene in node (tools/sil/lib/replay.mjs: the browser's replay code, no servo emulation) and the
// virtual cameras (tools/sil/lib/camera.mjs presets) are rendered at 30 fps. OUT gets
//   replay-NNN.json           the replayed demo (observation.state, env and per-item segments of the replay)
//   images/NNN/<cam>/*.png    one PNG per frame and camera
//   report.json               divergence replay vs recording, item outcomes, render speed
//   lerobot/                  LeRobot v2.1 dataset with observation.images.<cam> (unless --no-dataset)
// Episodes whose item ended differently in the replay than in the recording are left out of the dataset
// (--keep-diverged keeps them, labelled with the replay's outcome). Then convert to v3.0 and train with LeRobot:
// docs/lerobot-export.md, navody/so101-lerobot-kamery (CZ), en/guides/so101-lerobot-cameras (EN).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { replayToFolder } from './lib/replay.mjs';
import { parseSize } from './lib/camera.mjs';

const HELP = `Kinematic replay of SO-101 simulator demos -> camera frames -> LeRobot dataset

Usage: node tools/sil/replay.mjs DEMO.json [DEMO.json ...] -o OUT [options]

Options:
  -o, --out DIR          output folder (created; must be empty or missing)
  --camera NAME[=VIEW]   camera to render (VIEW: up, side, front, wrist; default: --camera up --camera wrist)
  --camera-size WxH      image size (default 320x240)
  --pre-every N          physics steps (4 ms) between ctrl updates (default 4 = the page's 16 ms frame)
  --no-dataset           only replay and render (no LeRobot dataset)
  --keep-diverged        keep episodes whose item outcome changed in the replay
  --no-env-state         leave observation.environment_state out of the dataset (cameras + joints only: a policy
                         trained on that could also run on a real arm, which has no item-state sensor)
  --repo-id ID           dataset name in the dataset card
  --whole                one episode per demo instead of one per item
  -h, --help`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' }, camera: { type: 'string', multiple: true, default: [] },
    'camera-size': { type: 'string', default: '320x240' }, 'pre-every': { type: 'string', default: '4' },
    'no-dataset': { type: 'boolean', default: false }, 'no-env-state': { type: 'boolean', default: false }, 'keep-diverged': { type: 'boolean', default: false },
    'repo-id': { type: 'string' }, whole: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false }
  }
});
if (opt.help || !positionals.length || !opt.out) { console.log(HELP); process.exit(opt.help ? 0 : 2); }
if (fs.existsSync(opt.out) && fs.readdirSync(opt.out).length) { console.error('output folder is not empty: ' + opt.out); process.exit(2); }
const [width, height] = parseSize(opt['camera-size']);
const cameras = opt.camera.length ? opt.camera : ['up', 'wrist'];
const log = (...a) => console.log('[replay]', ...a);
const reports = await replayToFolder(positionals, opt.out, { cameras, width, height, preEvery: Math.max(1, +opt['pre-every'] || 4), log });
fs.writeFileSync(path.join(opt.out, 'report.json'), JSON.stringify(reports, null, 1) + '\n');
if (!opt['no-dataset']) {
  const { writeImageDataset } = await import('./lib/dataset.mjs');
  const info = await writeImageDataset(opt.out, path.join(opt.out, 'lerobot'), { keepDiverged: opt['keep-diverged'], perItem: !opt.whole, envState: !opt['no-env-state'], repoId: opt['repo-id'] });
  log(`dataset ${path.join(opt.out, 'lerobot')}: ${info.total_episodes} episode(s), ${info.total_frames} frames, cameras ${cameras.join(', ')}` +
    (info.dropped ? `; left out (outcome changed in the replay): ${info.dropped.join(', ')}` : ''));
}
