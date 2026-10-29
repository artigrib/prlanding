// Regression: the "Hotovo!" win card fits at every width 320–1366 px, both orientations, tablets included,
// also with long button labels. Checks: no descendant of .win wider / outside the card, card inside the
// viewport horizontally, no horizontal page overflow.
//   node sim/so101/tests/win-layout.cjs [screenshot-dir]
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = process.argv[2] || null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// Nexus 9 is not in Playwright's device list: 768×1024 CSS px, DPR 2, Android Chrome
const NEXUS9 = { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 7.0; Nexus 9 Build/NRD90R) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36' };
const land = (d) => ({ ...d, viewport: { width: d.viewport.height, height: d.viewport.width } });
const DEVICES = [
  ['Nexus 9 portrait', NEXUS9], ['Nexus 9 landscape', land(NEXUS9)],
  ['Nexus 7', devices['Nexus 7']], ['Galaxy Tab S4', devices['Galaxy Tab S4']],
  ['iPad Mini portrait', devices['iPad Mini']], ['iPad Mini landscape', devices['iPad Mini landscape'] || land(devices['iPad Mini'])],
  ['iPhone SE', devices['iPhone SE']]
].filter(([, d]) => d);
const SWEEP = [[320, 568], [360, 740], [390, 844], [480, 800], [600, 960], [712, 1138], [768, 1024], [800, 1280], [860, 900],
  [861, 900], [960, 600], [1024, 768], [1138, 712], [1180, 820], [1280, 800], [1366, 768], [1366, 1024]];

// show the win card (normal + assisted + long labels) without playing the mission
const SHOW = (variant) => {
  const u = window.__sim._ux;
  u.runner.won = true; u.runner.assisted = variant === 'assisted';
  u.runner.result = { id: 'bowl', time: 12.3, prec: 0.0041, stars: 2 };
  u.app.won = false; u.win();
  if (variant === 'long') {
    document.getElementById('cta').firstChild.textContent = 'Postavte si vlastní robotickou ruku SO-101 ze stavebnice ';
    document.getElementById('again').firstChild.textContent = 'Zkusit to ještě jednou úplně od začátku ';
    document.getElementById('ux-next').firstChild.textContent = 'Pokračovat na další misi v pořadí ';
  }
  document.getElementById('win').style.animation = 'none';
};
const CHECK = () => {
  const win = document.getElementById('win'), r = win.getBoundingClientRect(), bad = [];
  for (const e of win.querySelectorAll('*')) {
    if (!e.getClientRects().length) continue;
    const q = e.getBoundingClientRect();
    if (q.width > r.width + 0.5 || q.left < r.left - 0.5 || q.right > r.right + 0.5) bad.push((e.id || e.className || e.tagName) + ' ' + Math.round(q.left) + '–' + Math.round(q.right));
    if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible' && e !== win) bad.push('clipped ' + (e.id || e.className));
  }
  return { bad, card: [Math.round(r.left), Math.round(r.right)], vw: innerWidth, docW: document.documentElement.scrollWidth, inView: r.left >= -0.5 && r.right <= innerWidth + 0.5 };
};

(async () => {
  const port = await freePort();
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const url = `http://127.0.0.1:${port}/sim/so101/?test=1&mise=bowl&detail=low`;
  const browser = await chromium.launch({ args: ARGS });
  const verify = async (page, label) => {
    for (const v of ['normal', 'assisted', 'long']) {
      await page.evaluate(SHOW, v);
      const c = await page.evaluate(CHECK);
      ok(!c.bad.length && c.inView && c.docW <= c.vw, `${label} [${v}] card ${c.card} vw ${c.vw} doc ${c.docW}${c.bad.length ? ' bad: ' + c.bad.join('; ') : ''}`);
    }
  };
  try {
    for (const [name, dev] of DEVICES) {
      const ctx = await browser.newContext({ ...dev });
      const page = await ctx.newPage();
      await page.goto(url);
      await page.waitForFunction(() => window.__sim && window.__sim.ready, null, { timeout: 300000 });
      await verify(page, name);
      if (OUT) await page.screenshot({ path: path.join(OUT, 'win-' + name.replace(/\s+/g, '-') + '.png'), timeout: 120000 }).catch(() => {});
      await ctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.__sim && window.__sim.ready, null, { timeout: 300000 });
    for (const [w, h] of SWEEP) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(150); await verify(page, `${w}×${h}`); }
    await ctx.close();
  } catch (e) { console.log('FAIL exception', e); fails++; }
  await browser.close(); srv.kill();
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
  process.exit(fails ? 1 : 0);
})();
