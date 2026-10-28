// "Učení ukázkou": record a demonstration (joint trajectory), replay / loop it, export as LeRobot-like JSON.

const FPS = 30, MAX_S = 180;
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
    this.changed();
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

  startReplay() {
    if (!this.demo) return false;
    if (this.recording) this.stopRec();
    this.ux.ctl.cancel(); this.app.stopDemo();
    this.restart();
    this.replaying = true;
    this.changed();
    return true;
  }
  /** Scene of the recorded mission first (keyframe reset), then the exact snapshot, then the clock. */
  restart() {
    this.ux.beginReplayReset(this.demo);
    this.restore(this.demo.snap);
    this.rt0 = this.d.time; this.k = 0;
  }
  stopReplay() { if (!this.replaying) return; this.replaying = false; this.changed(); }

  /** Before physics: drive ctrl from the recorded actions (linear interpolation in time). */
  pre() {
    if (!this.replaying) return;
    const D = this.demo, t = this.d.time - this.rt0, T = D.t;
    if (t > T[T.length - 1] + 0.6) {
      if (this.loop) { this.restart(); return; }
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
