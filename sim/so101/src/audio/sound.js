// SO-101 sound: six quiet servo voices (pitch/level follow each joint's speed), gripper moves and
// squeeze, object taps from velocity jumps, soft success chime, haptics on phones.
// Off by default (opt-in via toolbar / S); volume slider appears under the sound button when on.
// Engine: ./core.js (bus graph, limiter, voice pool, cooldowns). Same public API as the old
// src/ui/audio.js: on, set(), update(), blip(), grip(), grasp(), error(), success(), vibrate().
import { store } from '../ui/store.js';
import { Engine } from './core.js';
import { bankTasks } from './bank.js';

const BASE = [0.86, 0.78, 0.82, 1.0, 1.1, 1.22];   // per joint pitch offset (load / gear differences)
const CSS = `.ux-vol{width:48px;height:92px;border:1px solid var(--ink,#111);background:#fff;display:flex;align-items:center;justify-content:center}
.ux-vol[hidden]{display:none}
.ux-vol input{writing-mode:vertical-lr;direction:rtl;width:24px;height:80px;margin:0;accent-color:var(--ink,#111);cursor:pointer}
@media (max-width:860px){.ux-vol{width:44px;height:84px}.ux-vol input{height:72px}}`;

export class Sound {
  constructor(ux, { context = null } = {}) {
    this.ux = ux;
    this.on = !!store.get('sound', false);
    const v = +store.get('soundVol', 0.7);
    this.vol = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.7;
    this.eng = new Engine({ context, buses: ['sfx', 'motors', 'ui'], maxVoices: 6 });
    if (context) this.on = true;            // offline render (tests)
    this.eng.muted = !this.on;
    this.eng.levels.master = this.vol;
    if (this.eng.ready) this.eng.applyLevels(0);
    this.bank = {}; this.voices = null;
    this.eng.onBuild = () => this.buildBank();
    if (this.eng.ready) this.buildBank(true);
    // per object impact tracking (preallocated: no per-frame allocation)
    this.track = {};
    if (!context) { this.eng.autoUnlock(typeof window !== 'undefined' ? window : null, () => this.on); this.mountVolume(); }
  }

  get ctx() { return this.eng.ctx; }
  ensure() { if (this.on) this.eng.unlock(); return this.eng.ctx; }

  buildBank(sync = false) {
    const tasks = bankTasks(this.eng.ctx.sampleRate);
    if (sync) { for (const [n, fn] of tasks) this.bank[n] = fn().map(d => this.eng.buffer(d)); return; }
    const step = () => {
      const t0 = performance.now();
      while (tasks.length && performance.now() - t0 < 8) { const [n, fn] = tasks.shift(); this.bank[n] = fn().map(d => this.eng.buffer(d)); }
      if (tasks.length) setTimeout(step, 16);
    };
    step();
  }
  pick(n) { const v = this.bank[n]; return v ? v[(Math.random() * v.length) | 0] : null; }
  shot(n, { gain = 1, bus = 'sfx', cd = 0.06, e = 1, prio = 1, vary = 0.04, at = null } = {}) {
    if (!this.on || !this.eng.live) return;
    const t = at == null ? this.eng.now() : at;
    if (!this.eng.gate(n, cd, e, t)) return;
    this.eng.play(this.pick(n), { bus, gain: gain * Math.pow(10, (Math.random() * 2 - 1) * 1 / 20), rate: 1 + (Math.random() * 2 - 1) * vary, when: t, prio });
  }

  set(on) {
    this.on = !!on; store.set('sound', this.on);
    this.eng.setMuted(!this.on);
    if (this.on) this.eng.unlock();
    if (this.volEl) this.volEl.hidden = !this.on;
  }
  setVolume(v) {
    this.vol = Math.max(0, Math.min(1, v)); store.set('soundVol', this.vol);
    this.eng.setLevels({ master: this.vol });
  }

