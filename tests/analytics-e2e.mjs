// Analytics + consent end to end (Playwright, Chromium with software GL).
//   node tests/analytics-e2e.mjs [screenshot-dir]
// Starts the static site (python3 -m http.server) and the real api (backend/api, NDJSON sink in a temp dir)
// on free ports, points assets/track.js at the api through window.PR_TRACK_URL, then checks:
//   consent not given / declined -> zero requests to /e;  allowed -> events arrive (site, SO-101, arena);
//   DNT / GPC -> no banner, zero requests;  banner passes axe-core (CZ + EN, 390 px + 1440 px).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv[2] || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sitePort = await freePort(), apiPort = await freePort();
const SITE = `http://127.0.0.1:${sitePort}`, API = `http://127.0.0.1:${apiPort}/e`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-analytics-e2e-'));
const procs = [
  spawn('python3', ['-m', 'http.server', String(sitePort), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' }),
  spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/main.ts'], {
    cwd: path.join(ROOT, 'backend/api'), stdio: 'ignore',
    env: { ...process.env, PORT: String(apiPort), DB_PATH: ':memory:', ALLOWED_ORIGINS: SITE, TRUST_PROXY: '0', ANALYTICS_DIR: dataDir, APP_VERSION: 'e2e' }
  })
];
const cleanup = () => { for (const p of procs) p.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); };
process.on('exit', cleanup);
for (const u of [SITE + '/', `http://127.0.0.1:${apiPort}/health`]) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(u)).ok) break; } catch (e) { /* not yet */ } await sleep(250); }
}

/** All events the api has written so far (NDJSON flushes every 2 s). */
function stored() {
  const out = [];
  for (const f of fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []) {
    for (const l of fs.readFileSync(path.join(dataDir, f), 'utf8').split('\n')) if (l) out.push(JSON.parse(l));
  }
  return out;
}
async function waitFor(pred, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const ev = stored(); if (pred(ev)) return ev; await sleep(300); }
  return stored();
}
const has = (ev, name, f = () => true) => ev.some((e) => e.event === name && f(e));

const browser = await chromium.launch({ args: ARGS });
async function ctx({ vp = { width: 1440, height: 900 }, dnt = false } = {}) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: vp.width < 600, isMobile: vp.width < 600 });
  await c.addInitScript(([url, dnt]) => {
    window.PR_TRACK_URL = url;
    if (dnt) Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true });
  }, [API, dnt]);
  await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await c.route(/script\.google\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  c.hits = [];
  c.on('request', (r) => { if (r.url().startsWith(API)) { c.hits.push(r.url()); if (process.env.DEBUG) console.log('  /e', r.postData()); } });
  if (process.env.DEBUG) c.on('response', (r) => { if (r.url().startsWith(API)) console.log('  /e ->', r.status()); });
  return c;
}
async function page(c, url) {
  const p = await c.newPage();
  p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails++; });
  await p.goto(SITE + url, { waitUntil: 'load' });
  return p;
}
const banner = (p) => p.locator('section.prc');

// ---------------------------------------------------------------- 1. no decision: nothing is sent
{
  const c = await ctx();
  const p = await page(c, '/');
  await banner(p).waitFor({ timeout: 10000 });
  ok(await banner(p).isVisible(), 'banner shown on first visit (CZ)');
  ok(/Povolit analytiku/.test(await banner(p).innerText()) && /Odmítnout/.test(await banner(p).innerText()), 'CZ buttons');
  ok((await p.locator('.site-f [data-pr-consent]').count()) === 1, 'footer has "Nastavení soukromí"');
  await p.evaluate(() => { window.prTrack('cta_click', { id: 'x' }); });
  await p.goto(SITE + '/sada/so101/', { waitUntil: 'load' });
  await sleep(4000);
  await p.close({ runBeforeUnload: true });
  await sleep(500);
  ok(c.hits.length === 0, `no decision -> zero requests to /e (got ${c.hits.length})`);
  await c.close();
}

