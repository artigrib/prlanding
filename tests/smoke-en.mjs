// English-version smoke test. Usage: node tests/smoke-en.mjs  (needs a server on BASE, default http://127.0.0.1:8123)
// 1. static: every hreflang pair points at an existing page that points back; sitemap entries exist.
// 2. browser: English pages and the sims with ?lang=en load without errors and with no Czech left in
//    the key UI (visible text, aria-labels, titles); Czech pages stay Czech; the language banner only
//    appears for non-Czech browsers and remembers being dismissed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const SITE = 'https://printedrobotics.cz/';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const IGNORE = /fonts\.(googleapis|gstatic)\.com/i;
let failed = 0;
// schools + guides (tools/content/*), Czech path → English path
const CONTENT_PAGES = [['pro-skoly/', 'en/for-schools/'], ['pro-skoly/pracovni-list/', 'en/for-schools/worksheet/'], ['navody/', 'en/guides/'],
  ['navody/so101-lerobot-prvni-kroky/', 'en/guides/so101-lerobot-first-steps/'], ['navody/bojovi-roboti-150-g/', 'en/guides/combat-robots-150-g/'],
  ['navody/licence-open-source-hardwaru/', 'en/guides/open-source-hardware-licences/'],
  ['navody/so101-sestaveni/', 'en/guides/so101-assembly/'], ['navody/so101-sestaveni/kontrolni-seznam/', 'en/guides/so101-assembly/checklist/'],
  ['stavba/so101/', 'en/build/so101/'], ['plan/so101/', 'en/plan/so101/'], ['plan/svrn/', 'en/plan/svrn/']];
const fail =(name, msg) => { failed++; console.log(`FAIL ${name}\n  ${msg}`); };

