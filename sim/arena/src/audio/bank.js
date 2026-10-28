// Arena sound bank: every sample is synthesised here at start-up (no audio files, nothing to license).
// Each recipe returns Float32Array(s); variants differ by seed so repeats never sound identical.
// Reference: 150 g antweights are mostly PLA/TPU with small steel/titanium weapon teeth, N20-class
// gear motors, a small outrunner on the spinner and hobby servos on flippers / lifters.
import {
  rng, buf, biquad, sweepBP, mix, modes, thump, burst, whirr, debris, normalize, fadeOut, dcBlock,
  loopTone, loopNoise, noise, murmur, peak
} from './synth.js';

const TIER = ['light', 'mid', 'heavy'];

// spinner tooth into a printed robot: click + short steel ring + PLA crack + body thump + chips
function spinHit(sr, k, seed) {
  const R = rng(seed), d = [0.24, 0.34, 0.5][k], x = buf(sr, d);
  burst(x, sr, 0, { dur: 0.0008, amp: 0.9, type: 'hp', f: 1500, q: 0.7, R });
  const fm = 2050 * (0.88 + 0.24 * R()), tau = [0.028, 0.036, 0.045][k];
  modes(x, sr, 0.0005, [[fm, 1, tau], [fm * 2.31, 0.55, tau * 0.7], [fm * 3.93, 0.32, tau * 0.45], [fm * 5.58, 0.18, tau * 0.3]], [0.2, 0.24, 0.28][k]);
  burst(x, sr, 0.001, { dur: [0.012, 0.018, 0.025][k], amp: [0.6, 0.75, 0.85][k], f: 2300 * (0.85 + 0.3 * R()), q: 1.3, crackle: 0.09, R });
  thump(x, sr, 0.0015, 300, 140, 0.018, [0.03, 0.05, 0.075][k], [0.3, 0.55, 0.8][k]);
  const fb = 360 * (0.9 + 0.2 * R());
  modes(x, sr, 0.002, [[fb, 1, 0.03], [fb * 2.37, 0.6, 0.022], [fb * 4.1, 0.35, 0.014]], [0.12, 0.18, 0.22][k]);
  debris(x, sr, 0.05 + 0.04 * R(), [1, 2, 4][k] + (R() < 0.5 ? 1 : 0), [0.1, 0.13, 0.16][k], R);
  dcBlock(x, sr); fadeOut(x, sr, 0.02);
  return normalize(x, 0.85);
}

// plastic on plastic (rammers, flipper strikes): no metal ring
function bump(sr, k, seed) {
  const R = rng(seed), x = buf(sr, [0.16, 0.22, 0.3][k]);
  burst(x, sr, 0, { dur: 0.0012, amp: 0.6, type: 'hp', f: 1200, q: 0.7, R });
  thump(x, sr, 0.001, 260, 130, 0.02, [0.035, 0.05, 0.07][k], [0.6, 0.75, 0.9][k]);
  const f = 520 * (0.85 + 0.3 * R());
  modes(x, sr, 0.001, [[f, 1, 0.025], [f * 2.2, 0.6, 0.016], [f * 3.6, 0.4, 0.01]], 0.25);
  burst(x, sr, 0.002, { dur: [0.012, 0.02, 0.03][k], amp: [0.25, 0.4, 0.55][k], f: 1800, q: 1.1, crackle: 0.06, R });
  if (k) debris(x, sr, 0.05 + 0.04 * R(), k, 0.08, R);
  dcBlock(x, sr); fadeOut(x, sr, 0.015);
  return normalize(x, 0.85);
}

// arena wall (plywood base + polycarbonate wall): knock + panel modes + robot rattle
function wall(sr, k, seed) {
  const R = rng(seed), x = buf(sr, [0.2, 0.28, 0.38][k]);
  burst(x, sr, 0, { dur: 0.001, amp: 0.4, type: 'hp', f: 900, q: 0.7, R });
  thump(x, sr, 0.001, 220, 115, 0.025, [0.04, 0.06, 0.085][k], [0.55, 0.8, 1][k]);
  const f = 430 * (0.9 + 0.2 * R());
  modes(x, sr, 0.001, [[f, 1, 0.05], [f * 2.35, 0.55, 0.034], [f * 4.0, 0.3, 0.022], [f * 6.2, 0.15, 0.012]], [0.22, 0.28, 0.32][k]);
  for (let i = 0; i < 1 + k; i++) {
    const fc = 1600 + R() * 1400;
    modes(x, sr, 0.008 + R() * 0.03, [[fc, 1, 0.006], [fc * 1.9, 0.5, 0.004]], 0.1);
  }
  if (k === 2) debris(x, sr, 0.07, 2, 0.08, R);
  dcBlock(x, sr); fadeOut(x, sr, 0.015);
  return normalize(x, 0.85);
}

