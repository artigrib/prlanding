// Unit tests for the replay codec (node >= 18, no browser): node tests/replay-codec.test.mjs
import assert from 'node:assert/strict';
import { Recorder, Track, encodeChunk, decodeChunk, serialize, deserialize, HZ, CHUNK } from '../src/replay/codec.js';

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

console.log(`${pass} passed`);