/* ---------- 1. static hreflang / sitemap checks ---------- */
const fileOf = u => { const p = u.replace(SITE, '').split(/[?#]/)[0]; return path.join(ROOT, p.endsWith('/') || p === '' ? p + 'index.html' : p); };
const alts = html => Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(m => [m[1], m[2]]));
{
  const pages = ['kviz.html', 'en/quiz/index.html', ...fs.readdirSync(path.join(ROOT, 'sada')).flatMap(id => [`sada/${id}/index.html`, `en/kit/${id}/index.html`]),
    ...CONTENT_PAGES.flatMap(([cs, en]) => [cs + 'index.html', en + 'index.html'])];
  if (fs.existsSync(path.join(ROOT, 'en/index.html'))) pages.push('index.html', 'en/index.html');
  const errs = [];
  for (const p of pages) {
    const f = path.join(ROOT, p);
    if (!fs.existsSync(f)) { errs.push('missing ' + p); continue; }
    const html = fs.readFileSync(f, 'utf8'), a = alts(html);
    const self = SITE + p.replace(/index\.html$/, '');
    const canon = (/<link rel="canonical" href="([^"]+)">/.exec(html) || [])[1];
    if (canon !== self) errs.push(`${p}: canonical ${canon} ≠ ${self}`);
    if (!a.cs || !a.en || !a['x-default']) { errs.push(`${p}: hreflang cs/en/x-default missing`); continue; }
    if (a.cs !== self && a.en !== self) errs.push(`${p}: hreflang pair does not include the page itself`);
    for (const l of ['cs', 'en']) {
      const other = fileOf(a[l]);
      if (!fs.existsSync(other)) { errs.push(`${p}: hreflang ${l} → missing ${a[l]}`); continue; }
      const back = alts(fs.readFileSync(other, 'utf8'));
      if (back.cs !== a.cs || back.en !== a.en) errs.push(`${p}: hreflang ${l} page does not point back`);
    }
    const lang = (/<html lang="([a-z]+)"/.exec(html) || [])[1];
    if (lang !== (a.en === self ? 'en' : 'cs')) errs.push(`${p}: <html lang="${lang}">`);
  }
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  for (const m of sm.matchAll(/<loc>([^<]+)<\/loc>/g)) if (!fs.existsSync(fileOf(m[1]))) errs.push('sitemap: missing ' + m[1]);
  if (!/hreflang="en" href="https:\/\/printedrobotics\.cz\/en\/kit\/so101\/"/.test(sm)) errs.push('sitemap: no hreflang pairs');
  if (errs.length) fail('hreflang + sitemap', errs.slice(0, 20).join('\n  ')); else console.log(`ok   hreflang + sitemap (${pages.length} pages)`);
}

/* ---------- 2. browser checks ---------- */
// Czech-only letters, plus common Czech UI words that have no diacritics
const CZ = /[ěřůčšžťďňĚŘŮČŠŽŤĎŇ]|[áéíóúý]\p{L}|\b(Rameno|Loket|Chapadlo|Klouby|Kloub|Mise|Znovu|Hotovo|Kostka|Miska|Simulace|Zkusit|Postavte|Kalibrace|Serva|Teplota|Zapnout|Spustit|Poloha|Diagnostika|Turnaj|Kamera|Pauza|Barva|Soupe\p{L}*|Zpomal\p{L}*|Vidlice|Agrese|Kontrola|Sada|Detail sady|Katalog|Licence a)\b/u;
// names and quoted titles that legitimately contain such letters
const OK = /Čeština|Zásilkovna|Česká pošta|González|Ángel|Muffin578|„150g vert“|Jazyk \/ Language/;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

async function check(name, url, fn, opts = {}) {
  const ctx = await browser.newContext({ locale: opts.locale || 'en-US', viewport: opts.viewport });
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  await page.route(IGNORE, r => r.abort());
  if (opts.route) await page.route(opts.route[0], opts.route[1]);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text()) && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !IGNORE.test(r.url()) && !opts.allow404) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  try {
    const res = await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (!res || (!res.ok() && !opts.allow404)) errors.push('navigation status ' + (res && res.status()));
    await fn(page, errors);
  } catch (e) { errors.push('failed: ' + e.message.split('\n')[0]); }
  if (errors.length) fail(name, errors.join('\n  ')); else console.log(`ok   ${name}`);
  await ctx.close();
}
// visible text + accessible names that still look Czech
async function czechLeft(page, root = 'body') {
  return page.evaluate(([sel, cz, ok]) => {
    const CZ = new RegExp(cz, 'u'), OK = new RegExp(ok), out = new Set();
    const shown = el => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) if (e.hidden || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden') return false; return true; };
    const base = document.querySelector(sel) || document.body;
    const w = document.createTreeWalker(base, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) {
      const s = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (s && CZ.test(s) && !OK.test(s) && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentNode.nodeName) && shown(n.parentNode)) out.add(s.slice(0, 120));
    }
    base.querySelectorAll('[aria-label],[title],[placeholder],[alt]').forEach(e => {
      if (!shown(e)) return;
      for (const a of ['aria-label', 'title', 'placeholder', 'alt']) { const v = e.getAttribute(a); if (v && CZ.test(v) && !OK.test(v)) out.add(`[${a}] ${v.slice(0, 120)}`); }
    });
    if (CZ.test(document.title) && !OK.test(document.title)) out.add('<title> ' + document.title);
    return [...out];
  }, [root, CZ.source, OK.source]);
}
const noCzech = async (page, errors, root) => { const left = await czechLeft(page, root); if (left.length) errors.push('Czech text left:\n    ' + left.slice(0, 15).join('\n    ')); };
// the CZ link of the switcher must lead back to the Czech page (path, plus ?lang=cs on sims)
const czLink = async (page, errors, path) => {
  const h = await page.locator('.lang-sw a[data-lang="cs"]').first().getAttribute('href').catch(() => null);
  if (!h) { errors.push('no CZ switcher link'); return; }
  const u = new URL(h, page.url());
  if (u.pathname !== path || /lang=en/.test(u.search)) errors.push(`CZ link → ${u.pathname}${u.search}, expected ${path}`);
};
const isLang = async (page, errors, l) => { const v = await page.evaluate(() => document.documentElement.lang); if (v !== l) errors.push(`html lang = ${v}, expected ${l}`); };

