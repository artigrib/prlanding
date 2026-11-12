// DOM for the UX layer: HUD (top row, action bar, camera, Nástroje drawer, ☰ menu), mission picker, teach & replay,
// wrist-cam frame, toasts, win dialog extras, keyboard shortcuts dialog. Formal Czech ("vy").

import { MISSIONS, nextStar, FRACTION_CS } from '../missions.js';
import { FRACTION_BIN } from '../objects/scene.js';
import { VIEW_LABELS } from './cameras.js';
import { store } from './store.js';

const $ = (id) => document.getElementById(id);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const I = {
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.4-6.4M21 12a9 9 0 0 1-15.4 6.4"/><path d="M18.5 2.5v3.6h-3.6M5.5 21.5v-3.6h3.6"/><circle cx="12" cy="12" r="2.6"/></svg>',
  wrist: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6.5" width="13" height="11" rx="1.5"/><path d="M15.5 10.5l6-3.2v9.4l-6-3.2z"/></svg>',
  snd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9h4l5-4v14l-5-4h-4z"/><path class="on" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/><path class="off" d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>',
  side: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15"/><path d="M7 16.5h10"/><path d="M14 7.5v6.5M12.2 9.3L14 7.5l1.8 1.8M12.2 12.2L14 14l1.8-1.8"/></svg>',
  menu: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14"/></svg>'
};

// Hint ladder (4 rungs). The hint box shows the current rung's text and offers the next rung as its only action:
//   1 strategy (the mission's manual strategy + the HUD's next step) → 2 ghost path of the next subgoal →
//   3 partial demo (the arm reaches and grasps, the player finishes; counts as autopilot) →
//   4 full solution (#demo, marks the run assisted). "Poradit" only ever opens / refreshes rung 1+.
const HINT_STEPS = [
  { id: 'strategy' },
  { id: 'ghost', text: 'Modrá čára ukazuje cestu k dalšímu cíli. Projeďte ji sami.', next: 'Ukázat cestu k dalšímu cíli' },
  { id: 'partial', text: 'Ruka předmět uchopí a zvedne – dokončete to vy. Mise se pak počítá jako splněná, bez hvězdiček.', next: 'Ruka začne, vy dokončíte' },
  { id: 'solution', next: 'Ukázat řešení' }
];

// HUD (sim-hud stage 1): the 3D scene takes the whole area under the site header; controls sit on its edges.
//   top row: mission chip "01 / 10 · title ▾" (picker + brief) · objective pill (the one instruction line) · stars,
//            timer, ☰ (missions, parts, setup wizard, shortcuts, intro, settings, about)
//   bottom:  action bar Chapadlo · Znovu · Poradit (hint popover, incl. "Zeptej se AI"); camera Volný | Zápěstí
//   right:   tab "Nástroje" → drawer (Táhnout ruku | Klouby + sliders, wrist, Domů, Učit ukázkou, export, Připojit AI)
// Phones (≤ 860 px, portrait): top row + objective under it, scene, thumb bar Chapadlo · Znovu · Poradit · Nástroje;
// Nástroje and ☰ open as bottom / full-height sheets.
export class Panel {
  constructor(ux) {
    this.ux = ux;
    this.stage = document.querySelector('.stage');
    this.panelEl = document.querySelector('.panel');   // the "Nástroje" drawer
    this.under = $('ux-under');                         // action bar (+ hint popover, + the guide strip on phones)
    // phones in portrait: thumb bar and sheets; compact (phones, landscape phones): no site header
    this.mq = matchMedia('(max-width:860px) and (min-height:501px)');
    this.mqCompact = matchMedia('(max-width:860px), (max-height:500px)');
    this.hintLevel = 0; this.hintOpen = false;
    document.body.classList.add('ux-hud');
    this.topUI();
    this.missionUI();
    this.actionUI();
    this.modeUI();
    this.teachUI();
    this.stageUI();
    this.drawerUI();
    this.menuUI();
    this.winUI();
    this.helpUI();
  }

  // ---------- top row: stars, timer, ☰ ----------
  topUI() {
    const r = $('ux-topr');
    this.mStars = h(`<span class="ux-stars ux-tstars" id="ux-mstars" role="img" aria-label="Zatím nesplněno"></span>`);
    this.timer = h(`<span class="ux-timer mono" id="ux-timer" aria-hidden="true">0:00</span>`);
    this.menuBtn = h(`<button type="button" class="ux-menub" id="ux-menu-b" aria-expanded="false" aria-controls="ux-menu" aria-label="Menu">${I.menu}</button>`);
    r.append(this.mStars, this.timer, this.menuBtn);
  }

  // ---------- action bar: gripper / pen, Znovu, Poradit (+ Nástroje on phones); hint popover ----------
  actionUI() {
    const ux = this.ux, bar = $('ux-abar');
    // the one prominent action: the gripper (in the drawing mission the gripper holds the marker: pen up / down)
    this.gripBtn = h(`<button type="button" class="ux-ab ux-ab-main" id="ux-grip" aria-pressed="false">Zavřít chapadlo <span class="kbd" aria-hidden="true">␣</span></button>`);
    this.penUpBtn = h(`<button type="button" class="ux-ab ux-ab-main" id="ux-penup" aria-pressed="false" hidden>Pero nahoru <span class="kbd" aria-hidden="true">P</span></button>`);
    // conveyor missions: Pás ⏸/▶ stops and starts the belt (key B)
    this.beltBtn = h(`<button type="button" class="ux-ab" id="ux-belt" aria-pressed="false" hidden>Pás ⏸ <span class="kbd" aria-hidden="true">B</span></button>`);
    bar.prepend(this.gripBtn, this.penUpBtn, this.beltBtn);
    this.beltBtn.addEventListener('click', () => ux.toggleBelt());
    this.hintB = h(`<button type="button" class="ux-ab" id="ux-mhint" aria-controls="ux-hintbox" aria-expanded="false">Poradit</button>`);
    this.toolsQ = h(`<button type="button" class="ux-ab ux-ab-tools" id="ux-qtools" aria-controls="panel" aria-expanded="false">Nástroje</button>`);
    bar.append(this.hintB, this.toolsQ);
    this.gripBtn.addEventListener('click', () => ux.toggleGrip());
    this.penUpBtn.addEventListener('click', () => ux.togglePenUp());
    this.hintB.addEventListener('click', () => (this.hintOpen && !this.hintBox.hidden ? this.closeHint(false) : this.hint()));
    // hint ladder popover above the bar: the tip first, "Ukázat řešení" only after it (never the primary action)
    const hb = this.hintBox = h(`<div class="ux-hintbox" id="ux-hintbox" role="dialog" aria-modal="false" aria-labelledby="ux-hintstep" hidden>
      <div class="ux-hinttop"><p class="mono" id="ux-hintstep"></p><button type="button" class="ux-x" aria-label="Zavřít nápovědu">×</button></div>
      <p class="ux-hinttext" aria-live="polite"></p><div class="ux-hintnext"></div></div>`);
    this.under.appendChild(hb);
    this.hintText = hb.querySelector('.ux-hinttext');
    this.hintStepEl = hb.querySelector('#ux-hintstep');
    hb.querySelector('.ux-x').addEventListener('click', () => this.closeHint(true));
    // the last rung: "Ukázat řešení" (#demo keeps its id and its app.js click handler)
    const demo = $('demo');
    demo.title = 'Ruka úlohu vyřeší sama – bez hvězdiček';
    this.hintNextBtn = h(`<button type="button" class="ux-link ux-solve" id="ux-hintnext">Další krok <span aria-hidden="true">→</span></button>`);
    this.hintNextBtn.addEventListener('click', () => this.hintNext());
    hb.querySelector('.ux-hintnext').append(this.hintNextBtn, demo);
  }

  /** paused: true / false in a conveyor mission, null = no belt control */
  showBelt(paused) {
    const b = this.beltBtn, on = paused != null;
    b.hidden = !on;
    $('ux-abar').classList.toggle('ux-ab5', on);
    if (!on) return;
    b.firstChild.textContent = paused ? 'Pás ▶ ' : 'Pás ⏸ ';
    b.setAttribute('aria-pressed', String(!!paused));
    b.setAttribute('aria-label', paused ? 'Rozjet pás (B)' : 'Zastavit pás (B)');
  }

  goHome() { const ux = this.ux; ux.ctl.cancel(); ux.pending = null; ux.app.goHome(); ux.ctl.syncFromCtrl(); }

