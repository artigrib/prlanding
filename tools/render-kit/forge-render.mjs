// Forge renders: an add-on part (STL from a forge job) on the SO-101, in the assembly-step style of
// tools/render-kit/so101-steps.html (neutral grey robot, the step's part in the accent orange, ghost +
// dashed arrow for the exploded position, language-neutral screw legend).
// Usage (repo root served on BASE):  node tools/render-kit/forge-render.mjs <job_dir>
// Reads <job_dir>/render_spec.json (written by backend/forge/forge/pipeline.py: steps with world
// anchors already computed for each pose) and the STL files it names; writes
// <job_dir>/renders/<id>-1200.{webp,jpg} and <id>-600.{webp,jpg} (each < 120 KB).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const job = path.resolve(process.argv[2] || '.');
const spec = JSON.parse(fs.readFileSync(path.join(job, 'render_spec.json'), 'utf8'));
const OUT = path.join(job, 'renders');
const LIMIT = 120 * 1024;

// binary or ASCII STL -> flat triangle array (mm)
function readStl(file) {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(80);
  if (b.length === 84 + n * 50) {
    const out = new Array(n * 9);
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[i * 9 + k] = b.readFloatLE(84 + i * 50 + 12 + k * 4);
    return out;
  }
  return [...b.toString('utf8').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => { console.error(e); process.exitCode = 1; });
await page.goto(`${BASE}/tools/render-kit/so101-steps.html`);
await page.waitForFunction(() => window.ready);
await page.evaluate((o) => window.setup(o), spec.setup || {});
for (const p of spec.parts) {
  const tris = readStl(path.join(job, p.stl));
  await page.evaluate((o) => window.addPart(o), { key: p.key, body: p.body, tris, kind: p.kind || 'print' });
}
const written = [];
for (const s of spec.steps) {
  let q = { qWebp: 0.82, qJpg: 0.84 }, out;
  for (;;) {
    out = await page.evaluate((o) => window.renderStep(o), { ...s, ...q });
    const big = Object.values(out).some((u) => (u.length - u.indexOf(',') - 1) * 0.75 > LIMIT);
    if (!big || q.qJpg < 0.5) break;
    q = { qWebp: q.qWebp - 0.06, qJpg: q.qJpg - 0.06 };
  }
  const sizes = [];
  for (const [k, url] of Object.entries(out)) {
    const f = path.join(OUT, `${s.id}-${k}`), b = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(f, b); written.push(path.relative(job, f)); sizes.push(`${k} ${(b.length / 1024).toFixed(1)} KB`);
    if (b.length > LIMIT) { console.error(`${f} is over 120 KB`); process.exitCode = 1; }
  }
  console.log(s.id.padEnd(24), sizes.join('  '));
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(written.sort(), null, 1) + '\n');
await browser.close();
