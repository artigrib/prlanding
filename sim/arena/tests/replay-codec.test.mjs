// Unit tests for the replay codec (node >= 18, no browser): node tests/replay-codec.test.mjs
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { Recorder, Track, encodeChunk, decodeChunk, serialize, deserialize, toJSON, ReplayError, isLocalReplayPath, LIMITS, HZ, CHUNK } from '../src/replay/codec.js';
import { sanitizeHazards, createBinding } from '../src/replay/scene.js';

let pass = 0;
const test = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

await test('chunk round trip (runs, big deltas, negatives)', () => {
  const ch = 4, n = 150, raw = new Int32Array(n * ch);
  for (let k = 0; k < n; k++) { raw[k * ch] = 7; raw[k * ch + 1] = k * 1000 - 50000; raw[k * ch + 2] = k % 9 ? 0 : 400000000; raw[k * ch + 3] = (k * 7919) % 31 - 15; }
  assert.deepEqual(decodeChunk(encodeChunk(raw, n, ch), n, ch), raw);
});

// a synthetic 3-minute match with the real channel count of a 2-robot arena (~170 channels)
function synthLayout() {
  const L = [];
  for (const r of [0, 1]) {
    for (const k of ['px', 'py', 'pz']) L.push([`r${r}.${k}`, 1000]);
    for (const k of ['qx', 'qy', 'qz', 'qw']) L.push([`r${r}.${k}`, 10000]);
    for (const k of ['wl', 'wr', 'blade']) L.push([`r${r}.${k}`, 100]);
    for (const k of ['arm', 'jaw', 'hp']) L.push([`r${r}.${k}`, 1000]);
    L.push([`r${r}.spin`, 100], [`r${r}.flip`, 10], [`r${r}.hits`, 1], [`r${r}.lost`, 1]);
    for (let w = 0; w < 8; w++) for (const k of ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw']) L.push([`r${r}.w${w}${k}`, k[0] === 'q' ? 10000 : 1000]);
  }
  for (let h = 0; h < 3; h++) for (const k of ['theta', 'y', 'state']) L.push([`h${h}.${k}`, 1000]);
  for (let d = 0; d < 6; d++) for (const k of ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw']) L.push([`d${d}${k}`, k[0] === 'q' ? 10000 : 1000]);
  return L;
}
function synthFrame(L, k, out) {
  const t = k / HZ;
  L.forEach(([n], i) => {
    let v = 0;
    if (/^r\d\.p[xz]$/.test(n)) v = 4 * Math.sin(t * 0.7 + i) + Math.sin(t * 5.3) * 0.2;
    else if (/^r\d\.py$/.test(n)) v = 0.27 + (k % 400 < 30 ? Math.sin((k % 400) / 30 * Math.PI) * 0.6 : 0);
    else if (/^r\d\.qy$/.test(n)) v = Math.sin(t * 0.9 + i);
    else if (/^r\d\.qw$/.test(n)) v = Math.cos(t * 0.9 + i);
    else if (/^r\d\.w[lr]$/.test(n)) v = t * 18;
    else if (/blade$/.test(n)) v = t * 40;
    else if (/spin$/.test(n)) v = Math.min(1, t / 2);
    else if (/hp$/.test(n)) v = 1 - Math.floor(t / 10) * 0.04;
    else if (/hits$/.test(n)) v = Math.floor(t / 7);
    else if (/^h\d\.theta$/.test(n)) v = (k % 300 < 60) ? (k % 300) / 60 : 0;
    else if (/qw$/.test(n)) v = 1;
    out[i] = v;
  });
  return out;
}

await test('record -> serialize -> deserialize -> same values at sampled ticks', async () => {
  const L = synthLayout(), rec = new Recorder(L, { maxSeconds: 400 });
  const f = new Float64Array(L.length), ticks = 180 * HZ, keep = new Map();
  for (let k = 0; k < ticks; k++) { synthFrame(L, k, f); rec.push(f); if (k % 97 === 0 || k === ticks - 1) keep.set(k, Float64Array.from(f)); }
  const bytes = await serialize(rec.track(), { test: true });
  const tr = await deserialize(bytes);
  assert.equal(tr.start, 0); assert.equal(tr.end, ticks); assert.equal(tr.header.test, true);
  for (const [k, want] of keep) {
    const got = tr.frame(k);
    L.forEach(([n, q], i) => assert.ok(Math.abs(got[i] - want[i]) <= 0.5 / q + 1e-6, `${n} @${k}: ${got[i]} vs ${want[i]}`));
  }
  // interpolation between ticks
  const mid = tr.sample(10.5 / HZ), a = tr.frame(10), b = tr.frame(11);
  assert.ok(Math.abs(mid[0] - (a[0] + b[0]) / 2) < 1e-4);
  console.log(`    3 min, ${L.length} channels: ${Math.round(bytes.length / 1024)} kB on disk, ${Math.round(rec.bytes() / 1024)} kB in memory`);
  assert.ok(bytes.length < 300 * 1024, 'size budget: < 300 kB per 3-minute match');
});

await test('ring buffer keeps the newest window and its events', () => {
  const L = [['x', 100]], rec = new Recorder(L, { maxSeconds: 20 });
  for (let k = 0; k < 60 * HZ; k++) { rec.push([k]); if (k % HZ === 0) rec.event({ type: 'hit', e: 1 }); }
  assert.ok(rec.duration >= 20 && rec.duration <= 20 + CHUNK / HZ + 1e-9, String(rec.duration));
  const tr = rec.track();
  assert.equal(tr.frame(tr.end - 1)[0], 60 * HZ - 1);
  assert.ok(tr.events.every(e => e.t >= tr.t0 - 1e-9));
});

await test('rejects garbage', async () => {
  await assert.rejects(deserialize(new TextEncoder().encode('{"hello":1}')));
  await assert.rejects(deserialize(new Uint8Array([1, 2, 3])));
});


// ---------------------------------------------------------------- malformed / hostile files
function validJSON() {
  const rec = new Recorder([['a', 100], ['b', 1000]], { maxSeconds: 60 });
  for (let k = 0; k < 400; k++) rec.push([k / 10, Math.sin(k / 9)]);
  rec.event({ type: 'hit', by: 0, e: 0.8, p: { x: 1, y: 0.2, z: 2 } });
  return JSON.parse(JSON.stringify(toJSON(rec.track(), { map: 'x' })));
}
const enc = o => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
const czech = e => e instanceof ReplayError && !/RangeError|undefined|Cannot|Unexpected|Invalid|truncated/i.test(e.message);
async function rejectsCzech(bytes, re) {
  await assert.rejects(deserialize(bytes), e => { assert.ok(czech(e), 'Czech ReplayError, got: ' + e.constructor.name + ' ' + e.message); if (re) assert.match(e.message, re); return true; });
}
await test('valid file still loads', async () => { const tr = await deserialize(enc(validJSON())); assert.equal(tr.end, 400); });
await test('rejects empty chunks', () => rejectsCzech(enc({ ...validJSON(), chunks: [] }), /prázdný/));
await test('rejects chunks with n <= 0, n > CHUNK, non-integer k, gaps, overlaps', async () => {
  for (const f of [c => { c[0].n = 0; }, c => { c[0].n = -5; }, c => { c[0].n = CHUNK + 1; }, c => { c[0].k = 0.5; }, c => { c[1].k += 3; }, c => { c[1].k -= 1; }, c => { c[0].d = 7; }, c => { c[0].d = '!!!'; }, c => { c[0].d = ''; }]) {
    const o = validJSON(); f(o.chunks); await rejectsCzech(enc(o));
  }
});
await test('rejects bad layout (empty, too many channels, __proto__, bad q)', async () => {
  for (const L of [[], Array.from({ length: LIMITS.channels + 1 }, (_, i) => ['c' + i, 1]), [['__proto__', 1], ['b', 1]], [['a', 0], ['b', 1]], [['a', 'x'], ['b', 1]], [['a', 1], ['a', 1]]]) {
    const o = validJSON(); o.layout = L; await rejectsCzech(enc(o));
  }
});
await test('rejects too many chunks / events', async () => {
  let o = validJSON(); o.chunks = Array.from({ length: LIMITS.chunks + 1 }, (_, i) => ({ k: i, n: 1, d: 'AA==' })); await rejectsCzech(enc(o), /dlouhý/);
  o = validJSON(); o.events = Array.from({ length: LIMITS.events + 1 }, () => ({ t: 1, type: 'hit' })); await rejectsCzech(enc(o));
});
await test('gzip bomb is aborted by inflated size', async () => {
  const bomb = gzipSync(Buffer.alloc(LIMITS.inflated + 1024 * 1024, 0x20));
  assert.ok(bomb.length < 1024 * 1024);
  await rejectsCzech(new Uint8Array(bomb), /rozbalení/);
});
await test('garbage gzip / JSON / non-object -> Czech error', async () => {
  await rejectsCzech(new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4]));
  await rejectsCzech(enc('null')); await rejectsCzech(enc('[1,2]')); await rejectsCzech(enc('"prreplay"'));
});
await test('__proto__ keys do not pollute and unknown events are dropped', async () => {
  const o = validJSON();
  const txt = JSON.stringify(o).replace('"header":{', '"header":{"__proto__":{"polluted":1},').replace('"events":[', '"events":[{"t":1,"type":"__proto__"},{"t":1,"type":"hit","__proto__":{"x":1},"evil":2},');
  const tr = await deserialize(enc(txt));
  assert.equal(({}).polluted, undefined); assert.equal(Object.prototype.polluted, undefined);
  assert.ok(tr.events.every(e => e.type === 'hit' && !('evil' in e)));
  assert.equal(tr.index.__proto__, undefined);
});
await test('hazard specs: whitelist keys, kinds, integer indices', () => {
  const ok = [{ i: 0, keys: [{ k: 'theta', kind: 'num' }, { k: 'state', kind: 'enum', table: ['idle', 'up'] }] }];
  assert.deepEqual(sanitizeHazards(ok), ok);
  assert.deepEqual(sanitizeHazards(null), []);
  for (const b of [[null], 'x', [{ i: 0.5, keys: [] }], [{ i: -1, keys: [] }], [{ i: 0, keys: [{ k: '__proto__', kind: 'num' }] }], [{ i: 0, keys: [{ k: 'applyPose', kind: 'num' }] }],
    [{ i: 0, keys: [{ k: 'theta', kind: 'fn' }] }], [{ i: 0, keys: [{ k: 'state', kind: 'enum', table: [{}] }] }], [{ i: 0, keys: null }], [{ i: 0, keys: [] }, { i: 0, keys: [] }]])
    assert.equal(sanitizeHazards(b), null, JSON.stringify(b));
  assert.throws(() => createBinding([], { hazards: [] }, [null]));
});
await test('?replay= accepts same-origin relative paths only', () => {
  const base = 'https://printedrobotics.cz/sim/arena/?x';
  for (const p of ['replays/a.prreplay', '/r/abc.prreplay', 'a-b_c.prreplay']) assert.ok(isLocalReplayPath(p, base), p);
  for (const p of ['//evil.com/x.prreplay', 'https://evil.com/x', 'http:evil.com', '/\\evil.com', '../x', 'a/../../x', 'javascript:alert(1)', '', null, '/%2F%2Fevil'])
    assert.ok(!isLocalReplayPath(p, base), String(p));
});

console.log(`${pass} passed`);
