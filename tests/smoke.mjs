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

// home v2: one-click try. CTAs in the first screen, preview never pulls the sims' engines onto the home page
for (const vp of [{ width: 360, height: 780 }, { width: 1440, height: 900 }]) {
  await check(`home CTAs ${vp.width}px`, '/', async p => {
    await p.setViewportSize(vp);
    const sim = p.locator('a[data-cta="hero-sim"]'), arena = p.locator('a[data-cta="hero-arena"]');
    const txt = async l => (await l.innerText()).replace(/\s+/g, ' ');  // app.js glues short words with nbsp
    if (!/Vyzkoušejte SO-101 v prohlížeči/.test(await txt(sim))) throw new Error('primary CTA text');
    if (!/Bojová aréna/.test(await txt(arena))) throw new Error('secondary CTA text');
    const u1 = await sim.evaluate(a => new URL(a.href).pathname), u2 = await arena.evaluate(a => new URL(a.href).pathname);
    if (u1 !== '/sim/so101/' || u2 !== '/sim/arena/') throw new Error(`CTA targets ${u1} ${u2}`);
    const box = await sim.boundingBox();
    if (!box || box.y + box.height > vp.height) throw new Error('primary CTA below the first screen');
    if ((await p.locator('a[data-cta="arena"]').getAttribute('href')) !== 'sim/arena/') throw new Error('arena section CTA');
    if (vp.width > 400 && (await p.evaluate(() => document.documentElement.scrollWidth)) > vp.width) throw new Error('horizontal scroll');
  });
}

