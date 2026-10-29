// Smoke test of the built Hugging Face Spaces (dist-hf/*), each served at its own root like on huggingface.co.
// Usage: node tools/hf/build-space.mjs && node tests/smoke-space.mjs
//   (starts python3 -m http.server per Space on a free port; needs playwright)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
async function serve(dir) {
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  return { base: `http://127.0.0.1:${port}`, stop: () => proc.kill() };
}

const browser = await chromium.launch();
let failed = 0;
async function check(name, dir, path, fn) {
  const srv = await serve(dir);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(srv.base)) errors.push(`HTTP ${r.status()} ${r.url().slice(srv.base.length)}`); });
  try { await page.goto(srv.base + path, { waitUntil: 'load', timeout: 30000 }); await fn(page); }
  catch (e) { errors.push('failed: ' + e.message.split('\n')[0]); }
  if (errors.length) { failed++; console.log(`FAIL ${name}\n  ` + errors.join('\n  ')); } else console.log(`ok   ${name}`);
  await page.close(); srv.stop();
}

await check('space so101-sim: sim loads, "Připojit AI" panel modules resolve', 'dist-hf/so101-sim', '/sim/so101/?test=1&lang=cs', async (p) => {
  await p.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 120000 });
  const err = await p.evaluate(() => window.__sim.error);
  if (err) throw new Error('sim error: ' + err);
  if ((await p.locator('#ai-open').count()) !== 1) throw new Error('"Připojit AI" button missing');
  const t = await p.evaluate(async () => {
    const m = await import(new URL('src/agent/panel.js', location.href).href);
    return typeof m.mountAgentPanel;
  });
  if (t !== 'function') throw new Error('panel.js did not load: ' + t);
});

await check('space arena: menu renders', 'dist-hf/arena', '/sim/arena/?robot=svrn', async (p) => {
  await p.waitForSelector('#pick > *', { timeout: 60000 });
});

await browser.close();
process.exit(failed ? 1 : 0);
