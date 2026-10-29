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

// Fake Web Serial: a port whose streams talk to the emulator (no hardware). Knobs for the safety
// tests: window.__fakeDelay (ms per write), window.__fakeHang (writes never complete),
// window.__fakeDisc() (fires the 'disconnect' event), window.__fakeClosed (port.close() was called).
function FAKE_SERIAL() {
  let arm = null, onDisc = null;
  class FakePort {
    getInfo() { return { usbVendorId: 0x1a86, usbProductId: 0x55d3 }; }
    async open({ baudRate }) {
      const self = this; this.baud = baudRate;
      this.readable = new ReadableStream({ start(c) { self.c = c; } });
      this.writable = new WritableStream({ async write(chunk) {
        if (window.__fakeHang) return new Promise(() => {});
        if (window.__fakeDelay) await new Promise((r) => setTimeout(r, window.__fakeDelay));
        const r = arm.receive(chunk, self.baud); setTimeout(() => r.forEach((x) => self.c.enqueue(x)), 1);
      } });
    }
    async close() { window.__fakeClosed = true; this.readable = null; this.writable = null; }
  }
  const port = new FakePort();
  window.__fakeDisc = () => onDisc && onDisc({ target: port });
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
    addEventListener(type, fn) { if (type === 'disconnect') onDisc = fn; }, removeEventListener() {}
  }) });
}

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

