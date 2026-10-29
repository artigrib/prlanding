// End-to-end: an AI linked through "Připojit AI" keeps working while the sim tab is in the background.
// Local relay (backend/bridge) + official MCP client SDK, like tests/agent-e2e.mjs, but the page's own frame loop
// runs for real (no pumped time): in a hidden tab requestAnimationFrame stops and core.js steps physics from a
// worker ticker (ArmSim.syncBg / bgTick) while the AI session is paired.
//   (cd backend/bridge && npm ci)   # once
//   node sim/so101/tests/agent-bg.mjs
// Part A (Playwright): document.hidden faked + visibilitychange; rAF keeps firing there, so it also proves that the
//   two drivers never step physics twice. Part B: a REAL background tab. Playwright keeps every page it controls
//   "visible" (focus emulation), so part B drives Chromium over plain CDP: a second tab is activated in front.
// Both parts: move_joints completes with the right pose, check_mission advances, snapshot works; part B solves
// mission 01 entirely in the background. CPU (all browser processes) of the hidden tab must not exceed the visible.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { solveBowl } from './agent-script.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BRIDGE = path.join(ROOT, 'backend/bridge');
let chromium, Client, StreamableHTTPClientTransport;
try {
  ({ chromium } = require('playwright'));
  ({ Client, StreamableHTTPClientTransport } = createRequire(path.join(BRIDGE, 'package.json'))('@modelcontextprotocol/client'));
} catch (e) {
  console.log('skip: needs playwright and `npm ci` in backend/bridge (' + e.message.split('\n')[0] + ')');
  process.exit(0);
}
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
async function waitHttp(url, sec = 20) {
  for (let i = 0; i < sec * 5; i++) { try { const r = await fetch(url); if (r.ok) return true; } catch (e) { /* not yet */ } await sleep(200); }
  throw new Error('not up: ' + url);
}
/** CPU time (s) of a process and all its descendants (Linux /proc; null elsewhere): renderer + GPU + browser. */
function treeCpu(pid) {
  try {
    const kids = new Map(), cpu = new Map();
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      let st; try { st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'); } catch (e) { continue; }
      const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      const pp = +f[1];
      if (!kids.has(pp)) kids.set(pp, []);
      kids.get(pp).push(+d);
      cpu.set(+d, (+f[11] + +f[12]) / 100);
    }
    let sum = 0;
    const walk = (p) => { sum += cpu.get(p) || 0; for (const k of kids.get(p) || []) walk(k); };
    walk(pid);
    return sum;
  } catch (e) { return null; }
}
async function cpuShare(pid, ms) {
  const a = treeCpu(pid), t = Date.now();
  await sleep(ms);
  const b = treeCpu(pid);
  return a == null || b == null ? null : (b - a) / ((Date.now() - t) / 1000);
}
const fmtCpu = (x) => (x == null ? 'n/a' : (x * 100).toFixed(0) + ' %');
const GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const TARGET = { shoulder_pan: 30, wrist_roll: 40 };

