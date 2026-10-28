// Load the vendored MuJoCo WASM + the scene in node (for unit tests).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function loadScene() {
  const loadMujoco = (await import(path.join(DIR, 'vendor/mujoco/mujoco.js'))).default;
  const mj = await loadMujoco({ wasmBinary: fs.readFileSync(path.join(DIR, 'vendor/mujoco/mujoco.wasm')) });
  mj.FS.mkdir('/m'); mj.FS.mkdir('/m/assets');
  for (const f of ['scene.xml', 'so101.xml']) mj.FS.writeFile('/m/' + f, fs.readFileSync(path.join(DIR, 'model', f)));
  for (const f of fs.readdirSync(path.join(DIR, 'model/assets'))) mj.FS.writeFile('/m/assets/' + f, fs.readFileSync(path.join(DIR, 'model/assets', f)));
  const m = mj.MjModel.from_xml_path('/m/scene.xml');
  const d = new mj.MjData(m);
  mj.mj_resetDataKeyframe(m, d, 0);
  mj.mj_forward(m, d);
  return { mj, m, d };
}
