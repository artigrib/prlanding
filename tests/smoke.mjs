// Playwright smoke test. Usage: node tests/smoke.mjs  (needs a server on BASE, default http://127.0.0.1:8123)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const IGNORE = /fonts\.(googleapis|gstatic)\.com/i;
let failed = 0;

const browser = await chromium.launch();

async function check(name, path, fn) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.location().url || '') && !IGNORE.test(m.text())
    && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !IGNORE.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  try {
    const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 30000 });
    if (!res || !res.ok()) errors.push('navigation status ' + (res && res.status()));
    await fn(page);
  } catch (e) { errors.push('failed: ' + e.message.split('\n')[0]); }
  if (errors.length) { failed++; console.log(`FAIL ${name}\n  ` + errors.join('\n  ')); }
  else console.log(`ok   ${name}`);
  await ctx.close();
}

await check('home', '/', async p => {
  await p.waitForSelector('#cards .card');
  if ((await p.locator('#cards .card').count()) < 3) throw new Error('too few cards');
});

await check('catalog filter', '/', async p => {
  await p.waitForSelector('#filters .filter');
  const before = await p.locator('#cards .card:visible').count();
  const btns = p.locator('#filters .filter');
  const n = await btns.count();
  if (n < 2) throw new Error('no filter buttons');
  await btns.nth(1).click();
  await p.waitForTimeout(300);
  const after = await p.locator('#cards .card:visible').count();
  if (after === 0) throw new Error('filter left zero cards');
  if (after >= before) throw new Error(`filter did not narrow (${before} -> ${after})`);
});

for (const id of ['so101', 'svrn', 'vert150']) {
  await check('product ' + id, `/sada/${id}/`, async p => {
    await p.waitForSelector('h1');
    if (!(await p.locator('h1').first().innerText()).trim()) throw new Error('empty h1');
  });
}

await check('sim so101', '/sim/so101/?test=1', async p => {
  await p.waitForFunction(() => window.__sim, null, { timeout: 90000 });
  const err = await p.evaluate(() => window.__sim.error);
  if (err) throw new Error('sim error: ' + err);
});

await check('arena svrn', '/sim/arena/?robot=svrn', async p => {
  await p.waitForSelector('#pick > *', { timeout: 60000 });
  await p.waitForSelector('#maps > *', { timeout: 60000 });
  if ((await p.locator('#pick > *').count()) < 2) throw new Error('robot menu not rendered');
});

await browser.close();
process.exit(failed ? 1 : 0);
