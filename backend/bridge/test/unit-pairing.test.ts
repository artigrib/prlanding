import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeError, Registry } from '../src/rooms.ts';
import { openTab, pair, testConfig, TINY_JPEG_B64 } from './helpers.ts';

const rejectsWith = async (p: Promise<unknown>, code: string) => {
  await assert.rejects(p, (e: unknown) => { assert.ok(e instanceof BridgeError, String(e)); assert.equal((e as BridgeError).code, code); return true; });
};

test('welcome carries a formatted 8-char code, TTL and heartbeat', () => {
  const reg = new Registry(testConfig());
  const tab = openTab(reg);
  const w = tab.last('welcome')!;
  assert.match(w.code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  assert.equal(w.ttlMs, 600_000);
  assert.equal(typeof w.hb, 'number');
});

test('connect needs the tab to Allow; code is single use; session handle is 128-bit', async () => {
  const reg = new Registry(testConfig());
  const tab = openTab(reg);
  const code = tab.code;
  tab.autoApprove = 'allow';
  const { session } = await reg.connect(code.toLowerCase(), '1.1.1.1', 'claude-code');
  assert.match(session, /^s_[A-Za-z0-9_-]{22}$/);
  assert.equal(tab.last('pair_request')!.client.name, 'claude-code');
  assert.ok(tab.last('paired'));
  assert.ok(!JSON.stringify(tab.sent).includes(session), 'the tab never sees the session handle');
  await rejectsWith(reg.connect(code, '1.1.1.1', 'x'), 'PAIRING_FAILED');
});

test('deny rotates the code; timeout counts as a wrong try', async () => {
  const reg = new Registry(testConfig({ approvalTimeoutMs: 20 }));
  const tab = openTab(reg);
  const c1 = tab.code;
  tab.autoApprove = 'deny';
  await rejectsWith(reg.connect(c1, '1.1.1.1', 'x'), 'PAIRING_DENIED');
  assert.notEqual(tab.code, c1, 'a denial burns the code');
  tab.autoApprove = null;
  const c2 = tab.code;
  await rejectsWith(reg.connect(c2, '1.1.1.2', 'x'), 'PAIRING_DENIED'); // timeout
  assert.equal(tab.code, c2, 'one timeout keeps the code');
  assert.equal(tab.last('pair_cancel')!.reason, 'timeout');
});

test('5 wrong tries burn the code (timeouts and near-miss guesses)', async () => {
  const reg = new Registry(testConfig({ approvalTimeoutMs: 5 }));
  const tab = openTab(reg);
  const c = tab.code.replace('-', '');
  // near misses: change the last character (Hamming distance 1)
  const alt = (ch: string) => (ch === 'B' ? 'C' : 'B');
  for (let i = 0; i < 4; i++) await rejectsWith(reg.connect(c.slice(0, 7) + alt(c[7]!), `9.9.9.${i}`, 'x'), 'PAIRING_FAILED');
  assert.equal(tab.code.replace('-', ''), c, 'still alive after 4');
  await rejectsWith(reg.connect(c, '9.9.9.9', 'x'), 'PAIRING_DENIED'); // 5th: a timeout on the real code
  assert.notEqual(tab.code.replace('-', ''), c, 'burned after the 5th');
});

test('expired codes fail and are replaced', async () => {
  let now = 1_000_000;
  const reg = new Registry(testConfig(), () => now);
  const tab = openTab(reg);
  const c = tab.code;
  now += 600_001;
  await rejectsWith(reg.connect(c, '1.1.1.1', 'x'), 'PAIRING_FAILED');
  assert.notEqual(tab.code, c);
});

test('per-IP: 20 connects/min, then 10 failures in 10 min trigger a 15 min cool-down', async () => {
  let now = 0;
  const reg = new Registry(testConfig(), () => now);
  openTab(reg);
  for (let i = 0; i < 10; i++) await rejectsWith(reg.connect('BBBB-BBBB', '6.6.6.6', 'x'), 'PAIRING_FAILED');
  await rejectsWith(reg.connect('BBBB-BBBB', '6.6.6.6', 'x'), 'RATE_LIMITED');
  now += 15 * 60_000 + 1;
  await rejectsWith(reg.connect('BBBB-BBBB', '6.6.6.6', 'x'), 'PAIRING_FAILED');
  // a different IP is not affected; burst limit of 20/min
  let limited = false;
  for (let i = 0; i < 25; i++) {
    try { await reg.connect('not a code', '7.7.7.7', 'x'); } catch (e) { if ((e as BridgeError).code === 'RATE_LIMITED') limited = true; }
  }
  assert.ok(limited);
});

test('only one pending pairing per tab (second gets BUSY); session cap gives CAPACITY', async () => {
  const reg = new Registry(testConfig({ approvalTimeoutMs: 100, maxSessions: 1 }));
  const tab = openTab(reg);
  const p1 = reg.connect(tab.code, '1.1.1.1', 'a');
  await rejectsWith(reg.connect(tab.code, '1.1.1.2', 'b'), 'BUSY');
  reg.onTabMessage(tab.room, { t: 'approve', pairId: tab.last('pair_request')!.pairId, decision: 'allow' });
  await p1;
  const tab2 = openTab(reg, '10.0.0.2');
  await rejectsWith(reg.connect(tab2.code, '1.1.1.3', 'c'), 'CAPACITY');
});

test('tab limits: per-IP sockets and global rooms', () => {
  const reg = new Registry(testConfig({ maxTabsPerIp: 2, maxRooms: 3 }));
  openTab(reg, 'a'); openTab(reg, 'a');
  assert.equal(reg.canAdmit('a'), 'RATE_LIMITED');
  openTab(reg, 'b');
  assert.equal(reg.canAdmit('c'), 'CAPACITY');
});

test('calls: routed to the tab without the handle, results sanitized, unknown session errors', async () => {
  const reg = new Registry(testConfig());
  const tab = openTab(reg);
  const s = await pair(reg, tab);
  tab.onCall = (m) => {
    assert.equal(m.args.session, undefined);
    tab.reply(m.id, { joints_deg: { shoulder_pan: 1 }, hud: 'free text from the page' });
  };
  const r = await reg.call(s, 'get_state', { session: s });
  assert.deepEqual(r.structured.joints_deg, { shoulder_pan: 1 });
  assert.equal(r.structured.hud, null);
  assert.equal(r.dropped, 1);
  await rejectsWith(reg.call('s_' + 'x'.repeat(22), 'get_state', {}), 'NOT_CONNECTED');
  await rejectsWith(reg.call('garbage', 'get_state', {}), 'NOT_CONNECTED');
});

test('tab errors map to allow-listed codes; images are validated', async () => {
  const reg = new Registry(testConfig());
  const tab = openTab(reg);
  const s = await pair(reg, tab);
  tab.onCall = (m) => tab.fail(m.id, 'OUT_OF_LIMITS', { joint: 'elbow_flex', value_deg: 120 });
  await rejectsWith(reg.call(s, 'move_joints', { session: s, joints_deg: { elbow_flex: 120 } }), 'OUT_OF_LIMITS');
  tab.onCall = (m) => tab.fail(m.id, 'rm -rf /');
  await rejectsWith(reg.call(s, 'get_state', { session: s }), 'TAB_ERROR');
  tab.onCall = (m) => tab.reply(m.id, { view: 'top' }, { mimeType: 'image/jpeg', data: TINY_JPEG_B64 });
  const r = await reg.call(s, 'snapshot', { session: s });
  assert.equal(r.image!.mimeType, 'image/jpeg');
  await new Promise((res) => setTimeout(res, 1100)); // snapshot bucket: 1/s
  tab.onCall = (m) => tab.reply(m.id, {}, { mimeType: 'image/jpeg', data: 'PHN2Zz48L3N2Zz4=' });
  await rejectsWith(reg.call(s, 'snapshot', { session: s }), 'TAB_ERROR');
});

test('tab disconnect fails in-flight calls fast and later calls with TAB_GONE', async () => {
  const reg = new Registry(testConfig());
  const tab = openTab(reg);
  const s = await pair(reg, tab);
  const inflight = reg.call(s, 'move_joints', { session: s, joints_deg: { elbow_flex: 10 }, duration_s: 5 });
  const t0 = Date.now();
  reg.removeTab(tab.room, 'closed');
  await rejectsWith(inflight, 'TAB_GONE');
  assert.ok(Date.now() - t0 < 100);
  await rejectsWith(reg.call(s, 'get_state', { session: s }), 'TAB_GONE');
});

test('revoke in the tab ends the session and issues a new code', async () => {
  const reg = new Registry(testConfig());
  const tab = openTab(reg);
  const s = await pair(reg, tab);
  reg.onTabMessage(tab.room, { t: 'revoke' });
  assert.equal(tab.last('unpaired')!.reason, 'revoked');
  assert.ok(tab.last('code'));
  await rejectsWith(reg.call(s, 'get_state', { session: s }), 'TAB_GONE');
});

test('idempotency: same request_id returns the first result without re-dispatching', async () => {
  const reg = new Registry(testConfig());
  const tab = openTab(reg);
  const s = await pair(reg, tab);
  let calls = 0;
  tab.onCall = (m) => { calls++; tab.reply(m.id, { motion_id: 'm' + calls, status: 'completed' }); };
  const a = { session: s, joints_deg: { shoulder_pan: 10 }, relative: true, request_id: 'jog-1' };
  const r1 = await reg.call(s, 'move_joints', a);
  const r2 = await reg.call(s, 'move_joints', { ...a });
  assert.equal(calls, 1);
  assert.equal(r2.structured.motion_id, r1.structured.motion_id);
  await rejectsWith(reg.call(s, 'move_joints', { ...a, joints_deg: { shoulder_pan: 20 } }), 'INVALID_ARGUMENT');
  await reg.call(s, 'move_joints', { ...a, request_id: 'jog-2' });
  assert.equal(calls, 2);
  // concurrent duplicates share one dispatch
  const p = [reg.call(s, 'home', { session: s, request_id: 'h' }), reg.call(s, 'home', { session: s, request_id: 'h' })];
  const [h1, h2] = await Promise.all(p);
  assert.equal(calls, 3);
  assert.equal(h1.structured.motion_id, h2.structured.motion_id);
});

test('per-session rate limit and in-flight cap; stop is never rate limited', async () => {
  const reg = new Registry(testConfig({ callsBurst: 3, callsPerSec: 1, maxInflightPerSession: 2 }));
  const tab = openTab(reg);
  const s = await pair(reg, tab);
  const ids: string[] = [];
  tab.onCall = (m) => ids.push(m.id);
  const a = reg.call(s, 'get_state', { session: s });
  const b = reg.call(s, 'get_state', { session: s });
  await rejectsWith(reg.call(s, 'get_state', { session: s }), 'BUSY');
  await rejectsWith(reg.call(s, 'get_state', { session: s }), 'RATE_LIMITED');
  const st = reg.call(s, 'stop', { session: s });
  await new Promise((r) => setTimeout(r, 0));
  for (const id of ids) tab.reply(id, { ok: true });
  await Promise.all([a, b, st]);
});

test('deadline: no answer from the tab gives TIMEOUT and a cancel to the tab', async () => {
  const reg = new Registry(testConfig());
  const tab = openTab(reg);
  const s = await pair(reg, tab);
  const t0 = Date.now();
  await rejectsWith(reg.call(s, 'get_state', { session: s }), 'TIMEOUT'); // 5 s + 1.5 s grace
  assert.ok(Date.now() - t0 >= 6000);
  assert.equal(tab.last('cancel')!.reason, 'deadline');
});

test('client abort sends cancel to the tab', async () => {
  const reg = new Registry(testConfig());
  const tab = openTab(reg);
  const s = await pair(reg, tab);
  const ac = new AbortController();
  const p = reg.call(s, 'move_joints', { session: s, joints_deg: { elbow_flex: 1 } }, ac.signal);
  ac.abort();
  await rejectsWith(p, 'CANCELLED');
  assert.equal(tab.last('cancel')!.reason, 'client');
});

test('idle sessions expire', async () => {
  let now = 0;
  const reg = new Registry(testConfig({ sessionIdleMs: 1000 }), () => now);
  const tab = openTab(reg);
  const s = await pair(reg, tab);
  now += 1001;
  await rejectsWith(reg.call(s, 'get_state', { session: s }), 'TAB_GONE');
  assert.equal(tab.last('unpaired')!.reason, 'expired');
});
