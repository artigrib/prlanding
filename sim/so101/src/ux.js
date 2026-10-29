// UX layer for the SO-101 simulation: smart move (IK), click-to-pick planner, missions, teach & replay,
// cameras, onboarding, sound, confetti. Installed from app.js via the [ux-hook:*] points (see UX-NOTES.md).

import { ArmController, GRIP_OPEN, GRIP_CLOSED } from './controller.js';
import { World } from './world.js';
import { MISSIONS, MissionRunner, bowlDrop, pushPlan, libPick, libPlace, libTarget, libGrasp } from './missions.js';
import { Extras } from './ui/extras.js';
import { Gizmo } from './ui/gizmo.js';
import { Cameras } from './ui/cameras.js';
import { Teach } from './ui/teach.js';
import { Panel } from './ui/panel.js';
import { Sound } from './audio/sound.js';
import { Confetti } from './ui/fx.js';
import { Onboarding } from './ui/onboarding.js';
import { Explode } from './ui/explode.js';
import { Links } from './ui/links.js';
import { DrawAssist } from './draw.js';
import { Grab } from './grab.js';
import { t as tr } from './i18n/index.js';
import { HiDetail } from './ui/hidetail.js';
import { store } from './ui/store.js';
import { track } from './analytics.js';
import { calmMode } from './ui/calm.js';

export async function install(page, env) {
  // core.js layout (servo-emulator branch): the page (MissionPage) owns sliders/demo/HUD, page.sim (ArmSim)
  // owns physics + rendering. The UX layer talks to one "app" facade that routes to whichever owns a member.
  const app = page.sim ? hostFor(page) : page;
  // object missions: their visuals are loaded only with the object scene (mission 01 never fetches them)
  if (env.objects) env.ObjectView = (await import('./objects/view.js')).ObjectView;
  const ux = new UX(app, env);
  page.ux = ux;
  patchSliders(page);
  if (page.sim) page.sim.onRender = (dt) => ux.render(dt);   // [ux-hook:render] in core.js loop()
  ux.start();
  // "Připojit AI": the agent API (window.so101) + panel; never with ?real=1 (see src/agent/index.js)
  try { (await import('./agent/index.js')).installAgent(ux, page); } catch (e) { console.warn('AI panel disabled:', e); }
  ux.panel.mountAI();   // the AI entry is a row of the panel's "Nástroje" (tools) block
  // count the AI's motions since the last reset: the win card credits "Vyřešila to AI v N krocích"
  if (ux.agent && ux.agent.on) ux.agent.on('motion', (e) => { if (e.phase === 'start') ux.aiSteps = (ux.aiSteps || 0) + 1; });
  return ux;
}

// joint sliders: readable values for screen readers and a visible "(doraz)" at the joint limit (P2-5, P2-9)
function patchSliders(page) {
  if (!page.sliders || !page.refreshSlider) return;
  const orig = page.refreshSlider.bind(page);
  page.refreshSlider = (i) => {
    orig(i);
    const sl = page.sliders[i], v = +sl.input.value, lim = !sl.grip && (v <= sl.lo + 1e-3 || v >= sl.hi - 1e-3);
    if (lim) sl.out.textContent += ' (doraz)';
    sl.out.classList.toggle('ux-lim', lim);
    sl.input.setAttribute('aria-valuetext', sl.out.textContent.replace('°', ' stupňů'));
  };
  page.refreshSliders();
}

const PAGE_FIRST = new Set(['reset', 'setCtrl', 'refreshSliders', 'stopDemo', 'tickDemo', 'startDemo', 'hudText', 'hudOk', 'ux']);
function hostFor(page) {
  const sim = page.sim;
  return new Proxy({}, {
    get(_, k) {
      if (k === 'sim') return sim;
      if (k === 'goHome') return () => { sim.goHome(); page.refreshSliders(); };
      const owner = PAGE_FIRST.has(k) || (k in page && !(k in sim)) ? page : sim;
      const v = owner[k];
      return typeof v === 'function' ? v.bind(owner) : v;
    },
    set(_, k, v) { if (PAGE_FIRST.has(k) || (k in page && !(k in sim))) page[k] = v; else sim[k] = v; return true; }
  });
}

