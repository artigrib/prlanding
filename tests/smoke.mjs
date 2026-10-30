// Playwright smoke test. Usage: node tests/smoke.mjs  (needs a server on BASE, default http://127.0.0.1:8123)
import fs from 'node:fs';
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

// home v2: one-click try (primary) + the parts plan (secondary). CTAs in the first screen, preview never pulls the sims' engines onto the home page
for (const vp of [{ width: 360, height: 780 }, { width: 1440, height: 900 }]) {
  await check(`home CTAs ${vp.width}px`, '/', async p => {
    await p.setViewportSize(vp);
    const sim = p.locator('a[data-cta="hero-sim"]'), plan = p.locator('a[data-cta="hero-plan"]');
    const txt = async l => (await l.innerText()).replace(/\s+/g, ' ');  // app.js glues short words with nbsp
    if (!/Vyzkoušejte SO-101 v prohlížeči/.test(await txt(sim))) throw new Error('primary CTA text');
    if (!/Plán nákupu dílů/.test(await txt(plan))) throw new Error('secondary CTA text');
    const u1 = await sim.evaluate(a => new URL(a.href).pathname), u2 = await plan.evaluate(a => new URL(a.href).pathname);
    if (u1 !== '/sim/so101/' || u2 !== '/plan/so101/') throw new Error(`CTA targets ${u1} ${u2}`);
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

// purchase plan: configuration, totals, variant guard, local-only ticks, arrival checklist → servo wizard, axe
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
await check('plan so101: totals, variant guard, checker, local state', '/plan/so101/', async p => {
  const offsite = [];
  p.on('request', r => { const u = new URL(r.url()); if (u.origin !== new URL(BASE).origin && !IGNORE.test(r.url())) offsite.push(r.url()); });
  await p.waitForSelector('#plan[data-ready="1"]');
  const total = async () => (await p.locator('[data-testid=plan-total-eur]').innerText()).trim();
  // default: the standard pair (7.4 V follower); the follower-voltage group switches to the 12 V pair
  if (await total() !== '373–398 €') throw new Error('default pair total ' + await total());
  if (!(await p.locator('[data-testid=plan-screws]').count()) || !/49× M2×6[\s\S]*96× M3×6/.test(await p.locator('#plan-screws').innerText())) throw new Error('screw table');
  if ((await p.locator('[data-testid=plan-alt]').count()) < 1) throw new Error('kit alternatives');
  await p.check('input[name=robot][value=follower]'); await p.check('input[name=fv][value="12v"]');
  if (await total() !== '206–224 €') throw new Error('follower total ' + await total());
  if (!(await p.locator('#plan-cfgnote').isVisible()) || !/lerobot-replay/.test(await p.locator('#plan-cfgnote').innerText())) throw new Error('follower-only note');
  if (!(await p.locator('[data-testid=plan-backorder]').count())) throw new Error('backorder note on the C018 line');
  if (!/^\d\d\.\d\d\.20\d\d$/.test(await p.locator('#stamp-date').innerText())) throw new Error('price stamp date');
  if (!/Pozor na variantu/.test((await p.locator('.plan-warn h2').innerText()).replace(/\s+/g, ' '))) throw new Error('variant warning');
  await p.check('input[name=robot][value=pair]');
  if (await total() !== '388–413 €') throw new Error('pair total ' + await total());
  // a backordered line can be swapped to another recommended source and back
  await p.locator('.plan-line', { hasText: 'C018' }).locator('summary').first().click();
  await p.locator('.plan-line', { hasText: 'C018' }).locator('button[data-swap]').first().click();
  if (!(await p.locator('[data-testid=plan-swapped]').count())) throw new Error('source swap');
  await p.locator('.plan-line', { hasText: 'C018' }).locator('summary').first().click();
  await p.locator('.plan-line', { hasText: 'C018' }).locator('button[data-swap][data-src=""]').click();
  if (await p.locator('[data-testid=plan-swapped]').count() || await total() !== '388–413 €') throw new Error('swap back');
  if (!/OpenELAB[\s\S]*1\/191/.test(await p.locator('#variant-flags').innerText()) || !(await p.locator('#variant-flags .pb-no').count())) throw new Error('OpenELAB C001 not flagged nedoporučujeme');
  if ((await p.locator('.plan-grp').count()) < 4) throw new Error('supplier groups');
  if (!/\/navody\/so101-sestaveni\/$/.test(await p.locator('[data-testid=plan-guide-link]').evaluate(a => a.href))) throw new Error('build time not linked to the guide');
  if ((await p.locator('#plan-stages a[href*="so101-sestaveni/#e"]').count()) !== 7) throw new Error('guide stage links');
  if (!/práce 10–19 h/.test((await p.locator('#plan-sum').innerText()).replace(/\s+/g, ' '))) throw new Error('pair work hours differ from the guide');
  if ((await p.locator('#plan-arrivals a[href*="so101-sestaveni/#e"]').count()) !== 6) throw new Error('arrival → guide stage links');
  if (await p.locator('.plan-grp a[rel~=sponsored]').count()) throw new Error('no link is affiliate/sponsored yet');
  await p.selectOption('#chk-exp', 'leader:2');
  await p.fill('#chk-text', 'Feetech STS3215 C001 7.4V 1/191');
  await p.click('#chk-btn');
  if ((await p.locator('[data-testid=chk-verdict]').getAttribute('data-verdict')) !== 'inconsistent') throw new Error('checker verdict');
  // ticks and tracking numbers stay in this browser and survive a reload
  await p.locator('.plan-line input[type=checkbox]').first().check();
  await p.fill('#trk-0', 'TEST123');
  if (await p.locator('#plan-next').isVisible()) throw new Error('next step shown too early');
  await p.check('#arr-servos'); await p.check('#arr-board');
  if (await p.locator('#plan-next').isVisible()) throw new Error('next step shown without power supply and USB cable');
  await p.check('#arr-psu'); await p.check('#arr-usb');
  if (!(await p.locator('#plan-next').isVisible())) throw new Error('next step not shown after servos+board+psu+usb');
  const next = await p.locator('#plan-next a').evaluateAll(as => as.map(a => new URL(a.href).pathname + new URL(a.href).hash));
  if (next[0] !== '/navody/so101-sestaveni/#e2' || next[1] !== '/sim/so101/nastaveni/' || next[2] !== '/navody/so101-lerobot-prvni-kroky/') throw new Error('next links ' + next);
  await p.reload(); await p.waitForSelector('#plan[data-ready="1"]');
  if (!(await p.locator('input[name=robot][value=pair]').isChecked())) throw new Error('config not restored');
  if (!(await p.locator('.plan-line input[type=checkbox]').first().isChecked()) || (await p.inputValue('#trk-0')) !== 'TEST123') throw new Error('local state not restored');
  if (offsite.length) throw new Error('off-site requests: ' + offsite.join(', '));
});
await check('plan so101 works without storage', '/plan/so101/', async p => {
  await p.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  await p.reload(); await p.waitForSelector('#plan[data-ready="1"]');
  await p.check('input[name=robot][value=pair]');
  await p.locator('.plan-line input[type=checkbox]').first().check();
});
for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  await check(`plan so101 axe ${vp.width}px`, '/plan/so101/', async p => {
    await p.setViewportSize(vp);
    await p.waitForSelector('#plan[data-ready="1"]');
    await p.check('input[name=robot][value=pair]');
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
    const bad = r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (bad.length) throw new Error('axe: ' + bad.map(v => `${v.id} (${v.nodes.length}) ${v.nodes[0].target}`).join('; '));
    if ((await p.evaluate(() => document.documentElement.scrollWidth)) > vp.width) throw new Error('horizontal scroll');
  });
}
await check('plan svrn: totals, module, part check, safety, notes, local state', '/plan/svrn/', async p => {
  const offsite = [];
  p.on('request', r => { const u = new URL(r.url()); if (u.origin !== new URL(BASE).origin && !IGNORE.test(r.url())) offsite.push(r.url()); });
  await p.waitForSelector('#plan[data-ready="1"]');
  const total = async () => (await p.locator('[data-testid=plan-total-eur]').innerText()).trim();
  if (await total() !== '103–106 €') throw new Error('robot-only total ' + await total());
  if (!/^\d\d\.\d\d\.20\d\d$/.test(await p.locator('#stamp-date').innerText())) throw new Error('price stamp date');
  if (!/není\sto\shračka/.test(await p.locator('#safety-h').textContent())) throw new Error('not-a-toy heading');
  if ((await p.locator('#plan-safety li').count()) !== 6) throw new Error('safety items');
  if (!(await p.locator('#plan-safety [data-safety=lipo_shipping] a[href*="zasilkovna.cz"]').count())) throw new Error('LiPo shipping source');
  if (!(await p.locator('#plan-notes [data-note=esc_hv] a[href*="bristolbotbuilders"]').count())) throw new Error('HV note with source');
  if (!(await p.locator('#plan-notes [data-note=servo_bec]').count())) throw new Error('servo/BEC verify note');
  if (!/Malenki Nano HV/.test(await p.locator('#plan-groups').innerText())) throw new Error('HV controller line');
  if (!(await p.locator('[data-testid=plan-reviews]').count())) throw new Error('review lines');
  await p.check('input[name=module][value=wedge]');
  if (await total() !== '92–95 €') throw new Error('wedge total ' + await total());
  if (await p.locator('#plan-notes [data-note=servo_bec]').count()) throw new Error('servo note shown for the wedge');
  await p.check('input[name=robot][value=starter]'); await p.check('input[name=module][value=flipper]');
  if (await total() !== '241–248 €') throw new Error('starter total ' + await total());
  if ((await p.locator('#plan-arrivals a[href*="printables.com/model/1272536"]').count()) < 4) throw new Error('arrivals → original guide');
  if (!/printables\.com/.test(await p.locator('[data-testid=plan-guide-link]').evaluate(a => a.href))) throw new Error('guide link');
  await p.selectOption('#chk-exp', 'esc');
  await p.fill('#chk-text', 'Malenki Nano 1-2S, 1.8A');
  await p.click('#chk-btn');
  if ((await p.locator('[data-testid=chk-verdict]').getAttribute('data-verdict')) !== 'mismatch') throw new Error('esc verdict');
  await p.selectOption('#chk-exp', 'servo');
  await p.fill('#chk-text', '<img src=x onerror=alert(1)> PTK 7462W servo 4.8-8.4V');
  await p.click('#chk-btn');
  if ((await p.locator('[data-testid=chk-verdict]').getAttribute('data-verdict')) !== 'match') throw new Error('servo verdict');
  if (await p.locator('#chk-out img').count()) throw new Error('checker output not escaped');
  await p.locator('.plan-line input[type=checkbox]').first().check();
  if (await p.locator('#plan-next').isVisible()) throw new Error('next step shown too early');
  await p.check('#arr-ctrl'); await p.check('#arr-motors'); await p.check('#arr-lipo');
  if (!(await p.locator('#plan-next').isVisible())) throw new Error('next step not shown');
  await p.reload(); await p.waitForSelector('#plan[data-ready="1"]');
  if (!(await p.locator('input[name=robot][value=starter]').isChecked()) || !(await p.locator('input[name=module][value=flipper]').isChecked())) throw new Error('config not restored');
  if (!(await p.locator('.plan-line input[type=checkbox]').first().isChecked())) throw new Error('local state not restored');
  if (offsite.length) throw new Error('off-site requests: ' + offsite.join(', '));
});
for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  await check(`plan svrn axe ${vp.width}px`, '/plan/svrn/', async p => {
    await p.setViewportSize(vp);
    await p.waitForSelector('#plan[data-ready="1"]');
    await p.check('input[name=robot][value=starter]');
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
    const bad = r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (bad.length) throw new Error('axe: ' + bad.map(v => `${v.id} (${v.nodes.length}) ${v.nodes[0].target}`).join('; '));
    if ((await p.evaluate(() => document.documentElement.scrollWidth)) > vp.width) throw new Error('horizontal scroll');
  });
}
await check('kit svrn links the buying plan', '/sada/svrn/', async p => {
  if ((await p.locator('#plan-cta').getAttribute('href')) !== '../../plan/svrn/') throw new Error('kit plan link');
});
await check('kit so101 + home link the buying plan, waitlist stays', '/sada/so101/', async p => {
  if ((await p.locator('#plan-cta').getAttribute('href')) !== '../../plan/so101/') throw new Error('kit plan link');
  if (!(await p.locator('#predobjednavka form, #predobjednavka').count())) throw new Error('waitlist gone');
  // referral model: no configurator or tiers, "what you'll need" links the plan, the form is interest in a future kit
  if (await p.locator('#tiers').count() || await p.locator('#colors').isVisible()) throw new Error('kit configurator still offered');
  if ((await p.locator('#box-plan').getAttribute('href')) !== '../../plan/so101/') throw new Error('what-you-need → plan link');
  if (!/Co budete potřebovat/.test(await p.locator('#obsah summary').innerText()) || !/Dejte mi vědět/.test(await p.locator('#po-btn').innerText())) throw new Error('kit page copy');
  const home = await (await p.request.get(BASE + '/')).text();
  if (!/href="plan\/so101\/" data-cta="plan">Plán nákupu dílů</.test(home) || !/href="sada\/so101\/">Stránka SO-101</.test(home)) throw new Error('home step 03 links');
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
for (const [path, nSrc] of [['/navody/', 0], ['/navody/so101-lerobot-prvni-kroky/', 3], ['/navody/bojovi-roboti-150-g/', 2], ['/navody/licence-open-source-hardwaru/', 4], ['/navody/so101-sestaveni/', 5]]) {
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
// SO-101 build path: seven stages, each with a time estimate, a checklist and troubleshooting; no horizontal scroll at 360 px
await check('assembly guide: stages, estimates, 360 px', '/navody/so101-sestaveni/', async p => {
  await p.setViewportSize({ width: 360, height: 780 });
  for (let i = 0; i <= 6; i++) {
    const sec = p.locator('#e' + i);
    if (!/odhad/.test(await sec.locator('.stage-meta').innerText())) throw new Error(`stage ${i}: time not marked as an estimate`);
    if (i < 6 && !(await sec.locator('ul.chk li').count())) throw new Error(`stage ${i}: no checklist`);
    if (i < 6 && !(await sec.locator('.fix').count())) throw new Error(`stage ${i}: no troubleshooting`);
  }
  if (!(await p.locator('a[href$="sim/so101/nastaveni/"]').count())) throw new Error('no link to the setup wizard');
  if (!(await p.locator('a[href$="kontrolni-seznam/"]').count())) throw new Error('no link to the checklist');
  if ((await p.evaluate(() => document.documentElement.scrollWidth)) > 360) throw new Error('horizontal scroll at 360 px');
});
await check('bench checklist prints on one A4 page', '/navody/so101-sestaveni/kontrolni-seznam/', async p => {
  if ((await p.locator('.ws-box ul.chk').count()) < 6) throw new Error('checklist blocks missing');
  await p.emulateMedia({ media: 'print' });
  for (const sel of ['.site-h', '.site-f', '[data-print]']) if (await p.locator(sel).first().isVisible()) throw new Error(sel + ' visible in print');
  const pdf = await p.pdf({ format: 'A4', margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' }, preferCSSPageSize: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (pages !== 1) throw new Error('checklist prints on ' + pages + ' pages');
});
// forge demo: guide draft and /lab/ replay are noindex, not in the sitemap, not linked from public pages
await check('forge flashlight draft: noindex, labelled, unlinked', '/navody/so101-baterka/', async p => {
  if ((await p.locator('meta[name="robots"]').getAttribute('content')) !== 'noindex,nofollow') throw new Error('not noindex');
  const txt = await p.locator('main').innerText();
  if (!/komunitní\s+návrh\s+–\s+ověřeno\s+pouze\s+v\s+simulaci/i.test(txt)) throw new Error('missing simulation-only label');
  if (!/ověřit\s+na\s+tisku/.test(txt)) throw new Error('missing "ověřit na tisku"');
  const imgs = await p.locator('main figure img').evaluateAll((els) => els.map((e) => e.complete && e.naturalWidth > 0 ? 1 : 0));
  await p.evaluate(() => Promise.all([...document.images].map((i) => { i.loading = 'eager'; return i.decode().catch(() => {}); })));
  const ok = await p.locator('main figure img').evaluateAll((els) => els.filter((e) => e.naturalWidth > 0).length);
  if (imgs.length < 5 || ok < 5) throw new Error(`renders missing (${ok}/${imgs.length})`);
  const sm = await (await p.request.get(BASE + '/sitemap.xml')).text();
  if (/so101-baterka|so101-flashlight|\/lab\//.test(sm)) throw new Error('forge draft in the sitemap');
  for (const path of ['/', '/navody/', '/navody/so101-sestaveni/', '/sada/so101/', '/en/', '/en/guides/'])
    if (/so101-baterka|so101-flashlight|href="[^"]*lab\//.test(await (await p.request.get(BASE + path)).text())) throw new Error('forge draft linked from ' + path);
  await p.setViewportSize({ width: 360, height: 740 });
  if ((await p.evaluate(() => document.documentElement.scrollWidth)) > 360) throw new Error('horizontal scroll at 360 px');
});
await check('forge lab replay', '/lab/', async p => {
  if ((await p.locator('meta[name="robots"]').getAttribute('content')) !== 'noindex,nofollow') throw new Error('not noindex');
  await p.locator('#fast').check();
  await p.locator('#play').click();
  await p.waitForFunction(() => window.__lab && window.__lab.done, null, { timeout: 20000 });
  const st = await p.locator('.step').evaluateAll((els) => els.map((e) => e.dataset.s));
  if (st.length !== 7 || st.some((s) => !['ok', 'warn', 'skipped'].includes(s))) throw new Error('steps: ' + st.join(','));
  if ((await p.locator('.shots img').count()) < 5) throw new Error('render thumbnails missing');
});
// forge lab live panel against a MOCKED api (no server, no LLM): token only in the Authorization header, never in a URL;
// SSE progress, CAD attempts, cost so far, downloads; the "AI draft, simulation only" label is shown
await check('forge lab live (mocked api)', '/lab/', async p => {
  const TOKEN = 'pr_forge_smoke_token_0123456789abcdef';
  const ID = 'ab'.repeat(16);
  const seen = [];
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  const steps = [['parse', 'Parse request', 'Rozbor zadání'], ['mount', 'Pick mount point', 'Výběr místa uchycení'], ['cad', 'CAD in sandbox', 'CAD v sandboxu'],
    ['checks', 'Checks (simulation)', 'Kontroly (simulace)'], ['parts', 'Parts and power', 'Díly a napájení'], ['render', 'Renders', 'Vizualizace'], ['guide', 'Guide draft', 'Koncept návodu']]
    .map(([id, title, title_cs]) => ({ id, title, title_cs }));
  let seq = 0;
  const ev = (o, usd) => `id: ${++seq}\nevent: forge\ndata: ${JSON.stringify({ seq, ...o, cost: { cost_usd: usd, tokens: seq * 1000 } })}\n\n`;
  let sse = ev({ type: 'start', steps }, 0);
  for (const [id, st, sum] of [['parse', 'ok', 'robot so101'], ['mount', 'ok', '3 mount points'], ['cad', 'warn', 'cad-01: failed at policy'], ['cad', 'ok', 'cad-02: 33×12×20 mm'],
    ['checks', 'warn', 'cad-02 on gripper_cam_face'], ['parts', 'ok', '1 component'], ['render', 'ok', 'render spec written'], ['guide', 'ok', 'draft guide CZ + EN']]) {
    sse += ev({ type: 'step', step: id, status: 'running' }, seq * 0.01) + ev({ type: 'step', step: id, status: st, summary: sum }, seq * 0.01);
  }
  sse += ev({ type: 'end', status: 'done', message: 'finished', artifacts: ['bundle.zip', 'part.stl'] }, 0.42);
  await p.route('https://api.printedrobotics.cz/**', async (route) => {
    const r = route.request(), u = new URL(r.url());
    seen.push({ url: r.url(), method: r.method(), auth: r.headers()['authorization'] || '' });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST' } });
    if (u.pathname === '/forge/me') return json(route, { label: 'smoke', jobs_today: 0, jobs_per_day: 5, active: null, spent_today_usd: 0, daily_usd: 5 });
    if (u.pathname === '/forge/jobs' && r.method() === 'POST') {
      const b = JSON.parse(r.postData() || '{}');
      if (!/baterk/.test(b.request) || b.lang !== 'cs') return json(route, { error: 'request' }, 400);
      return json(route, { id: ID, status: 'queued' }, 202);
    }
    if (u.pathname === `/forge/jobs/${ID}/events`) return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/event-stream' }, body: sse });
    if (u.pathname === `/forge/jobs/${ID}/artifacts`) return json(route, { id: ID, artifacts: ['bundle.zip', 'checks.json', 'part.step', 'part.stl'] });
    if (u.pathname === `/forge/jobs/${ID}/artifacts/bundle.zip`) return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/zip' }, body: 'PK' });
    return json(route, { error: 'not_found' }, 404);
  });
  if (!/návrh AI, ověřeno pouze v simulaci/.test(await p.locator('main').innerText())) throw new Error('missing AI/simulation label');
  await p.fill('#tok', TOKEN);
  await p.click('#tok-save');
  await p.waitForSelector('#jobform:not([hidden])');
  await p.fill('#prompt', 'SO-101 s baterkou na chapadle');
  await p.click('#go');
  await p.waitForFunction(() => window.__forgeLive && window.__forgeLive.ended, null, { timeout: 15000 });
  const st = await p.locator('#lsteps .lstep').evaluateAll((els) => els.map((e) => e.dataset.s));
  if (st.join(',') !== 'ok,ok,ok,warn,ok,ok,ok') throw new Error('live steps: ' + st.join(','));
  if (!/CAD pokusy: 2/.test(await p.locator('#cad-n').innerText())) throw new Error('CAD attempts not counted');
  if (!/\$0\.42/.test(await p.locator('#cost').innerText())) throw new Error('cost so far not shown');
  await p.waitForSelector('#arts button.main');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#arts button.main')]);
  if (dl.suggestedFilename() !== 'bundle.zip') throw new Error('bundle download name ' + dl.suggestedFilename());
  if (seen.some((x) => x.url.includes(TOKEN))) throw new Error('token in a URL');
  if (seen.filter((x) => x.method !== 'OPTIONS').some((x) => x.auth !== 'Bearer ' + TOKEN)) throw new Error('api call without the token header');
  if (!seen.some((x) => x.url.endsWith('/events') && x.auth === 'Bearer ' + TOKEN)) throw new Error('SSE without the token header');
  if ((await p.locator('.step').count()) !== 7) throw new Error('replay disturbed by the live panel');
});
// build log template: draft, noindex, not in the sitemap and not linked from any page
await check('build log draft: noindex, unlinked', '/stavba/so101/', async p => {
  if ((await p.locator('meta[name="robots"]').getAttribute('content')) !== 'noindex,nofollow') throw new Error('not noindex');
  if ((await p.locator('article.log-entry').count()) < 7) throw new Error('log entries missing');
  if (/TODO/.test(await p.locator('body').innerText())) throw new Error('visible TODO');
  const sm = await (await p.request.get(BASE + '/sitemap.xml')).text();
  if (/stavba\/|en\/build\//.test(sm)) throw new Error('build log in the sitemap');
  for (const path of ['/', '/navody/', '/navody/so101-sestaveni/', '/sada/so101/', '/en/guides/so101-assembly/'])
    if (/stavba\/so101|en\/build\/so101/.test(await (await p.request.get(BASE + path)).text())) throw new Error('build log linked from ' + path);
});
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
  // every stage toolbar button has an accessible name (the visible labels are hidden on phones)
  const unnamed = await p.evaluate(() => [...document.querySelectorAll('.ux-tb')].filter((b) => !(b.getAttribute('aria-label') || '').trim()).map((b) => b.id));
  if (unnamed.length) throw new Error('toolbar buttons without aria-label: ' + unnamed.join(', '));
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

// PR-Bench leaderboard draft: noindex, unlinked, renders the results JSON, mock data labelled, axe clean
for (const vp of [{ width: 360, height: 780 }, { width: 1440, height: 900 }]) {
  await check(`bench leaderboard draft ${vp.width}px`, '/bench/', async p => {
    await p.setViewportSize(vp);
    if ((await p.locator('meta[name="robots"]').getAttribute('content')) !== 'noindex,nofollow') throw new Error('not noindex');
    await p.waitForSelector('#prb-table tbody th code');
    const rows = await p.locator('#prb-table tbody tr').count();
    if (rows < 3) throw new Error('leaderboard rows: ' + rows);
    const first = await p.locator('#prb-table tbody tr').first().locator('td').allInnerTexts();
    if (!/^\d+\/\d+ \(\d+ %\)$/.test(first[1]) || !/\$|US/.test(first[2])) throw new Error('row cells: ' + first.join(' | '));
    if (!(await p.locator('#prb-mock').isVisible()) || !/ukázková\s+data\s+–\s+mock/i.test(await p.locator('#prb-mock').innerText())) throw new Error('mock data not labelled');
    if (!/github\.com\/artigrib\/prlanding\/blob\/main\/bench\/SPEC\.md/.test(await p.locator('#metodika a').first().getAttribute('href'))) throw new Error('methodology link');
    if (vp.width === 1440) {
      const sm = await (await p.request.get(BASE + '/sitemap.xml')).text();
      if (/\/bench\//.test(sm)) throw new Error('bench draft in the sitemap');
      for (const path of ['/', '/navody/', '/sim/so101/', '/en/'])
        if (/href="[^"]*bench\/"/.test(await (await p.request.get(BASE + path)).text())) throw new Error('bench draft linked from ' + path);
    }
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
    const bad = r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (bad.length) throw new Error('axe: ' + bad.map(v => `${v.id} (${v.nodes.length}) ${v.nodes[0].target}`).join('; '));
    if ((await p.evaluate(() => document.documentElement.scrollWidth)) > vp.width) throw new Error('horizontal scroll');
  });
}

// ROBOTO ORIGIN showcase sim (draft): loads, noindex, not in the sitemap, not linked, axe clean, no horizontal scroll
for (const vp of [{ width: 360, height: 780 }, { width: 1440, height: 900 }]) {
  await check(`origin sim draft ${vp.width}px`, '/sim/origin/?test=1', async p => {
    await p.setViewportSize(vp);
    await p.waitForFunction(() => window.__origin && (window.__origin.ready || window.__origin.error), null, { timeout: 90000 });
    if (await p.evaluate(() => window.__origin.error)) throw new Error('sim error');
    if (!(await p.evaluate(() => window.__origin.policy))) throw new Error('walking policy did not load');
    if ((await p.locator('meta[name="robots"]').getAttribute('content')) !== 'noindex,nofollow') throw new Error('not noindex');
    if ((await p.locator('#joints input[type=range]').count()) !== 23) throw new Error('joint sliders');
    if (!/neprodáváme/.test(await p.locator('.panel').innerText())) throw new Error('showcase note missing');
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
    const bad = r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (bad.length) throw new Error('axe: ' + bad.map(v => `${v.id} (${v.nodes.length}) ${v.nodes[0].target}`).join('; '));
    if ((await p.evaluate(() => document.documentElement.scrollWidth)) > vp.width) throw new Error('horizontal scroll');
    if (vp.width > 400) {
      const sm = await (await p.request.get(BASE + '/sitemap.xml')).text();
      if (/sim\/origin/.test(sm)) throw new Error('origin sim in the sitemap');
      for (const path of ['/', '/en/', '/navody/', '/sada/so101/', '/sim/so101/', '/plan/so101/'])
        if (/sim\/origin/.test(await (await p.request.get(BASE + path)).text())) throw new Error('origin sim linked from ' + path);
    }
  });
}

await browser.close();
process.exit(failed ? 1 : 0);
