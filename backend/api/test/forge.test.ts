// Forge job API: auth (hashed invite tokens), input limits, rate/quota/concurrency, daily budget gate,
// SSE streaming from the worker's events.ndjson, artifact allowlist, cancel, CORS, disabled mode.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../src/server.ts';
import { CounterStore } from '../src/store.ts';
import { Forge, hashToken, parseTokens } from '../src/forge.ts';

const ORIGIN = 'https://printedrobotics.cz';
const T1 = 'tok1-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const T2 = 'tok2-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
let server: Server;
let store: CounterStore;
let base: string;
let dir: string;
let jobs: string;
let clock = Date.parse('2026-10-30T10:00:00Z');

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pr-forge-'));
  jobs = join(dir, 'jobs');
  mkdirSync(jobs);
  store = new CounterStore(join(dir, 'events.db'), 0);
  const forge = new Forge({
    jobsDir: jobs,
    tokens: parseTokens(`alice:${hashToken(T1)}, bob:${hashToken(T2)} junk:zz`),
    allowedOrigins: [ORIGIN],
    dailyUsd: 5,
    jobsPerTokenPerDay: 3,
    maxQueued: 5,
    perTokenPerMinute: 1000,
    authFailuresPerMinute: 4,
    pollMs: 20,
    heartbeatMs: 50,
    now: () => clock,
  });
  server = createApi({ store, version: 't', allowedOrigins: [ORIGIN], trustProxy: true, forge });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const H = (tok: string, ip = '10.1.0.1', extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${tok}`,
  'Content-Type': 'application/json',
  Origin: ORIGIN,
  'X-Forwarded-For': ip,
  ...extra,
});
const create = (tok: string, request: unknown = 'SO-101 s baterkou na chapadle', ip?: string) =>
  fetch(`${base}/forge/jobs`, { method: 'POST', headers: H(tok, ip), body: JSON.stringify({ request, lang: 'cs' }) });
// what the worker does: take the job off the queue, write its final state
const finish = (id: string, status = 'done') => {
  rmSync(join(jobs, 'queue', `${id}.json`), { force: true });
  writeFileSync(join(jobs, id, 'state.json'), JSON.stringify({ status }));
};

test('parseTokens keeps only label:sha256 entries; tokens are never stored', () => {
  const t = parseTokens(`a:${hashToken('x'.repeat(30))}\nb:short ${'c'}:${'0'.repeat(64)}`);
  assert.deepEqual(t.map((e) => e.label), ['a', 'c']);
  assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('auth: missing, wrong and short tokens are 401; brute force is rate limited per IP', async () => {
  assert.equal((await fetch(`${base}/forge/me`, { headers: { 'X-Forwarded-For': '10.7.0.1' } })).status, 401);
  assert.equal((await fetch(`${base}/forge/me`, { headers: H('x'.repeat(40), '10.7.0.1') })).status, 401);
  assert.equal((await fetch(`${base}/forge/me`, { headers: H('short', '10.7.0.1') })).status, 401);
  assert.equal((await fetch(`${base}/forge/me`, { headers: H(T1.slice(0, -1) + 'X', '10.7.0.1') })).status, 401);
  // 4 failures used up: even the right token is refused from this IP for the window
  assert.equal((await fetch(`${base}/forge/me`, { headers: H(T1, '10.7.0.1') })).status, 429);
  const me = await fetch(`${base}/forge/me`, { headers: H(T1, '10.7.0.2') });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { label: 'alice', jobs_today: 0, jobs_per_day: 3, active: null, spent_today_usd: 0, daily_usd: 5 });
});

test('CORS: allowed origin gets headers, other origins 403', async () => {
  const pre = await fetch(`${base}/forge/jobs`, { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Authorization/);
  const bad = await fetch(`${base}/forge/me`, { headers: { ...H(T1), Origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
});

test('input limits: length, control characters, JSON, body size', async () => {
  assert.equal((await create(T1, 'short')).status, 400);
  assert.equal((await create(T1, 'x'.repeat(1201))).status, 400);
  assert.equal((await create(T1, 'SO-101 ‮ bidi trick')).status, 400);
  assert.equal((await create(T1, 42)).status, 400);
  const notJson = await fetch(`${base}/forge/jobs`, { method: 'POST', headers: H(T1), body: '{nope' });
  assert.equal(notJson.status, 400);
  const big = await fetch(`${base}/forge/jobs`, { method: 'POST', headers: H(T1), body: JSON.stringify({ request: 'x'.repeat(9000) }) });
  assert.equal(big.status, 413);
});

test('create queues a job for the worker; one active job per token; owner-only access', async () => {
  const r = await create(T1);
  assert.equal(r.status, 202);
  const { id } = (await r.json()) as { id: string };
  assert.match(id, /^[0-9a-f]{32}$/);
  const q = JSON.parse(readFileSync(join(jobs, 'queue', `${id}.json`), 'utf8'));
  assert.equal(q.request, 'SO-101 s baterkou na chapadle');
  assert.equal(q.lang, 'cs');
  const meta = readFileSync(join(jobs, id, 'meta.json'), 'utf8');
  assert.ok(!meta.includes(T1) && !meta.includes(hashToken(T1)), 'meta holds the label only');
  assert.equal(JSON.parse(meta).label, 'alice');
  const busy = await create(T1);
  assert.equal(busy.status, 409);
  assert.equal(((await busy.json()) as { active: string }).active, id);
  // bob cannot see alice's job
  assert.equal((await fetch(`${base}/forge/jobs/${id}`, { headers: H(T2) })).status, 404);
  const st = await fetch(`${base}/forge/jobs/${id}`, { headers: H(T1) });
  assert.equal(((await st.json()) as { status: string }).status, 'queued');
  finish(id);
});

test('daily job quota per token', async () => {
  // alice already has 1 job today; quota is 3
  for (let i = 0; i < 2; i++) {
    const r = await create(T1);
    assert.equal(r.status, 202);
    finish(((await r.json()) as { id: string }).id);
  }
  assert.equal((await create(T1)).status, 429);
  clock += 86_400_000; // next UTC day
  const r = await create(T1);
  assert.equal(r.status, 202);
  finish(((await r.json()) as { id: string }).id);
});

test('daily spend cap refuses new jobs', async () => {
  mkdirSync(join(jobs, 'spend'), { recursive: true });
  const day = new Date(clock).toISOString().slice(0, 10);
  writeFileSync(join(jobs, 'spend', `${day}.json`), JSON.stringify({ usd: 5.01, tokens: 1, calls: 1 }));
  const r = await create(T2);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'budget_daily' });
  writeFileSync(join(jobs, 'spend', `${day}.json`), JSON.stringify({ usd: 0.5, tokens: 1, calls: 1 }));
  const me = (await (await fetch(`${base}/forge/me`, { headers: H(T2) })).json()) as { spent_today_usd: number };
  assert.equal(me.spent_today_usd, 0.5);
});

test('SSE streams worker events in order, resumes from Last-Event-ID and ends on the end event', async () => {
  const r = await create(T2);
  const { id } = (await r.json()) as { id: string };
  const ev = join(jobs, id, 'events.ndjson');
  const line = (o: object) => appendFileSync(ev, JSON.stringify(o) + '\n');
  line({ seq: 1, type: 'start' });
  line({ seq: 2, type: 'step', step: 'parse', status: 'running' });
  const res = await fetch(`${base}/forge/jobs/${id}/events`, { headers: H(T2) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = '';
  setTimeout(() => line({ seq: 3, type: 'step', step: 'parse', status: 'ok', cost: { cost_usd: 0.01 } }), 60);
  setTimeout(() => line({ seq: 4, type: 'end', status: 'done' }), 120);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
  assert.deepEqual(ids, [1, 2, 3, 4]);
  assert.match(text, /event: forge\ndata: \{"seq":4,"type":"end","status":"done"\}/);
  const again = await (await fetch(`${base}/forge/jobs/${id}/events`, { headers: H(T2, '10.1.0.1', { 'Last-Event-ID': '3' }) })).text();
  assert.deepEqual([...again.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1])), [4]);
  finish(id);
});

test('artifacts: allowlisted names only, attachment, no traversal, no symlinks', async () => {
  const r = await create(T2);
  const { id } = (await r.json()) as { id: string };
  const out = join(jobs, id, 'out');
  mkdirSync(join(out, 'renders'), { recursive: true });
  writeFileSync(join(out, 'part.stl'), 'solid x\nendsolid x\n');
  writeFileSync(join(out, 'guide.cs.html'), '<script>alert(1)</script>');
  writeFileSync(join(out, 'renders', '01-part-600.jpg'), 'jpg');
  writeFileSync(join(out, 'secret.txt'), 'nope');
  writeFileSync(join(dir, 'outside.json'), '{"secret":1}');
  symlinkSync(join(dir, 'outside.json'), join(out, 'report.json'));
  const list = (await (await fetch(`${base}/forge/jobs/${id}/artifacts`, { headers: H(T2) })).json()) as { artifacts: string[] };
  assert.deepEqual(list.artifacts, ['guide.cs.html', 'part.stl', 'renders/01-part-600.jpg']);
  const stl = await fetch(`${base}/forge/jobs/${id}/artifacts/part.stl`, { headers: H(T2) });
  assert.equal(stl.status, 200);
  assert.equal(stl.headers.get('content-disposition'), 'attachment; filename="part.stl"');
  assert.equal(await stl.text(), 'solid x\nendsolid x\n');
  const html = await fetch(`${base}/forge/jobs/${id}/artifacts/guide.cs.html`, { headers: H(T2) });
  assert.match(html.headers.get('content-type') ?? '', /^text\/plain/);
  assert.match(html.headers.get('content-security-policy') ?? '', /sandbox/);
  for (const bad of ['secret.txt', 'report.json', '..%2Fmeta.json', '../meta.json', 'renders/../../meta.json'])
    assert.equal((await fetch(`${base}/forge/jobs/${id}/artifacts/${bad}`, { headers: H(T2) })).status, 404, bad);
  assert.equal((await fetch(`${base}/forge/jobs/${id}/artifacts/part.stl`, { headers: H(T1) })).status, 404);
  finish(id);
});

test('cancel: a queued job is removed from the queue and ends at once; a running one gets a cancel marker', async () => {
  const r = await create(T2);
  const { id } = (await r.json()) as { id: string };
  const c = await fetch(`${base}/forge/jobs/${id}/cancel`, { method: 'POST', headers: H(T2) });
  assert.deepEqual(await c.json(), { id, status: 'cancelled' });
  assert.ok(!existsSync(join(jobs, 'queue', `${id}.json`)));
  const sse = await (await fetch(`${base}/forge/jobs/${id}/events`, { headers: H(T2) })).text();
  assert.match(sse, /"status":"cancelled"/);
  assert.equal((await fetch(`${base}/forge/jobs/${id}/cancel`, { method: 'POST', headers: H(T2) })).status, 409);

  clock += 86_400_000; // bob's daily quota (3) is used up today
  const r2 = await create(T2);
  const id2 = ((await r2.json()) as { id: string }).id;
  // the worker claimed it
  readdirSync(join(jobs, 'queue')).forEach((f) => f.startsWith(id2) && rmSync(join(jobs, 'queue', f)));
  writeFileSync(join(jobs, id2, 'state.json'), JSON.stringify({ status: 'running' }));
  const c2 = await fetch(`${base}/forge/jobs/${id2}/cancel`, { method: 'POST', headers: H(T2) });
  assert.deepEqual(await c2.json(), { id: id2, status: 'cancelling' });
  assert.ok(existsSync(join(jobs, id2, 'cancel')));
  finish(id2, 'cancelled');
});

test('queue cap', async () => {
  const q = join(jobs, 'queue');
  for (let i = 0; i < 5; i++) writeFileSync(join(q, `${String(i).repeat(32)}.json`), '{}');
  assert.deepEqual(await (await create(T1)).json(), { error: 'queue_full' });
  for (let i = 0; i < 5; i++) rmSync(join(q, `${String(i).repeat(32)}.json`));
});

test('forge routes are 404 forge_disabled when the forge is off', async () => {
  const s = createApi({ store, version: 'x', allowedOrigins: [ORIGIN], trustProxy: false });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/forge/me`, { headers: H(T1) });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'forge_disabled' });
  s.close();
});
