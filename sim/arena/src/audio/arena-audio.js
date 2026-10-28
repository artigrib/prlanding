// Arena sound design: maps game events and robot state to the engine.
// Continuous per robot: gear-motor loop (pitch = wheel speed, grit/level = motor current)
// and, for spinners, a hum loop + blade whoosh (pitch = blade speed, doppler from camera).
// One shared plastic-scrape loop while the robots grind against each other; one ambience loop.
// All per-frame work reuses preallocated state (no allocations in update()).
import { Engine, Listener } from './core.js';
import { bankTasks, TIERS } from './bank.js';

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const rnd = (a, b) => a + Math.random() * (b - a);

export class ArenaAudio {
  constructor(opts = {}) {
    this.eng = new Engine({ context: opts.context || null, maxVoices: 6 });
    this.L = new Listener();
    this.bank = {}; this.tasks = null;
    this.robots = new Map();        // id -> voice state
    this.scrape = null; this.amb = null; this._mid = { x: 0, y: 0, z: 0 }; this.ambOn = false; this.ambLevel = 0;
    this.eng.onBuild = () => this.startBank(!!opts.context);
    if (opts.context) this.startBank(true);
  }

  // ---- bank (built after the context exists; sync offline, sliced in realtime) ----
  startBank(sync) {
    if (this.tasks) return;
    this.tasks = bankTasks(this.eng.ctx.sampleRate);
    const run = () => {
      const [name, fn] = this.tasks.shift(), key = name.replace(/\d+$/, '');   // 'crowd2' adds variants to 'crowd'
      const list = fn().map(v => this.eng.buffer(v && v.stereo ? v.stereo : v));
      this.bank[key] = (this.bank[key] || []).concat(list);
    };
    if (sync) { while (this.tasks.length) run(); return; }
    const step = () => {
      const t0 = performance.now();
      while (this.tasks.length && performance.now() - t0 < 8) run();
      if (this.tasks.length) setTimeout(step, 16);
    };
    step();
  }
  pick(name) { const v = this.bank[name]; return v ? v[(Math.random() * v.length) | 0] : null; }
  tier(e) { return TIERS[e < 0.33 ? 0 : e < 0.7 ? 1 : 2]; }
  at(t) { return t == null ? this.eng.now() : t; }

  // one-shot with variation, positional gain/pan, cooldown
  shot(name, { key = name, cd = 0.08, e = 1, gain = 1, p = null, bus = 'sfx', prio = 1, rate = 1, vary = 0.05, t } = {}) {
    if (!this.eng.running) return;
    t = this.at(t);
    if (!this.eng.gate(key, cd, e, t)) return;
    const g = gain * this.L.gain(p) * Math.pow(10, rnd(-1.2, 1.2) / 20);
    this.eng.play(this.pick(name), { bus, gain: g, pan: this.L.pan(p), rate: rate * (1 + rnd(-vary, vary)), when: t, prio });
  }