  /**
   * Hint ladder. "Poradit" only ever opens the ladder (popover above the action bar); it never runs the solution,
   * so a double tap cannot jump to the answer. The next step is offered inside the hint box only.
   */
  hint() {
    if (this.ux.app.won) return;
    this.offered = false;
    if (this.hintLevel < 1) this.hintLevel = 1;
    this.hintOpen = true;
    this.showHint(true);
  }
  closeHint(refocus) {
    if (!this.hintOpen) return;
    this.hintOpen = false; this.showHint();
    if (refocus) this.hintB.focus({ preventScroll: true });
  }
  /** the next rung, from the button inside the hint box (rung 4 is #demo with its own handler) */
  hintNext() {
    const n = this.hintLevel + 1, st = HINT_STEPS[n - 1];
    if (!st || st.id === 'solution') return;
    this.hintLevel = n;
    const ok = st.id === 'ghost' ? this.ux.hintGhost() : this.ux.hintPartial();
    if (!ok) this.toast('Teď to nejde ukázat – zkuste Znovu (R).', 'err');
    this.showHint(true);
  }
  /** Stuck (no progress / failed grasps): mark "Poradit", never open the ladder by itself. */
  offerHint(reason) {
    if (this.ux.app.won || this.offered) return;
    this.offered = true;
    this.toast(reason === 'grasp' ? 'Chapadlo se zavřelo naprázdno. Poradit vám ukáže postup.' : 'Nevíte, jak dál? Poradit vám dá tip.', null, 4000);
  }
  showHint(fresh) {
    const ux = this.ux, m = ux.runner.m, lv = this.hintLevel, won = !!ux.app.won, cur = HINT_STEPS[lv - 1];
    if (lv && cur && fresh) {
      let html;
      if (cur.id === 'strategy') {
        let now = ux.handNow();   // the strategy is manual, so is its "Teď:" step (never "click the cube")
        if (ux.touch) now = now.replace(/Klikněte/g, 'Klepněte');
        html = `<span>${m.strategy || ''}</span>` + (now ? `<br><span class="ux-hintnow"><b>Teď:</b> <span>${now}</span></span>` : '');
      } else {
        const grasp = Object.values(m.targets || {}).includes('pick'), own = m.hints && m.hints[cur.id];
        html = `<span>${own ? own.text : cur.id === 'partial' && !grasp ? 'Ruka se postaví na začátek – dokončete to vy. Mise se pak počítá jako splněná, bez hvězdiček.' : cur.text}</span>`;
      }
      if (this.hintText.innerHTML !== html) this.hintText.innerHTML = html;
    }
    this.hintBox.hidden = !lv || won || !this.hintOpen;
    this.hintB.setAttribute('aria-expanded', String(!this.hintBox.hidden));
    this.hintStepEl.textContent = `Nápověda ${lv} / ${HINT_STEPS.length}`;
    const nx = HINT_STEPS[lv];
    const nb = this.hintNextBtn, demo = $('demo');
    nb.hidden = !nx || nx.id === 'solution';
    if (nx && nx.id !== 'solution') nb.firstChild.textContent = ((m.hints && m.hints[nx.id] && m.hints[nx.id].next) || nx.next) + ' ';
    demo.hidden = !nx || nx.id !== 'solution';
    this.hintB.hidden = won;
  }

