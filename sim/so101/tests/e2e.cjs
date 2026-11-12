// End-to-end test of the UX layer in Chromium (Playwright, software GL; slow but works without a GPU).
//   node sim/so101/tests/e2e.cjs [screenshot-dir]
// Starts `python3 -m http.server` on a free port at the repo root. Physics is advanced synchronously through
// window.__sim.advance() (?test=1), so the results do not depend on the (slow) frame rate.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'so101ux');
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
// ---- failure diagnostics (CI uploads OUT as an artifact when the job fails; the CI log is often not reachable) ----
// e2e.log: the full output. fail-NN.txt: the failed check, page URL, window.__sim.ux() and the page's last console
// lines. fail-NN.png: the page at that moment.
const LOG = path.join(OUT, 'e2e.log');
fs.writeFileSync(LOG, '');
const log0 = console.log;
console.log = (...a) => { log0(...a); try { fs.appendFileSync(LOG, a.map((x) => (typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x))).join(' ') + '\n'); } catch (e) { /* ignore */ } };
let cur = null, nFail = 0, diag = Promise.resolve();
function diagnose(msg) {
  const page = cur, k = String(++nFail).padStart(2, '0');
  diag = diag.then(async () => {
    const lines = [`FAIL ${msg}`, `time ${new Date().toISOString()}`];
    if (page && !page.isClosed()) {
      lines.push(`url ${page.url()}`);
      try {
        const st = await Promise.race([page.evaluate(() => (window.__sim && window.__sim.ux ? window.__sim.ux() : null)), new Promise((r) => setTimeout(() => r('(page busy: no answer in 20 s)'), 20000))]);
        lines.push('ux ' + JSON.stringify(st));
      } catch (e) { lines.push('ux (failed) ' + e.message.split('\n')[0]); }
      lines.push('--- last console lines', ...(page.cons || []));
      try { await page.screenshot({ path: path.join(OUT, `fail-${k}.png`), timeout: 60000 }); } catch (e) { lines.push('screenshot failed: ' + e.message.split('\n')[0]); }
    } else lines.push('(no open page)');
    fs.writeFileSync(path.join(OUT, `fail-${k}.txt`), lines.join('\n') + '\n');
  }).catch(() => {});
}
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) { fails++; diagnose(msg); } };

function freePort() { return new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }

async function open(browser, url, vp, touch) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1, hasTouch: !!touch, isMobile: !!touch });
  page.cons = [];
  page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails++; page.cons.push('pageerror ' + e.message); diagnose('PAGEERROR ' + e.message); });
  page.on('console', (m) => {
    page.cons.push(`${m.type()} ${m.text()}`.slice(0, 500)); if (page.cons.length > 60) page.cons.shift();
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('console.error', m.text());
  });
  cur = page;
  page.reqs = []; page.on('request', (r) => page.reqs.push(r.url()));
  await page.goto(url);
  await page.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 300000 });
  const err = await page.evaluate(() => window.__sim.error);
  if (err) throw new Error('sim failed: ' + err);
  return page;
}
const S = (page, fn, arg) => page.evaluate(fn, arg);
const ux = (page) => S(page, () => window.__sim.ux());
async function advanceUntil(page, cond, max = 40, step = 2) {
  for (let t = 0; t < max; t += step) {
    await S(page, (s) => window.__sim.advance(s), step);
    if (await S(page, cond)) return t + step;
  }
  return -1;
}
async function shot(page, name) {
  try { await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 150000 }); }
  catch (e) { console.log('note screenshot ' + name + ' timed out (software GL)'); }
}
// pointer events like a finger (Playwright's touchscreen can only tap)
async function touchDrag(page, from, to, steps = 8) {
  await S(page, ([a, b, n]) => {
    const c = document.getElementById('c');
    const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    ev('pointerdown', a.x, a.y);
    for (let i = 1; i <= n; i++) ev('pointermove', a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n);
    ev('pointerup', b.x, b.y);
  }, [from, to, steps]);
}

