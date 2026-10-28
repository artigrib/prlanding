// Synthesised sound (WebAudio): servo whine scaled by joint speed, gripper click, success chime.
// Haptics (navigator.vibrate) on phones. Off by default on touch devices; preference in localStorage.

import { store } from './store.js';

export class Sound {
  constructor(ux) {
    this.ux = ux;
    this.on = store.get('sound', false);     // opt-in everywhere (toolbar / S)
    this.ctx = null; this.level = 0; this.pitch = 0;
    // the AudioContext may only start after a user gesture
    const unlock = () => { if (this.on) this.ensure(); };
    addEventListener('pointerdown', unlock, { capture: true, passive: true });
    addEventListener('keydown', unlock, { capture: true });
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
      // servo: two detuned saws through a band-pass, amplitude follows joint speed
      this.bp = c.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.frequency.value = 900; this.bp.Q.value = 2.2;
      this.vg = c.createGain(); this.vg.gain.value = 0;
      this.o1 = c.createOscillator(); this.o1.type = 'sawtooth'; this.o1.frequency.value = 220;
      this.o2 = c.createOscillator(); this.o2.type = 'square'; this.o2.frequency.value = 331;
      const g2 = c.createGain(); g2.gain.value = 0.35;
      this.o1.connect(this.bp); this.o2.connect(g2); g2.connect(this.bp);
      this.bp.connect(this.vg); this.vg.connect(this.master);
      this.o1.start(); this.o2.start();
      return c;
    } catch (e) { this.ctx = null; return null; }
  }

  set(on) {
    this.on = on; store.set('sound', on);
    if (on) this.ensure(); else if (this.vg) this.vg.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
  }

  /** Per frame: joint speed (rad/s, sum of |qvel| of the arm). */
  update(speed) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const lvl = Math.min(0.075, Math.max(0, speed - 0.08) * 0.03);
    this.vg.gain.setTargetAtTime(lvl, t, 0.05);
    const f = 170 + Math.min(speed, 6) * 70;
    this.o1.frequency.setTargetAtTime(f, t, 0.06);
    this.o2.frequency.setTargetAtTime(f * 1.505, t, 0.06);
    this.bp.frequency.setTargetAtTime(700 + Math.min(speed, 6) * 220, t, 0.08);
  }

  blip(freq, dur, type = 'triangle', vol = 0.12, when = 0) {
    if (!this.on || !this.ensure()) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  grip(open) { this.blip(open ? 520 : 300, 0.09, 'square', 0.05); }
  grasp() { this.blip(880, 0.08, 'triangle', 0.09); this.vibrate(25); }
  error() { this.blip(180, 0.18, 'sawtooth', 0.05); }
  success() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.blip(f, 0.32, 'triangle', 0.11, i * 0.09));
    this.vibrate([30, 60, 30, 60, 80]);
  }
  vibrate(p) { try { if (this.ux.touch && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }
}