const PREVIEW_S = 0.6;     // path preview before the arm starts moving

class UX {
  constructor(app, { THREE, mj, TEST, objects, ObjectView }) {
    this.app = app; this.T = THREE; this.mj = mj; this.TEST = TEST;
    this.m = app.m; this.d = app.d;
    this.calm = calmMode();     // ?klid=1 (remembered): same as prefers-reduced-motion
    this.reduced = this.calm || matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.world = new World(mj, app.m, app.d);
    this.ctl = new ArmController(mj, app.m, app.d, app.act);
    this.runner = new MissionRunner(this.world);
    this.progress = store.get('progress', {}) || {};
    this.wins = store.get('wins', 0) || 0;
    this.mode = store.get('mode', 'smart') === 'joints' ? 'joints' : 'smart';
    this.penTool = false;
    this.pending = null; this.held = null; this.hudKey = '';
    this.tipBuf = new Float64Array(3);
    // app.js's own cube mesh (so missions without it can hide it)
    for (const [g, mesh] of app.geoms) if (app.m.geom_bodyid[g] === app.cubeBody) { this.cubeMesh = mesh; mesh.userData.pick = 'cube'; }
    for (const [g, mesh] of app.geoms) if (app.m.geom_type[g] === 6 && app.m.geom_bodyid[g] === 0) { this.tableMesh = mesh; mesh.userData.pick = 'table'; }

    this.extras = new Extras(this);
    if (this.world.lib && objects) { this.world.sizes(objects.sizes); this.objView = new ObjectView(this, objects); }
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
    this.grab = new Grab(mj, app.m, app.d, app.act);   // physics pull of any link (before Links)
    this.links = new Links(this);
    this.panel.showGrabMode(this.links.mode);
    if (this.links.realArmed) this.panel.grabSeg.hidden = true;
    this.draw = new DrawAssist(); this.draw.help = store.get('draw-help', 1);
    this.panel.qualityUI();
    this.pickList = [];

    this.ctl.on('grip', (open) => { this.sound.grip(open); this.onboarding.notify('grip'); });
    this.ctl.on('done', () => { this.gizmo.fadePath(); });
    this.ctl.on('floor', () => {   // once per gesture: "you hit the table"
      if (this.floorNoted) return; this.floorNoted = true;
      this.panel.toast('Níž to nejde, tam je stůl'); this.sound.blip(140, 0.06, 'square', 0.05);
      setTimeout(() => { this.floorNoted = false; }, 2500);
    });
    this.teach.onChange((t) => this.panel.showTeach(t));
    // joint sliders take over from the controller / replay
    document.getElementById('joints').addEventListener('input', () => {
      this.ctl.cancel(); this.teach.stopReplay(); this.pending = null; this.runner.start();
    });
    this.keysOn = store.get('keys-on', true) !== false;
    this.keys();
    // the visual HUD changes every frame (timer, %, mm): take it out of the live region, announce via #sr
    this.hudEl = document.getElementById('hud-text');
    this.hudEl.removeAttribute('role'); this.hudEl.removeAttribute('aria-live');
    this.srEl = document.getElementById('sr');
    const c = app.renderer.domElement;
    c.tabIndex = 0;
    const desc = document.createElement('p'); desc.id = 'ux-c-desc'; desc.className = 'sr-only';
    desc.textContent = 'Šipky posouvají cíl ruky, PageUp a PageDown mění výšku, mezerník otevře a zavře chapadlo, otazník ukáže všechny zkratky.';
    c.parentNode.appendChild(desc); c.setAttribute('aria-describedby', desc.id);
    c.setAttribute('aria-label', 'Robotická ruka SO-101 na stole s předměty mise. Ovládání: modrá koule (režim Táhnout ruku), klik na předmět, šipky a mezerník, nebo posuvníky kloubů v režimu Klouby.');
  }

