// LeRobot dataset (v2.1, with camera images) from a tools/sil/replay.mjs output folder — printedrobotics.cz.
// The same exporter as the browser (sim/so101/src/export/lerobot.js buildDataset); the PNG frames are read from disk.
// tools/hf/demos_to_lerobot.py --images writes the same dataset from the same folder.
import fs from 'node:fs';
import path from 'node:path';
import { SO101 } from './plant.mjs';

/** Replayed demos of a replay folder, in order (replay-000.json, replay-001.json, …). */
export function readReplays(dir) {
  return fs.readdirSync(dir).filter((f) => /^replay-\d{3}\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

/** PNG of frame k of camera `cam` of a replayed demo (its printedrobotics.replay.images.dir under `dir`). */
export function framePath(dir, demo, cam, k) {
  const rel = demo.printedrobotics.replay.images.dir;
  if (!/^images\/\d{3}$/.test(rel) || !/^[A-Za-z0-9_.-]+$/.test(cam)) throw new Error('bad image path in the replay');
  return path.join(dir, rel, cam, `frame_${String(k).padStart(6, '0')}.png`);
}

/** Write the dataset of replay folder `dir` into `outDir`. Returns meta/info.json plus `dropped` (items left out). */
export async function writeImageDataset(dir, outDir, { keepDiverged = false, perItem = true, envState = true, repoId, license, task } = {}) {
  process.removeAllListeners('warning');
  const { buildDataset } = await import(path.join(SO101, 'src/export/lerobot.js'));
  const demos = readReplays(dir);
  if (!demos.length) throw new Error('no replay-NNN.json in ' + dir);
  const files = await buildDataset(demos, { keepDiverged, perItem, envState, repoId, license, task, images: (i, cam, k) => fs.readFileSync(framePath(dir, demos[i], cam, k)) });
  for (const [f, v] of Object.entries(files)) {
    const p = path.join(outDir, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, v);
  }
  const info = JSON.parse(files['meta/info.json']);
  const dropped = keepDiverged || !perItem ? [] : demos.flatMap((j) => (j.printedrobotics.replay.items || []).filter((x) => x.recorded !== x.replay).map((x) => `${x.item} (${x.recorded || 'no episode'} -> ${x.replay || 'no episode'})`));
  return Object.assign(info, dropped.length ? { dropped } : {});
}
