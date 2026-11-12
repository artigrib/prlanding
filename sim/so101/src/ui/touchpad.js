// "Trackpad + rails" touch scheme (touch audit, option A; beta behind ?touch=pad or Nástroje › Ovládání dotykem).
// Each finger contact means one thing, chosen by where it lands on the screen, never by the 3D object under it:
//   one finger anywhere in the scene  → the gripper moves on the table, relative to the camera, ballistic gain
//                                        (0.25 mm/px slow → 1.2 mm/px fast), horizontal plane only (src/touch.js)
//   tap on an object                   → it becomes the target (outline, side view, objective); never the autopilot
//   tap on the jaws                    → open / close; double tap on the empty table → frame gripper + target
//   right-edge rail                    → height, relative 0.4 mm/px, detents at the target's grasp height and top
//                                        face, the readout follows the thumb; ▲ / ▼ = ±1 cm
//   strip above the bar                → wrist roll 0.5°/px, a detent every 15°, a magnet + "Lícuje ✓" within 3° of
//                                        the target's faces
//   two fingers                        → camera: drag = orbit, pinch = zoom (OrbitControls, no pan)
// Mission 05 (drawing) keeps its absolute finger trace on the paper. Haptics (Chromium only) always have a visual twin.

import { PAD, padGain, Speed, tableDelta, classify, railSnap, scrubSnap, isDoubleTap } from '../touch.js';
import { libGrasp } from '../missions.js';
import { BELT_FLOOR } from '../objects/beltpick.js';
import { t as tr, isEn } from '../i18n/index.js';
import { store } from './store.js';

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const DEG = Math.PI / 180;
const cmText = (z) => { const s = (Math.round(z * 1000) / 10).toFixed(1); return (isEn ? s : s.replace('.', ',')) + ' cm'; };

export class Touchpad {
  constructor(ux) {
    this.ux = ux; this.T = ux.T; this.app = ux.app;
    const q = new URLSearchParams(location.search).get('touch');
    // ?touch=pad / ?touch=classic for this visit; otherwise the Nástroje setting (default: the current scheme)
    this.url = q === 'pad' ? true : q === 'classic' ? false : null;
    this.want = this.url != null ? this.url : store.get('touch-scheme', 'classic') === 'pad';
    this.fingers = new Map();            // pointerId → { x, y } of every touch on the canvas while the pad is on
    this.one = null;                     // the single finger driving the gripper
    this.camera = false;                 // two-finger camera gesture in progress (until all fingers are up)
    this.speed = new Speed();
    this.sel = null;                     // selected target object name
    this.alignT = 0; this.align = null;  // cached jaw alignment with the target
    this.build();
    this.bind();
    this.apply();
  }

  /** the scheme is chosen (touch device + URL or setting) */
  chosen() { return this.ux.touch && this.want; }
  /** the scheme handles touches right now */
  on() {
    const ux = this.ux;
    return this.chosen() && ux.mode === 'smart' && !ux.drawMode() && !ux.penTool && !(ux.explode && ux.explode.on) && !ux.teach.replaying;
  }
  set(on) {
    this.want = !!on; store.set('touch-scheme', on ? 'pad' : 'classic'); this.url = null;
    this.apply();
    if (on) this.firstHint(true);
  }
  /** body class (layout), OrbitControls' two-finger gesture, rail / strip visibility */
  apply() {
    const pad = this.chosen(), c = this.app.controls;
    if (this.two0 == null) this.two0 = c.touches.TWO;
    c.touches.TWO = pad ? this.T.TOUCH.DOLLY_ROTATE : this.two0;
    document.body.classList.toggle('ux-pad', pad);
    this.show();
    if (this.ux.panel && this.ux.panel.showPad) this.ux.panel.showPad(pad);
  }
  show() {
    const vis = this.on();
    this.rail.hidden = !vis; this.strip.hidden = !vis;
    if (!vis && this.box) this.box.visible = false;
  }

