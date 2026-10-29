// Web Audio engine shared by the browser sims.
//   voices -> bus gain -> (bus compressor) -> master gain -> limiter -> soft clip -> output
// Buses: sfx (impacts, weapons), motors (continuous drive / spinner voices), amb (room tone, crowd;
// has a duck stage), ui (countdown, clicks, stings). One-shot voices come from a fixed pool with
// priority stealing; every sound key has a cooldown so nothing can machine-gun.
// The context is created lazily and only resumed from a user gesture (iOS / autoplay policies).
// Pass { context } (e.g. an OfflineAudioContext) to render offline; then nothing touches the DOM.
// NOTE: shared verbatim by sim/arena/src/audio/ and sim/so101/src/audio/ (separately deployed sims): keep both copies identical.

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

export class Engine {
  constructor({ context = null, buses = ['sfx', 'motors', 'amb', 'ui'], maxVoices = 6, outGain = 0.9 } = {}) {
    this.ctx = context; this.offline = !!context; this.busNames = buses;
    this.maxVoices = maxVoices; this.outGainValue = outGain;
    this.levels = { master: 0.8, sfx: 1, amb: 1, motors: 1, ui: 1 };
    this.muted = false; this.unlocked = !!context;
    this.bus = {}; this.ready = false;
    this.lastPlay = new Map();                 // key -> {t, e}
    this.slots = [];                           // one-shot voice pool
    for (let i = 0; i < maxVoices; i++) this.slots.push({ src: null, end: 0, prio: 0, start: 0 });
    this.onBuild = null;
    if (context) this.build();
  }