/** Real-arm arming checklist (SR-3/13/19): tick the four boxes, pick a profile, press "Aktivovat pohyb". */
async function arm(page, profile = 'owner') {
  await page.check(`input[name=profile][value="${profile}"]`);
  for (const c of await page.$$('#arm-checks input')) await c.check();
  await page.click('#arm-go');
  await page.waitForFunction(() => window.__wiz.state().perm.armed, null, { timeout: 5000 });
  await idle(page);
}
/** Switch torque on (real path); one retry when a reply got lost on a loaded CI machine, with the reason logged. */
async function torqueOn(page) {
  for (let k = 0; k < 2; k++) {
    await page.click('#t-torque');
    const on = await page.waitForFunction(() => window.__wiz.state().torque, null, { timeout: 10000 }).then(() => true, () => false);
    if (on) return;
    console.log('torque-on retry:', await page.textContent('#t-msg'), await page.textContent('#arm-msg'), JSON.stringify((await state(page)).perm));
    await idle(page);
  }
  throw new Error('torque did not switch on');
}
const fakeTorque = (page) => page.evaluate(() => window.__fake.servos.map((s) => s.mem[40]));

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
      // the poll shows "—" while diagnostics hold the bus; wait for the next live read
      await page.waitForFunction(() => [...document.querySelectorAll('#reg-t tbody tr')].every((x) => /°C/.test(x.textContent)), null, { timeout: 3000 }).catch(() => {});
      const rows = await page.$$eval('#reg-t tbody tr', (r) => r.map((x) => x.textContent));
      ok(rows.length === 6 && rows.every((r) => /V/.test(r) && /°C/.test(r)), 'wizard: live registers for 6 servos');
      if (!rows.every((r) => /°C/.test(r))) console.log('rows:', JSON.stringify(rows), await page.textContent('#reg-note'));
      // two-stage STOP: 1st = hold (arm joints keep torque, gripper released), 2nd = torque off
      const tqv = () => page.evaluate(() => window.__wiz.arm.servos.map((s) => s.mem[40]));
      await page.click('#stop');
      await page.waitForTimeout(400);
      ok((await tqv()).join() === '1,1,1,1,1,0', 'wizard: 1st STOP holds the arm, gripper torque off (' + (await tqv()) + ')');
      ok(await page.isVisible('#stop-release') && await page.isDisabled('#t-torque'), 'wizard: STOP latched, only "Uvolnit STOP" releases it');
      await page.click('#stop');
      await page.waitForTimeout(400);
      ok((await tqv()).every((v) => v === 0), 'wizard: 2nd STOP disables torque on all servos');
      await page.click('#stop-release');
      ok(!(await page.isVisible('#stop-release')) && !(await page.isDisabled('#t-torque')), 'wizard: released STOP, torque can be switched on again');
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
      await page.addInitScript(FAKE_SERIAL);
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
      // SR-13/19: no torque, no motion without the arming checklist, and only on allow-listed firmware
      ok(await page.isDisabled('#t-torque'), 'serial: "Zapnout moment" locked until motion is armed');
      ok(/jen čtení \(shadow\)/.test(await page.textContent('#armed-bar')), 'serial: banner says read-only (shadow) while disarmed');
      ok(await page.isDisabled('#arm-go'), 'serial: "Aktivovat pohyb" locked until all four checklist items are ticked');
      for (const c of await page.$$('#arm-checks input')) await c.check();
      await page.click('#arm-go');
      await page.waitForFunction(() => /není na seznamu/.test(document.getElementById('arm-msg').textContent), null, { timeout: 5000 });
      const st0 = await state(page);
      ok(!st0.perm.armed && st0.fw && st0.fw.reason === 'allow_list_empty' && /3\.10/.test(await page.textContent('#arm-msg')),
        'serial SR-19: firmware 3.10 not on the (empty) allow-list -> stays shadow, version named');
      await page.evaluate(() => window.__wiz.setFirmwareAllow([window.__wiz.EMULATED_FIRMWARE]));
      // teacher profile: 20 °/s, slider capped
      await arm(page, 'teacher');
      const tst = await state(page);
      ok(tst.speed === 20 && await page.evaluate(() => +document.getElementById('t-speed').max) === 20, 'serial: teacher profile caps the speed at 20 °/s');
      ok(/POHYB POVOLEN · učitelský režim · zbývá [345]:\d\d/.test(await page.textContent('#armed-bar')), 'serial: armed banner with profile and countdown (' + await page.textContent('#armed-bar') + ')');
      ok((await page.title()).startsWith('● REAL'), 'serial: page title marked ● REAL while armed');
      ok(await page.isDisabled('input[name=profile][value="owner"]'), 'serial: profile cannot change while armed');
      // STOP while armed but unpowered disarms; release, re-arm as owner
      await page.click('#stop'); await idle(page); await page.waitForTimeout(200);
      ok(!(await state(page)).perm.armed, 'serial: STOP withdraws the motion permission');
      await page.click('#stop-release');
      await arm(page, 'owner');
      ok(await page.evaluate(() => +document.getElementById('t-speed').max) === 60, 'serial SR-7: owner speed slider stops at 60 °/s');
      await page.evaluate(() => { const i = document.getElementById('t-speed'); i.max = 90; i.value = 90; i.dispatchEvent(new Event('input')); });
      ok((await state(page)).speed === 60, 'serial SR-7: a forged 90 °/s slider value is clamped to 60');
      await page.evaluate(() => { const i = document.getElementById('t-speed'); i.value = 30; i.dispatchEvent(new Event('input')); });
      const before = await page.evaluate(() => window.__fake.servos.map((s) => s.reg('Present_Position')));
      await torqueOn(page);
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => window.__fake.servos.map((s) => s.reg('Present_Position')));
      ok(after.every((p, i) => Math.abs(p - before[i]) <= 2), 'serial: enabling torque does not move the arm (goal = present first)');
      const vel = await page.evaluate(() => window.__fake.servos.map((s) => s.reg('Goal_Velocity')));
      ok(vel.every((v) => v === Math.ceil(30 * 1.25 / 4.392)), 'serial: servo-side speed cap written in 0.732 rpm units (' + vel[0] + ')');
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
      // SR-6 stage one during motion: Esc = HOLD (goal := present on 1–5, gripper released), measured T1
      await page.evaluate(() => window.__wiz.advance(0.3));
      await page.keyboard.press('Escape');
      await idle(page); await page.waitForTimeout(300);
      const hs = await state(page);
      const tqH = await fakeTorque(page);
      const gp = await page.evaluate(() => window.__fake.servos.map((s) => [s.reg('Goal_Position'), s.reg('Present_Position')]));
      ok(tqH.join() === '1,1,1,1,1,0', 'serial SR-6: Esc = HOLD, joints 1–5 keep torque, gripper torque off (' + tqH + ')');
      ok(gp.slice(0, 5).every(([g, p]) => Math.abs(g - p) <= 2), 'serial SR-6: hold writes goal := present on joints 1–5');
      ok(hs.latch === 'hold' && hs.lastStop && hs.lastStop.stage === 'hold' && hs.lastStop.ok, 'serial SR-6: hold latched and verified by read-back');
      ok(hs.lastStop.t1Ms != null && hs.lastStop.t1Ms < 30, `serial SR-15: STOP T1 keydown -> emergency write ${hs.lastStop.t1Ms && hs.lastStop.t1Ms.toFixed(1)} ms (< 30 ms)`);
      ok(/ruka drží, chapadlo uvolněno/.test(await page.textContent('#alert')), 'serial SR-6: banner "STOP: ruka drží, chapadlo uvolněno"');
      const pan0 = await page.evaluate(() => window.__fake.servos[0].reg('Present_Position'));
      await page.evaluate(() => window.__wiz.advance(1)); await page.waitForTimeout(300);
      const pan1 = await page.evaluate(() => window.__fake.servos[0].reg('Present_Position'));
      ok(Math.abs(pan1 - pan0) <= 2, 'serial SR-6: nothing streams while the STOP is latched (base stays put)');
      ok(await page.isDisabled('#t-torque'), 'serial: torque-on locked while STOP is latched');
      // stage two: Esc again = LIMP
      await page.keyboard.press('Escape');
      await idle(page); await page.waitForTimeout(400);
      ok((await fakeTorque(page)).every((v) => v === 0), 'serial SR-6: 2nd Esc = torque off on all servos');
      ok(/bez síly/.test(await page.textContent('#alert')), 'serial SR-6: limp banner says the arm has no torque');
      await page.click('#stop-release');
      const rel = await state(page);
      ok(rel.latch === null && !rel.perm.armed && await page.isDisabled('#t-torque'), 'serial: "Uvolnit STOP" clears the latch but needs a fresh arming');
      // press-and-hold STOP for 1 s = limp
      await arm(page);
      await torqueOn(page);
      await idle(page);
      const box = await page.locator('#stop').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(400);
      const mid = await fakeTorque(page);
      await page.waitForTimeout(900);
      await page.mouse.up();
      await idle(page); await page.waitForTimeout(300);
      ok(mid.join() === '1,1,1,1,1,0' && (await fakeTorque(page)).every((v) => v === 0), 'serial SR-6: STOP held 1 s = hold first, then limp (' + mid + ')');
      await page.click('#stop-release');
      // Space while moving = STOP (hold)
      await arm(page);
      await torqueOn(page);
      await idle(page);
      await page.keyboard.press('Space');
      await idle(page); await page.waitForTimeout(300);
      ok((await state(page)).latch === 'hold' && (await fakeTorque(page)).join() === '1,1,1,1,1,0', 'serial SR-6: Space while moving = HOLD');
      await page.click('#stop-release');
      // SR-12 hidden tab: HOLD + disarm, not limp, not latched
      await arm(page);
      await torqueOn(page);
      await idle(page);
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      await idle(page); await page.waitForTimeout(300);
      const hid = await state(page);
      if (!hid.held || hid.perm.armed) console.log('hidden state:', JSON.stringify({ ...hid, cal: 0, live: 0 }), await page.textContent('#alert'), await fakeTorque(page));
      ok((await fakeTorque(page)).join() === '1,1,1,1,1,0' && hid.held && !hid.torque, 'serial SR-12: hidden tab = HOLD (not limp)');
      ok(!hid.perm.armed && hid.latch === null && /pozadí/.test(await page.textContent('#alert')), 'serial SR-12: hidden tab disarms (permission withdrawn), banner explains');
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); });
      // SR-13 permission expiry while moving: idle 3 min -> hold + disarm; renewed by motion up to 10 min
      await arm(page);
      await torqueOn(page);
      await idle(page);
      const touch = () => page.evaluate(() => { const i = document.getElementById('t-elbow_flex'); i.value = +i.value + 0.5; i.dispatchEvent(new Event('input')); });
      for (let m = 0; m < 6; m++) { await page.evaluate(() => window.__wiz.skip(2 * 60e3)); await touch(); }
      ok((await state(page)).perm.armed, 'serial SR-13: motions renew the permission past its first 10 min (12 min)');
      await page.evaluate(() => window.__wiz.skip(3 * 60e3 + 500));
      await idle(page); await page.waitForTimeout(300);
      const ex = await state(page);
      ok(!ex.perm.armed && ex.perm.reason === 'idle' && ex.held && (await fakeTorque(page)).join() === '1,1,1,1,1,0', 'serial SR-13: 3 min without motion -> disarmed and held (' + ex.perm.reason + ')');
      ok(/3 minuty bez pohybu/.test(await page.textContent('#alert')) && await page.isDisabled('#t-torque'), 'serial SR-13: expiry banner, checklist needed again');
      // B1: STOP pressed while torque is being switched on must win
      await arm(page);
      await idle(page);
      await page.evaluate(() => { window.__fakeDelay = 25; });
      await page.click('#t-torque');
      await page.waitForTimeout(150);                 // configure / enable sequence is running
      await page.keyboard.press('Escape');
      await idle(page);
      await page.waitForTimeout(600);
      ok((await fakeTorque(page)).every((v) => v === 0) && !(await state(page)).torque, 'serial B1: STOP during torque-on wins (all servos off, UI off)');
      ok(/Zapnout|Znovu/.test(await page.textContent('#t-torque')), 'serial B1: button offers to switch torque on again');
      // B2: the port stops taking data while the arm is powered -> STOP must not hang
      await page.evaluate(() => { window.__fakeDelay = 0; });
      await page.click('#stop-release');
      await arm(page);
      await torqueOn(page);
      await idle(page);
      await page.evaluate(() => { window.__fakeHang = true; });
      await page.click('#stop');
      await page.waitForFunction(() => /NEPODAŘILO/.test(document.getElementById('alert').textContent), null, { timeout: 6000 })
        .catch(async (e) => { console.log('alert:', await page.textContent('#alert'), await page.textContent('#t-msg'), errors); throw e; });
      ok(await page.evaluate(() => window.__fakeClosed === true), 'serial B2: wedged port is closed');
      ok(await page.isDisabled('#stop'), 'serial B2: STOP disabled, user told to cut servo power');
      await shot(page, 'd6-real-beta');
      ok(!errors.length, 'serial: no console errors ' + errors.join(' | '));
      await page.context().close();
    }

    // 6) B3: USB unplugged while connected -> honest message, STOP disabled, polling stops
    if (!ONLY || ONLY === 'serial') {
      const errors = [];
      const page = await newPage(browser, { width: 1280, height: 800 }, errors);
      await page.addInitScript(FAKE_SERIAL);
      await page.goto(srv.url + '/sim/so101/nastaveni/?test=1&real=1');
      await page.waitForFunction(() => window.__wiz, null, { timeout: 30000 });
      await page.check('#r-ack');
      await page.click('#r-connect');
      await page.waitForSelector('.step[data-step="ids"]:not([hidden])', { timeout: 10000 });
      await page.click('#id-skip');
      await page.waitForSelector('.step[data-step="cal"]:not([hidden])', { timeout: 15000 });
      await idle(page);
      await page.evaluate(() => window.__fakeDisc());
      await page.waitForTimeout(300);
      const text = await page.textContent('#alert');
      if (!/NEJDE/.test(text)) console.log('alert text:', JSON.stringify(text), await page.textContent('#t-msg'));
      ok(/NEJDE vypnout/.test(text) && /napájení/.test(text) && !/Moment je vypnutý/.test(text), 'serial B3: disconnect says torque can NOT be switched off');
      ok(await page.isDisabled('#stop'), 'serial B3: STOP disabled after disconnect');
      await shot(page, 'd7-disconnect');
      ok(!errors.length, 'serial B3: no console errors ' + errors.join(' | '));
      await page.context().close();
    }
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
