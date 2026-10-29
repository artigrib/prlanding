// Size budget for the vendored MuJoCo wasm (tools/wasm/vendor-mujoco.mjs strips debug/name sections),
// and the loader's engine size label must match the files it describes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasm = fs.readFileSync(path.join(DIR, 'vendor/mujoco/mujoco.wasm'));
const js = fs.statSync(path.join(DIR, 'vendor/mujoco/mujoco.js')).size;

function customSections(buf) {
  const names = [];
  let i = 8;
  const uleb = () => { let r = 0, s = 0, b; do { b = buf[i++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  while (i < buf.length) {
    const id = buf[i++], size = uleb(), end = i + size;
    if (id === 0) { const n = uleb(); names.push(buf.subarray(i, i + n).toString('utf8')); }
    i = end;
  }
  return names;
}

test('mujoco.wasm has no custom (debug/name) sections and stays under 6 MB', () => {
  assert.deepEqual(customSections(wasm), []);
  assert.ok(wasm.length < 6e6, `mujoco.wasm is ${wasm.length} B; run tools/wasm (npm run vendor)`);
});

test('loader engine size label matches mujoco.wasm + mujoco.js', () => {
  const mb = Math.round((wasm.length + js) / 1e5) / 10;           // decimal MB, one digit
  const cs = mb.toLocaleString('cs-CZ'), en = String(mb);
  assert.match(fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'), new RegExp(`MB = ${en.replace('.', '\\.')},`));
  assert.ok(fs.readFileSync(path.join(DIR, 'index.html'), 'utf8').includes(`MuJoCo (${cs} MB)`), `index.html should say ${cs} MB`);
  const dict = fs.readFileSync(path.join(DIR, 'src/i18n/en.js'), 'utf8');
  assert.ok(dict.includes(`MuJoCo (${cs} MB)`) && dict.includes(`engine (${en} MB)`), `en.js should say ${en} MB`);
});
