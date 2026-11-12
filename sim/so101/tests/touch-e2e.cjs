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
  T.tap = async (x, y) => { T.gestures++; await T.start(x, y); await sleep(40); await T.end(); };
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
    // ================= portrait 390×844 =================
    const T = await phone(browser, base, { width: 390, height: 844 });
    ok(await T.S(() => window.__sim._ux.touch), 'phone: coarse pointer detected');
    await T.shot('t2-01-portrait-start');

    // ---- 2: height handles ≥ 44 px and never swallowed by the object under them ----
    let u = await T.ux(); const cube = u.objects.cube;
    await T.target(cube[0], cube[1], 0.06); await T.adv(2);
    let h = await T.handles();
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
    u = await T.ux(); let run = await T.S(() => window.__sim.run());
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
  } catch (e) { console.log('FAIL exception', e); fails++; }
  await browser.close(); srv.kill();
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK', '— screenshots in', OUT);
  process.exit(fails ? 1 : 0);
})();
