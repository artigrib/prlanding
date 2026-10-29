// Replay codec: compact, chunked, delta + run-length + varint encoded snapshots (no three.js, no DOM).
//
// A replay is a fixed set of numeric channels sampled at HZ (30 Hz). Every channel has a quantisation
// step q (value = round(x * q)). Ticks are grouped in chunks of CHUNK ticks; each chunk is encoded
// channel-major: the first value of a channel absolutely, then the differences to the previous tick,
// with runs of unchanged values collapsed into one token. A chunk decodes on its own, so the recorder
// can drop the oldest chunks (ring buffer) and the player can decode lazily (small LRU cache).
//
// Token stream per channel (unsigned LEB128 varints):
//   first:  zigzag(value)
//   then:   (zigzag(delta) << 1)  for a changed value, or  (run << 1) | 1  for `run` unchanged ticks.
//
// File (.prreplay): gzip(JSON { format: 'prreplay', v, hz, chunkTicks, layout: [[name, q], ...],
//   header, events, start, chunks: [{ k, n, d: base64 }] }). Uncompressed JSON is accepted on import.

export const HZ = 30;
export const CHUNK = 150;            // 5 s per chunk
export const FORMAT = 'prreplay';
export const VERSION = 1;

const LIM = 536870911;                            // |quantised value| < 2^29: deltas stay inside int32
const zz = v => (v << 1) ^ (v >> 31);            // int32 -> uint32 (as a JS number, >>> 0 below)
const unzz = u => (u >>> 1) ^ -(u & 1);

class Bytes {
  constructor(n = 1024) { this.b = new Uint8Array(n); this.n = 0; }
  push(v) { if (this.n >= this.b.length) { const nb = new Uint8Array(this.b.length * 2); nb.set(this.b); this.b = nb; } this.b[this.n++] = v; }
  varint(u) {
    // u: non-negative integer < 2^53
    while (u >= 0x80) { this.push((u % 0x80) | 0x80); u = Math.floor(u / 0x80); }
    this.push(u);
  }
  out() { return this.b.slice(0, this.n); }
}

// encode a chunk: raw Int32Array tick-major [n * ch] -> Uint8Array
export function encodeChunk(raw, n, ch) {
  const w = new Bytes(Math.max(256, n * 2));
  for (let c = 0; c < ch; c++) {
    let prev = raw[c];
    w.varint(zz(prev) >>> 0);
    let run = 0;
    for (let k = 1; k < n; k++) {
      const v = raw[k * ch + c], d = v - prev;
      if (d === 0) { run++; continue; }
      if (run) { w.varint(run * 2 + 1); run = 0; }
      w.varint((zz(d) >>> 0) * 2);
      prev = v;
    }
    if (run) w.varint(run * 2 + 1);
  }
  return w.out();
}

