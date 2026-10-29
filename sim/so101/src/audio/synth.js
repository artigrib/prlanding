// Offline DSP toolkit: builds small sample buffers (Float32Array) procedurally, once, at start-up.
// Nothing here touches Web Audio, so it runs in node / workers / OfflineAudioContext harnesses alike.
// Recipes are deterministic (seeded PRNG): the same seed always gives the same sound.
// NOTE: shared verbatim by sim/arena/src/audio/ and sim/so101/src/audio/ (separately deployed sims): keep both copies identical.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const buf = (sr, dur) => new Float32Array(Math.max(1, Math.ceil(sr * dur)));

// RBJ biquad, in place. circular = filter the buffer as one period of a loop (seamless wrap).
export function biquad(x, type, f, q, sr, circular = false) {
  const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }            // band-pass, 0 dB peak
  const a0 = 1 + al, a1 = -2 * cs / a0, a2 = (1 - al) / a0;
  b0 /= a0; b1 /= a0; b2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const n = x.length;
  if (circular) {                     // warm the state with one period, then filter for real
    for (let i = 0; i < n; i++) { const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y; }
  }
  for (let i = 0; i < n; i++) { const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y; }
  return x;
}

// time-varying band-pass (coefficients updated every 32 samples): fc(t) = fn(t)
export function sweepBP(x, fn, q, sr) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, b2 = 0, a1 = 0, a2 = 0;
  for (let i = 0; i < x.length; i++) {
    if ((i & 31) === 0) {
      const w = 2 * Math.PI * Math.min(fn(i / sr), sr * 0.45) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
      b0 = al / a0; b2 = -al / a0; a1 = -2 * Math.cos(w) / a0; a2 = (1 - al) / a0;
    }
    const xi = x[i], y = b0 * xi + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}

export function noise(n, R) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = R() * 2 - 1; return x; }

// add src into dst at sample offset (src may be shorter / overhang is cut), with gain
export function mix(dst, src, at = 0, g = 1, wrap = false) {
  const n = dst.length;
  for (let i = 0; i < src.length; i++) {
    let j = at + i;
    if (j >= n) { if (!wrap) break; j %= n; }
    if (j >= 0) dst[j] += src[i] * g;
  }
  return dst;
}

// damped modes (struck object): modes = [[freq, amp, decaySeconds], ...]
export function modes(dst, sr, t0, list, amp = 1, attack = 0.0004) {
  const s0 = Math.round(t0 * sr), atk = Math.max(1, attack * sr);
  for (const [f, a, tau] of list) {
    if (f > sr * 0.42 || a === 0) continue;
    const w = 2 * Math.PI * f / sr, r = Math.exp(-1 / (tau * sr)), c = Math.cos(w) * r, s = Math.sin(w) * r;
    let re = 1, im = 0;
    const len = Math.min(dst.length - s0, Math.ceil(tau * sr * 7));
    for (let i = 0; i < len; i++) {
      const e = (i < atk ? i / atk : 1) * (i > len * 0.8 ? (len - i) / (len * 0.2) : 1);
      dst[s0 + i] += im * a * amp * e;
      const nr = re * c - im * s; im = re * s + im * c; re = nr;
    }
  }
  return dst;
}

// pitch-dropping sine thump (body of an impact)
export function thump(dst, sr, t0, f0, f1, tauPitch, tauAmp, amp) {
  const s0 = Math.round(t0 * sr), len = Math.min(dst.length - s0, Math.ceil(tauAmp * sr * 6));
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr, f = f1 + (f0 - f1) * Math.exp(-t / tauPitch);
    ph += 2 * Math.PI * f / sr;
    const e = Math.min(1, i / (0.0015 * sr)) * Math.exp(-t / tauAmp) * (i > len * 0.75 ? (len - i) / (len * 0.25) : 1);
    dst[s0 + i] += Math.sin(ph) * e * amp;
  }
  return dst;
}

// filtered noise burst: attack/decay envelope, optional band-pass, optional crackle (sparse grains)
export function burst(dst, sr, t0, { dur = 0.03, amp = 0.5, attack = 0.0005, f = 2000, q = 1, type = 'bp', crackle = 0, R }) {
  const n = Math.ceil(dur * 7 * sr), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = R() * 2 - 1;
    if (crackle) v = R() < crackle ? (R() * 2 - 1) * 3 : v * 0.15;
    const t = i / sr;
    x[i] = v * Math.min(1, t / attack) * Math.exp(-t / dur) * Math.min(1, (n - i) / (n * 0.25));
  }
  if (type) biquad(x, type, f, q, sr);
  return mix(dst, x, Math.round(t0 * sr), amp);
}