  // ---------- mission chip + picker (with the current mission's brief) ----------
  missionUI() {
    $('ux-pick-mission').addEventListener('click', () => this.openPicker());
    this.chipN = $('ux-chip-n'); this.chipT = $('mission-h');
    const dlg = this.picker = h(`<div class="ux-modal" id="ux-picker" hidden role="dialog" aria-modal="true" aria-labelledby="ux-picker-h">
      <div class="ux-modal-in">
        <div class="ux-modal-top"><p class="mono">Mise</p><button type="button" class="ux-x" aria-label="Zavřít">×</button></div>
        <section class="mission ux-brief" aria-labelledby="ux-brief-h">
          <div class="ux-mtop"><p class="mono"></p><span class="ux-stars ux-bstars" role="img"></span></div>
          <h3 id="ux-brief-h"></h3>
          <p class="ink2"></p>
        </section>
        <h2 id="ux-picker-h">Vyberte si úkol</h2>
        <div class="ux-cards"></div>
        <p class="mono ux-progline" id="ux-cards-line"></p>
        <p class="mono-s muted">Hvězdičky a nejlepší časy se ukládají jen ve vašem prohlížeči.</p>
      </div></div>`);
    document.body.appendChild(dlg);
    trapFocus(dlg);
    const box = this.mBox = dlg.querySelector('.mission');
    this.mNum = box.querySelector('p.mono'); this.mTitle = box.querySelector('h3'); this.mDesc = box.querySelector('p.ink2');
    this.bStars = box.querySelector('.ux-bstars');
    // after a win: the next mission is offered in the brief too (the win card has its own button)
    this.mNext = h(`<button type="button" class="btn btn-act ux-mnext" id="ux-mnext" hidden>Další mise <span aria-hidden="true">→</span></button>`);
    box.appendChild(this.mNext);
    this.mNext.addEventListener('click', () => { this.closePicker(); this.ux.nextMission(); });
    dlg.querySelector('.ux-x').addEventListener('click', () => this.closePicker());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) this.closePicker(); });
    this.cards = dlg.querySelector('.ux-cards');
    this.cardsLine = dlg.querySelector('#ux-cards-line');
  }
  renderCards() {
    const prog = this.ux.progress;
    this.cards.textContent = '';
    for (const m of MISSIONS) {
      const p = prog[m.id];
      // chapter header before the waste-sorting missions (11–)
      if (m.id === 'waste_hand') this.cards.appendChild(h(`<p class="mono ux-cardh">Třídění odpadu</p>`));
      const b = h(`<button type="button" class="ux-card${m.id === this.ux.runner.m.id ? ' cur' : ''}">
        <span class="mono">Mise ${m.n}</span>
        <b>${m.title}</b>
        <span class="ux-stars">${starStr(p ? p.stars : 0)}${badgeStr(p)}</span>
        <span class="mono-s muted">${!p ? m.starsHint : p.stars && p.time != null ? 'nejlepší čas ' + fmt(p.time) : 'Splněno · hvězdičky za ruční přenesení'}</span>
      </button>`);
      b.addEventListener('click', () => { this.closePicker(); this.ux.selectMission(m.id); });
      this.cards.appendChild(b);
    }
    // after the missions: the real arm (servo setup wizard) – visible from the start, never locked (teachers link it directly)
    const pr = progressOf(prog);
    const ch = h(`<a class="ux-card ux-chapter" href="nastaveni/">
        <span class="mono">Skutečná ruka</span>
        <b>Ke skutečné ruce</b>
        <span class="ink2">Nastavení serv nanečisto: ID, kalibrace, test</span>
        <span class="mono-s muted">${pr.done >= 3 ? 'Odemčeno: zvládli jste 3 mise' : 'Doporučujeme po 3 misích – otevřít můžete hned'}</span>
      </a>`);
    this.cards.appendChild(ch);
    this.cardsLine.textContent = progressText(pr);
  }
  openPicker() {
    this.renderCards(); this.picker.hidden = false; this.lastFocus = document.activeElement;
    const cur = this.cards.querySelector('.cur') || this.cards.firstElementChild; cur && cur.focus();
  }
  closePicker() { this.picker.hidden = true; if (this.lastFocus) this.lastFocus.focus({ preventScroll: true }); }

  showMission(m, prog) {
    const nn = `${m.n} / ${String(MISSIONS.length).padStart(2, '0')}`;
    this.chipN.textContent = nn;
    this.chipT.textContent = m.short || m.title;
    this.mNum.textContent = `Mise ${nn}`;
    this.mTitle.textContent = m.title;
    this.mDesc.textContent = m.desc;
    // credits for the scanned / authored objects (CC BY 4.0 needs attribution where they are shown): on the stage
    const lib = m.objects || m.scene === 'conveyor';
    this.credit.hidden = !lib;
    if (lib) this.credit.firstChild.textContent = m.credit || 'Objekty: NVIDIA SimReady (CC BY 4.0)';
    const s = prog ? prog.stars : 0;
    this.mStars.innerHTML = this.bStars.innerHTML = starStr(s) + badgeStr(prog, true);
    const lab = s ? `Nejlepší hodnocení ${s} ze 3 hvězdiček` : prog ? 'Splněno, zatím bez hvězdiček' : 'Zatím nesplněno';
    this.mStars.setAttribute('aria-label', lab); this.bStars.setAttribute('aria-label', lab);
    document.title = `${m.title} – SO-101 v simulaci | printedrobotics.cz`;
    // hint ladder starts again with every mission; a win hides "Poradit" (the win card offers "Další mise →")
    if (m.id !== this.hintFor) { this.hintFor = m.id; this.hintLevel = 0; this.hintOpen = false; }
    this.offered = false;
    const won = !!this.ux.app.won, last = MISSIONS[MISSIONS.length - 1].id === m.id;
    this.mNext.hidden = !won || last;
    this.showHint();
  }

  // ---------- drawer "Nástroje" → Ovládání: mode switch, drawing tools, wrist sliders ----------
  modeUI() {
    const mount = $('ux-mode');
    // ONE mode switch. "Táhnout ruku" = IK target ball + physics pull of any part (links 'pull');
    // "Klouby" = joint sliders + grabbing a part turns only that joint (links 'joint'). See ux.setMode().
    mount.appendChild(h(`<div class="ux-seg ux-modeseg" role="radiogroup" aria-label="Způsob ovládání">
      <button type="button" role="radio" data-mode="smart" data-tip="Ruka sleduje modrou kouli (M)">Táhnout ruku</button>
      <button type="button" role="radio" data-mode="joints" data-tip="Každý kloub zvlášť (M)">Klouby</button>
    </div>`));
    // touch only: the physics pull of the arm by a finger (off by default: a one-finger "turn the view" on the arm pulled it)
    const tp = this.tpullBox = h(`<div class="ux-tpull" hidden>
      <button type="button" class="btn btn-o ux-tpullb" id="ux-tpull" aria-pressed="false" aria-describedby="ux-tpull-s">Tahat ruku prstem za díl</button>
      <p class="mono-s muted" id="ux-tpull-s"></p>
    </div>`);
    // touch only: which touch scheme (beta "Trackpad + rails", src/ui/touchpad.js; also ?touch=pad)
    const ts = this.tschemeBox = h(`<div class="ux-tscheme" hidden>
      <p class="mono" id="ux-tscheme-l">Ovládání dotykem</p>
      <div class="ux-seg ux-seg-s" role="radiogroup" aria-labelledby="ux-tscheme-l">
        <button type="button" role="radio" data-ts="classic">Klasické</button>
        <button type="button" role="radio" data-ts="pad">Trackpad (beta)</button>
      </div>
      <p class="mono-s muted" id="ux-tscheme-s"></p>
    </div>`);
    mount.appendChild(ts);
    ts.hidden = !this.ux.touch;
    for (const b of ts.querySelectorAll('[data-ts]')) b.addEventListener('click', () => this.ux.pad.set(b.dataset.ts === 'pad'));
    mount.appendChild(tp);
    tp.hidden = !this.ux.touch;
    $('ux-tpull').addEventListener('click', () => this.ux.setTouchPull(!this.ux.touchPull));
    this.showTouchPull(this.ux.touchPull);
    const smart = this.smart = h(`<div class="ux-smart" id="ux-smart">
      <div class="ux-draw" id="ux-draw" hidden>
        <div class="ux-row2">
          <button type="button" class="btn btn-o" id="ux-pen" aria-pressed="false" data-tip="Nakreslete na stůl čáru, ruka ji projede (K)">Nakreslit prstem <span aria-hidden="true">✎</span></button>
          <button type="button" class="btn btn-o" id="ux-drawview">3D pohled</button>
        </div>
        <p class="mono" id="ux-help-l">Pomoc při kreslení</p>
        <div class="ux-seg ux-seg-s ux-seg3" role="radiogroup" aria-labelledby="ux-help-l">
          <button type="button" role="radio" data-h="0">Žádná</button>
          <button type="button" role="radio" data-h="1">Mírná</button>
          <button type="button" role="radio" data-h="2">Silná</button>
        </div>
        <p class="mono-s muted">Magnet přitahuje fix k předloze. Zelený kroužek = na čáře, oranžový = kousek vedle.</p>
      </div>
      <div class="ux-fine" id="ux-fine" role="group" aria-labelledby="ux-fine-h">
        <p class="mono" id="ux-fine-h">Zápěstí a náklon chapadla</p>
        <div class="jn"><label for="ux-roll">Rotace zápěstí</label><output for="ux-roll" id="ux-roll-o"></output>
          <input type="range" id="ux-roll" step="any"></div>
        <div class="jn"><label for="ux-pitch">Náklon chapadla</label><output for="ux-pitch" id="ux-pitch-o"></output>
          <input type="range" id="ux-pitch" min="0" max="90" step="1"></div>
        <p class="mono-s muted ux-ik">Úhly kloubů dopočítává inverzní kinematika (metoda tlumených nejmenších čtverců), stejně jako u skutečných robotů.</p>
      </div>
    </div>`);
    mount.appendChild(smart);
    this.seg = [...mount.querySelectorAll('[data-mode]')];
    for (const b of this.seg) b.addEventListener('click', () => this.ux.setMode(b.dataset.mode));
    this.penBtn = $('ux-pen'); this.drawBox = $('ux-draw');
    $('ux-drawview').addEventListener('click', () => {
      const ux = this.ux, top = ux.cameras.view === 'look';
      if (top) ux.cameras.set('orbit'); else ux.cameras.set('orbit', ux.runner.m.look);
      $('ux-drawview').textContent = top ? 'Pohled shora' : '3D pohled';
    });
    for (const b of this.drawBox.querySelectorAll('[data-h]')) b.addEventListener('click', () => this.ux.setDrawHelp(+b.dataset.h));
    this.penBtn.addEventListener('click', () => this.ux.togglePen());
    $('home').addEventListener('click', () => this.goHome());
    const roll = this.roll = $('ux-roll'), pitch = this.pitch = $('ux-pitch');
    const [lo, hi] = this.ux.ctl.kin.c.range[4];
    roll.min = lo; roll.max = hi;
    roll.addEventListener('input', () => this.ux.setRoll(+roll.value));
    pitch.addEventListener('input', () => this.ux.setPitch(+pitch.value * Math.PI / 180));
  }

  /** drawing tools only in the drawing mission (pen up / down takes the gripper's place in the action bar) */
  showTips(m) {
    this.drawBox.hidden = !m.draw;
    this.gripBtn.hidden = !!m.draw;
    this.penUpBtn.hidden = !m.draw;
    if (!m.draw) this.gripOpen = undefined;   // let tick() rewrite the button label
    if (m.draw) { this.showDraw(this.ux); $('ux-drawview').textContent = '3D pohled'; }
  }

  /** the touch scheme switch; the physics-pull switch only matters for the classic scheme */
  showPad(on) {
    for (const b of this.tschemeBox.querySelectorAll('[data-ts]')) b.setAttribute('aria-checked', String((b.dataset.ts === 'pad') === on));
    $('ux-tscheme-s').textContent = on ? 'Jeden prst kdekoli posouvá chapadlo po stole, lišta vpravo mění výšku, pruh dole otáčí zápěstím, dva prsty otáčí pohledem. Klepnutí na předmět ho vybere za cíl.'
      : 'Modrou kouli táhnete přímo, šipky na ní mění výšku. Jeden prst mimo kouli otáčí pohledem.';
    this.padOn = on;
    this.tpullBox.hidden = !this.ux.touch || on || this.ux.mode !== 'smart';
  }
  showTouchPull(on) {
    $('ux-tpull').setAttribute('aria-pressed', String(on));
    $('ux-tpull-s').textContent = on ? 'Zapnuto: prst na ruce ji fyzikálně táhne.' : 'Vypnuto: prst na ruce otáčí pohledem, klepnutí na čelisti otevře nebo zavře chapadlo.';
  }

  /** grab behaviour follows the mode switch now (no own control); kept for ux.js / tests */
  showGrabMode() {}

  showDraw(ux) {
    const d = ux.draw, b = this.penUpBtn;
    b.firstChild.textContent = d.penDown ? 'Pero nahoru ' : 'Pero dolů ';
    b.setAttribute('aria-pressed', String(!d.penDown));
    for (const x of this.drawBox.querySelectorAll('[data-h]')) x.setAttribute('aria-checked', String(+x.dataset.h === d.help));
  }

  showMode(mode) {
    for (const b of this.seg) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
    this.smart.hidden = mode !== 'smart';
    this.tpullBox.hidden = !this.ux.touch || mode !== 'smart' || !!this.padOn;
    $('joints').hidden = mode === 'smart';
    document.body.classList.toggle('ux-smartmode', mode === 'smart');
  }
  showGrip(open) {
    this.gripBtn.firstChild.textContent = open ? 'Zavřít chapadlo ' : 'Otevřít chapadlo ';
    this.gripBtn.setAttribute('aria-pressed', String(!open));
  }
  showPen(on) { this.penBtn.setAttribute('aria-pressed', String(on)); this.stage.classList.toggle('ux-pen-on', on); }
  showRoll(r) {
    if (document.activeElement !== this.roll) this.roll.value = r;
    const t = Math.round(r * 180 / Math.PI); if (t !== this.rollT) { $('ux-roll-o').textContent = t + '°'; this.rollT = t; }
  }
  showPitch(p) { this.pitch.value = Math.round(p * 180 / Math.PI); $('ux-pitch-o').textContent = Math.round(p * 180 / Math.PI) === 90 ? 'svisle dolů' : Math.round(p * 180 / Math.PI) + '°'; }

  // ---------- teach & replay ----------
  teachUI() {
    const mount = $('ux-teach');
    // a tool row: collapsed by default, opens itself while recording / replaying or for a shared demo link
    mount.appendChild(h(`<section class="ux-teach ux-tool" aria-labelledby="ux-teach-b">
      <button type="button" class="btn btn-o ux-toolbtn" id="ux-teach-b" aria-expanded="false" aria-controls="ux-teach-body"><span>Učit ukázkou</span> <span class="ux-chev" aria-hidden="true">▾</span></button>
      <p class="mono-s muted ux-toolsub" id="ux-teach-h">Nahrajte pohyb – ruka ho zopakuje</p>
      <div class="ux-teach-body" id="ux-teach-body" hidden>
      <p class="ink2">Nahrajte, jak úkol řešíte, a nechte ruku pohyb zopakovat. <b>Tohle je princip učení napodobováním:</b> skutečná SO-101 se z desítek takových ukázek (nahraných ovládací rukou) naučí úkol sama, třeba metodou ACT v knihovně LeRobot.</p>
      <div class="ux-row3">
        <button type="button" class="btn btn-o" id="ux-rec" aria-pressed="false" data-tip="Nahrávání (T)"><span class="rec" aria-hidden="true"></span><span class="l">Nahrát</span></button>
        <button type="button" class="btn btn-o" id="ux-play" disabled data-tip="Přehrát ukázku (L)">Přehrát <span aria-hidden="true">▶</span></button>
        <button type="button" class="btn btn-o" id="ux-loop" aria-pressed="false" disabled data-tip="Přehrávat dokola">Smyčka <span aria-hidden="true">↻</span></button>
      </div>
      <div class="ux-row3 ux-teach2">
        <button type="button" class="btn btn-o" id="ux-trim" disabled data-tip="Odstraní klid na začátku a konci">Oříznout</button>
        <button type="button" class="btn btn-o" id="ux-del" disabled>Smazat</button>
        <button type="button" class="btn btn-o" id="ux-import" data-tip="Ukázku od učitele nebo z jiného počítače">Načíst soubor <span aria-hidden="true">↑</span></button>
      </div>
      <input type="file" id="ux-import-f" accept="application/json,.json" hidden>
      <button type="button" class="ux-link" id="ux-share" disabled>Sdílet ukázku odkazem (třeba studentům) <span aria-hidden="true">🔗</span></button>
      <button type="button" class="ux-link" id="ux-export" disabled>Stáhnout ukázku jako JSON (formát podobný LeRobot) <span aria-hidden="true">⤓</span></button>
      <button type="button" class="btn btn-o" id="ux-shift" disabled data-tip="Stejné pohyby, předmět o 4 cm jinde">Posunout kostku a přehrát znovu <span aria-hidden="true">↔</span></button>
      <p id="ux-shift-note" hidden></p>
      <p class="mono-s muted" id="ux-teach-s" aria-live="polite">Zatím žádná ukázka.</p>
      </div>
    </section>`));
    $('ux-teach-b').addEventListener('click', () => this.openTeach($('ux-teach-body').hidden));
    $('ux-rec').addEventListener('click', () => this.ux.toggleRec());
    $('ux-play').addEventListener('click', () => this.ux.togglePlay());
    $('ux-shift').addEventListener('click', () => { if (this.ux.teach.startShiftedReplay()) this.toast('Předmět leží o 4 cm jinde. Trefí se ruka?', null, 3500); });
    $('ux-loop').addEventListener('click', () => { const t = this.ux.teach; t.loop = !t.loop; this.showTeach(t); });
    $('ux-trim').addEventListener('click', () => { const n = this.ux.teach.trim(); this.toast(n ? `Oříznuto ${n} snímků klidu` : 'Není co oříznout'); });
    $('ux-del').addEventListener('click', () => { this.ux.teach.clear(); this.toast('Ukázka smazána'); });
    $('ux-import').addEventListener('click', () => $('ux-import-f').click());
    $('ux-import-f').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { const n = this.ux.teach.importJSON(JSON.parse(await f.text())); this.toast(`Ukázka nahrána (${n} snímků). Přehrajte si ji.`); }
      catch (err) { this.toast('Tohle není ukázka ze simulátoru SO-101', 'err'); }
    });
    $('ux-share').addEventListener('click', async () => {
      const url = await this.ux.teach.shareURL();
      if (!url) { this.toast('Tento prohlížeč neumí odkaz vytvořit, použijte stažení JSON', 'err'); return; }
      try { await navigator.clipboard.writeText(url); this.toast('Odkaz s ukázkou je ve schránce'); }
      catch (e) { window.prompt('Zkopírujte odkaz s ukázkou:', url); }
    });
    $('ux-export').addEventListener('click', () => { const j = this.ux.teach.download(); if (j) this.toast(`Staženo: ${j.episodes[0].length} snímků po 1/30 s`); });
  }
  showTeach(t) {
    const rec = $('ux-rec'), play = $('ux-play'), loop = $('ux-loop'), ex = $('ux-export'), s = $('ux-teach-s');
    rec.setAttribute('aria-pressed', String(t.recording));
    rec.querySelector('.l').textContent = t.recording ? 'Zastavit' : 'Nahrát';
    play.disabled = !t.demo || t.recording; loop.disabled = !t.demo || t.recording; ex.disabled = !t.demo || t.recording;
    $('ux-trim').disabled = $('ux-del').disabled = !t.demo || t.recording || t.replaying;
    $('ux-share').disabled = !t.demo || t.recording;
    $('ux-shift').disabled = !t.demo || t.recording || t.replaying;
    const sn = $('ux-shift-note');
    sn.hidden = !t.shiftResult || t.replaying;
    if (t.shiftResult) sn.textContent = t.shiftResult === 'miss'
      ? 'Ruka zopakovala přesně stejné pohyby, ale předmět ležel jinde – a minula. Proto se skutečná SO-101 učí z desítek ukázek z různých míst.'
      : 'Tentokrát to ještě vyšlo. Zkuste posun znovu – pokaždé leží předmět jinde.';
    $('ux-import').disabled = t.recording;
    play.firstChild.textContent = t.replaying ? 'Stop ' : 'Přehrát ';
    play.querySelector('span').textContent = t.replaying ? '■' : '▶';
    loop.setAttribute('aria-pressed', String(t.loop));
    s.textContent = t.recording ? 'Nahrávám… pohybujte rukou.' : t.replaying ? 'Přehrávám ukázku.'
      : t.demo ? `${t.shared ? 'Sdílená ukázka' : t.restored ? 'Ukázka z minula' : 'Ukázka'}: ${fmt(t.duration())}, ${t.demo.t.length} snímků (mise ${t.demo.mission.n}).` : 'Zatím žádná ukázka.';
    this.recBadge.hidden = !t.recording; this.playBar.hidden = !t.replaying;
    this.stage.classList.toggle('ux-replaying', t.replaying);
    if ((t.recording || t.replaying) && !this.mq.matches) this.openTeach(true);   // T / L keys: show where it is
  }
  /** expand / collapse the "Učit ukázkou" tool (phones: also switch to the Nástroje tab) */
  openTeach(on, reveal) {
    const b = $('ux-teach-b'), body = $('ux-teach-body');
    body.hidden = !on; b.setAttribute('aria-expanded', String(on));
    if (on && reveal) this.openDrawer(false);
  }
  /** "Připojit AI" (src/agent/index.js mounts its box right after #ux-teach): a tool row of the drawer */
  mountAI() {
    const box = document.querySelector('.ai-box'), teach = $('ux-teach');
    if (!box || !teach) return;
    if (box.previousElementSibling !== teach) teach.after(box);
    box.classList.add('ux-tool');
    // "Zeptej se AI na tuto misi" is the last row of the hint popover (Poradit); its prompt opens in the drawer
    const ask = $('ai-ask-mission');
    if (ask) {
      this.hintBox.appendChild(ask);
      ask.addEventListener('click', () => { this.closeHint(false); this.openDrawer(false); }, true);
    }
    // the AI panel opened from elsewhere (reload while paired, the win card's "Záznam AI"): show the drawer
    const open = $('ai-open');
    if (open && window.MutationObserver) new MutationObserver(() => { if (open.getAttribute('aria-expanded') === 'true') this.openDrawer(false); })
      .observe(open, { attributes: true, attributeFilter: ['aria-expanded'] });
  }

  // ---------- stage overlays: camera, wrist PiP, toast, REC, replay bar, credit ----------
  stageUI() {
    const st = this.stage;
    // camera: Volný (cycles the view, C) | Zápěstí (wrist camera picture-in-picture, V)
    const cam = this.camSeg = h(`<div class="ux-cam" role="group" aria-label="Kamera">
      <button type="button" class="ux-tb" id="ux-view" aria-label="Přepnout pohled (C)">${I.cam}<span class="ux-tbl" id="ux-view-l">Volný</span></button>
      <button type="button" class="ux-tb" id="ux-wrist" aria-pressed="false" aria-label="Kamera na zápěstí (V)">${I.wrist}<span class="ux-tbl">Zápěstí</span></button>
    </div>`);
    st.appendChild(cam);
    $('ux-view').addEventListener('click', () => this.ux.cycleView());
    $('ux-wrist').addEventListener('click', () => this.ux.setWrist(!this.ux.cameras.wristOn));

    this.pip = h(`<div class="ux-pip" hidden aria-hidden="true"><span class="mono-s">Kamera na zápěstí</span></div>`);
    st.appendChild(this.pip);
    this.toastEl = h(`<div class="ux-toast" role="status" aria-live="polite" hidden></div>`);
    st.appendChild(this.toastEl);
    this.recBadge = h(`<div class="ux-recb mono" hidden><i aria-hidden="true"></i>REC <span id="ux-rec-t">0:00</span></div>`);
    st.appendChild(this.recBadge);
    this.playBar = h(`<div class="ux-playbar" hidden><span class="mono-s">Přehrávám ukázku</span><b><i id="ux-play-p"></i></b></div>`);
    st.appendChild(this.playBar);
    this.penHint = h(`<p class="ux-penhint mono-s" hidden>Nakreslete čáru po stole prstem nebo myší – ruka ji zopakuje</p>`);
    st.appendChild(this.penHint);
    // credits for the scanned / authored objects (CC BY 4.0 needs attribution where they are shown)
    this.credit = h(`<p class="mono-s ux-credit" hidden><a href="objects/LICENSES.md" target="_blank" rel="noopener"></a></p>`);
    st.appendChild(this.credit);
    // conveyor missions: which policy moves the arm ("Běží: Skript (plánovač)") and how long the belt has stood
    this.chips = h(`<div class="ux-chips" aria-hidden="true"><span class="ux-chip-run mono-s" hidden></span><span class="ux-chip-belt mono-s" hidden></span></div>`);
    st.appendChild(this.chips);
    this.chipRun = this.chips.firstChild; this.chipBelt = this.chips.lastChild;
  }
  /** shared time from a challenge link, shown next to the timer until the page is left */
  showChallenge(t) {
    if (!this.chal) { this.chal = h(`<span class="ux-chal mono"></span>`); $('ux-topr').insertBefore(this.chal, this.menuBtn); }
    this.chal.textContent = t;
  }
  showView(v) { $('ux-view-l').textContent = VIEW_LABELS[v].replace('Volný pohled', 'Volný'); }
  showWrist(on) { $('ux-wrist').setAttribute('aria-pressed', String(on)); this.pip.hidden = !on; this.pipCache = null; }
  showSide(on) { $('ux-side-b').setAttribute('aria-pressed', String(on)); }
  showSound(on) { $('ux-sound').setAttribute('aria-pressed', String(on)); $('ux-sound').classList.toggle('muted', !on); }
  showExplode(on) { $('ux-parts').setAttribute('aria-pressed', String(on)); }

  // ---------- "Nástroje": right-edge tab + drawer (phones: bottom sheet) ----------
  drawerUI() {
    const pn = this.panelEl;
    const x = h(`<button type="button" class="ux-x" id="ux-drawer-x" aria-label="Zavřít nástroje">×</button>`);
    pn.querySelector('.ux-dhead').appendChild(x);
    this.edgeTab = h(`<button type="button" class="ux-edge" id="ux-tools-tab" aria-controls="panel" aria-expanded="false">Nástroje</button>`);
    this.stage.appendChild(this.edgeTab);
    pn.hidden = true;
    x.addEventListener('click', () => this.closeDrawer(true));
    for (const b of [this.edgeTab, this.toolsQ]) b.addEventListener('click', () => (pn.hidden ? this.openDrawer(true, b) : this.closeDrawer(true)));
    // phones: touching the 3D scene puts the sheets away (the scene is the main thing)
    this.stage.addEventListener('pointerdown', () => { if (this.mq.matches) { this.closeDrawer(false); this.closeMenu(false); } });
  }
  drawerOpen() { return !this.panelEl.hidden; }
  /** focus: true = move focus into the drawer (user opened it), false = just show it (programmatic reveal) */
  openDrawer(focus, from) {
    const pn = this.panelEl;
    if (!pn.hidden) return;
    this.closeMenu(false);
    this.drawerFrom = from || document.activeElement;
    pn.hidden = false;
    document.body.classList.add('ux-drawer-open');
    for (const b of [this.edgeTab, this.toolsQ]) b.setAttribute('aria-expanded', 'true');
    if (focus) $('ux-drawer-x').focus({ preventScroll: true });
  }
  closeDrawer(refocus) {
    const pn = this.panelEl;
    if (pn.hidden) return;
    const had = pn.contains(document.activeElement);
    pn.hidden = true;
    document.body.classList.remove('ux-drawer-open');
    for (const b of [this.edgeTab, this.toolsQ]) b.setAttribute('aria-expanded', 'false');
    if (refocus || had) {
      const f = [this.drawerFrom, this.edgeTab, this.toolsQ].find((b) => b && b.isConnected && b.offsetParent && !pn.contains(b));
      if (f) f.focus({ preventScroll: true });
    }
  }

  // ---------- ☰ menu: missions, parts, setup wizard, shortcuts, intro, settings, language (phones), about ----------
  menuUI() {
    const menu = this.menu = h(`<div class="ux-menu" id="ux-menu" role="dialog" aria-modal="false" aria-labelledby="ux-menu-h" hidden>
      <div class="ux-menutop"><h2 class="mono" id="ux-menu-h">Menu</h2><button type="button" class="ux-x" aria-label="Zavřít menu">×</button></div>
      <ul class="ux-mlist">
        <li><button type="button" class="ux-mi" id="ux-m-missions">Mise <span class="ux-mi-r" aria-hidden="true">→</span></button></li>
        <li><button type="button" class="ux-mi" id="ux-parts" aria-pressed="false">Z čeho je ruka (díly) <span class="kbd" aria-hidden="true">X</span></button></li>
        <li><a class="ux-mi" href="nastaveni/"><span>Nastavení serv nanečisto<span class="mono-s muted ux-mi-s">Příprava na skutečnou ruku: ID, kalibrace, test – bez hardwaru</span></span> <span class="ux-mi-r" aria-hidden="true">→</span></a></li>
        <li><button type="button" class="ux-mi" id="ux-help">Ovládání a zkratky <span class="kbd" aria-hidden="true">?</span></button></li>
        <li><button type="button" class="ux-mi" id="ux-tour">Ukázat úvod znovu</button></li>
      </ul>
      <section class="ux-mset" aria-labelledby="ux-set-h">
        <h3 class="mono" id="ux-set-h">Nastavení</h3>
        <button type="button" class="ux-mi" id="ux-sound" aria-pressed="false"><span class="ux-mi-i">${I.snd}<span>Zvuk</span></span> <span class="kbd" aria-hidden="true">S</span></button>
        <button type="button" class="ux-mi" id="ux-side-b" aria-pressed="false"><span class="ux-mi-i">${I.side}<span>Pohled z boku</span></span></button>
      </section>
      <div class="ux-mlang" hidden><p class="mono">Jazyk</p></div>
    </div>`);
    document.querySelector('main.sim').appendChild(menu);
    const set = menu.querySelector('.ux-mset'), colors = document.querySelector('.colors'), about = document.querySelector('.ux-about');
    if (colors) set.appendChild(colors);
    if (about) menu.appendChild(about);
    menu.querySelector('.ux-x').addEventListener('click', () => this.closeMenu(true));
    this.menuBtn.addEventListener('click', () => (menu.hidden ? this.openMenu() : this.closeMenu(true)));
    document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !this.menuBtn.contains(e.target)) this.closeMenu(false); }, true);
    $('ux-m-missions').addEventListener('click', () => { this.closeMenu(true); this.openPicker(); });
    $('ux-parts').addEventListener('click', () => { this.closeMenu(true); this.ux.toggleExplode(); });
    $('ux-help').addEventListener('click', () => { this.closeMenu(true); this.openHelp(); });
    $('ux-tour').addEventListener('click', () => { this.closeMenu(true); this.ux.onboarding.start(true); });
    $('ux-sound').addEventListener('click', () => this.ux.setSound(!this.ux.sound.on));
    $('ux-side-b').addEventListener('click', () => this.ux.setSide(!this.ux.side.on));
    // compact layouts hide the site header: its language switch moves into the menu
    const ls = $('lang-sw'), home = ls && ls.parentNode, slot = menu.querySelector('.ux-mlang');
    const place = () => {
      if (!ls) return;
      const c = this.mqCompact.matches;
      if (c && ls.parentNode !== slot) slot.appendChild(ls); else if (!c && ls.parentNode !== home) home.appendChild(ls);
      slot.hidden = !c;
    };
    place(); this.mqCompact.addEventListener ? this.mqCompact.addEventListener('change', place) : this.mqCompact.addListener(place);
  }
  menuOpen() { return !this.menu.hidden; }
  openMenu() {
    this.closeHint(false);
    if (this.mq.matches) this.closeDrawer(false);
    this.menu.hidden = false; this.menuBtn.setAttribute('aria-expanded', 'true');
    const f = this.menu.querySelector('.ux-mi'); if (f) f.focus({ preventScroll: true });
  }
  closeMenu(refocus) {
    if (this.menu.hidden) return;
    const had = this.menu.contains(document.activeElement);
    this.menu.hidden = true; this.menuBtn.setAttribute('aria-expanded', 'false');
    if (refocus || had) this.menuBtn.focus({ preventScroll: true });
  }
  /** an open non-modal overlay (Esc closes the top one first: menu → hint popover → drawer) */
  popOpen() { return this.menuOpen() || this.hintOpen && !this.hintBox.hidden || this.drawerOpen(); }
  closeSet(refocus) {
    if (this.menuOpen()) this.closeMenu(refocus);
    else if (this.hintOpen && !this.hintBox.hidden) this.closeHint(refocus);
    else this.closeDrawer(refocus);
  }

  /** wrist-cam rectangle in canvas CSS px (cached until resize) */
  pipRect() {
    if (this.pip.hidden) return null;
    const c = this.ux.app.renderer.domElement;
    if (!this.pipCache || this.pipCache.cw !== c.clientWidth || this.pipCache.ch !== c.clientHeight) {
      const a = c.getBoundingClientRect(), b = this.pip.getBoundingClientRect();
      this.pipCache = { cw: c.clientWidth, ch: c.clientHeight, x: Math.round(b.left - a.left + 1), y: Math.round(b.top - a.top + 1), w: Math.round(b.width - 2), h: Math.round(b.height - 2) };
    }
    return this.pipCache;
  }

  toast(msg, kind, ms) {
    const t = this.toastEl;
    t.textContent = msg; t.className = 'ux-toast' + (kind ? ' ' + kind : ''); t.hidden = false;
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { t.hidden = true; }, ms || (kind === 'err' ? 2600 : 2200));
  }

  tick() {
    const ux = this.ux, r = ux.runner;
    const ti = Math.floor(r.time); if (ti !== this.timerS) { this.timer.textContent = fmt(ti); this.timerS = ti; }
    const t = ux.teach;
    if (t.recording) { const rs = Math.floor(ux.app.d.time - t.demo.t0); if (rs !== this.recS) { $('ux-rec-t').textContent = fmt(rs); this.recS = rs; } }
    if (t.replaying) $('ux-play-p').style.width = (t.progress() * 100).toFixed(1) + '%';
    this.showRoll(ux.ctl.active ? ux.ctl.roll : ux.app.d.ctrl[ux.app.act[4]]);
    const open = (ux.ctl.active ? ux.ctl.grip : ux.app.d.ctrl[ux.app.act[5]]) > 0.5;
    if (open !== this.gripOpen) { this.gripOpen = open; this.showGrip(open); }
    // stuck: "Poradit" is marked (never opened by itself)
    // conveyor chips (text only on change)
    const run = ux.wasteRun ? ux.wasteRun() : null, pol = ux.policyChip ? ux.policyChip() : null;
    const bt = run && run.pauseT > 0 && !r.won ? `Pás stojí ${fmt(run.pauseT)}` : '';
    if (pol !== this.chipRunT) { this.chipRunT = pol; this.chipRun.textContent = pol || ''; this.chipRun.hidden = !pol; }
    if (bt !== this.chipBeltT) { this.chipBeltT = bt; this.chipBelt.textContent = bt; this.chipBelt.hidden = !bt; }
    const hint = !!this.offered && !r.won && !ux.ctl.busy() && !ux.pending && !ux.teach.replaying && !ux.explode.on;
    if (hint !== this.offerOn) { this.offerOn = hint; this.hintB.classList.toggle('ux-offer', hint); }
  }

  // ---------- model detail (quality) ----------
  qualityUI() {
    const colors = document.querySelector('.colors');
    const el = h(`<div class="ux-quality">
      <p class="mono">Detail modelu</p>
      <div class="ux-seg ux-seg-s" role="radiogroup" aria-label="Detail modelu">
        <button type="button" role="radio" data-q="high">Vysoký</button>
        <button type="button" role="radio" data-q="low">Úsporný</button>
      </div>
      <p class="mono-s muted" id="ux-q-s"></p>
    </div>`);
    colors.parentNode.insertBefore(el, colors.nextSibling);
    this.qBtns = [...el.querySelectorAll('[data-q]')];
    for (const b of this.qBtns) b.addEventListener('click', () => {
      const q = b.dataset.q; this.showQuality(q, false, q === 'high' && !this.ux.hd.loaded);
      this.ux.hd.set(q).catch(() => this.toast('Detailní model se nepodařilo načíst', 'err'));
    });
    this.showQuality(this.ux.hd.quality, false, false);
  }
  showQuality(q, hi, loading) {
    for (const b of this.qBtns) b.setAttribute('aria-checked', String(b.dataset.q === q));
    const s = document.getElementById('ux-q-s');
    s.textContent = q === 'low' ? 'Zjednodušené díly (rychlejší na slabších telefonech).'
      : hi ? 'Původní tvary dílů, 325 tisíc trojúhelníků (≈ 1 MB).' : loading ? 'Načítám detailní díly…' : '';
  }

  // ---------- result card (HUD stage 2; the element keeps its id #win) ----------
  // header "Mise 01 / 10 · splněno" (+ "s ukázkou") · headline (the mission's done text) · stars · measured values
  // vs the next star (time, precision where the mission rates it) · one line (by hand / with a demo, advice) ·
  // badges and record · what comes next · Další mise (Enter) / Zkusit znovu (R) · staged extras as links.
  // Desktop: a card over a dimmed scene; phones: a bottom sheet with the scene above it.
  winUI() {
    const win = this.win = $('win');
    this.winK = $('ux-wk'); this.winDemo = win.querySelector('.ux-wdemo');
    this.winH = $('win-h');
    this.winStars = h(`<div class="ux-winstars" id="ux-wstars" role="img"><span aria-hidden="true">★</span><span aria-hidden="true">★</span><span aria-hidden="true">★</span></div>`);
    this.winVals = h(`<dl class="ux-wvals" id="ux-wvals"></dl>`);
    this.winH.after(this.winStars, this.winVals);
    this.winText = win.querySelector('p:not(.mono)');
    this.winText.id = 'ux-wline'; this.winText.classList.add('ux-wline');
    this.defaultWin = this.winText.textContent;
    this.winStats = h(`<p class="mono-s ux-winstats" hidden></p>`);
    this.winNext = h(`<p class="mono-s ux-wnext" id="ux-wnext"></p>`);
    this.winText.after(this.winStats, this.winNext);
    const wb = win.querySelector('.win-b');
    this.nextBtn = h(`<button type="button" class="btn btn-act" id="ux-next">Další mise <span class="ux-wkey" aria-hidden="true"><span class="kbd">Enter</span><span>→</span></span></button>`);
    wb.appendChild(this.nextBtn);
    this.nextBtn.addEventListener('click', () => this.ux.nextMission());
    // staged bridge (growth panel B): first win → practice by hand, 2nd → how it is built, 3rd+ → the real arm
    this.winLinks = h(`<div class="ux-wlinks"></div>`);
    wb.after(this.winLinks);
    this.guideBtn = h(`<button type="button" class="btn btn-o" id="ux-wguide">Teď ručně <span aria-hidden="true">→</span></button>`);
    this.exBtn = h(`<button type="button" class="btn btn-o" id="ux-wexplode">Z čeho se ruka skládá <span aria-hidden="true">→</span></button>`);
    this.shareBtn = h(`<button type="button" class="btn btn-o" id="ux-wshare">Sdílet rekord <span aria-hidden="true">↗</span></button>`);
    this.aiLogBtn = h(`<button type="button" class="btn btn-o" id="ux-wailog">Záznam AI <span aria-hidden="true">→</span></button>`);
    for (const b of [this.guideBtn, this.exBtn, this.shareBtn, this.aiLogBtn]) { b.hidden = true; wb.appendChild(b); }
    this.aiLogBtn.addEventListener('click', () => this.openAILog());
    this.guideBtn.addEventListener('click', () => this.ux.onboarding.afterWin());
    this.exBtn.addEventListener('click', () => { this.closeWin(false); if (!this.ux.explode.on) this.ux.toggleExplode(); });
    this.shareBtn.addEventListener('click', () => this.ux.shareRecord());
    if (this.ux.reduced) document.body.classList.add('ux-reduced');
    // phones in portrait: a bottom sheet under the scene (the scene shrinks and stays whole above it, like the
    // "Nástroje" sheet); otherwise a card over the scene
    const place = () => {
      const sheet = this.mq.matches, st = this.stage;
      if (sheet && win.parentNode === st) st.after(win); else if (!sheet && win.parentNode !== st) st.appendChild(win);
    };
    place(); this.mq.addEventListener ? this.mq.addEventListener('change', place) : this.mq.addListener(place);
  }
  /** by: null = the visitor, 'assisted' = "Ukázat řešení", 'ai' = the AI, 'replay' = a recorded demonstration (no stars then). */
  showWin(m, res, best, isNew, by) {
    const again = document.getElementById('again'), idx = MISSIONS.indexOf(m), next = MISSIONS[idx + 1];
    this.closeHint(false); this.closeMenu(false); this.closeDrawer(false);   // the result and the win card stay in view
    const manual = !by && res.kind === 'manual';
    this.winK.textContent = `Mise ${m.n} / ${String(MISSIONS.length).padStart(2, '0')} · splněno`;
    // a run the autopilot, hint rung 3, the full solution or a replayed demonstration carried: "s ukázkou"
    this.winDemo.hidden = manual || by === 'ai';
    this.winStars.hidden = !!by;
    const stars = manual ? res.stars : 0, sp = this.winStars.children;
    for (let i = 0; i < 3; i++) { sp[i].className = i < stars ? 'on' : ''; sp[i].style.animationDelay = (0.15 + i * 0.18) + 's'; }
    this.winStars.setAttribute('aria-label', `${stars} ze 3 hvězdiček`);
    this.winVals.textContent = '';
    const cell = (dt, dd, ok) => this.winVals.appendChild(h(`<div><dt>${dt}</dt><dd${/\d/.test(dd) ? '' : ' class="ux-wtxt"'}><span>${dd}</span>${ok ? '<span class="ux-wok" aria-hidden="true">✓</span>' : ''}</dd></div>`));
    let stats = [];
    if (m.belt && res.stats) {
      this.beltWin(m, res, best, isNew, by, manual, cell, again);
      this.winNext.textContent = next ? `Další: ${next.n} · ${next.short}` : 'To byla poslední mise.';
      this.nextBtn.hidden = !next;
      return;
    }
    if (manual) {
      const ns = nextStar(m, res.time, res.prec);
      cell('Váš čas', fmtTime(res.time, ns.time.limit));
      cell(`Pro ${ns.next} ★`, `do ${fmt(ns.time.limit)}`, ns.time.met);
      if (ns.prec) {
        cell(ns.prec.label, fmtPrec(ns.prec.v, ns.prec.limit, ns.prec.unit));
        cell(`Pro ${ns.next} ★`, ns.prec.limit == null ? 'splněno' : `pod ${fmtLimit(ns.prec.limit, ns.prec.unit)}`, ns.prec.met);
      }
      this.winH.textContent = /[.!]$/.test(m.done) ? m.done : m.done + '.';
      this.winText.innerHTML = '<span>Ručně, bez ukázky.</span>' + (res.stars < 3 && m.advice ? ` <span>${m.advice}</span>` : '');
      if (res.badges && res.badges.drag) stats.push('✋ ručně');
      if (res.badges && res.badges.joints) stats.push('⚙ klouby');
      if (isNew) stats.push('nový rekord');
      else if (best && best.stars && best.time != null) stats.push(`rekord ${fmt(best.time)}`);
      again.firstChild.textContent = 'Zkusit znovu ';
      again.classList.remove('btn-act'); again.classList.add('btn-o');
    } else {
      cell(by ? 'Čas' : 'Váš čas', fmtTime(res.time, null));
      cell('Hvězdičky', 'jen ručně, bez ukázky');
      if (!by && m.stars.p3 != null) {
        cell(m.stars.prec, fmtPrec(res.prec, m.stars.p3, m.stars.unit));
        cell('Pro 3 ★', `pod ${fmtLimit(m.stars.p3, m.stars.unit)}`, res.prec < m.stars.p3);
      }
      if (by) {
        const n = this.ux.aiSteps || 0;
        this.winH.textContent = by === 'ai' ? `Vyřešila to AI v ${n} ${n === 1 ? 'kroku' : 'krocích'} — zkusíte to sami?`
          : by === 'assisted' ? 'Tohle zvládla ruka sama.' : 'Ukázka splnila misi.';
        this.winText.textContent = by === 'ai' ? 'V záznamu AI uvidíte každý její krok. Pak zkuste misi vyřešit sami.'
          : by === 'assisted' ? (this.ux.clickPicks() ? 'Řešení ukázala ruka sama – zkuste to teď vy. Stačí kliknout na kostku a pak na misku.' : 'Řešení ukázala ruka sama – zkuste to teď vy, koulí nebo klouby.')
          : 'Přesně takhle se skutečná SO-101 učí: z nahraných ukázek. Zkuste misi vyřešit sami.';
        again.firstChild.textContent = 'Teď to zkuste vy ';
        again.classList.add('btn-act'); again.classList.remove('btn-o');
      } else {
        // the autopilot (click-to-grab or hint rung 3) carried it: done, unlocks the next mission, no stars
        this.winH.textContent = /[.!]$/.test(m.done) ? m.done : m.done + '.';
        this.winText.textContent = 'S ukázkou – hvězdičky jsou za ruční přenesení.';
        again.firstChild.textContent = 'Zkusit ručně ';
        again.classList.remove('btn-act'); again.classList.add('btn-o');
      }
    }
    this.winStats.textContent = stats.join(' · '); this.winStats.hidden = !stats.length;
    // what comes next: the next mission's number and short title (the mission list has no "what it adds" data)
    this.winNext.textContent = next ? `Další: ${next.n} · ${next.short}` : 'To byla poslední mise.';
    this.nextBtn.hidden = !next;
  }
  /** Result card of a conveyor mission: sorted, purity (overall and per bin), missed (by fraction), belt stood,
   *  time; the named stars with the measured value next to each one that was missed. */
  beltWin(m, res, best, isNew, by, manual, cell, again) {
    const st = res.stats, S = m.stars, pct = (v) => (v == null ? '–' : `${String(+(100 * v).toFixed(1)).replace('.', ',')} %`);
    const sec = (v) => `${String(+v.toFixed(1)).replace('.', ',')} s`;
    const pur = st.purity != null && st.purity >= S.purity - 1e-9, still = st.paused <= S.pause + 1e-9;
    cell('Roztříděno', `${st.correct} z ${st.n}`, st.correct >= S.win);
    cell('Čistota', pct(st.purity) + (st.wrong ? ` (${st.wrong} v cizím koši)` : ''), pur);
    cell('Propadlo', String(st.missed));
    cell('Pás stál', st.paused > 0 ? sec(st.paused) : 'ani jednou', still);
    cell(by ? 'Čas' : 'Váš čas', fmtTime(res.time, null));
    this.winH.textContent = /[.!]$/.test(m.done) ? m.done : m.done + '.';
    // named stars: earned ones plain, missed ones with the measured value
    const named = [`★ hotovo`, pur ? '★ čistota 100 %' : `☆ čistota ${pct(st.purity)}`, still ? '★ bez zastavení pásu' : `☆ pás stál ${sec(st.paused)}`];
    if (manual) {
      this.winText.innerHTML = named.map((x) => `<span>${x}</span>`).join(' · ') + (res.stars < 3 && m.advice ? ` <span>${m.advice}</span>` : '');
      again.firstChild.textContent = 'Zkusit znovu ';
      again.classList.remove('btn-act'); again.classList.add('btn-o');
    } else {
      this.winText.textContent = by ? 'Tohle roztřídila ruka sama (Skript, plánovač). Zkuste to teď vy.' : 'S ukázkou – hvězdičky jsou za ruční třídění.';
      again.firstChild.textContent = by ? 'Teď to zkuste vy ' : 'Zkusit ručně ';
      again.classList.toggle('btn-act', !!by); again.classList.toggle('btn-o', !by);
    }
    const stats = [];
    // per bin: correct / everything in it; missed by fraction
    stats.push(Object.entries(FRACTION_BIN).map(([f, fx]) => { const b = st.byBin[fx]; return `${FRACTION_CS[f]} ${b.correct}/${b.correct + b.wrong}`; }).join(' · '));
    const lost = Object.entries(st.missedBy).filter(([, k]) => k > 0).map(([f, k]) => `${FRACTION_CS[f]} ${k}`);
    if (lost.length) stats.push('propadlo: ' + lost.join(', '));
    if (manual && res.badges && res.badges.drag) stats.push('✋ ručně');
    if (manual && res.badges && res.badges.joints) stats.push('⚙ klouby');
    if (manual && isNew) stats.push('nový rekord');
    // one text node per piece (the English table translates them one by one)
    this.winStats.innerHTML = stats.map((x) => `<span>${x}</span>`).join(' · '); this.winStats.hidden = false;
  }
  /** one more item for the badges / record line (e.g. a friend's shared time) */
  addStat(t) { const s = this.winStats; s.textContent = s.textContent ? s.textContent + ' · ' + t : t; s.hidden = false; }
  winOpen() { return !this.win.hidden; }
  /** show the card and move focus to it (the dialog's name and description are read once) */
  openWin() {
    this.win.hidden = false;
    document.body.classList.add('ux-result-open');
    this.win.focus({ preventScroll: true });
  }
  /** Esc: put the card away (the run stays won; R or the mission picker go on) */
  closeWin(refocus) {
    if (this.win.hidden) return;
    const had = this.win.contains(document.activeElement);
    this.win.hidden = true;
    document.body.classList.remove('ux-result-open');
    if (refocus || had) this.ux.app.renderer.domElement.focus({ preventScroll: true });
  }
  /** the card's primary action (Enter): Další mise, or "Teď ručně" / "Teď to zkuste vy" where that leads */
  winPrimary() { return this.win.querySelector('.win-b .ux-primary:not([hidden])'); }

  /**
   * Which buttons the win card shows, in order; the first is the primary one.
   *   by (assisted / replay): "Teď to zkuste vy", Další mise · guided first win: "Teď ručně", Další mise
   *   own win 2: Další mise, "Z čeho se ruka skládá" · own win 3+: Další mise, "Chci skutečnou SO-101"
   *   a 3 ★ own win also offers "Sdílet rekord". No purchase button before the 3rd win.
   * Result card: the primary and Další mise / Zkusit znovu are the button row; the staged extras are a link row.
   */
  stageWin(m, { by, guided, wins, stars }) {
    const ids = { cta: $('cta'), again: $('again'), next: this.nextBtn, guide: this.guideBtn, ex: this.exBtn, share: this.shareBtn, ailog: this.aiLogBtn };
    const last = MISSIONS[MISSIONS.length - 1].id === m.id;
    let order;
    if (by === 'ai') order = ['again', 'ailog', 'next'];
    else if (by) order = ['again', 'next'];
    else if (guided) order = ['guide', 'next'];
    else { order = ['next']; if (wins === 2) order.push('ex'); else if (wins >= 3) order.push('cta'); order.push('again'); if (stars === 3) order.push('share'); }
    if (last) order = order.filter((k) => k !== 'next');
    const wb = this.win.querySelector('.win-b'), links = this.winLinks;
    for (const k of Object.keys(ids)) { const b = ids[k]; b.hidden = !order.includes(k); b.classList.remove('ux-primary', 'ux-full', 'btn-act', 'btn-o', 'ux-wl'); b.classList.add('btn'); }
    order.forEach((k, i) => {
      const b = ids[k];
      if (i === 0) { b.classList.add('ux-primary', 'btn-act'); wb.appendChild(b); }
      else if (k === 'next' || k === 'again' || k === 'guide') { b.classList.add('btn-o'); wb.appendChild(b); }
      else { b.classList.remove('btn'); b.classList.add('ux-link', 'ux-wl'); links.appendChild(b); }
    });
    links.hidden = !links.querySelector(':scope > :not([hidden])');
    return order;
  }

  /** "Záznam AI" on the win card: open the "Připojit AI" panel (its own log is inside) and show the log */
  openAILog() {
    this.openDrawer(false);
    const so = window.so101, go = () => { const l = document.querySelector('.ai-logbox'); if (l) { l.scrollIntoView({ block: 'nearest' }); const o = $('ai-open'); if (o) o.focus({ preventScroll: true }); } };
    if (so && so.openPanel) Promise.resolve(so.openPanel()).then(go, go); else go();
  }

  // ---------- help: how to move the arm (the old panel tips) + keyboard shortcuts ----------
  helpUI() {
    const ux = this.ux;
    const tap = (s) => (ux.touch ? s.replace(/Klikněte/g, 'Klepněte').replace(/klikněte/g, 'klepněte').replace('Dvojklik', 'Dvojí klepnutí') : s);
    const keys = [
      ['Myš / prst', 'tažením otáčíte pohled, kolečkem či dvěma prsty přibližujete'],
      ['Modrá koule', 'tažením vedete ruku (Táhnout ruku)'],
      ['Klik na kostku', 'ruka ji vezme, klik na misku nebo stůl ji položí (mise 01–03)'],
      ['←  →  ↑  ↓', 'posun cíle po stole'],
      ['PgUp / PgDn', 'výška cíle (také Q / E)'],
      ['A / D', 'rotace zápěstí'],
      ['Mezerník / G', 'otevřít / zavřít chapadlo'],
      ['M', 'Táhnout ruku ↔ Klouby'],
      ['K', 'nakreslit cestu prstem – ruka ji projede'],
      ['P', 'kreslení: pero nahoru / dolů'],
      ['1 – 6', 'vybrat kloub (pak ← → otáčí, Esc zruší)'],
      ['Shift + 1 – 5', 'výběr mise'],
      ['Část ruky', 'v režimu Táhnout ruku ji tahem vedete (celá povolí); v režimu Klouby otočíte jen tím kloubem, dvojklik = výchozí poloha'],
      ['Čelisti', 'klepnutím otevřete / zavřete chapadlo'],
      ['C', 'přepnout pohled kamery'],
      ['V', 'kamera na zápěstí'],
      ['X', 'rozložený pohled'],
      ['T / L', 'nahrát / přehrát ukázku'],
      ['H', 'ruka domů'],
      ['R', 'začít misi znovu'],
      ['B', 'pás stát / jet (mise 11)'],
      ['S', 'zvuk'],
      ['Esc', 'zrušit pohyb, zavřít okno']
    ];
    const dlg = this.help = h(`<div class="ux-modal" id="ux-helpdlg" hidden role="dialog" aria-modal="true" aria-labelledby="ux-help-h">
      <div class="ux-modal-in">
        <div class="ux-modal-top"><p class="mono">Nápověda</p><button type="button" class="ux-x" aria-label="Zavřít">×</button></div>
        <h2 id="ux-help-h">Ovládání a zkratky</h2>
        <div class="ux-tipsbox" id="ux-tips">
          <div><h3 class="mono">Táhnout ruku</h3>
          <ul class="ux-tips" data-for="smart">
            <li><i class="dot" aria-hidden="true"></i><span>Táhněte <b>modrou kouli</b>, ruka ji sleduje. Červená = tam nedosáhne.</span></li>
            <li><i aria-hidden="true">↕</i><span>Šipky nad a pod koulí mění výšku.</span></li>
            <li><i aria-hidden="true">⟳</i><span>Kroužek, kolečko myši nebo druhý prst otáčí zápěstím.</span></li>
            <li class="ux-tip-pull"><i aria-hidden="true">✥</i><span>Chyťte kteroukoli část ruky – povolí a nechá se vést jako skutečná.</span></li>
            <li><i aria-hidden="true">☝</i><span>${tap('Mise 01–03: klikněte na předmět – ruka ho sama vezme, pak klikněte, kam ho položit. Bez hvězdiček; od mise 04 už ne.')}</span></li>
          </ul></div>
          <div><h3 class="mono">Klouby</h3>
          <ul class="ux-tips" data-for="joints">
            <li><i aria-hidden="true">⇆</i><span>Posuvníky natočí každý kloub zvlášť.</span></li>
            <li><i aria-hidden="true">✥</i><span>${tap('Chyťte díl ruky ve 3D a otočte jen jeho kloubem. Dvojklik ho vrátí do výchozí polohy.')}</span></li>
            <li><i aria-hidden="true">#</i><span>Klávesy 1–6 vyberou kloub, šipky ← → s ním otáčí.</span></li>
          </ul></div>
        </div>
        <h3 class="mono">Klávesové zkratky</h3>
        <dl class="ux-keys">${keys.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        <label class="ux-check"><input type="checkbox" id="ux-keys-on"> Zkratky jednou klávesou (písmena, číslice, mezerník) fungují kdekoli na stránce. Vypnuté fungují jen se zaměřenou 3D scénou.</label>
      </div></div>`);
    document.body.appendChild(dlg);
    trapFocus(dlg);
    this.grabSeg = dlg.querySelector('.ux-tip-pull');   // hidden with ?real=1 (no physics pull on armed hardware)
    dlg.querySelector('.ux-x').addEventListener('click', () => this.closeHelp());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) this.closeHelp(); });
    const ko = $('ux-keys-on');
    ko.checked = this.ux.keysOn;
    ko.addEventListener('change', () => { this.ux.keysOn = ko.checked; store.set('keys-on', ko.checked); });
  }
  openHelp() { this.closeMenu(false); this.lastFocus = document.activeElement; this.help.hidden = false; this.help.querySelector('.ux-x').focus(); }
  closeHelp() { this.help.hidden = true; if (this.lastFocus) this.lastFocus.focus({ preventScroll: true }); }
  modalOpen() { return !this.help.hidden || !this.picker.hidden; }
  closeModals() { if (!this.help.hidden) this.closeHelp(); if (!this.picker.hidden) this.closePicker(); }
}

