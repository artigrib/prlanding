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

// tex = 0: drop textures, keeping each material's mean texture colour as its base colour factor
async function flattenTextures(doc) {
  for (const mat of doc.getRoot().listMaterials()) {
    const t = mat.getBaseColorTexture();
    if (!t) continue;
    const { channels } = await sharp(Buffer.from(t.getImage())).stats();
    const f = mat.getBaseColorFactor();
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    mat.setBaseColorFactor([f[0] * lin(channels[0].mean), f[1] * lin(channels[1].mean), f[2] * lin(channels[2].mean), f[3]]);
    mat.setBaseColorTexture(null);
  }
  for (const m of doc.getRoot().listMaterials()) { m.setNormalTexture(null); m.setMetallicRoughnessTexture(null); m.setOcclusionTexture(null); }
  // without textures, UVs and split normals only block welding/simplification at seams
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    for (const sem of p.listSemantics()) if (sem.startsWith('TEXCOORD_') || sem === 'NORMAL' || sem === 'TANGENT') p.setAttribute(sem, null);
  }
}

async function attempt(tex, tris, error) {
  const doc = await io.readBinary(new Uint8Array(input));
  if (tex === 0) await flattenTextures(doc);
  await doc.transform(dedup(), weld());
  const t0 = triangles(doc);
  if (t0 > tris) {
    // error caps how far geometry may deviate (fraction of mesh extent); later rungs allow more
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: tris / t0, error, lockBorder: false }));
  }
  await doc.transform(
    normals({ overwrite: false }),  // recomputed where missing (e.g. after flattenTextures)
    ...(tex > 0 ? [textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 82 })] : []),
    prune(), reorder({ encoder: MeshoptEncoder }), quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' })
  );
  const bytes = await io.writeBinary(doc);
  return { bytes, triangles: Math.round(triangles(doc)), texture: tex, error };
}

// quality ladder: alternate texture and geometry reductions
const ladder = [];
for (let i = 0; i < Math.max(texSizes.length, triTargets.length); i++) {
  ladder.push([texSizes[Math.min(i, texSizes.length - 1)], triTargets[Math.min(i, triTargets.length - 1)]]);
  if (i + 1 < triTargets.length) ladder.push([texSizes[Math.min(i, texSizes.length - 1)], triTargets[i + 1]]);
}
// last resorts: coarser geometry, then a plain (untextured) colour
const minTex = texSizes[texSizes.length - 1], minTris = triTargets[triTargets.length - 1];
ladder.push([minTex, minTris, 0.05], [minTex, Math.round(minTris / 2), 0.1], [0, Math.round(minTris / 2), 0.1]);
let best = null, attempts = 0;
for (const [tex, tris, err] of ladder) {
  attempts++;
  const r = await attempt(tex, tris, err ?? 0.01);
  if (!best || r.bytes.length < best.bytes.length) best = r;
  if (r.bytes.length <= maxBytes) { best = r; break; }
}
writeFileSync(dst, best.bytes);
console.log(JSON.stringify({ bytes: best.bytes.length, triangles: best.triangles, texture: best.texture,
  simplify_error: best.error, attempts }));