  // ---------- DOM ----------
  build() {
    const st = this.ux.panel.stage;
    this.rail = h(`<div class="ux-rail" role="group" aria-label="Výška chapadla" hidden>
      <button type="button" class="ux-rail-b ux-rail-up" aria-label="O 1 cm výš">▲</button>
      <div class="ux-rail-t" role="slider" tabindex="-1" aria-label="Výška chapadla" aria-valuemin="0" aria-valuemax="30" aria-valuenow="0">
        <i class="ux-rail-th"></i>
      </div>
      <button type="button" class="ux-rail-b ux-rail-dn" aria-label="O 1 cm níž">▼</button>
      <span class="ux-rail-r mono" aria-hidden="true"></span>
    </div>`);
    this.strip = h(`<div class="ux-wstrip" role="slider" aria-label="Rotace zápěstí" aria-valuemin="-180" aria-valuemax="180" aria-valuenow="0" hidden>
      <span class="ux-wstrip-k mono-s">Zápěstí</span><span class="ux-wstrip-v mono"></span><span class="ux-wstrip-ok mono" hidden>Lícuje ✓</span>
    </div>`);
    this.hint = h(`<div class="ux-padhint" hidden aria-hidden="true"><i class="ux-padhint-f"></i><p class="mono-s">Táhněte prstem kdekoli – chapadlo jede po stole. Dvěma prsty otáčíte pohledem.</p></div>`);
    st.append(this.rail, this.strip, this.hint);
    this.track = this.rail.querySelector('.ux-rail-t'); this.thumb = this.rail.querySelector('.ux-rail-th');
    this.readout = this.rail.querySelector('.ux-rail-r');
    this.sVal = this.strip.querySelector('.ux-wstrip-v'); this.sOk = this.strip.querySelector('.ux-wstrip-ok');
    this.ticks = [];
    // selection outline (a box around the selected object)
    this.box = null;
  }

  bind() {
    const opt = { capture: true, passive: false };
    // window capture: before the gizmo's stage listeners and OrbitControls
    addEventListener('pointerdown', (e) => this.down(e), opt);
    addEventListener('pointermove', (e) => this.move(e), opt);
    addEventListener('pointerup', (e) => this.up(e, false), opt);
    addEventListener('pointercancel', (e) => this.up(e, true), opt);
    // rail and strip: their own relative drags (any pointer)
    this.railBind(); this.stripBind();
    this.rail.querySelector('.ux-rail-up').addEventListener('click', () => this.stepZ(PAD.railStep));
    this.rail.querySelector('.ux-rail-dn').addEventListener('click', () => this.stepZ(-PAD.railStep));
  }

