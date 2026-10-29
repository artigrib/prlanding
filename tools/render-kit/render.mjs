// Catalogue renders of a kit model in the five print colours: img/<id>_<colour>.jpg (1200×900).
// Usage (repo root served on BASE; three.js from the site's vendor/three/):
//   python3 -m http.server 8123 &  node tools/render-kit/render.mjs svrn [show=opt_modul_flipper] [az=35] [el=26]
// Needs Playwright (require('playwright') / NODE_PATH). Headless SwiftShader is fine (it is slow, not wrong).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const [id = 'svrn', ...rest] = process.argv.slice(2);
const arg = (k, d) => { const a = rest.find(x => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };
const show = arg('show', '').split(',').filter(Boolean);
const COLORS = { white: '#F2F2EE', grey: '#9A9A94', black: '#2A2A2A', orange: '#E8461E', blue: '#1F3BFF' };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', e => { console.error(e); process.exitCode = 1; });
await page.goto(`${BASE}/tools/render-kit/render.html`);
await page.waitForFunction(() => window.ready);
for (const [name, hex] of Object.entries(COLORS)) {
  const url = await page.evaluate(o => window.renderKit(o), {
    model: `../../models/${id}.glb`, show, color: hex, w: 2400, h: 1800,
    az: +arg('az', 35), el: +arg('el', 26), dist: +arg('dist', 4.2), jpeg: { w: 1200, h: 900, q: 0.86 }
  });
  const file = path.join(ROOT, 'img', `${id}_${name}.jpg`);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(file, fs.statSync(file).size, 'bytes');
}
await browser.close();
