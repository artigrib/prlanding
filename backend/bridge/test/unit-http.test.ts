import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createBridge, type Bridge } from '../src/http.ts';
import { loadConfig } from '../src/config.ts';
import { testConfig } from './helpers.ts';
// the browser module is plain ESM and runs in node too
import { validate } from '../../bridge-client/validate.js';
import schemas from '../../bridge-client/schemas.js';

let b: Bridge, port: number;
before(async () => { b = createBridge(testConfig({ dev: false, tabOrigins: ['https://printedrobotics.cz'] })); port = await b.listen(); });
after(async () => { await b.close(); });

const wsOpen = (origin: string | undefined) => new Promise<{ ws: WebSocket; status?: number; msgs: any[] }>((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/tab`, { headers: origin ? { origin } : {} });
  const msgs: any[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  ws.on('open', () => resolve({ ws, msgs }));
  ws.on('unexpected-response', (_req, res) => resolve({ ws, status: res.statusCode, msgs }));
  ws.on('error', () => {});
});

test('healthz exposes only ok + version', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, version: 'dev' });
  assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
});

test('/mcp rejects a foreign Origin, accepts none, rejects huge bodies', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body, headers: { ...h, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body, headers: { ...h, origin: 'http://localhost:3000' } })).status, 403, 'localhost only in dev');
  assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: 'x'.repeat(300_000), headers: h })).status, 413);
  const ok = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body, headers: h });
  assert.notEqual(ok.status, 403);
});

test('/tab: Origin allow-list, hello required, unknown messages dropped, binary refused', async () => {
  assert.equal((await wsOpen('https://evil.example')).status, 403);
  assert.equal((await wsOpen(undefined)).status, 403);
  assert.equal((await wsOpen('http://localhost:8000')).status, 403);
  const { ws, msgs } = await wsOpen('https://printedrobotics.cz');
  ws.send(JSON.stringify({ v: 1, t: 'hello', capabilities: { views: ['overview', 'evil'], missions: ['bowl', 'x'] } }));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(msgs[0].t, 'welcome');
  assert.match(msgs[0].code, /^[A-Z]{4}-[A-Z]{4}$/);
  const room = [...b.registry.rooms.values()][0]!;
  assert.deepEqual(room.caps, { views: ['overview'], missions: ['bowl'] });
  ws.send(JSON.stringify({ v: 1, t: 'call', id: 'x', tool: 'move_joints' })); // tabs cannot send calls
  ws.send(JSON.stringify({ v: 1, t: 'ping' }));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(msgs.at(-1).t, 'pong');
  const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
  ws.send(Buffer.from([1, 2, 3]), { binary: true });
  assert.equal(await closed, 1003);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(b.registry.rooms.size, 0);
});

test('/tab: frames over 1 MiB close the socket', async () => {
  const { ws } = await wsOpen('https://printedrobotics.cz');
  ws.send(JSON.stringify({ v: 1, t: 'hello' }));
  const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
  ws.send(JSON.stringify({ v: 1, t: 'event', pad: 'x'.repeat(1_100_000) }));
  assert.equal(await closed, 1009);
});

test('config: production defaults', () => {
  const c = loadConfig({} as NodeJS.ProcessEnv);
  assert.equal(c.dev, false);
  assert.deepEqual(c.tabOrigins, ['https://printedrobotics.cz', 'https://www.printedrobotics.cz']);
  assert.equal(c.maxSessions, 30);
  assert.equal(c.codeTtlMs, 600_000);
  assert.equal(c.trustProxy, false);
});

test('bridge-client schemas.js is in sync with src/schemas.ts', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/export-schemas.ts', import.meta.url)), '--check']);
});

test('tab-side validator rejects what the server would reject', () => {
  const mj = (schemas as any).tools.move_joints;
  assert.equal(validate(mj, { joints_deg: { elbow_flex: 10 }, duration_s: 1 }), null);
  assert.deepEqual(validate(mj, { joints_deg: { elbow: 10 } }), { field: 'joints_deg.elbow', rule: 'unknown_field' });
  assert.deepEqual(validate(mj, { duration_s: 0.1 }), { field: 'duration_s', rule: 'minimum', limit: 0.2 });
  assert.deepEqual(validate(mj, { session: 's_x' }), { field: 'session', rule: 'unknown_field' }, 'the tab never receives the handle');
  const sg = (schemas as any).tools.set_gripper;
  assert.equal(validate(sg, { gripper_pct: 'open' }), null);
  assert.equal(validate(sg, { gripper_pct: 40 }), null);
  assert.deepEqual(validate(sg, { gripper_pct: 'wide' }), { field: 'gripper_pct', rule: 'any_of' });
  assert.deepEqual(validate(sg, {}), { field: 'gripper_pct', rule: 'required' });
  const mt = (schemas as any).tools.move_to;
  assert.equal(validate(mt, { pose: { x_mm: 1, y_mm: 2, z_mm: 3, pitch_deg: 'auto' } }), null);
  assert.deepEqual(validate(mt, { pose: { x_mm: 1, y_mm: 2, z_mm: 3, pitch_deg: NaN } }), { field: 'pose.pitch_deg', rule: 'any_of' });
});

test('config: deploy env names (APP_VERSION, TRUST_PROXY, ALLOWED_ORIGINS)', () => {
  const c = loadConfig({ APP_VERSION: 'abc123', TRUST_PROXY: '1', ALLOWED_ORIGINS: 'https://printedrobotics.cz' } as NodeJS.ProcessEnv);
  assert.equal(c.version, 'abc123');
  assert.equal(c.trustProxy, true);
  assert.deepEqual(c.tabOrigins, ['https://printedrobotics.cz']);
});