  // ---------- scene: one finger = gripper on the table, two = camera ----------
  mine(e) { return e.pointerType === 'touch' && e.target === this.app.renderer.domElement && this.on(); }
  down(e) {
    if (!this.mine(e) || this.forwarding) return;
    this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.camera) return;   // a third finger: OrbitControls has it
    if (this.fingers.size >= 2 && this.one) {
      // second finger: camera. Undo a gripper motion of the first finger that only just started (it was meant as
      // the start of the camera gesture), then hand the first finger to OrbitControls too.
      const o = this.one; this.one = null; this.camera = true;
      if (o.dragging && e.timeStamp - o.t0 < 250) { this.ux.userSetTarget(o.t[0], o.t[1], o.t[2]); }
      const f = this.fingers.get(o.id);
      this.forwarding = true;
      try {
        this.app.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { pointerId: o.id, pointerType: 'touch', isPrimary: true,
          clientX: f.x, clientY: f.y, button: 0, buttons: 1, bubbles: true, cancelable: true }));
      } finally { this.forwarding = false; }
      this.ux.onboarding.notify('orbit');
      return;   // this pointerdown continues to OrbitControls
    }
    e.stopPropagation(); e.preventDefault();
    const c = this.ux.ctl;
    this.one = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, dragging: false, t: Array.from(c.active ? c.target : c.actualTip(new Float64Array(3))) };
    this.speed.reset(e.timeStamp);
  }
  move(e) {
    if (e.pointerType !== 'touch' || !this.fingers.has(e.pointerId)) return;
    this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const o = this.one;
    if (this.camera || !o || e.pointerId !== o.id) return;
    e.stopPropagation(); e.preventDefault();
    const dist = Math.hypot(e.clientX - o.x0, e.clientY - o.y0);
    if (!o.dragging) {
      if (classify(dist, e.timeStamp - o.t0, false) !== 'drag') return;
      o.dragging = true;
      const ux = this.ux, c = ux.ctl;
      if (!c.active) c.begin();
      ux.onUserMove('pad');
      o.f = this.forward(); o.reach = c.reachable;
    }
    // the samples since the last event; finger speed from the event times (input time, not handling time)
    const dx = e.clientX - o.x, dy = e.clientY - o.y; o.x = e.clientX; o.y = e.clientY;
    const v = this.speed.update(Math.hypot(dx, dy), e.timeStamp);
    const [mx, my] = tableDelta(dx, dy, padGain(v), o.f);
    const c = this.ux.ctl, t = c.target;
    this.ux.userSetTarget(t[0] + mx, t[1] + my, t[2]);
    this.lastGain = padGain(v);
  }
  up(e, cancelled) {
    if (e.pointerType !== 'touch' || !this.fingers.has(e.pointerId)) return;
    this.fingers.delete(e.pointerId);
    if (this.camera) { if (!this.fingers.size) this.camera = false; return; }
    const o = this.one;
    if (!o || e.pointerId !== o.id) return;
    e.stopPropagation(); e.preventDefault();
    this.one = null;
    if (cancelled) return;
    if (o.dragging) { this.ux.onDragEnd('pad'); return; }
    if (classify(Math.hypot(e.clientX - o.x0, e.clientY - o.y0), e.timeStamp - o.t0, true) === 'tap') this.tap(e);
  }
  /** camera heading on the table (MuJoCo x, y) */
  forward() {
    const cam = this.app.camera, tg = this.app.controls.target;
    return [tg.x - cam.position.x, -(tg.z - cam.position.z)];
  }

  /** tap: an object → target; the jaws → open / close; the empty table twice → frame the work */
  tap(e) {
    const ux = this.ux, g = ux.gizmo, pk = g.pickAt(e), pd = pk ? g.pickDist : Infinity;
    const lh = ux.links.enabled() ? ux.links.hit(e) : null;
    if (lh && ux.links.isJaw(lh.part) && lh.dist < pd) { ux.toggleGrip(); this.pulse(10); return; }
    if (pk && pk.name !== 'table') { this.select(pk.name); return; }
    const cur = { t: e.timeStamp || performance.now(), x: e.clientX, y: e.clientY };
    if (isDoubleTap(this.lastTap, cur)) { this.lastTap = null; ux.frameWork(); return; }
    this.lastTap = cur;
  }

  // ---------- target selection ----------
  select(name) {
    const ux = this.ux, e = ux.world.o[name];
    if (!e || !e.active) return;
    this.sel = name; this.alignT = 0;
    this.outline();
    ux.panel.toast(tr('Cíl: {name}', { name: tr(e.label) }));
    ux.onboarding.notify('select');
    this.pulse(8);
  }
  /** the selected target if still valid (active, not the held object), else null */
  selected() {
    const ux = this.ux, n = this.sel;
    if (!n || !this.on()) return null;
    const e = ux.world.o[n];
    if (!e || !e.active || ux.held === n) return null;
    return n;
  }
  /** the object the rail and the strip work with: the selection, else the side view's target */
  focus() {
    const n = this.selected(); if (n) return n;
    const st = this.ux.side && this.ux.side.state && this.ux.side.state();
    return st && st.t && this.ux.world.o[st.t.name] ? st.t.name : null;
  }
  mesh(name) { const ux = this.ux; return name === 'cube' ? ux.cubeMesh : ux.extras.meshes[name]; }
  outline() {
    const T = this.T, m = this.mesh(this.sel);
    if (!this.box) { this.box = new T.BoxHelper(undefined, 0xe8461e); this.box.material.depthTest = false; this.box.renderOrder = 7; this.app.scene.add(this.box); }
    if (m) { this.box.setFromObject(m); this.box.visible = true; } else this.box.visible = false;
  }

  /** grasp height and top face (m) of an object: the detents of the rail */
  heights(name) {
    const w = this.ux.world, e = w.o[name];
    if (!e) return [];
    if (e.lib) {
      // on the moving belt the grasp detent keeps the closing jaw above the slats (src/objects/beltpick.js BELT_FLOOR)
      const g = libGrasp(w, name), belt = w.belt && w.belt.zone(w.com(name, [0, 0, 0]));
      return [belt === 'belt' || belt === 'entry' ? Math.max(g.z, BELT_FLOOR) : g.z, g.top];
    }
    if (e.kind !== 'free') return [];
    const p = w.pos(name, [0, 0, 0]);
    return [Math.max(0.009, p[2] - 0.002), p[2] + e.half];   // the planner's grasp height (controller.planPick), the top
  }
  /** roll (deg) at which the jaws are square to the object, its symmetry period (deg); cached for 0.5 s */
  alignment(name) {
    const now = performance.now();
    if (this.align && this.align.name === name && now - this.alignT < 500) return this.align;
    const ux = this.ux, w = ux.world, e = w.o[name], c = ux.ctl;
    if (!e || e.kind !== 'free' || name === 'ball') return (this.align = null);
    let p, yaw, period;
    if (e.lib) { const g = libGrasp(w, name); p = [g.g[0], g.g[1], g.z]; yaw = g.yaw; period = Math.PI; }
    else { p = w.pos(name, [0, 0, 0]); yaw = w.yaw(name); period = Math.PI / 2; }
    const r = c.graspRoll(p, yaw, c.qGoal, period, 0);
    this.alignT = now;
    return (this.align = { name, roll: r.roll / DEG, period: period / DEG });
  }

  // ---------- height rail ----------
  railBind() {
    const tr0 = this.track;
    tr0.addEventListener('pointerdown', (e) => {
      if (!this.on()) return;
      e.preventDefault(); e.stopPropagation();
      try { tr0.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const c = this.ux.ctl; if (!c.active) c.begin();
      this.ux.onUserMove('rail');
      const n = this.focus();
      this.rd = { id: e.pointerId, y0: e.clientY, z0: c.target[2], det: n ? this.heights(n) : [], at: -1 };
      this.railShow(e.clientY);
    });
    tr0.addEventListener('pointermove', (e) => {
      const D = this.rd; if (!D || e.pointerId !== D.id) return;
      e.preventDefault();
      const raw = D.z0 + (D.y0 - e.clientY) * PAD.rail / 1000, s = railSnap(raw, D.det);
      if (s.at >= 0 && s.at !== D.at) { this.pulse(8); this.flash(this.rail); }
      D.at = s.at;
      const t = this.ux.ctl.target; this.ux.userSetTarget(t[0], t[1], s.z);
      this.railShow(e.clientY, s.at);
    });
    const end = (e) => { const D = this.rd; if (!D || e.pointerId !== D.id) return; this.rd = null; this.readout.classList.remove('on'); this.ux.onDragEnd('rail'); };
    tr0.addEventListener('pointerup', end); tr0.addEventListener('pointercancel', end);
  }
  stepZ(dz) {
    const c = this.ux.ctl; if (!c.active) c.begin();
    this.ux.onUserMove('rail');
    const t = c.target; this.ux.userSetTarget(t[0], t[1], t[2] + dz);
    this.pulse(8);
  }
  /** readout next to the thumb: height above the table (+ the detent's name) */
  railShow(y, at) {
    const r = this.readout, z = this.ux.ctl.target[2], st = this.rail.getBoundingClientRect();
    r.textContent = cmText(z) + (at === 0 ? ' · ' + tr('úchop') : at === 1 ? ' · ' + tr('horní hrana') : '');
    r.style.transform = `translateY(${Math.round(Math.max(0, Math.min(st.height - 24, y - st.top - 12)))}px)`;
    r.classList.add('on');
  }

  // ---------- wrist strip ----------
  stripBind() {
    const s = this.strip;
    s.addEventListener('pointerdown', (e) => {
      if (!this.on()) return;
      e.preventDefault(); e.stopPropagation();
      try { s.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const c = this.ux.ctl; if (!c.active) c.begin();
      this.ux.onUserMove('roll');
      this.sd = { id: e.pointerId, x0: e.clientX, r0: c.roll / DEG, det: null, al: false };
    });
    s.addEventListener('pointermove', (e) => {
      const D = this.sd; if (!D || e.pointerId !== D.id) return;
      e.preventDefault();
      const raw = D.r0 + (e.clientX - D.x0) * PAD.scrub, n = this.focus(), a = n ? this.alignment(n) : null;
      const res = scrubSnap(raw, a ? raw - a.roll : null, a ? a.period : 90);
      if (res.aligned && !D.al) { this.pulse(12); this.flash(this.strip); }
      else if (res.detent != null && res.detent !== D.det) { this.pulse(6); this.flash(this.strip); }
      D.al = res.aligned; D.det = res.detent;
      this.ux.setRoll(res.r * DEG);
    });
    const end = (e) => { const D = this.sd; if (!D || e.pointerId !== D.id) return; this.sd = null; this.ux.onDragEnd('roll'); };
    s.addEventListener('pointerup', end); s.addEventListener('pointercancel', end);
  }

  // ---------- feedback ----------
  /** haptic tick (Chromium on Android only; iOS has no Vibration API) – every caller also shows a visual tick */
  pulse(ms) { this.ux.sound.vibrate(ms); }
  flash(el) { el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); }

  /** per frame: thumb, detent marks, strip value, "Lícuje ✓", outline, reach warning */
  tick() {
    this.show();
    if (!this.on()) return;
    const ux = this.ux, c = ux.ctl, z = c.active ? c.target[2] : c.actualTip(this.tipB || (this.tipB = new Float64Array(3)))[2];
    // rail: 0 at the bottom of the track, PAD.rail mm per px upwards (the thumb moves with the finger)
    const th = this.track.clientHeight, zmax = th * PAD.rail / 1000;
    const y = th - Math.max(0, Math.min(1, z / zmax)) * th;
    if (y !== this.thY) { this.thumb.style.transform = `translateY(${Math.round(y)}px)`; this.thY = y; }
    const zc = Math.round(z * 1000) / 10; if (zc !== this.zAria) { this.track.setAttribute('aria-valuenow', String(zc)); this.zAria = zc; }
    const n = this.focus(), det = n ? this.heights(n) : [];
    const sig = det.map((d) => Math.round(d * 1000)).join(',') + '|' + th;
    if (sig !== this.detSig) {
      this.detSig = sig;
      for (const t of this.ticks) t.remove();
      this.ticks = det.map((d, i) => { const el = h(`<b class="ux-rail-d${i ? ' top' : ''}" aria-hidden="true"></b>`); el.style.top = Math.round(th - Math.min(1, d / zmax) * th) + 'px'; this.track.appendChild(el); return el; });
    }
    // strip: the tick pattern scrolls with the roll (0.5° per px → a tick every 30 px), value and alignment
    const rd = (c.active ? c.roll : ux.app.d.ctrl[ux.app.act[4]]) / DEG;
    const px = Math.round(-rd / PAD.scrub);
    if (px !== this.sPx) { this.strip.style.backgroundPositionX = `calc(50% + ${px}px)`; this.sPx = px; }
    const a = n ? this.alignment(n) : null, mis = a ? Math.abs(((rd - a.roll) % a.period + a.period * 1.5) % a.period - a.period / 2) : null;
    const al = mis != null && mis <= PAD.align;
    const val = Math.round(rd) + '°' + (mis != null && !al ? ' · ' + tr('{n}° od hrany', { n: Math.round(mis) }) : '');
    if (val !== this.sTxt) { this.sVal.textContent = val; this.sTxt = val; this.strip.setAttribute('aria-valuenow', String(Math.round(rd))); this.strip.setAttribute('aria-valuetext', al ? tr('{n}°, lícuje', { n: Math.round(rd) }) : Math.round(rd) + '°'); }
    if (al !== this.alOn) { this.alOn = al; this.sOk.hidden = !al; this.strip.classList.toggle('ok', al); }
    // outline follows the selected object
    const sel = this.selected();
    if (this.box) { if (sel) { const m = this.mesh(sel); if (m) { this.box.setFromObject(m); this.box.visible = true; } } else this.box.visible = false; }
    // out of reach while dragging: double pulse once (the ball turns red and the HUD says "Mimo dosah")
    if (this.one && this.one.dragging) {
      if (this.one.reach && c.active && !c.reachable) this.pulse([10, 40, 10]);
      this.one.reach = c.reachable;
    }
  }

  /** first play: a 2 s ghost hand shows "drag anywhere" (once; again when the scheme is switched on) */
  firstHint(force) {
    if (!this.chosen() || (!force && store.get('pad-hint', false))) return;
    store.set('pad-hint', true); this.hintShown = true;
    const el = this.hint; el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(this.hintT); this.hintT = setTimeout(() => { el.hidden = true; el.classList.remove('go'); }, this.ux.reduced ? 3000 : 2200);
  }
}