// hobby-servo flipper: fast whirr, strike + clack, softer return
function flipper(sr, seed) {
  const R = rng(seed), x = buf(sr, 0.5), f = 1 + (R() - 0.5) * 0.1;
  whirr(x, sr, 0, 0.13, 290 * f, 560 * f, 0.5, { tilt: 1.1, grit: 0.5, R });
  thump(x, sr, 0.075, 220, 120, 0.02, 0.05, 0.8);
  modes(x, sr, 0.075, [[1150 * f, 1, 0.02], [2650 * f, 0.6, 0.012], [4100 * f, 0.3, 0.007]], 0.35);
  burst(x, sr, 0.076, { dur: 0.012, amp: 0.25, f: 2200, q: 1, crackle: 0.05, R });
  whirr(x, sr, 0.27, 0.17, 520 * f, 300 * f, 0.22, { tilt: 1.3, grit: 0.4, R });
  modes(x, sr, 0.435, [[900 * f, 1, 0.012], [2100 * f, 0.5, 0.008]], 0.12);
  dcBlock(x, sr); fadeOut(x, sr, 0.02);
  return normalize(x, 0.8);
}

// lifter arm (grabber): slower, strained servo
function lift(sr, seed) {
  const R = rng(seed), x = buf(sr, 0.42), f = 1 + (R() - 0.5) * 0.1;
  whirr(x, sr, 0, 0.32, 210 * f, 330 * f, 0.5, { tilt: 1.2, wobble: 0.012, grit: 0.6, R });
  modes(x, sr, 0.31, [[700 * f, 1, 0.02], [1700 * f, 0.5, 0.012]], 0.25);
  thump(x, sr, 0.31, 140, 80, 0.02, 0.04, 0.35);
  dcBlock(x, sr); fadeOut(x, sr, 0.02);
  return normalize(x, 0.75);
}

// grabber jaws: short whirr, ratchet clicks, plastic clack
function clamp(sr, seed) {
  const R = rng(seed), x = buf(sr, 0.34), f = 1 + (R() - 0.5) * 0.12;
  whirr(x, sr, 0, 0.1, 340 * f, 500 * f, 0.4, { tilt: 1.1, grit: 0.5, R });
  let t = 0.085, gap = 0.016;
  for (let i = 0; i < 4; i++) { modes(x, sr, t, [[2900 * f, 1, 0.004], [4400 * f, 0.6, 0.0025]], 0.25 - i * 0.04); t += gap; gap *= 0.82; }
  modes(x, sr, t + 0.01, [[880 * f, 1, 0.03], [2150 * f, 0.6, 0.02], [3350 * f, 0.35, 0.012]], 0.4);
  thump(x, sr, t + 0.01, 170, 90, 0.015, 0.04, 0.5);
  dcBlock(x, sr); fadeOut(x, sr, 0.02);
  return normalize(x, 0.8);
}

// out of the arena / into the pit: falling air, then landing thud and chips
function fall(sr, seed) {
  const R = rng(seed), x = buf(sr, 1.15), n = Math.round(0.6 * sr), w = noise(n, R);
  for (let i = 0; i < n; i++) { const t = i / sr; w[i] *= Math.sin(Math.PI * Math.min(1, t / 0.6)) ** 2; }
  sweepBP(w, t => 1600 * Math.pow(0.18, t / 0.6), 2.2, sr);
  mix(x, w, 0, 0.35);
  thump(x, sr, 0.6, 170, 90, 0.03, 0.1, 1);
  modes(x, sr, 0.6, [[380, 1, 0.05], [900, 0.5, 0.03], [1600, 0.3, 0.02]], 0.25);
  burst(x, sr, 0.601, { dur: 0.03, amp: 0.4, f: 1800, q: 1, crackle: 0.08, R });
  debris(x, sr, 0.68, 4, 0.14, R);
  dcBlock(x, sr); fadeOut(x, sr, 0.03);
  return normalize(x, 0.8);
}

// pit trapdoor: geared motor run + latch clunk
function pitOpen(sr, seed) {
  const R = rng(seed), x = buf(sr, 0.85);
  whirr(x, sr, 0, 0.5, 120, 150, 0.4, { tilt: 1.0, grit: 0.4, harm: 30, attack: 0.04, release: 0.06, R });
  thump(x, sr, 0.52, 150, 85, 0.03, 0.08, 0.8);
  modes(x, sr, 0.52, [[620, 1, 0.06], [1480, 0.6, 0.04], [2350, 0.35, 0.025]], 0.35);
  dcBlock(x, sr); fadeOut(x, sr, 0.03);
  return normalize(x, 0.75);
}