  start() {
    this.runner.select(this.startRoute(new URLSearchParams(location.search)));
    // hint buttons (both play the planner's solution, see startDemo): which one was used
    addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('#ux-hint,#ux-qhint'); if (b) track('hint_used', { mission: this.runner.m.id, level: b.id === 'ux-hint' ? 1 : 2 }); }, true);
    if (this.runner.m.objects && !this.world.lib) this.runner.select('bowl');   // app.js loads the object scene when needed
    this.setMode(this.mode, true);
    this.panel.showPitch(this.ctl.pitch);
    this.panel.showSound(this.sound.on);
    this.panel.showTeach(this.teach);
    this.panel.showView('orbit');
    if (!this.touch && !this.TEST && matchMedia('(min-width:861px)').matches && store.get('wrist', false)) this.setWrist(true);
    this.app.reset();          // applies the mission layout through onReset()
    if (this.runner.m.look) this.cameras.set('orbit', this.runner.m.look);
    this.teach.load();         // the demonstration from the last visit, if any
    this.teach.loadFromHash().then((n) => {   // a shared link (#ukazka=…) wins over the stored one
      if (!n) { if (this.teach.rejected) this.panel.toast('Odkaz s ukázkou je poškozený nebo příliš velký – nic jsme nenahráli', 'err'); return; }
      this.selectMission(this.teach.demo.mission.id);
      this.panel.openTeach(true, true);
      this.panel.toast('Máte sdílenou ukázku – spusťte ji tlačítkem Přehrát v nástroji Učit ukázkou');
    });
    if (this.touch && !this.TEST && !store.get('tip-orbit', false)) {
      store.set('tip-orbit', true);
      setTimeout(() => this.panel.toast('Jedním prstem otáčíte pohled, dvěma přibližujete'), 2500);
    }
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
    this.grab.apply(dt);       // pull spring + compliant servos while a link is held, stiffness blend after release
    // drawing mission: the marker follows the (magnet-assisted, speed-limited) pointer in the paper plane
    if (this.draw.active && this.drawMode() && !this.ctl.busy() && !this.teach.replaying) {
      const t = this.draw.step(dt);
      if (!this.ctl.active) this.ctl.begin();
      this.ctl.setTarget(t[0], t[1], t[2]);
    }
    if (!this.teach.replaying) this.ctl.update(dt);
    if (this.agent) this.agent.tick(dt);   // AI motion (src/agent/sim-api.js) writes d.ctrl after the controller
  }

  check(dt) {
    const w = this.world, r = this.runner, ctx = r.ctx, c = this.d.ctrl, act = this.app.act;
    const fell = w.rescue(r.m.layout);
    if (fell) this.panel.toast(`Spadlo to ze stolu – ${w.o[fell].acc} jsme vrátili zpět`);
    this.ctl.actualTip(ctx.tip);
    ctx.gripOpen = c[act[5]] > 0.5;
    ctx.smart = this.mode === 'smart'; ctx.touch = this.touch;
    this.extras.inkAt(ctx.tip);
    const res = r.tick(dt);
    // HUD (live region: write only on change)
    let text = res.text;
    if (this.teach.replaying) text = this.touch ? 'Přehrávám ukázku – zastavíte ji tlačítkem Stop' : 'Přehrávám ukázku – Esc ji zastaví';
    else if (this.mode === 'smart' && this.ctl.active && !this.ctl.reachable && !this.ctl.busy()) text = 'Mimo dosah – zkuste cíl blíž k ruce';
    if (this.app.won) text = 'Mise splněna';
    if (text !== this.app.hudText) { this.hudEl.textContent = text; this.app.hudText = text; this.announce(text); }
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
    this.links.tick();
    if (this.draw.active && this.drawMode()) this.gizmo.drawCursor(this.draw);
  }

  onReset() {
    this.ctl.cancel(); this.pending = null;
    this.aiSteps = 0;
    if (!this.replayResetting) this.teach.stopReplay();
    this.runner.setup();
    this.extras.onLayout(this.runner.m);
    if (this.objView) this.objView.onLayout(this.runner.m);
    // pick-and-place missions start with the gripper open: the first move is "go down and close" (P0-3)
    if (this.runner.m.openStart) {
      const a = this.app.act[5], m = this.m;
      this.d.ctrl[a] = GRIP_OPEN; this.d.qpos[m.jnt_qposadr[m.actuator_trnid[2 * a]]] = GRIP_OPEN;
      this.mj.mj_forward(m, this.d);
    }
    this.ctl.syncFromCtrl();
    this.confetti.clear();
    this.draw.active = false; this.draw.penDown = true;
    if (this.links.drag || this.links.pend) this.links.cancelPress();
    this.grab.reset();
    this.links.deselect();
    this.gizmo.clearPath();
    this.cameras.stopCinematic();
    this.panel.showMission(this.runner.m, this.progress[this.runner.m.id]);
    this.held = null;
    if (this.teach.recording && !this.recResetting) { this.teach.stopRec(); this.panel.toast('Nahrávání zastaveno (mise začala znovu)'); }
    this.panel.showTips(this.runner.m);
  }

  startDemo() {
    this.teach.stopReplay();
    const rec = this.teach.recording;
    this.recResetting = true; this.app.reset(); this.recResetting = false;
    if (rec) this.teach.startRec();     // recording the planner's solution is a valid demonstration
    this.runner.start();
    this.runner.assisted = true;        // the robot solved it: no stars / record for the visitor (P1-4)
    track('solution_shown', { mission: this.runner.m.id });
    const plan = this.runner.m.solve(this.ctl, this.world);
    this.preview(plan, true);
    this.panel.toast('Ruka plánuje řešení…');
    return true;
  }

  /** Screen-reader announcements: milestones only (no numbers that change every frame), at most 1 per second. */
  announce(text) {
    const now = performance.now();
    if (/\d/.test(text) && !this.app.won) return;
    if (text === this.srLast || now - (this.srT || 0) < 1000) return;
    this.srLast = text; this.srT = now;
    this.srEl.textContent = text;
  }

  // ================= actions =================
  setMode(mode, quiet) {
    if (!quiet && mode !== this.mode) track('mode_changed', { mode });
    this.mode = mode; store.set('mode', mode);
    // one switch for both: "Táhnout ruku" pulls the whole arm when a part is grabbed, "Klouby" turns one joint
    if (this.links) { this.links.setMode(mode === 'joints' ? 'joint' : 'pull'); this.panel.showGrabMode(this.links.mode); }
    this.panel.showMode(mode);
    if (mode !== 'smart') { this.ctl.cancel(); this.pending = null; if (this.penTool) this.togglePen(); }
    else this.ctl.syncFromCtrl();
    if (!quiet) this.app.refreshSliders();
  }

  selectMission(id) {
    const m = MISSIONS.find((x) => x.id === id);
    if (m && m.objects && !this.world.lib) {
      // the object missions run in a scene with the objects compiled in: reload into it (engine from cache)
      store.set('mission', id);
      const u = new URL(location.href); u.searchParams.set('mise', id); u.searchParams.delete('rekord');
      this.panel.toast('Načítám předměty mise…');
      document.getElementById('loader').hidden = false;
      setTimeout(() => location.assign(u.href), 50);
      return;
    }
    this.runner.select(id); store.set('mission', id);
    this.teach.stopReplay();
    this.app.reset();
    this.cameras.set('orbit', this.runner.m.look);
  }

  // ---------- drawing mission (paper-plane mode) ----------
  drawMode() { return !!this.runner.m.draw && this.mode === 'smart' && !this.penTool; }
  onPaper(p) { return p[0] > 0.125 && p[0] < 0.305 && Math.abs(p[1]) < 0.09; }
  drawPoint(x, y) {
    if (this.teach.replaying) return;
    const d = this.draw;
    if (!d.active) {
      // first touch: start from where the tip is now; the pen goes down on the paper
      const t = this.ctl.actualTip(this.tipBuf);
      d.reset(t[0], t[1]); d.tgt[2] = t[2];
      this.ctl.cancel(); this.pending = null;
      this.onboarding.notify('draw');
    }
    d.point(x, y);
    this.runner.start();
  }
  togglePenUp() {
    const d = this.draw; d.penDown = !d.penDown;
    if (d.active) d.point(d.goal[0], d.goal[1]);
    this.panel.showDraw(this);
    this.panel.toast(d.penDown ? 'Pero dolů – kreslí' : 'Pero nahoru – můžete se přesunout bez čáry');
  }
  setDrawHelp(h) { this.draw.help = h; store.set('draw-help', h); this.panel.showDraw(this); }
  srSay(t) { this.srEl.textContent = t; }

  /** Target from user input (drag / keys); the controller reports hitting the table ('floor' event). */
  userSetTarget(x, y, z) {
    if (z > 0.02) this.floorNoted = false;
    this.ctl.setTarget(x, y, z);
  }
  nextMission() {
    const k = MISSIONS.findIndex((m) => m.id === this.runner.m.id), guided = this.onboarding.atWin();
    this.selectMission(MISSIONS[(k + 1) % MISSIONS.length].id);
    if (guided) { this.onboarding.wonStep = -1; this.onboarding.next(); }   // the guide continues on the new mission
    document.getElementById('win-h').blur();
  }

  toggleGrip() {
    if (this.teach.replaying) return;
    const open = this.d.ctrl[this.app.act[5]] > 0.5;
    if (this.mode === 'joints') {
      // joint mode: drive only the gripper joint (the IK controller would re-pose the wrist)
      this.ctl.cancel(); this.pending = null;
      this.app.setCtrl(5, open ? GRIP_CLOSED : GRIP_OPEN);
      this.sound.grip(!open); this.onboarding.notify('grip');
      this.runner.start();
      return;
    }
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
  toggleExplode() {
    const on = this.explode.toggle(); this.panel.showExplode(on);
    // the parts are the scene now: mission objects, confetti and the HUD step aside (P1-6)
    this.extras.setObjectsVisible(!on);
    if (on) this.confetti.clear();
    return on;
  }

  toggleRec() {
    const t = this.teach;
    if (t.recording) { t.stopRec(); if (t.demo) { track('teach_recorded', { mission: this.runner.m.id }); this.panel.toast('Ukázka nahrána. Přehrajte si ji.'); } else this.panel.toast('Ukázka byla příliš krátká', 'err'); }
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
  onDragEnd(kind) {
    this.onboarding.notify('dragend-' + kind);
    if (!this.touch && !store.get('tip-keys', false) && !this.onboarding.active()) {
      store.set('tip-keys', true);
      this.panel.toast('Tip: šipky posouvají cíl, mezerník ovládá chapadlo, ? ukáže zkratky');
    }
  }

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
      if (e.lib) {
        const p = this.world.com(e.name, this.tipBuf);
        if (Math.hypot(p[0] - tip[0], p[1] - tip[1]) < 0.06 && p[2] > (e.restZ || 0) + 0.004 && Math.abs(p[2] - tip[2]) < 0.06) return e.name;
        continue;
      }
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
    const e = w.o[name];
    if (e && (e.lib || e.fixture) || (name === 'table' && held && w.o[held].lib)) {
      if (e && e.lib) {
        if (held === name) { this.panel.toast('Ten už držíte. Klikněte, kam ho položit.'); return; }
        if (held) { this.panel.toast('Nejdřív položte, co držíte – klikněte na cíl nebo na stůl.'); return; }
        plan = libPick(ctl, w, name);
        this.libHeld = { name, pick: plan };
      } else {
        if (!held) { this.panel.toast('Nejdřív klikněte na předmět, ruka ho vezme.'); return; }
        const pick = this.heldPick(held);
        if (name === 'table') plan = libPlace(ctl, w, pick, [point[0], point[1]], 0.002);
        else { const t = libTarget(w, this.runner.m, held, name); plan = libPlace(ctl, w, pick, t.xy, t.surface, t.closeYaw); }
        plan.kind = 'place';
      }
      if (plan && this.preview(plan)) this.onboarding.notify('plan-' + plan.kind);
      return;
    }
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
    if (plan && this.preview(plan)) this.onboarding.notify('plan-' + plan.kind);
  }

  /** Grasp info of the held library object (from the click that picked it, or measured now after a manual grab). */
  heldPick(held) {
    const w = this.world, start = this.ctl.startPoint();
    if (this.libHeld && this.libHeld.name === held) return { ...this.libHeld.pick, end: start, roll: this.ctl.roll };
    const tip = this.ctl.actualTip(new Float64Array(3)), c = w.com(held, [0, 0, 0]), g = libGrasp(w, held);
    const dzc = tip[2] - c[2];
    return { roll: this.ctl.roll, end: start, dz: tip[2] - g.bottom, ref: () => { const p = w.com(held, [0, 0, 0]); p[2] += dzc; return p; } };
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
    const own = !this.teach.replaying && !this.runner.assisted;
    const isNew = own && (!best || res.stars > best.stars || (res.stars === best.stars && res.time < best.time));
    if (own) { this.wins = (store.get('wins', 0) || 0) + 1; store.set('wins', this.wins); }
    if (isNew) { this.progress[m.id] = { stars: Math.max(res.stars, best ? best.stars : 0), time: Math.min(res.time, best ? best.time : Infinity) }; store.set('progress', this.progress); }
    const by = own ? null : (this.runner.assisted ? (this.aiSteps > 0 ? 'ai' : 'assisted') : 'replay');
    this.panel.showWin(m, res, best, isNew, by);
    this.onboarding.notify('won');
    const guided = this.onboarding.atWin();
    if (guided) {
      this.panel.winH.textContent = `Hotovo za ${fmtT(res.time)}! Kostka je v misce.`;
      this.panel.winText.textContent = 'Ruka si cestu naplánovala sama. Teď zkuste totéž rukou – za chvíli to budete umět i bez pomoci.';
    }
    this.lastRes = { id: m.id, time: res.time, stars: res.stars, own };
    this.panel.stageWin(m, { by, guided, wins: this.wins || 0, stars: own ? res.stars : 0 });
    // a friend's record (challenge link): how did it go?
    const ch = this.challenge;
    if (own && ch && ch.id === m.id) {
      const d = ch.time - res.time;
      if (Number.isFinite(d)) this.panel.winStats.textContent += ` · sdílený čas ${fmtT(ch.time)}`;   // descriptive, no beat / lost framing
    }
    this.panel.showMission(m, this.progress[m.id]);
    document.getElementById('win').hidden = false;
    document.getElementById('win-h').focus({ preventScroll: true });
    this.confetti.burst();
    this.sound.success();
    this.cameras.cinematic();
    if (this.teach.recording) this.panel.toast('Mise splněna. Nahrávání můžete zastavit.');
    try { window.dataLayer && window.dataLayer.push({ event: 'sim_success', robot: 'so101', mission: m.id, stars: res.stars }); } catch (e) { /* ignore */ }
    track('mission_win', { mission: m.id, stars: res.stars, seconds: Math.round(res.time), assisted: !own });
  }

  /** "Sdílet rekord": a link that opens the mission with this time as the target (?mise=&rekord=). */
  async shareRecord() {
    const r = this.lastRes; if (!r || !r.own) return;
    const m = MISSIONS.find((x) => x.id === r.id);
    const lang = new URLSearchParams(location.search).get('lang');
    const url = location.origin + location.pathname + `?mise=${r.id}&rekord=${r.time.toFixed(1)}` + (lang ? `&lang=${lang}` : '');
    // neutral and descriptive (players are often 10-16): what was done, an invitation, no dare
    const text = tr(`Mise „${m.title}“ v simulaci SO-101: hotovo za ${fmtT(r.time)}, ${r.stars} ★. Zkuste si ji taky.`);   // leaves the page: translate here
    try { if (navigator.share) { await navigator.share({ title: tr('SO-101 – mise'), text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text + ' ' + url); this.panel.toast('Odkaz na misi je ve schránce'); }
    catch (e) { window.prompt(tr('Zkopírujte odkaz na misi:'), url); }
  }

  /** start: a challenge link, or continue where the visitor left off */
  startRoute(q) {
    const want = q.get('mise'), rek = parseFloat(q.get('rekord'));
    if (want && MISSIONS.some((m) => m.id === want) && rek > 0.5 && rek < 3600) {
      this.challenge = { id: want, time: Math.round(rek * 10) / 10 };
      const m = MISSIONS.find((x) => x.id === want);
      this.panel.showChallenge(`Sdílený čas: ${fmtT(this.challenge.time)}`);
      setTimeout(() => this.panel.toast(`Sdílená mise: „${m.title}“, hotovo za ${fmtT(this.challenge.time)}. Zkuste ji po svém.`), 900);
      return want;
    }
    if (want) return want;
    const done = (id) => !!this.progress[id];
    const any = MISSIONS.some((m) => done(m.id));
    let id = store.get('mission', 'bowl');
    if (any && done(id)) { const nx = MISSIONS.find((m) => !done(m.id)); if (nx) id = nx.id; }
    if (any && !this.TEST) {
      const m = MISSIONS.find((x) => x.id === id) || MISSIONS[0];
      setTimeout(() => this.panel.toast(`Pokračujete misí ${m.n}. Rekordy máte uložené v tomto prohlížeči.`), 1200);
    }
    return id;
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
        if (this.panel.popOpen()) { this.panel.closeSet(true); return; }
        if (this.links.sel >= 0) { this.links.deselect(); return; }
        if (this.onboarding.active()) { this.onboarding.finish(); return; }
        this.ctl.cancel(); this.pending = null; this.gizmo.clearPath(); this.teach.stopReplay(); return;
      }
      if (this.panel.modalOpen()) return;
      if (k === ' ' && tag === 'BUTTON') return;   // let a focused button handle Space
      // WCAG 2.1.4: single-character shortcuts can be switched off; then they only work while the 3D view has focus
      if (k.length === 1 && !this.keysOn && tg !== this.app.renderer.domElement) return;
      // Tab on the focused canvas cycles the joints 1…6, then leaves the canvas (no focus trap)
      if (k === 'Tab' && tg === this.app.renderer.domElement) {
        const n = this.links.sel + (e.shiftKey ? -1 : 1);
        if (n >= 0 && n <= 5) { this.links.select(n); e.preventDefault(); } else this.links.deselect();
        return;
      }
      if (this.links.sel >= 0 && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) {
        this.links.nudge(k === 'ArrowRight' || k === 'ArrowUp' ? 1 : -1, e.shiftKey); e.preventDefault(); return;
      }
      const step = e.shiftKey ? 0.02 : 0.008;
      const move = (dx, dy, dz) => {
        if (this.mode !== 'smart') this.setMode('smart');
        if (!this.ctl.active) this.ctl.begin();
        // arrows are relative to the camera heading (projected on the table)
        const cam = this.app.camera, tg2 = this.app.controls.target;
        const fx = tg2.x - cam.position.x, fy = -(tg2.z - cam.position.z), L = Math.hypot(fx, fy) || 1;
        const ux = fx / L, uy = fy / L;           // forward in MuJoCo xy
        const t = this.ctl.target;
        this.userSetTarget(t[0] + ux * dy + uy * dx, t[1] + uy * dy - ux * dx, t[2] + dz);
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
        case ' ': case 'g': case 'G': this.toggleGrip(); break;
        case 'm': case 'M': this.setMode(this.mode === 'smart' ? 'joints' : 'smart'); break;
        case 'p': case 'P': if (this.runner.m.draw) this.togglePenUp(); else this.togglePen(); break;
        case 'k': case 'K': this.togglePen(); break;
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
          // 1–6 = joints (Shift+1–5 = missions; e.code keeps working on Czech layouts)
          const dg = /^Digit([1-6])$/.exec(e.code || '') ? +e.code.slice(5) : (k >= '1' && k <= '6' ? +k : 0);
          if (dg && e.shiftKey && dg <= MISSIONS.length) this.selectMission(MISSIONS[dg - 1].id);
          else if (dg && !e.shiftKey) this.links.select(dg - 1);
          else used = false;
      }
      if (used) e.preventDefault();
    });
  }

  // ================= test hooks (window.__sim with ?test=1) =================
  extendApi(api) {
    const app = this.app, ts = this.m.opt.timestep;
    api.advance = app.sim ? (sec) => { app.sim.advance(sec, 1 / 60); this.extras.sync(); } : (sec) => {
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
    api.objectMissions = MISSIONS.filter((m) => m.objects).map((m) => m.id);
    api.mission = (id) => this.selectMission(id);
    api.solve = () => this.startDemo();
    api.setMode = (m) => this.setMode(m);
    api.pick = (name, pt) => this.onPick(name, pt || this.world.pos(name, [0, 0, 0]));
    api.screen = (what) => {
      const p = what === 'target' ? (this.ctl.active ? this.ctl.target : this.ctl.actualTip(new Float64Array(3)))
        : what === 'up' ? (() => { const t = this.ctl.active ? this.ctl.target : this.ctl.actualTip(new Float64Array(3)); const s = this.gizmo.root.scale.x; return [t[0], t[1], t[2] + 0.038 * s]; })()
          : this.world.o[what] && this.world.o[what].lib ? this.world.com(what, [0, 0, 0]) : this.world.pos(what, [0, 0, 0]);
      return this.gizmo.project(p, {});
    };
    api.objectScene = () => !!this.world.lib;
    api.objectsReady = () => (this.objView ? this.objView.ready() : true);
    api.record = (on) => { if (on !== this.teach.recording) this.toggleRec(); };
    api.replay = (loop) => { this.teach.loop = !!loop; return this.teach.startReplay(); };
    api.exportDemo = () => this.teach.toJSON();
    api.camera = (v) => { this.cameras.set(v); this.panel.showView(v); };
    api.cameraNow = (v) => {   // tests: jump without the tween (slow software frames)
      const c = this.cameras; c.set(v); c.tw = null;
      this.app.camera.position.copy(c.to.p); this.app.controls.target.copy(c.to.t); this.app.controls.update();
      this.app.camera.updateMatrixWorld(); this.panel.showView(v);
    };
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
    api.grabMode = (m) => { this.links.setMode(m); this.panel.showGrabMode(this.links.mode); };
    api.grabState = () => ({ active: this.grab.active, force: this.grab.force, atLimit: this.grab.atLimit, blend: this.grab.blend, mode: this.links.mode });
    api.drawPoint = (x, y) => this.drawPoint(x, y);
    api.penUp = () => this.togglePenUp();
    api.drawHelp = (h) => this.setDrawHelp(h);
    api.drawState = () => ({ active: this.draw.active, penDown: this.draw.penDown, help: this.draw.help, goal: Array.from(this.draw.goal), dev: this.draw.dev });
    /** tests: one synchronous frame (bodies, gizmo, camera, render), so screen points and hit tests see the current pose */
    api.renderNow = () => {
      const a = this.app; a.sync(); a.controls.update(); this.render(0);
      a.world.updateMatrixWorld(); a.camera.updateMatrixWorld();
    };
    /** screen point on a link driven by joint j (verified by the link raycast), or null */
    api.linkPoint = (j) => {
      const L = this.links, g = this.gizmo; this.app.world.updateMatrixWorld();
      const parts = L.parts.filter((p) => p.j === j && p.mesh.visible);
      for (const p of parts.sort((a, b) => (b.mesh.geometry.boundingSphere ? b.mesh.geometry.boundingSphere.radius : 0) - (a.mesh.geometry.boundingSphere ? a.mesh.geometry.boundingSphere.radius : 0))) {
        if (!p.mesh.geometry.boundingSphere) p.mesh.geometry.computeBoundingSphere();
        const c = p.mesh.geometry.boundingSphere.center.clone().applyMatrix4(p.mesh.matrix);
        const s = g.project([c.x, c.y, c.z], {});
        for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [8, 8], [-8, -8], [8, -8], [-8, 8]]) {
          const e = { clientX: s.x + dx, clientY: s.y + dy }, h = L.hit(e);
          const pk = g.pickAt(e);
          const hd = g.hitHandle(e);
          if (h && h.part.j === j && !hd && !(pk && pk.name !== 'table' && g.pickDist < h.dist)) return { x: e.clientX, y: e.clientY, body: h.part.bname };
        }
      }
      return null;
    };
    api.explode = (on) => { if (on !== this.explode.on) this.toggleExplode(); };
    api.assemble = () => this.explode.startPlay();
    api.quality = (q) => this.hd.set(q);
    api._ux = this;
    return api;
  }
}

void GRIP_OPEN; void GRIP_CLOSED;

function fmtT(t) { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); }