const bport = await freePort(), sport = await freePort();
const bridge = spawn(process.execPath, ['src/main.ts'], {
  cwd: BRIDGE, stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, BRIDGE_DEV: '1', PORT: String(bport), HOST: '127.0.0.1', BRIDGE_HB_S: '10', BRIDGE_SNAPSHOT_DEADLINE_S: '40' }
});
const srv = spawn('python3', ['-m', 'http.server', String(sport), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
const relay = `ws://127.0.0.1:${bport}/tab`;
const SIM = `http://127.0.0.1:${sport}/sim/so101/?test=1&mise=bowl&relay=${encodeURIComponent(relay)}`;
const procs = [];
const cleanup = () => { bridge.kill(); srv.kill(); for (const p of procs) p.kill(); };

async function mcp() {
  const client = new Client({ name: 'agent-bg', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${bport}/mcp`)));
  return client;
}
function tools(client, session) {
  const raw = (name, args = {}) => client.callTool({ name, arguments: { session, ...args } });
  const call = async (name, args) => {
    const r = await raw(name, args);
    if (r.isError) throw new Error(name + ': ' + JSON.stringify(r.structuredContent && r.structuredContent.error));
    return r.structuredContent;
  };
  return { raw, call };
}
const poseOk = (mv) => mv.status === 'completed' && Object.entries(TARGET).every(([j, v]) => Math.abs(mv.final.joints_deg[j] - v) < 2);
const isJpeg = (snap) => {
  const img = snap.content && snap.content.find((c) => c.type === 'image');
  const b = img ? Buffer.from(img.data, 'base64') : Buffer.alloc(0);
  return !snap.isError && b[0] === 0xff && b[1] === 0xd8 && b.length > 3000 ? b.length : 0;
};

try {
  await waitHttp(`http://127.0.0.1:${bport}/healthz`);
  await waitHttp(`http://127.0.0.1:${sport}/sim/so101/`);

  // =============== A: faked hidden (Playwright) ===============
  {
    const browser = await chromium.launch({ args: GL });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails++; });
      await page.goto(SIM);
      await page.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 300000 });
      await page.click('#ai-open');
      const codeEl = page.getByTestId('agent-code');
      await codeEl.filter({ hasText: /^[A-Z]{4}-[A-Z]{4}$/ }).waitFor({ timeout: 20000 });
      const client = await mcp();
      const pending = client.callTool({ name: 'connect', arguments: { code: (await codeEl.textContent()).trim() } });
      await page.getByTestId('agent-allow').click();
      const { call, raw } = tools(client, (await pending).structuredContent.session);
      await page.locator('#ai-panel[data-state=paired]').waitFor();
      ok(/AI pracuje i na pozadí/.test(await page.getByTestId('agent-bar-bg').innerText()), 'bar: "AI pracuje i na pozadí" while paired');
      const bpid = process.pid;   // this test's process tree: the browser, plus the idle relay and file server
      const simRate = async (ms) => {
        const a = await page.evaluate(() => window.__sim._app.sim.d.time), w = Date.now();
        await sleep(ms);
        return ((await page.evaluate(() => window.__sim._app.sim.d.time)) - a) / ((Date.now() - w) / 1000);
      };
      const cpuVis = await cpuShare(bpid, 4000);
      console.log(`     visible: sim time ${(await simRate(5000)).toFixed(2)}× wall time (slow software GL frames here)`);

      const title0 = await page.title();
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      ok(await page.evaluate(() => window.__sim._app.sim.bg === true), 'hidden + AI paired: the background driver takes over');
      // rAF keeps firing here: sim time must still follow wall time once (no double stepping)
      const t0 = (await call('get_state')).sim_time_s, w0 = Date.now();
      await sleep(3000);
      const rate = ((await call('get_state')).sim_time_s - t0) / ((Date.now() - w0) / 1000);
      ok(rate > 0.6 && rate < 1.25, `sim time runs at ${rate.toFixed(2)}× wall time while hidden (no double stepping)`);
      const mvP = call('move_joints', { joints_deg: TARGET, gripper_pct: 40 });
      await sleep(300);
      const title = await page.title();
      const mv = await mvP;
      ok(poseOk(mv), `move_joints completes while hidden: ${mv.status}, pan ${mv.final.joints_deg.shoulder_pan}, roll ${mv.final.joints_deg.wrist_roll}`);
      ok(title.startsWith('● AI ovládá ruku — '), 'tab title marked during the AI motion: ' + title);
      const sm = await call('start_mission', { mission_id: 'bowl' });
      await sleep(1500);
      const cm = await call('check_mission');
      ok(sm.mission.state === 'running' && cm.mission.state === 'running' && cm.mission.elapsed_s >= 1, `check_mission advances while hidden (${cm.mission.elapsed_s} s)`);
      const bytes = isJpeg(await raw('snapshot', { view: 'overview', width: 320 }));
      ok(bytes > 0, `snapshot while hidden: ${bytes} B JPEG`);
      const cpuHid = await cpuShare(bpid, 4000);
      ok(cpuHid == null || cpuHid <= cpuVis, `browser CPU (all processes) hidden ${fmtCpu(cpuHid)} <= visible ${fmtCpu(cpuVis)}`);

      await page.evaluate(() => {
        delete document.hidden; delete document.visibilityState;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      ok(await page.evaluate(() => window.__sim._app.sim.bg === false), 'visible again: back to the rAF loop');
      await sleep(2200);
      ok(await page.title() === title0, 'tab title restored after the motion');
      ok(await simRate(5000) > 0, 'visible again: the rAF loop steps physics');
      await client.close();
    } finally { await browser.close(); }
  }

  // =============== B: a real background tab (plain CDP) ===============
  {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'so101-bg-'));
    const ch = spawn(chromium.executablePath(), ['--headless=new', '--no-sandbox', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + prof, ...GL, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    procs.push(ch);
    const wsUrl = await new Promise((r, j) => {
      ch.stderr.on('data', (b) => { const m = /DevTools listening on (ws:\S+)/.exec(String(b)); if (m) r(m[1]); });
      setTimeout(() => j(new Error('chromium did not start')), 30000);
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => { ws.onopen = r; });
    let seq = 0;
    const pend = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') { console.log('PAGEERROR', m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description); fails++; }
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    };
    const send = (method, params = {}, sessionId) => new Promise((r, j) => {
      const i = ++seq; pend.set(i, (m) => (m.error ? j(new Error(method + ': ' + m.error.message)) : r(m.result)));
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: SIM });
    const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, S);
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, S);
      if (r.exceptionDetails) throw new Error(expr + ': ' + r.exceptionDetails.text);
      return r.result.value;
    };
    const until = async (expr, sec) => { for (let i = 0; i < sec * 10; i++) { const v = await ev(expr); if (v) return v; await sleep(100); } throw new Error('timeout: ' + expr); };
    try {
      await until('!!(window.__sim && (window.__sim.ready || window.__sim.error))', 300);
      await ev("document.getElementById('ai-open').click()");
      const code = await until("(t => /^[A-Z]{4}-[A-Z]{4}$/.test(t) && t)((document.querySelector('[data-testid=agent-code]') || {}).textContent || '')", 20);
      const client = await mcp();
      const pending = client.callTool({ name: 'connect', arguments: { code } });
      await until("(b => b && !b.closest('[hidden]') && (b.click(), true))(document.querySelector('[data-testid=agent-allow]'))", 10);
      const { call, raw } = tools(client, (await pending).structuredContent.session);
      await until("!!document.querySelector('#ai-panel[data-state=paired]')", 10);
      const cpuVis = await cpuShare(ch.pid, 4000);

      const other = await send('Target.createTarget', { url: 'about:blank' });
      await send('Target.activateTarget', { targetId: other.targetId });
      await sleep(300);
      ok(await ev('document.visibilityState') === 'hidden', 'real background tab: document.visibilityState is hidden');
      ok(await ev('window.__sim._app.sim.bg === true'), 'real background tab: the background driver runs');
      const t0 = (await call('get_state')).sim_time_s, w0 = Date.now();
      const mv = await call('move_joints', { joints_deg: TARGET, gripper_pct: 40 });
      ok(poseOk(mv), `move_joints completes in a background tab: ${mv.status}, pan ${mv.final.joints_deg.shoulder_pan}, roll ${mv.final.joints_deg.wrist_roll}`);
      const rate = ((await call('get_state')).sim_time_s - t0) / ((Date.now() - w0) / 1000);
      ok(rate > 0.6 && rate < 1.25, `sim time runs at ${rate.toFixed(2)}× wall time in the background tab`);
      const bytes = isJpeg(await raw('snapshot', { view: 'top', width: 320 }));
      ok(bytes > 0, `snapshot in a background tab: ${bytes} B JPEG`);
      const cpuHid = await cpuShare(ch.pid, 4000);
      ok(cpuHid == null || cpuHid <= cpuVis, `browser CPU (all processes) background ${fmtCpu(cpuHid)} <= visible ${fmtCpu(cpuVis)}`);
      const wait = async (cond, maxSec) => {
        for (let i = 0; i < maxSec * 4; i++) { if (cond((await call('check_mission')).mission)) return true; await sleep(250); }
        return false;
      };
      const lines = [];
      const won = await solveBowl(call, { wait, log: (s) => lines.push(s) });
      ok(won, 'mission 01 solved over MCP entirely in a background tab: ' + JSON.stringify((await call('check_mission')).mission));
      ok(await ev('document.visibilityState') === 'hidden', 'the tab stayed in the background all along');

      // without an AI the hidden tab sleeps as before (no background physics)
      await ev("document.querySelector('[data-testid=agent-disconnect]').click()");
      await sleep(300);
      ok(await ev('window.__sim._app.sim.bg === false'), 'after Odpojit the hidden tab no longer runs physics');
      const d0 = await ev('window.__sim._app.sim.d.time');
      await sleep(1500);
      ok(await ev('window.__sim._app.sim.d.time') === d0, 'sim time stands still in a hidden tab without an AI');
      await send('Target.activateTarget', { targetId });
      await sleep(500);
      ok(await ev('window.__sim._app.sim.d.time') > d0, 'visible again: the rAF loop runs');
      await client.close();
    } finally { ws.close(); ch.kill(); fs.rmSync(prof, { recursive: true, force: true }); }
  }
} catch (e) {
  console.log('FAIL', e.stack || e); fails++;
} finally {
  cleanup();
}
console.log(fails ? `${fails} failure(s)` : 'all ok');
process.exit(fails ? 1 : 0);