// a small crowd: formant-filtered noise "voices" swelling, a scatter of claps in the tail
function crowd(sr, seed, dur = 2.0) {
  const out = [];
  for (let ch = 0; ch < 2; ch++) {
    const R = rng(seed * 7 + ch), x = buf(sr, dur);
    murmur(x, sr, R, 40, { amp: 0.7, env: u => Math.pow(u, 1.7) * 0.55, minLen: 0.25, maxLen: 0.85 });
    for (let c = 0; c < 45; c++) {
      const t = 0.25 + R() * (dur - 0.5);
      burst(x, sr, t, { dur: 0.004, amp: 0.25 * (1 - t / dur), f: 1400 + R() * 900, q: 0.9, R });
    }
    for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] *= Math.min(1, t / 0.2) * Math.max(0, 1 - Math.max(0, t - 0.5) / (dur - 0.5)); }
    biquad(x, 'lp', 5000, 0.7, sr); biquad(x, 'lp', 6500, 0.7, sr);
    out.push(dcBlock(x, sr));
  }
  const p = Math.max(peak(out[0]), peak(out[1]));
  for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= 0.8 / p;
  return out;
}

// indoor room tone + faint distant murmur (seamless 4 s stereo loop; R = L shifted half a loop)
function ambience(sr, seed) {
  const n = Math.round(4 * sr), R = rng(seed), x = noise(n, R);
  biquad(x, 'lp', 90, 0.7, sr, true);                    // low room rumble (brownish)
  for (let i = 0; i < n; i++) x[i] *= 4;
  mix(x, loopNoise(n, sr, R, 'bp', 1200, 0.4), 0, 0.03);
  murmur(x, sr, R, 45, { amp: 0.16, wrap: true, minLen: 0.3, maxLen: 1.0 });
  dcBlock(x, sr, true);
  normalize(x, 0.6);
  const y = new Float32Array(n), h = n >> 1;
  y.set(x.subarray(h)); y.set(x.subarray(0, h), n - h);
  return [x, y];
}

// N20-class gear motor loop at a reference speed: gear/commutator harmonics + whine + brush hiss.
// Played back with playbackRate ~ wheel speed. 0.5 s period, all partials on the 2 Hz grid.
function motorLoop(sr, seed) {
  const R = rng(seed), n = Math.round(0.5 * sr), f0 = 118, list = [];
  for (let h = 1; h <= 14; h++) list.push([f0 * h, (1 / h) * Math.exp(-h / 7) * (h % 3 === 0 ? 1.4 : 1)]);
  list.push([f0 * 11, 0.08], [f0 * 11 + 4, 0.05], [f0 * 22, 0.025]);             // commutator whine (slow beat)
  const x = loopTone(n, sr, list, R);
  const hiss = loopNoise(n, sr, R, 'bp', 2600, 0.9), am = 6 * f0;                 // brush noise, gated by commutation
  for (let i = 0; i < n; i++) x[i] += hiss[i] * 0.22 * (0.55 + 0.45 * Math.sin(2 * Math.PI * am * i / sr));
  const rattle = loopNoise(n, sr, R, 'bp', 520, 1.5);                              // gear rattle
  for (let i = 0; i < n; i++) x[i] += rattle[i] * 0.25 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (f0 / 2) * i / sr)) ** 2;
  biquad(x, 'hp', 170, 0.7, sr, true);      // tiny motor: weak fundamental
  dcBlock(x, sr, true);
  return normalize(x, 0.7);
}

// spinner hum loop: blade-pass harmonics (ref 80 Hz) + outrunner whine + bearing hiss
function humLoop(sr, seed) {
  const R = rng(seed), n = Math.round(0.5 * sr), fb = 80, list = [];
  for (let h = 1; h <= 22; h++) list.push([fb * h, Math.pow(h, -0.9) * Math.exp(-h / 6)]);
  list.push([fb * 14, 0.03], [fb * 14 + 2, 0.025]);
  const x = loopTone(n, sr, list, R);
  mix(x, loopNoise(n, sr, R, 'bp', 1500, 1.2), 0, 0.12);
  dcBlock(x, sr, true);
  return normalize(x, 0.7);
}

// blade whoosh loop: one revolution with two blade passes at a reference 10 Hz blade-pass rate
function whooshLoop(sr, seed) {
  const R = rng(seed), n = Math.round(0.2 * sr), x = loopNoise(n, sr, R, 'bp', 420, 0.8);
  biquad(x, 'lp', 700, 0.7, sr, true); biquad(x, 'lp', 900, 0.7, sr, true);   // keep it dark even at 2.5x
  for (let i = 0; i < n; i++) {
    const ph = (i / n) * 2 % 1;                                    // 2 passes per loop
    x[i] *= Math.pow(Math.sin(Math.PI * ph), 6);
  }
  dcBlock(x, sr, true);
  return normalize(x, 0.7);
}