// keep Tab inside an aria-modal dialog
function trapFocus(dlg) {
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...dlg.querySelectorAll('button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

function progressOf(prog) {
  let done = 0, stars = 0;
  for (const m of MISSIONS) { const p = prog && prog[m.id]; if (p) { done++; stars += p.stars || 0; } }
  return { done, stars, n: MISSIONS.length };
}
function progressText(pr) { return `${pr.done} / ${pr.n} misí · ${pr.stars} ★ z ${pr.n * 3}`; }

/**
 * Measured values on the result card, Czech decimal comma (src/i18n/en.js turns it into a point). The shown value
 * never rounds across the limit it is compared with: 1 decimal, more only when rounding would flip the comparison.
 */
function shown(v, limit, le, put) {
  for (let d = 1; d <= 3; d++) {
    const p = 10 ** d, n = Math.round(v * p), r = n / p;
    if (limit == null || (le ? r <= limit : r < limit) === (le ? v <= limit : v < limit)) return put(Math.floor(n / p), String(n % p).padStart(d, '0'));
  }
  return put(Math.floor(v), '');
}
export function fmtTime(t, limit) {
  return shown(Math.max(0, t || 0), limit, true, (w, f) => `${Math.floor(w / 60)}:${String(w % 60).padStart(2, '0')}${f ? ',' + f : ''}`);
}
const toUnit = (v, unit) => (unit === 'rad' ? v * 180 / Math.PI : v * 1000);
const suffix = (unit) => (unit === 'rad' ? '°' : ' mm');
export function fmtPrec(v, limit, unit) {
  return shown(toUnit(v, unit), limit == null ? null : toUnit(limit, unit), false, (w, f) => `${w}${f ? ',' + f : ''}`) + suffix(unit);
}
/** a limit as written in the rules: 4 mm, 2,5 mm, 4° (0.07 rad = 4,01°, shown to 0,1° like the measured tilt) */
export function fmtLimit(v, unit) { return String(+toUnit(v, unit).toFixed(unit === 'rad' ? 1 : 2)).replace('.', ',') + suffix(unit); }

export function fmt(t) { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); }
/** mastery badges: ✋ won by hand in Táhnout ruku, ⚙ won in Klouby (src/mastery.js) */
function badgeStr(p, big) {
  if (!p) return '';
  let s = '';
  if (p.drag) s += `<b class="ux-badge" title="Zvládnuto ručně – Táhnout ruku">✋</b>`;
  if (p.joints) s += `<b class="ux-badge" title="Zvládnuto v režimu Klouby">⚙</b>`;
  if (!p.stars) s += `<b class="ux-badge ux-done" title="Splněno">✓</b>`;
  return s ? `<span class="ux-badges${big ? ' big' : ''}">${s}</span>` : '';
}
function starStr(n) { let s = ''; for (let i = 0; i < 3; i++) s += `<i class="${i < n ? 'on' : ''}">★</i>`; return s; }
