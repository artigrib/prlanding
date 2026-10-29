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
const fail = (name, msg) => { failed++; console.log(`FAIL ${name}\n  ${msg}`); };

/* ---------- 1. static hreflang / sitemap checks ---------- */
const fileOf = u => { const p = u.replace(SITE, '').split(/[?#]/)[0]; return path.join(ROOT, p.endsWith('/') || p === '' ? p + 'index.html' : p); };
const alts = html => Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(m => [m[1], m[2]]));
{
  const pages = ['kviz.html', 'en/quiz/index.html', ...fs.readdirSync(path.join(ROOT, 'sada')).flatMap(id => [`sada/${id}/index.html`, `en/kit/${id}/index.html`])];
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
const OK = /Čeština|González|Ángel|Muffin578|„150g vert“|Jazyk \/ Language/;
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
    const res = await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 60000 });
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
const isLang = async (page, errors, l) => { const v = await page.evaluate(() => document.documentElement.lang); if (v !== l) errors.push(`html lang = ${v}, expected ${l}`); };

if (fs.existsSync(path.join(ROOT, 'en/index.html'))) {
  await check('en home', '/en/', async (p, e) => {
    await p.waitForSelector('#cards .card'); await p.waitForTimeout(400);
    await isLang(p, e, 'en'); await noCzech(p, e);
    const href = await p.locator('#cards .card').first().getAttribute('href');
    if (!/en\/kit\//.test(href)) e.push('catalogue cards do not link to /en/kit/: ' + href);
  });
}
for (const [vp, size] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  await check('en kit so101 · ' + vp, '/en/kit/so101/', async (p, e) => {
    await p.waitForSelector('#faq-list details'); await p.waitForTimeout(400);
    await isLang(p, e, 'en'); await noCzech(p, e);
    const rel = await p.locator('#related a').first().getAttribute('href');
    if (!/en\/kit\//.test(rel)) e.push('related links not English: ' + rel);
  }, { viewport: size });
}
await check('en kit vert150 (coming soon)', '/en/kit/vert150/', async (p, e) => { await p.waitForSelector('#prep-alt a'); await p.waitForTimeout(300); await noCzech(p, e); });
await check('en quiz', '/en/quiz/', async (p, e) => {
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
await check('language banner: suggest once, remember dismissal', '/sada/so101/', async (p, e) => {
  await p.waitForSelector('.lang-banner a[href*="/en/kit/so101/"]', { timeout: 5000 });
  await p.locator('.lang-banner button').click();
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(300);
  if (await p.locator('.lang-banner').count()) e.push('banner came back after dismissal');
  if (p.url().includes('/en/')) e.push('redirected');
}, { locale: 'en-US' });

if (!process.env.SKIP_SIMS) {
  await check('sim so101 ?lang=en', '/sim/so101/?test=1&lang=en', async (p, e) => {
    await p.waitForFunction(() => window.__sim, null, { timeout: 120000 });
    const err = await p.evaluate(() => window.__sim.error); if (err) e.push('sim error: ' + err);
    await p.waitForTimeout(800); await isLang(p, e, 'en'); await noCzech(p, e);
  });
  await check('sim so101 objects ?lang=en', '/sim/so101/objects.html?lang=en', async (p, e) => { await p.waitForTimeout(4000); await noCzech(p, e); });
  await check('sim so101 setup wizard ?lang=en', '/sim/so101/nastaveni/?lang=en', async (p, e) => { await p.waitForTimeout(4000); await noCzech(p, e); });
  await check('arena ?lang=en', '/sim/arena/?robot=svrn&lang=en', async (p, e) => {
    await p.waitForSelector('#pick > *', { timeout: 60000 }); await p.waitForSelector('#maps > *', { timeout: 60000 });
    await p.waitForTimeout(800); await isLang(p, e, 'en'); await noCzech(p, e);
  });
  await check('arena stays Czech without ?lang', '/sim/arena/?robot=svrn', async (p, e) => {
    await p.waitForSelector('#pick > *', { timeout: 60000 }); await isLang(p, e, 'cs');
    const t = await p.locator('#start-h').innerText(); if (t.trim() !== 'Vyzkoušejte v aréně') e.push('Czech heading changed: ' + t);
  }, { locale: 'en-US' });
}

await browser.close();
process.exit(failed ? 1 : 0);
