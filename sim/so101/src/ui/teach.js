// "Učení ukázkou": record a demonstration (joint trajectory), replay / loop it, export as LeRobot-like JSON.

import { store } from './store.js';
import { MISSIONS } from '../missions.js';
import { track } from '../analytics.js';

const FPS = 30, MAX_S = 180;
const SNAP_KEYS = ['qpos', 'qvel', 'ctrl', 'act', 'mpos', 'mquat'];
const MAX_FRAMES = MAX_S * FPS + 60;
const MAX_HASH = 400000, MAX_JSON = 4 * 1024 * 1024;     // shared links: base64 chars / decompressed bytes
const NAMES = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];

export class Teach {
  constructor(ux) {
    this.ux = ux; this.app = ux.app; this.d = ux.app.d; this.m = ux.app.m;
    this.recording = false; this.replaying = false; this.loop = false;
    this.demo = null;            // { t:[], obs:[[6]], act:[[6]], snap, mission }
    this.listeners = [];
  }
  onChange(fn) { this.listeners.push(fn); }
  changed() { for (const f of this.listeners) f(this); }

  snapshot() {
    const d = this.d;
    return {
      qpos: Float64Array.from(d.qpos), qvel: Float64Array.from(d.qvel), ctrl: Float64Array.from(d.ctrl),
      act: d.act ? Float64Array.from(d.act) : null,
      mpos: Float64Array.from(d.mocap_pos), mquat: Float64Array.from(d.mocap_quat), time: d.time
    };
  }
  restore(s) {
    const d = this.d;
    d.qpos.set(s.qpos); d.qvel.set(s.qvel); d.ctrl.set(s.ctrl);
    if (s.act && d.act) d.act.set(s.act);
    d.mocap_pos.set(s.mpos); d.mocap_quat.set(s.mquat);
    try { d.time = s.time; } catch (e) { /* read-only binding: rt0 is taken after restore anyway */ }
    d.qacc_warmstart && d.qacc_warmstart.fill(0);
    this.ux.mj.mj_forward(this.m, d);
  }

