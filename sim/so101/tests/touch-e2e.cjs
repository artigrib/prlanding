// Touch checks in Chromium with real touch input (CDP Input.dispatchTouchEvent), phone portrait 390×844 and
// landscape 844×390 (touch audit, quick fixes 1–8):
//   node sim/so101/tests/touch-e2e.cjs [screenshot-dir]
// Starts `python3 -m http.server` at the repo root. Positions come from window.__sim (?test=1); physics is advanced
// synchronously with __sim.advance(), so results do not depend on the (slow, software GL) frame rate.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'so101touch');
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() { return new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }

async function phone(browser, url, vp) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails++; });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('console.error', m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 300000 });
  const cdp = await ctx.newCDPSession(page);
  const T = { page, ctx, cdp, gestures: 0 };
  const tp = (pts) => pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 8, radiusY: 8, force: 1 }));
  T.start = (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[x, y]]) });
  T.move = (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[x, y]]) });
  T.end = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // event timestamps 60 ms apart: at software-GL frame rates the acks alone would stretch a tap past 300 ms
  T.tap = async (x, y) => {
    T.gestures++; const t0 = Date.now() / 1000;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[x, y]]), timestamp: t0 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.06 });
    await sleep(150);
  };
  /** one finger through points, n steps per segment */
  T.drag = async (pts, n = 8, dt = 25) => {
    T.gestures++;
    await T.start(...pts[0]);
    for (let i = 1; i < pts.length; i++) for (let k = 1; k <= n; k++) {
      await T.move(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / n, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / n); await sleep(dt);
    }
    await T.end();
  };
  T.two = async (a0, a1, b0, b1, n = 8) => {
    T.gestures++;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([a0, a1]) });
    for (let k = 1; k <= n; k++) {
      const L = (u, v) => [u[0] + (v[0] - u[0]) * k / n, u[1] + (v[1] - u[1]) * k / n];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([L(a0, b0), L(a1, b1)]) }); await sleep(30);
    }
    await T.end();
  };
  T.S = (fn, arg) => page.evaluate(fn, arg);
  T.ux = () => T.S(() => window.__sim.ux());
  T.adv = (s) => T.S((s) => { window.__sim.advance(s); window.__sim.renderNow(); }, s);
  T.shot = async (n) => { try { await page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 120000 }); } catch (e) { console.log('note: screenshot ' + n + ' timed out'); } };
  /** screen point of a MuJoCo point */
  T.P = (p) => T.S((p) => { window.__sim.renderNow(); const o = window.__sim._ux.gizmo.project(p, {}); return [Math.round(o.x), Math.round(o.y)]; }, p);
  /** ball, up and down arrow centres on screen */
  T.handles = () => T.S(() => {
    const s = window.__sim, u = s._ux, g = u.gizmo; s.renderNow();
    const t = g.root.position, k = g.root.scale.x, P = (dz) => { const o = g.project([t.x, t.y, t.z + dz], {}); return [Math.round(o.x), Math.round(o.y)]; };
    return { ball: P(0), up: P(0.036 * k), down: P(-0.04 * k), scale: k };
  });
  /** gizmo hit kind at a screen point, as a finger would get it */
  T.hit = (x, y) => T.S(([x, y]) => window.__sim._ux.gizmo.hitHandle({ clientX: x, clientY: y, pointerType: 'touch' }), [x, y]);
  T.target = (x, y, z) => T.S(([x, y, z]) => { const u = window.__sim._ux; u.ctl.begin(); u.userSetTarget(x, y, z); }, [x, y, z]);
  return T;
}

