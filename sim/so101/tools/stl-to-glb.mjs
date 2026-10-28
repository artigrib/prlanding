// Build model/visual/so101_visual.glb from the original Menagerie STL files (visual-only, high detail).
// Dev tool, not used at runtime. Usage:
//   mkdir /tmp/gt && cd /tmp/gt && npm i @gltf-transform/core@4.2.1 @gltf-transform/extensions@4.2.1 \
//     @gltf-transform/functions@4.2.1 meshoptimizer@0.22.0
//   (download the STLs listed below from mujoco_menagerie/robotstudio_so101/assets into STL_DIR)
//   NODE_PATH=/tmp/gt/node_modules node sim/so101/tools/stl-to-glb.mjs STL_DIR [simplifyRatio]
//
// Output keeps the raw STL coordinates (app maps them into MuJoCo's mesh frame with mesh_pos / mesh_quat).
// Positions + indices only: normals are computed in the browser with a crease angle (smaller download).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Document, NodeIO } = require('@gltf-transform/core');
const { EXTMeshoptCompression, KHRMeshQuantization } = require('@gltf-transform/extensions');
const { reorder, quantize, meshopt, simplify, weld } = require('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptSimplifier } = require('meshoptimizer');

export const MESHES = [
  'base_motor_holder_so101_v1', 'base_so101_v2', 'motor_holder_so101_base_v1', 'motor_holder_so101_wrist_v1',
  'moving_jaw_so101_v1', 'rotation_pitch_so101_v1', 'sts3215_03a_no_horn_v1', 'sts3215_03a_v1',
  'under_arm_so101_v1', 'upper_arm_so101_v1', 'waveshare_mounting_plate_so101_v2',
  'wrist_roll_follower_so101_camera_mount', 'wrist_roll_follower_so101_v1', 'wrist_roll_pitch_so101_v2'
];

const dir = process.argv[2];
const ratio = +(process.argv[3] || 1);
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../model/visual/so101_visual.glb');

function readSTL(file) {
  const b = fs.readFileSync(file), n = b.readUInt32LE(80);
  const map = new Map(), pos = [], idx = new Uint32Array(n * 3);
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const o = 84 + t * 50 + 12 + k * 12;
    const x = b.readFloatLE(o), y = b.readFloatLE(o + 4), z = b.readFloatLE(o + 8);
    const key = x + ',' + y + ',' + z;
    let v = map.get(key);
    if (v === undefined) { v = pos.length / 3; map.set(key, v); pos.push(x, y, z); }
    idx[3 * t + k] = v;
  }
  return { pos: new Float32Array(pos), idx, tris: n };
}

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const doc = new Document();
doc.getRoot().getAsset().copyright = 'SO-101 (The Robot Studio) via MuJoCo Menagerie robotstudio_so101, Apache-2.0; converted by printedrobotics.cz';
const buf = doc.createBuffer();
const scene = doc.createScene('so101');
let tris = 0;
for (const name of MESHES) {
  const { pos, idx, tris: n } = readSTL(path.join(dir, name + '.stl'));
  tris += n;
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh));
}
await doc.transform(
  weld(),
  ...(ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0004 })] : []),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 14 }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' })
);
doc.createExtension(KHRMeshQuantization).setRequired(true);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await io.write(OUT, doc);
let outTris = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) outTris += p.getIndices().getCount() / 3;
console.log(`STL triangles ${tris}, GLB triangles ${outTris}, ${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB -> ${OUT}`);
