// Load the ROBOTO ORIGIN model (vendored MuJoCo WASM + vendored model) and, optionally, the upstream policy
// with the vendored onnxruntime-web in node. Shared by the unit tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = path.join(DIR, 'vendor/roboto_origin');

export async function loadModel() {
  const MJ = path.join(DIR, '../so101/vendor/mujoco');
  const loadMujoco = (await import(pathToFileURL(path.join(MJ, 'mujoco.js')).href)).default;
  const mj = await loadMujoco({ wasmBinary: fs.readFileSync(path.join(MJ, 'mujoco.wasm')) });
  for (const d of ['/o', '/o/mjcf', '/o/meshes']) mj.FS.mkdir(d);
  mj.FS.writeFile('/o/mjcf/scene.xml', fs.readFileSync(path.join(DIR, 'scene.xml')));
  mj.FS.writeFile('/o/mjcf/rpo.xml', fs.readFileSync(path.join(V, 'mjcf/rpo.xml')));
  for (const f of fs.readdirSync(path.join(V, 'meshes'))) mj.FS.writeFile('/o/meshes/' + f, fs.readFileSync(path.join(V, 'meshes', f)));
  const m = mj.MjModel.from_xml_path('/o/mjcf/scene.xml');
  const d = new mj.MjData(m);
  return { mj, m, d };
}

export async function loadPolicy() {
  const O = path.join(DIR, 'vendor/onnxruntime-web');
  const ort = await import(pathToFileURL(path.join(O, 'ort.wasm.min.mjs')).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = pathToFileURL(O + '/').href;
  const s = await ort.InferenceSession.create(fs.readFileSync(path.join(V, 'policy/policy.onnx')), { executionProviders: ['wasm'] });
  return { ort, s, run: async (obs) => (await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', Float32Array.from(obs), [1, obs.length]) }))[s.outputNames[0]].data };
}