// plastic scrape: stick-slip micro-impacts over a soft friction noise (1 s loop)
function scrapeLoop(sr, seed) {
  const R = rng(seed), n = sr, x = loopNoise(n, sr, R, 'bp', 1500, 0.7);
  for (let i = 0; i < n; i++) x[i] *= 0.25 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * i / n));
  let t = 0;
  while (t < 0.99) {
    const f = 1300 + R() * 1500, s = Math.round(t * sr), tmp = new Float32Array(Math.round(0.01 * sr));
    modes(tmp, sr, 0, [[f, 1, 0.0025], [f * 2.1, 0.4, 0.0015]], 0.4 + R() * 0.6);
    mix(x, tmp, s, 0.5, true);
    t += 0.004 + R() * 0.012;
  }
  dcBlock(x, sr, true);
  return normalize(x, 0.7);
}

// ---- UI / stings: gentle, musical, mid-range ----
const marimba = (x, sr, t, f, a) => {
  modes(x, sr, t, [[f, 1, 0.4], [f * 3.93, 0.22, 0.07], [f * 9.2, 0.06, 0.025]], a, 0.002);
};
function beep(sr, f, d) {
  const x = buf(sr, d);
  modes(x, sr, 0, [[f, 1, d / 4], [f * 2, 0.12, d / 8]], 0.7, 0.004);
  fadeOut(x, sr, 0.02); return x;
}
function go(sr) {
  const x = buf(sr, 0.8);
  modes(x, sr, 0, [[1318.5, 1, 0.22], [659.25, 0.6, 0.3], [2637, 0.12, 0.08]], 0.6, 0.004);
  fadeOut(x, sr, 0.05); return x;
}
function bell(sr) {           // round end: two soft bell strikes
  const x = buf(sr, 1.6), P = [[0.5, 0.25, 0.9], [1, 1, 0.6], [1.19, 0.4, 0.45], [1.51, 0.35, 0.35], [2.0, 0.25, 0.25], [2.51, 0.12, 0.15]];
  for (const t of [0, 0.3]) modes(x, sr, t, P.map(([r, a, d]) => [640 * r, a, d]), t ? 0.3 : 0.35, 0.002);
  biquad(x, 'lp', 4200, 0.7, sr); fadeOut(x, sr, 0.1);
  return normalize(x, 0.6);
}
function jingle(sr, win) {
  const x = buf(sr, 1.3), notes = win ? [523.25, 659.25, 783.99, 1046.5] : [392, 311.13, 261.63], step = win ? 0.1 : 0.16;
  notes.forEach((f, i) => marimba(x, sr, i * step, f, i === notes.length - 1 ? 0.5 : 0.4));
  fadeOut(x, sr, 0.1); return normalize(x, 0.6);
}
function click(sr, seed) {
  const R = rng(seed), x = buf(sr, 0.05), f = 2300 * (0.92 + 0.16 * R());
  modes(x, sr, 0, [[f, 1, 0.005], [f * 2.3, 0.4, 0.0025]], 0.5, 0.0003);
  return normalize(x, 0.5);
}

// tasks run one per idle slice so start-up never hitches; loops first (needed immediately)
export function bankTasks(sr) {
  const T = [];
  T.push(['motor', () => [motorLoop(sr, 11)]], ['hum', () => [humLoop(sr, 12)]], ['whoosh', () => [whooshLoop(sr, 13)]],
    ['scrape', () => [scrapeLoop(sr, 14)]], ['click', () => [0, 1, 2].map(i => click(sr, 20 + i))],
    ['beep', () => [beep(sr, 880, 0.3)]], ['go', () => [go(sr)]]);
  for (let k = 0; k < 3; k++) {
    T.push(['spin_' + TIER[k], () => [0, 1, 2].map(i => spinHit(sr, k, 100 + k * 10 + i))]);
    T.push(['bump_' + TIER[k], () => [0, 1].map(i => bump(sr, k, 200 + k * 10 + i))]);
    T.push(['wall_' + TIER[k], () => [0, 1, 2].map(i => wall(sr, k, 300 + k * 10 + i))]);
  }
  T.push(['flip', () => [0, 1, 2].map(i => flipper(sr, 400 + i))], ['lift', () => [0, 1].map(i => lift(sr, 410 + i))],
    ['clamp', () => [0, 1].map(i => clamp(sr, 420 + i))], ['fall', () => [fall(sr, 430)]], ['pit', () => [pitOpen(sr, 440)]],
    ['bell', () => [bell(sr)]], ['win', () => [jingle(sr, true)]], ['lose', () => [jingle(sr, false)]],
    ['crowd', () => [{ stereo: crowd(sr, 500) }]], ['crowd2', () => [{ stereo: crowd(sr, 501) }]], ['amb', () => [{ stereo: ambience(sr, 600) }]]);
  return T;
}
export const TIERS = TIER;
