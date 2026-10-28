// First visit: a guided first task – success first, skill second ("60 seconds to the first win").
//   1. click the cube → the robot plans and picks it      2. click the bowl → mission won
//   3. now by hand: drag the blue ball                      4. height, wrist, gripper
// Each step finishes when the visitor actually does it (or presses "Další"). Shown once; restart from help.
// Layout: on phones (< 861 px) the bubble is a strip under the stage, never over the scene; on desktops it is
// placed next to the anchor on the side that does not cover any object of interest.

import { store } from './store.js';

const STEPS = [
  {
    anchor: 'object', title: (u) => (u.touch ? 'Klepněte na kostku' : 'Klikněte na kostku'),
    text: () => 'Ruka si sama naplánuje cestu (modrá čára) a kostku vezme.',
    done: (k) => k === 'plan-pick'
  },
  {
    anchor: 'bowl', title: (u) => (u.touch ? 'Teď klepněte na misku' : 'Teď klikněte na misku'),
    text: () => 'Ruka kostku přenese a položí. Hotovo – to je celá mise.',
    done: (k) => k === 'won'
  },
  {
    anchor: 'target', title: (u) => `Hotovo za ${fmt(u.firstWin)}! Teď ručně`,
    text: () => 'Chyťte <b>modrou kouli</b> a táhněte ji. Ruka ji sleduje – úhly kloubů si dopočítá sama.',
    done: (k) => k === 'dragend-move'
  },
  {
    anchor: 'target', title: () => 'Výška, zápěstí, chapadlo',
    text: (u) => (u.touch
      ? 'Šipkou nad koulí ruku zvednete, druhým prstem otočíte zápěstí. Chapadlo ovládá tlačítko <b>Otevřít / Zavřít chapadlo</b> pod scénou.'
      : 'Šipkou nad koulí ruku zvednete, kroužkem nebo kolečkem myši otočíte zápěstí. <span class="kbd">Mezerník</span> otevře a zavře chapadlo.'),
    done: (k) => k === 'dragend-height' || k === 'dragend-roll' || k === 'wheel' || k === 'grip'
  }
];

export class Onboarding {
  constructor(ux) {
    this.ux = ux; this.i = -1;
    const el = this.el = document.createElement('div');
    el.className = 'ux-coach'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-labelledby', 'ux-coach-h');
    el.innerHTML = `<div class="ux-coach-dots" aria-hidden="true">${STEPS.map(() => '<i></i>').join('')}</div>
      <p class="mono" id="ux-coach-k">Průvodce</p><h3 id="ux-coach-h">Průvodce prvním úkolem</h3><p class="ux-coach-t"></p>
      <div class="ux-coach-b"><button type="button" class="ux-link" data-a="skip">Přeskočit průvodce</button>
      <button type="button" class="btn btn-act" data-a="next">Další <span aria-hidden="true">→</span></button></div>`;
    this.ring = document.createElement('div'); this.ring.className = 'ux-coach-ring'; this.ring.hidden = true;
    this.ring.setAttribute('aria-hidden', 'true');
    ux.panel.stage.appendChild(this.ring);
    this.mq = matchMedia('(max-width:860px)');
    this.place();
    (this.mq.addEventListener ? this.mq.addEventListener('change', () => this.place()) : this.mq.addListener(() => this.place()));
    el.querySelector('[data-a=skip]').addEventListener('click', () => this.finish());
    el.querySelector('[data-a=next]').addEventListener('click', () => this.next());
    this.pt = { x: 0, y: 0, visible: false };
    this.pts = [{}, {}, {}, {}];
  }

  /** phones: strip under the stage (inside the sticky .ux-under); desktops: floating inside the stage */
  place() {
    const narrow = this.mq.matches, el = this.el;
    if (narrow) { const u = this.ux.panel.under; u.insertBefore(el, u.querySelector('.ux-qrow')); el.style.transform = ''; el.classList.add('strip'); }
    else { this.ux.panel.stage.appendChild(el); el.classList.remove('strip'); }
  }

  maybeStart() { if (!store.get('onboarded', false)) this.start(); }

