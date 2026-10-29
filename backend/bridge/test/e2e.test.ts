// End-to-end: real server on a local port, a headless Chromium page running the bridge-client with
// the mock sim handler, and the official MCP client over Streamable HTTP.
// Skipped when Playwright is not installed (require('playwright') must resolve, e.g. via NODE_PATH).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, normalize, extname } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createBridge, type Bridge } from '../src/http.ts';
import { testConfig } from './helpers.ts';

const require = createRequire(import.meta.url);
let playwright: any = null;
try { playwright = require('playwright'); } catch { /* skipped below */ }

const BACKEND_DIR = fileURLToPath(new URL('../../', import.meta.url));
const REPO_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.xml': 'text/xml', '.json': 'application/json' };

let bridge: Bridge, bridgePort: number, statics: Server, staticPort: number, browser: any;

function serveStatic(): Promise<number> {
  statics = createServer(async (req, res) => {
    let p = normalize(decodeURIComponent((req.url || '/').split('?')[0]!));
    if (p.endsWith('/')) p += 'index.html';
    // /bridge-client/* from backend/ (mock page); everything else from the repo root, like GitHub Pages serves the site
    // (the sim imports /assets/i18n.js and /backend/bridge-client/*)
    const file = p.startsWith('/bridge-client/') ? join(BACKEND_DIR, p) : join(REPO_DIR, p);
    if (!file.startsWith(REPO_DIR) || file.includes('/node_modules/')) { res.writeHead(404); return res.end(); }
    let body: Buffer;
    try { body = await readFile(file); } catch { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((r) => statics.listen(0, '127.0.0.1', () => r((statics.address() as any).port)));
}

/** era 'legacy' = 2025-11-25 stateless (the SDK default); 'modern' = pinned 2026-07-28 (per-request _meta envelope). */
async function mcpClient(era: 'legacy' | 'modern' = 'legacy'): Promise<Client> {
  const c = new Client({ name: 'e2e-client', version: '1.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } as any : undefined);
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${bridgePort}/mcp`)));
  return c;
}

async function openSim(speed = 4): Promise<any> {
  const page = await browser.newPage();
  page.on('pageerror', (e: Error) => console.error('[page]', e.message));
  await page.goto(`http://127.0.0.1:${staticPort}/bridge-client/test/mock-page.html?speed=${speed}&relay=${encodeURIComponent(`ws://127.0.0.1:${bridgePort}/tab`)}`);
  await page.getByTestId('agent-connect').click();
  await page.getByTestId('agent-code').filter({ hasText: /^[A-Z]{4}-[A-Z]{4}$/ }).waitFor();
  return page;
}

/** connect(code) blocks until the human clicks Allow; do both. */
async function pairWith(client: Client, page: any): Promise<string> {
  const code = (await page.getByTestId('agent-code').textContent()).trim();
  const pending = client.callTool({ name: 'connect', arguments: { code } });
  await page.getByTestId('agent-allow').click();
  const r: any = await pending;
  assert.equal(r.isError, undefined, JSON.stringify(r));
  await page.locator('[data-state="paired"]').first().waitFor();
  return r.structuredContent.session;
}

const call = async (c: Client, name: string, args: Record<string, unknown>): Promise<any> => c.callTool({ name, arguments: args });

before(async () => {
  if (!playwright) return;
  bridge = createBridge(testConfig({ approvalTimeoutMs: 10_000, hbSec: 2 }));
  bridgePort = await bridge.listen();
  staticPort = await serveStatic();
  browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => {
  if (!playwright) return;
  await browser?.close();
  await bridge?.close();
  statics?.close();
});

test('e2e: connect + move_joints + snapshot through the relay', { skip: !playwright && 'playwright not installed' }, async () => {
  const client = await mcpClient();
  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert.deepEqual(tools, ['connect', 'get_state', 'get_scene', 'move_joints', 'move_to', 'set_gripper', 'home', 'stop', 'snapshot', 'list_missions', 'start_mission', 'check_mission', 'reset_scene']);

  const page = await openSim();
  const session = await pairWith(client, page);
  assert.match(session, /^s_[A-Za-z0-9_-]{22}$/);
  assert.match(await page.getByTestId('agent-status').textContent(), /^Simulaci ovládá: \S/);

  // move_joints: absolute partial target, waits for completion
  const mv = await call(client, 'move_joints', { session, joints_deg: { shoulder_pan: 30, elbow_flex: 10 }, gripper_pct: 60, duration_s: 0.8 });
  assert.equal(mv.isError, undefined, JSON.stringify(mv));
  const s = mv.structuredContent;
  assert.equal(s.ok, true);
  assert.equal(s.status, 'completed');
  assert.equal(s.meta.backend, 'sim');
  assert.ok(Math.abs(s.final.joints_deg.shoulder_pan - 30) < 0.5);
  assert.ok(Math.abs(s.final.joints_deg.elbow_flex - 10) < 0.5);
  assert.ok(Math.abs(s.final.joints_deg.shoulder_lift - -57.3) < 0.5, 'omitted joints keep their goal');
  assert.ok(Math.abs(s.final.gripper_pct - 60) < 0.5);
  assert.equal(mv.content.at(-1).type, 'text');

  // snapshot: real JPEG rendered in the page
  const snap = await call(client, 'snapshot', { session, view: 'side', width: 320 });
  assert.equal(snap.isError, undefined, JSON.stringify(snap));
  const img = snap.content.find((c: any) => c.type === 'image');
  assert.equal(img.mimeType, 'image/jpeg');
  const bytes = Buffer.from(img.data, 'base64');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.ok(bytes.length > 500 && bytes.length < 200_000);
  assert.equal(snap.structuredContent.width, 320);
  assert.equal(snap.structuredContent.height, 240);

  // limits are reported, never clamped; nothing moved
  const bad = await call(client, 'move_joints', { session, joints_deg: { shoulder_pan: 120 } });
  assert.equal(bad.isError, true);
  assert.equal(bad.structuredContent.error.code, 'OUT_OF_LIMITS');
  assert.deepEqual(bad.structuredContent.error.details, { joint: 'shoulder_pan', value_deg: 120, min_deg: -110, max_deg: 110 });
  const st = await call(client, 'get_state', { session });
  assert.ok(Math.abs(st.structuredContent.joints_deg.shoulder_pan - 30) < 0.5);

  // relative jog: limit enforced in the tab (server does not know the current goal)
  const rel = await call(client, 'move_joints', { session, joints_deg: { shoulder_pan: 100 }, relative: true });
  assert.equal(rel.structuredContent.error.code, 'OUT_OF_LIMITS');
  assert.equal(rel.structuredContent.error.details.joint, 'shoulder_pan');

  // schema validation by the SDK (unknown field / wrong type)
  const inval = await call(client, 'move_joints', { session, joints_deg: { shoulder_pan: 'ten' } });
  assert.equal(inval.isError, true);

  // idempotency with request_id
  const a1 = await call(client, 'move_joints', { session, joints_deg: { wrist_flex: 5 }, relative: true, request_id: 'jog-1', duration_s: 0.3 });
  const a2 = await call(client, 'move_joints', { session, joints_deg: { wrist_flex: 5 }, relative: true, request_id: 'jog-1', duration_s: 0.3 });
  assert.equal(a2.structuredContent.motion_id, a1.structuredContent.motion_id);
  assert.ok(Math.abs(a2.structuredContent.final.joints_deg.wrist_flex - 73.8) < 0.5, 'ran once (68.8 + 5)');

  // move_to with mock IK, home, gripper
  const mt = await call(client, 'move_to', { session, pose: { x_mm: 200, y_mm: 0, z_mm: 80 }, duration_s: 0.5 });
  assert.equal(mt.isError, undefined, JSON.stringify(mt));
  assert.ok(mt.structuredContent.ik.position_error_mm < 1);
  const far = await call(client, 'move_to', { session, pose: { x_mm: 500, y_mm: 0, z_mm: 10 } });
  assert.equal(far.structuredContent.error.code, 'UNREACHABLE');
  assert.equal((await call(client, 'set_gripper', { session, gripper_pct: 'close' })).structuredContent.final.gripper_pct, 0);
  assert.equal((await call(client, 'home', { session })).structuredContent.status, 'completed');

  // missions: titles come from the server catalogue
  const lm = await call(client, 'list_missions', { session });
  assert.deepEqual(lm.structuredContent.missions.map((m: any) => m.id), ['bowl']);
  assert.equal(lm.structuredContent.missions[0].title_en, 'Put the cube in the bowl');
  const sm = await call(client, 'start_mission', { session, mission_id: 'bowl' });
  assert.equal(sm.structuredContent.mission.state, 'running');
  await page.evaluate(() => (window as any).__handler._win());
  assert.equal((await call(client, 'check_mission', { session })).structuredContent.mission.state, 'success');
  assert.equal((await call(client, 'start_mission', { session, mission_id: 'trace' })).structuredContent.error.code, 'UNKNOWN_MISSION');
  assert.equal((await call(client, 'reset_scene', { session })).isError, undefined);
  assert.equal((await call(client, 'get_scene', { session })).structuredContent.objects.length, 2);

  // BUSY while a motion runs, preempt, and stop
  const long = call(client, 'move_joints', { session, joints_deg: { shoulder_pan: -60 }, duration_s: 8 });
  await new Promise((r) => setTimeout(r, 300));
  const busy = await call(client, 'move_joints', { session, joints_deg: { shoulder_pan: 0 } });
  assert.equal(busy.structuredContent.error.code, 'BUSY');
  const stop = await call(client, 'stop', { session });
  assert.equal(stop.structuredContent.status, 'held');
  const longR = await long;
  assert.equal(longR.structuredContent.status, 'stopped');
  assert.ok(longR.structuredContent.final.joints_deg.shoulder_pan > -60);

  // estop latched in the page blocks motion; reads still work
  await page.evaluate(() => (window as any).__handler._estop(true));
  assert.equal((await call(client, 'home', { session })).structuredContent.error.code, 'ESTOP_ACTIVE');
  assert.equal((await call(client, 'get_state', { session })).structuredContent.safety, 'estop');
  await page.evaluate(() => (window as any).__handler._estop(false));

  // closing the tab: next call fails fast with a clear error
  await page.close();
  await new Promise((r) => setTimeout(r, 200));
  const t0 = Date.now();
  const gone = await call(client, 'get_state', { session });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(gone.structuredContent.error.code, 'TAB_GONE');
  assert.match(gone.content[0].text, /closed or disconnected/);
  await client.close();
});

test('e2e (protocol 2026-07-28): deny in the tab, wrong code, revoke', { skip: !playwright && 'playwright not installed' }, async () => {
  const client = await mcpClient('modern');
  const page = await openSim();
  const code = (await page.getByTestId('agent-code').textContent()).trim();

  const wrong = await call(client, 'connect', { code: 'BBBB-BBBB' });
  assert.equal(wrong.structuredContent.error.code, 'PAIRING_FAILED');

  const p = call(client, 'connect', { code });
  await page.getByTestId('agent-deny').click();
  assert.equal((await p).structuredContent.error.code, 'PAIRING_DENIED');
  const code2 = (await page.getByTestId('agent-code').filter({ hasNotText: code }).textContent()).trim();
  assert.notEqual(code2, code, 'denied code was rotated');

  const session = await pairWith(client, page);
  assert.equal(await page.getByTestId('agent-status').textContent(), 'Simulaci ovládá: e2e-client', 'client name from the _meta envelope');
  assert.equal((await call(client, 'get_state', { session })).isError, undefined);
  await page.getByTestId('agent-disconnect').click(); // revoke
  await page.getByTestId('agent-code').filter({ hasText: /^[A-Z]{4}-[A-Z]{4}$/ }).waitFor();
  const r = await call(client, 'get_state', { session });
  assert.equal(r.structuredContent.error.code, 'TAB_GONE');
  assert.equal(r.structuredContent.error.details.reason, 'revoked');
  await page.close();
  await client.close();
});

test('e2e: heartbeat loss stops motion in the tab', { skip: !playwright && 'playwright not installed' }, async () => {
  const client = await mcpClient();
  const page = await openSim(1);
  const session = await pairWith(client, page);
  // the longest allowed motion: the link loss (hb 2 s × 3 + one check interval, ~6-8 s) lands well before its end
  const long = call(client, 'move_joints', { session, joints_deg: { shoulder_pan: 90 }, duration_s: 20 });
  await new Promise((r) => setTimeout(r, 400));
  // simulate a dead relay through the public test hook: the relay stops reading and pinging this tab
  assert.ok(bridge.relay.debugSilence() >= 1);
  const lost = Date.now();
  await page.waitForFunction(() => (window as any).__bridge.state === 'offline' || (window as any).__bridge.state === 'connecting', null, { timeout: 25_000 });
  const detectMs = Date.now() - lost;
  const held = await page.evaluate(() => (window as any).__handler.getState());
  assert.equal(held.moving, false, 'motion stopped on link loss');
  assert.ok(held.joints_deg.shoulder_pan < 85, 'stopped before the end of the motion: ' + held.joints_deg.shoulder_pan);
  // held: the pose does not change any more
  await new Promise((r) => setTimeout(r, 600));
  const later = await page.evaluate(() => (window as any).__handler.getState());
  assert.ok(Math.abs(later.joints_deg.shoulder_pan - held.joints_deg.shoulder_pan) < 0.5, 'pose held after link loss');
  // the exact hb arithmetic is covered with a manual clock in unit-relay.test.ts; here only a generous bound
  assert.ok(detectMs < 20_000, 'link loss detected within 3 heartbeats + slack: ' + detectMs + ' ms');
  const r = await long;
  assert.equal(r.isError, true);
  await page.close();
  await client.close();
});

test('e2e: real MuJoCo sim (sim/so101) through its own "Připojit AI" panel', { skip: !playwright && 'playwright not installed', timeout: 180_000 }, async (t) => {
  // SwiftShader frames take 0.25-2.5 s and a snapshot ~10 s here (blocking the page): long heartbeat and snapshot deadline
  const own = createBridge(testConfig({ approvalTimeoutMs: 10_000, hbSec: 10, snapshotDeadlineMs: 40_000 }));
  const mainPort = bridgePort;
  bridgePort = await own.listen();
  t.after(async () => { bridgePort = mainPort; await own.close(); });
  const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
  page.on('pageerror', (e: Error) => console.error('[sim]', e.message));
  page.on('console', (m: any) => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) console.error('[sim console]', m.text()); });
  page.on('response', (r: any) => { if (r.status() >= 400) console.error('[sim http]', r.status(), r.url()); });
  const relay = encodeURIComponent(`ws://127.0.0.1:${bridgePort}/tab`);
  await page.goto(`http://127.0.0.1:${staticPort}/sim/so101/?test=1&mise=bowl&relay=${relay}`);
  await page.waitForFunction(() => (window as any).__sim && ((window as any).__sim.ready || (window as any).__sim.error), null, { timeout: 90_000 });
  const err = await page.evaluate(() => (window as any).__sim.error);
  assert.equal(err, undefined, 'sim failed to load: ' + err);
  // simulated time is pumped from here (the page's own frame loop is slow with software GL)
  await page.evaluate(() => { const s = (window as any).__sim; s._app.sim.paused = true; setInterval(() => s.advance(1 / 20), 20); });
  await page.locator('#ai-open').click();
  await page.getByTestId('agent-code').filter({ hasText: /^[A-Z]{4}-[A-Z]{4}$/ }).waitFor({ timeout: 20_000 });
  const client = await mcpClient('modern');
  const session = await pairWith(client, page);

  const scene = (await call(client, 'get_scene', { session })).structuredContent;
  const cube = scene.objects.find((o: any) => o.id === 'cube').pose;
  assert.ok(Math.abs(cube.x_mm - 250) < 2 && Math.abs(cube.y_mm + 110) < 2 && Math.abs(cube.z_mm - 12.5) < 2, JSON.stringify(cube));
  assert.ok(Math.abs(scene.robot.joints_deg.shoulder_lift - -57.3) < 1);

  const mv = await call(client, 'move_joints', { session, joints_deg: { shoulder_pan: 20, elbow_flex: 50 }, gripper_pct: 60, duration_s: 1 });
  assert.equal(mv.isError, undefined, JSON.stringify(mv));
  assert.equal(mv.structuredContent.status, 'completed');
  assert.ok(Math.abs(mv.structuredContent.final.joints_deg.shoulder_pan - 20) < 1.5, JSON.stringify(mv.structuredContent.final));
  assert.ok(Math.abs(mv.structuredContent.final.joints_deg.elbow_flex - 50) < 1.5);

  for (const view of ['overview', 'top']) {
    const snap = await call(client, 'snapshot', { session, view, width: 320 });
    assert.equal(snap.isError, undefined, JSON.stringify(snap).slice(0, 300));
    const bytes = Buffer.from(snap.content[0].data, 'base64');
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.ok(bytes.length > 3000, `${view} image is not blank (${bytes.length} B)`);
    await new Promise((r) => setTimeout(r, 1100)); // 1 snapshot/s
  }
  const mt = await call(client, 'move_to', { session, pose: { x_mm: 200, y_mm: 0, z_mm: 50 } });
  assert.equal(mt.structuredContent.status, 'completed', JSON.stringify(mt.structuredContent));
  assert.ok(mt.structuredContent.ik.position_error_mm < 5);
  assert.equal((await call(client, 'move_to', { session, pose: { x_mm: 200, y_mm: 0, z_mm: -30 } })).structuredContent.error.code, 'WORKSPACE_VIOLATION');
  const home = await call(client, 'home', { session });
  assert.equal(home.structuredContent.status, 'completed');
  assert.ok(Math.abs(home.structuredContent.final.joints_deg.shoulder_pan) < 1.5);
  await page.close();
  await client.close();
});