// harmonic tone with a pitch glide (servo / gear motor), band-limited
export function whirr(dst, sr, t0, dur, fA, fB, amp, { tilt = 1.5, harm = 24, attack = 0.006, release = 0.03, wobble = 0, grit = 0, top = 6500, R } = {}) {
  const s0 = Math.round(t0 * sr), n = Math.min(dst.length - s0, Math.ceil(dur * sr)), out = new Float32Array(n);
  const amps = []; for (let h = 1; h <= harm; h++) amps.push(Math.pow(h, -tilt) * (h % 2 ? 1 : 0.6));
  const g = new Float32Array(n);
  if (grit) { for (let i = 0; i < n; i++) g[i] = R() * 2 - 1; biquad(g, 'bp', 2400, 1.4, sr); biquad(g, 'lp', 4500, 0.7, sr); }
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, k = t / dur, f = fA * Math.pow(fB / fA, k) * (1 + wobble * Math.sin(2 * Math.PI * 23 * t));
    ph += 2 * Math.PI * f / sr;
    // sin(h*ph) by recurrence: one sin/cos per sample instead of one per harmonic
    const s1 = Math.sin(ph), c2 = 2 * Math.cos(ph), hmax = Math.min(harm, Math.floor(Math.min(sr * 0.4, top) / f));
    let v = 0, sPrev = 0, sCur = s1;
    for (let h = 0; h < hmax; h++) {
      const r = f * (h + 1) / top, fade = r < 0.6 ? 1 : (1 - r) * 2.5;      // soft band edge: no partial pops in/out
      v += sCur * amps[h] * fade; const sn = c2 * sCur - sPrev; sPrev = sCur; sCur = sn;
    }
    v = v * 0.35 + g[i] * grit * (0.6 + 0.4 * Math.sin(ph * 3));
    const e = Math.min(1, t / attack) * Math.min(1, (dur - t) / release);
    out[i] = v * e * amp;
  }
  biquad(out, 'lp', 7000, 0.6, sr); biquad(out, 'lp', 8000, 0.6, sr);   // keep the buzz off the top octave
  return mix(dst, out, s0);
}

// bouncing debris: little plastic chips, intervals shrink like a bounce
export function debris(dst, sr, t0, count, amp, R) {
  let t = t0, d = 0.05 + R() * 0.05, a = amp;
  for (let k = 0; k < count; k++) {
    const f = 3000 + R() * 2600;
    modes(dst, sr, t, [[f, 1, 0.0025], [f * 1.7, 0.5, 0.0015]], a);
    t += d; d *= 0.62; a *= 0.7;
  }
  return dst;
}

export function peak(x) { let p = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > p) p = v; } return p; }
export function normalize(x, to = 0.85) { const p = peak(x); if (p > 0) { const g = to / p; for (let i = 0; i < x.length; i++) x[i] *= g; } return x; }
export function fadeOut(x, sr, sec = 0.01) { const n = Math.min(x.length, Math.ceil(sec * sr)); for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n; return x; }
// remove DC (one-pole high-pass ~20 Hz), keeps sub-bass rumble out of tiny speakers
export function dcBlock(x, sr, circular = false) {
  const r = 1 - 2 * Math.PI * 20 / sr, n = x.length; let px = 0, py = 0;
  if (circular) for (let i = 0; i < n; i++) { const y = x[i] - px + r * py; px = x[i]; py = y; }
  for (let i = 0; i < n; i++) { const y = x[i] - px + r * py; px = x[i]; py = y; x[i] = y; }
  return x;
}

// ---- loops (exactly periodic so they can loop seamlessly with any playbackRate) ----

// partials must be integer multiples of 1/len for a click-free loop: quantise
const q = (f, len) => Math.max(1, Math.round(f * len)) / len;

// sum of sines at given [freq, amp] list, quantised to the loop length
export function loopTone(n, sr, list, R) {
  const x = new Float32Array(n), len = n / sr;
  for (const [f0, a] of list) {
    const f = q(f0, len); if (f > sr * 0.42) continue;
    // rotating phasor (no per-sample sin); re-anchored every 4096 samples against drift
    const w = 2 * Math.PI * f / sr, p = R ? R() * 6.283 : 0, c = Math.cos(w), s = Math.sin(w);
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      if ((i & 4095) === 0) { re = Math.cos(w * i + p); im = Math.sin(w * i + p); }
      x[i] += im * a;
      const nr = re * c - im * s; im = re * s + im * c; re = nr;
    }
  }
  return x;
}
// crowd murmur: grains cut from a few short formant-filtered noise streams ("voices"), summed into dst.
// env(u) maps a uniform random number to a grain position 0..1 (density shape); wrap = loop-safe.
const HANN = new Float32Array(1024);
for (let i = 0; i < 1024; i++) HANN[i] = Math.sin(Math.PI * i / 1023) ** 2;
export function murmur(dst, sr, R, grains, { amp = 0.3, wrap = false, env = null, minLen = 0.25, maxLen = 0.8 } = {}) {
  const n = dst.length, m = sr, S = [];                  // 1 s periodic voice streams
  for (let k = 0; k < 3; k++) {
    const a = noise(m, R), b = new Float32Array(a);
    biquad(a, 'bp', 280 + R() * 450, 4.5, sr, true); biquad(b, 'bp', 900 + R() * 1300, 5.5, sr, true);
    for (let i = 0; i < m; i++) a[i] += b[i] * 0.6;
    S.push(a);
  }
  for (let g = 0; g < grains; g++) {
    const src = S[(R() * S.length) | 0], len = Math.round((minLen + R() * (maxLen - minLen)) * sr), k = 1023 / len;
    let at = Math.floor((env ? env(R()) : R()) * n), from = Math.floor(R() * m);
    const ga = amp * (0.5 + R() * 0.5);
    for (let i = 0; i < len; i++) {
      if (at >= n) { if (!wrap) break; at = 0; }
      dst[at++] += src[from] * HANN[(i * k) | 0] * ga;
      if (++from >= m) from = 0;
    }
  }
  return dst;
}

export function loopNoise(n, sr, R, type, f, qq) {
  const x = noise(n, R); if (type) biquad(x, type, f, qq, sr, true); return x;
}