/** Mission 01 by hand with the current touch controls (ball, height arrows, Chapadlo), perfect aim. */
async function winM01(T) {
  T.gestures = 0;
  const u0 = await T.ux(), cube = u0.objects.cube, bowl = u0.objects.bowl, z0 = u0.target[2] || u0.tip[2];
  const flow = [];
  const log = async (k) => { const u = await T.ux(); flow.push(k); if (process.env.TOUCH_DEBUG) console.log('  ', k, u.hud, u.target.map((v) => +v.toFixed(3)), u.held, JSON.stringify(await T.S(() => window.__sim._ux.app.camera.position.toArray().map((v) => +v.toFixed(3))))); };
  // 1. ball over the cube (horizontal drag at the current height: aim at "over the cube" at that height)
  let h = await T.handles();
  await T.drag([h.ball, await T.P([cube[0], cube[1], u0.tip[2]])]); await T.adv(1.5);
  await log('ball→cube');
  // 2. down arrow until the jaws are below the cube top (the arrow follows the vertical line under the finger)
  for (let i = 0; i < 4; i++) {
    const u = await T.ux(); if (u.target[2] < 0.022) break;
    h = await T.handles();
    const want = await T.P([u.target[0], u.target[1], 0.019 - 0.04 * h.scale]);
    await T.drag([h.down, want]); await T.adv(1.5); await log('down');
  }
  // 3. close
  const g = await T.S(() => { const r = document.getElementById('ux-grip').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await T.tap(...g); await T.adv(1.2); await log('close');
  // 4. up arrow
  let u = await T.ux(); h = await T.handles();
  await T.drag([h.up, await T.P([u.target[0], u.target[1], 0.11 + 0.036 * h.scale])]); await T.adv(1.5); await log('up');
  // 5. ball over the bowl
  u = await T.ux(); h = await T.handles();
  await T.drag([h.ball, await T.P([bowl[0], bowl[1], u.target[2]])], 12, 40); await T.adv(2); await log('ball→bowl');
  // 6. open
  await T.tap(...g); await log('open');
  let won = false;
  for (let i = 0; i < 8 && !won; i++) { await T.adv(0.5); won = (await T.ux()).won; }
  const run = await T.S(() => window.__sim.run());
  return { won, gestures: T.gestures, flow, auto: run.auto, held: (await T.ux()).held };
}

(async () => {
  const port = await freePort();
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await sleep(800);
  const base = `http://127.0.0.1:${port}/sim/so101/?test=1&detail=low&mise=bowl`;
  const browser = await chromium.launch({ args: ARGS });
  try {
    if (process.env.TOUCH_ONLY !== 'pad') await classic(browser, base);
    if (process.env.TOUCH_ONLY !== 'classic') await trackpad(browser, base);
  } catch (e) { console.log('FAIL exception', e); fails++; }
  await browser.close(); srv.kill();
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK', '— screenshots in', OUT);
  process.exit(fails ? 1 : 0);
})();

/** the classic scheme (IK ball, height arrows) with the touch quick fixes */
async function classic(browser, base) {
  let u, h, run, a;
    // ================= portrait 390×844 =================
    const T = await phone(browser, base, { width: 390, height: 844 });
    ok(await T.S(() => window.__sim._ux.touch), 'phone: coarse pointer detected');
    await T.shot('t2-01-portrait-start');

    // ---- 2: height handles ≥ 44 px and never swallowed by the object under them ----
    u = await T.ux(); const cube = u.objects.cube;
    await T.target(cube[0], cube[1], 0.06); await T.adv(2);
    h = await T.handles();
    const sep = Math.hypot(h.down[0] - h.ball[0], h.down[1] - h.ball[1]);
    ok(sep >= 44, `down arrow ${sep.toFixed(0)} px from the ball centre (≥ 44 px cell)`);
    const around = [];
    for (const [dx, dy] of [[0, 0], [-18, 0], [18, 0], [0, 10]]) around.push(await T.hit(h.down[0] + dx, h.down[1] + dy));
    ok(around.every((k) => k === 'height'), 'down arrow hit ±18 px around its centre: ' + around.join(','));
    const under = await T.S(([x, y]) => { const p = window.__sim._ux.gizmo.pickAt({ clientX: x, clientY: y }); return p && p.name; }, h.down);
    console.log('note: object under the down arrow:', under);
    await T.shot('t2-02-arrow-over-cube');
    // a tap on the down arrow over the cube: no pick, no autopilot
    await T.tap(...h.down); await sleep(500);
    u = await T.ux(); run = await T.S(() => window.__sim.run());
    ok(!u.busy && !run.auto, 'tap on the down arrow over the cube starts no autopilot ' + JSON.stringify({ busy: u.busy, auto: run.auto, hud: u.hud }));
    // a drag on it lowers the target
    const z1 = u.target[2];
    await T.drag([h.down, [h.down[0], h.down[1] + 40]]);
    u = await T.ux();
    ok(u.target[2] < z1 - 0.01 && !u.busy, `drag on the down arrow over the cube lowers the target (${z1.toFixed(3)} → ${u.target[2].toFixed(3)})`);

    // ---- 7: no "Teď sevřete" while the jaws are above the cube top ----
    await T.S(() => window.__sim.reset()); await T.adv(0.5);
    await T.target(cube[0], cube[1], 0.0275); await T.adv(3);
    u = await T.ux();
    ok(!/^Teď sevřete/.test(u.hud) && /níž/.test(u.hud), `tip ${(u.tip[2] * 1000).toFixed(0)} mm (cube top 25 mm): "${u.hud}"`);
    await T.target(cube[0], cube[1], 0.019); await T.adv(2.5);
    u = await T.ux();
    ok(/^Teď sevřete/.test(u.hud), `tip ${(u.tip[2] * 1000).toFixed(0)} mm: "${u.hud}"`);

    // ---- 7: drop → "Kostka vypadla" (the cube is moved out of the closed jaws by the test) ----
    await T.S(() => document.getElementById('ux-grip').click()); await T.adv(1.5);
    await T.target(cube[0], cube[1], 0.09); await T.adv(2);
    u = await T.ux();
    ok(u.held === 'cube', 'grasped and lifted by hand (held ' + u.held + ')');
    await T.S(() => { const w = window.__sim._ux; w.world.place('cube', 0.32, 0.05, 0.0125); w.mj.mj_forward(w.m, w.d); });
    await T.adv(1);
    u = await T.ux();
    ok(/^Kostka vypadla/.test(u.hud), 'drop: HUD says "' + u.hud + '"');
    await T.shot('t2-03-dropped');
    await T.S(() => document.getElementById('ux-grip').click()); await T.adv(1);
    u = await T.ux();
    ok(!/vypadla/.test(u.hud), 'opening the gripper clears the drop line ("' + u.hud + '")');

    // ---- 6: no vertical drag plane on touch (camera nearly level) ----
    await T.S(() => window.__sim.reset()); await T.adv(0.5);
    await T.S(() => window.__sim.cameraNow('side'));
    const dirY = await T.S(() => window.__sim._ux.app.camera.getWorldDirection(new (window.__sim._ux.T.Vector3)()).y);
    u = await T.ux(); await T.target(u.tip[0], u.tip[1], u.tip[2]); await T.adv(0.5);
    h = await T.handles(); u = await T.ux();
    const zs = u.target[2], xy0 = u.target.slice(0, 2);
    await T.drag([h.ball, [h.ball[0] + 30, h.ball[1] - 40]]);
    u = await T.ux();
    ok(Math.abs(u.target[2] - zs) < 1e-4 && Math.hypot(u.target[0] - xy0[0], u.target[1] - xy0[1]) > 0.01,
      `level camera (dir.y ${dirY.toFixed(2)}): a ball drag moves on the table and keeps the height (${zs.toFixed(3)} → ${u.target[2].toFixed(3)})`);

    // ---- 4: no physics pull on touch by default; Nástroje switches it on ----
    await T.S(() => window.__sim.reset()); await T.S(() => window.__sim.cameraNow('orbit')); await T.adv(0.5);
    const lp = await T.S(() => { window.__sim.renderNow(); return window.__sim.linkPoint(1); });
    ok(!!lp, 'a point on the upper arm ' + JSON.stringify(lp));
    if (lp) {
      const cam0 = await T.S(() => window.__sim._ux.app.camera.position.toArray());
      T.gestures++; await T.start(lp.x, lp.y);
      for (let i = 1; i <= 8; i++) { await T.move(lp.x + 6 * i, lp.y - 3 * i); await sleep(30); }
      const mid = await T.S(() => window.__sim.grabState());
      await T.end(); await sleep(300);
      const cam1 = await T.S(() => window.__sim._ux.app.camera.position.toArray());
      ok(!mid.active && Math.hypot(cam1[0] - cam0[0], cam1[1] - cam0[1], cam1[2] - cam0[2]) > 1e-3, 'touch drag on the arm turns the view, no pull ' + JSON.stringify({ pull: mid.active }));
      await T.S(() => { document.getElementById('ux-qtools').click(); });
      await sleep(300);
      const vis = await T.S(() => !!document.getElementById('ux-tpull').offsetParent);
      await T.S(() => document.getElementById('ux-tpull').click());
      ok(vis && await T.S(() => window.__sim._ux.touchPull && document.getElementById('ux-tpull').getAttribute('aria-pressed') === 'true'), 'Nástroje → "Tahat ruku prstem za díl" switches the pull on');
      await T.shot('t2-04-tools-pull');
      await T.S(() => document.getElementById('ux-drawer-x').click()); await sleep(300);
      await T.S(() => window.__sim.cameraNow('orbit'));
      const lp2 = await T.S(() => { window.__sim.renderNow(); return window.__sim.linkPoint(1); });
      await T.start(lp2.x, lp2.y);
      for (let i = 1; i <= 8; i++) { await T.move(lp2.x + 6 * i, lp2.y - 3 * i); await sleep(30); }
      const mid2 = await T.S(() => window.__sim.grabState());
      await T.end();
      ok(mid2.active, 'with the switch on, a drag on the arm pulls it');
      await T.S(() => window.__sim._ux.setTouchPull(false));
    }

    // ---- 5: auto-framing keeps the gripper ≥ 24 px from the side edges ----
    await T.S(() => window.__sim.reset()); await T.S(() => window.__sim.cameraNow('orbit')); await T.adv(0.5);
    const edge = await T.S(() => {
      const u = window.__sim._ux, g = u.gizmo; let best = null;
      for (let x = 0.05; x <= 0.42; x += 0.01) for (let y = -0.35; y <= 0.35; y += 0.01) {
        const q = g.project([x, y, 0.05], {}); if (q.x > 4 && q.x < 16 && q.y > 200 && q.y < 600 && (!best || Math.hypot(x, y) < Math.hypot(best[0], best[1]))) best = [x, y, q.x];
      }
      return best;
    });
    if (edge) {
      await T.target(edge[0], edge[1], 0.05);
      await T.S(() => { window.__sim._ux.cameras.userT = -1e9; });
      await sleep(4000);
      const x = (await T.P([edge[0], edge[1], 0.05]))[0];
      ok(x >= 24, `gripper target put at x = ${edge[2].toFixed(0)} px is framed to x = ${x} px`);
      await T.shot('t2-05-autoframe');
    } else ok(false, 'found no reachable point at the left edge');

    // ---- 5: double tap on the empty table frames gripper + target; a single tap does not ----
    await T.S(() => window.__sim.reset()); await T.S(() => window.__sim.cameraNow('orbit')); await T.adv(0.5);
    // two empty table points far apart: the single tap moves the gripper over its point (missions 01–03), so the
    // double tap goes elsewhere
    const [tbl, tbl1] = await T.S(() => {
      const g = window.__sim._ux.gizmo, out = [];
      for (let y = 560; y > 300; y -= 10) for (let x = 200; x < 370; x += 10) {
        const p = g.pickAt({ clientX: x, clientY: y });
        if (p && p.name === 'table' && !g.hitHandle({ clientX: x, clientY: y, pointerType: 'touch' }) && !window.__sim._ux.links.hit({ clientX: x, clientY: y })
          && (!out.length || Math.hypot(x - out[0][0], y - out[0][1]) > 120)) { out.push([x, y]); if (out.length === 2) return out; }
      }
      return [out[0] || null, null];
    });
    ok(!!tbl && !!tbl1, 'empty table points ' + JSON.stringify([tbl, tbl1]));
    if (tbl && tbl1) {
      await T.tap(...tbl1); await sleep(1200);
      const v1 = await T.S(() => window.__sim._ux.cameras.view);
      ok(v1 === 'orbit', 'a single tap on the table does not move the camera (view ' + v1 + ')');
      // the four touch events are sent without waiting for each ack: at software-GL frame rates every ack waits for
      // a frame, which alone would stretch the two taps past the 350 ms double-tap window
      // the camera may have been re-framed meanwhile: an empty table point again, right before the taps
      const fresh = await T.S((avoid) => {
        const g = window.__sim._ux.gizmo; window.__sim.renderNow();
        for (let y = 600; y > 300; y -= 10) for (let x = 360; x > 40; x -= 10) {
          const p = g.pickAt({ clientX: x, clientY: y });
          if (p && p.name === 'table' && !g.hitHandle({ clientX: x, clientY: y, pointerType: 'touch' }) && !window.__sim._ux.links.hit({ clientX: x, clientY: y }) && Math.hypot(x - avoid[0], y - avoid[1]) > 80) return [x, y];
        }
        return null;
      }, tbl1);
      if (fresh) { tbl[0] = fresh[0]; tbl[1] = fresh[1]; }
      T.gestures += 2;
      await T.S(() => { const g = window.__sim._ux.gizmo, ou = g.onUp.bind(g); window.__dbg = []; g.onUp = (e, c) => { window.__dbg.push([e.pointerType, e.timeStamp | 0, JSON.stringify(g.down), !!g.tableTap, !!g.drag, !!g.pend, !!window.__sim._ux.links.drag]); return ou(e, c); }; });
      const tps = [{ x: tbl[0], y: tbl[1], id: 1 }];
      await Promise.all([T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tps }), T.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
        T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tps }), T.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })]);
      await sleep(1500);
      const v = await T.S(() => window.__sim._ux.cameras.view);
      ok(v === 'fit', 'double tap on the table frames the work (view ' + v + ')');
      if (v !== 'fit') console.log('debug', JSON.stringify(await T.S(() => window.__dbg)));
      await T.shot('t2-06-doubletap-frame');
    }

    // ---- gestures to win M01 by hand with these controls (perfect aim) ----
    await T.S(() => window.__sim.reset()); await T.S(() => window.__sim.cameraNow('orbit')); await T.adv(0.5);
    const w = await winM01(T);
    ok(w.won && !w.auto, `M01 by hand with touch: ${w.won ? 'won' : 'not won'} in ${w.gestures} gestures (${w.flow.join(', ')}), autopilot ${w.auto}`);
    await T.shot('t2-07-m01-win');
    await T.ctx.close();

    // ================= landscape 844×390 =================
    const L = await phone(browser, base, { width: 844, height: 390 });
    await L.shot('t2-10-landscape-start');
    const lay = await L.S(() => {
      const g = document.getElementById('ux-grip').getBoundingClientRect(), r = document.getElementById('reset').getBoundingClientRect();
      const kb = [...document.querySelectorAll('.ux-ab .kbd')].filter((k) => k.offsetParent || getComputedStyle(k).display !== 'none').length;
      return { grip: [Math.round(g.left), Math.round(g.top), Math.round(g.right), Math.round(g.bottom)], resetRight: Math.round(r.right), vw: innerWidth, vh: innerHeight, kbd: kb };
    });
    ok(lay.grip[2] >= lay.vw - 16 && lay.grip[3] >= lay.vh - 16 && lay.resetRight <= lay.grip[0] + 1, 'landscape: Chapadlo at the bottom right, the bar to its left ' + JSON.stringify(lay));
    ok(lay.kbd === 0, 'landscape touch: no key-caps in the action bar');
    u = await L.ux();
    await L.target(u.objects.cube[0], u.objects.cube[1], 0.06); await L.adv(2);
    h = await L.handles();
    const lsep = Math.hypot(h.down[0] - h.ball[0], h.down[1] - h.ball[1]);
    const lh = [];
    for (const [dx, dy] of [[0, 0], [-18, 0], [18, 0], [0, 10]]) lh.push(await L.hit(h.down[0] + dx, h.down[1] + dy));
    ok(lsep >= 44 && lh.every((k) => k === 'height'), `landscape: down arrow ${lsep.toFixed(0)} px from the ball, hit ±18 px: ${lh.join(',')}`);
    await L.shot('t2-11-landscape-handles');
    await L.S(() => window.__sim.reset()); await L.adv(0.5);
    const wl = await winM01(L);
    ok(wl.won && !wl.auto, `landscape M01 by hand: ${wl.won ? 'won' : 'not won'} in ${wl.gestures} gestures (${wl.flow.join(', ')})`);
    await L.shot('t2-12-landscape-win');
    await L.ctx.close();
}

