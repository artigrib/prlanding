import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi, parseEvent, MAX_BODY_BYTES } from '../src/server.ts';
import { CounterStore } from '../src/store.ts';
import { RateLimiter } from '../src/ratelimit.ts';

const ORIGIN = 'https://printedrobotics.cz';
const TOKEN = 'test-token-0123456789abcdefghij';
let server: Server;
let store: CounterStore;
let base: string;
let dir: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pr-api-'));
  store = new CounterStore(join(dir, 'events.db'), 0);
  server = createApi({
    store,
    version: 'testsha',
    allowedOrigins: [ORIGIN],
    statsToken: TOKEN,
    trustProxy: true,
    perIpPerMinute: 5,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (body: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/e`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'text/plain;charset=UTF-8', ...headers },
    body,
  });

test('health returns ok and version', async () => {
  for (const p of ['/health', '/healthz']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, version: 'testsha' });
  }
});

test('parseEvent accepts JSON or bare names from the allow-list only', () => {
  assert.equal(parseEvent('{"e":"sim_start"}'), 'sim_start');
  assert.equal(parseEvent(' kit_view\n'), 'kit_view');
  assert.equal(parseEvent('{"e":"evil"}'), null);
  assert.equal(parseEvent('{"e":1}'), null);
  assert.equal(parseEvent('{bad json'), null);
  assert.equal(parseEvent('__proto__'), null);
});

test('POST /e counts allowed events, sets CORS, sets no cookies', async () => {
  const r = await post('{"e":"sim_start"}', { 'X-Forwarded-For': '10.0.0.1' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(r.headers.get('set-cookie'), null);
  await post('sim_start', { 'X-Forwarded-For': '10.0.0.1' });
  await post('{"e":"arena_cta"}', { 'X-Forwarded-For': '10.0.0.1' });
  const today = new Date().toISOString().slice(0, 10);
  const data = store.query(1);
  assert.equal(data[0].day, today);
  assert.equal(data[0].counts.sim_start, 2);
  assert.equal(data[0].counts.arena_cta, 1);
});

test('POST /e rejects unknown events, wrong or missing origin, oversize bodies', async () => {
  assert.equal((await post('{"e":"nope"}', { 'X-Forwarded-For': '10.0.0.2' })).status, 400);
  assert.equal((await post('sim_start', { Origin: 'https://evil.example', 'X-Forwarded-For': '10.0.0.2' })).status, 403);
  const noOrigin = await fetch(`${base}/e`, { method: 'POST', body: 'sim_start' });
  assert.equal(noOrigin.status, 403);
  const big = await post('x'.repeat(MAX_BODY_BYTES + 1), { 'X-Forwarded-For': '10.0.0.3' });
  assert.equal(big.status, 413);
});

test('OPTIONS preflight only for the allowed origin', async () => {
  const ok = await fetch(`${base}/e`, { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await fetch(`${base}/e`, { method: 'OPTIONS', headers: { Origin: 'http://printedrobotics.cz' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('per-IP rate limit returns 429', async () => {
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await post('kit_view', { 'X-Forwarded-For': '10.9.9.9' })).status);
  assert.deepEqual(codes.slice(0, 5), [204, 204, 204, 204, 204]);
  assert.equal(codes[6], 429);
  // A different client is not affected.
  assert.equal((await post('kit_view', { 'X-Forwarded-For': '10.9.9.10' })).status, 204);
});

test('/stats requires the bearer token', async () => {
  assert.equal((await fetch(`${base}/stats`)).status, 401);
  assert.equal((await fetch(`${base}/stats`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const r = await fetch(`${base}/stats?days=7`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { days: number; data: Array<{ counts: Record<string, number> }> };
  assert.equal(body.days, 7);
  assert.ok(body.data[0].counts.sim_start >= 2);
});

test('/stats is 404 when no token is configured', async () => {
  const s = createApi({ store, version: 'x', allowedOrigins: [ORIGIN], trustProxy: false });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/stats`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(r.status, 404);
  s.close();
});

test('unknown paths are 404', async () => {
  assert.equal((await fetch(`${base}/admin`)).status, 404);
});

test('store persists across reopen and only stores aggregates', () => {
  const path = join(dir, 'persist.db');
  const a = new CounterStore(path, 0);
  a.increment('mcp_tool');
  a.increment('mcp_tool');
  a.close();
  const b = new CounterStore(path, 0);
  assert.equal(b.query(1)[0].counts.mcp_tool, 2);
  b.close();
});

test('rate limiter window resets and global cap holds', () => {
  let t = 0;
  const rl = new RateLimiter(2, 3, 1000, 10, () => t);
  assert.equal(rl.allow('a'), true);
  assert.equal(rl.allow('a'), true);
  assert.equal(rl.allow('a'), false);
  assert.equal(rl.allow('b'), true);
  assert.equal(rl.allow('c'), false); // global cap 3
  t = 1000;
  assert.equal(rl.allow('a'), true);
});
