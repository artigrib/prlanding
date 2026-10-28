// Browser test for replays (needs Playwright + a static server at the repo root):
//   python3 -m http.server 8792 &   node sim/arena/tests/replay-e2e.cjs [http://localhost:8792] [shots-dir]
// 1. smoke: menu -> fight -> end -> instant replay -> full replay with every camera, scrub, speeds
// 2. record -> serialize -> load (file import) -> play: same positions at sampled ticks
// 3. size budget: a 3-minute training session serialises to < 300 kB
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://localhost:8792') + '/sim/arena/?debug&halt';
const SHOTS = process.argv[3] || null;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForFunction(() => window.__arena && window.__arena.ready, null, { timeout: 180000 });
  await p.evaluate(() => { window.__arena.halt = true; });
  const shot = async n => { if (SHOTS) { await p.evaluate(() => window.__arena.frame()); await p.screenshot({ path: `${SHOTS}/${n}.png` }); } };
  const run = async (sec, th = 0, tu = 0, fire = false) => p.evaluate(a => window.__arena.sim(...a), [sec, th, tu, fire]);

  // ---------------------------------------------------------------- 1 + 2: a real match with probes
  let st, info;
  for (let attempt = 0; attempt < 5; attempt++) {
    await p.evaluate(() => { const a = window.__arena; a.setup({ robot: 'svrn', opp: 'klepeto', level: 'easy', mode: 'quick' }); a.start(); a.selfPlay('normal'); a.probe = []; });
    await p.waitForTimeout(1200);
    st = await run(3.6);
    for (let i = 0; i < 130 && (st.state === 'fight' || st.state === 'ko'); i++) st = await run(1);
    info = await p.evaluate(() => { const r = window.__arena.rec; return { ticks: r.length, dur: r.duration, events: r.events.length, kinds: [...new Set(r.events.map(e => e.type))], mem: r.bytes() }; });
    console.log('match', JSON.stringify({ state: st.state, result: st.result, left: st.left }), 'recording', JSON.stringify(info));
    if (info.ticks > 600) break;
    if (st.state === 'replay') await p.evaluate(() => window.__arena.skipReplay());
  }
  assert(info.ticks > 300, 'recorded ticks');
  // KO -> instant replay opens automatically (or decision -> end screen)
  if (st.state === 'replay') { await shot('r1-instant'); await p.evaluate(() => window.__arena.skipReplay()); }
  await p.waitForTimeout(400);
  st = await p.evaluate(() => window.__arena.state());
  assert(st.state === 'end', 'end after replay: ' + st.state);
  await p.evaluate(() => window.__arena.frame()); await shot('r2-end');
  const btns = await p.evaluate(() => ({ hit: !document.getElementById('replay-btn').hidden, full: !document.getElementById('full-btn').hidden }));
  assert(btns.full, 'full replay button');

  // serialise, then compare the decoded file against live probe positions
  const bytes = await p.evaluate(() => window.__arena.exportReplay());
  console.log('file', Math.round(bytes.length / 1024), 'kB');
  const cmp = await p.evaluate(async bytes => {
    const a = window.__arena, probe = a.probe.slice();
    await a.playReplayFile(new File([new Uint8Array(bytes)], 'test.prreplay'));
    const pb = a.rui.playback; pb.playing = false;
    let worst = 0, n = 0;
    for (let i = 0; i < probe.length; i += 37) {
      const [k, x, y, z, ox, oy, oz] = probe[i];
      pb.seek(k / 30);
      const P = a.player.root.position, O = a.ai.root.position;
      worst = Math.max(worst, Math.abs(P.x - x), Math.abs(P.y - y), Math.abs(P.z - z), Math.abs(O.x - ox), Math.abs(O.y - oy), Math.abs(O.z - oz));
      n++;
    }
    return { worst, n, state: a.state().state, title: document.getElementById('rp-title').textContent };
  }, bytes);
  console.log('file playback vs live', JSON.stringify(cmp));
  assert(cmp.n > 20 && cmp.worst < 0.002, 'positions match after serialise/load: ' + cmp.worst);
  await p.evaluate(() => { const pb = window.__arena.rui.playback; pb.seek(pb.t0 + 20); pb.playing = true; window.__arena.rui.tick(0.016); });
  await p.evaluate(() => { const a = window.__arena; for (let i = 0; i < 30; i++) { a.rui.tick(1 / 30); a.frame(); } });
  await shot('r3-file');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  st = await p.evaluate(() => window.__arena.state());
  assert(st.state === 'menu', 'file replay closes to menu: ' + st.state);

  // ---------------------------------------------------------------- full-match replay UI: cameras, speeds, scrub
  await p.evaluate(() => { const a = window.__arena; a.setup({ robot: 'klepeto', opp: 'vert150', level: 'normal', mode: 'quick' }); a.start(); a.selfPlay('normal'); });
  await p.waitForTimeout(1200);
  st = await run(3.6);
  for (let i = 0; i < 25 && st.state === 'fight'; i++) st = await run(1);
  await p.evaluate(() => { const a = window.__arena; if (a.state().state === 'fight') a.pause(true); });
  await p.waitForTimeout(200);
  const pauseBtn = await p.evaluate(() => !document.getElementById('last-btn').hidden);
  if (pauseBtn) {
    await p.click('#last-btn');
    await p.waitForTimeout(200);
    const ui = await p.evaluate(() => ({ s: window.__arena.state().state, t: document.getElementById('rp-title').textContent }));
    assert(ui.s === 'replay', 'replay from pause');
    for (const cam of ['Režisér', 'TV přenos', 'Za robotem', 'Shora', 'Z robota', 'Volná']) {
      const now = await p.evaluate(() => document.querySelector('#rp-cam span').textContent);
      if (now !== cam) { await p.click('#rp-cam'); }
      await p.evaluate(() => { const a = window.__arena; for (let i = 0; i < 20; i++) { a.rui.tick(1 / 30); a.frame(); } });
      if (SHOTS) await shot('r4-cam-' + (await p.evaluate(() => window.__arena.rui.cam)));
    }
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#rp-save')]);
    assert(/\.prreplay$/.test(dl.suggestedFilename()), 'save downloads a .prreplay: ' + dl.suggestedFilename());
    if (await p.evaluate(() => !document.getElementById('rp-clip').hidden)) {
      await p.click('#rp-clip');
      for (let i = 0; i < 20; i++) { await p.evaluate(() => { const a = window.__arena; a.rui.tick(1 / 30); a.frame(); }); await p.waitForTimeout(40); }
      const [clipDl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#rp-clip')]);
      const path = await clipDl.path(), size = require('fs').statSync(path).size;
      console.log('clip', clipDl.suggestedFilename(), size, 'bytes');
      assert(/\.webm$/.test(clipDl.suggestedFilename()) && size > 1000, 'clip webm');
    } else console.log('note: clip unsupported in this browser');
    await p.click('#rp-speed button:nth-child(1)');
    await p.fill('#rp-scrub', '500');
    await p.dispatchEvent('#rp-scrub', 'input');
    const mid = await p.evaluate(() => window.__arena.rui.playback.progress());
    assert(Math.abs(mid - 0.5) < 0.02, 'scrub to middle: ' + mid);
    await p.click('#skip');
    await p.waitForTimeout(200);
    st = await p.evaluate(() => window.__arena.state());
    assert(st.state === 'paused', 'back to pause after replay: ' + st.state);
    await p.click('#resume');
    st = await run(1, 1, 0.2);
    assert(st.state === 'fight' || st.state === 'ko' || st.state === 'replay' || st.state === 'end', 'match continues after replay: ' + st.state);
  } else console.log('note: pause replay button hidden (match ended early)');

  // ---------------------------------------------------------------- 3: size budget, 3 minutes of training
  await p.evaluate(() => { const a = window.__arena; a.setup({ robot: 'svrn', opp: 'kosa', mode: 'training' }); a.start(); a.selfPlay('hard'); });
  await p.waitForTimeout(1000);
  await run(3.6);
  for (let i = 0; i < 36; i++) await run(5, 1, Math.sin(i) * 0.6, i % 3 === 0);
  const big = await p.evaluate(async () => { const a = window.__arena; const b = await a.exportReplay(); return { kb: b.length / 1024, sec: a.rec.duration, mem: a.rec.bytes() / 1024 }; });
  console.log('3-minute training', JSON.stringify(big));
  assert(big.sec >= 175, 'recorded 3 minutes');
  assert(big.kb < 300, 'size budget < 300 kB: ' + big.kb);

  console.log('errors', JSON.stringify(errors));
  assert(!errors.length, 'no page errors');
  await browser.close();
  console.log('replay e2e: OK');
})().catch(e => { console.error(e); process.exit(1); });