(async () => {
  const port = await freePort();
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const base = `http://127.0.0.1:${port}/sim/so101/`;
  const browser = await chromium.launch({ args: ARGS });
  try {
    // ---------------- desktop ----------------
    // software GL is very slow: low detail and no wrist camera except where a screenshot needs them
    const p = await open(browser, base + '?test=1&mise=bowl&detail=low', { width: 1280, height: 800 });
    console.log('load ms', await S(p, () => window.__sim.loadMs));
    await S(p, () => window.__sim.wrist(true));
    await shot(p, 'desk-01-start');
    await S(p, () => window.__sim.wrist(false));

    // smart move: drag the gizmo with the mouse
    let a = await S(p, () => window.__sim.screen('target'));
    let st0 = await ux(p);
    await p.mouse.move(a.x, a.y); await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(a.x - 12 * i, a.y + 14 * i);
    const mid = await ux(p);
    await p.mouse.up();
    ok(mid.active && Math.hypot(mid.target[0] - st0.target[0], mid.target[1] - st0.target[1]) > 0.03, 'drag moves the IK target ' + JSON.stringify(mid.target.map((v) => +v.toFixed(3))));
    ok(Math.abs(mid.target[2] - st0.target[2]) < 1e-6, 'horizontal drag keeps the height');
    await S(p, () => window.__sim.advance(2));
    let s1 = await ux(p);
    ok(Math.hypot(s1.tip[0] - s1.target[0], s1.tip[1] - s1.target[1], s1.tip[2] - s1.target[2]) < 0.008, 'arm tip follows the target (err ' + Math.hypot(s1.tip[0] - s1.target[0], s1.tip[1] - s1.target[1], s1.tip[2] - s1.target[2]).toFixed(4) + ')');
    // height arrow
    a = await S(p, () => window.__sim.screen('up'));
    await p.mouse.move(a.x, a.y); await p.mouse.down();
    for (let i = 1; i <= 6; i++) await p.mouse.move(a.x, a.y + 12 * i);
    await p.mouse.up();
    const s2 = await ux(p);
    ok(s2.target[2] < s1.target[2] - 0.01, `height handle lowers the target (${s1.target[2].toFixed(3)} -> ${s2.target[2].toFixed(3)})`);
    // wheel over the gizmo = wrist roll
    const r0 = await S(p, () => window.__sim._ux.ctl.roll);
    a = await S(p, () => window.__sim.screen('target'));
    await p.mouse.move(a.x, a.y); await p.mouse.wheel(0, 300);
    const r1 = await S(p, () => window.__sim._ux.ctl.roll);
    ok(Math.abs(r1 - r0) > 0.05, `wheel over the gizmo rotates the wrist (${r0.toFixed(2)} -> ${r1.toFixed(2)})`);
    // unreachable: drag far away
    a = await S(p, () => window.__sim.screen('target'));
    await p.mouse.move(a.x, a.y); await p.mouse.down();
    for (let i = 1; i <= 12; i++) await p.mouse.move(a.x - 40 * i, a.y - 10 * i);
    await S(p, () => window.__sim.advance(0.5));
    const far = await ux(p);
    await p.mouse.up();
    await shot(p, 'desk-02-unreachable');
    ok(!far.reachable, 'far target is reported unreachable (red)');
    // keyboard: space toggles the gripper
    const g0 = await S(p, () => window.__sim.state().ctrl[5]);
    await p.keyboard.press('Space'); await S(p, () => window.__sim.advance(0.6));
    const g1 = await S(p, () => window.__sim.state().ctrl[5]);
    ok(Math.abs(g1 - g0) > 0.5, `Space toggles the gripper (${g0.toFixed(2)} -> ${g1.toFixed(2)})`);
    // playtest a27 / a19: Space with a focused panel button toggles the gripper and never presses the button;
    // Enter still activates it
    {
      await S(p, () => { window.__rc = 0; document.getElementById('reset').addEventListener('click', () => window.__rc++); window.__sim._ux.runner.start(); });
      // HUD stage 1: the old "?" tips button (#ux-tips-b) is gone (the tips live in ☰ → Ovládání a zkratky);
      // the right-edge "Nástroje" tab takes its place here: Space must not open the drawer
      for (const id of ['reset', 'ux-tools-tab', 'ux-mhint']) {
        const before = await S(p, (i) => ({ g: window.__sim.state().ctrl[5], exp: document.getElementById('ux-tools-tab').getAttribute('aria-expanded'), hint: window.__sim._ux.panel.hintLevel, rc: window.__rc, t: window.__sim._ux.runner.started }), id);
        await S(p, (i) => document.getElementById(i).focus(), id);
        await p.keyboard.press('Space'); await S(p, () => window.__sim.advance(0.6));
        const after = await S(p, () => ({ g: window.__sim.state().ctrl[5], exp: document.getElementById('ux-tools-tab').getAttribute('aria-expanded'), hint: window.__sim._ux.panel.hintLevel, rc: window.__rc, t: window.__sim._ux.runner.started }));
        ok(Math.abs(after.g - before.g) > 0.5 && after.rc === before.rc && after.exp === before.exp && after.hint === before.hint && after.t,
          `Space with #${id} focused toggles the gripper only (${JSON.stringify([before, after])})`);
      }
      await S(p, () => document.getElementById('reset').focus());
      await p.keyboard.press('Enter');
      ok((await S(p, () => window.__rc)) === 1, 'Enter on a focused panel button still activates it');
      await S(p, () => document.activeElement && document.activeElement.blur());
    }
    // HUD stage 1: Nástroje drawer, ☰ menu and the Poradit popover – focus moves in, Esc closes, focus returns
    {
      await p.click('#ux-tools-tab');
      const d1 = await S(p, () => ({ open: !document.getElementById('panel').hidden, focus: document.getElementById('panel').contains(document.activeElement), ai: !!document.getElementById('ai-open') && document.getElementById('ai-open').offsetParent !== null }));
      await p.keyboard.press('Escape');
      const d2 = await S(p, () => ({ open: !document.getElementById('panel').hidden, focus: document.activeElement && document.activeElement.id }));
      ok(d1.open && d1.focus && d1.ai && !d2.open && d2.focus === 'ux-tools-tab', 'Nástroje drawer: opens with focus inside (Připojit AI there), Esc closes it, focus back on the tab ' + JSON.stringify([d1, d2]));
      await p.click('#ux-menu-b');
      const m1 = await S(p, () => ({ open: !document.getElementById('ux-menu').hidden, focus: document.getElementById('ux-menu').contains(document.activeElement),
        items: ['ux-m-missions', 'ux-parts', 'ux-help', 'ux-tour', 'ux-sound'].every((i) => document.getElementById('ux-menu').contains(document.getElementById(i))) && !!document.querySelector('#ux-menu a[href="nastaveni/"]') && !!document.querySelector('#ux-menu .colors') && !!document.querySelector('#ux-menu .ux-about') }));
      await p.keyboard.press('Escape');
      const m2 = await S(p, () => ({ open: !document.getElementById('ux-menu').hidden, focus: document.activeElement && document.activeElement.id }));
      ok(m1.open && m1.focus && m1.items && !m2.open && m2.focus === 'ux-menu-b', '☰ menu: missions, parts, setup wizard, shortcuts, intro, sound, colour, about; Esc returns focus ' + JSON.stringify([m1, m2]));
      await p.click('#ux-mhint');
      const h1 = await S(p, () => ({ open: !document.getElementById('ux-hintbox').hidden, ask: document.getElementById('ux-hintbox').contains(document.getElementById('ai-ask-mission')), lv: window.__sim._ux.panel.hintLevel }));
      await p.keyboard.press('Escape');
      const h2 = await S(p, () => !document.getElementById('ux-hintbox').hidden);
      ok(h1.open && h1.ask && h1.lv === 1 && !h2, 'Poradit opens the hint popover (rung 1, with "Zeptej se AI"), Esc closes it ' + JSON.stringify(h1));
      await S(p, () => document.activeElement && document.activeElement.blur());
    }

    // HUD stage 3: "Pohled z boku" – on by default on desktop, an image with the measured height as its name,
    // ☰ › Nastavení › "Pohled z boku" switches it off and on
    {
      await S(p, () => { const u = window.__sim._ux, c = u.world.pos('cube', [0, 0, 0]); u.ctl.begin(); u.ctl.setTarget(c[0], c[1], c[2] + 0.06); });
      await S(p, () => window.__sim.advance(2)); await S(p, () => window.__sim.renderNow());
      const s1 = await S(p, () => { const st = window.__sim.sideState(), u = window.__sim._ux, tip = u.ctl.actualTip(new Float64Array(3)), c = u.world.pos('cube', [0, 0, 0]);
        const el = document.querySelector('.ux-side'), r = el.getBoundingClientRect(), cam = document.querySelector('.ux-cam').getBoundingClientRect();
        return { ...st, role: el.getAttribute('role'), dzcm: Math.round((tip[2] - c[2]) * 100), box: [Math.round(r.left), Math.round(r.bottom), Math.round(r.width), Math.round(r.height)], camTop: Math.round(cam.top) }; });
      ok(s1.on && s1.shown && s1.role === 'img' && s1.drawn > 0 && s1.name === 'oranžová kostka' && s1.text === s1.dzcm + ' cm' && new RegExp('^Pohled z boku: chapadlo ' + s1.dzcm + ' cm nad cílem \\(oranžová kostka\\)').test(s1.label)
        && s1.box[1] <= s1.camTop && s1.box[2] >= 230 && s1.box[3] >= 130, 'side view: on by default on desktop, above the camera toggle, height label = grasp-hint height ' + JSON.stringify(s1));
      await p.click('#ux-menu-b'); await p.click('#ux-side-b');
      const s2 = await S(p, () => ({ ...window.__sim.sideState(), pressed: document.getElementById('ux-side-b').getAttribute('aria-pressed'), stored: localStorage.getItem('pr-sim-side') }));
      await p.click('#ux-side-b');
      const s3 = await S(p, () => ({ ...window.__sim.sideState(), pressed: document.getElementById('ux-side-b').getAttribute('aria-pressed') }));
      await p.keyboard.press('Escape');
      ok(!s2.on && !s2.shown && s2.pressed === 'false' && s2.stored === 'false' && s3.on && s3.shown && s3.pressed === 'true', '☰ › Pohled z boku switches the inset off and on (remembered) ' + JSON.stringify([s2.pressed, s2.stored, s3.pressed]));
    }

    // ---- usability P0 regressions ----
    // P0-3: pick-and-place missions start with the gripper open; HUD coaches from the gripper state
    await S(p, () => window.__sim.reset()); await S(p, () => window.__sim.advance(0.5));
    ok((await S(p, () => window.__sim.state().ctrl[5])) > 1, 'P0-3: mission 01 starts with the gripper open');
    await S(p, () => { const u = window.__sim._ux, c = u.world.pos('cube', [0, 0, 0]); u.ctl.begin(); u.ctl.setGrip(false); u.ctl.setTarget(c[0], c[1], c[2] + 0.035); });
    await S(p, () => window.__sim.advance(3));
    let hud = (await ux(p)).hud;
    ok(/Otevřete chapadlo/.test(hud), 'P0-3: closed gripper above the cube → "Otevřete chapadlo…" (' + hud + ')');
    await S(p, () => window.__sim._ux.ctl.setGrip(true)); await S(p, () => window.__sim.advance(1));
    hud = (await ux(p)).hud;
    ok(/Sjeďte dolů/.test(hud), 'P0-3: open gripper above the cube → "Sjeďte dolů…" (' + hud + ')');
    // P0-1: the gizmo hovers 3.5 cm above the cube; a click on the cube must pick it, not start a drag
    await S(p, () => window.__sim._ux.gizmo.sync(0.016));
    a = await S(p, () => window.__sim.screen('cube'));
    const under = await S(p, ([x, y]) => window.__sim._ux.gizmo.hitHandle({ clientX: x, clientY: y }), [a.x, a.y]);
    await p.mouse.click(a.x, a.y);
    ok((await ux(p)).busy, `P0-1: click on the cube under the gizmo (handle there: ${under || 'none'}) starts a pick`);
    const tP0 = await advanceUntil(p, () => window.__sim.ux().held === 'cube' && !window.__sim.ux().busy, 14, 1);
    ok(tP0 > 0, 'P0-1: … and the cube is picked');
    // P0-1: a real drag on the ball (> 6 px) still moves the target
    a = await S(p, () => { window.__sim._ux.gizmo.sync(0.016); return window.__sim.screen('target'); });
    const tg0 = (await ux(p)).target;
    await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(a.x + 3, a.y + 2);
    ok(!(await S(p, () => !!window.__sim._ux.gizmo.drag)), 'P0-1: < 6 px is still a tap, no drag yet');
    for (let i = 1; i <= 5; i++) await p.mouse.move(a.x + 12 * i, a.y);
    await p.mouse.up();
    const tg1 = (await ux(p)).target;
    ok(Math.hypot(tg1[0] - tg0[0], tg1[1] - tg0[1]) > 0.01, 'P0-1: drag > 6 px moves the target');

    // ---- direct joint manipulation: drag any link → only that joint moves ----
    const names = ['pan', 'lift', 'elbow', 'flex', 'roll', 'gripper'];
    await S(p, () => window.__sim.grabMode('joint'));      // "Kloub po kloubu"
    for (let j = 0; j < 6; j++) {
      await S(p, () => window.__sim.reset()); await S(p, () => window.__sim.advance(0.3));
      const lp = await S(p, (jj) => window.__sim.linkPoint(jj), j);
      if (!lp) { ok(false, `link ${names[j]}: no grabbable screen point`); continue; }
      const c0 = await S(p, () => window.__sim.state().ctrl);
      await p.mouse.move(lp.x, lp.y); await p.mouse.down();
      for (let i = 1; i <= 8; i++) await p.mouse.move(lp.x + 6 * i, lp.y + 4 * i);
      await p.mouse.up();
      const c1 = await S(p, () => window.__sim.state().ctrl);
      const others = c1.map((v, i) => (i === j ? 0 : Math.abs(v - c0[i]))).reduce((a, b) => Math.max(a, b), 0);
      ok(Math.abs(c1[j] - c0[j]) > 0.02 && others < 1e-6, `drag on ${lp.body} turns only ${names[j]} (Δ ${(c1[j] - c0[j]).toFixed(3)} rad, others ${others.toExponential(1)})`);
    }
    await S(p, () => window.__sim.grabMode('pull'));
    // ---- physics pull (default "Tahem"): the whole chain gives way, release holds, flicks stay stable ----
    {
      await S(p, () => window.__sim.reset()); await S(p, () => window.__sim.advance(0.5));
      const lp = await S(p, () => window.__sim.linkPoint(4));
      const q0 = (await S(p, () => window.__sim.state().qpos)).slice(0, 6);
      await p.mouse.move(lp.x, lp.y); await p.mouse.down();
      for (let i = 1; i <= 20; i++) { await p.mouse.move(lp.x - 5 * i, lp.y + 3 * i); await S(p, () => window.__sim.advance(1 / 30)); }
      const gs = await S(p, () => window.__sim.grabState());
      const q1 = (await S(p, () => window.__sim.state().qpos)).slice(0, 6);
      const moved = q1.map((v, i) => Math.abs(v - q0[i]));
      ok(gs.active && gs.mode === 'pull' && moved.filter((x) => x > 0.03).length >= 3, 'pulling the gripper moves several joints (' + moved.map((x) => x.toFixed(2)).join(' ') + ')');
      await p.mouse.up();
      await S(p, () => window.__sim.advance(0.4));
      const qa = (await S(p, () => window.__sim.state().qpos)).slice(0, 5);
      await S(p, () => window.__sim.advance(2));
      const qb = (await S(p, () => window.__sim.state().qpos)).slice(0, 5);
      const drift = Math.max(...qb.map((v, i) => Math.abs(v - qa[i])));
      ok(drift < 0.02 && Math.max(...qa.map((v, i) => Math.abs(v - q1[i]))) > 0.0, `release holds the pose for 2 s (drift ${drift.toFixed(4)} rad)`);
      // fast flick
      const lp2 = await S(p, () => window.__sim.linkPoint(2));
      await p.mouse.move(lp2.x, lp2.y); await p.mouse.down();
      let vmax = 0, finite = true;
      for (let i = 0; i < 40; i++) {
        await p.mouse.move(lp2.x + (i % 2 ? 260 : -260), lp2.y + (i % 4 < 2 ? 180 : -180));
        await S(p, () => window.__sim.advance(1 / 30));
        const st = await S(p, () => { const d = window.__sim._ux.app.d; return { v: Math.max(...Array.from(d.qvel.slice(0, 6), Math.abs)), f: Array.from(d.qpos).every(Number.isFinite) }; });
        vmax = Math.max(vmax, st.v); finite = finite && st.f;
      }
      await p.mouse.up(); await S(p, () => window.__sim.advance(1));
      ok(finite && vmax < 40, `fast flicks stay stable (finite state, max joint speed ${vmax.toFixed(1)} rad/s)`);
    }
    // empty space: camera orbit, never the arm
    await S(p, () => window.__sim.reset()); await S(p, () => window.__sim.advance(0.3));
    {
      const c0 = await S(p, () => window.__sim.state().ctrl), cam0 = await S(p, () => window.__sim._ux.app.camera.position.toArray());
      const r = await S(p, () => { const r = document.getElementById('c').getBoundingClientRect(); return { x: r.left + r.width * 0.12, y: r.top + r.height * 0.3 }; });
      const free = await S(p, ([x, y]) => { const u = window.__sim._ux, e = { clientX: x, clientY: y }; return !u.links.hit(e) && !u.gizmo.hitHandle(e) && !(u.gizmo.pickAt(e) && u.gizmo.pickAt(e).name !== 'table'); }, [r.x, r.y]);
      await p.mouse.move(r.x, r.y); await p.mouse.down();
      for (let i = 1; i <= 8; i++) await p.mouse.move(r.x + 15 * i, r.y + 3 * i);
      await p.mouse.up(); await S(p, () => window.__sim.advance(0.3));
      const c1 = await S(p, () => window.__sim.state().ctrl), cam1 = await S(p, () => window.__sim._ux.app.camera.position.toArray());
      const dq = c1.reduce((a, v, i) => Math.max(a, Math.abs(v - c0[i])), 0), dc = Math.hypot(cam1[0] - cam0[0], cam1[1] - cam0[1], cam1[2] - cam0[2]);
      ok(free && dq < 1e-6 && dc > 0.01, `drag on empty space orbits the camera (Δcam ${dc.toFixed(3)}) and never moves the arm (Δq ${dq.toExponential(1)})`);
    }
    // keyboard: 3 selects the elbow, → turns only it
    {
      await S(p, () => window.__sim.reset());
      const c0 = await S(p, () => window.__sim.state().ctrl);
      await p.keyboard.press('3'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Escape');
      const c1 = await S(p, () => window.__sim.state().ctrl);
      ok(Math.abs(c1[2] - c0[2] - 4 * Math.PI / 180) < 1e-3 && Math.abs(c1[1] - c0[1]) < 1e-9, 'keys 3 + → → turn the elbow by 4°, nothing else');
    }
    // tap on the jaws toggles the gripper; the HUD follows
    {
      // deterministic: the page's own frame loop is paused for this block (simulated time only via advance()), so the
      // arm pose and the camera do not depend on how many real frames the (slow, software-GL) runner managed
      await S(p, () => { window.__sim._app.sim.paused = true; });
      await S(p, () => window.__sim.reset()); await S(p, () => window.__sim.advance(0.3));
      await S(p, () => { const u = window.__sim._ux, c = u.world.pos('cube', [0, 0, 0]); u.ctl.begin(); u.ctl.setGrip(false); u.ctl.setTarget(c[0], c[1], c[2] + 0.035); });
      await S(p, () => window.__sim.advance(3));
      const h0 = (await ux(p)).hud, g0 = await S(p, () => window.__sim._ux.ctl.grip);
      let jp = null;
      // fixed camera views in a fixed order; the jaws are hidden behind the cube from some of them
      // renderNow(): one synchronous frame, so the raycast in linkPoint and the click see the same pose and camera
      for (const v of ['orbit', 'side', 'front', 'top']) { await S(p, (v) => { window.__sim.cameraNow(v); window.__sim.renderNow(); }, v); jp = await S(p, () => window.__sim.linkPoint(5)); if (jp) break; }
      ok(!!jp, 'a visible point on the jaws exists for the tap test');
      await p.mouse.click(jp.x, jp.y);
      await S(p, () => window.__sim.advance(1.2));
      await S(p, () => { window.__sim._app.sim.paused = false; });
      const h1 = (await ux(p)).hud, g1 = await S(p, () => window.__sim.state().ctrl[5]);
      ok(g0 < 0 && g1 > 1 && /Otevřete/.test(h0) && /Sjeďte dolů/.test(h1), `tap on the jaw opens the gripper (${g0.toFixed(2)} → ${g1.toFixed(2)}); HUD "${h0}" → "${h1}"`);
    }

    // tap on the IK ball where jaw geometry lies under it → gripper toggles (drag would still move the ball)
    {
      // frame loop paused as above: pose, gizmo and camera only change through advance()/renderNow()
      await S(p, () => { window.__sim._app.sim.paused = true; });
      await S(p, () => window.__sim.reset()); await S(p, () => window.__sim.advance(0.5));
      let spot = null;
      for (const view of ['orbit', 'top', 'front']) {
        await S(p, (v) => { window.__sim.cameraNow(v); window.__sim.renderNow(); }, view);
        // search the ball's screen area for a point where a jaw lies under the handle
        spot = await S(p, () => {
          const u = window.__sim._ux; u.gizmo.sync(0.016); u.app.camera.updateMatrixWorld();
          const t = window.__sim.screen('target');
          for (let dy = -12; dy <= 12; dy += 3) for (let dx = -12; dx <= 12; dx += 3) {
            const e = { clientX: t.x + dx, clientY: t.y + dy }, h = u.links.hit(e);
            if (u.gizmo.hitHandle(e) === 'move' && h && u.links.isJaw(h.part)) return { x: e.clientX, y: e.clientY };
          }
          return null;
        });
        if (spot) break;
      }
      if (spot) {
        const g0 = await S(p, () => window.__sim.state().ctrl[5]);
        await p.mouse.click(spot.x, spot.y); await S(p, () => window.__sim.advance(1.2));
        const g1 = await S(p, () => window.__sim.state().ctrl[5]);
        ok(Math.abs(g1 - g0) > 0.5, `tap on the ball over the jaws toggles the gripper (${g0.toFixed(2)} → ${g1.toFixed(2)})`);
      } else ok(false, 'tap on the ball over the jaws: no spot found where the ball covers jaw geometry');
      await S(p, () => { window.__sim.cameraNow('orbit'); window.__sim._app.sim.paused = false; });
    }
    // WCAG 2.1.4: single-key shortcuts can be turned off (then only with the 3D view focused)
    {
      await S(p, () => { window.__sim._ux.keysOn = false; document.activeElement && document.activeElement.blur(); });
      const g0 = await S(p, () => window.__sim._ux.ctl.grip);
      await p.keyboard.press('g');
      const g1 = await S(p, () => window.__sim._ux.ctl.grip);
      await S(p, () => document.getElementById('c').focus());
      await p.keyboard.press('g');
      const g2 = await S(p, () => window.__sim._ux.ctl.grip);
      ok(g1 === g0 && g2 !== g1, 'shortcuts off: "g" ignored on the page, works with the 3D view focused');
      await S(p, () => { window.__sim._ux.keysOn = true; });
    }

    // click-to-pick: click the cube, then the bowl
    await S(p, () => window.__sim.reset());
    a = await S(p, () => window.__sim.screen('cube'));
    await p.mouse.click(a.x, a.y);
    const busy = await ux(p);
    ok(busy.busy, 'click on the cube starts a planned pick');
    await S(p, () => window.__sim.advance(0.3));
    await shot(p, 'desk-03-path-preview');
    // one voice (playtest a02): while the planner moves the arm, the status line never coaches a manual grasp
    let tPick = -1; const autoHud = new Set();
    for (let t = 0.5; t <= 14; t += 0.5) {
      await S(p, () => window.__sim.advance(0.5));
      const u = await ux(p);
      if (u.busy) autoHud.add(u.hud);
      if (u.held === 'cube' && !u.busy) { tPick = t; break; }
    }
    ok(tPick > 0, `cube picked after ${tPick}s`);
    ok(autoHud.size > 0 && [...autoHud].every((h) => /^Ruka /.test(h)), 'status line during the planned pick shows the arm\'s step, no grasp coaching (' + [...autoHud].join(' | ') + ')');
    a = await S(p, () => window.__sim.screen('bowl'));
    await p.mouse.click(a.x, a.y);
    const tWin = await advanceUntil(p, () => window.__sim.ux().won, 16, 1);
    ok(tWin > 0, `click on the bowl places the cube, mission won after ${tWin}s`);
    {
      // mastery rules: a click-to-grab (autopilot) win is "Splněno" – done, no stars
      const r = await ux(p);
      ok(r.result.kind === 'auto' && r.result.stars === 0 && r.progress.bowl && r.progress.bowl.done && !r.progress.bowl.stars,
        'autopilot win counts as "Splněno" without stars (' + JSON.stringify([r.result.kind, r.result.stars, r.progress.bowl]) + ')');
      const card = await S(p, () => ({ k: document.getElementById('ux-wk').textContent, demo: !document.querySelector('#win .ux-wdemo').hidden, on: document.querySelectorAll('#ux-wstars span.on').length }));
      ok(/· splněno$/.test(card.k) && card.demo && card.on === 0, 'result card: "splněno", marked "s ukázkou", no stars ' + JSON.stringify(card));
    }
    await S(p, () => window.__sim.advance(0.4));
    await shot(p, 'desk-04-win');
    // ---------------- result card (HUD stage 2) ----------------
    {
      // a run by hand: the mission's plan driven straight through the controller (not the click-to-grab preview),
      // so the sim measures and rates it like a manual run
      const handRun = async (id) => {
        await S(p, (m) => window.__sim.mission(m), id);
        await S(p, () => { if (window.__srObs) return; window.__srN = 0; window.__srObs = new MutationObserver(() => window.__srN++); window.__srObs.observe(document.getElementById('sr'), { childList: true, characterData: true, subtree: true }); });
        await S(p, () => { const u = window.__sim._ux; u.runner.start(); u.ctl.run(u.runner.m.solve(u.ctl, u.world)); });
        return advanceUntil(p, () => window.__sim.ux().won, 60, 2);
      };
      const card = () => S(p, () => {
        const w = document.getElementById('win');
        return { open: !w.hidden, focus: document.activeElement === w, k: document.getElementById('ux-wk').textContent, h: document.getElementById('win-h').textContent,
          on: document.querySelectorAll('#ux-wstars span.on').length, label: document.getElementById('ux-wstars').getAttribute('aria-label'),
          vals: [...document.querySelectorAll('#ux-wvals > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]),
          demo: !w.querySelector('.ux-wdemo').hidden, next: document.getElementById('ux-wnext').textContent, sr: window.__srN,
          desc: w.getAttribute('aria-describedby').split(' ').every((id) => document.getElementById(id)) };
      });
      const fmtT = (t) => { const n = Math.round(t * 10); return Math.floor(n / 600) + ':' + String(Math.floor(n / 10) % 60).padStart(2, '0') + ',' + (n % 10); };
      ok((await handRun('bowl')) > 0, 'mission 01 won by hand (controller run)');
      // from the win on, nothing more goes to the live region (HUD milestones during the run are separate)
      await S(p, () => new Promise((res) => setTimeout(res, 50)));
      await S(p, () => { window.__srN = 0; window.__sim.advance(1); });
      await S(p, () => new Promise((res) => setTimeout(res, 50)));
      let r = await ux(p), c = await card();
      ok(r.result.kind === 'manual' && r.result.stars >= 1 && c.open && c.focus && c.k === 'Mise 01 / 12 · splněno' && c.h === 'Kostka je v misce.' && !c.demo,
        'result card opens with focus on it: header, headline (done text), no demo label ' + JSON.stringify(c));
      ok(c.on === r.result.stars && c.label === `${r.result.stars} ze 3 hvězdiček`, `result card shows the ${r.result.stars} ★ earned`);
      ok(c.vals[0][0] === 'Váš čas' && c.vals[0][1] === fmtT(r.result.time) && /^Pro [23] ★$/.test(c.vals[1][0]) && /^do (0:25|1:00)/.test(c.vals[1][1]),
        'result card: measured time and the next star\'s limit ' + JSON.stringify(c.vals) + ' t=' + r.result.time);
      ok(c.next === 'Další: 02 · Věž ze dvou kostek' && c.desc, 'result card names the next mission ' + c.next);
      ok(c.sr === 0, 'the win is announced once (the card takes focus, no extra live-region line) – #sr changes: ' + c.sr);
      await shot(p, 'desk-04b-result');
      // Esc puts the card away (focus to the 3D view); Enter on the card = Další mise
      await p.keyboard.press('Escape');
      const esc = await S(p, () => ({ hidden: document.getElementById('win').hidden, f: document.activeElement && document.activeElement.id }));
      ok(esc.hidden && esc.f === 'c', 'Esc closes the result card, focus back on the 3D view ' + JSON.stringify(esc));
      await handRun('bowl');
      await p.keyboard.press('Enter');
      const nx = await S(p, () => ({ m: window.__sim.ux().mission, hidden: document.getElementById('win').hidden }));
      ok(nx.m === 'stack' && nx.hidden, 'Enter on the result card goes to the next mission ' + JSON.stringify(nx));
      // "Zkusit znovu" (R) restarts the mission and closes the card
      await handRun('bowl');
      await p.keyboard.press('r');
      const rr = await S(p, () => ({ m: window.__sim.ux().mission, hidden: document.getElementById('win').hidden, won: window.__sim.ux().won }));
      ok(rr.m === 'bowl' && rr.hidden && !rr.won, 'R on the result card = Zkusit znovu ' + JSON.stringify(rr));
      // precision mission: the measured line offset in mm and its limit for the next star
      ok((await handRun('trace')) > 0, 'mission 05 won by hand (controller run)');
      r = await ux(p); c = await card();
      const mm = (r.result.prec * 1000);
      const shownMm = parseFloat((c.vals[2] || ['', ''])[1].replace(',', '.'));
      ok(c.vals.length === 4 && c.vals[2][0] === 'Průměrná odchylka čáry' && /mm$/.test(c.vals[2][1]) && Math.abs(shownMm - mm) <= 0.051 && /^pod (2,5|5) mm/.test(c.vals[3][1]),
        `mission 05 card: line offset ${c.vals[2] && c.vals[2][1]} (measured ${mm.toFixed(3)} mm) and its limit ` + JSON.stringify(c.vals));
      await shot(p, 'desk-04c-result-trace');
      // "Další mise" (button) goes to the next mission (03 → 04; 05 → 06 would reload into the object scene)
      await handRun('sort');
      await S(p, () => document.getElementById('ux-next').click());
      ok((await ux(p)).mission === 'ball', '"Další mise" on the result card opens mission 04');
      // hint rung 3 (the arm grasps, the player finishes): the card marks the run "s ukázkou", no stars
      await S(p, () => window.__sim.mission('bowl'));
      await S(p, () => window.__sim.hintRung(3));
      await advanceUntil(p, () => window.__sim.ux().held === 'cube' && !window.__sim.ux().busy, 20, 1);
      await S(p, () => { const u = window.__sim._ux, b = u.world.pos('bowl', [0, 0, 0]); u.ctl.begin(); u.ctl.setTarget(b[0], b[1], 0.09); });
      await S(p, () => window.__sim.advance(3));
      await S(p, () => window.__sim._ux.ctl.setGrip(true));
      const tw = await advanceUntil(p, () => window.__sim.ux().won, 12, 1);
      r = await ux(p); c = await card();
      const run = await S(p, () => window.__sim.run());
      ok(tw > 0 && run.auto && r.result.kind === 'auto' && c.demo && c.on === 0 && c.vals[1][0] === 'Hvězdičky',
        'after hint rung 3 the result card says "s ukázkou" and gives no stars ' + JSON.stringify({ tw, auto: run.auto, kind: r.result && r.result.kind, c }));
      await shot(p, 'desk-04d-result-demo');
      await S(p, () => window.__sim.reset());
    }
    // the guide says "now click the bowl" while the arm is still picking (playtest A4): that click waits for the pick
    {
      await S(p, () => window.__sim.reset());
      a = await S(p, () => window.__sim.screen('cube')); await p.mouse.click(a.x, a.y);
      await S(p, () => window.__sim.advance(1));
      a = await S(p, () => window.__sim.screen('bowl')); await p.mouse.click(a.x, a.y);
      const tq = await advanceUntil(p, () => window.__sim.ux().won, 30, 2);
      ok(tq > 0, `a bowl click during the pick is carried out after it (won after ${tq}s more)`);
    }
    // from mission 04 a click on an object does nothing, so the cursor is no pointer over it (playtest a48)
    {
      await S(p, () => window.__sim.mission('ball')); await S(p, () => window.__sim.renderNow());
      const b = await S(p, () => window.__sim.screen('ball'));
      await p.mouse.move(b.x + 40, b.y + 40); await p.waitForTimeout(80); await p.mouse.move(b.x, b.y); await p.waitForTimeout(80); await p.mouse.move(b.x + 1, b.y);
      const cur = await S(p, () => ({ cur: document.getElementById('c').style.cursor }));
      const pk = await S(p, ([x, y]) => (window.__sim._ux.gizmo.pickAt({ clientX: x, clientY: y }) || {}).name, [b.x + 1, b.y]);
      ok(pk !== 'ball' || cur.cur !== 'pointer', `mission 04: no pointer cursor over the ball (${cur.cur || 'default'}, picked ${pk})`);
      await S(p, () => window.__sim.mission('bowl'));
    }

    // every mission: automatic solution
    for (const id of await S(p, () => window.__sim.missions.filter((m) => !window.__sim.objectMissions.includes(m) && !window.__sim.conveyorMissions.includes(m)))) {   // object and conveyor missions: below
      await S(p, (m) => window.__sim.mission(m), id);
      await S(p, () => window.__sim.solve());
      const t = await advanceUntil(p, () => window.__sim.ux().won, 45, 3);
      const u = await ux(p);
      ok(t > 0, `mission ${id} solved by its plan (${t}s, ${u.result ? u.result.stars + '★' : u.hud})`);
      if (id === 'trace' || id === 'sort') await shot(p, 'desk-05-' + id);
    }

    // drawing mission: top-down view, paper-plane drag keeps the pen on the paper; finger trace → robot completes it
    {
      // the camera tween advances in rendered frames (0.25-2.5 s each with software GL): wait for its end, not a fixed time
      await S(p, () => window.__sim.mission('trace'));
      await p.waitForFunction(() => !window.__sim._ux.cameras.tw, null, { timeout: 60000 }).catch(() => {});
      const top = await S(p, () => { const c = window.__sim._ux.app.camera, t = window.__sim._ux.app.controls.target; const d = c.position.clone().sub(t).normalize(); return d.y; });
      ok(top > 0.8, 'drawing mission starts with a steep top-down camera (' + top.toFixed(3) + ')');
      const corners = await S(p, () => window.__sim._ux.runner.m && [[0.215, 0.055], [0.2009, 0.0194], [0.1627, 0.017], [0.192, -0.0074], [0.1827, -0.0445]]);
      let zmin = 1, zmax = 0, started = false;
      for (let i = 1; i < corners.length; i++) {
        for (let k = 0; k <= 6; k++) {
          const x = corners[i - 1][0] + (corners[i][0] - corners[i - 1][0]) * k / 6, y = corners[i - 1][1] + (corners[i][1] - corners[i - 1][1]) * k / 6;
          const sp = await S(p, ([x, y]) => window.__sim._ux.gizmo.project([x, y, 0], {}), [x, y]);
          if (!started) { await p.mouse.move(sp.x, sp.y); await p.mouse.down(); started = true; await S(p, () => window.__sim.advance(2.5)); }
          else await p.mouse.move(sp.x, sp.y);
          await S(p, () => window.__sim.advance(0.12));
          const z = (await ux(p)).tip[2]; zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
        }
      }
      await p.mouse.up();
      const prog = await S(p, () => window.__sim._ux.runner.last.progress || 0);
      ok(zmax < 0.016 && zmin > 0.003 && prog > 0.1, `paper-plane drag: tip ${zmin.toFixed(4)}…${zmax.toFixed(4)} m, ink coverage ${(prog * 100).toFixed(0)} %`);
      await shot(p, 'desk-11-draw');
      // finger trace (K): draw the whole star, the robot reproduces it
      await S(p, () => window.__sim.reset()); await p.keyboard.press('k');
      const star = [[0.215, 0.055], [0.2009, 0.0194], [0.1627, 0.017], [0.192, -0.0074], [0.1827, -0.0445], [0.215, -0.024], [0.2473, -0.0445], [0.238, -0.0074], [0.2673, 0.017], [0.2291, 0.0194], [0.215, 0.055]];
      let first = true;
      for (let i = 1; i < star.length; i++) for (let k = 0; k < 8; k++) {
        const x = star[i - 1][0] + (star[i][0] - star[i - 1][0]) * k / 8, y = star[i - 1][1] + (star[i][1] - star[i - 1][1]) * k / 8;
        const sp = await S(p, ([x, y]) => window.__sim._ux.gizmo.project([x, y, 0], {}), [x, y]);
        if (first) { await p.mouse.move(sp.x, sp.y); await p.mouse.down(); first = false; } else await p.mouse.move(sp.x, sp.y);
      }
      await p.mouse.up();
      ok((await ux(p)).busy, 'finger trace starts a planned path');
      const tw = await advanceUntil(p, () => window.__sim.ux().won, 45, 3);
      ok(tw > 0, `finger-traced star completes the drawing mission (${tw}s, ${JSON.stringify((await ux(p)).result)})`);
      await p.keyboard.press('k');
    }

    // teach & replay
    await S(p, () => window.__sim.mission('stack'));
    await S(p, () => { window.__sim.record(true); window.__sim.solve(); });
    const tr = await advanceUntil(p, () => window.__sim.ux().won, 30, 2);
    await S(p, () => window.__sim.advance(1)); await S(p, () => window.__sim.record(false));
    const rec = await ux(p);
    ok(tr > 0 && rec.demoFrames > 100, `recorded demonstration (${rec.demoFrames} frames)`);
    const j = await S(p, () => window.__sim.exportDemo());
    ok(j && j.fps === 30 && j.episodes[0].frames.length === rec.demoFrames && j.features['observation.state'].names.length === 6, 'export: LeRobot-like JSON');
    await S(p, () => window.__sim.reset());
    ok(!(await ux(p)).won, 'reset clears the win');
    await S(p, () => window.__sim.replay(false));
    await S(p, () => window.__sim.advance(1));
    await shot(p, 'desk-06-replay');
    const trp = await advanceUntil(p, () => window.__sim.ux().won, 30, 2);
    ok(trp > 0, `replay repeats the demonstration and wins again (${trp}s)`);
    // "Posunout kostku a přehrát znovu": the same actions with the cube 4 cm away miss (open loop)
    await S(p, () => window.__sim.advance(1.5));
    ok(await S(p, () => window.__sim.shiftReplay()), 'shifted replay starts');
    await advanceUntil(p, () => !window.__sim.ux().replaying, 40, 2);
    const sr = await S(p, () => [window.__sim.shiftResult(), window.__sim.ux().won, !document.getElementById('ux-shift-note').hidden]);
    ok(sr[0] === 'miss' && !sr[1] && sr[2], 'shifted replay misses and explains why (' + JSON.stringify(sr) + ')');

    // cameras + exploded view + hi-detail
    await S(p, () => window.__sim.mission('bowl'));
    await S(p, () => window.__sim.camera('top')); await S(p, () => window.__sim.advance(0.2));
    await p.waitForTimeout(1500);
    await shot(p, 'desk-07-top');
    await S(p, () => window.__sim.camera('orbit'));
    await S(p, () => window.__sim.quality('high'));
    await p.waitForFunction(() => window.__sim.ux().hiDetail, null, { timeout: 120000 }).catch(() => {});
    ok((await ux(p)).hiDetail, 'high-detail GLB meshes swapped in');
    await S(p, () => window.__sim.explode(true));
    await p.waitForFunction(() => window.__sim.ux().explode > 0.3, null, { timeout: 60000 }).catch(() => {});   // animates per frame
    await shot(p, 'desk-08-explode');
    ok((await ux(p)).explode > 0.3, 'exploded view separates the parts');
    await S(p, () => window.__sim.assemble());
    await p.waitForTimeout(2500);
    await shot(p, 'desk-09-assembly');
    await S(p, () => window.__sim.explode(false));
    await p.close();

    // ---------------- real arm armed: no physics pulling ----------------
    {
      const r = await open(browser, base + '?test=1&real=1&mise=bowl&detail=low', { width: 1280, height: 800 });
      const st = await S(r, () => ({ pull: window.__sim._ux.links.pull(), seg: window.__sim._ux.panel.grabSeg.hidden }));
      ok(!st.pull && st.seg, 'with ?real=1 the physics pull is off and its tip hidden');
      await r.close();
    }

    // ---------------- object missions 06–10 (NVIDIA SimReady objects) ----------------
    ok(!p.reqs.some((u) => /\/so101\/objects\/|objects\/(view|library)\.js/.test(u)), 'mission 01 page fetches no object asset (manifest, MJCF, GLB) and no object loader');
    {
      // picking an object mission in the plain scene reloads into the object scene
      const q = await open(browser, base + '?test=1&mise=trace&detail=low', { width: 1280, height: 800 });
      await Promise.all([q.waitForURL(/mise=workshop/, { timeout: 60000 }), S(q, () => window.__sim.mission('workshop'))]);
      await q.waitForFunction(() => /mise=workshop/.test(location.search) && window.__sim && window.__sim.ready && window.__sim.objectScene && window.__sim.objectScene(), null, { timeout: 300000 });
      ok(await S(q, () => window.__sim.ux().mission === 'workshop'), 'mission picker → object mission reloads into the object scene');
      // a 3-star record of an object mission can be shared and lands on that mission
      ok(await S(q, () => !!document.querySelector('.ux-credit') && !document.querySelector('.ux-credit').hidden && /NVIDIA SimReady \(CC BY 4\.0\)/.test(document.querySelector('.ux-credit').textContent)), 'object mission shows the credit "Objekty: NVIDIA SimReady (CC BY 4.0)"');
      await q.close();
    }
    for (const id of ['line', 'breakfast', 'tidy', 'workshop', 'lab']) {
      const q = await open(browser, base + `?test=1&mise=${id}&detail=low`, { width: 1280, height: 800 });
      await q.waitForFunction(() => window.__sim.objectsReady(), null, { timeout: 120000 }).catch(() => {});
      const st = await S(q, () => ({ scene: window.__sim.objectScene(), m: window.__sim.ux().mission, glb: window.__sim.objectsReady(), n: document.querySelector('.mission p.mono').textContent }));
      ok(st.scene && st.m === id && st.glb, `${id}: object scene, mission and its GLBs loaded (${JSON.stringify(st)})`);
      if (id === 'line') await shot(q, 'desk-11-line');
      if (id === 'breakfast') {
        // from mission 04 the click-to-grab autopilot is off for the player …
        await S(q, () => window.__sim.pick('apple'));
        ok(!(await S(q, () => window.__sim.ux().busy)), 'object mission: a click on the apple does not start the autopilot');
        // … and stays available as hint rung 3: the arm grabs and lifts the next item, the player finishes
        const rung = await S(q, () => window.__sim.hintRung(3));
        const held = await advanceUntil(q, () => !!window.__sim.ux().held && !window.__sim.ux().busy, 20, 1);
        const rr = await S(q, () => window.__sim.run());
        ok(rung === 3 && held > 0 && rr.auto, 'hint rung 3 (partial demo) grabs ' + (await S(q, () => window.__sim.ux().held)) + ' and marks the run as autopilot');
      }
      await S(q, () => window.__sim.solve());
      let t = await advanceUntil(q, () => window.__sim.ux().won, 160, 4), retry = '';
      if (t < 0) {
        // physics occasionally knocks an item off the tray (seen on 'tidy': 3 of 4); the demo must recover when asked again
        retry = ' after one re-run of the demo (first try: ' + (await S(q, () => window.__sim.ux().hud)) + ')';
        await S(q, () => window.__sim.solve());
        t = await advanceUntil(q, () => window.__sim.ux().won, 160, 4);
      }
      const hud = await S(q, () => window.__sim.ux().hud);
      if (retry && t > 0) console.log(`NOTE ${id}: solution demo needed a re-run${retry}`);
      ok(t > 0, `${id} (${st.n}): the solution demo completes the mission in ${t} s sim time${retry} (${hud})`);
      if (id === 'lab') {
        const v = await S(q, () => window.__sim.ux().result);
        ok(v && v.prec < 0.07, 'lab: the vial stands upright in the rack (tilt ' + (v ? (v.prec * 180 / Math.PI).toFixed(1) : '?') + '°)');
      }
      await q.close();
    }
    // ---------------- mission 11: waste sorting on the conveyor (src/objects/wastebatch.js, src/ui/beltview.js) --------
    {
      // the mission picker in a plain-scene mission reloads into the conveyor scene
      const q = await open(browser, base + '?test=1&mise=bowl&detail=low', { width: 1280, height: 800 });
      await Promise.all([q.waitForURL(/mise=waste_hand/, { timeout: 60000 }), S(q, () => window.__sim.mission('waste_hand'))]);
      await q.waitForFunction(() => /mise=waste_hand/.test(location.search) && window.__sim && window.__sim.ready, null, { timeout: 300000 });
      ok(await S(q, () => window.__sim.scene() === 'conveyor' && window.__sim.ux().mission === 'waste_hand'), 'mission picker → mission 11 reloads into the conveyor scene');
      await q.close();
    }
    {
      const q = await open(browser, base + '?test=1&mise=waste_hand&detail=low', { width: 1280, height: 800 });
      await S(q, () => { window.__sim._app.sim.paused = true; });   // simulated time only through advance()
      const st0 = await S(q, () => ({ scene: window.__sim.scene(), m: window.__sim.ux().mission, hud: window.__sim.ux().hud, belt: !document.getElementById('ux-belt').hidden,
        five: document.getElementById('ux-abar').classList.contains('ux-ab5'), credit: !document.querySelector('.ux-credit').hidden && /NVIDIA SimReady \(CC BY 4\.0\)/.test(document.querySelector('.ux-credit').textContent),
        waste: window.__sim.waste() }));
      ok(st0.scene === 'conveyor' && st0.m === 'waste_hand' && st0.belt && st0.credit && st0.waste && st0.waste.stats.spawned === 0 && /pohnete rukou/.test(st0.hud),
        'mission 11: conveyor scene, Pás button in the action bar, credit line, nothing on the belt before the first input ' + JSON.stringify({ hud: st0.hud, belt: st0.belt, credit: st0.credit }));
      // key B: the belt stops (slats ramp to 0) and the first item spawns (B starts the run); B again: it runs
      await q.keyboard.press('b'); await S(q, () => window.__sim.advance(1));
      let w = await S(q, () => window.__sim.waste());
      const chip = await S(q, () => { window.__sim.renderNow(); const c = document.querySelector('.ux-chip-belt'); return !c.hidden && c.textContent; });
      ok(w.belt.speed === 0 && Math.abs(w.belt.v) < 1e-6 && w.stats.spawned === 1 && await S(q, () => document.getElementById('ux-belt').getAttribute('aria-pressed') === 'true') && /^Pás stojí 0:0\d$/.test(chip || ''),
        `key B stops the belt (speed ${w.belt.speed}, v ${w.belt.v}), the batch starts, chip "${chip}"`);
      await q.keyboard.press('b'); await S(q, () => window.__sim.advance(2));
      w = await S(q, () => window.__sim.waste());
      const hud = (await ux(q)).hud;
      ok(Math.abs(w.belt.v - 0.02) < 1e-6 && /^Hotovo 0 z 11 · na pásu 1$/.test(hud), `B again: the belt runs at 2 cm/s; objective "${hud}"`);
      // hint rung 2: the bin of the item nearest the gripper is outlined, the 3 s line lies on the belt
      await S(q, () => window.__sim.hintRung(2));
      await S(q, () => { const u = window.__sim._ux, it = window.__sim.waste().items.find((x) => x.state === 'belt'); u.ctl.begin(); u.userSetTarget(it.p[0], it.p[1], 0.1); window.__sim.advance(1.5); window.__sim.renderNow(); });
      const ov = await S(q, () => { const b = window.__sim._ux.beltView; return { outl: Object.entries(b.bins).filter(([, x]) => x.outline.visible).map(([k]) => k), line: b.line.visible, plates: Object.values(b.bins).filter((x) => x.plate.visible).length }; });
      const want = await S(q, () => { const it = window.__sim.waste().items.find((x) => x.state === 'belt'); return it && { paper: 'bin_paper', plastic: 'bin_plastic', glass: 'bin_glass', metal: 'bin_metal' }[it.fraction]; });
      ok(ov.plates === 4 && ov.outl.length === 1 && ov.outl[0] === want && ov.line, 'hint rung 2: the item\'s bin outlined, 3 s prediction line on the belt, 4 bin name plates ' + JSON.stringify(ov));
      await shot(q, 'desk-m11-hint2');
      // hint rung 3 "Ukaž mi": the scripted planner sorts the next item, chip "Běží: Skript (plánovač)", run = autopilot
      await S(q, () => window.__sim.hintRung(3));
      await S(q, () => window.__sim.advance(1));
      const ch = await S(q, () => { window.__sim.renderNow(); const c = document.querySelector('.ux-chip-run'); return { chip: !c.hidden && c.textContent, api: window.__sim.waste().chip }; });
      const sorted = await advanceUntil(q, () => window.__sim.waste().stats.correct >= 1 && !window.__sim.ux().busy, 40, 2);
      const r3 = await S(q, () => window.__sim.run());
      ok(ch.chip === 'Běží: Skript (plánovač)' && ch.api === ch.chip && sorted > 0 && r3.auto, '"Ukaž mi" sorts one item with beltSolve, chip "' + ch.chip + '", the run counts as autopilot (' + sorted + ' s)');
      // "Ukázat řešení" (autopilot of the whole batch, __sim.solve): wins; the result card shows sorted, purity, missed, belt
      await S(q, () => window.__sim.solve());
      let t = await advanceUntil(q, () => window.__sim.ux().won, 260, 4);
      if (t < 0) {
        // the planner's batch ends at 8–11 of 11 (tools/belt-measure.mjs batch); the win needs 8: once more when short
        console.log('NOTE mission 11: solution demo short of the win (' + (await ux(q)).hud + '), re-run');
        await S(q, () => window.__sim.solve());
        t = await advanceUntil(q, () => window.__sim.ux().won, 260, 4);
      }
      const card = await S(q, () => ({ open: !document.getElementById('win').hidden, vals: [...document.querySelectorAll('#ux-wvals > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]),
        stats: document.querySelector('.ux-winstats').textContent, demo: !document.querySelector('.ux-wdemo').hidden, res: window.__sim.ux().result }));
      const val = (k) => (card.vals.find((v) => v[0] === k) || [])[1];
      ok(t > 0 && card.open && /^\d+ z 11/.test(val('Roztříděno') || '') && /%/.test(val('Čistota') || '') && val('Propadlo') != null && val('Pás stál') != null && card.demo && card.res.stats.correct >= 8,
        `mission 11 solved by beltSolve in ${t} s; card ${JSON.stringify(card.vals)} · ${card.stats}`);
      await shot(q, 'desk-m11-result');
      await q.close();
    }
    {
      // mission 11 recorded (Učení ukázkou): env state on every frame, one episode per item, the belt pause replayed
      // (src/ui/teach.js, src/policy/episodes.js)
      const q = await open(browser, base + '?test=1&mise=waste_hand&detail=low', { width: 1280, height: 800 });
      await S(q, () => { window.__sim.record(true); window.__sim.solve(); });
      await advanceUntil(q, () => false, 24, 4);
      await S(q, () => window.__sim.beltToggle()); await advanceUntil(q, () => false, 3, 1); await S(q, () => window.__sim.beltToggle());
      await advanceUntil(q, () => false, 12, 4);
      await S(q, () => window.__sim.record(false));
      const j = await S(q, () => {
        const j = window.__sim.exportDemo(), fr = j.episodes[0].frames;
        return { n: fr.length, env: fr.filter((f) => f.env && 'target' in f.env && 'next' in f.env).length, paused: fr.filter((f) => f.env && f.env.belt === 0).length,
          segs: j.printedrobotics.segments, belt: j.printedrobotics.snapshot.belt };
      });
      const sortedEp = (j.segs || []).filter((x) => x.outcome === 'sorted');
      ok(j.n > 500 && j.env === j.n && j.paused > 30 && j.belt === 0.02 && sortedEp.length >= 2 && sortedEp.every((x) => x.to > x.from),
        `mission 11 recording: env on ${j.env}/${j.n} frames, belt paused in ${j.paused}, episodes ${JSON.stringify((j.segs || []).map((x) => x.item + ':' + x.outcome))}`);
      await S(q, () => window.__sim.replay(false));
      const seen = [];
      for (let k = 0; k < 34; k++) {
        await S(q, () => window.__sim.advance(1));
        seen.push(await S(q, () => ({ v: window.__sim.waste().belt.speed, pressed: document.getElementById('ux-belt').getAttribute('aria-pressed'), rep: window.__sim.ux().replaying, sp: window.__sim.waste().stats.spawned })));
      }
      const stood = seen.filter((x) => x.rep && x.v === 0);
      ok(stood.length >= 2 && stood.every((x) => x.pressed === 'true') && seen[seen.length - 1].sp >= 3,
        `mission 11 replay: the belt stands where it stood in the recording (${stood.length} s, Pás button pressed), the batch spawns again (${seen[seen.length - 1].sp})`);
      await q.close();
    }
    {
      // mission 11 by hand on desktop: the gizmo / keyboard path. Each item: when it is in front of the arm, B stops the
      // belt, the ball goes over the item (what a gizmo drag sets: ux.userSetTarget), the wrist ring squares the jaws,
      // down, Space closes, up, over its bin, down, Space opens, B runs the belt again. The belt stands for every pick,
      // so this run earns ★ hotovo (and purity) but not ★ bez zastavení pásu.
      const q = await open(browser, base + '?test=1&mise=waste_hand&detail=low', { width: 1280, height: 800 });
      await S(q, () => { window.__sim._app.sim.paused = true; });
      // one real mouse drag of the gizmo ball in this scene first
      const a0 = await S(q, () => window.__sim.screen('target')), t0 = (await ux(q)).target;
      await q.mouse.move(a0.x, a0.y); await q.mouse.down();
      for (let i = 1; i <= 8; i++) await q.mouse.move(a0.x - 10 * i, a0.y + 6 * i);
      await q.mouse.up(); await S(q, () => window.__sim.advance(0.5));
      const t1 = (await ux(q)).target;
      ok(Math.hypot(t1[0] - t0[0], t1[1] - t0[1]) > 0.01, 'mission 11: the gizmo ball drags the target');
      // a drag of the ball to pt: the target moves in n steps with the arm following in between (a hand drags at a
      // few cm/s; a jump straight down knocked tall cups and vials over in node runs)
      const to = (pt, n = 1, dt = 0) => S(q, ([pt, n, dt]) => {
        const u = window.__sim._ux; if (!u.ctl.active) u.ctl.begin();
        const a = Array.from(u.ctl.target);
        for (let k = 1; k <= n; k++) { u.userSetTarget(a[0] + (pt[0] - a[0]) * k / n, a[1] + (pt[1] - a[1]) * k / n, a[2] + (pt[2] - a[2]) * k / n); u.onUserMove('drag-ball'); if (dt) window.__sim.advance(dt); }
      }, [pt, n, dt]);
      const flow = [], skip = [];
      let won = false;
      for (let k = 0; k < 16 && !won; k++) {
        // the most downstream item past y = −0.02 (in front of the arm), or one wedged on the belt
        let name = null;
        for (let i = 0; i < 60 && !name; i++) {
          name = await S(q, (skip) => { const w = window.__sim.waste(), b = w.items.filter((x) => (x.state === 'belt' && x.p[1] > -0.02 || x.state === 'stuck') && !skip.includes(x.name)).sort((x, y) => y.p[1] - x.p[1])[0]; return b ? b.name : null; }, skip);
          if (!name) { if ((await ux(q)).won || await S(q, () => window.__sim.waste().done)) break; await S(q, () => window.__sim.advance(0.5)); }
        }
        if (!name) break;
        await q.keyboard.press('b'); await S(q, () => window.__sim.advance(0.6));
        // up to 3 tries: a missed grasp opens and tries again; an item that lands beside its bin is picked up from the
        // table again (a player would)
        let held = false, done = false, belt = false;
        for (let tr = 0; tr < 3 && !done; tr++) {
          const g = await S(q, async (n) => {
            const M = await import('./src/missions.js'), B = await import('./src/objects/beltpick.js'), u = window.__sim._ux, w = u.world;
            const z = w.belt.zone(w.com(n, [0, 0, 0])), onBelt = z === 'belt' || z === 'entry';
            const pl = M.libPick(u.ctl, w, n, null, onBelt ? { floor: B.BELT_FLOOR } : {});
            return { hover: pl.steps[1].pts[pl.steps[1].pts.length - 1], at: pl.steps[2].pts[pl.steps[2].pts.length - 1], roll: pl.roll, dz: pl.dz };
          }, name);
          const tg = (await ux(q)).target;
          await to([tg[0], tg[1], Math.max(tg[2], 0.16)], 8, 0.08);
          await to([g.hover[0], g.hover[1], Math.max(0.16, g.hover[2])], 10, 0.08); await S(q, (r) => window.__sim._ux.setRoll(r), g.roll); await S(q, () => window.__sim.advance(0.8));
          await to(g.hover, 4, 0.08); await to(g.at, 20, 0.06); await S(q, () => window.__sim.advance(0.6));
          await q.keyboard.press('Space'); await S(q, () => window.__sim.advance(1.0));
          await to([g.at[0], g.at[1], 0.14], 10, 0.08); await S(q, () => window.__sim.advance(0.5));
          held = (await ux(q)).held === name;
          if (!held) { await q.keyboard.press('Space'); await S(q, () => window.__sim.advance(0.6)); continue; }
          belt = true;
          const dr = await S(q, async (n) => {
            const B = await import('./src/objects/beltpick.js'), u = window.__sim._ux, w = u.world;
            const fx = { paper: 'bin_paper', plastic: 'bin_plastic', glass: 'bin_glass', metal: 'bin_metal' }[B.fractionOf(n)], t = B.binDrop(w, fx, n);
            const r = t.closeYaw != null ? u.ctl.graspRoll([t.xy[0], t.xy[1], 0.1], t.closeYaw, u.ctl.home, Math.PI).roll : null;
            return { xy: t.xy, surface: t.surface, roll: r };
          }, name);
          await to([dr.xy[0], dr.xy[1], 0.14], 14, 0.08); if (dr.roll != null) await S(q, (r) => window.__sim._ux.setRoll(r), dr.roll);
          await S(q, () => window.__sim.advance(0.8));
          await to([dr.xy[0], dr.xy[1], dr.surface + g.dz + 0.004], 12, 0.06); await S(q, () => window.__sim.advance(0.5));
          await q.keyboard.press('Space'); await S(q, () => window.__sim.advance(0.8));
          await to([dr.xy[0], dr.xy[1], 0.14], 8, 0.08); await S(q, () => window.__sim.advance(0.4));
          const stt = await S(q, (n) => window.__sim.waste().items.find((x) => x.name === n).state, name);
          done = stt === 'bin' || stt === 'moving' || stt === 'tote' || stt === 'floor';
        }
        await q.keyboard.press('b');   // the belt runs again once the item is in its bin (or given up)
        if (!belt) skip.push(name);
        flow.push(name.replace(/\d$/, '') + (held ? '' : '(missed)'));
        if (k === 3) await shot(q, 'desk-m11-hand-mid');
        won = (await ux(q)).won;
      }
      if (!won) won = (await advanceUntil(q, () => window.__sim.ux().won, 60, 3)) > 0;
      const r = await ux(q), run = await S(q, () => window.__sim.run()), ws = await S(q, () => window.__sim.waste().stats);
      ok(won && r.result.kind === 'manual' && !run.auto && !run.assisted && r.result.stars >= 1 && ws.paused > 0,
        `mission 11 by hand (gizmo/keyboard): ${won ? 'won' : 'not won'}, ${ws.correct}/${ws.n} sorted, purity ${ws.purity}, belt stood ${ws.paused.toFixed(1)} s, ${r.result && r.result.stars} ★ [${flow.join(', ')}]`);
      await shot(q, 'desk-m11-hand-result');
      const named = await S(q, () => document.getElementById('ux-wline').textContent);
      ok(/★ hotovo/.test(named) && /☆ pás stál \d+(,\d)? s/.test(named), 'result card names the stars, the missed one with its measured value: ' + named);
      await q.close();
    }
    {
      // ---------------- mission 12: teach the robot (src/policy/knn.js, src/policy/run.js, src/ui/policy.js) ----------
      // demonstrate a few items via the scripted path (hint rung 3 "Nahrát ukázky skriptem", recorded), Naučit,
      // Spustit politiku on the verification batch: chip, result card with the per-item analysis and the side-by-side
      const q = await open(browser, base + '?test=1&mise=waste_teach&detail=low', { width: 1440, height: 900 });
      await S(q, () => { window.__sim._app.sim.paused = true; });   // simulated time only through advance()
      const p0 = await S(q, () => { window.__sim.renderNow(); const c = document.querySelector('.ux-chip-run'); return { scene: window.__sim.scene(), m: window.__sim.ux().mission, pol: window.__sim.policy(),
        chip: !c.hidden && c.textContent, sec: !document.getElementById('ux-sec-policy').hidden, step: document.querySelector('.ux-chip-step').textContent, hud: window.__sim.ux().hud }; });
      ok(p0.scene === 'conveyor' && p0.m === 'waste_teach' && p0.chip === 'Ovládáte vy' && p0.sec && p0.pol.button && /^Naučit/.test(p0.pol.button) && /▸ 1 Ukázky/.test(p0.step) && /Naučit/.test(p0.hud),
        'mission 12: conveyor scene, chip "' + p0.chip + '", button "' + p0.pol.button + '", stepper "' + p0.step + '", Nástroje → Politika');
      await S(q, () => window.__sim.hintRung(3));
      await S(q, () => window.__sim.advance(1));
      const rec = await S(q, () => ({ recording: window.__sim.ux().recording, chip: window.__sim.policy().chip }));
      const dt = await advanceUntil(q, () => !window.__sim.ux().busy && window.__sim.policy().live >= 3, 90, 3);
      await S(q, () => window.__sim.advance(2));
      ok(rec.recording && rec.chip === 'Běží: Skript (plánovač)' && dt > 0, `"Nahrát ukázky skriptem": recording on, chip "${rec.chip}", ${(await S(q, () => window.__sim.policy().live))} demos in ${dt} s`);
      // the teach phase with Nástroje → Politika open: the recorded episodes, the coverage line
      await S(q, () => { const x = document.querySelector('#ux-hintbox .ux-x'); if (x) x.click(); window.__sim._ux.panel.openDrawer(false); document.getElementById('ux-sec-policy').scrollIntoView({ block: 'start' }); });
      await q.waitForTimeout(400); await S(q, () => window.__sim.renderNow());
      const live = await S(q, () => ({ rows: document.querySelectorAll('#ux-pol-list li.live').length, cov: document.getElementById('ux-pol-cov').textContent }));
      ok(live.rows >= 3 && /papír ✓/.test(live.cov), 'Politika lists the episodes of the running recording: ' + live.rows + ' rows, ' + live.cov);
      await shot(q, 'desk-m12-teach');
      await S(q, () => window.__sim._ux.panel.closeDrawer(false));
      await S(q, () => window.__sim.policyLearn());
      const p1 = await S(q, () => ({ pol: window.__sim.policy(), cov: document.getElementById('ux-pol-cov').textContent, st: document.getElementById('ux-pol-st').textContent, rows: document.querySelectorAll('#ux-pol-list li').length }));
      const used = p1.pol.examples.filter((e) => e.use);
      ok(p1.pol.model && p1.pol.model.n === used.length && used.length >= 3 && used.every((e) => e.src === 'script' && e.y != null && e.dz != null) && p1.rows === used.length &&
        /^Natrénováno za .+ ms z \d+ ukáz/.test(p1.st) && /Ukázané frakce: /.test(p1.cov) && p1.pol.button === 'Spustit politiku' && p1.pol.step === 2,
        `Naučit: ${p1.st}; ${p1.cov}; button "${p1.pol.button}" ` + JSON.stringify(used.map((e) => e.item + '→' + e.bin)));
      await S(q, () => window.__sim.policyRun());
      await S(q, () => window.__sim.advance(2));
      const run1 = await S(q, () => { window.__sim.renderNow(); const c = document.querySelector('.ux-chip-run'); return { chip: !c.hidden && c.textContent, pol: window.__sim.policy(), seed: window.__sim._ux.wasteRun().o.seed, hud: window.__sim.ux().hud }; });
      ok(run1.chip === 'Běží: Naučené pravidlo (kNN) + plánovač' && run1.pol.verify && run1.pol.running && run1.seed === 2 && run1.pol.step === 3,
        `Spustit politiku: chip "${run1.chip}", verification batch seed ${run1.seed}, objective "${run1.hud}"`);
      await advanceUntil(q, () => { const s = window.__sim; s.renderNow(); return s.ux().won || !document.getElementById('win').hidden; }, 50, 4);
      await S(q, () => window.__sim.renderNow());
      await shot(q, 'desk-m12-running');
      const fin = await advanceUntil(q, () => window.__sim.ux().won || !document.getElementById('win').hidden, 300, 4);
      const card = await S(q, () => ({ open: !document.getElementById('win').hidden, k: document.getElementById('ux-wk').textContent, h: document.getElementById('win-h').textContent,
        vals: [...document.querySelectorAll('#ux-wvals > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]),
        cmp: [...document.querySelectorAll('#ux-wpol .ux-pol-cmp tr')].map((r) => r.querySelector('th').textContent + ': ' + r.querySelector('td').textContent),
        fails: [...document.querySelectorAll('#ux-wpol .ux-pol-fail li')].map((x) => x.textContent), label: (document.querySelector('#ux-wpol .ux-pol-rep > p') || {}).textContent || '', pol: window.__sim.policy(), won: window.__sim.ux().won, line: document.getElementById('ux-wline').textContent }));
      const val = (k) => (card.vals.find((v) => v[0] === k) || [])[1];
      const last = card.pol.last;
      ok(fin > 0 && card.open && /^Běží: Naučené pravidlo \(kNN\) \+ plánovač · ověřeno na nové dávce č\. 2/.test(card.label) && /^\d+ \(natrénováno za /.test(val('Ukázky') || '') && /^\d+ z 11✓?$/.test(val('Roztříděno') || '') &&
        card.cmp.length === 3 && /^Skript \(plánovač\): \d+ z 11$/.test(card.cmp[0]) && /^Vaše politika: \d+ z 11$/.test(card.cmp[1]) && last && last.rows.length === 11 &&
        card.fails.length === last.rows.filter((r) => !r.ok).length && /Co neumí/.test(card.line),
        `mission 12 result card (${card.won ? 'won' : 'not passed'}, ${fin} s): ${card.k} · ${card.h} · ${card.label} · ${JSON.stringify(card.vals)} · ${JSON.stringify(card.cmp)} · failures ${JSON.stringify(card.fails)}`);
      // the demos came from the script: no stars either way; unseen fractions pass ("neznámá třída – nechal projet")
      const unseen = Object.entries(p1.pol.model.coverage).filter(([, k]) => !k).map(([f]) => f);
      ok(!card.won || (await ux(q)).result.stars === 0, 'scripted demos: the policy run earns no stars');
      ok(!unseen.length || last.rows.filter((r) => unseen.includes(r.fraction)).every((r) => r.cause === 'unknown'), `unseen fractions [${unseen}] are let through: ` + JSON.stringify(last.rows.filter((r) => !r.ok).map((r) => r.item + ':' + r.cause)));
      await q.waitForTimeout(1500); await S(q, () => window.__sim.renderNow());   // the card fades in
      await shot(q, 'desk-m12-result');
      // any player input during a policy run stops it: chip back to "Ovládáte vy", the run counts without stars
      await S(q, () => window.__sim.policyRun());
      await S(q, () => window.__sim.advance(3));
      await q.keyboard.press('ArrowLeft'); await S(q, () => window.__sim.advance(0.5));
      const iv = await S(q, () => ({ pol: window.__sim.policy(), run: window.__sim.run() }));
      ok(iv.pol.intervened && !iv.pol.running && iv.pol.chip === 'Ovládáte vy' && iv.run.auto, `player input during the policy run: intervened ${iv.pol.intervened}, chip "${iv.pol.chip}", no stars`);
      await q.close();
    }
    {
      // record link for an object mission: validated (unknown missions / absurd times are ignored)
      const q = await open(browser, base + '?test=1&mise=lab&rekord=12.4&detail=low', { width: 1280, height: 800 });
      ok(await S(q, () => !!document.querySelector('.ux-chal') && window.__sim._ux.challenge.time === 12.4 && window.__sim.ux().mission === 'lab'), 'challenge link works for an object mission');
      await q.close();
      const r = await open(browser, base + '?test=1&mise=lab&rekord=0.01&detail=low', { width: 1280, height: 800 });
      ok(await S(r, () => !document.querySelector('.ux-chal') && window.__sim.ux().mission === 'lab'), 'challenge link with an impossible time is ignored');
      await r.close();
    }

    // ---------------- challenge landing + chapter 06 ----------------
    {
      const c = await open(browser, base + '?test=1&mise=stack&rekord=27.3&detail=low', { width: 1280, height: 800 });
      const st = await S(c, () => ({ chip: !!document.querySelector('.ux-chal'), m: window.__sim._ux.runner.m.id, ch: window.__sim._ux.challenge && window.__sim._ux.challenge.time,
        cards: (window.__sim._ux.panel.openPicker ? window.__sim._ux.panel.openPicker() : null, !!document.querySelector('#ux-picker a.ux-chapter[href="nastaveni/"]')) }));
      ok(st.chip && st.m === 'stack' && Math.abs(st.ch - 27.3) < 1e-6, 'challenge link ?mise=&rekord= lands on the mission with a challenge chip (' + JSON.stringify(st) + ')');
      ok(st.cards, 'mission picker offers chapter 06 "Skutečná ruka" → setup wizard');
      await c.close();
    }

    // ---------------- onboarding (first visit) ----------------
    const o = await open(browser, base + '?test=1&onboard=1&detail=low', { width: 1280, height: 800 });
    await o.waitForFunction(() => { const c = document.querySelector('.ux-coach'); return c && !c.hidden; }, null, { timeout: 30000 }).catch(() => {});
    ok(await S(o, () => !document.querySelector('.ux-coach').hidden), 'onboarding is shown');
    await S(o, () => window.__sim._ux.onboarding.tick());
    const cover = await S(o, () => { const u = window.__sim._ux, r = document.querySelector('.ux-coach').getBoundingClientRect();
      const inside = (n) => { const q = u.gizmo.project(n === 'target' ? u.gizmo.tip : u.world.pos(n, [0, 0, 0]), {}); return q.x > r.left - 20 && q.x < r.right + 20 && q.y > r.top - 20 && q.y < r.bottom + 20; };
      return ['cube', 'bowl', 'target'].filter(inside); });
    ok(cover.length === 0, 'P0-2: desktop guide bubble covers no object of interest (' + cover.join(',') + ')');
    // guided first task: click cube → click bowl → won → "Teď ručně"
    a = await S(o, () => window.__sim.screen('cube')); await o.mouse.click(a.x, a.y);
    await advanceUntil(o, () => window.__sim.ux().held === 'cube' && !window.__sim.ux().busy, 14, 1);
    a = await S(o, () => window.__sim.screen('bowl')); await o.mouse.click(a.x, a.y);
    await advanceUntil(o, () => window.__sim.ux().won, 16, 1);
    await o.waitForFunction(() => { const g = document.getElementById('ux-wguide'); return !document.getElementById('win').hidden && g && !g.hidden; }, null, { timeout: 30000 }).catch(() => {});
    const stay = await S(o, () => ({ win: !document.getElementById('win').hidden, guide: !!document.getElementById('ux-wguide') && !document.getElementById('ux-wguide').hidden,
      cta: (() => { const c = document.getElementById('cta'); return !!c && c.offsetParent !== null; })(), coach: document.getElementById('ux-coach-h').textContent }));
    ok(stay.win && stay.guide && !stay.cta, 'first (guided) win card stays, offers "Teď ručně", no purchase CTA (' + JSON.stringify(stay) + ')');
    await o.click('#ux-wguide');
    await o.waitForFunction(() => /Teď ručně/.test(document.getElementById('ux-coach-h').textContent), null, { timeout: 30000 }).catch(() => {});
    const step = await S(o, () => document.getElementById('ux-coach-h').textContent);
    ok(/Teď ručně/.test(step), 'guided first task advances to the hands-on step after the win (' + step + ')');
    await shot(o, 'desk-10-onboarding');
    await o.close();

    // ---------------- language: a browser that is not cs/sk starts in English (playtest A0) ----------------
    for (const [loc, want] of [['en-US', 'en'], ['cs-CZ', 'cs']]) {
      const ctx = await browser.newContext({ locale: loc, viewport: { width: 800, height: 600 } });
      const lp = await ctx.newPage();
      await lp.goto(base + '?detail=low&mise=bowl', { waitUntil: 'domcontentloaded' });
      const got = await lp.waitForFunction(() => document.documentElement.lang !== 'cs' || document.getElementById('lang-sw').children.length > 0, null, { timeout: 60000 })
        .then(() => lp.evaluate(() => document.documentElement.lang)).catch(() => '?');
      ok(got === want, `browser ${loc}, no ?lang= → page language ${got}`);
      await ctx.close();
    }

    // ---------------- phone onboarding (P0-2) ----------------
    const po = await open(browser, base + '?test=1&onboard=1&detail=low', { width: 390, height: 844 }, true);
    await po.waitForFunction(() => { const c = document.querySelector('.ux-coach'); return c && !c.hidden && !!c.closest('.ux-under'); }, null, { timeout: 30000 }).catch(() => {});
    const pr = await S(po, () => { const c = document.querySelector('.ux-coach'), r = c.getBoundingClientRect(), st = document.querySelector('.stage').getBoundingClientRect();
      return { inUnder: !!c.closest('.ux-under'), top: r.top, stageBottom: st.bottom, visible: !c.hidden }; });
    ok(pr.visible && pr.inUnder && pr.top >= pr.stageBottom - 1, 'P0-2: phone guide is a strip under the stage, not over it ' + JSON.stringify(pr));
    await shot(po, 'phone-00-onboarding');
    // playtest b08: no guide step pushes the action row (gripper button) off-screen or covers it
    for (let i = 0; i < 5; i++) {
      const g = await S(po, () => { const q = document.getElementById('ux-grip').getBoundingClientRect(), c = document.querySelector('.ux-coach').getBoundingClientRect(), st = document.querySelector('.stage').getBoundingClientRect();
        return { step: document.getElementById('ux-coach-k').textContent, grip: [Math.round(q.top), Math.round(q.bottom)], coach: [Math.round(c.top), Math.round(c.bottom)], vh: innerHeight, stage: Math.round(st.height) }; });
      ok(g.grip[1] <= g.vh && g.grip[0] >= 0 && (g.coach[0] >= g.grip[1] - 1 || g.coach[1] <= g.grip[0] + 1) && g.stage >= 0.4 * (g.vh - 56),
        'phone guide step keeps the gripper button on screen and uncovered, scene ≥ 40 % ' + JSON.stringify(g));
      if (i === 4) await shot(po, 'phone-00b-guide-5');
      await S(po, () => document.querySelector('.ux-coach [data-a=next]').click()); await po.waitForTimeout(450);
    }
    // playtest b11: the opened "Nástroje" sheet leaves at least 40 % of the screen to the scene (HUD stage 1: the
    // thumb bar's "Nástroje" opens it; the site header is hidden on phones)
    {
      await S(po, () => document.getElementById('ux-qtools').click()); await po.waitForTimeout(500);
      const f = await S(po, () => { const pn = document.querySelector('.panel'), r = pn.getBoundingClientRect(); return pn.hidden ? -1 : +(r.top / innerHeight).toFixed(2); });
      ok(f >= 0.4, `phone: the opened sheet leaves ${Math.round(f * 100)} % of the scene visible`);
      const fo = await S(po, () => document.querySelector('.panel').contains(document.activeElement));
      await po.keyboard.press('Escape'); await po.waitForTimeout(200);
      const back = await S(po, () => ({ hidden: document.getElementById('panel').hidden, focus: document.activeElement && document.activeElement.id }));
      ok(fo && back.hidden && back.focus === 'ux-qtools', 'phone: the sheet takes focus, Esc closes it and focus returns to "Nástroje" ' + JSON.stringify(back));
    }
    await po.close();

    // ---------------- phone ----------------
    const ph = await open(browser, base + '?test=1&mise=bowl&detail=low', { width: 390, height: 844 }, true);
    await shot(ph, 'phone-01-start');
    {
      // HUD stage 3: the side view is on by default on phones too (it costs < 10 % fps) and covers no object
      const g = await S(ph, () => { const s = window.__sim, u = s._ux; s.renderNow();
        const el = document.querySelector('.ux-side').getBoundingClientRect(), cam = document.querySelector('.ux-cam').getBoundingClientRect(), st = document.querySelector('.stage').getBoundingClientRect();
        const pts = u.world.active().map((e) => [e.name, s.screen(e.name)]).concat([['tip', s.screen('target')]]);
        return { ...s.sideState(), hit: pts.filter(([, q]) => q.x > el.left - 6 && q.x < el.right + 6 && q.y > el.top - 6 && q.y < el.bottom + 6).map(([n]) => n),
          box: [el.left, el.top, el.right, el.bottom].map(Math.round), camTop: Math.round(cam.top), stage: [Math.round(st.left), Math.round(st.bottom)] }; });
      ok(g.on && g.shown && !g.hit.length && g.box[3] <= g.camTop && g.box[0] >= g.stage[0] && g.box[2] - g.box[0] >= 120, 'phone: side view on, above the camera toggle, covers no object ' + JSON.stringify(g));
    }
    a = await S(ph, () => window.__sim.screen('target'));
    const pt0 = await ux(ph);
    await touchDrag(ph, a, { x: a.x - 60, y: a.y + 50 });
    const pt1 = await ux(ph);
    ok(Math.hypot(pt1.target[0] - pt0.target[0], pt1.target[1] - pt0.target[1]) > 0.02, 'touch drag moves the target on a phone');
    await S(ph, () => window.__sim.advance(1.5));
    await shot(ph, 'phone-02-drag');
    await S(ph, () => window.__sim.reset());
    a = await S(ph, () => window.__sim.screen('cube'));
    await ph.touchscreen.tap(a.x, a.y);
    ok((await ux(ph)).busy, 'tap on the cube starts a pick on a phone');
    const tp = await advanceUntil(ph, () => window.__sim.ux().held === 'cube' && !window.__sim.ux().busy, 14, 1);
    ok(tp > 0, 'phone: cube picked');
    await S(ph, () => document.getElementById('ux-qtools').click()); await ph.waitForTimeout(400);
    await shot(ph, 'phone-03-panel');
    await S(ph, () => document.getElementById('ux-drawer-x').click());
    await S(ph, () => window.__sim.explode(true)); await ph.waitForTimeout(2000);
    await shot(ph, 'phone-04-explode');
    await S(ph, () => window.__sim.explode(false));
    await S(ph, () => { window.__sim.solve(); });
    await advanceUntil(ph, () => window.__sim.ux().won, 30, 3);
    await S(ph, () => window.__sim.advance(0.3));
    await shot(ph, 'phone-05-win');
    {
      // phone 390×844: the result card is a bottom sheet under the scene, buttons ≥ 44 px, the scene stays visible
      const g = await S(ph, () => {
        const w = document.getElementById('win'), r = w.getBoundingClientRect(), st = document.querySelector('.stage').getBoundingClientRect();
        const btns = [...w.querySelectorAll('.win-b > :not([hidden]), .ux-wlinks > :not([hidden])')].map((b) => Math.round(b.getBoundingClientRect().height));
        return { open: !w.hidden, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, stageTop: Math.round(st.top), stageBottom: Math.round(st.bottom), btns, docW: document.documentElement.scrollWidth, vw: innerWidth };
      });
      ok(g.open && g.bottom <= g.vh + 1 && g.top >= g.stageBottom - 1 && g.stageBottom - g.stageTop >= 0.38 * g.vh && g.btns.length >= 2 && g.btns.every((x) => x >= 44) && g.docW <= g.vw,
        'phone: result card is a bottom sheet, scene visible above it, buttons ≥ 44 px ' + JSON.stringify(g));
    }
    await ph.close();
  } catch (e) { console.log('FAIL exception', e); fails++; diagnose('exception ' + (e && e.message)); }
  await diag;
  await browser.close(); srv.kill();
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK', '— screenshots in', OUT);
  process.exit(fails ? 1 : 0);
})();