// ---------------- trackpad scheme (?touch=pad, src/ui/touchpad.js) ----------------

/** one-finger drag by (dx, dy) px from `from` in `ms` (event timestamps set, so the finger speed is real) */
async function padDrag(T, from, dx, dy, ms, steps = 10) {
  T.gestures++;
  const t0 = Date.now() / 1000, tp = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(from[0], from[1]), timestamp: t0 });
  for (let k = 1; k <= steps; k++) {
    await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(from[0] + dx * k / steps, from[1] + dy * k / steps), timestamp: t0 + ms / 1000 * k / steps });
  }
  // Chromium holds the last touch move for the next frame: repeat it so it is delivered before the finger lifts
  await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(from[0] + dx, from[1] + dy), timestamp: t0 + ms / 1000 + 0.005 });
  await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + ms / 1000 + 0.01 });
  await sleep(250);   // touch moves are dispatched without waiting: let the last ones land
}
/** finger px that move the gripper by (d0, d1) m at gain k mm/px (inverse of src/touch.js tableDelta) */
async function fingerFor(T, d0, d1, k) {
  const f = await T.S(() => { const a = window.__sim._ux.app, c = a.camera.position, t = a.controls.target; return [t.x - c.x, -(t.z - c.z)]; });
  const L = Math.hypot(f[0], f[1]), ux = f[0] / L, uy = f[1] / L, m = k / 1000;
  return [(uy * d0 - ux * d1) / m, (-ux * d0 - uy * d1) / m];
}
const rectOf = (T, sel) => T.S((s) => { const e = document.querySelector(s); if (!e || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); }, sel);
const overlap = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** a free spot of the scene to start finger drags (not on the rail, strip, side view, camera chip or bar) */
async function padSpot(T) {
  return T.S(() => {
    const st = document.querySelector('.stage').getBoundingClientRect(), no = ['.ux-rail', '.ux-wstrip', '.ux-side', '.ux-cam', '.ux-under', '.ux-top', '.ux-edge']
      .map((s) => document.querySelector(s)).filter((e) => e && e.offsetParent).map((e) => e.getBoundingClientRect());
    const ok = (x, y) => no.every((r) => x < r.left - 70 || x > r.right + 70 || y < r.top - 70 || y > r.bottom + 70);
    let best = null;
    for (let y = st.top + 60; y < st.bottom - 60; y += 10) for (let x = st.left + 60; x < st.right - 60; x += 10) {
      if (!ok(x, y)) continue;
      const d = Math.hypot(x - (st.left + st.right) / 2, y - (st.top + st.bottom) / 2);
      if (!best || d < best[2]) best = [x, y, d];
    }
    return best && [best[0], best[1]];
  });
}
/** move the gripper over a table point (x, y) with trackpad drags: a fast flick for the bulk, slow corrections */
async function padTo(T, x, y, tol = 0.004, max = 4) {
  for (let i = 0; i < max; i++) {
    const u = await T.ux(), t = u.active ? u.target : u.tip, d0 = x - t[0], d1 = y - t[1], d = Math.hypot(d0, d1);
    if (d < tol) return true;
    const fast = d > 0.03, k = fast ? 1.2 : 0.25;
    let [fx, fy] = await fingerFor(T, d0, d1, k);
    const len = Math.hypot(fx, fy), cap = 220;
    if (len > cap) { fx *= cap / len; fy *= cap / len; }
    const spot = await padSpot(T);
    const from = [spot[0] - fx / 2, spot[1] - fy / 2];
    await padDrag(T, from, fx, fy, fast ? Math.max(40, len / 4) : Math.max(300, len * 12), fast ? 6 : 12);
    await T.adv(0.6);
  }
  const u = await T.ux(), t = u.target;
  return Math.hypot(x - t[0], y - t[1]) < tol;
}
/** rail drags until the target height is z (m), from the top part of the track */
async function railTo(T, z, tol = 0.001, max = 4) {
  for (let i = 0; i < max; i++) {
    const u = await T.ux(), cur = u.active ? u.target[2] : u.tip[2];
    if (Math.abs(cur - z) < tol) return true;
    const r = await rectOf(T, '.ux-rail-t'), dy = (cur - z) / 0.0004, room = r[3] - r[1] - 12;
    const step = Math.max(-room, Math.min(room, dy)), y0 = step > 0 ? r[1] + 6 : r[3] - 6;
    await padDrag(T, [(r[0] + r[2]) / 2, y0], 0, step, Math.max(300, Math.abs(step) * 6), 12);
    await T.adv(0.3);
  }
  const u = await T.ux(); return Math.abs(u.target[2] - z) < tol;
}
async function gripTap(T) { const g = await rectOf(T, '#ux-grip'); await T.tap((g[0] + g[2]) / 2, (g[1] + g[3]) / 2); }