  /** Per frame: sum of |qvel| of the arm (kept for API compatibility; per-joint speeds read from ux.d). */
  update(speed, at = null) {
    if (!this.on || !this.eng.live || !this.bank.servo) return;
    const t = at == null ? this.eng.now() : at, d = this.ux && this.ux.d;
    if (!this.voices) this.voices = BASE.map(() => this.eng.loop(this.bank.servo[0], 'motors', { pan: false }));
    const qv = d && d.qvel;
    for (let i = 0; i < 6; i++) {
      const w = qv ? Math.abs(qv[i]) : (i === 0 ? speed : 0);
      const s = w < 0.06 ? 0 : Math.min(1, (w - 0.06) / 2.5);
      // quiet: six voices together stay well below the UI chimes
      const g = s > 0 ? 0.012 + 0.032 * Math.pow(s, 0.7) : 0;
      this.eng.steer(this.voices[i], g, BASE[i] * (0.65 + 0.7 * s), 0, t, 0.05);
    }
    this.taps(t);
  }
  // free objects: a sudden drop in speed (landing / knock) = tap, scaled by the velocity change
  taps(t) {
    const w = this.ux && this.ux.world; if (!w || !w.o) return;
    const d = this.ux.d, v = d.qvel, x = d.xpos;
    for (const name in w.o) {
      const e = w.o[name]; if (e.kind !== 'free') continue;
      let s = this.track[name]; if (!s) s = this.track[name] = { vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0, init: false };
      const vx = v[e.vadr], vy = v[e.vadr + 1], vz = v[e.vadr + 2], b = e.body;
      const px = x[3 * b], py = x[3 * b + 1], pz = x[3 * b + 2];
      const jump = Math.abs(px - s.px) + Math.abs(py - s.py) + Math.abs(pz - s.pz);
      if (s.init && jump < 0.03 && e.active && this.ux.held !== name) {
        const dv = Math.hypot(vx - s.vx, vy - s.vy, vz - s.vz), before = Math.hypot(s.vx, s.vy, s.vz);
        // landing: was falling, now stopped; knock: big change at speed
        if (dv > 0.12 && before > 0.1 && Math.hypot(vx, vy, vz) < before * 0.75) {
          const e01 = Math.min(1, (dv - 0.1) / 0.9);
          this.shot(name === 'ball' ? 'tapSoft' : 'tap', { gain: 0.12 + 0.45 * e01, cd: 0.08, e: e01, prio: 2, vary: 0.06, at: t });
        }
      }
      s.vx = vx; s.vy = vy; s.vz = vz; s.px = px; s.py = py; s.pz = pz; s.init = true;
    }
  }

  blip(_f, _d, _ty, _v, _w, at) { this.shot('tick', { gain: 0.35, bus: 'ui', cd: 0.04, prio: 0, at }); }
  grip(open, at) { this.shot(open ? 'open' : 'close', { gain: 0.25, cd: 0.12, at }); }
  grasp(at) { this.shot('squeeze', { gain: 0.28, cd: 0.25, prio: 2, at }); this.vibrate(25); }
  error(at) { this.shot('error', { gain: 0.32, bus: 'ui', cd: 0.4, prio: 3, vary: 0, at }); }
  success(at) {
    this.shot('chime', { gain: 0.38, bus: 'ui', cd: 1, prio: 4, vary: 0, at });
    this.vibrate([30, 60, 30, 60, 80]);
  }
  vibrate(p) { try { if (this.ux && this.ux.touch && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }

  // volume slider tile under the toolbar's sound button (shown only while sound is on)
  mountVolume() {
    try {
      const btn = document.getElementById('ux-sound');
      if (!btn || this.volEl) return;
      const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      const box = document.createElement('div'); box.className = 'ux-vol'; box.hidden = !this.on;
      box.innerHTML = '<input type="range" min="0" max="100" step="5" aria-label="Hlasitost zvuku">';
      const inp = box.firstChild; inp.value = Math.round(this.vol * 100);
      inp.addEventListener('input', () => this.setVolume(inp.value / 100));
      inp.addEventListener('change', () => this.blip());
      btn.insertAdjacentElement('afterend', box);
      this.volEl = box;
    } catch (e) { /* UI is optional */ }
  }
}