  // ---------- validation of everything that comes from outside (link, file, localStorage) ----------
  /** Snapshot from plain data: every array present, exact model length, all finite. Returns typed snap or null. */
  validSnap(s) {
    if (!s || typeof s !== 'object') return null;
    const d = this.d, want = { qpos: d.qpos.length, qvel: d.qvel.length, ctrl: d.ctrl.length, act: d.act ? d.act.length : 0, mpos: d.mocap_pos.length, mquat: d.mocap_quat.length };
    const out = { time: 0 };
    for (const k of SNAP_KEYS) {
      const v = s[k], n = want[k];
      if (n === 0 && (v == null || (v.length === 0))) { out[k] = null; continue; }
      if (!v || typeof v.length !== 'number' || v.length !== n) return null;
      const a = new Float64Array(n);
      for (let i = 0; i < n; i++) { const x = v[i]; if (typeof x !== 'number' || !Number.isFinite(x)) return null; a[i] = x; }
      out[k] = a;
    }
    if (s.time != null) { if (typeof s.time !== 'number' || !Number.isFinite(s.time) || s.time < 0) return null; out.time = s.time; }
    return out;
  }
  /** Frames: same count, 5…MAX_FRAMES, t finite and non-decreasing, rows of 6 finite numbers (actions clamped). */
  validFrames(t, act, obs) {
    if (!Array.isArray(t) || !Array.isArray(act) || !Array.isArray(obs)) return null;
    const n = t.length;
    if (n < 5 || n > MAX_FRAMES || act.length !== n || obs.length !== n) return null;
    const cr = this.m.actuator_ctrlrange, A = this.app.act, T = new Array(n), AC = new Array(n), OB = new Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const ti = t[i];
      if (typeof ti !== 'number' || !Number.isFinite(ti) || ti < prev || ti > MAX_S + 5) return null;
      T[i] = prev = ti;
      const a = act[i], o = obs[i];
      if (!Array.isArray(a) || !Array.isArray(o) || a.length !== 6 || o.length !== 6) return null;
      const ra = new Array(6), ro = new Array(6);
      for (let k = 0; k < 6; k++) {
        if (typeof a[k] !== 'number' || !Number.isFinite(a[k]) || typeof o[k] !== 'number' || !Number.isFinite(o[k])) return null;
        ra[k] = Math.min(cr[2 * A[k] + 1], Math.max(cr[2 * A[k]], a[k])); ro[k] = o[k];
      }
      AC[i] = ra; OB[i] = ro;
    }
    return { t: T, act: AC, obs: OB };
  }

  startRec() {
    if (this.replaying) this.stopReplay();
    this.recording = true;
    this.demo = { t: [], obs: [], act: [], snap: this.snapshot(), mission: this.ux.runner.m, t0: this.d.time, next: 0 };
    this.ux.runner.ctx.s = {};   // mission progress counts from the start of the recording
    this.changed();
  }
  stopRec() {
    if (!this.recording) return;
    this.recording = false;
    if (this.demo && this.demo.t.length < 5) this.demo = null;   // too short to be useful
    this.restored = false; this.shared = false;
    this.persist();
    this.changed();
  }

  // ---------- keep / edit / share a demonstration (P1-5) ----------
  /** Save the demonstration in localStorage so it survives a reload. */
  persist() {
    if (!this.demo) { store.set('demo', null); return; }
    const D = this.demo, r = (v) => Math.round(v * 1e5) / 1e5;
    const snap = {}; for (const k of SNAP_KEYS) snap[k] = D.snap[k] ? Array.from(D.snap[k], r) : null;
    snap.time = D.snap.time;
    store.set('demo', { v: 1, mission: D.mission.id, t: D.t.map(r), obs: D.obs.map((a) => a.map(r)), act: D.act.map((a) => a.map(r)), snap });
  }
  /** Restore the saved demonstration (if any) on start. */
  load() {
    const j = store.get('demo', null);
    if (!j || j.v !== 1) return false;
    const mission = MISSIONS.find((m) => m.id === j.mission), snap = this.validSnap(j.snap), fr = this.validFrames(j.t, j.act, j.obs);
    if (!mission || !snap || !fr) { store.set('demo', null); return false; }   // older scene or damaged: forget it
    this.demo = { t: fr.t, obs: fr.obs, act: fr.act, snap, mission, t0: 0, next: 0 };
    this.restored = true;
    this.changed();
    return true;
  }
  clear() { this.stopReplay(); this.demo = null; this.restored = false; this.persist(); this.changed(); }
  /** Cut the idle part at the start and at the end. Returns the number of removed frames. */
  trim() {
    const D = this.demo; if (!D) return 0;
    const n = D.t.length, mv = (i) => { let s = 0; for (let j = 0; j < 6; j++) s += Math.abs(D.act[i][j] - D.act[i - 1][j]); return s > 0.004; };
    let a = 1; while (a < n && !mv(a)) a++;
    let b = n - 1; while (b > a && !mv(b)) b--;
    if (a >= n) return 0;
    const from = Math.max(0, a - 4), to = Math.min(n - 1, b + 15);   // keep ~0.5 s after the last motion (settling)
    const removed = n - (to - from + 1);
    if (!removed) return 0;
    const t0 = D.t[from];
    D.t = D.t.slice(from, to + 1).map((t) => t - t0); D.obs = D.obs.slice(from, to + 1); D.act = D.act.slice(from, to + 1);
    this.persist(); this.changed();
    return removed;
  }
  /** A link that carries the demonstration (gzip + base64url in the #hash; no server involved). */
  async shareURL() {
    const D = this.demo; if (!D || typeof CompressionStream === 'undefined') return null;
    const r = (v) => Math.round(v * 1e4) / 1e4, snap = {};
    for (const k of SNAP_KEYS) snap[k] = D.snap[k] ? Array.from(D.snap[k], r) : null;
    const body = JSON.stringify({ v: 1, m: D.mission.id, t: D.t.map(r), a: D.act.map((x) => x.map(r)), o: D.obs.map((x) => x.map(r)), s: snap });
    const gz = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    let bin = ''; const u8 = new Uint8Array(gz); for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    track('demo_shared', { mission: D.mission.id });
    return location.origin + location.pathname + '#ukazka=' + b64;
  }
  /** Load a demonstration from the #ukazka= hash. Returns the number of frames or 0. */
  async loadFromHash() {
    const m = /#ukazka=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m || typeof DecompressionStream === 'undefined') return 0;
    // the link is consumed once: a reload must not re-import it over later work
    try { if (typeof history !== 'undefined') history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    if (m[1].length > MAX_HASH) { this.rejected = 'too-big'; return 0; }
    try {
      const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      // decompress with a size cap (a tiny gzip can expand enormously)
      const reader = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(), parts = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > MAX_JSON) { reader.cancel().catch(() => {}); this.rejected = 'too-big'; return 0; }
        parts.push(value);
      }
      const all = new Uint8Array(size); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
      const j = JSON.parse(new TextDecoder().decode(all));
      const mission = j && MISSIONS.find((x) => x.id === j.m), snap = j && this.validSnap(j.s), fr = j && this.validFrames(j.t, j.a, j.o);
      if (!mission || !snap || !fr) { this.rejected = 'invalid'; return 0; }
      this.demo = { t: fr.t, obs: fr.obs, act: fr.act, snap, mission, t0: 0, next: 0 };
      this.restored = false; this.shared = true;
      this.persist(); this.changed();
      return fr.t.length;
    } catch (e) { this.rejected = 'invalid'; return 0; }
  }

  /** Import the JSON from download() (also from another computer). Returns the number of frames. */
  importJSON(j) {
    const ep = j && j.episodes && j.episodes[0];
    if (!ep || !Array.isArray(ep.frames) || ep.frames.length < 5 || j.fps !== FPS) throw new Error('not a demo');
    const [glo, ghi] = this.ux.ctl.kin.c.range[5];
    const back = (v) => v.map((x, i) => (i === 5 ? glo + x / 100 * (ghi - glo) : x * Math.PI / 180));
    const pr = j.printedrobotics || {};
    const mission = MISSIONS.find((m) => m.id === pr.mission) || this.ux.runner.m;
    if (ep.frames.length > MAX_FRAMES) throw new Error('too long');
    const row = (v) => { if (!Array.isArray(v) || v.length !== 6) throw new Error('bad row'); return back(v); };
    const t = [], obs = [], act = [];
    for (const f of ep.frames) { if (!f || typeof f !== 'object') throw new Error('bad frame'); t.push(f.timestamp); obs.push(row(f['observation.state'])); act.push(row(f.action)); }
    const fr = this.validFrames(t, act, obs);
    if (!fr) throw new Error('bad frames');
    let snap = null;
    if (pr.snapshot != null) { snap = this.validSnap(pr.snapshot); if (!snap) throw new Error('bad snapshot'); }   // partial = reject
    const D = { t: fr.t, obs: fr.obs, act: fr.act, mission, t0: 0, next: 0 };
    if (this.recording) this.stopRec();
    this.stopReplay();
    if (snap) {
      D.snap = snap;
    } else {
      // no scene snapshot: the mission's start scene with the arm at the first recorded pose
      this.ux.beginReplayReset({ mission });
      const act = this.app.act, m = this.m;
      for (let i = 0; i < 6; i++) { this.d.qpos[m.jnt_qposadr[m.actuator_trnid[2 * act[i]]]] = D.obs[0][i]; this.d.ctrl[act[i]] = D.act[0][i]; }
      this.ux.mj.mj_forward(m, this.d);
      D.snap = this.snapshot();
    }
    this.demo = D; this.restored = false;
    this.persist(); this.changed();
    return D.t.length;
  }

  /** Called after physics each frame. */
  sample() {
    if (!this.recording) return;
    const D = this.demo, t = this.d.time - D.t0;
    if (t < D.next) return;
    D.next = t + 1 / FPS;
    const qp = this.d.qpos, c = this.d.ctrl, act = this.app.act, o = new Array(6), a = new Array(6);
    for (let i = 0; i < 6; i++) { o[i] = qp[i]; a[i] = c[act[i]]; }
    D.t.push(t); D.obs.push(o); D.act.push(a);
    if (t > MAX_S) this.stopRec();
  }

  /**
   * "Posunout kostku a přehrát znovu": the same recorded actions, but the mission's object lies a few cm
   * elsewhere, so the replay (open loop, like a single LeRobot demonstration) visibly misses.
   */
  startShiftedReplay() {
    if (!this.demo) return false;
    const DIRS = [[-0.04, 0], [0, 0.04], [0.04, 0], [0, -0.04]];
    this.shiftN = ((this.shiftN || 0) + 1) % DIRS.length;
    this.shift = DIRS[this.shiftN];
    this.shiftResult = null;
    if (this.startReplay(true)) return true;
    this.shift = null; return false;
  }
  /** move the demo mission's first object by this.shift (after the snapshot was restored) */
  applyShift() {
    const w = this.ux.world, m = this.demo.mission;
    const name = Object.keys(m.targets || {}).find((n) => (m.targets[n] === 'pick' || m.targets[n] === 'push') && w.o[n] && w.o[n].kind === 'free' && w.o[n].active);
    if (!name) { this.shift = null; return; }
    const p = w.pos(name, [0, 0, 0]), e = w.o[name];
    w.place(name, p[0] + this.shift[0], p[1] + this.shift[1], e.lib ? null : p[2], w.yaw(name));
    this.shiftObj = name;
    this.ux.mj.mj_forward(this.m, this.d);
  }

  startReplay(keepShift) {
    if (!this.demo) return false;
    if (!keepShift) { this.shift = null; this.shiftResult = null; }
    if (this.recording) this.stopRec();
    this.ux.ctl.cancel(); this.app.stopDemo();
    try { this.restart(); }
    catch (e) {
      // never throw into the UI: a damaged demonstration is dropped with a message
      this.demo = null; this.persist(); this.changed();
      if (this.ux.panel) this.ux.panel.toast('Ukázku nejde přehrát – je poškozená, smazali jsme ji', 'err');
      return false;
    }
    this.replaying = true;
    this.changed();
    return true;
  }
  /** Scene of the recorded mission first (keyframe reset), then the exact snapshot, then the clock. */
  restart() {
    this.ux.beginReplayReset(this.demo);
    this.restore(this.demo.snap);
    if (this.shift) this.applyShift();
    this.rt0 = this.d.time; this.k = 0;
  }
  stopReplay() { if (!this.replaying) return; this.replaying = false; this.changed(); }

  /** Before physics: drive ctrl from the recorded actions (linear interpolation in time). */
  pre() {
    if (!this.replaying) return;
    const D = this.demo, t = this.d.time - this.rt0, T = D.t;
    if (t > T[T.length - 1] + 0.6) {
      if (this.loop) { this.restart(); return; }
      if (this.shift) { this.shiftResult = this.ux.runner.won ? 'hit' : 'miss'; this.shift = null; }
      this.stopReplay(); return;
    }
    while (this.k < T.length - 2 && T[this.k + 1] < t) this.k++;
    const k = this.k, k2 = Math.min(T.length - 1, k + 1), span = T[k2] - T[k] || 1, f = Math.max(0, Math.min(1, (t - T[k]) / span));
    const c = this.d.ctrl, act = this.app.act, A = D.act[k], B = D.act[k2];
    for (let i = 0; i < 6; i++) c[act[i]] = A[i] + (B[i] - A[i]) * f;
  }
  progress() { if (!this.replaying) return 0; const T = this.demo.t; return Math.min(1, (this.d.time - this.rt0) / (T[T.length - 1] || 1)); }
  duration() { return this.demo ? this.demo.t[this.demo.t.length - 1] : 0; }

  /** LeRobot-like episode JSON (a demo format, not a loadable LeRobot dataset). */
  toJSON() {
    const D = this.demo; if (!D) return null;
    const deg = (v) => Math.round(v * 180 / Math.PI * 100) / 100;
    const [glo, ghi] = this.ux.ctl.kin.c.range[5];
    const grip = (v) => Math.round((v - glo) / (ghi - glo) * 1000) / 10;   // 0–100 % open, like LeRobot's gripper
    const conv = (v) => v.map((x, i) => (i === 5 ? grip(x) : deg(x)));
    const names = NAMES.map((n) => n + '.pos');
    return {
      format: 'printedrobotics.cz/so101-sim-demo@1',
      note: 'Ukázkový formát inspirovaný datasety LeRobot (sloupce observation.state a action po snímcích). ' +
        'Slouží k pochopení principu, není to přímo načitatelný LeRobot dataset (ten používá Parquet a videa z kamer).',
      robot_type: 'so101_follower',
      source: 'simulation (MuJoCo, printedrobotics.cz/sim/so101/)',
      fps: FPS,
      features: {
        'observation.state': { dtype: 'float32', shape: [6], names, unit: 'stupně, gripper.pos = 0–100 % otevření' },
        action: { dtype: 'float32', shape: [6], names, unit: 'stupně, gripper.pos = 0–100 % otevření' },
        timestamp: { dtype: 'float32', shape: [1] },
        frame_index: { dtype: 'int64', shape: [1] },
        episode_index: { dtype: 'int64', shape: [1] }
      },
      printedrobotics: {
        mission: D.mission.id,
        note: 'Výchozí stav scény pro přehrání v simulátoru (qpos, qvel, ctrl, mocap); LeRobot tuto část ignoruje.',
        snapshot: Object.fromEntries(SNAP_KEYS.map((k) => [k, D.snap[k] ? Array.from(D.snap[k]) : null]).concat([['time', D.snap.time]]))
      },
      episodes: [{
        episode_index: 0, task: D.mission.title, length: D.t.length,
        frames: D.t.map((t, i) => ({
          frame_index: i, timestamp: Math.round(t * 1000) / 1000,
          'observation.state': conv(D.obs[i]), action: conv(D.act[i])
        }))
      }]
    };
  }

  download() {
    const j = this.toJSON(); if (!j) return null;
    const blob = new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'so101-ukazka-' + this.demo.mission.id + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return j;
  }
}