// decode a chunk -> Int32Array tick-major [n * ch]
export function decodeChunk(bytes, n, ch) {
  const out = new Int32Array(n * ch);
  let i = 0;
  const rd = () => {
    let u = 0, m = 1, b;
    do { if (i >= bytes.length) throw new Error('replay: truncated chunk'); b = bytes[i++]; u += (b & 0x7f) * m; m *= 0x80; } while (b & 0x80);
    return u;
  };
  for (let c = 0; c < ch; c++) {
    let v = unzz(rd());
    out[c] = v;
    let k = 1;
    while (k < n) {
      const t = rd();
      if (t & 1) { const run = (t - 1) / 2; for (let r = 0; r < run && k < n; r++, k++) out[k * ch + c] = v; }
      else { v += unzz(t / 2); out[k * ch + c] = v; k++; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- recorder (ring buffer of chunks)
export class Recorder {
  // layout: [[name, q], ...]
  constructor(layout, { maxSeconds = 300 } = {}) {
    this.layout = layout.map(([n, q]) => [n, q]);
    this.ch = layout.length;
    this.q = Float64Array.from(layout, l => l[1]);
    this.maxTicks = Math.ceil(maxSeconds * HZ / CHUNK) * CHUNK;
    this.chunks = [];               // { k, n, d: Uint8Array }
    this.raw = new Int32Array(CHUNK * this.ch);
    this.n = 0;                     // ticks in the open chunk
    this.k0 = 0;                    // tick index of the open chunk
    this.ticks = 0;                 // total ticks pushed
    this.events = [];
  }
  get start() { return this.chunks.length ? this.chunks[0].k : this.k0; }
  get end() { return this.ticks; }                // exclusive
  get length() { return this.ticks - this.start; }
  get duration() { return this.length / HZ; }
  get time() { return this.ticks / HZ; }
  push(values) {
    const o = this.n * this.ch, q = this.q, raw = this.raw;
    for (let c = 0; c < this.ch; c++) {
      const v = Math.round(values[c] * q[c]);
      raw[o + c] = v > LIM ? LIM : v < -LIM ? -LIM : (v || 0);
    }
    this.n++; this.ticks++;
    if (this.n === CHUNK) this.seal();
  }
  seal() {
    if (!this.n) return;
    this.chunks.push({ k: this.k0, n: this.n, d: encodeChunk(this.raw, this.n, this.ch) });
    this.k0 += this.n; this.n = 0;
    while (this.chunks.length > 1 && this.ticks - this.chunks[0].k - this.chunks[0].n >= this.maxTicks) this.chunks.shift();
    const t0 = this.start / HZ;
    while (this.events.length && this.events[0].t < t0) this.events.shift();
  }
  event(e) { e.t = +(Math.max(0, this.ticks - 1) / HZ).toFixed(3); this.events.push(e); if (this.events.length > 2000) this.events.shift(); return e; }
  // all chunks including the open one (without sealing it: recording can go on)
  allChunks() {
    const list = this.chunks.slice();
    if (this.n) list.push({ k: this.k0, n: this.n, d: encodeChunk(this.raw, this.n, this.ch) });
    return list;
  }
  bytes() { let s = 0; for (const c of this.chunks) s += c.d.length; return s + this.n * this.ch * 4; }
  track() { return new Track(this.layout, this.allChunks(), this.events.slice()); }
}

// ---------------------------------------------------------------- track (decoded view for playback)
export class Track {
  constructor(layout, chunks, events = [], header = {}) {
    this.layout = layout; this.ch = layout.length; this.header = header;
    this.index = Object.assign(Object.create(null), Object.fromEntries(layout.map(([n], i) => [n, i])));
    this.inv = Float64Array.from(layout, l => 1 / l[1]);
    this.chunks = chunks.slice().sort((a, b) => a.k - b.k);
    this.start = this.chunks.length ? this.chunks[0].k : 0;
    const last = this.chunks[this.chunks.length - 1];
    this.end = last ? last.k + last.n : 0;
    this.events = events.slice().sort((a, b) => a.t - b.t);
    this.cache = new Map();
  }
  get t0() { return this.start / HZ; }
  get t1() { return Math.max(this.start, this.end - 1) / HZ; }
  get duration() { return this.t1 - this.t0; }
  chunkAt(k) {
    const cs = this.chunks;
    let lo = 0, hi = cs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cs[m].k <= k) lo = m; else hi = m - 1; }
    const c = cs[lo];
    let f = this.cache.get(c);
    if (!f) {
      const raw = decodeChunk(c.d, c.n, this.ch);
      f = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i++) f[i] = raw[i] * this.inv[i % this.ch];
      if (this.cache.size >= 6) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(c, f);
    }
    return { c, f };
  }
  // values of tick k (absolute tick index), copied into out
  frame(k, out = new Float32Array(this.ch)) {
    k = Math.max(this.start, Math.min(this.end - 1, k));
    const { c, f } = this.chunkAt(k), o = (k - c.k) * this.ch;
    for (let i = 0; i < this.ch; i++) out[i] = f[o + i];
    return out;
  }
  // linear interpolation at time t (s); quaternions are blended here and renormalised by the caller
  sample(t, out = new Float32Array(this.ch), tmp = new Float32Array(this.ch)) {
    const x = Math.max(this.start, Math.min(this.end - 1, t * HZ));
    const k = Math.floor(x), f = x - k;
    this.frame(k, out);
    if (f > 1e-6 && k + 1 < this.end) {
      this.frame(k + 1, tmp);
      for (let i = 0; i < this.ch; i++) out[i] += (tmp[i] - out[i]) * f;
    }
    return out;
  }
  get(out, name) { const i = this.index[name]; return i == null ? 0 : out[i]; }
}

// ---------------------------------------------------------------- file format
const b64 = {
  enc(u8) {
    if (typeof Buffer !== 'undefined' && !globalThis.window) return Buffer.from(u8).toString('base64');
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(s) {
    if (typeof Buffer !== 'undefined' && !globalThis.window) return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
};

export function toJSON(track, header = {}) {
  return {
    format: FORMAT, v: VERSION, hz: HZ, chunkTicks: CHUNK,
    layout: track.layout, header, events: track.events, start: track.start,
    chunks: track.chunks.map(c => ({ k: c.k, n: c.n, d: b64.enc(c.d) }))
  };
}
// limits for imported files (a 3-minute match is ~200 channels and ~36 chunks)
export const LIMITS = { channels: 2000, chunks: 2000, events: 5000, inflated: 64 * 1024 * 1024, file: 20 * 1024 * 1024 };
export class ReplayError extends Error {}
const bad = m => new ReplayError(m || 'Poškozený záznam.');
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const EV_TYPES = new Set(['hit', 'fire', 'flip', 'pit', 'out', 'ko', 'wheel', 'sep']);
const num = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
// events: copy only known fields (the file is untrusted)
function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !num(e.t, 0, 1e6) || !EV_TYPES.has(e.type)) return null;
  const o = { t: e.t, type: e.type };
  if (num(e.by, -1, 1)) o.by = e.by | 0;
  if (num(e.who, -1, 1)) o.who = e.who | 0;
  if (num(e.e, 0, 10)) o.e = e.e;
  if (e.p && num(e.p.x, -1e3, 1e3) && num(e.p.z, -1e3, 1e3)) o.p = { x: e.p.x, y: num(e.p.y, -1e3, 1e3) ? e.p.y : 0, z: e.p.z };
  return o;
}
export function fromJSON(o) {
  if (!o || typeof o !== 'object' || o.format !== FORMAT) throw bad('Soubor není záznam z arény.');
  if (!num(o.v, 1, 1e6)) throw bad();
  if (o.v > VERSION) throw bad('Záznam je z novější verze arény.');
  if (o.hz !== HZ) throw bad('Nepodporovaná frekvence záznamu.');
  if (!Array.isArray(o.layout) || !Array.isArray(o.chunks)) throw bad();
  if (!o.layout.length || o.layout.length > LIMITS.channels) throw bad();
  if (!o.chunks.length) throw bad('Záznam je prázdný.');
  if (o.chunks.length > LIMITS.chunks) throw bad('Záznam je příliš dlouhý.');
  if (o.events != null && (!Array.isArray(o.events) || o.events.length > LIMITS.events)) throw bad();
  const names = new Set();
  const layout = o.layout.map(l => {
    if (!Array.isArray(l) || typeof l[0] !== 'string' || !/^[\w.]{1,40}$/.test(l[0]) || FORBIDDEN.has(l[0]) || names.has(l[0])) throw bad();
    if (!num(l[1], 1e-6, 1e6)) throw bad();
    names.add(l[0]);
    return [l[0], l[1]];
  });
  // chunks: 1..CHUNK ticks each, contiguous, ascending
  let next = null;
  const chunks = o.chunks.map(c => {
    if (!c || typeof c !== 'object' || !Number.isInteger(c.k) || !Number.isInteger(c.n) || c.k < 0 || c.n < 1 || c.n > CHUNK || typeof c.d !== 'string') throw bad();
    if (next != null && c.k !== next) throw bad();
    next = c.k + c.n;
    let d;
    try { d = b64.dec(c.d); } catch (_) { throw bad(); }
    return { k: c.k, n: c.n, d };
  });
  const events = (o.events || []).map(cleanEvent).filter(Boolean);
  const header = o.header && typeof o.header === 'object' && !Array.isArray(o.header) ? o.header : {};
  const tr = new Track(layout, chunks, events, header);
  // validate every chunk once (throws on garbage instead of failing mid-playback)
  for (const c of tr.chunks) { try { decodeChunk(c.d, c.n, tr.ch); } catch (_) { throw bad(); } }
  return tr;
}

const hasCS = () => typeof CompressionStream !== 'undefined' && typeof Response !== 'undefined';
export async function gzip(u8) {
  if (!hasCS()) return null;
  const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
// inflate with a hard cap on the output size (gzip bombs)
export async function gunzip(u8, max = LIMITS.inflated) {
  const rd = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts = []; let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.length;
    if (n > max) { rd.cancel().catch(() => {}); throw bad('Záznam je po rozbalení příliš velký.'); }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// -> Uint8Array (gzip when the browser can, plain JSON otherwise)
export async function serialize(track, header) {
  const json = new TextEncoder().encode(JSON.stringify(toJSON(track, header)));
  return (await gzip(json)) || json;
}
export async function deserialize(u8, limits = LIMITS) {
  try {
    if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
    if (u8.length > limits.file) throw bad('Soubor je příliš velký.');
    if (u8[0] === 0x1f && u8[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') throw bad('Tento prohlížeč neumí rozbalit záznam.');
      try { u8 = await gunzip(u8, limits.inflated); } catch (e) { throw e instanceof ReplayError ? e : bad(); }
    }
    let o;
    try { o = JSON.parse(new TextDecoder().decode(u8)); } catch (_) { throw bad('Soubor není záznam z arény.'); }
    return fromJSON(o);
  } catch (e) {
    // never surface raw engine errors (RangeError, …) to the Czech UI
    throw e instanceof ReplayError ? e : bad();
  }
}

// ?replay=<path> hook: same-origin relative paths only (no scheme, no //host, no backslash, no '..')
export function isLocalReplayPath(p, base) {
  if (typeof p !== 'string' || !p || p.length > 200 || p.startsWith('//') || p.includes('..') || !/^\/?[\w\-./]+$/.test(p)) return false;
  try { const b = new URL(base); return new URL(p, b).origin === b.origin; } catch (_) { return false; }
}
