// End-to-end: "Připojit AI" against a LOCAL relay (backend/bridge), a headless sim tab and the official
// MCP client SDK. Pairs through the panel (code + Allow), calls the tools over MCP, completes mission 01.
//   (cd backend/bridge && npm ci)   # once: the relay + @modelcontextprotocol/client
//   node sim/so101/tests/agent-e2e.mjs [screenshot-dir]
// Needs Playwright (Chromium; software GL is fine). The page's own frame loop is paused and simulated time
// is pumped from the test (like tests/e2e.cjs), so the result does not depend on the frame rate.
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
const OUT = process.argv[2] || path.join(os.tmpdir(), 'so101-agent');
fs.mkdirSync(OUT, { recursive: true });
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

const bport = await freePort(), sport = await freePort();
const bridge = spawn(process.execPath, ['src/main.ts'], {
  cwd: BRIDGE, stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, BRIDGE_DEV: '1', PORT: String(bport), HOST: '127.0.0.1', BRIDGE_HB_S: '10', BRIDGE_SNAPSHOT_DEADLINE_S: '40' }
});
const srv = spawn('python3', ['-m', 'http.server', String(sport), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const cleanup = async () => { await browser.close().catch(() => {}); bridge.kill(); srv.kill(); };

try {
  await waitHttp(`http://127.0.0.1:${bport}/healthz`);
  await waitHttp(`http://127.0.0.1:${sport}/sim/so101/`);
  const relay = `ws://127.0.0.1:${bport}/tab`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails++; });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('console.error', m.text()); });
  await page.goto(`http://127.0.0.1:${sport}/sim/so101/?test=1&mise=bowl&relay=${encodeURIComponent(relay)}`);
  await page.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 300000 });
  ok(await page.evaluate(() => !!window.so101 && window.so101.version === 1 && window.so101.tools.length === 12), 'window.so101 page API present');
  // pump simulated time from here on (the rAF loop is slow with software GL)
  await page.evaluate(() => { window.__sim._app.sim.paused = true; window.__pump = setInterval(() => window.__sim.advance(1 / 20), 20); });

  // ---- pairing through the panel ----
  await page.click('#ai-open');
  const codeEl = page.getByTestId('agent-code');
  await codeEl.filter({ hasText: /^[A-Z]{4}-[A-Z]{4}$/ }).waitFor({ timeout: 20000 });
  const code = (await codeEl.textContent()).trim();
  ok(/printedrobotics https:\/\/mcp\.printedrobotics\.cz\/mcp/.test(await page.locator('.ai-cmd').first().textContent()), 'setup shows the claude mcp add command');
  ok((await page.locator('.ai-say').first().textContent()).includes(code), 'setup shows the sentence with the code');
  await page.screenshot({ path: path.join(OUT, 'agent-waiting.png') }).catch(() => {});

  const client = new Client({ name: 'agent-e2e', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${bport}/mcp`)));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  ok(tools.includes('move_to') && tools.includes('snapshot') && tools.includes('start_mission'), 'MCP tools listed: ' + tools.length);
  const pending = client.callTool({ name: 'connect', arguments: { code } });
  await page.getByTestId('agent-allow').waitFor({ timeout: 10000 });
  ok((await page.locator('#ai-ask-h').textContent()).includes('agent-e2e'), 'Allow prompt names the client');
  await page.screenshot({ path: path.join(OUT, 'agent-allow.png') }).catch(() => {});
  await page.getByTestId('agent-allow').click();
  const con = await pending;
  ok(!con.isError, 'connect after Allow');
  const session = con.structuredContent.session;
  await page.locator('#ai-panel[data-state=paired]').waitFor();
  ok(await page.locator('.ai-bar').isVisible(), 'STOP / Odpojit bar visible over the 3D view');

  const raw = (name, args = {}) => client.callTool({ name, arguments: { session, ...args } });
  const call = async (name, args) => {
    const r = await raw(name, args);
    if (r.isError) { const e = new Error(name + ': ' + JSON.stringify(r.structuredContent && r.structuredContent.error)); e.result = r; throw e; }
    return r.structuredContent;
  };

  // ---- tools ----
  const st = await call('get_state');
  ok(Math.abs(st.joints_deg.shoulder_lift - -57.3) < 2 && st.mission.id === 'bowl', 'get_state in degrees, mission bowl');
  const mv = await call('move_joints', { joints_deg: { shoulder_pan: 25 }, duration_s: 0.6 });
  ok(mv.status === 'completed' && Math.abs(mv.final.joints_deg.shoulder_pan - 25) < 2, 'move_joints completes');
  const bad = await raw('move_joints', { joints_deg: { shoulder_lift: 60, elbow_flex: 40, wrist_flex: 60 } });
  ok(bad.isError && bad.structuredContent.error.code === 'WORKSPACE_VIOLATION', 'workspace box enforced in the tab: ' + (bad.structuredContent.error || {}).code);
  for (const view of ['overview', 'wrist']) {
    const snap = await raw('snapshot', { view, width: 320 });
    const img = snap.content.find((c) => c.type === 'image');
    const bytes = img ? Buffer.from(img.data, 'base64') : Buffer.alloc(0);
    ok(!snap.isError && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.length > 3000, `snapshot ${view}: ${bytes.length} B JPEG`);
    if (img) fs.writeFileSync(path.join(OUT, `snap-${view}.jpg`), bytes);
    await sleep(1100);
  }
  // STOP in the page latches: motion refused until the person releases it
  await page.getByTestId('agent-bar-stop').click();
  const est = await raw('home');
  ok(est.isError && est.structuredContent.error.code === 'ESTOP_ACTIVE', 'STOP in the page blocks motion');
  ok((await call('get_state')).safety === 'estop', 'get_state reports estop');
  await page.getByTestId('agent-bar-stop').click();

  // ---- mission 01 through the tools ----
  const wait = async (cond, maxSec) => {
    for (let i = 0; i < maxSec * 4; i++) { if (cond((await call('check_mission')).mission)) return true; await sleep(250); }
    return false;
  };
  const lines = [];
  const won = await solveBowl(call, { wait, log: (s) => lines.push(s) });
  console.log('     ' + lines.join('\n     '));
  ok(won, 'mission 01 completed over MCP: ' + JSON.stringify((await call('check_mission')).mission));
  ok(await page.evaluate(() => window.__sim.ux().won), 'the page shows the mission as won');
  const logText = await page.getByTestId('agent-log').innerText();
  ok(/Přesun chapadla na x/.test(logText) && /Zavřít chapadlo/.test(logText) && /Spouští misi 01/.test(logText), 'activity log is human-readable');
  await page.evaluate(() => window.__sim.cameraNow && window.__sim.cameraNow('orbit'));
  await page.screenshot({ path: path.join(OUT, 'agent-won.png') }).catch(() => {});

  // ---- Odpojit ----
  await page.getByTestId('agent-disconnect').click();
  await sleep(300);
  const gone = await raw('get_state');
  ok(gone.isError && gone.structuredContent.error.code === 'TAB_GONE', 'after Odpojit the next call fails with TAB_GONE');
  await client.close();

  // ---- English panel (?lang=en): no Czech left ----
  const en = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await en.goto(`http://127.0.0.1:${sport}/sim/so101/?test=1&lang=en&relay=${encodeURIComponent(relay)}`);
  await en.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 300000 });
  await en.click('#ai-open');
  await en.getByTestId('agent-code').filter({ hasText: /^[A-Z]{4}-[A-Z]{4}$/ }).waitFor({ timeout: 20000 });
  const enText = await en.evaluate(() => [document.querySelector('.ai-box').innerText, document.querySelector('.ai-bar').innerText].join('\n'));
  const cz = enText.split('\n').filter((l) => /[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ]/.test(l));
  ok(!cz.length && /Connect to the SO-101 simulation, code/.test(enText), 'English panel has no Czech left' + (cz.length ? ': ' + cz.join(' | ') : ''));
  await en.screenshot({ path: path.join(OUT, 'agent-en.png') }).catch(() => {});
  await en.close();

  // ---- ?real=1: no API, no panel ----
  const real = await browser.newPage();
  await real.goto(`http://127.0.0.1:${sport}/sim/so101/?test=1&real=1`);
  await real.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 300000 });
  ok(await real.evaluate(() => !window.so101 && !document.getElementById('ai-open')), '?real=1: no window.so101 and no panel');
} catch (e) {
  console.log('FAIL', e.stack || e); fails++;
} finally {
  await cleanup();
}
console.log(fails ? `${fails} failure(s)` : 'all ok', '· screenshots in', OUT);
process.exit(fails ? 1 : 0);