  // ---- events ----
  hit(e = 0.5, spinner = false, p = null, t) {
    e = clamp01(e); t = this.at(t);
    const name = (spinner ? 'spin_' : 'bump_') + this.tier(e);
    this.shot(name, { key: 'hit', cd: 0.07, e, gain: 0.32 + 0.6 * e, p, prio: 3, vary: 0.06, t });
    if (e > 0.3) this.eng.duck(0.5 * e, t);
  }
  wall(e = 0.4, p = null, t) {
    e = clamp01(e);
    this.shot('wall_' + this.tier(e), { key: 'wall', cd: 0.09, e, gain: 0.2 + 0.6 * e, p, prio: 2, t });
  }
  flip(r = null, t) {
    const grab = r && r.def && r.def.weaponKind === 'grabber';
    this.shot(grab ? 'lift' : 'flip', { key: 'flip' + (r ? r.def.id : ''), cd: 0.15, gain: grab ? 0.3 : 0.5, p: r && r.root ? r.root.position : null, prio: 2, vary: 0.04, t });
  }
  grab(r = null, t) { this.shot('clamp', { key: 'clamp', cd: 0.3, gain: 0.55, p: r && r.root ? r.root.position : null, prio: 2, t }); }
  fall(t) { this.shot('fall', { cd: 0.6, gain: 0.55, prio: 3, vary: 0.02, t }); }
  pitOpen(t) { this.shot('pit', { cd: 0.6, gain: 0.45, prio: 2, vary: 0.02, t }); }
  beep(final = false, t) {
    if (final) this.shot('go', { key: 'beep', cd: 0.25, gain: 0.26, bus: 'ui', prio: 4, vary: 0, t });
    else this.shot('beep', { key: 'beep', cd: 0.25, gain: 0.22, bus: 'ui', prio: 4, vary: 0, t });
  }
  buzzer(t) { this.shot('bell', { cd: 1, gain: 0.36, bus: 'ui', prio: 4, vary: 0, t }); }
  crowd(e = 1, t) {
    if (!this.ambOn) return;
    this.shot('crowd', { key: 'crowd', cd: 2.5, e, gain: 0.07 + 0.12 * clamp01(e), bus: 'amb', prio: 1, vary: 0.04, t });
  }
  jingle(win = true, t) { this.shot(win ? 'win' : 'lose', { key: 'jingle', cd: 1, gain: 0.32, bus: 'ui', prio: 4, vary: 0, t }); }
  click(t) { this.shot('click', { cd: 0.04, gain: 0.5, bus: 'ui', prio: 0, vary: 0.04, t }); }