/** Mission 01 by hand with the trackpad: select, pad over the cube, rail to the grasp detent, close, rail up, pad
 *  over the bowl, open. Perfect aim; counts every touch gesture. */
async function padWinM01(T) {
  T.gestures = 0;
  const flow = [], u0 = await T.ux(), cube = u0.objects.cube, bowl = u0.objects.bowl;
  const c = await T.P(cube); await T.tap(...c); flow.push('tap cube');
  await padTo(T, cube[0], cube[1]); flow.push('pad→cube');
  const det = await T.S(() => window.__sim._ux.pad.heights('cube'));
  await railTo(T, det[0]); await T.adv(1.5); flow.push('rail→grasp');
  await gripTap(T); await T.adv(1.2); flow.push('close' + ((await T.ux()).held ? '' : ' (missed)'));
  await railTo(T, 0.10, 0.004); await T.adv(1.5); flow.push('rail up');
  await padTo(T, bowl[0], bowl[1], 0.01); await T.adv(1.5); flow.push('pad→bowl');
  await gripTap(T); flow.push('open');
  let won = false;
  for (let i = 0; i < 8 && !won; i++) { await T.adv(0.5); won = (await T.ux()).won; }
  const run = await T.S(() => window.__sim.run());
  return { won, gestures: T.gestures, flow, auto: run.auto, assisted: run.assisted };
}

