// Shrink a converted GLB to the per-object budget: weld + meshopt simplify (attributes kept), WebP texture,
// quantization and EXT_meshopt_compression. Tries the best quality first and steps down until it fits.
// Usage: node optimize_glb.mjs <in.glb> <out.glb> '{"maxBytes":307200,"textureSizes":[...],"triangleTargets":[...]}'
// Prints one JSON line: { bytes, triangles, texture, attempts }.
import { readFileSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, reorder, textureCompress, meshopt, normals } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [src, dst, cfgText] = process.argv.slice(2);
const cfg = JSON.parse(cfgText || '{}');
const maxBytes = cfg.maxBytes ?? 307200;
const texSizes = cfg.textureSizes ?? [512, 256, 128];
const triTargets = cfg.triangleTargets ?? [12000, 6000, 3000];

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const input = readFileSync(src);

function triangles(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
}

async function attempt(tex, tris) {
  const doc = await io.readBinary(new Uint8Array(input));
  await doc.transform(dedup(), weld());
  const t0 = triangles(doc);
  if (t0 > tris) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: tris / t0, error: 0.01, lockBorder: false }));
  }
  await doc.transform(
    normals({ overwrite: false }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 82 }),
    prune(), reorder({ encoder: MeshoptEncoder }), quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' })
  );
  const bytes = await io.writeBinary(doc);
  return { bytes, triangles: Math.round(triangles(doc)), texture: tex };
}

// quality ladder: alternate texture and geometry reductions
const ladder = [];
for (let i = 0; i < Math.max(texSizes.length, triTargets.length); i++) {
  ladder.push([texSizes[Math.min(i, texSizes.length - 1)], triTargets[Math.min(i, triTargets.length - 1)]]);
  if (i + 1 < triTargets.length) ladder.push([texSizes[Math.min(i, texSizes.length - 1)], triTargets[i + 1]]);
}
let best = null, attempts = 0;
for (const [tex, tris] of ladder) {
  attempts++;
  const r = await attempt(tex, tris);
  if (!best || r.bytes.length < best.bytes.length) best = r;
  if (r.bytes.length <= maxBytes) { best = r; break; }
}
writeFileSync(dst, best.bytes);
console.log(JSON.stringify({ bytes: best.bytes.length, triangles: best.triangles, texture: best.texture, attempts }));
