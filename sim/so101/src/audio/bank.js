// SO-101 sound bank, synthesised at start-up (no audio files).
// Feetech STS3215 bus servos: small brushed motor + metal gear train -> a soft buzzy whine that
// rises with speed. Printed PLA parts, a PLA cube and a light ball on a wooden table.
import { rng, buf, biquad, modes, thump, burst, whirr, normalize, fadeOut, dcBlock, loopTone, loopNoise } from './synth.js';

// servo loop at a reference speed (0.5 s period, partials on the 2 Hz grid -> seamless)
function servoLoop(sr, seed) {
  const R = rng(seed), n = Math.round(0.5 * sr), f0 = 140, list = [];
  for (let h = 1; h <= 16; h++) list.push([f0 * h, (1 / h) * Math.exp(-h / 6)]);
  list.push([f0 * 12, 0.05], [f0 * 12 + 6, 0.04]);                               // gear-mesh whine, slow beat
  const x = loopTone(n, sr, list, R);
  const hiss = loopNoise(n, sr, R, 'bp', 2400, 1.0);
  for (let i = 0; i < n; i++) x[i] += hiss[i] * 0.16 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * f0 * i / sr));
  biquad(x, 'lp', 4200, 0.7, sr, true);
  dcBlock(x, sr, true);
  return normalize(x, 0.7);
}
// gripper closes on an object: servo slows under load, PLA creaks, jaws settle
function squeeze(sr, seed) {
  const R = rng(seed), x = buf(sr, 0.32);
  whirr(x, sr, 0, 0.17, 250, 165, 0.45, { tilt: 1.5, grit: 0.4, wobble: 0.01, R });
  burst(x, sr, 0.12, { dur: 0.04, amp: 0.25, f: 1300, q: 2.2, crackle: 0.03, R });
  modes(x, sr, 0.165, [[1900, 1, 0.012], [3300, 0.5, 0.007]], 0.22);
  dcBlock(x, sr); fadeOut(x, sr, 0.02);
  return normalize(x, 0.7);
}
// gripper open / close without an object: short servo move + soft stop click
function gripMove(sr, seed, open) {
  const R = rng(seed), x = buf(sr, 0.16), a = open ? 230 : 300, b = open ? 300 : 230;
  whirr(x, sr, 0, 0.09, a, b, 0.4, { tilt: 1.6, grit: 0.3, R });
  modes(x, sr, 0.09, [[2100, 1, 0.006], [3600, 0.4, 0.004]], 0.2);
  dcBlock(x, sr); fadeOut(x, sr, 0.01);
  return normalize(x, 0.6);
}
// PLA cube on the wooden table
function tap(sr, seed) {
  const R = rng(seed), x = buf(sr, 0.14), f = 640 * (0.9 + 0.2 * R());
  burst(x, sr, 0, { dur: 0.0006, amp: 0.4, type: 'hp', f: 1500, q: 0.7, R });
  modes(x, sr, 0.0003, [[f, 1, 0.025], [f * 2.3, 0.55, 0.016], [f * 4.1, 0.3, 0.008]], 0.5);
  thump(x, sr, 0.0005, 190, 110, 0.01, 0.018, 0.3);
  dcBlock(x, sr); fadeOut(x, sr, 0.01);
  return normalize(x, 0.8);
}
// light ball: duller, lower
function tapSoft(sr, seed) {
  const R = rng(seed), x = buf(sr, 0.14), f = 320 * (0.9 + 0.2 * R());
  modes(x, sr, 0, [[f, 1, 0.03], [f * 2.1, 0.35, 0.015]], 0.5, 0.002);
  thump(x, sr, 0, 160, 90, 0.012, 0.025, 0.5);
  dcBlock(x, sr); fadeOut(x, sr, 0.01);
  return normalize(x, 0.7);
}
const mallet = (x, sr, t, f, a) => modes(x, sr, t, [[f, 1, 0.45], [f * 3.93, 0.14, 0.05], [f * 9.2, f * 9.2 < 8000 ? 0.03 : 0, 0.015]], a, 0.002);
function chime(sr) {
  const x = buf(sr, 1.4);
  [783.99, 1046.5, 1318.5].forEach((f, i) => mallet(x, sr, i * 0.09, f, i === 2 ? 0.5 : 0.4));
  fadeOut(x, sr, 0.1); return normalize(x, 0.55);
}
function error(sr) {
  const x = buf(sr, 0.4);
  modes(x, sr, 0, [[440, 1, 0.07], [880, 0.15, 0.03]], 0.5, 0.004);
  modes(x, sr, 0.13, [[330, 1, 0.09], [660, 0.15, 0.04]], 0.5, 0.004);
  fadeOut(x, sr, 0.03); return normalize(x, 0.5);
}
function tick(sr, seed) {
  const R = rng(seed), x = buf(sr, 0.05), f = 2300 * (0.92 + 0.16 * R());
  modes(x, sr, 0, [[f, 1, 0.005], [f * 2.3, 0.4, 0.0025]], 0.5, 0.0003);
  return normalize(x, 0.5);
}

export function bankTasks(sr) {
  return [
    ['servo', () => [servoLoop(sr, 1)]], ['tick', () => [tick(sr, 2), tick(sr, 3)]],
    ['tap', () => [0, 1, 2].map(i => tap(sr, 10 + i))], ['tapSoft', () => [0, 1].map(i => tapSoft(sr, 20 + i))],
    ['squeeze', () => [0, 1].map(i => squeeze(sr, 30 + i))], ['open', () => [gripMove(sr, 40, true)]], ['close', () => [gripMove(sr, 41, false)]],
    ['chime', () => [chime(sr)]], ['error', () => [error(sr)]]
  ];
}
