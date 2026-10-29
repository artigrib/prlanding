// Vendors the MuJoCo WebAssembly build into sim/so101/vendor/mujoco/ reproducibly.
//
//   cd tools/wasm && npm ci && npm run vendor   # rewrite the vendored files from the pinned npm package
//   cd tools/wasm && npm ci && npm run check    # CI: fail if the committed files differ from that output
//
// mujoco.js is copied unchanged. mujoco.wasm is passed through wabt's `wasm-strip`, which removes every
// custom section (DWARF .debug_*, the `name` section, sourceMappingURL). Those sections are only used by
// debuggers; the code, data and export sections are byte-identical, so behaviour does not change.
// Upstream 3.17.0: 10 927 842 B -> 5 020 765 B raw.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PKG = path.join(HERE, 'node_modules/@mujoco/mujoco');
const DEST = path.join(ROOT, 'sim/so101/vendor/mujoco');
const STRIP = path.join(HERE, 'node_modules/.bin/wasm-strip');
const check = process.argv.includes('--check');

if (!fs.existsSync(PKG) || !fs.existsSync(STRIP)) {
  console.error('Run `npm ci` in tools/wasm first.');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mujoco-'));
const out = {
  'mujoco.js': fs.readFileSync(path.join(PKG, 'mujoco.js')),
  'mujoco.wasm': (() => {
    const o = path.join(tmp, 'mujoco.wasm');
    execFileSync(STRIP, [path.join(PKG, 'mujoco.wasm'), '-o', o], { stdio: 'inherit' });
    return fs.readFileSync(o);
  })(),
};
fs.rmSync(tmp, { recursive: true, force: true });

await WebAssembly.compile(out['mujoco.wasm']);   // the stripped module must still be valid

const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
let bad = 0;
for (const [name, buf] of Object.entries(out)) {
  const dest = path.join(DEST, name);
  const cur = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
  const same = cur && Buffer.compare(cur, buf) === 0;
  if (check) {
    console.log(`${same ? 'ok  ' : 'DIFF'} ${name} ${buf.length} B sha256:${sha(buf)}${same ? '' : ` (committed: ${cur ? cur.length + ' B sha256:' + sha(cur) : 'missing'})`}`);
    if (!same) bad++;
  } else {
    if (!same) fs.writeFileSync(dest, buf);
    console.log(`${same ? 'unchanged' : 'wrote    '} ${path.relative(ROOT, dest)} ${buf.length} B sha256:${sha(buf)}`);
  }
}
if (bad) { console.error('Committed MuJoCo files are not the output of tools/wasm/vendor-mujoco.mjs. Run `npm run vendor` there.'); process.exit(1); }
