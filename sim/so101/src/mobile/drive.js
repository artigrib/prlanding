// Driving UI of the mobile scene on desktop (lab-transport campaign PR 2, design §3.1 and §3.3). DOM side of
// src/mobile/base.js (drive state), keys.js (keymap by mode) and camera.js (views).
// - Mode Jízda ⇄ Ruka: key J or the segmented control first in the action bar. Jízda puts the arm in the carry pose
//   (base.js CARRY_POSE); Ruka brakes the cart (design §4.4: the base is braked while the arm works). Moving a joint
//   slider switches to Ruka.
// - Jízda keys: W/S/A/D or the arrows, Q/E or Z/X, 1–3, Space (keys.js). The command runs once per physics step
//   (ArmSim.preStep): LeRobot clamp → 3 m/s² ramp → world frame (base.js).
// - The goal line starts with the mode ("Jízda ·" / "Ruka ·") and shows the measured speed of the cart.
// - Action bar: [Jízda | Ruka] · Rychlost 1–3 · Pohled · Znovu. No touch driving yet (campaign PR 3).

import { BaseDrive, SPEED_LEVELS, CARRY_POSE } from './base.js';
import { keyAction, keyRelease, MODE_LABEL } from './keys.js';
import { VIEW_LABEL } from './camera.js';

const t = (s, v) => (globalThis.PRI18N ? globalThis.PRI18N.t(s, v) : s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)));
const $ = (id) => document.getElementById(id);

/** Every Czech string of this module (tests/mobile-drive.test.mjs checks the English entries). */
export const STRINGS = [
  'Jízda', 'Ruka', 'Jízda, nebo ruka', 'Rychlost {n}', 'Pohled: {v}', 'Za vozíkem', 'Shora', 'Kamera vozíku',
  'rychlost {n} ze 3', 'jede {v} m/s', 'stojí', 'W A S D jízda, Q E otáčení, mezerník zastaví',
  'jízda zatím jen z klávesnice', 'vozík stojí, ruku ovládáte posuvníky kloubů v Nástrojích (J = zpět k jízdě)',
  'Režim Jízda: ruka je složená v přepravní poloze', 'Režim Ruka: vozík stojí',
  'Kamera vozíku · obraz 4:3 jako 640 × 480 u LeKiwi · zorné pole 61° převzaté z kamery na zápěstí',
  'Vozík ve stylu XLeRobot s rukou SO-101 ve dvou laboratořích. Klávesy: W A S D jízda, Q E otáčení, 1 až 3 rychlost, mezerník zastaví, J přepíná jízdu a ruku, C mění pohled.',
  'Vozík ve stylu XLeRobot (zjednodušený model: podvozek LeKiwi + vozík + ruka SO-101) · náhled scény, zatím bez misí'
];

export class MobileDrive {
  /** page: MissionPage (sliders, setCtrl, hud, reset); view: MobileView. */
  constructor(page, view, { touch = false } = {}) {
    this.page = page; this.sim = page.sim; this.view = view; this.touch = touch;
    this.drive = new BaseDrive();
    this.override = null;     // test hook baseCtrl(): world-frame targets that bypass the drive
    const sim = this.sim, mj = sim.mj, m = sim.m;
    this.act = ['base_vx', 'base_vy', 'base_wz'].map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
    sim.preStep = (dt) => this.preStep(dt);
    this.en = document.documentElement.lang === 'en';
    this.ui();
    this.keys();
    this.setMode('drive', true);
  }

  // ---------------------------------------------------------------- per physics step
  preStep(dt) {
    const c = this.sim.d.ctrl, a = this.act;
    const w = this.override || this.drive.step(dt, this.view.base().yaw);
    c[a[0]] = w[0]; c[a[1]] = w[1]; c[a[2]] = w[2];
  }

