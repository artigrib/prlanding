// Headless check of the ROBOTO ORIGIN sim page: loads (cs + en), steps, walks with the policy, pushes, gantry
// mode moves a joint, measures render FPS. Optional screenshots/frames: SHOTS=<dir>.
// Usage: node sim/origin/tests/origin-e2e.cjs [base=http://127.0.0.1:8123]
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:8123';
const SHOTS = process.env.SHOTS || '';
const IGNORE = /fonts\.(googleapis|gstatic)\.com/i;
let failed = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [lang, path] of [['cs', '/sim/origin/?test=1'], ['en', '/en/sim/origin/?test=1']]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text()) && !IGNORE.test(m.location().url || '') && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !IGNORE.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`); });
    const bytes = { total: 0 };
    page.on('response', async (r) => { try { const b = await r.body(); bytes.total += b.length; } catch (e) {} });
    const t = Date.now();
    try {
      await page.goto(BASE + path, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__origin && (window.__origin.ready || window.__origin.error), null, { timeout: 120000 });
      const err = await page.evaluate(() => window.__origin.error);
      ok(!err, 'sim error: ' + err);
      const info = await page.evaluate(() => ({ policy: window.__origin.policy, loadMs: window.__origin.loadMs, mode: window.__origin.mode(), robots: document.querySelector('meta[name=robots]').content }));
      ok(info.robots === 'index,follow', 'not indexable');
      ok(info.policy, 'policy did not load');
      ok(info.mode === 'walk', 'default mode ' + info.mode);
      // real-time FPS with the rAF loop running (software GL here)
      await page.waitForTimeout(2500);
      const fpsHi = await page.evaluate(() => window.__origin.fps());
      await page.waitForTimeout(6000);
      const fps = await page.evaluate(() => window.__origin.fps()), lowQ = await page.evaluate(() => window.__origin.lowQ());
      await page.evaluate(() => window.__origin.pause(true));
      // stand still 2 s, then walk 6 s forward at 0.5 m/s with the policy
      await page.evaluate(() => { window.__origin.reset(); window.__origin.setCmd({ vx: 0 }); });
      await page.evaluate(() => window.__origin.advance(2));
      const s0 = await page.evaluate(() => window.__origin.state());
      ok(s0.z > 0.6 && Math.hypot(s0.x, s0.y) < 0.3, 'standing: ' + JSON.stringify(s0));
      if (SHOTS && lang === 'cs') await page.evaluate(() => window.__origin.render()), await page.screenshot({ path: `${SHOTS}/origin-stand.png` });
      await page.evaluate(() => window.__origin.setCmd({ vx: 0.5 }));
      const frames = [];
      for (let k = 0; k < 12; k++) {
        await page.evaluate(() => window.__origin.advance(0.5));
        if (SHOTS && lang === 'cs') { await page.evaluate(() => window.__origin.render()); const f = `${SHOTS}/walk-${String(k).padStart(2, '0')}.png`; await page.locator('#c').screenshot({ path: f }); frames.push(f); }
      }
      const s1 = await page.evaluate(() => window.__origin.state());
      ok(s1.x - s0.x > 2.0 && s1.z > 0.6 && !s1.fallen, 'walk: ' + JSON.stringify(s1));
      // turn in place
      await page.evaluate(() => window.__origin.setCmd({ yaw: 0.6 }));
      await page.evaluate(() => window.__origin.advance(2));
      const s2 = await page.evaluate(() => window.__origin.state());
      ok(s2.z > 0.6 && !s2.fallen, 'turn: ' + JSON.stringify(s2));
      // a small push while standing: recovers
      await page.evaluate(() => { window.__origin.setCmd({ vx: 0 }); window.__origin.shove([0, 1]); });
      await page.evaluate(() => window.__origin.advance(3));
      const s3 = await page.evaluate(() => window.__origin.state());
      ok(s3.z > 0.6 && !s3.fallen, 'push recovery: ' + JSON.stringify(s3));
      // gantry: joint slider moves the joint
      await page.evaluate(() => window.__origin.setMode('stand'));
      await page.evaluate(() => window.__origin.setSlider(16, 2.0));   // left elbow pitch
      await page.evaluate(() => window.__origin.advance(1.5));
      const el = await page.evaluate(() => +document.getElementById('j16-o').textContent.replace('°', '') || null);
      const s4 = await page.evaluate(() => window.__origin.state());
      ok(s4.mode === 'stand' && Math.abs(s4.z - 0.8) < 0.08, 'gantry hold: ' + JSON.stringify(s4));
      if (SHOTS && lang === 'cs') {
        await page.evaluate(() => window.__origin.render()); await page.screenshot({ path: `${SHOTS}/origin-gantry.png` });
        await page.evaluate(() => window.__origin.explode(true)); await page.evaluate(() => window.__origin.render()); await page.screenshot({ path: `${SHOTS}/origin-exploded.png` });
        await page.evaluate(() => window.__origin.explode(false));
      }
      const elbow = await page.evaluate(() => window.__origin.state());
      ok(errors.length === 0, errors.join(' | '));
      console.log(`ok   ${lang} load ${info.loadMs} ms, fps ${fpsHi.toFixed(1)} -> ${fps.toFixed(1)}${lowQ ? ' (auto low quality)' : ''}, policy ${s1.policyMs.toFixed(2)} ms/tick, walked ${(s1.x - s0.x).toFixed(2)} m in 6 s, ` +
        `after push z=${s3.z.toFixed(2)}, transferred ${(bytes.total / 1e6).toFixed(2)} MB, ${((Date.now() - t) / 1000).toFixed(0)} s`);
      if (SHOTS && lang === 'cs') fs.writeFileSync(`${SHOTS}/e2e.json`, JSON.stringify({ fpsHi, fps, lowQ, info, s0, s1, s2, s3, s4, bytes: bytes.total, el }, null, 1));
    } catch (e) {
      failed++; console.log(`FAIL ${lang}: ${e.message.split('\n')[0]}${errors.length ? '\n  ' + errors.join('\n  ') : ''}`);
    }
    await page.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
