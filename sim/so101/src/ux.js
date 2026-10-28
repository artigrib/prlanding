// UX layer for the SO-101 simulation: smart move (IK), click-to-pick planner, missions, teach & replay,
// cameras, onboarding, sound, confetti. Installed from app.js via the [ux-hook:*] points (see UX-NOTES.md).

import { ArmController, GRIP_OPEN, GRIP_CLOSED } from './controller.js';
import { World } from './world.js';
import { MISSIONS, MissionRunner, bowlDrop, pushPlan } from './missions.js';
import { Extras } from './ui/extras.js';
import { Gizmo } from './ui/gizmo.js';
import { Cameras } from './ui/cameras.js';
import { Teach } from './ui/teach.js';
import { Panel } from './ui/panel.js';
import { Sound } from './ui/audio.js';
import { Confetti } from './ui/fx.js';
import { Onboarding } from './ui/onboarding.js';
import { Explode } from './ui/explode.js';
import { HiDetail } from './ui/hidetail.js';
import { store } from './ui/store.js';

export async function install(app, env) {
  const ux = new UX(app, env);
  app.ux = ux;
  ux.start();
  return ux;
}

const PREVIEW_S = 0.6;     // path preview before the arm starts moving

class UX {
  constructor(app, { THREE, mj, TEST }) {
    this.app = app; this.T = THREE; this.mj = mj; this.TEST = TEST;
    this.m = app.m; this.d = app.d;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.world = new World(mj, app.m, app.d);
    this.ctl = new ArmController(mj, app.m, app.d, app.act);
    this.runner = new MissionRunner(this.world);
    this.progress = store.get('progress', {}) || {};
    this.mode = store.get('mode', 'smart') === 'joints' ? 'joints' : 'smart';
    this.penTool = false;
    this.pending = null; this.held = null; this.hudKey = '';
    this.tipBuf = new Float64Array(3);
    // app.js's own cube mesh (so missions without it can hide it)
    for (const [g, mesh] of app.geoms) if (app.m.geom_bodyid[g] === app.cubeBody) { this.cubeMesh = mesh; mesh.userData.pick = 'cube'; }
    for (const [g, mesh] of app.geoms) if (app.m.geom_type[g] === 6 && app.m.geom_bodyid[g] === 0) { this.tableMesh = mesh; mesh.userData.pick = 'table'; }

    this.extras = new Extras(this);
    this.teach = new Teach(this);
    this.panel = new Panel(this);
    this.gizmo = new Gizmo(this);
    this.cameras = new Cameras(this);
    this.sound = new Sound(this);
    this.confetti = new Confetti(this.panel.stage, this.reduced);
    this.onboarding = new Onboarding(this);
    for (const n of ['cube_b', 'ball', 'bowl', 'bowl2', 'goal']) this.extras.meshes[n].userData.pick = n;
    this.explode = new Explode(this);
    this.hd = new HiDetail(this);
    this.panel.qualityUI();
    this.pickList = [];

    this.ctl.on('grip', (open) => { this.sound.grip(open); this.onboarding.notify('grip'); });
    this.ctl.on('done', () => { this.gizmo.fadePath(); });
    this.teach.onChange((t) => this.panel.showTeach(t));
    // joint sliders take over from the controller / replay
    document.getElementById('joints').addEventListener('input', () => {
      this.ctl.cancel(); this.teach.stopReplay(); this.pending = null; this.runner.start();
    });
    this.keys();
  }

  start() {
    const want = new URLSearchParams(location.search).get('mise');
    this.runner.select(want || store.get('mission', 'bowl'));
    this.setMode(this.mode, true);
    this.panel.showPitch(this.ctl.pitch);
    this.panel.showSound(this.sound.on);
    this.panel.showTeach(this.teach);
    this.panel.showView('orbit');
    if (!this.touch && !this.TEST && matchMedia('(min-width:861px)').matches && store.get('wrist', false)) this.setWrist(true);
    this.app.reset();          // applies the mission layout through onReset()
    // high-detail meshes after the first frames (lazy, does not block the start)
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
    idle(() => this.hd.start(), { timeout: 1500 });
    const q = new URLSearchParams(location.search);
    if (q.get('onboard') === '1') setTimeout(() => this.onboarding.start(), 600);
    else if (!this.TEST && !q.has('mise')) setTimeout(() => this.onboarding.maybeStart(), 600);
  }

