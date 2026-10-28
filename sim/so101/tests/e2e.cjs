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
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };

function freePort() { return new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }

async function open(browser, url, vp, touch) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1, hasTouch: !!touch, isMobile: !!touch });
  page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails++; });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('console.error', m.text()); });
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
      await S(p, () => window.__sim.reset()); await S(p, () => window.__sim.advance(0.3));
      await S(p, () => { const u = window.__sim._ux, c = u.world.pos('cube', [0, 0, 0]); u.ctl.begin(); u.ctl.setGrip(false); u.ctl.setTarget(c[0], c[1], c[2] + 0.035); });
      await S(p, () => window.__sim.advance(3));
      const h0 = (await ux(p)).hud, g0 = await S(p, () => window.__sim._ux.ctl.grip);
      const jp = await S(p, () => window.__sim.linkPoint(5));
      await p.mouse.click(jp.x, jp.y);
      await S(p, () => window.__sim.advance(1.2));
      const h1 = (await ux(p)).hud, g1 = await S(p, () => window.__sim.state().ctrl[5]);
      ok(g0 < 0 && g1 > 1 && /Otevřete/.test(h0) && /Sjeďte dolů/.test(h1), `tap on the jaw opens the gripper (${g0.toFixed(2)} → ${g1.toFixed(2)}); HUD "${h0}" → "${h1}"`);
    }

    // click-to-pick: click the cube, then the bowl
    await S(p, () => window.__sim.reset());
    a = await S(p, () => window.__sim.screen('cube'));
    await p.mouse.click(a.x, a.y);
    const busy = await ux(p);
    ok(busy.busy, 'click on the cube starts a planned pick');
    await S(p, () => window.__sim.advance(0.3));
    await shot(p, 'desk-03-path-preview');
    const tPick = await advanceUntil(p, () => window.__sim.ux().held === 'cube' && !window.__sim.ux().busy, 14, 1);
    ok(tPick > 0, `cube picked after ${tPick}s`);
    a = await S(p, () => window.__sim.screen('bowl'));
    await p.mouse.click(a.x, a.y);
    const tWin = await advanceUntil(p, () => window.__sim.ux().won, 16, 1);
    ok(tWin > 0, `click on the bowl places the cube, mission won after ${tWin}s`);
    await S(p, () => window.__sim.advance(0.4));
    await shot(p, 'desk-04-win');

    // every mission: automatic solution
    for (const id of await S(p, () => window.__sim.missions)) {
      await S(p, (m) => window.__sim.mission(m), id);
      await S(p, () => window.__sim.solve());
      const t = await advanceUntil(p, () => window.__sim.ux().won, 45, 3);
      const u = await ux(p);
      ok(t > 0, `mission ${id} solved by its plan (${t}s, ${u.result ? u.result.stars + '★' : u.hud})`);
      if (id === 'trace' || id === 'sort') await shot(p, 'desk-05-' + id);
    }

    // drawing mission: top-down view, paper-plane drag keeps the pen on the paper; finger trace → robot completes it
    {
      await S(p, () => window.__sim.mission('trace')); await p.waitForTimeout(900);
      const top = await S(p, () => { const c = window.__sim._ux.app.camera, t = window.__sim._ux.app.controls.target; const d = c.position.clone().sub(t).normalize(); return d.y; });
      ok(top > 0.95, 'drawing mission starts with a top-down camera (' + top.toFixed(3) + ')');
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
    await p.waitForTimeout(2500);
    await shot(p, 'desk-08-explode');
    ok((await ux(p)).explode > 0.3, 'exploded view separates the parts');
    await S(p, () => window.__sim.assemble());
    await p.waitForTimeout(2500);
    await shot(p, 'desk-09-assembly');
    await S(p, () => window.__sim.explode(false));
    await p.close();

    // ---------------- onboarding (first visit) ----------------
    const o = await open(browser, base + '?test=1&onboard=1&detail=low', { width: 1280, height: 800 });
    await o.waitForTimeout(1500);
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
    await o.waitForTimeout(3200);
    const step = await S(o, () => document.getElementById('ux-coach-h').textContent);
    ok(/Teď ručně/.test(step), 'guided first task advances to the hands-on step after the win (' + step + ')');
    await shot(o, 'desk-10-onboarding');
    await o.close();

    // ---------------- phone onboarding (P0-2) ----------------
    const po = await open(browser, base + '?test=1&onboard=1&detail=low', { width: 390, height: 844 }, true);
    await po.waitForTimeout(1500);
    const pr = await S(po, () => { const c = document.querySelector('.ux-coach'), r = c.getBoundingClientRect(), st = document.querySelector('.stage').getBoundingClientRect();
      return { inUnder: !!c.closest('.ux-under'), top: r.top, stageBottom: st.bottom, visible: !c.hidden }; });
    ok(pr.visible && pr.inUnder && pr.top >= pr.stageBottom - 1, 'P0-2: phone guide is a strip under the stage, not over it ' + JSON.stringify(pr));
    await shot(po, 'phone-00-onboarding');
    await po.close();

    // ---------------- phone ----------------
    const ph = await open(browser, base + '?test=1&mise=bowl&detail=low', { width: 390, height: 844 }, true);
    await shot(ph, 'phone-01-start');
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
    await ph.evaluate(() => window.scrollTo(0, 500));
    await shot(ph, 'phone-03-panel');
    await ph.evaluate(() => window.scrollTo(0, 0));
    await S(ph, () => window.__sim.explode(true)); await ph.waitForTimeout(2000);
    await shot(ph, 'phone-04-explode');
    await S(ph, () => window.__sim.explode(false));
    await S(ph, () => { window.__sim.solve(); });
    await advanceUntil(ph, () => window.__sim.ux().won, 30, 3);
    await S(ph, () => window.__sim.advance(0.3));
    await shot(ph, 'phone-05-win');
    await ph.close();
  } catch (e) { console.log('FAIL exception', e); fails++; }
  await browser.close(); srv.kill();
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK', '— screenshots in', OUT);
  process.exit(fails ? 1 : 0);
})();
