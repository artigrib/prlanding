// Arena bundle: src/main.js -> build/ (committed; CI checks the output is reproducible).
//   npm ci && npm run build
// - three and three/addons/* stay external: index.html maps them to the site's single vendored copy
//   (vendor/three/, built by tools/vendor-three.mjs from the same pinned three), shared with the product pages
//   and the SO-101 sim.
// - Rapier: @dimforge/rapier3d-compat inlines its wasm as base64 in JS (2.1 MB of a 2.2 MB chunk). The plugin
//   below drops the base64 string and lets init() fetch the package's own rapier_wasm3d_bg.wasm (byte-identical
//   to the inlined one, checked at build time), emitted next to the chunk with a content hash, so the browser
//   can compile it while it streams.
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const RAPIER_VERSION = '0.19.3';
const rapierPkg = path.resolve('node_modules/@dimforge/rapier3d-compat');

const rapierWasmFile = {
  name: 'rapier-wasm-file',
  setup(b) {
    b.onLoad({ filter: /rapier3d-compat[\\/]rapier\.mjs$/ }, async (args) => {
      const ver = JSON.parse(fs.readFileSync(path.join(rapierPkg, 'package.json'), 'utf8')).version;
      if (ver !== RAPIER_VERSION) throw new Error(`rapier3d-compat ${ver}: re-check the init() patch in build.mjs (written for ${RAPIER_VERSION})`);
      const src = fs.readFileSync(args.path, 'utf8');
      // function dg(){return lg(this,void 0,void 0,(function*(){yield xA(Lg.toByteArray("<base64>").buffer)}))}
      const re = /function ([\w$]+)\(\)\{return ([\w$]+)\(this,void 0,void 0,\(function\*\(\)\{yield ([\w$]+)\([\w$]+\.toByteArray\("([A-Za-z0-9+/=]+)"\)\.buffer\)\}\)\)\}/g;
      const hits = [...src.matchAll(re)];
      if (hits.length !== 1) throw new Error(`rapier.mjs: expected one inlined-wasm init(), found ${hits.length}`);
      const [whole, init, awaiter, wbgInit, b64] = hits[0];
      const wasm = fs.readFileSync(path.join(rapierPkg, 'rapier_wasm3d_bg.wasm'));
      if (!Buffer.from(b64, 'base64').equals(wasm)) throw new Error('rapier.mjs: inlined wasm differs from rapier_wasm3d_bg.wasm');
      const patched = `function ${init}(I){return ${awaiter}(this,void 0,void 0,(function*(){yield ${wbgInit}(I||{module_or_path:new URL(__rapierWasm,import.meta.url)})}))}`;
      return { contents: `import __rapierWasm from './rapier_wasm3d_bg.wasm';\n` + src.replace(whole, patched), loader: 'js', resolveDir: path.dirname(args.path) };
    });
  },
};

fs.rmSync('build', { recursive: true, force: true });
await esbuild.build({
  entryPoints: ['src/main.js'], bundle: true, format: 'esm', splitting: true, minify: true, target: 'es2020',
  outdir: 'build', entryNames: 'arena', chunkNames: '[name]-[hash]', assetNames: 'rapier-[hash]',
  legalComments: 'external', external: ['three', 'three/addons/*'],
  loader: { '.wasm': 'file' }, plugins: [rapierWasmFile], logLevel: 'warning',
});
for (const f of fs.readdirSync('build').sort()) console.log(String(fs.statSync(path.join('build', f)).size).padStart(9), 'build/' + f);
