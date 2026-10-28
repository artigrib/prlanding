// First-visit tutorial: three interactive steps anchored to the 3D scene. Each step finishes when the
// visitor actually does the thing (or presses "Další"). Shown once; can be restarted from the help dialog.

import { store } from './store.js';

const STEPS = [
  {
    anchor: 'target', title: 'Chytrý pohyb',
    text: 'Chyťte <b>modrou kouli</b> a táhněte ji. Ruka ji sleduje – úhly kloubů si dopočítá sama.',
    done: (k) => k === 'dragend-move'
  },
  {
    anchor: 'target', title: 'Výška a zápěstí',
    text: 'Šipkou nad koulí ruku zvednete. Kroužek, kolečko myši nebo druhý prst otáčí zápěstím. <span class="kbd">Mezerník</span> otevře a zavře chapadlo.',
    done: (k) => k === 'dragend-height' || k === 'dragend-roll' || k === 'wheel' || k === 'grip'
  },
  {
    anchor: 'object', title: 'Klikněte a hotovo',
    text: 'Klikněte na <b>kostku</b>. Ruka naplánuje cestu, ukáže ji a kostku vezme. Potom klikněte na misku.',
    done: (k) => k === 'plan'
  }
];

export class Onboarding {
  constructor(ux) {
    this.ux = ux; this.i = -1;
    const el = this.el = document.createElement('div');
    el.className = 'ux-coach'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-labelledby', 'ux-coach-h');
    el.innerHTML = `<div class="ux-coach-dots" aria-hidden="true"><i></i><i></i><i></i></div>
      <p class="mono" id="ux-coach-k"></p><h3 id="ux-coach-h"></h3><p class="ux-coach-t"></p>
      <div class="ux-coach-b"><button type="button" class="ux-link" data-a="skip">Přeskočit průvodce</button>
      <button type="button" class="btn btn-act" data-a="next">Další <span aria-hidden="true">→</span></button></div>`;
    ux.panel.stage.appendChild(el);
    this.ring = document.createElement('div'); this.ring.className = 'ux-coach-ring'; this.ring.hidden = true;
    this.ring.setAttribute('aria-hidden', 'true');
    ux.panel.stage.appendChild(this.ring);
    el.querySelector('[data-a=skip]').addEventListener('click', () => this.finish());
    el.querySelector('[data-a=next]').addEventListener('click', () => this.next());
    this.pt = { x: 0, y: 0, visible: false };
  }

  maybeStart() { if (!store.get('onboarded', false)) this.start(); }

  start(force) {
    if (this.ux.mode !== 'smart') this.ux.setMode('smart');
    if (force && this.ux.runner.m.id !== 'bowl') this.ux.selectMission('bowl');
    this.i = -1; this.next();
  }
  next() {
    this.i++;
    if (this.i >= STEPS.length) { this.finish(); return; }
    const s = STEPS[this.i], el = this.el;
    el.querySelector('#ux-coach-k').textContent = `Průvodce ${this.i + 1} / ${STEPS.length}`;
    el.querySelector('#ux-coach-h').textContent = s.title;
    el.querySelector('.ux-coach-t').innerHTML = s.text;
    el.querySelector('[data-a=next] ').firstChild.textContent = this.i === STEPS.length - 1 ? 'Rozumím ' : 'Další ';
    [...el.querySelectorAll('.ux-coach-dots i')].forEach((d, k) => d.classList.toggle('on', k <= this.i));
    el.hidden = false; this.ring.hidden = false;
    this.ux.panel.stage.classList.add('ux-coaching');
  }
  finish() {
    this.i = -1; this.el.hidden = true; this.ring.hidden = true;
    this.ux.panel.stage.classList.remove('ux-coaching');
    store.set('onboarded', true);
  }
  active() { return this.i >= 0; }

  notify(kind) {
    if (this.i < 0) return;
    if (STEPS[this.i].done(kind)) setTimeout(() => this.next(), 350);
  }

  tick() {
    if (this.i < 0) return;
    const ux = this.ux, s = STEPS[this.i];
    let p;
    if (s.anchor === 'target') p = ux.ctl.active ? ux.ctl.target : ux.gizmo.tip;
    else { const o = ux.world.active().find((e) => e.kind === 'free'); p = o ? ux.world.pos(o.name) : ux.gizmo.tip; }
    const pt = ux.gizmo.project(p, this.pt);
    const st = ux.panel.stage.getBoundingClientRect();
    const x = pt.x - st.left, y = pt.y - st.top;
    this.ring.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    const el = this.el, w = el.offsetWidth, hh = el.offsetHeight;
    // bubble: below the anchor if there is room, otherwise above; clamped inside the stage
    let bx = Math.min(Math.max(12, x - w / 2), st.width - w - 12);
    let by = y + 46;
    if (by + hh > st.height - 12) by = y - hh - 46;
    by = Math.max(12, Math.min(by, st.height - hh - 12));
    el.style.transform = `translate(${bx.toFixed(0)}px, ${by.toFixed(0)}px)`;
  }
}