async function trackpad(browser, base) {
  for (const [vp, tag] of [[{ width: 390, height: 844 }, 'portrait'], [{ width: 844, height: 390 }, 'landscape']]) {
    const T = await phone(browser, base + '&touch=pad', vp);
    const p0 = await T.S(() => window.__sim.pad());
    ok(p0.chosen && p0.on, `${tag} pad: ?touch=pad turns the trackpad on ` + JSON.stringify(p0));
    const hint = await T.page.waitForFunction(() => window.__sim.pad().hint, null, { timeout: 15000 }).then(() => true).catch(() => false);
    ok(hint, `${tag} pad: first-play ghost hand is shown`);
    await T.shot(`t2-2${tag === 'portrait' ? 0 : 5}-pad-${tag}-start`);
    await sleep(1500);
    // ---- layout: rail, strip, buttons ≥ 44 px, nothing on top of each other ----
    const R = {};
    for (const [k, s] of [['rail', '.ux-rail'], ['up', '.ux-rail-up'], ['dn', '.ux-rail-dn'], ['strip', '.ux-wstrip'], ['side', '.ux-side'], ['cam', '.ux-cam'], ['bar', '.ux-abar'], ['grip', '#ux-grip'], ['edge', '.ux-edge'], ['top', '.ux-top']]) R[k] = await rectOf(T, s);
    const vw = vp.width, vh = vp.height;
    const sizes = R.up && R.dn && R.strip && R.rail && R.up[3] - R.up[1] >= 44 && R.dn[3] - R.dn[1] >= 44 && R.rail[2] - R.rail[0] >= 44 && R.strip[3] - R.strip[1] >= 44;
    const clash = [['rail', 'strip'], ['rail', 'side'], ['rail', 'cam'], ['rail', 'bar'], ['rail', 'edge'], ['rail', 'top'], ['strip', 'side'], ['strip', 'cam'], ['strip', 'bar'], ['side', 'top'], ['cam', 'top']]
      .filter(([a, b]) => overlap(R[a], R[b])).map((x) => x.join('/'));
    ok(sizes && !clash.length && R.rail[2] <= vw - 16 && R.strip[3] <= (tag === 'portrait' ? R.bar[1] : vh), `${tag} pad: rail + strip ≥ 44 px, no overlaps ${clash.join(',')} ` + JSON.stringify({ rail: R.rail, strip: R.strip, grip: R.grip }));
    if (tag === 'landscape') ok(R.grip[2] >= vw - 16 && R.rail[1] < R.grip[1] && R.rail[3] <= R.grip[1] && R.rail[0] > vw * 0.75, 'landscape pad: rail in the right column above Chapadlo');

    let u = await T.ux(); const cube = u.objects.cube;
    // ---- tap on an object = select it (no autopilot) ----
    const cp = await T.P(cube); await T.tap(...cp); await sleep(400);
    let st = await T.S(() => ({ pad: window.__sim.pad(), ux: window.__sim.ux(), run: window.__sim.run(), side: window.__sim.sideState().name }));
    ok(st.pad.sel === 'cube' && !st.ux.busy && !st.run.auto, `${tag} pad: tap on the cube selects it, no autopilot ` + JSON.stringify({ sel: st.pad.sel, busy: st.ux.busy, auto: st.run.auto, side: st.side }));
    // ---- one finger: slow = 0.25 mm/px, fast = 1.2 mm/px, on the table, relative to the camera ----
    const spot = await padSpot(T);
    u = await T.ux(); const a0 = u.active ? u.target : u.tip;
    await padDrag(T, spot, 0, -80, 1000, 16);   // 80 px upwards in 1 s = 80 px/s
    u = await T.ux(); const a1 = u.target;
    const slow = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) * 1000;
    const f = await T.S(() => { const a = window.__sim._ux.app, c = a.camera.position, t = a.controls.target; const L = Math.hypot(t.x - c.x, t.z - c.z); return [(t.x - c.x) / L, -(t.z - c.z) / L]; });
    const awayMm = ((a1[0] - a0[0]) * f[0] + (a1[1] - a0[1]) * f[1]) * 1000;
    ok(Math.abs(slow - 20) < 3 && awayMm > 17 && Math.abs(a1[2] - a0[2]) < 1e-3, `${tag} pad: slow 80 px drag up = ${slow.toFixed(1)} mm (${awayMm.toFixed(1)} mm away from the camera; 0.25 mm/px), height ${(a0[2] * 1000).toFixed(1)} → ${(a1[2] * 1000).toFixed(1)} mm`);
    await padDrag(T, spot, 0, 80, 60, 6);       // 80 px in 60 ms
    u = await T.ux(); const a2 = u.target;
    const fast = Math.hypot(a2[0] - a1[0], a2[1] - a1[1]) * 1000;
    ok(fast > 55 && fast <= 96.5, `${tag} pad: fast 80 px flick = ${fast.toFixed(1)} mm (ballistic gain, ≤ 1.2 mm/px)`);
    // ---- rail: relative 0.4 mm/px, detent at the grasp height, readout follows the thumb; ▲ = +1 cm ----
    await T.target(cube[0], cube[1], 0.06); await T.adv(1.5);
    const det = await T.S(() => window.__sim._ux.pad.heights('cube'));
    const r = await rectOf(T, '.ux-rail-t');
    const t0 = Date.now() / 1000, x = (r[0] + r[2]) / 2, y0 = r[1] + 10, want = (0.06 - det[0]) / 0.0004 - 2;
    T.gestures++;
    await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }], timestamp: t0 });
    for (let k = 1; k <= 11; k++) await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + want * Math.min(k, 10) / 10, id: 1 }], timestamp: t0 + 0.05 * k });
    await sleep(300);
    const mid = await T.S(() => { const e = document.querySelector('.ux-rail-r'); return { txt: e.textContent, on: e.classList.contains('on'), top: Math.round(e.getBoundingClientRect().top) }; });
    await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.6 });
    await sleep(300);
    // the last move is delivered with the lift (Chromium holds it for the next frame): its text stays after the lift
    mid.txt = await T.S(() => document.querySelector('.ux-rail-r').textContent);
    u = await T.ux();
    ok(Math.abs(u.target[2] - det[0]) < 1e-6 && mid.on && /úchop/.test(mid.txt) && Math.abs(mid.top - (y0 + want - 12)) < 20, `${tag} pad: rail drag snaps to the grasp detent ${(det[0] * 1000).toFixed(1)} mm, readout "${mid.txt}" at the thumb`);
    await T.shot(`t2-2${tag === 'portrait' ? 1 : 6}-pad-${tag}-rail`);
    const up = await rectOf(T, '.ux-rail-up'); await T.tap((up[0] + up[2]) / 2, (up[1] + up[3]) / 2); await sleep(300);
    const zu = (await T.ux()).target[2];
    ok(Math.abs(zu - det[0] - 0.01) < 1e-6, `${tag} pad: ▲ on the rail = +1 cm (${(zu * 1000).toFixed(1)} mm)`);
    // ---- wrist strip: 0.5°/px, "Lícuje ✓" within 3° of the cube's faces ----
    const al = await T.S(() => { const u = window.__sim._ux; return { a: u.pad.alignment('cube'), roll: u.ctl.roll * 180 / Math.PI }; });
    const sr = await rectOf(T, '.ux-wstrip'), sx = (sr[0] + sr[2]) / 2, sy = (sr[1] + sr[3]) / 2;
    const off = (r) => ((r - al.a.roll) % 90 + 135) % 90 - 45;   // jaw misalignment (deg) at roll r
    // first away from square (20°), then back by the measured amount
    const away = (20 - off(al.roll)) / 0.5;
    await padDrag(T, [sx - away / 2, sy], away, 0, 400, 8);
    const s0 = await T.S(() => ({ roll: window.__sim._ux.ctl.roll * 180 / Math.PI, ok: !document.querySelector('.ux-wstrip-ok').hidden }));
    ok(!s0.ok && Math.abs(off(s0.roll)) > 10, `${tag} pad: strip 0.5°/px turns the wrist (${off(s0.roll).toFixed(1)}° off square, no "Lícuje")`);
    const need = -off(s0.roll) / 0.5 + 2;   // 1° past square: the magnet takes it
    await padDrag(T, [sx - need / 2, sy], need, 0, 600, 12);
    await sleep(400);
    const s1 = await T.S(() => ({ roll: window.__sim._ux.ctl.roll * 180 / Math.PI, ok: !document.querySelector('.ux-wstrip-ok').hidden, txt: document.querySelector('.ux-wstrip').textContent.replace(/\s+/g, ' ').trim() }));
    const mis = Math.abs(((s1.roll - al.a.roll) % 90 + 135) % 90 - 45);
    ok(s1.ok && mis < 0.5, `${tag} pad: wrist strip squares the jaws to the cube ("${s1.txt}", ${mis.toFixed(2)}° off)`);
    await T.shot(`t2-2${tag === 'portrait' ? 2 : 7}-pad-${tag}-wrist`);
    // ---- two fingers = camera (target unchanged) ----
    u = await T.ux(); const tg = u.target.slice();
    const d0 = await T.S(() => window.__sim._ux.app.controls.getDistance());
    const sp = await padSpot(T);
    await T.two([sp[0] - 30, sp[1]], [sp[0] + 30, sp[1]], [sp[0] - 90, sp[1]], [sp[0] + 90, sp[1]]); await sleep(600);
    const d1 = await T.S(() => window.__sim._ux.app.controls.getDistance());
    u = await T.ux();
    ok(Math.abs(d1 - d0) > 0.02 && Math.hypot(u.target[0] - tg[0], u.target[1] - tg[1]) < 0.002, `${tag} pad: pinch zooms (${d0.toFixed(2)} → ${d1.toFixed(2)} m), the gripper stays`);
    // ---- M01 by hand with the trackpad ----
    await T.S(() => { window.__sim.reset(); window.__sim.cameraNow('orbit'); }); await T.adv(0.5);
    const w = await padWinM01(T);
    ok(w.won && !w.auto && !w.assisted, `${tag} pad: M01 by hand with the trackpad: ${w.won ? 'won' : 'not won'} in ${w.gestures} gestures (${w.flow.join(', ')}), autopilot ${w.auto}`);
    await T.shot(`t2-2${tag === 'portrait' ? 3 : 8}-pad-${tag}-win`);
    await T.ctx.close();
  }
  // ---- mission 05 keeps its absolute finger trace on the paper ----
  const D = await phone(browser, base.replace('mise=bowl', 'mise=trace') + '&touch=pad', { width: 390, height: 844 });
  const dp = await D.S(() => ({ pad: window.__sim.pad(), rail: !document.querySelector('.ux-rail').hidden }));
  const pp = await D.P([0.215, 0.0, 0.0]);
  await D.drag([pp, [pp[0] + 30, pp[1] + 10]]); await sleep(300);
  const ds = await D.S(() => window.__sim.drawState());
  const want = await D.S(([x, y]) => window.__sim._ux.gizmo.tablePoint({ clientX: x, clientY: y }), [pp[0] + 30, pp[1] + 10]);
  ok(dp.pad.chosen && !dp.pad.on && !dp.rail && ds.active && Math.hypot(ds.goal[0] - want[0], ds.goal[1] - want[1]) < 0.003, 'pad: mission 05 keeps the absolute finger trace ' + JSON.stringify({ on: dp.pad.on, goal: ds.goal.map((v) => +v.toFixed(3)), want: want.map((v) => +v.toFixed(3)) }));
  await D.shot('t2-29-pad-m05');
  await D.ctx.close();
}