  // ---- continuous ----
  listen(camera) { this.L.from(camera); }
  ambience(on, t) {
    this.ambOn = on;
    if (!this.eng.running) return;
    if (!this.amb && this.bank.amb) this.amb = this.eng.loop(this.bank.amb[0], 'amb', { pan: false });
    if (this.amb) this.eng.steer(this.amb, on ? 0.14 : 0, 1, 0, this.at(t), on ? 0.6 : 0.25);
  }
  voice(id, spinner) {
    let v = this.robots.get(id);
    if (v && (!spinner || v.hum)) return v;
    if (!this.bank.motor || (spinner && !this.bank.hum)) return null;
    if (!v) {
      v = { drive: this.eng.loop(this.bank.motor[0], 'motors'), hum: null, whoosh: null,
        x: 0, y: 0, z: 0, vx: 0, vz: 0, t: -1, smooth: 0, load: 0, peakI: 1, dop: 1, r: null };
      this.robots.set(id, v);
    }
    if (spinner) { v.hum = this.eng.loop(this.bank.hum[0], 'motors'); v.whoosh = this.eng.loop(this.bank.whoosh[0], 'motors'); }
    return v;
  }
  // level 0..1 (main.js gate: 0 outside the fight), spin 0..1, r = Robot (optional, richer data)
  motor(id, level, spin = 0, r = null, t) {
    if (!this.eng.running) return;
    t = this.at(t);
    if (level > 0.001 || spin > 0.01) this.ambience(true, t);
    const isSpin = spin > 0.001 || !!(r && r.spinner);
    const v = this.voice(id, isSpin);
    if (!v) return;
    v.r = r;
    // kinematics from position deltas (doppler + scrape), no allocation
    const pos = r && r.root ? r.root.position : null;
    let vr = 0;
    if (pos) {
      const dt = v.t < 0 ? 0 : t - v.t;
      if (dt > 0.004) {
        const vx = (pos.x - v.x) / dt, vz = (pos.z - v.z) / dt;
        v.vx += (vx - v.vx) * 0.4; v.vz += (vz - v.vz) * 0.4;
        v.x = pos.x; v.y = pos.y; v.z = pos.z; v.t = t;
      } else if (v.t < 0) { v.x = pos.x; v.y = pos.y; v.z = pos.z; v.t = t; }
      const L = this.L, dx = v.x - L.px, dy = v.y - L.py, dz = v.z - L.pz, d = Math.hypot(dx, dy, dz) || 1;
      vr = (v.vx * dx + v.vz * dz) / d;                          // + = moving away
    }
    const gpos = this.L.gain(pos), pan = this.L.pan(pos);
    // drive: wheel speed -> pitch, current -> level & bog-down
    let sp = level, load = 0;
    if (r && r.drive) {
      const w = r.drive.wheelOmega, wr = (r.def && r.def.wheelR) || 0.22, vmax = (r.def && r.def.vmax) || 6;
      sp = clamp01(((Math.abs(w[0]) + Math.abs(w[1])) * 0.5 * wr) / vmax);
      const I = r.drive.current || 0; v.peakI = Math.max(v.peakI * 0.999, I, 1);
      load = clamp01(I / v.peakI);
      if (level <= 0.001) { sp = 0; load = 0; }
    }
    v.load += (load - v.load) * 0.2;
    const on = sp > 0.02 || v.load > 0.15;
    const dg = on ? (0.02 + 0.05 * Math.pow(sp, 0.8) + 0.03 * v.load) * gpos : 0;
    const dr = (0.55 + 0.95 * sp) * (1 - 0.1 * v.load);
    this.eng.steer(v.drive, dg, dr, pan, t, 0.05);
    // spinner: hum + whoosh, doppler from radial velocity (scaled units: subtle +-3 %)
    if (v.hum) {
      const s = clamp01(spin), dop = Math.max(0.97, Math.min(1.03, 1 / (1 + vr / 160)));
      v.dop += (dop - v.dop) * 0.3;
      const fb = 34 + 190 * s;                                  // blade-pass frequency, Hz
      const hg = s > 0.02 ? (0.02 + 0.08 * Math.pow(s, 1.3)) * gpos : 0;
      const wg = s > 0.02 ? 0.14 * Math.sin(Math.PI * Math.min(1, s * 1.25)) * (0.4 + 0.6 * (1 - s)) * gpos : 0;
      this.eng.steer(v.hum, hg, (fb / 80) * v.dop, pan, t, 0.07);
      this.eng.steer(v.whoosh, wg, Math.min(2.5, fb / 10) * v.dop, pan, t, 0.07);
    }
    if (id === 2) this.scrapeTick(t);
  }
  // robots in contact and sliding past each other -> plastic scrape
  scrapeTick(t) {
    const a = this.robots.get(1), b = this.robots.get(2);
    if (!a || !b || !this.bank.scrape) return;
    if (!this.scrape) this.scrape = this.eng.loop(this.bank.scrape[0], 'sfx');
    const ra = a.r, rb = b.r;
    const reach = ((ra && ra.boundR) || 0.7) + ((rb && rb.boundR) || 0.7);
    const d = Math.hypot(a.x - b.x, a.z - b.z), rel = Math.hypot(a.vx - b.vx, a.vz - b.vz);
    const s = d < reach * 0.62 ? clamp01((rel - 0.6) / 5) : 0;
    const mid = this._mid; mid.x = (a.x + b.x) / 2; mid.y = (a.y + b.y) / 2; mid.z = (a.z + b.z) / 2;
    this.eng.steer(this.scrape, s > 0 ? 0.13 * s * this.L.gain(mid) : 0, 0.8 + 0.4 * s, this.L.pan(mid), t, 0.05);
  }
  stopMotors(t) {
    if (!this.eng.running) return;
    t = this.at(t);
    for (const v of this.robots.values()) {
      this.eng.steer(v.drive, 0, v.drive.cur.rate, v.drive.cur.pan, t, 0.08);
      if (v.hum) { this.eng.steer(v.hum, 0, v.hum.cur.rate * 0.6, v.hum.cur.pan, t, 0.25); this.eng.steer(v.whoosh, 0, v.whoosh.cur.rate, v.whoosh.cur.pan, t, 0.15); }
      v.t = -1;
    }
    if (this.scrape) this.eng.steer(this.scrape, 0, 1, 0, t, 0.05);
    this.ambience(false, t);
  }
}