  start(force) {
    if (this.ux.mode !== 'smart') this.ux.setMode('smart');
    if (this.ux.runner.m.id !== 'bowl') this.ux.selectMission('bowl');
    else if (force) this.ux.app.reset();
    this.t0 = this.ux.runner.time;
    this.i = -1; this.next();
  }
  next() {
    this.i++;
    if (this.i >= STEPS.length) { this.finish(); return; }
    const s = STEPS[this.i], el = this.el, ux = this.ux;
    el.querySelector('#ux-coach-k').textContent = `Průvodce ${this.i + 1} / ${STEPS.length}`;
    el.querySelector('#ux-coach-h').textContent = s.title(ux);
    el.querySelector('.ux-coach-t').innerHTML = s.text(ux);
    el.querySelector('[data-a=next] ').firstChild.textContent = this.i === STEPS.length - 1 ? 'Rozumím ' : 'Další ';
    [...el.querySelectorAll('.ux-coach-dots i')].forEach((d, k) => d.classList.toggle('on', k <= this.i));
    el.hidden = false; this.ring.hidden = false;
    ux.panel.stage.classList.add('ux-coaching');
    ux.panel.under.classList.add('ux-coaching');
  }
  finish() {
    this.i = -1; this.el.hidden = true; this.ring.hidden = true;
    this.ux.panel.stage.classList.remove('ux-coaching');
    this.ux.panel.under.classList.remove('ux-coaching');
    store.set('onboarded', true);
  }
  active() { return this.i >= 0; }

  notify(kind) {
    if (this.i < 0 || !STEPS[this.i].done(kind)) return;
    if (kind === 'won') {
      // the first success: let it sink in, then put the cube back for the "by hand" part
      this.ux.firstWin = this.ux.runner.time;
      const k = this.i;
      setTimeout(() => { if (this.i === k) { this.ux.app.reset(); this.next(); } }, this.ux.reduced ? 600 : 2600);
      return;
    }
    setTimeout(() => this.next(), 350);
  }

  anchorPoint(a) {
    const ux = this.ux;
    if (a === 'target') return ux.ctl.active ? ux.ctl.target : ux.gizmo.tip;
    if (a === 'bowl' && ux.world.o.bowl.active) return ux.world.pos('bowl');
    const o = ux.world.active().find((e) => e.kind === 'free');
    return o ? ux.world.pos(o.name) : ux.gizmo.tip;
  }

  tick() {
    if (this.i < 0) return;
    const ux = this.ux, s = STEPS[this.i];
    const pt = ux.gizmo.project(this.anchorPoint(s.anchor), this.pt);
    const st = ux.panel.stage.getBoundingClientRect();
    const x = pt.x - st.left, y = pt.y - st.top;
    this.ring.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    if (this.el.classList.contains('strip')) return;
    // desktop: candidate spots around the anchor; keep 60 px away from every object of interest
    const el = this.el, w = el.offsetWidth, hh = el.offsetHeight, pad = 60, P = this.pts;
    const names = ['target', 'object', 'bowl'];
    for (let k = 0; k < 3; k++) { const q = ux.gizmo.project(this.anchorPoint(names[k]), P[k]); q.x -= st.left; q.y -= st.top; }
    const cands = [[x + 70, y + 40], [x - w - 70, y + 40], [x + 70, y - hh - 40], [x - w - 70, y - hh - 40], [x - w / 2, y + 80], [x - w / 2, y - hh - 80]];
    let best = null, bestBad = Infinity;
    for (const [cx0, cy0] of cands) {
      const cx = Math.min(Math.max(12, cx0), st.width - w - 72), cy = Math.min(Math.max(12, cy0), st.height - hh - 12);
      let bad = 0;
      for (let k = 0; k < 3; k++) {
        const q = P[k];
        if (q.x > cx - pad && q.x < cx + w + pad && q.y > cy - pad && q.y < cy + hh + pad) bad++;
      }
      if (bad < bestBad) { bestBad = bad; best = [cx, cy]; if (!bad) break; }
    }
    el.style.transform = `translate(${best[0].toFixed(0)}px, ${best[1].toFixed(0)}px)`;
  }
}

function fmt(t) { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); }
