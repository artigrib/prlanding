// Replay playback: a clock over a Track (play / pause / seek / speed, automatic slow motion around big
// hits), event callbacks when the clock crosses them, and a TV-style auto director for the camera.
import * as THREE from 'three';

export const SPEEDS = [0.25, 0.5, 1, 2];
const BIG = 0.7;                      // hit energy that counts as a big hit (slow-mo, director close-up)

export class Playback {
  constructor(track, binding, scene) {
    this.track = track; this.binding = binding; this.scene = scene;
    this.vals = new Float32Array(track.ch); this.tmp = new Float32Array(track.ch);
    this.t0 = track.t0; this.t1 = track.t1;
    this.from = this.t0; this.to = this.t1;      // the window being played (instant replay = a slice)
    this.t = this.t0; this.speed = 1; this.playing = false; this.autoSlow = true; this.loop = false;
    this.onEvent = null; this.onEnd = null;
    this.evI = 0;
    this.big = track.events.filter(e => (e.type === 'hit' && (e.e || 0) >= BIG) || e.type === 'ko' || e.type === 'pit' || e.type === 'flip');
    binding.begin();
  }
  window(a, b) { this.from = Math.max(this.t0, a); this.to = Math.min(this.t1, b); this.seek(this.from); }
  seek(t) {
    this.t = Math.max(this.from, Math.min(this.to, t));
    this.evI = this.track.events.findIndex(e => e.t >= this.t - 1e-6);
    if (this.evI < 0) this.evI = this.track.events.length;
    this.apply();
  }
  // effective speed: slows to 0.3× within ±0.5 s of a big moment
  rate() {
    if (!this.autoSlow || this.speed < 0.5) return this.speed;
    for (const e of this.big) if (Math.abs(e.t - this.t) < 0.55) return Math.min(this.speed, 0.3);
    return this.speed;
  }
  get slowed() { return this.playing && this.rate() < this.speed - 1e-6; }
  // returns true when the end of the window was reached this tick
  tick(dt) {
    if (!this.playing) return false;
    const nt = this.t + dt * this.rate();
    const ev = this.track.events;
    while (this.evI < ev.length && ev[this.evI].t <= nt) { const e = ev[this.evI++]; if (e.t >= this.t - 1e-6 && this.onEvent) this.onEvent(e); }
    this.t = Math.min(this.to, nt);
    this.apply();
    if (this.t >= this.to - 1e-6) {
      if (this.loop) { this.seek(this.from); return false; }
      this.playing = false; if (this.onEnd) this.onEnd(); return true;
    }
    return false;
  }
  apply() { this.track.sample(this.t, this.vals, this.tmp); this.binding.apply(this.vals, this.scene); }
  progress() { return this.to > this.from ? (this.t - this.from) / (this.to - this.from) : 0; }
  // biggest moment (KO first, then the hardest hit) -> { t, e }
  highlight() {
    const ev = this.track.events;
    const ko = ev.filter(e => e.type === 'ko' || e.type === 'pit' || e.type === 'out').pop();
    if (ko) return ko;
    let best = null;
    for (const e of ev) if (e.type === 'hit' && (!best || (e.e || 0) > (best.e || 0))) best = e;
    return best;
  }
}

// ---------------------------------------------------------------- auto director
// Picks broadcast shots: wide TV most of the time, a slow orbit close-up around big hits / KOs,
// the attacker's chase cam when the robots grapple, top view after a flip. Shots last >= 2 s.
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export class Director {
  constructor() { this.shot = 'tv'; this.focus = 0; this.since = 99; this.center = new THREE.Vector3(); this.until = 0; this.angle = 0; }
  reset() { this.shot = 'tv'; this.since = 99; this.until = 0; }
  // returns { mode, focus, center?, radius?, height? }
  update(dt, pb, binding) {
    this.since += dt;
    const t = pb.t, v = pb.vals;
    binding.robotPos(v, 0, _a); binding.robotPos(v, 1, _b);
    const dist = Math.hypot(_a.x - _b.x, _a.z - _b.z);
    let want = null;
    // upcoming or current big moment -> orbit close-up on it
    for (const e of pb.big) {
      if (e.t - t < 0.45 && t - e.t < 1.6) {
        want = { mode: 'orbit', key: 'big' + e.t };
        if (e.p) this.center.set(e.p.x, e.p.y || 0.3, e.p.z);
        else { const r = e.who === 1 ? _b : _a; this.center.copy(r); }
        break;
      }
    }
    if (!want && this.shot === 'orbit' && this.since < 2.2) want = { mode: 'orbit', key: this.key };
    if (!want) {
      if (dist < 1.6 && this.since > 4) want = { mode: 'chase', key: 'chase', focus: this.closer(pb, binding) };
      else if (this.shot === 'chase' && this.since < 3.5 && dist < 2.4) want = { mode: 'chase', key: 'chase' };
      else want = { mode: 'tv', key: 'tv' };
    }
    if (want.key !== this.key && (this.since >= 2 || want.mode === 'orbit')) {
      this.key = want.key; this.shot = want.mode; this.since = 0;
      if (want.focus != null) this.focus = want.focus;
      if (want.mode === 'orbit') this.angle = Math.random() * Math.PI * 2;
    }
    if (this.shot === 'orbit' && !pb.big.some(e => Math.abs(e.t - t) < 1.6)) this.center.lerp(_a.add(_b).multiplyScalar(0.5), 1 - Math.exp(-dt * 2));
    return { mode: this.shot, focus: this.focus, center: this.center };
  }
  // the robot that is driving into the other one gets the chase camera
  closer(pb, binding) {
    const t = pb.t, ev = pb.track.events;
    for (let i = ev.length - 1; i >= 0; i--) if (ev[i].type === 'hit' && ev[i].t <= t && ev[i].by >= 0) return ev[i].by;
    return 0;
  }
}