  // ---------------------------------------------------------------- mode
  setMode(mode, quiet) {
    if (mode !== 'drive' && mode !== 'arm') return;
    this.mode = mode;
    if (mode === 'drive') {
      // carry pose first (design §4.4): the arm folds inside the cart footprint before the cart moves
      CARRY_POSE.forEach((q, i) => this.page.setCtrl(i, q));
    } else this.drive.brake();
    for (const b of this.segBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    this.speedBtn.disabled = mode !== 'drive';
    if (!quiet) this.say(mode === 'drive' ? 'Režim Jízda: ruka je složená v přepravní poloze' : 'Režim Ruka: vozík stojí');
    this.hud();
  }
  /** Write the goal line now (also between frames, e.g. right after a key). */
  hud() { if (this.page.hud && this.labelsReady) this.page.hud({ text: this.hudText(), ok: false }); }

  // ---------------------------------------------------------------- action bar, HUD, canvas
  ui() {
    document.body.classList.add('mb-scene');   // desktop: the Nástroje panel beside the scene, not over it (ux.css)
    const bar = $('ux-abar'), first = bar.firstElementChild;
    bar.classList.add('ux-ab5', 'mb-abar');
    const seg = this.seg = document.createElement('div');
    seg.className = 'mb-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', t('Jízda, nebo ruka'));
    this.segBtns = ['drive', 'arm'].map((mode) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ux-ab mb-segb'; b.dataset.mode = mode; b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `<span>${t(MODE_LABEL[mode])}</span>` + (mode === 'drive' ? ' <span class="kbd" aria-hidden="true">J</span>' : '');
      b.addEventListener('click', () => this.setMode(mode));
      seg.appendChild(b);
      return b;
    });
    bar.insertBefore(seg, first);
    const mk = (id, kbd, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ux-ab'; b.id = id;
      b.innerHTML = `<span class="mb-l"></span> <span class="kbd" aria-hidden="true">${kbd}</span>`;
      b.addEventListener('click', fn);
      bar.insertBefore(b, first);
      return b;
    };
    this.speedBtn = mk('mb-speed', '1–3', () => this.setLevel((this.drive.level + 1) % SPEED_LEVELS.length));
    this.viewBtn = mk('mb-view', 'C', () => this.cycleView());
    this.labels(); this.labelsReady = true;
    // the joint sliders move the arm: that is Ruka mode
    $('joints').addEventListener('input', () => { if (this.mode !== 'arm') this.setMode('arm'); });
    $('home').addEventListener('click', () => { if (this.mode !== 'arm') this.setMode('arm'); });
    // the goal line changes every frame (measured speed): out of the live region, announcements go through #sr
    const hud = $('hud-text'); hud.removeAttribute('role'); hud.removeAttribute('aria-live');
    const cv = this.sim.renderer.domElement;
    cv.tabIndex = 0;
    cv.setAttribute('aria-label', t('Vozík ve stylu XLeRobot s rukou SO-101 ve dvou laboratořích. Klávesy: W A S D jízda, Q E otáčení, 1 až 3 rychlost, mezerník zastaví, J přepíná jízdu a ruku, C mění pohled.'));
    $('ux-pick-mission').title = t('Vozík ve stylu XLeRobot (zjednodušený model: podvozek LeKiwi + vozík + ruka SO-101) · náhled scény, zatím bez misí');
    // caption of the front camera's picture (what the picture is and which numbers are assumed)
    const cap = this.cap = document.createElement('p');
    cap.className = 'mb-cap'; cap.hidden = true;
    cap.textContent = t('Kamera vozíku · obraz 4:3 jako 640 × 480 u LeKiwi · zorné pole 61° převzaté z kamery na zápěstí');
    cv.parentNode.appendChild(cap);
  }

  labels() {
    this.speedBtn.querySelector('.mb-l').textContent = t('Rychlost {n}', { n: this.drive.level + 1 });
    this.viewBtn.querySelector('.mb-l').textContent = t('Pohled: {v}', { v: t(VIEW_LABEL[this.view.rig.view]) });
  }

  setLevel(i) { this.drive.setLevel(i); this.labels(); this.hud(); }
  cycleView() { this.setView(this.view.rig.cycle()); }
  setView(v) {
    this.view.rig.set(v);
    this.labels();
    this.cap.hidden = v !== 'front';
    this.say(t('Pohled: {v}', { v: t(VIEW_LABEL[v]) }));
  }

  say(s) { const sr = $('sr'); if (sr) sr.textContent = t(s); }

  /** Goal line: mode prefix, speed level, measured speed, the keys (once per frame, written only on change). */
  hudText() {
    const b = this.view.base(), sp = Math.hypot(b.u, b.v);
    const n = (v) => (this.en ? v.toFixed(2) : v.toFixed(2).replace('.', ','));
    if (this.mode === 'arm') return t('Ruka') + ' · ' + t('vozík stojí, ruku ovládáte posuvníky kloubů v Nástrojích (J = zpět k jízdě)');
    return [t('Jízda'), t('rychlost {n} ze 3', { n: this.drive.level + 1 }),
      sp < 0.005 && Math.abs(b.w) < 0.01 ? t('stojí') : t('jede {v} m/s', { v: n(sp) }),
      this.touch ? t('jízda zatím jen z klávesnice') : t('W A S D jízda, Q E otáčení, mezerník zastaví')].join(' · ');
  }

  // ---------------------------------------------------------------- keyboard
  keys() {
    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target, tag = tg && tg.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable)) return;
      const a = keyAction(e.key, e.code, this.mode);
      if (!a) return;
      e.preventDefault();
      if (e.key === ' ') this.spaceEaten = true;   // a focused button must not also get Space's click
      if (e.repeat && a.type !== 'drive') return;
      switch (a.type) {
        case 'mode': this.setMode(this.mode === 'drive' ? 'arm' : 'drive'); break;
        case 'view': this.cycleView(); break;
        case 'reset': this.page.reset(); break;
        case 'drive': this.override = null; this.drive.press(a.action); break;
        case 'level': this.setLevel(a.level); break;
        case 'brake': this.drive.brake(); break;
      }
    });
    addEventListener('keyup', (e) => {
      if (e.key === ' ' && this.spaceEaten) { this.spaceEaten = false; e.preventDefault(); }
      const r = keyRelease(e.key); if (r) this.drive.release(r);
    });
    // a key released outside the page would keep the cart going: stop when the page loses focus
    addEventListener('blur', () => this.drive.brake());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.drive.brake(); });
  }

  /** [ux-hook:reset] from MissionPage.reset(): the keyframe put the arm at home and the cart at the start. */
  onReset() {
    this.override = null;
    this.drive.reset();
    this.setMode(this.mode, true);
    this.view.rig.snap();
    if (this.view.rig.view === 'chase') this.view.rig.set('chase');
  }

  /** Test hook (?test=1). */
  api() {
    const d = this.drive;
    return {
      mode: () => this.mode,
      setMode: (m) => this.setMode(m),
      drive: () => ({ level: d.level, held: [...d.held], braked: d.braked, cmd: { ...d.cmd }, target: { ...d.target }, scale: d.scale }),
      setView: (v) => this.setView(v),
      override: (w) => { this.override = w; }
    };
  }
}
