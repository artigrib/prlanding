// Synthesised sound effects (WebAudio only, no samples). Everything is created lazily on the
// first user gesture; with audio unavailable every call is a silent no-op.
import { store } from '../ui/store.js';

let ctx = null, master = null, comp = null, noiseBuf = null;
let muted = store.get('muted', false);
const motors = new Map();

function init() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (_) { ctx = null; }
  return ctx;
}
const ok = () => ctx && !muted && ctx.state === 'running';

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function noise(t, dur, { type = 'bandpass', f = 1200, q = 1, peak = 0.5, a = 0.004, f2 } = {}) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  s.loop = true; s.loopStart = Math.random() * 0.5;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain(); env(g, t, a, peak, dur);
  s.connect(fl); fl.connect(g); g.connect(master);
  s.start(t, Math.random() * 0.5); s.stop(t + a + dur + 0.05);
}
function tone(t, dur, { type = 'sine', f = 440, f2, peak = 0.3, a = 0.005 } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain(); env(g, t, a, peak, dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + a + dur + 0.05);
}

export const sfx = {
  get muted() { return muted; },
  // call from a user gesture (click / key) so browsers allow sound
  unlock() { if (init() && ctx.state === 'suspended') ctx.resume().catch(() => {}); },
  setMuted(m) {
    muted = !!m; store.set('muted', muted);
    if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.03);
    if (!muted) this.unlock();
  },
  // metal-on-metal impact; e = 0..1
  hit(e = 0.5, spinner = false) {
    if (!ok()) return;
    const t = ctx.currentTime;
    tone(t, 0.18 + 0.2 * e, { f: 140, f2: 42, peak: 0.35 + 0.4 * e });
    noise(t, 0.08 + 0.12 * e, { f: 2600, q: 0.8, peak: 0.25 + 0.45 * e });
    if (spinner) {
      // ringing inharmonic partials = clang
      for (const [m, p] of [[1, 0.16], [2.76, 0.1], [5.4, 0.06]]) tone(t, 0.35 + 0.3 * e, { type: 'triangle', f: 520 * m * (0.95 + Math.random() * 0.1), peak: p * (0.4 + e) });
    }
  },
  flip() {
    if (!ok()) return;
    const t = ctx.currentTime;
    noise(t, 0.22, { type: 'highpass', f: 1800, f2: 5000, peak: 0.28, a: 0.01 });
    tone(t, 0.12, { type: 'square', f: 95, f2: 60, peak: 0.12 });
  },
  wall(e = 0.4) {
    if (!ok()) return;
    const t = ctx.currentTime;
    tone(t, 0.14, { f: 90, f2: 50, peak: 0.25 * e + 0.05 });
    noise(t, 0.06, { type: 'lowpass', f: 900, peak: 0.2 * e });
  },
  fall() {
    if (!ok()) return;
    const t = ctx.currentTime;
    tone(t, 0.9, { type: 'triangle', f: 700, f2: 90, peak: 0.18, a: 0.02 });
  },
  beep(final = false) {
    if (!ok()) return;
    tone(ctx.currentTime, final ? 0.45 : 0.14, { type: 'square', f: final ? 880 : 440, peak: 0.12 });
  },
  buzzer() {
    if (!ok()) return;
    const t = ctx.currentTime;
    tone(t, 0.9, { type: 'sawtooth', f: 155, peak: 0.16, a: 0.01 });
    tone(t, 0.9, { type: 'sawtooth', f: 160, peak: 0.12, a: 0.01 });
  },
  crowd(e = 1) {
    if (!ok()) return;
    const t = ctx.currentTime;
    noise(t, 1.6 * e + 0.4, { f: 900, q: 0.5, peak: 0.12 * e + 0.03, a: 0.25 });
    noise(t + 0.05, 1.2 * e + 0.3, { f: 2200, q: 1.5, peak: 0.05 * e, a: 0.2 });
  },
  jingle(win = true) {
    if (!ok()) return;
    const t = ctx.currentTime;
    const notes = win ? [523, 659, 784, 1047] : [392, 349, 311, 262];
    notes.forEach((f, i) => tone(t + i * 0.11, i === 3 ? 0.5 : 0.12, { type: 'triangle', f, peak: 0.16 }));
  },
  click() { if (ok()) tone(ctx.currentTime, 0.04, { type: 'square', f: 1200, peak: 0.04 }); },
  // continuous motor / weapon hum per robot; level 0..1, spin 0..1
  motor(id, level, spin = 0) {
    if (!ctx) return;
    let m = motors.get(id);
    if (!m) {
      if (!ok() || (level < 0.02 && spin < 0.02)) return;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const g = ctx.createGain(); g.gain.value = 0;
      const w = ctx.createOscillator(); w.type = 'triangle'; w.frequency.value = 80;
      const wg = ctx.createGain(); wg.gain.value = 0;
      o.connect(lp); lp.connect(g); g.connect(master); w.connect(wg); wg.connect(master);
      o.start(); w.start();
      m = { o, g, w, wg, lp }; motors.set(id, m);
    }
    const t = ctx.currentTime, on = !muted;
    m.o.frequency.setTargetAtTime(55 + 140 * level, t, 0.05);
    m.lp.frequency.setTargetAtTime(300 + 900 * level, t, 0.05);
    m.g.gain.setTargetAtTime(on ? 0.035 * Math.min(1, level * 1.4) : 0, t, 0.06);
    m.w.frequency.setTargetAtTime(70 + 520 * spin, t, 0.08);
    m.wg.gain.setTargetAtTime(on ? 0.05 * spin : 0, t, 0.08);
  },
  stopMotors() {
    if (!ctx) return;
    for (const m of motors.values()) { m.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); m.wg.gain.setTargetAtTime(0, ctx.currentTime, 0.05); }
  }
};
