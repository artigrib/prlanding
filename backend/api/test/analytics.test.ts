import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../src/server.ts';
import { CounterStore } from '../src/store.ts';
import { loadSchema, validateBatch, deviceClass, countryFrom, type EventRecord } from '../src/analytics/validate.ts';
import {
  NdjsonSink,
  ClickHouseSink,
  AmplitudeSink,
  sinksFromEnv,
  type Sink,
  type SinkStats,
} from '../src/analytics/sinks.ts';

const schema = loadSchema();
const AID = '1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b';
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const ctx = { now: NOW, country: 'CZ', device: 'desktop' as const };
const batch = (events: unknown[], extra: Record<string, unknown> = {}) => ({ v: 1, aid: AID, sid: NOW - 1000, events, ...extra });

/* ------------------------------------------------------------------ schema ------------------------------------------------------------------ */

test('api schema copy equals analytics/schema.json', () => {
  const root = new URL('../../../analytics/schema.json', import.meta.url);
  if (!existsSync(root)) return; // Docker build context only has the copy
  assert.equal(readFileSync(new URL('../src/schema.json', import.meta.url), 'utf8'), readFileSync(root, 'utf8'));
});

test('schema: every event is snake_case and has a description', () => {
  const raw = JSON.parse(readFileSync(new URL('../src/schema.json', import.meta.url), 'utf8'));
  const names = Object.keys(raw.events);
  assert.ok(names.length >= 15, 'about 15+ funnel events');
  for (const n of names) {
    assert.match(n, /^[a-z][a-z0-9_]+$/);
    assert.ok(raw.events[n].description, n + ' description');
  }
});

/* ---------------------------------------------------------------- validator ---------------------------------------------------------------- */

test('validator keeps whitelisted props and drops unknown events and props', () => {
  const r = validateBatch(
    schema,
    batch([
      { e: 'mission_win', t: NOW, n: 1, p: { mission: 'bowl', stars: 3, seconds: 42, assisted: false, path: '/sim/so101/', lang: 'cs', email: 'a@b.cz', name: 'Eva' } },
      { e: 'evil_event', t: NOW, n: 2, p: { mission: 'bowl' } },
      { e: 'kit_view', t: NOW, n: 3, p: { kit: 'Robot With Spaces!' } },
      'not an object',
    ]),
    ctx,
  );
  assert.equal(r.ok, true);
  assert.equal(r.dropped, 2);
  assert.equal(r.events.length, 2);
  const [w, k] = r.events as [EventRecord, EventRecord];
  assert.deepEqual(w.props, { mission: 'bowl', stars: 3, seconds: 42, assisted: false });
  assert.equal(w.path, '/sim/so101/');
  assert.equal(w.lang, 'cs');
  assert.equal(w.country, 'CZ');
  assert.equal(w.anon_id, AID);
  assert.match(w.insert_id, /^[0-9a-f]{32}$/);
  assert.deepEqual(k.props, {}, 'invalid value dropped');
  assert.ok(!JSON.stringify(r.events).includes('a@b.cz'));
});

test('validator rejects bad envelopes and clamps times', () => {
  assert.equal(validateBatch(schema, null, ctx).ok, false);
  assert.equal(validateBatch(schema, batch([{ e: 'ai_paired' }], { aid: 'me@example.com' }), ctx).ok, false);
  assert.equal(validateBatch(schema, batch([{ e: 'ai_paired' }], { v: 2 }), ctx).ok, false);
  assert.equal(validateBatch(schema, batch([]), ctx).ok, false);
  assert.equal(validateBatch(schema, batch(Array(26).fill({ e: 'ai_paired' })), ctx).ok, false);
  const r = validateBatch(schema, batch([{ e: 'ai_paired', t: NOW + 10 * 86_400_000, p: { path: '/x?email=a@b.cz' } }]), ctx);
  assert.equal(r.events[0]!.time, NOW);
  assert.equal(r.events[0]!.path, '', 'query strings are not a valid path');
});

test('stars, enums and utm are bounded', () => {
  const r = validateBatch(
    schema,
    batch([
      { e: 'mission_win', p: { mission: 'bowl', stars: 7, seconds: -1, assisted: 'yes' } },
      { e: 'page_view', p: { utm_source: 'newsletter', utm_campaign: 'Hello World <script>', ref_domain: 'www.google.com' } },
      { e: 'mode_changed', p: { mode: 'god' } },
    ]),
    ctx,
  );
  assert.deepEqual(r.events[0]!.props, { mission: 'bowl' });
  assert.deepEqual(r.events[1]!.props, { utm_source: 'newsletter', ref_domain: 'www.google.com' });
  assert.deepEqual(r.events[2]!.props, {});
});

