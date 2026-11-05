// Record the /3d/ flythrough into a WebP image sequence by driving the live renderer (fly.js ?capture)
// at evenly spaced thesis positions. Usage (server on BASE): node tools/seq/record.mjs [desktop|mobile] [frames]
// Needs Playwright + ffmpeg (for WebP). Output: 3d/seq/<set>/NNN.webp + 3d/seq/manifest.json
import fs from 'node:fs'; import {execFileSync} from 'node:child_process'; import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const SETS = {desktop: {w: 1600, h: 900, dpr: 1, frames: 150, q: 82}, mobile: {w: 540, h: 1170, dpr: 1, frames: 80, q: 80}};
const name = process.argv[2] || 'desktop', S = {...SETS[name]}; if (process.argv[3]) S.frames = +process.argv[3];
const dir = `3d/seq/${name}`, tmp = `/tmp/seq-${name}`;
fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir, {recursive: true}); fs.mkdirSync(tmp, {recursive: true});
const b = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const p = await b.newPage({viewport: {width: S.w, height: S.h}, deviceScaleFactor: S.dpr});
p.on('pageerror', e => console.error('pageerror', e.message));
await p.goto(`${BASE}/3d/?capture`, {waitUntil: 'load'});
await p.waitForFunction(() => window.ready === true, null, {timeout: 600000});
await p.addStyleTag({content: 'body>*:not(#c){visibility:hidden!important}'});
const N = await p.evaluate(() => document.querySelectorAll('.t').length - 1);
let bytes = 0;
for (let i = 0; i < S.frames; i++) {
  await p.evaluate(u => { window.__at(u); window.__at(u); }, i / (S.frames - 1) * N);
  const png = `${tmp}/${i}.png`, out = `${dir}/${String(i).padStart(3, '0')}.webp`;
  await p.screenshot({path: png});
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-quality', String(S.q), '-compression_level', '6', out]);
  bytes += fs.statSync(out).size; if (i % 10 === 0) console.log(name, i, (bytes / 1024 / (i + 1)).toFixed(1) + ' KB/frame avg');
}
await b.close();
const mf = '3d/seq/manifest.json', M = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf)) : {};
M[name] = {dir: name, frames: S.frames, width: S.w * S.dpr, height: S.h * S.dpr, bytes};
fs.writeFileSync(mf, JSON.stringify(M, null, 1) + '\n');
console.log('done', name, S.frames, 'frames', (bytes / 1048576).toFixed(2), 'MB');
