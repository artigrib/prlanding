// Playwright checks for the SO-101 pages: mission page still works, wizard happy path, fault scenarios.
// Run from the repo root:  node sim/so101/test/wizard.pw.cjs [screenshot-dir]
// Needs: npm package "playwright" with Chromium, python3 (static server).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const SHOTS = process.argv[2] || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'ok   ' : 'FAIL ') + label); if (!cond) failures++; };

async function server() {
  const port = await freePort();
  const p = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const up = await new Promise((r) => { const c = net.connect(port, '127.0.0.1', () => { c.end(); r(true); }); c.on('error', () => r(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url: `http://127.0.0.1:${port}`, stop: () => p.kill() };
}

async function newPage(browser, viewport, errors) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 500, isMobile: viewport.width < 500 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  // external requests (Google Fonts) may fail in a sandbox without internet: not a page error
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  return page;
}
const shot = async (page, name) => { if (!SHOTS) return; await page.evaluate(() => window.__wiz && window.__wiz.render()); await page.screenshot({ path: path.join(SHOTS, name + '.png'), timeout: 120000 }); };
const state = (page) => page.evaluate(() => window.__wiz.state());
const idle = (page) => page.waitForFunction(() => !window.__wiz.state().busy, null, { timeout: 20000 });

async function wizardSetup(page, base, { shots = false, prefix = '' } = {}) {
  await page.goto(base + '/sim/so101/nastaveni/?test=1');
  await page.waitForFunction(() => window.__wiz, null, { timeout: 30000 });
  await page.evaluate(() => window.__wiz.ready());
  await page.waitForSelector('#v-connect:not([disabled])');
  if (shots) {
    await shot(page, prefix + '1-port');
    ok(!(await page.isVisible('#real-card')), prefix + 'real-arm beta hidden without ?real=1');
  }
  await page.click('#v-connect');
  await page.waitForSelector('.step[data-step="ids"]:not([hidden])');
  // assign IDs one servo at a time (gripper first)
  for (let k = 0; k < 6; k++) {
    await idle(page);
    const label = await page.textContent('#id-go');
    ok(label.includes('ID ' + (6 - k)), `${prefix}button asks for ID ${6 - k}`);
    await page.click('#id-go');
    await page.waitForFunction((n) => window.__wiz.state().idDone === n, k + 1, { timeout: 10000 });
    if (shots && k === 2) await shot(page, prefix + '2-ids');
  }
  await idle(page);
  await page.click('#id-go');           // chain wired -> verify
  await page.waitForSelector('.step[data-step="cal"]:not([hidden])', { timeout: 10000 });
  await idle(page);
  // calibration A: centre
  await page.click('#cal-mid-help');
  await page.evaluate(() => window.__wiz.advance(2));
  await page.click('#cal-mid');
  await page.waitForSelector('#cal-b:not([hidden])');
  await idle(page);
  // B: sweep joints; let polling record (advance in slices)
  await page.click('#cal-sweep');
  // real time would let the 120 ms register poll see every pose; here we step 0.1 s and wait for a poll
  for (let i = 0; i < 300 && (await state(page)).sweep; i++) { await page.evaluate(() => window.__wiz.advance(0.1)); await page.waitForTimeout(140); }
  await page.waitForTimeout(400);
  if (shots) await shot(page, prefix + '3-cal');
  await page.click('#cal-save');
  await page.waitForSelector('.step[data-step="test"]:not([hidden])', { timeout: 10000 });
  await idle(page);
  const st = await state(page);
  ok(st.cal && st.cal.wrist_roll.range_max === 4095, prefix + 'calibration saved (wrist_roll full turn)');
  ok(st.cal && st.cal.elbow_flex.range_max - st.cal.elbow_flex.range_min > 1800, prefix + 'elbow range recorded ' + (st.cal && st.cal.elbow_flex.range_max - st.cal.elbow_flex.range_min));
  await page.click('#t-torque');
  await page.waitForFunction(() => window.__wiz.state().torque, null, { timeout: 10000 });
  await idle(page);
}

async function diag(page) {
  await page.click('#diag-go');
  await page.waitForSelector('#diag li[data-code]', { timeout: 15000 });
  await idle(page);
  return page.$$eval('#diag li[data-code]', (l) => l.map((x) => x.dataset.code));
}

(async () => {
  const srv = await server();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const ONLY = process.env.ONLY || '';
    // 1) mission page regression after the core.js refactor
    if (!ONLY || ONLY === 'mission') {
      const errors = [];
      const page = await newPage(browser, { width: 1280, height: 800 }, errors);
      await page.goto(srv.url + '/sim/so101/?test=1');
      await page.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 30000 });
      await page.evaluate(() => { window.__sim.demo(); window.__sim.advance(9.5); });
      const s = await page.evaluate(() => window.__sim.state());
      ok(s.won, 'mission page: scripted demo still wins');
      await page.waitForTimeout(300);
      await shot(page, 'mission-1280');
      ok(!errors.length, 'mission page: no console errors ' + errors.join(' | '));
      await page.context().close();
    }

    // 2) wizard happy path, desktop
    if (!ONLY || ONLY === 'happy') {
      const errors = [];
      const page = await newPage(browser, { width: 1280, height: 800 }, errors);
      await wizardSetup(page, srv.url, { shots: true, prefix: 'd' });
      await page.click('#t-mission');
      for (let i = 0; i < 12 && !(await state(page)).won; i++) await page.evaluate(() => window.__wiz.advance(1));
      const s = await state(page);
      ok(s.won, 'wizard: mission through the bus wins');
      if (!s.won) console.log(JSON.stringify(await page.evaluate(() => { const a = window.__wiz.arm; return { hud: document.getElementById('hud-text').textContent, cal: window.__wiz.state().cal, goals: a.servos.map((x) => x.reg('Goal_Position')), torque: a.servos.map((x) => x.mem[40]), q: a.servos.map((x, i) => a.plant.q(i)) }; })));
      await page.waitForTimeout(400);
      await shot(page, 'd4-test-win');
      await page.click('#again');
      const codes = await diag(page);
      ok(codes.join() === 'all-ok', 'wizard: diagnostics all ok after setup (' + codes + ')');
      const rows = await page.$$eval('#reg-t tbody tr', (r) => r.map((x) => x.textContent));
      ok(rows.length === 6 && rows.every((r) => /V/.test(r) && /°C/.test(r)), 'wizard: live registers for 6 servos');
      // STOP turns torque off
      await page.click('#stop');
      await page.waitForTimeout(400);
      const tq = await page.evaluate(() => window.__wiz.arm.servos.map((s) => s.mem[40]));
      ok(tq.every((v) => v === 0), 'wizard: STOP disables torque on all servos');
      ok(!errors.length, 'wizard: no console errors ' + errors.join(' | '));
      await page.context().close();
    }

    // 3) fault scenarios
    for (const [fault, code, name] of (!ONLY || ONLY === 'faults') ? [['cable', 'cable', 'loose cable'], ['dupid', 'dup-id', 'duplicate ID'], ['supply', 'overvolt', 'wrong supply']] : []) {
      const errors = [];
      const page = await newPage(browser, { width: 1280, height: 800 }, errors);
      await wizardSetup(page, srv.url, { prefix: fault + ': ' });
      await page.click(`input[data-f="${fault}"]`);
      await page.evaluate(() => window.__wiz.advance(0.5));
      await page.waitForTimeout(300);
      const codes = await diag(page);
      ok(codes.includes(code), `fault ${name}: diagnostics reports ${code} (${codes})`);
      const text = await page.textContent('#diag');
      ok(/Jak opravit/.test(text), `fault ${name}: fix explained`);
      if (fault === 'cable') { await page.locator('#diag').scrollIntoViewIfNeeded(); await shot(page, 'd5-fault-cable'); }
      ok(!errors.length, `fault ${name}: no console errors ` + errors.join(' | '));
      await page.context().close();
    }

    // 4) phone layout
    if (!ONLY || ONLY === 'phone') {
      const errors = [];
      const page = await newPage(browser, { width: 390, height: 844 }, errors);
      await page.addInitScript(() => { delete Navigator.prototype.serial; });   // behave like Safari / iOS / Firefox
      await page.goto(srv.url + '/sim/so101/nastaveni/?test=1&real=1');
      await page.waitForFunction(() => window.__wiz, null, { timeout: 30000 });
      await page.evaluate(() => window.__wiz.ready());
      await page.waitForTimeout(500);
      await shot(page, 'p1-port-390');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      ok(!overflow, 'phone: no horizontal scroll');
      ok(await page.isVisible('#r-no') && !(await page.isVisible('#r-connect')), 'phone without Web Serial: real-arm button hidden, explanation shown');
      await page.click('input[name=variant][value="12"]');     // 12 V servos
      await page.click('#v-connect');
      await page.waitForSelector('.step[data-step="ids"]:not([hidden])');
      await page.click('#id-skip');
      await page.waitForSelector('.step[data-step="cal"]:not([hidden])', { timeout: 15000 });
      await page.waitForTimeout(600);
      await shot(page, 'p2-cal-390');
      await page.click(`input[data-f="supply"]`);              // 5 V adapter on 12 V servos
      await page.evaluate(() => window.__wiz.advance(0.5));
      const codes = await diag(page);
      ok(codes.includes('undervolt'), 'phone: 5 V supply on 12 V servos detected (' + codes + ')');
      await page.locator('#diag').scrollIntoViewIfNeeded();
      await shot(page, 'p3-diag-390');
      const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      ok(!overflow2, 'phone: no horizontal scroll after diagnostics');
      ok(!errors.length, 'phone: no console errors ' + errors.join(' | '));
      await page.context().close();
    }

    // 5) real-arm code path: SerialTransport over a fake Web Serial port that wraps the emulator
    //    (no hardware here — this checks our stream handling, torque-on safety and STOP)
    if (!ONLY || ONLY === 'serial') {
      const errors = [];
      const page = await newPage(browser, { width: 1280, height: 800 }, errors);
      await page.addInitScript(() => {
        let arm = null;
        class FakePort {
          getInfo() { return { usbVendorId: 0x1a86, usbProductId: 0x55d3 }; }
          async open({ baudRate }) {
            const self = this; this.baud = baudRate;
            this.readable = new ReadableStream({ start(c) { self.c = c; } });
            this.writable = new WritableStream({ write(chunk) { const r = arm.receive(chunk, self.baud); setTimeout(() => r.forEach((x) => self.c.enqueue(x)), 1); } });
          }
          async close() { this.readable = null; this.writable = null; }
        }
        const port = new FakePort();
        Object.defineProperty(Navigator.prototype, 'serial', { configurable: true, get: () => ({
          requestPort: async () => {
            const { VirtualArm, KinematicPlant } = await import('/sim/so101/lib/sts3215-emu.js');
            arm = new VirtualArm({ plant: new KinematicPlant([0.1, -0.2, 0.3, 0.1, 0, 0.8]) });
            arm.servos.forEach((s, i) => { s.saved[5] = i + 1; });          // IDs already assigned
            arm.setWiring('chain');
            window.__fake = arm;
            setInterval(() => arm.update(0.02), 20);
            return port;
          },
          addEventListener() {}, removeEventListener() {}
        }) });
      });
      await page.goto(srv.url + '/sim/so101/nastaveni/?test=1&real=1');
      await page.waitForFunction(() => window.__wiz, null, { timeout: 30000 });
      ok(await page.isVisible('#r-connect') && await page.isDisabled('#r-connect'), 'serial (?real=1): real-arm button shown, locked until the risk checkbox is ticked');
      await page.check('#r-ack');
      await page.click('#r-connect');
      await page.waitForSelector('.step[data-step="ids"]:not([hidden])', { timeout: 10000 });
      ok(await page.isVisible('#stop'), 'serial: STOP visible once connected');
      await page.click('#id-skip');
      await page.waitForSelector('.step[data-step="cal"]:not([hidden])', { timeout: 15000 });
      ok(!(await page.isVisible('#cal-sweep')) && !(await page.isVisible('#hand')), 'serial: no virtual hand controls for the real arm');
      await idle(page);
      await page.evaluate(() => [0, 0, 0, 0, 0, 0.785].forEach((q, i) => window.__fake.plant.hand(i, q)));
      await page.click('#cal-mid');
      await page.waitForSelector('#cal-b:not([hidden])');
      for (const q of [-1.6, 1.6, 0]) {
        await page.evaluate((q) => [0, 1, 2, 3, 4, 5].forEach((i) => window.__fake.plant.hand(i, i === 5 ? Math.max(-0.17, Math.min(1.74, q)) : q)), q);
        await page.waitForTimeout(400);
      }
      await idle(page);
      await page.click('#cal-save');
      await page.waitForSelector('.step[data-step="test"]:not([hidden])', { timeout: 10000 });
      await idle(page);
      const before = await page.evaluate(() => window.__fake.servos.map((s) => s.reg('Present_Position')));
      await page.click('#t-torque');
      await page.waitForFunction(() => window.__wiz.state().torque, null, { timeout: 10000 });
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => window.__fake.servos.map((s) => s.reg('Present_Position')));
      ok(after.every((p, i) => Math.abs(p - before[i]) <= 2), 'serial: enabling torque does not move the arm (goal = present first)');
      const vel = await page.evaluate(() => window.__fake.servos.map((s) => s.reg('Goal_Velocity')));
      ok(vel.every((v) => v === Math.round(30 * 4096 / 360)), 'serial: servo-side speed cap written (' + vel[0] + ')');
      // ask for a big jump on the base; the browser rate limit (30 °/s) must spread it out
      await page.evaluate(() => { const i = document.getElementById('t-shoulder_pan'); i.value = i.max; i.dispatchEvent(new Event('input')); });
      const t0 = await page.evaluate(() => window.__fake.servos[0].reg('Goal_Position'));
      await page.evaluate(() => window.__wiz.advance(1));      // 1 s of frames (rAF is paused in test mode)
      await page.waitForTimeout(100);
      const t1 = await page.evaluate(() => window.__fake.servos[0].reg('Goal_Position'));
      const deg = Math.abs(t1 - t0) * 360 / 4096;
      ok(deg > 25 && deg < 35, `serial: goal moves at the 30 °/s limit (${deg.toFixed(1)}° in 1 s)`);
      const max = await page.evaluate(() => +document.getElementById('t-shoulder_pan').max);
      const cal = (await state(page)).cal.shoulder_pan;
      ok(max < (cal.range_max - cal.range_min) / 2 * 360 / 4095, 'serial: slider range is inside the calibrated range (margin)');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const tq = await page.evaluate(() => window.__fake.servos.map((s) => s.mem[40]));
      ok(tq.every((v) => v === 0), 'serial: Esc = STOP, torque off on all servos');
      await shot(page, 'd6-real-beta');
      ok(!errors.length, 'serial: no console errors ' + errors.join(' | '));
      await page.context().close();
    }
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