// ---------------------------------------------------------------- 2. declined: nothing is sent, choice remembered
{
  const c = await ctx({ vp: { width: 390, height: 844 } });
  const p = await page(c, '/');
  await banner(p).waitFor();
  await p.getByRole('button', { name: 'Odmítnout' }).click();
  ok((await banner(p).count()) === 0, 'decline closes the banner');
  const st = await p.evaluate(() => [localStorage.getItem('pr-consent'), localStorage.getItem('pr-aid')]);
  ok(st[0] === 'denied' && st[1] === null, 'decline stored, no anonymous id');
  await p.reload({ waitUntil: 'load' });
  await sleep(1500);
  ok((await banner(p).count()) === 0, 'choice remembered after reload');
  await p.evaluate(() => window.prTrack('cta_click', { id: 'x' }));
  await p.goto(SITE + '/sim/arena/', { waitUntil: 'load' });
  await sleep(4000);
  await p.close({ runBeforeUnload: true });
  await sleep(500);
  ok(c.hits.length === 0, `declined -> zero requests to /e (got ${c.hits.length})`);
  await c.close();
}

// ---------------------------------------------------------------- 3. DNT / GPC: no banner, nothing sent
{
  const c = await ctx({ dnt: true });
  const p = await page(c, '/');
  await sleep(1500);
  ok((await banner(p).count()) === 0, 'GPC -> no banner');
  await p.evaluate(() => { window.prTrack.consent('granted'); window.prTrack('cta_click', { id: 'x' }); window.prTrack.flush(); });
  await p.locator('.site-f [data-pr-consent]').click();
  await banner(p).waitFor();
  ok(/Nesledovat/.test(await banner(p).innerText()) && (await p.locator('.prc [data-v]').count()) === 0, 'GPC -> settings explain, no allow button');
  await p.close({ runBeforeUnload: true });
  await sleep(500);
  ok(c.hits.length === 0, `GPC -> zero requests to /e (got ${c.hits.length})`);
  await c.close();
}

// ---------------------------------------------------------------- 4. banner: accessibility, equal buttons, screenshots
for (const [lang, url] of [['cs', '/'], ['en', '/en/']]) {
  for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const c = await ctx({ vp });
    const p = await page(c, url);
    await banner(p).waitFor();
    await p.evaluate(() => document.fonts && document.fonts.ready);
    const [a, b] = await Promise.all([p.locator('.prc [data-v="denied"]').boundingBox(), p.locator('.prc [data-v="granted"]').boundingBox()]);
    ok(a && b && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1 && a.height >= 44, `${lang} ${vp.width}px: both buttons same size (>= 44 px)`);
    const box = await banner(p).boundingBox();
    ok(box && box.x >= 15 && box.x + box.width <= vp.width - 15, `${lang} ${vp.width}px: banner inside the viewport`);
    await p.addScriptTag({ content: AXE });
    const res = await p.evaluate(() => window.axe.run('section.prc', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
    ok(res.violations.length === 0, `${lang} ${vp.width}px: axe on the banner` + (res.violations.length ? ': ' + res.violations.map((v) => v.id).join(', ') : ''));
    if (lang === 'en') ok(/Allow analytics/.test(await banner(p).innerText()), 'EN banner text');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `banner-${lang}-${vp.width}.png`) });
    await c.close();
  }
}