  // ---- lifecycle ----
  ensure() {
    if (this.ready) return this.ctx;
    if (!AC) return null;
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (_) {
      try { this.ctx = new AC(); } catch (__) { return null; }
    }
    this.build();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx || this.offline) return;
        if (document.hidden) this.ctx.suspend().catch(() => {});
        else if (this.unlocked && !this.muted) this.ctx.resume().catch(() => {});
      });
    }
    return this.ctx;
  }
  // call from a user gesture handler
  unlock() {
    if (!this.ensure()) return;
    this.unlocked = true;
    if (this.ctx.state !== 'running' && !this.muted) {
      try {
        // iOS: a silent one-sample buffer played inside the gesture fully unlocks output
        const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate), s = this.ctx.createBufferSource();
        s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      } catch (_) { /* ignore */ }
      const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {});
    }
  }
  // install gesture listeners that unlock on the first interaction
  autoUnlock(target = typeof window !== 'undefined' ? window : null, when = () => true) {
    if (!target) return;
    const h = () => { if (when()) this.unlock(); };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) target.addEventListener(ev, h, { capture: true, passive: true });
  }
  get running() { return !!this.ctx && this.ready && (this.offline || this.ctx.state === 'running'); }
  get live() { return this.running && !this.muted; }
  now() { return this.ctx ? this.ctx.currentTime : 0; }

  build() {
    const c = this.ctx;
    this.out = c.createGain(); this.out.gain.value = this.outGainValue;
    // soft clip: linear to 0.8, smooth knee to 0.98 (safety net behind the limiter, never on normal mix)
    this.clip = c.createWaveShaper();
    const N = 2048, curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1, a = Math.abs(x);
      curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18));
    }
    this.clip.curve = curve; this.clip.oversample = '2x';
    this.limiter = c.createDynamicsCompressor();
    this.setComp(this.limiter, -4, 0, 20, 0.001, 0.12);
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.levels.master;
    this.master.connect(this.limiter); this.limiter.connect(this.clip); this.clip.connect(this.out); this.out.connect(c.destination);
    for (const name of this.busNames) {
      const g = c.createGain(); let tail = g;
      if (name === 'sfx') { const k = c.createDynamicsCompressor(); this.setComp(k, -16, 6, 3, 0.003, 0.18); g.connect(k); tail = k; }
      if (name === 'motors') { const k = c.createDynamicsCompressor(); this.setComp(k, -22, 8, 2.5, 0.01, 0.25); g.connect(k); tail = k; }
      if (name === 'amb') { const d = c.createGain(); g.connect(d); tail = d; this.duckNode = d; }
      tail.connect(this.master);
      this.bus[name] = g;
    }
    this.ready = true;
    this.applyLevels(0);
    if (this.onBuild) this.onBuild(this);
  }
  setComp(k, thr, knee, ratio, atk, rel) {
    k.threshold.value = thr; k.knee.value = knee; k.ratio.value = ratio; k.attack.value = atk; k.release.value = rel;
  }

  // ---- levels ----
  setLevels(l) { Object.assign(this.levels, l); this.applyLevels(); }
  setMuted(m) {
    this.muted = !!m;
    this.applyLevels();
    if (!this.muted && this.unlocked) this.unlock();
  }
  applyLevels(tc = 0.04) {
    if (!this.ready) return;
    const t = this.now(), L = this.levels;
    const set = (p, v) => { if (tc) p.setTargetAtTime(v, t, tc); else p.value = v; };
    set(this.master.gain, this.muted ? 0 : L.master * L.master);   // squared: slider feels linear in loudness
    for (const n of this.busNames) {
      const v = n === 'amb' ? L.amb : n === 'ui' ? L.ui : n === 'motors' ? L.sfx * L.motors : L.sfx;
      set(this.bus[n].gain, v * v);
    }
  }

  // ---- ducking (ambience dips under hits, then recovers) ----
  duck(amount, t = this.now()) {
    if (!this.duckNode) return;
    const g = this.duckNode.gain;
    g.cancelScheduledValues(t); g.setTargetAtTime(Math.max(0.2, 1 - amount), t, 0.012);
    g.setTargetAtTime(1, t + 0.12 + 0.2 * amount, 0.35);
  }

  // ---- cooldowns: true if the sound may play now. Stronger events may break through a cooldown. ----
  gate(key, cooldown, e = 1, t = this.now()) {
    const l = this.lastPlay.get(key);
    if (l && t - l.t < cooldown && e < l.e * 1.6 + 0.15) return false;
    if (l) { l.t = t; l.e = e; } else this.lastPlay.set(key, { t, e });
    return true;
  }

  // ---- one-shot voice: buffer -> gain -> pan -> bus. Pool limited, lowest priority / oldest stolen. ----
  play(buffer, { bus = 'sfx', gain = 1, rate = 1, pan = 0, when = 0, prio = 1 } = {}) {
    if (!buffer || !this.running || (this.muted && !this.offline)) return null;
    const c = this.ctx, t = Math.max(when, c.currentTime);
    let slot = null, worst = null;
    for (const s of this.slots) {
      if (s.end <= t) { slot = s; break; }
      if (!worst || s.prio < worst.prio || (s.prio === worst.prio && s.start < worst.start)) worst = s;
    }
    if (!slot) {
      if (worst.prio > prio) return null;      // everything playing matters more: drop this one
      slot = worst;
      try { slot.g.gain.setTargetAtTime(0, t, 0.004); slot.src.stop(t + 0.03); } catch (_) { /* ignore */ }
    }
    const src = c.createBufferSource(); src.buffer = buffer; src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(g);
    let tail = g;
    if (Math.abs(pan) > 0.06 && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); tail = p; }   // centred: no panner node
    tail.connect(this.bus[bus] || this.bus.sfx);
    src.start(t);
    slot.src = src; slot.g = g; slot.prio = prio; slot.start = t; slot.end = t + buffer.duration / rate + 0.03;
    src.onended = () => { try { tail.disconnect(); } catch (_) { /* ignore */ } };
    return src;
  }

  // ---- persistent looped voice (motors, ambience). Returns {src, g, p, rate, gain} with smoothing helpers. ----
  // dest: a shared panner from panner() (several loops of one robot share one pan node)
  loop(buffer, bus, { pan = true, dest = null } = {}) {
    const c = this.ctx, src = c.createBufferSource(); src.buffer = buffer; src.loop = true;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(g);
    let p = null;
    if (dest) g.connect(dest.p || dest);
    else if (pan && c.createStereoPanner) { p = c.createStereoPanner(); g.connect(p); p.connect(this.bus[bus]); }
    else g.connect(this.bus[bus]);
    src.start(this.now(), Math.random() * buffer.duration);
    return { src, g, p, cur: { gain: 0, rate: 1, pan: 0 } };
  }
  // smooth parameter moves for a loop voice; skips tiny changes to keep the automation list short
  steer(v, gain, rate, pan, t = this.now(), tc = 0.06) {
    const cur = v.cur;
    if (Math.abs(gain - cur.gain) > 0.0015 || (gain === 0 && cur.gain !== 0)) { v.g.gain.setTargetAtTime(gain, t, tc); cur.gain = gain; }
    if (Math.abs(rate - cur.rate) > 0.004) { v.src.playbackRate.setTargetAtTime(rate, t, tc); cur.rate = rate; }
    if (v.p && Math.abs(pan - cur.pan) > 0.02) { v.p.pan.setTargetAtTime(pan, t, 0.08); cur.pan = pan; }
  }

  // shared stereo panner feeding a bus ({p, cur}); null where StereoPanner is missing (old Safari)
  panner(bus) {
    const c = this.ctx; if (!c.createStereoPanner) return null;
    const p = c.createStereoPanner(); p.connect(this.bus[bus]); return { p, cur: 0 };
  }
  steerPan(P, pan, t = this.now()) {
    if (P && Math.abs(pan - P.cur) > 0.02) { P.p.pan.setTargetAtTime(pan, t, 0.08); P.cur = pan; }
  }

  // Float32Array(s) -> AudioBuffer
  buffer(chans) {
    if (!(chans instanceof Array)) chans = [chans];
    const b = this.ctx.createBuffer(chans.length, chans[0].length, this.ctx.sampleRate);
    chans.forEach((d, i) => b.getChannelData(i).set(d));
    return b;
  }
}

// ---- listener geometry: camera -> distance gain and stereo pan for a world position ----
export class Listener {
  constructor() { this.px = 0; this.py = 10; this.pz = 10; this.rx = 1; this.ry = 0; this.rz = 0; this.ref = 12; }
  // three.js camera (reads matrixWorld: no allocation)
  from(camera) {
    if (!camera || !camera.matrixWorld) return;
    const e = camera.matrixWorld.elements;
    this.px = e[12]; this.py = e[13]; this.pz = e[14];
    const l = Math.hypot(e[0], e[1], e[2]) || 1;
    this.rx = e[0] / l; this.ry = e[1] / l; this.rz = e[2] / l;
    this.ref = Math.max(3, Math.hypot(this.px, this.py, this.pz));   // distance to the arena centre = unity gain
  }
  dist(p) { return Math.hypot(p.x - this.px, p.y - this.py, p.z - this.pz); }
  gain(p) { if (!p) return 1; const d = this.dist(p); return Math.min(1.25, Math.max(0.4, Math.pow(this.ref / Math.max(0.5, d), 0.8))); }
  pan(p) {
    if (!p) return 0;
    const dx = p.x - this.px, dy = p.y - this.py, dz = p.z - this.pz, d = Math.hypot(dx, dy, dz) || 1;
    const s = (dx * this.rx + dy * this.ry + dz * this.rz) / d;
    return Math.max(-0.75, Math.min(0.75, s * 1.1));
  }
}