if (fs.existsSync(path.join(ROOT, 'en/index.html'))) {
  await check('en home', '/en/', async (p, e) => {
    await p.waitForSelector('#cards .card'); await p.waitForTimeout(400);
    await isLang(p, e, 'en'); await noCzech(p, e); await czLink(p, e, '/');
    const href = await p.locator('#cards .card').first().getAttribute('href');
    if (!/en\/kit\//.test(href)) e.push('catalogue cards do not link to /en/kit/: ' + href);
  });
}
for (const [vp, size] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  await check('en kit so101 · ' + vp, '/en/kit/so101/', async (p, e) => {
    await p.waitForSelector('#faq-list details'); await p.waitForTimeout(400);
    await isLang(p, e, 'en'); await noCzech(p, e); await czLink(p, e, '/sada/so101/');
    const rel = await p.locator('#related a').first().getAttribute('href');
    if (!/en\/kit\//.test(rel)) e.push('related links not English: ' + rel);
  }, { viewport: size });
}
for (const [cs, en] of CONTENT_PAGES) {
  await check('en ' + en, '/' + en, async (p, e) => {
    await p.waitForSelector('h1'); await p.waitForTimeout(300);
    await isLang(p, e, 'en'); await noCzech(p, e); await czLink(p, e, '/' + cs);
    const bad = await p.locator('main a[href]').evaluateAll(as => as.map(a => new URL(a.href)).filter(u => u.origin === location.origin && (/^\/(sada|pro-skoly|navody)\//.test(u.pathname) || (u.pathname.startsWith('/sim/') && u.searchParams.get('lang') !== 'en'))).map(u => u.pathname + u.search));
    if (bad.length) e.push('links to Czech pages: ' + bad.slice(0, 5).join(', '));
  });
}
// purchase plan (English): rendered plan has no Czech, links stay English, axe has no critical/serious issues
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  await check(`en plan so101 ${vp.width}px`, '/en/plan/so101/', async (p, e) => {
    await p.waitForSelector('#plan[data-ready="1"]');
    await p.check('input[name=robot][value=pair]');
    await noCzech(p, e);
    if (!/^\d+–\d+ €$/.test((await p.locator('[data-testid=plan-total-eur]').innerText()).trim())) e.push('total');
    if (!/Watch the variant/.test((await p.locator('.plan-warn h2').innerText()).replace(/\s+/g, ' '))) e.push('variant box heading');
    if (!(await p.locator('.plan-flags .pb-no').count())) e.push('no "not recommended" source shown for the pair');
    if ((await p.locator('#plan-arrivals a[href*="/en/guides/so101-assembly/#e"]').count()) !== 6) e.push('arrival links to the English guide stages');
    if (!/en\/guides\/so101-assembly\/$/.test(await p.locator('[data-testid=plan-guide-link]').evaluate(a => a.href))) e.push('build-time guide link');
    const next = await p.locator('#plan-next a').evaluateAll(as => as.map(a => new URL(a.href).pathname + new URL(a.href).search));
    if (next[0] !== '/sim/so101/nastaveni/?lang=en' || next[1] !== '/en/guides/so101-lerobot-first-steps/') e.push('next-step links: ' + next.join(', '));
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
    const bad = r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (bad.length) e.push('axe: ' + bad.map(v => `${v.id} (${v.nodes.length}) ${v.nodes[0].target}`).join('; '));
    if (vp.width === 390 && (await p.evaluate(() => document.documentElement.scrollWidth)) > 390) e.push('horizontal scroll');
  }, { viewport: vp });
}
for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  await check(`en plan svrn ${vp.width}px`, '/en/plan/svrn/', async (p, e) => {
    await p.waitForSelector('#plan[data-ready="1"]');
    await p.check('input[name=robot][value=starter]');
    await p.check('input[name=module][value=grabber]');
    await noCzech(p, e);
    if (!/^\d+–\d+ €$/.test((await p.locator('[data-testid=plan-total-eur]').innerText()).trim())) e.push('total');
    if (!/not\sa\stoy/.test(await p.locator('#safety-h').textContent())) e.push('not-a-toy heading');
    if (!/Watch\sthe\scontroller/.test(await p.locator('.plan-warn h2').innerText())) e.push('part check heading');
    if ((await p.locator('#plan-safety li').count()) !== 6) e.push('safety items');
    if (!(await p.locator('#chk-exp option').count())) e.push('part check options');
    const own = await p.locator('#plan-arrivals a').evaluateAll(as => as.map(a => new URL(a.href)).filter(u => u.origin === location.origin).map(u => u.pathname));
    if (!own.length || own.some(x => !x.startsWith('/en/'))) e.push('arrival links not English: ' + own.join(', '));
    const next = await p.locator('#plan-next a').evaluateAll(as => as.map(a => new URL(a.href)).filter(u => u.origin === location.origin).map(u => u.pathname + u.search));
    if (next[0] !== '/en/guides/combat-robots-150-g/' || !/lang=en/.test(next[1] || '')) e.push('next-step links: ' + next.join(', '));
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
    const bad = r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (bad.length) e.push('axe: ' + bad.map(v => `${v.id} (${v.nodes.length}) ${v.nodes[0].target}`).join('; '));
    if (vp.width === 390 && (await p.evaluate(() => document.documentElement.scrollWidth)) > 390) e.push('horizontal scroll');
  }, { viewport: vp });
}
await check('en kit so101 links the buying plan', '/en/kit/so101/', async (p, e) => {
  const h = await p.locator('#plan-cta').getAttribute('href');
  if (!/en\/plan\/so101\/$/.test(h || '')) e.push('plan link: ' + h);
  const home = await (await p.request.get(BASE + '/en/')).text();
  if (!/href="[^"]*en\/plan\/so101\/" data-cta="plan">Parts buying plan</.test(home)) e.push('home step 03 has no plan link');
});
await check('en for-schools pilot form messages are English', '/en/for-schools/', async (p, e) => {
  await p.locator('#pilot-form [name=email]').fill('teacher@example.com');
  await p.locator('#pilot-form button[type=submit]').click(); await p.waitForTimeout(300);
  const m = (await p.locator('#pilot-form .soft-msg').innerText()).replace(/\s+/g, ' ');
  if (!/school or club/.test(m)) e.push('validation message: ' + m);
});
await check('en kit vert150 (coming soon)', '/en/kit/vert150/', async (p, e) => { await p.waitForSelector('#prep-alt a'); await p.waitForTimeout(300); await noCzech(p, e); });
await check('en quiz', '/en/quiz/', async (p, e) => {
  await czLink(p, e, '/kviz.html');
  for (let i = 0; i < 3; i++) { await p.waitForSelector('.q-opt'); await noCzech(p, e, '#quiz'); await p.locator('.q-opt').nth(1).click(); }
  await p.waitForSelector('.res'); await p.waitForTimeout(300); await noCzech(p, e);
  const a = await p.locator('.res a.btn').first().getAttribute('href');
  if (!/en\/kit\//.test(a)) e.push('result does not link to /en/kit/: ' + a);
});
await check('en 404', '/en/kit/no-such-kit/', async (p, e) => { await p.waitForSelector('#nf-cards a'); await isLang(p, e, 'en'); await noCzech(p, e); },
  { allow404: true, route: [/\/en\/kit\/no-such-kit\/$/, r => r.fulfill({ status: 404, contentType: 'text/html', body: fs.readFileSync(path.join(ROOT, '404.html')) })] });
await check('cs kit stays Czech, no banner for cs browser', '/sada/so101/', async (p, e) => {
  await p.waitForSelector('#faq-list details'); await isLang(p, e, 'cs');
  if (await p.locator('.lang-banner').count()) e.push('banner shown to a Czech browser');
  if (!(await p.locator('.lang-sw a[hreflang="en"]').count())) e.push('no EN switcher link');
}, { locale: 'cs-CZ' });
await check('language banner: suggest once, no layout shift, remember dismissal', '/sada/so101/', async (p, e) => {
  await p.waitForSelector('.lang-banner a[href*="/en/kit/so101/"]', { timeout: 5000 });
  await p.waitForTimeout(500);
  const cls = await p.evaluate(() => window.__cls || 0);
  if (cls > 0.01) e.push('banner caused layout shift, CLS ' + cls.toFixed(3));
  await p.locator('.lang-banner button').click();
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(300);
  if (await p.locator('.lang-banner').count()) e.push('banner came back after dismissal');
  if (p.url().includes('/en/')) e.push('redirected');
}, { locale: 'en-US', init: () => { window.__cls = 0; new PerformanceObserver(l => { for (const x of l.getEntries()) if (!x.hadRecentInput) window.__cls += x.value; }).observe({ type: 'layout-shift', buffered: true }); } });

if (!process.env.SKIP_SIMS) {
  await check('sim so101 ?lang=en', '/sim/so101/?test=1&lang=en', async (p, e) => {
    await p.waitForFunction(() => window.__sim, null, { timeout: 120000 });
    const err = await p.evaluate(() => window.__sim.error); if (err) e.push('sim error: ' + err);
    await p.waitForTimeout(2500); await isLang(p, e, 'en'); await noCzech(p, e); await czLink(p, e, '/sim/so101/');
  });
  // wait until the object list is rendered (or the page reports a failure) – a fixed delay made the result depend on
  // the runner's speed: only a fast runner got far enough to show the (then untranslated) object names
  await check('sim so101 objects ?lang=en', '/sim/so101/objects.html?lang=en', async (p, e) => {
    const st = await p.waitForFunction(() => (document.querySelector('#objs li') ? 'list' : !document.getElementById('fail').hidden ? 'fail' : null), null, { timeout: 120000 })
      .then((h) => h.jsonValue()).catch(() => 'timeout');
    if (st !== 'list') e.push(`objects page did not render its object list (${st}; loader ${await p.evaluate(() => (document.getElementById('loader').hidden ? 'hidden' : 'visible'))})`);
    await p.waitForTimeout(300); await noCzech(p, e);
  });
  await check('sim so101 setup wizard ?lang=en', '/sim/so101/nastaveni/?lang=en', async (p, e) => { await p.waitForTimeout(4000); await noCzech(p, e); });
  await check('arena ?lang=en', '/sim/arena/?robot=svrn&lang=en', async (p, e) => {
    await p.waitForSelector('#pick > *', { timeout: 60000 }); await p.waitForSelector('#maps > *', { timeout: 60000 });
    await p.waitForTimeout(800); await isLang(p, e, 'en'); await noCzech(p, e); await czLink(p, e, '/sim/arena/');
    // choosing CZ wins over a saved English preference
    await p.locator('.lang-sw a[data-lang="cs"]').click();
    await p.waitForSelector('#pick > *', { timeout: 60000 }); await isLang(p, e, 'cs');
    await p.goto(BASE + '/sim/arena/?robot=svrn', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#pick > *', { timeout: 60000 }); await isLang(p, e, 'cs');
  }, { init: () => { try { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.setItem('pr-lang', 'en'); } } catch (x) {} } });
  await check('arena saved English choice applies without ?lang', '/sim/arena/?robot=svrn', async (p, e) => {
    await p.waitForSelector('#pick > *', { timeout: 60000 }); await isLang(p, e, 'en');
  }, { init: () => { try { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.setItem('pr-lang', 'en'); } } catch (x) {} } });
  await check('arena stays Czech without ?lang', '/sim/arena/?robot=svrn', async (p, e) => {
    await p.waitForSelector('#pick > *', { timeout: 60000 }); await isLang(p, e, 'cs');
    const t = await p.locator('#start-h').innerText(); if (t.trim() !== 'Vyzkoušejte v aréně') e.push('Czech heading changed: ' + t);
  }, { locale: 'en-US' });
}

await browser.close();
process.exit(failed ? 1 : 0);