await check('home preview stays light', '/', async p => {
  const heavy = [];
  p.on('request', r => { if (/mujoco|three|rapier|\.wasm|\/sim\//i.test(r.url())) heavy.push(r.url()); });
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => { const v = document.querySelector('.hero-video'); return v && v.querySelector('source'); }, null, { timeout: 10000 });
  const poster = await p.locator('.hero-media img').evaluate(i => i.complete && i.naturalWidth);
  if (!poster) throw new Error('poster not loaded');
  await p.waitForTimeout(500);
  if (heavy.length) throw new Error('home loaded sim assets: ' + heavy.join(', '));
});

await check('home reduced motion shows poster only', '/', async p => {
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(800);
  if (await p.locator('.hero-video source').count()) throw new Error('video loaded despite reduced motion');
});

await check('waitlist form (no send)', '/', async p => {
  const f = p.locator('form#waitlist');
  await f.locator('input[type=email]').fill('neplatny');
  await f.locator('button[type=submit]').click();
  await p.waitForFunction(() => /e-mailovou adresu/.test(document.querySelector('#waitlist .soft-msg').textContent));
  if ((await f.locator('input[type=email]').getAttribute('aria-invalid')) !== 'true') throw new Error('invalid e-mail not flagged');
});

// kit pages: static box matches the default tier, structured data without fake offers/ratings
await check('kit so101 static box + structured data', '/sada/so101/', async p => {
  const html = await (await p.request.get(BASE + '/sada/so101/')).text();
  if (!/<ol class="box" id="box">[^]*STS3215[^]*<\/ol>/.test(html)) throw new Error('static box lists no servos');
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map(m => JSON.parse(m[1]));
  if (!lds.some(l => l['@type'] === 'Product') || !lds.some(l => l['@type'] === 'FAQPage' && l.mainEntity.length >= 3)) throw new Error('Product/FAQPage missing');
  if (/"(offers|aggregateRating|review|price)"/.test(html)) throw new Error('fake commerce data in JSON-LD');
});

await check('legacy sada.html redirects', '/sada.html?r=svrn', async p => {
  await p.waitForURL(/\/sada\/svrn\/$/);
  await p.goto(BASE + '/sada.html'); await p.waitForURL(/\/#katalog$/);
});

for (const id of ['so101', 'svrn', 'vert150']) {
  await check('product ' + id, `/sada/${id}/`, async p => {
    await p.waitForSelector('h1');
    if (!(await p.locator('h1').first().innerText()).trim()) throw new Error('empty h1');
  });
}

// content pages: schools + guides. Structured data matches the page, no prices, nav link from every header
const ldOf = html => [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map(m => JSON.parse(m[1]));
await check('pro-skoly: lesson, missions, FAQ, nav', '/pro-skoly/', async p => {
  const html = await (await p.request.get(BASE + '/pro-skoly/')).text();
  const faq = ldOf(html).find(l => l['@type'] === 'FAQPage');
  if (!faq || faq.mainEntity.length !== await p.locator('#faq details').count()) throw new Error('FAQPage JSON-LD does not match the visible questions');
  if (/"(offers|price|aggregateRating|review)"|\d\s?Kč/.test(html)) throw new Error('prices on the schools page');
  const missions = await p.locator('a[href*="sim/so101/?mise="]').evaluateAll(as => [...new Set(as.map(a => new URL(a.href).searchParams.get('mise')))]);
  for (const id of ['bowl', 'stack', 'sort', 'ball', 'trace', 'line', 'breakfast', 'tidy', 'workshop', 'lab']) if (!missions.includes(id)) throw new Error('mission link missing: ' + id);
  if (/trida=1/.test(html)) throw new Error('links a class mode that does not exist');
  if ((await p.locator('.nav a[aria-current="page"]').innerText()).replace(/\s+/g, ' ').trim() !== 'Pro školy') throw new Error('nav: Pro školy not current');
  if (!(await p.locator('a[href="pro-skoly/pracovni-list/"], a[href$="/pracovni-list/"]').count())) throw new Error('no worksheet link');
});
await check('pro-skoly: pilot form validates and sends type=school', '/pro-skoly/', async p => {
  let sent = null;
  await p.route(/script\.google\.com|formspree/, r => { sent = JSON.parse(r.request().postData() || '{}'); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  const f = p.locator('#pilot-form');
  await f.locator('[name=email]').fill('ucitel@example.cz');
  await f.locator('button[type=submit]').click();
  await p.waitForFunction(() => /školu nebo kroužek/.test(document.querySelector('#pilot-form .soft-msg').textContent));
  if (sent) throw new Error('sent without a school');
  await f.locator('[name=school]').fill('ZŠ Test'); await f.locator('[name=pupils]').fill('8. ročník, 20 žáků');
  await f.locator('button[type=submit]').click();
  await p.waitForFunction(() => /Děkujeme/.test(document.querySelector('#pilot-form').textContent), null, { timeout: 10000 });
  if (!sent || sent.type !== 'school' || sent.school !== 'ZŠ Test' || !/20 žáků/.test(sent.note)) throw new Error('payload ' + JSON.stringify(sent));
});
await check('worksheet prints without site chrome', '/pro-skoly/pracovni-list/', async p => {
  if ((await p.locator('.ws-box').count()) < 5) throw new Error('worksheet tasks missing');
  await p.emulateMedia({ media: 'print' });
  for (const sel of ['.site-h', '.site-f', '[data-print]']) if (await p.locator(sel).first().isVisible()) throw new Error(sel + ' visible in print');
});
for (const [path, nSrc] of [['/navody/', 0], ['/navody/so101-lerobot-prvni-kroky/', 3], ['/navody/bojovi-roboti-150-g/', 2], ['/navody/licence-open-source-hardwaru/', 4]]) {
  await check('guide ' + path, path, async p => {
    const html = await (await p.request.get(BASE + path)).text();
    if (!(await p.locator('h1').innerText()).trim()) throw new Error('empty h1');
    const lds = ldOf(html);
    if (nSrc && !lds.some(l => l['@type'] === 'Article' && l.datePublished)) throw new Error('Article JSON-LD missing');
    if (!lds.some(l => l['@type'] === 'BreadcrumbList')) throw new Error('BreadcrumbList missing');
    if ((await p.locator('#zdroje a[href^="https://"]').count()) < nSrc) throw new Error('too few cited sources');
    if (/Kassow|investor/i.test(html)) throw new Error('forbidden mention');
  });
}
await check('home nav links the schools page', '/', async p => {
  const a = p.locator('.nav a[href="pro-skoly/"]');
  if (!(await a.count())) throw new Error('no Pro školy in the home nav');
});

await check('sim so101', '/sim/so101/?test=1', async p => {
  await p.waitForFunction(() => window.__sim, null, { timeout: 90000 });
  const err = await p.evaluate(() => window.__sim.error);
  if (err) throw new Error('sim error: ' + err);
  await p.waitForFunction(() => window.__sim.ready, null, { timeout: 90000 });
  // "Připojit AI": page API + entry button (the relay connects only when the panel is opened)
  if (!(await p.evaluate(() => !!window.so101 && window.so101.version === 1))) throw new Error('window.so101 missing');
  if ((await p.locator('#ai-open').count()) !== 1) throw new Error('"Připojit AI" button missing');
  // the panel's lazy import chain resolves on a static host serving the repo root (GitHub Pages):
  // src/agent/panel.js -> /backend/bridge-client/agent-bridge.js -> schemas.js, validate.js (no relay connection)
  const mods = await p.evaluate(async () => {
    const panel = await import('/sim/so101/src/agent/panel.js');
    const bridge = await import('/backend/bridge-client/agent-bridge.js');
    return [typeof panel.mountAgentPanel, typeof bridge.createAgentBridge, panel.RELAY_URL];
  });
  if (mods[0] !== 'function' || mods[1] !== 'function' || mods[2] !== 'wss://relay.printedrobotics.cz/tab') throw new Error('AI panel imports: ' + mods.join(', '));
});

await check('sim so101 ?real=1 has no AI panel', '/sim/so101/?test=1&real=1', async p => {
  await p.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 90000 });
  if (await p.evaluate(() => !!window.so101 || !!document.getElementById('ai-open'))) throw new Error('AI panel / window.so101 present with ?real=1');
});

await check('arena svrn', '/sim/arena/?robot=svrn', async p => {
  await p.waitForSelector('#pick > *', { timeout: 60000 });
  await p.waitForSelector('#maps > *', { timeout: 60000 });
  if ((await p.locator('#pick > *').count()) < 2) throw new Error('robot menu not rendered');
});

await browser.close();
process.exit(failed ? 1 : 0);