// ---------------------------------------------------------------- 5. allowed: events arrive
{
  const c = await ctx();
  const p = await page(c, '/?utm_source=newsletter&utm_campaign=oct');
  await banner(p).waitFor();
  await p.getByRole('button', { name: 'Povolit analytiku' }).click();
  let ev = await waitFor((e) => has(e, 'page_view'));
  const pv = ev.find((e) => e.event === 'page_view');
  ok(!!pv && pv.path === '/' && pv.props.utm_source === 'newsletter' && pv.props.utm_campaign === 'oct', 'page_view (from before the click) arrives with utm');
  const aid = await p.evaluate(() => localStorage.getItem('pr-aid'));
  ok(!!aid && pv && pv.anon_id === aid, 'anonymous id created on consent and used');
  ok(!JSON.stringify(ev).includes('127.0.0.1'), 'no IP in stored events');

  // settings show the current state
  await p.locator('.site-f [data-pr-consent]').click();
  ok(/Teď: povoleno/.test(await banner(p).innerText()), 'settings show "Teď: povoleno"');
  await banner(p).locator('[data-v="granted"]').click();

  // CTA + waitlist form (form endpoint mocked)
  await p.locator('a[data-cta="hero-sim"]').first().evaluate((a) => a.addEventListener('click', (e) => e.preventDefault(), { once: true }));
  await p.locator('a[data-cta="hero-sim"]').first().click();
  const wl = p.locator('form#waitlist'), hadWl = (await wl.count()) > 0;
  if (hadWl) {
    await wl.locator('input[type=email]').fill('test@example.com');
    await wl.locator('button[type=submit]').click();
  }
  if (hadWl) await wl.locator('.soft-msg, b').filter({ hasText: /Hotovo|Odesl|nepodařilo/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
  await p.evaluate(() => window.prTrack.flush());
  await sleep(1000);
  await p.goto(SITE + '/sada/so101/', { waitUntil: 'load' });
  ev = await waitFor((e) => has(e, 'kit_view') && has(e, 'cta_click') && (!hadWl || has(e, 'waitlist_submit')));
  ok(has(ev, 'cta_click', (e) => e.props.id === 'hero-sim'), 'cta_click {id: hero-sim}');
  if (process.env.DEBUG) console.log(ev.map((e) => e.event + ' ' + JSON.stringify(e.props)).join('\n'));
  if (hadWl) ok(has(ev, 'waitlist_submit', (e) => /^[a-z0-9_,-]+$/.test(e.props.interest || '')), 'waitlist_submit {interest}');
  ok(has(ev, 'kit_view', (e) => e.props.kit === 'so101'), 'kit_view {kit: so101}');
  ok(!JSON.stringify(ev).includes('test@example.com'), 'no e-mail in stored events');

  // SO-101 sim
  const s = await c.newPage();
  s.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails++; });
  await s.goto(SITE + '/sim/so101/?test=1', { waitUntil: 'load' });
  await s.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 300000 });
  ok((await banner(s).count()) === 0, 'sim: no banner after consent');
  await s.evaluate(() => { const a = window.__sim; a.setMode('joints'); a.setMode('smart'); a.mission('bowl'); a.solve(); });
  await s.evaluate(async () => { for (let i = 0; i < 60 && !window.__sim.state().won; i++) window.__sim.advance(0.5); });
  await s.evaluate(() => window.prTrack.flush());
  ev = await waitFor((e) => has(e, 'sim_loaded') && has(e, 'mission_win'), 30000);
  ok(has(ev, 'sim_load_start', (e) => e.props.sim === 'so101'), 'sim_load_start');
  ok(has(ev, 'sim_loaded', (e) => e.props.sim === 'so101' && e.props.ms > 0), 'sim_loaded {ms}');
  ok(has(ev, 'mode_changed', (e) => e.props.mode === 'joints'), 'mode_changed');
  ok(has(ev, 'solution_shown', (e) => e.props.mission === 'bowl'), 'solution_shown');
  ok(has(ev, 'mission_start', (e) => e.props.mission === 'bowl'), 'mission_start');
  ok(has(ev, 'mission_win', (e) => e.props.mission === 'bowl' && e.props.assisted === true), 'mission_win {assisted: true}');
  await s.close();

  // arena
  const r = await c.newPage();
  await r.goto(SITE + '/sim/arena/?debug', { waitUntil: 'load' });
  await r.waitForFunction(() => window.__arena && window.__arena.ready, null, { timeout: 180000 });
  await r.evaluate(() => { const a = window.__arena; a.halt = true; a.setup({ mode: 'quick' }); a.start(); a.sim(200); window.prTrack.flush(); });
  ev = await waitFor((e) => has(e, 'arena_match_end'), 30000);
  ok(has(ev, 'sim_loaded', (e) => e.props.sim === 'arena'), 'arena sim_loaded');
  ok(has(ev, 'arena_match_start', (e) => !!e.props.robot && !!e.props.opponent && e.props.mode === 'quick'), 'arena_match_start {robot, opponent, mode}');
  ok(has(ev, 'arena_match_end', (e) => ['win', 'loss', 'draw'].includes(e.props.result)), 'arena_match_end {result}');
  await r.close();

  // revoke: id deleted, nothing more is sent
  const q = await c.newPage();
  await q.goto(SITE + '/', { waitUntil: 'load' });
  await q.locator('.site-f [data-pr-consent]').click();
  await q.locator('.prc [data-v="denied"]').click();
  ok((await q.evaluate(() => localStorage.getItem('pr-aid'))) === null, 'revoking deletes the anonymous id');
  const before = c.hits.length;
  await q.evaluate(() => { window.prTrack('cta_click', { id: 'x' }); window.prTrack.flush(); });
  await sleep(1000);
  ok(c.hits.length === before, 'nothing sent after revoking');
  await c.close();
}

await browser.close();
cleanup();
console.log(fails ? `\n${fails} failure(s)` : '\nall analytics e2e checks passed');
process.exit(fails ? 1 : 0);