  // ================= hooks called by app.js =================
  pre(dt) {
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) { const p = this.pending.plan; this.pending = null; this.ctl.run(p); }
    }
    this.teach.pre();
    if (!this.teach.replaying) this.ctl.update(dt);
  }

  check(dt) {
    const w = this.world, r = this.runner, ctx = r.ctx, c = this.d.ctrl, act = this.app.act;
    const fell = w.rescue(r.m.layout);
    if (fell) this.panel.toast(`Spadlo to ze stolu – ${w.o[fell].acc} jsme vrátili zpět`);
    this.ctl.actualTip(ctx.tip);
    ctx.gripOpen = c[act[5]] > 0.5;
    ctx.smart = this.mode === 'smart';
    this.extras.inkAt(ctx.tip);
    const res = r.tick(dt);
    // HUD (live region: write only on change)
    let text = res.text;
    if (this.app.won) text = 'Mise splněna';
    if (text !== this.app.hudText) { document.getElementById('hud-text').textContent = text; this.app.hudText = text; }
    const ok = !!res.ok || this.app.won;
    if (ok !== this.app.hudOk) { document.getElementById('hud').classList.toggle('ok', ok); this.app.hudOk = ok; }
    if (r.won && !this.app.won) this.win();
    // grasp feedback
    const held = this.heldObject();
    if (held && held !== this.held && !ctx.gripOpen) this.sound.grasp();
    this.held = held;
    this.teach.sample();
    // servo sound from joint speed
    const v = this.d.qvel; let sp = 0; for (let i = 0; i < 5; i++) sp += Math.abs(v[i]);
    this.sound.update(sp);
    return true;
  }

  render(dt) {
    this.extras.sync();
    this.gizmo.sync(dt);
    this.cameras.tick(dt);
    if (this.explode) this.explode.tick(dt);
    this.cameras.render();
    this.confetti.tick(dt);
    this.panel.tick();
    this.onboarding.tick();
  }

  onReset() {
    this.ctl.cancel(); this.pending = null;
    if (!this.replayResetting) this.teach.stopReplay();
    this.runner.setup();
    this.extras.onLayout(this.runner.m);
    this.ctl.syncFromCtrl();
    this.gizmo.clearPath();
    this.cameras.stopCinematic();
    this.panel.showMission(this.runner.m, this.progress[this.runner.m.id]);
    this.held = null;
    if (this.teach.recording) this.teach.stopRec();
  }

  startDemo() {
    this.teach.stopReplay();
    this.app.reset();
    this.runner.start();
    const plan = this.runner.m.solve(this.ctl, this.world);
    this.preview(plan, true);
    this.panel.toast('Ruka plánuje řešení…');
    return true;
  }

  // ================= actions =================
  setMode(mode, quiet) {
    this.mode = mode; store.set('mode', mode);
    this.panel.showMode(mode);
    if (mode !== 'smart') { this.ctl.cancel(); this.pending = null; if (this.penTool) this.togglePen(); }
    else this.ctl.syncFromCtrl();
    if (!quiet) this.app.refreshSliders();
  }

  selectMission(id) {
    this.runner.select(id); store.set('mission', id);
    this.teach.stopReplay();
    this.app.reset();
    this.cameras.set('orbit');
  }
  nextMission() {
    const k = MISSIONS.findIndex((m) => m.id === this.runner.m.id);
    this.selectMission(MISSIONS[(k + 1) % MISSIONS.length].id);
    document.getElementById('win-h').blur();
  }

  toggleGrip() {
    if (this.teach.replaying) return;
    const open = this.d.ctrl[this.app.act[5]] > 0.5;
    if (!this.ctl.active) this.ctl.begin();
    this.ctl.setGrip(!open);
    this.runner.start();
  }
  togglePen() {
    this.penTool = !this.penTool;
    if (this.penTool && this.mode !== 'smart') this.setMode('smart');
    this.panel.showPen(this.penTool);
    this.panel.penHint.hidden = !this.penTool;
  }
  setRoll(r) { if (!this.ctl.active) this.ctl.begin(); this.ctl.setRoll(r); this.onUserMove('roll'); }
  setPitch(p) { this.ctl.pitch = p; this.panel.showPitch(p); if (!this.ctl.active) this.ctl.begin(); this.onUserMove('pitch'); }
  cycleView() { const v = this.cameras.cycle(); this.panel.showView(v); }
  setWrist(on) { this.cameras.setWrist(on); this.panel.showWrist(on); store.set('wrist', on); }
  setSound(on) { this.sound.set(on); this.panel.showSound(on); if (on) this.sound.blip(660, 0.08); }
  toggleExplode() { const on = this.explode.toggle(); this.panel.showExplode(on); }

  toggleRec() {
    const t = this.teach;
    if (t.recording) { t.stopRec(); if (t.demo) this.panel.toast('Ukázka nahrána. Přehrajte si ji.'); else this.panel.toast('Ukázka byla příliš krátká', 'err'); }
    else { t.startRec(); this.runner.start(); this.panel.toast('Nahrávám. Vyřešte úkol a pak nahrávání zastavte.'); }
  }
  togglePlay() {
    const t = this.teach;
    if (t.replaying) { t.stopReplay(); return; }
    if (t.startReplay()) this.panel.toast('Ruka opakuje vaši ukázku');
  }
  /** Replay needs the scene of the recorded mission, then teach restores the exact snapshot. */
  beginReplayReset(demo) {
    this.replayResetting = true;
    if (this.runner.m !== demo.mission) { this.runner.select(demo.mission.id); }
    this.app.reset();
    this.replayResetting = false;
  }

  // called by the gizmo
  onUserMove(kind) { this.runner.start(); this.pending = null; this.onboarding.notify(kind); if (this.teach.replaying) this.teach.stopReplay(); }
  onDragEnd(kind) { this.onboarding.notify('dragend-' + kind); }

  pickables() {
    const L = this.pickList; L.length = 0;
    for (const e of this.world.active()) {
      const mesh = e.name === 'cube' ? this.cubeMesh : this.extras.meshes[e.name];
      if (mesh && mesh.visible) L.push(mesh);
    }
    if (this.tableMesh) L.push(this.tableMesh);
    return L;
  }

  /** Free object currently held by the gripper (closed and close to the tip), or null. */
  heldObject() {
    const tip = this.runner.ctx.tip, closed = this.d.ctrl[this.app.act[5]] < 0.4;
    if (!closed) return null;
    for (const e of this.world.active()) {
      if (e.kind !== 'free' || e.name === 'ball') continue;
      const p = this.world.pos(e.name, this.tipBuf);
      if (Math.hypot(p[0] - tip[0], p[1] - tip[1], p[2] - tip[2]) < 0.03) return e.name;
    }
    return null;
  }

  /** Click on an object or the table (MuJoCo point). */
  onPick(name, point) {
    if (this.explode.on) return;
    if (this.teach.replaying) { this.panel.toast('Probíhá přehrávání ukázky'); return; }
    if (this.mode !== 'smart') this.setMode('smart');
    const w = this.world, ctl = this.ctl, held = this.heldObject();
    let plan = null;
    if (name === 'cube' || name === 'cube_b') {
      if (held === name) { this.panel.toast('Kostku už držíte. Klikněte, kam ji položit.'); return; }
      const p = w.pos(name, [0, 0, 0]);
      if (held) {
        plan = ctl.planPlace([p[0], p[1], p[2] + w.o[name].half + w.o[held].half + 0.0015], null, null, () => w.pos(held, [0, 0, 0]));
      } else plan = ctl.planPick(p, w.o[name].half, w.yaw(name));
    } else if (name === 'ball' || name === 'goal') {
      if (!w.o.goal.active) { this.panel.toast('Míček se uchopit nedá. Zkuste ho do něčeho strčit.'); return; }
      plan = pushPlan(ctl, w);
    } else if (name === 'bowl' || name === 'bowl2') {
      if (!held) { this.panel.toast('Nejdřív klikněte na kostku, ruka ji vezme.'); return; }
      plan = ctl.planPlace(bowlDrop(w, name), null, null, () => w.pos(held, [0, 0, 0]));
    } else if (name === 'table') {
      if (held) plan = ctl.planPlace([point[0], point[1], w.o[held].half + 0.001], null, null, () => w.pos(held, [0, 0, 0]));
      else {
        // just move the gripper above the clicked spot
        ctl.begin(); ctl.setTarget(point[0], point[1], Math.max(0.04, ctl.target[2]));
        this.onUserMove('table');
        return;
      }
    }
    if (plan) { this.preview(plan); this.onboarding.notify('plan'); }
  }

  /** Pen tool stroke (MuJoCo xy points) → the tip follows it. */
  onStroke(xy) {
    if (this.teach.replaying) return;
    const z = this.runner.m.pen ? 0.009 : 0.012;
    const plan = this.ctl.planPath(xy.map(([x, y]) => [x, y, z]), { grip: false, speed: 0.06 });
    this.preview(plan);
  }

  preview(plan, demo) {
    this.runner.start();
    this.gizmo.showPath(plan, !this.reduced);
    if (!plan.ok) {
      this.ctl.cancel(); this.pending = null;
      this.panel.toast('Tam ruka nedosáhne. Zkuste bod blíž k ní.', 'err');
      this.sound.error();
      setTimeout(() => this.gizmo.fadePath(), 1200);
      return false;
    }
    this.ctl.cancel();
    this.pending = { plan, t: this.reduced ? 0.25 : PREVIEW_S };
    void demo;
    return true;
  }

  win() {
    const app = this.app, res = this.runner.result, m = this.runner.m;
    app.won = true;
    const best = this.progress[m.id];
    const isNew = !best || res.stars > best.stars || (res.stars === best.stars && res.time < best.time);
    if (!this.teach.replaying && isNew) { this.progress[m.id] = { stars: Math.max(res.stars, best ? best.stars : 0), time: Math.min(res.time, best ? best.time : Infinity) }; store.set('progress', this.progress); }
    this.panel.showWin(m, res, best, isNew && !this.teach.replaying);
    this.panel.showMission(m, this.progress[m.id]);
    document.getElementById('win').hidden = false;
    document.getElementById('win-h').focus({ preventScroll: true });
    this.confetti.burst();
    this.sound.success();
    this.cameras.cinematic();
    if (this.teach.recording) this.panel.toast('Mise splněna. Nahrávání můžete zastavit.');
    try { window.dataLayer && window.dataLayer.push({ event: 'sim_success', robot: 'so101', mission: m.id, stars: res.stars }); } catch (e) { /* ignore */ }
  }

  // ================= keyboard =================
  keys() {
    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target, tag = tg && tg.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key;
      if (k === 'Escape') {
        if (this.panel.modalOpen()) { this.panel.closeModals(); return; }
        if (this.onboarding.active()) { this.onboarding.finish(); return; }
        this.ctl.cancel(); this.pending = null; this.gizmo.clearPath(); this.teach.stopReplay(); return;
      }
      if (this.panel.modalOpen()) return;
      if (k === ' ' && tag === 'BUTTON') return;   // let a focused button handle Space
      const step = e.shiftKey ? 0.02 : 0.008;
      const move = (dx, dy, dz) => {
        if (this.mode !== 'smart') this.setMode('smart');
        if (!this.ctl.active) this.ctl.begin();
        // arrows are relative to the camera heading (projected on the table)
        const cam = this.app.camera, tg2 = this.app.controls.target;
        const fx = tg2.x - cam.position.x, fy = -(tg2.z - cam.position.z), L = Math.hypot(fx, fy) || 1;
        const ux = fx / L, uy = fy / L;           // forward in MuJoCo xy
        const t = this.ctl.target;
        this.ctl.setTarget(t[0] + ux * dy + uy * dx, t[1] + uy * dy - ux * dx, t[2] + dz);
        this.onUserMove('key');
      };
      let used = true;
      switch (k) {
        case 'ArrowUp': move(0, step, 0); break;
        case 'ArrowDown': move(0, -step, 0); break;
        case 'ArrowLeft': move(-step, 0, 0); break;
        case 'ArrowRight': move(step, 0, 0); break;
        case 'PageUp': case 'q': case 'Q': move(0, 0, step); break;
        case 'PageDown': case 'e': case 'E': move(0, 0, -step); break;
        case 'a': case 'A': this.setRoll(this.ctl.roll + 0.1); break;
        case 'd': case 'D': this.setRoll(this.ctl.roll - 0.1); break;
        case ' ': this.toggleGrip(); break;
        case 'm': case 'M': this.setMode(this.mode === 'smart' ? 'joints' : 'smart'); break;
        case 'p': case 'P': this.togglePen(); break;
        case 'c': case 'C': this.cycleView(); break;
        case 'v': case 'V': this.setWrist(!this.cameras.wristOn); break;
        case 'x': case 'X': this.toggleExplode(); break;
        case 't': case 'T': this.toggleRec(); break;
        case 'l': case 'L': this.togglePlay(); break;
        case 'h': case 'H': this.ctl.cancel(); this.pending = null; this.app.goHome(); this.ctl.syncFromCtrl(); break;
        case 'r': case 'R': this.app.reset(); break;
        case 's': case 'S': this.setSound(!this.sound.on); break;
        case '?': this.panel.openHelp(); break;
        default:
          if (k >= '1' && k <= String(MISSIONS.length)) this.selectMission(MISSIONS[+k - 1].id);
          else used = false;
      }
      if (used) e.preventDefault();
    });
  }

  // ================= test hooks (window.__sim with ?test=1) =================
  extendApi(api) {
    const app = this.app, ts = this.m.opt.timestep;
    api.advance = (sec) => {
      const n = Math.round(sec / ts);
      for (let i = 0; i < n; i++) {
        if (i % 4 === 0) this.pre(ts * 4);
        app.tickDemo(ts);
        this.mj.mj_step(this.m, this.d);
        if (i % 4 === 3) this.check(ts * 4);
      }
      app.sync(); this.extras.sync();
    };
    api.missions = MISSIONS.map((m) => m.id);
    api.mission = (id) => this.selectMission(id);
    api.solve = () => this.startDemo();
    api.setMode = (m) => this.setMode(m);
    api.pick = (name, pt) => this.onPick(name, pt || this.world.pos(name, [0, 0, 0]));
    api.screen = (what) => {
      const p = what === 'target' ? (this.ctl.active ? this.ctl.target : this.ctl.actualTip(new Float64Array(3)))
        : what === 'up' ? (() => { const t = this.ctl.active ? this.ctl.target : this.ctl.actualTip(new Float64Array(3)); const s = this.gizmo.root.scale.x; return [t[0], t[1], t[2] + 0.038 * s]; })()
          : this.world.pos(what, [0, 0, 0]);
      return this.gizmo.project(p, {});
    };
    api.record = (on) => { if (on !== this.teach.recording) this.toggleRec(); };
    api.replay = (loop) => { this.teach.loop = !!loop; return this.teach.startReplay(); };
    api.exportDemo = () => this.teach.toJSON();
    api.camera = (v) => { this.cameras.set(v); this.panel.showView(v); };
    api.wrist = (on) => this.setWrist(on);
    api.ux = () => ({
      mission: this.runner.m.id, won: this.runner.won, result: this.runner.result, hud: this.app.hudText,
      mode: this.mode, active: this.ctl.active, busy: this.ctl.busy() || !!this.pending,
      target: Array.from(this.ctl.target), reachable: this.ctl.reachable, tip: Array.from(this.runner.ctx.tip),
      held: this.heldObject(), recording: this.teach.recording, replaying: this.teach.replaying,
      demoFrames: this.teach.demo ? this.teach.demo.t.length : 0, progress: this.progress,
      objects: Object.fromEntries(this.world.active().map((e) => [e.name, Array.from(this.world.pos(e.name, [0, 0, 0]))])),
      explode: this.explode ? this.explode.amount : null, hiDetail: this.hiDetail || false
    });
    api.explode = (on) => { if (on !== this.explode.on) this.toggleExplode(); };
    api.assemble = () => this.explode.startPlay();
    api.quality = (q) => this.hd.set(q);
    api._ux = this;
    return api;
  }
}

void GRIP_OPEN; void GRIP_CLOSED;