test('device class and country helpers', () => {
  assert.equal(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'), 'mobile');
  assert.equal(deviceClass('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet');
  assert.equal(deviceClass('Mozilla/5.0 (X11; Linux x86_64) Chrome/141'), 'desktop');
  assert.equal(countryFrom('cz'), 'CZ');
  assert.equal(countryFrom('XX'), '');
  assert.equal(countryFrom('T1'), '');
  assert.equal(countryFrom('Czechia'), '');
});

/* ------------------------------------------------------------ api end to end ------------------------------------------------------------- */

class MemSink implements Sink {
  readonly name = 'mem';
  got: EventRecord[] = [];
  write(e: EventRecord[]) {
    this.got.push(...e);
  }
  async flush() {}
  async close() {}
  stats(): SinkStats {
    return { name: 'mem', accepted: this.got.length, sent: 0, dropped: 0, queued: 0, lastStatus: null };
  }
}

const ORIGIN = 'https://printedrobotics.cz';
let api: Server;
let base: string;
let store: CounterStore;
const mem = new MemSink();
let dir: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pr-an-'));
  store = new CounterStore(':memory:', 0);
  api = createApi({
    store,
    version: 't',
    allowedOrigins: [ORIGIN],
    statsToken: 'x'.repeat(32),
    trustProxy: true,
    perIpPerMinute: 100,
    analytics: { schema, sinks: [mem], countryHeader: 'cf-ipcountry' },
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
after(() => {
  api.closeAllConnections();
  api.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/e`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'text/plain;charset=UTF-8', 'User-Agent': 'Mozilla/5.0 (X11) Chrome/141', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('POST /e batch: 204, events reach the sinks, no IP or UA stored, country from the proxy header', async () => {
  mem.got = [];
  const r = await post(batch([{ e: 'page_view', t: Date.now(), n: 0, p: { path: '/', lang: 'cs' } }, { e: 'nope' }]), {
    'X-Forwarded-For': '203.0.113.9',
    'CF-IPCountry': 'SK',
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(mem.got.length, 1);
  const s = JSON.stringify(mem.got);
  assert.ok(!s.includes('203.0.113.9') && !s.includes('127.0.0.1') && !s.includes('Chrome'));
  assert.equal(mem.got[0]!.country, 'SK');
  assert.equal(mem.got[0]!.device, 'desktop');
});

test('POST /e batch: wrong origin 403, broken JSON 400, bad envelope 400, oversize 413, bots ignored', async () => {
  mem.got = [];
  assert.equal((await post(batch([{ e: 'ai_paired' }]), { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('{"events": [')).status, 400);
  assert.equal((await post(batch([{ e: 'ai_paired' }], { aid: 'x' }))).status, 400);
  assert.equal((await post('{"events":"' + 'a'.repeat(20_000) + '"}')).status, 413);
  assert.equal((await post(batch([{ e: 'ai_paired' }]), { 'User-Agent': 'Googlebot/2.1' })).status, 204);
  assert.equal(mem.got.length, 0);
});

test('legacy single-name body still counts; /stats lists sinks', async () => {
  assert.equal((await post('{"e":"kit_view"}')).status, 204);
  const s = await fetch(`${base}/stats`, { headers: { Authorization: 'Bearer ' + 'x'.repeat(32) } });
  const j = (await s.json()) as { events: string[]; sinks: SinkStats[] };
  assert.ok(j.events.includes('mission_win'));
  assert.equal(j.sinks[0]!.name, 'mem');
});

/* ------------------------------------------------------------------ sinks ------------------------------------------------------------------- */

const rec = (over: Partial<EventRecord> = {}): EventRecord => ({
  schema_version: 1,
  received_at: NOW,
  time: NOW,
  event: 'mission_win',
  anon_id: AID,
  session_id: NOW - 1000,
  seq: 1,
  insert_id: 'a'.repeat(32),
  path: '/sim/so101/',
  lang: 'cs',
  country: 'CZ',
  device: 'mobile',
  props: { mission: 'bowl', stars: 2, assisted: false },
  ...over,
});

test('NdjsonSink appends one file per UTC day and prunes old files', async () => {
  const d = join(dir, 'events');
  const old = join(d, 'events-2020-01-01.ndjson');
  const sink = new NdjsonSink({ dir: d, flushMs: 0, retentionDays: 30, log: () => {} });
  sink.write([rec(), rec({ received_at: NOW + 86_400_000, seq: 2 })]);
  await sink.flush();
  writeFileSync(old, '{}\n');
  sink.write([rec({ seq: 3 })]);
  (sink as unknown as { lastPrune: string }).lastPrune = '';
  await sink.flush();
  const files = readdirSync(d).sort();
  assert.deepEqual(files, ['events-2026-10-29.ndjson', 'events-2026-10-30.ndjson']);
  const lines = readFileSync(join(d, files[0]!), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]!).event, 'mission_win');
  assert.deepEqual(sink.stats(), { name: 'ndjson', accepted: 3, sent: 3, dropped: 0, queued: 0, lastStatus: null });
  await sink.close();
});

interface Hit {
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}
async function mockHttp(statuses: number[]): Promise<{ url: string; hits: Hit[]; close: () => void }> {
  const hits: Hit[] = [];
  let i = 0;
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hits.push({ url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(statuses[Math.min(i++, statuses.length - 1)]!).end('{"code":1,"echo":"secret-echo"}');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
    hits,
    close: () => {
      srv.closeAllConnections();
      srv.close();
    },
  };
}

test('ClickHouseSink: JSONEachRow insert with auth headers, retries 503, then succeeds', async () => {
  const m = await mockHttp([503, 200]);
  const logs: string[] = [];
  const sink = new ClickHouseSink({
    url: m.url,
    user: 'ingest',
    password: 'ch-secret-pw',
    intervalMs: 0,
    baseBackoffMs: 1,
    log: (x) => logs.push(JSON.stringify(x)),
  });
  sink.write([rec(), rec({ seq: 2, event: 'ai_paired', props: {} })]);
  await sink.flush();
  await new Promise((r) => setTimeout(r, 10));
  await sink.flush();
  assert.equal(m.hits.length, 2);
  const h = m.hits[1]!;
  assert.equal(new URL(h.url, 'http://x').searchParams.get('query'), 'INSERT INTO analytics.events FORMAT JSONEachRow');
  assert.equal(h.headers['x-clickhouse-user'], 'ingest');
  assert.equal(h.headers['x-clickhouse-key'], 'ch-secret-pw');
  const rows = h.body.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event_time, '2026-10-29 12:00:00.000');
  assert.deepEqual(rows[0].props, { mission: 'bowl', stars: '2', assisted: 'false' });
  assert.equal(sink.stats().sent, 2);
  assert.ok(!logs.join().includes('ch-secret-pw') && !logs.join().includes('secret-echo') && !logs.join().includes(AID));
  await sink.close();
  m.close();
});

test('ClickHouseSink drops a batch on a 4xx without retrying', async () => {
  const m = await mockHttp([400]);
  const sink = new ClickHouseSink({ url: m.url, user: 'u', password: 'p', intervalMs: 0, log: () => {} });
  sink.write([rec()]);
  await sink.flush();
  assert.equal(m.hits.length, 1);
  assert.equal(sink.stats().dropped, 1);
  await sink.close();
  m.close();
});

test('AmplitudeSink: EU-style payload, device_id = anon id, no ip/user fields, 429 waits, key never logged', async () => {
  const m = await mockHttp([429, 200]);
  const logs: string[] = [];
  const sink = new AmplitudeSink({ apiKey: 'amp-key-123', endpoint: m.url + '/2/httpapi', intervalMs: 0, log: (x) => logs.push(JSON.stringify(x)) });
  sink.write([rec()]);
  await sink.flush();
  assert.equal(m.hits.length, 1);
  const st = sink as unknown as { notBefore: number };
  assert.ok(st.notBefore - Date.now() > 25_000, '429 pauses ~30 s');
  st.notBefore = 0;
  await sink.flush();
  assert.equal(m.hits.length, 2);
  const body = JSON.parse(m.hits[1]!.body);
  assert.equal(body.api_key, 'amp-key-123');
  const ev = body.events[0];
  assert.equal(ev.device_id, AID);
  assert.equal(ev.event_type, 'mission_win');
  assert.equal(ev.insert_id, 'a'.repeat(32));
  assert.equal(ev.country, 'CZ');
  assert.ok(!('ip' in ev) && !('user_id' in ev) && !('user_properties' in ev));
  assert.deepEqual(ev.event_properties, { mission: 'bowl', stars: 2, assisted: false, path: '/sim/so101/', device: 'mobile' });
  assert.ok(!logs.join().includes('amp-key-123'));
  await sink.close();
  m.close();
});

test('AmplitudeSink batches at most 10 events per request', async () => {
  const m = await mockHttp([200]);
  const sink = new AmplitudeSink({ apiKey: 'k', endpoint: m.url, intervalMs: 0, log: () => {} });
  sink.write(Array.from({ length: 23 }, (_, i) => rec({ seq: i })));
  await sink.flush();
  assert.deepEqual(m.hits.map((h) => JSON.parse(h.body).events.length), [10, 10, 3]);
  await sink.close();
  m.close();
});

test('sinksFromEnv: only NDJSON unless ClickHouse / Amplitude env is complete', () => {
  const names = (env: Record<string, string>) => sinksFromEnv({ ANALYTICS_DIR: join(dir, 'x'), ...env }, () => {}).map((s) => s.name);
  assert.deepEqual(names({}), ['ndjson']);
  assert.deepEqual(names({ CLICKHOUSE_URL: 'https://ch.example:8443', CLICKHOUSE_USER: 'u' }), ['ndjson']);
  assert.deepEqual(names({ CLICKHOUSE_URL: 'http://ch.example', CLICKHOUSE_USER: 'u', CLICKHOUSE_PASSWORD: 'p' }), ['ndjson']);
  assert.deepEqual(
    names({ CLICKHOUSE_URL: 'https://ch.example:8443', CLICKHOUSE_USER: 'u', CLICKHOUSE_PASSWORD: 'p', AMPLITUDE_API_KEY: 'k' }),
    ['ndjson', 'clickhouse', 'amplitude'],
  );
});
