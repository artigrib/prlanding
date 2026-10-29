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

/** The object-mission scene (src/objects/scene.js) compiled in node. Returns { mj, m, d, items, sizes }. */
export async function loadObjectScene() {
  const { pathToFileURL } = await import('node:url');
  const { ObjectLibrary, injectObjects, instanceXml } = await import('../src/objects/library.js');
  const { objectSceneXml, itemSize } = await import('../src/objects/scene.js');
  const OBJ = path.join(DIR, 'objects');
  const fsFetch = async (u) => {
    const b = fs.readFileSync(new URL(u));
    return { ok: true, status: 200, json: async () => JSON.parse(b), text: async () => b.toString('utf8'),
      arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
  const lib = new ObjectLibrary({ base: pathToFileURL(OBJ + '/'), fetch: fsFetch });
  const { xml, items } = await objectSceneXml(fs.readFileSync(path.join(DIR, 'model/scene.xml'), 'utf8'), lib, { injectObjects, instanceXml });
  const loadMujoco = (await import(path.join(DIR, 'vendor/mujoco/mujoco.js'))).default;
  const mj = await loadMujoco({ wasmBinary: fs.readFileSync(path.join(DIR, 'vendor/mujoco/mujoco.wasm')) });
  mj.FS.mkdir('/m'); mj.FS.mkdir('/m/assets');
  mj.FS.writeFile('/m/so101.xml', fs.readFileSync(path.join(DIR, 'model', 'so101.xml')));
  mj.FS.writeFile('/m/scene_objects.xml', xml);
  for (const f of fs.readdirSync(path.join(DIR, 'model/assets'))) mj.FS.writeFile('/m/assets/' + f, fs.readFileSync(path.join(DIR, 'model/assets', f)));
  const m = mj.MjModel.from_xml_path('/m/scene_objects.xml');
  const d = new mj.MjData(m);
  mj.mj_resetDataKeyframe(m, d, 0);
  mj.mj_forward(m, d);
  return { mj, m, d, items, sizes: Object.fromEntries(items.map((it) => [it.name, itemSize(it)])), xml };
}
