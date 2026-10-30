// DOM for the UX layer: mode switch, smart-move controls, mission picker, teach & replay, stage toolbar,
// wrist-cam frame, toasts, win dialog extras, keyboard shortcuts dialog. Formal Czech ("vy").

import { MISSIONS } from '../missions.js';
import { VIEW_LABELS } from './cameras.js';
import { store } from './store.js';

const $ = (id) => document.getElementById(id);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const I = {
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.4-6.4M21 12a9 9 0 0 1-15.4 6.4"/><path d="M18.5 2.5v3.6h-3.6M5.5 21.5v-3.6h3.6"/><circle cx="12" cy="12" r="2.6"/></svg>',
  wrist: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6.5" width="13" height="11" rx="1.5"/><path d="M15.5 10.5l6-3.2v9.4l-6-3.2z"/></svg>',
  snd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9h4l5-4v14l-5-4h-4z"/><path class="on" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/><path class="off" d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.4a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.9v.6"/><circle cx="12" cy="17.6" r=".6"/></svg>',
  parts: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 17.5h7M17.5 14v7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.8"/><circle cx="12" cy="12" r="6.6"/><path d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8M5.4 5.4l2 2M16.6 16.6l2 2M5.4 18.6l2-2M16.6 7.4l2-2"/></svg>'
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

// Panel IA (sim-panel-ia): 1. mission card (goal, stars, hint ladder Poradit → Ukázat řešení, Další mise),
// 2. one control block (Táhnout ruku | Klouby, gripper, Domů / Znovu, one-line help + "?"),
// 3. tools (Učit ukázkou, Připojit AI, Skutečná ruka), settings in a ⚙ popover on the stage toolbar.
// Phones (≤ 860 px): the panel is a bottom sheet (3 snap points) with tabs Mise / Ovládání / Nástroje and one
// sticky action row (Chapadlo · Domů · Poradit).
export class Panel {
  constructor(ux) {
    this.ux = ux;
    this.stage = document.querySelector('.stage');
    this.panelEl = document.querySelector('.panel');
    // the bottom sheet: phones in portrait; landscape phones (≤ 500 px high) keep the side panel
    this.mq = matchMedia('(max-width:860px) and (min-height:501px)');
    this.hintLevel = 0;
    this.missionUI();
    this.modeUI();
    this.teachUI();
    this.stageUI();
    this.winUI();
    this.helpUI();
    this.flowsUI();
    this.sheetUI();
  }

  // ---------- hint ladder, phone action row ----------
  flowsUI() {
    const ux = this.ux;
    // HUD nudge after 20 s without success: the next step of the hint ladder (desktop; phones have the action row)
    this.hintBtn = h(`<button type="button" class="ux-hintbtn" id="ux-hint" hidden>Poradit <span aria-hidden="true">?</span></button>`);
    $('hud').appendChild(this.hintBtn);
    this.hintBtn.addEventListener('click', () => this.hint());
    // phones: top of the bottom sheet = handle, status line (HUD), guide strip, the one action row
    const under = this.under = h(`<div class="ux-under">
      <button type="button" class="ux-handle" id="ux-handle" aria-expanded="false" aria-label="Rozbalit panel"><i aria-hidden="true"></i></button>
      <div class="ux-qrow">
        <button type="button" class="btn btn-o" id="ux-qgrip">Otevřít chapadlo</button>
        <button type="button" class="btn btn-o" id="ux-qhome">Domů <span aria-hidden="true">⌂</span></button>
        <button type="button" class="btn btn-o" id="ux-qhint" aria-controls="ux-hintbox">Poradit <span aria-hidden="true">?</span></button>
      </div></div>`);
    this.sheetHead = h(`<div class="ux-sheethead"></div>`);
    this.sheetHead.appendChild(under);
    this.panelEl.insertBefore(this.sheetHead, this.panelEl.firstChild);
    // in the drawing mission the gripper holds the marker: this button lifts / lowers the pen instead
    $('ux-qgrip').addEventListener('click', () => (ux.runner.m.draw ? ux.togglePenUp() : ux.toggleGrip()));
    $('ux-qhome').addEventListener('click', () => this.goHome());
    $('ux-qhint').addEventListener('click', () => this.hint());
    const hud = $('hud');
    // phones: the win card is a compact strip at the top of the sheet, so the result (cube in the bowl) stays visible
    const win = $('win');
    const place = () => {
      const q = under.querySelector('.ux-qrow');
      if (this.mq.matches) { under.insertBefore(hud, q); under.insertBefore(win, q); win.classList.add('strip'); }
      else { if (hud.parentNode !== this.stage) this.stage.appendChild(hud); if (win.parentNode !== this.stage) this.stage.appendChild(win); win.classList.remove('strip'); }
    };
    place(); this.mq.addEventListener ? this.mq.addEventListener('change', place) : this.mq.addListener(place);
  }

  // ---------- phones: bottom sheet with tabs Mise / Ovládání / Nástroje, 3 snap points ----------
  sheetUI() {
    const pn = this.panelEl;
    const secs = this.secs = [['mission', 'Mise', 'mission-h'], ['ctl', 'Ovládání', 'ux-ctl-h'], ['tools', 'Nástroje', 'ux-tools-h']]
      .map(([k, l, lab]) => ({ k, l, lab, el: $('ux-sec-' + k) })).filter((s) => s.el);
    const tabs = this.tabsEl = h(`<div class="ux-tabs" role="tablist" aria-label="Panel simulace">${secs.map((s) =>
      `<button type="button" role="tab" id="ux-tab-${s.k}" aria-controls="ux-sec-${s.k}" aria-selected="false" tabindex="-1">${s.l}</button>`).join('')}</div>`);
    // phones: number, stars and the h1 move into a compact head above the tabs (always visible)
    this.mHead = h(`<div class="mission ux-mhead"></div>`);
    this.sheetHead.appendChild(this.mHead);
    this.sheetHead.appendChild(tabs);
    this.tab = 'mission'; this.snap = 0;
    const btns = [...tabs.querySelectorAll('[role=tab]')];
    for (const b of btns) b.addEventListener('click', () => { this.selectTab(b.id.slice(7)); if (this.snap < 1) this.setSnap(1); });
    tabs.addEventListener('keydown', (e) => {
      const i = btns.indexOf(document.activeElement); if (i < 0) return;
      const n = e.key === 'ArrowRight' ? (i + 1) % btns.length : e.key === 'ArrowLeft' ? (i + btns.length - 1) % btns.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : -1;
      if (n < 0) return;
      e.preventDefault(); e.stopPropagation(); btns[n].focus(); this.selectTab(btns[n].id.slice(7));
    });
    const handle = $('ux-handle');
    handle.addEventListener('click', () => { if (!this.dragged) this.setSnap((this.snap + 1) % 3); this.dragged = false; });
    // drag the handle / status line: follow the finger, then snap to the nearest of the three heights
    const grip = this.under;
    let y0 = 0, h0 = 0, drag = false;
    grip.addEventListener('pointerdown', (e) => {
      if (!this.mq.matches || e.target.closest('.ux-qrow, .ux-coach, button:not(#ux-handle), a')) return;
      drag = true; this.dragged = false; y0 = e.clientY; h0 = pn.getBoundingClientRect().height;
      pn.classList.add('ux-dragging');
    });
    addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = y0 - e.clientY; if (Math.abs(dy) > 6) this.dragged = true;
      if (this.dragged) pn.style.height = Math.max(this.snapPx(0), Math.min(this.snapPx(2), h0 + dy)) + 'px';
    });
    const end = () => {
      if (!drag) return; drag = false; pn.classList.remove('ux-dragging');
      if (!this.dragged) { pn.style.height = ''; return; }
      const cur = pn.getBoundingClientRect().height;
      let best = 0; for (let i = 1; i < 3; i++) if (Math.abs(this.snapPx(i) - cur) < Math.abs(this.snapPx(best) - cur)) best = i;
      pn.style.height = ''; this.setSnap(best);
    };
    addEventListener('pointerup', end); addEventListener('pointercancel', end);
    const apply = () => {
      const on = this.mq.matches;
      for (const s of secs) {
        if (on) { s.el.setAttribute('role', 'tabpanel'); s.el.setAttribute('aria-labelledby', 'ux-tab-' + s.k); s.el.hidden = s.k !== this.tab; }
        else { s.el.removeAttribute('role'); s.el.setAttribute('aria-labelledby', s.lab); s.el.hidden = false; }
      }
      if (on) { this.mHead.append(this.mTop, this.mTitle); }
      else if (this.mTop.parentNode === this.mHead) { this.mBox.prepend(this.mTop, this.mTitle); }
      if (!on) { pn.style.height = ''; delete pn.dataset.snap; } else this.setSnap(this.snap);
    };
    // touching the 3D scene puts the sheet back down: the scene is the main thing
    this.stage.addEventListener('pointerdown', () => { if (this.mq.matches && this.snap > 0) this.setSnap(0); });
    this.selectTab(this.tab);
    apply(); this.mq.addEventListener ? this.mq.addEventListener('change', apply) : this.mq.addListener(apply);
  }
  /** sheet heights: 0 = peek (the space under the stage), 1 = about 62 % of the screen, 2 = all below the header */
  snapPx(i) {
    const vh = innerHeight, top = document.querySelector('.bar').getBoundingClientRect().bottom;
    if (i === 0) return Math.max(0, vh - this.stage.getBoundingClientRect().bottom);
    if (i === 1) return Math.round(vh * 0.62);
    return Math.round(vh - Math.max(0, top));
  }
  setSnap(i) {
    this.snap = i;
    if (!this.mq.matches) return;
    this.panelEl.dataset.snap = String(i);
    const hd = $('ux-handle');
    hd.setAttribute('aria-expanded', String(i > 0));
    hd.setAttribute('aria-label', i === 2 ? 'Sbalit panel' : 'Rozbalit panel');
    if (i === 0) this.panelEl.scrollTop = 0;
  }
  selectTab(k) {
    this.tab = k;
    for (const b of this.tabsEl.querySelectorAll('[role=tab]')) { const on = b.id === 'ux-tab-' + k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    if (this.mq.matches) for (const s of this.secs) s.el.hidden = s.k !== k;
  }

  goHome() { const ux = this.ux; ux.ctl.cancel(); ux.pending = null; ux.app.goHome(); ux.ctl.syncFromCtrl(); }

  /**
   * Hint ladder. "Poradit" (mission card, phone action row, HUD nudge) only ever opens the ladder; it never
   * runs the solution, so a double tap cannot jump to the answer. The next step is offered inside the hint
   * box only. HINT_STEPS is the ladder (wave B adds: strategy text → ghost subgoal → partial demo → solution).
   */
  hint() {
    if (this.ux.app.won) return;
    this.offered = false;
    if (this.hintLevel < 1) this.hintLevel = 1;
    this.showHint(true);
    // phones: the sheet opens on the hint box; desktops also get the tip as a toast over the scene
    // (after the DOM translation of ?lang=en has run on the new text)
    if (this.mq.matches) { this.selectTab('mission'); if (this.snap < 1) this.setSnap(1); }
    else setTimeout(() => this.toast(this.hintText.innerText.replace(/\s*\n+\s*/g, ' ').trim(), null, 7000), 0);
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
  /** Stuck (no progress / failed grasps): show "Poradit" on the stage, never open the ladder by itself. */
  offerHint(reason) {
    if (this.ux.app.won || this.offered) return;
    this.offered = true;
    $('ux-qhint').classList.add('ux-offer');
    this.toast(reason === 'grasp' ? 'Chapadlo se zavřelo naprázdno. Poradit vám ukáže postup.' : 'Nevíte, jak dál? Poradit vám dá tip.', null, 4000);
  }
  showHint(fresh) {
    const ux = this.ux, m = ux.runner.m, lv = this.hintLevel, won = !!ux.app.won, cur = HINT_STEPS[lv - 1];
    if (!lv) $('ux-qhint').classList.toggle('ux-offer', !!this.offered && !won);
    if (lv && cur && fresh) {
      let html;
      if (cur.id === 'strategy') {
        let now = ux.runner.last && ux.runner.last.text || '';
        if (ux.touch) now = now.replace(/Klikněte/g, 'Klepněte');
        html = `<span>${m.strategy || ''}</span>` + (now ? `<br><span class="ux-hintnow"><b>Teď:</b> <span>${now}</span></span>` : '');
      } else {
        const grasp = Object.values(m.targets || {}).includes('pick');
        html = `<span>${cur.id === 'partial' && !grasp ? 'Ruka se postaví na začátek – dokončete to vy. Mise se pak počítá jako splněná, bez hvězdiček.' : cur.text}</span>`;
      }
      if (this.hintText.innerHTML !== html) this.hintText.innerHTML = html;
      $('ux-qhint').classList.remove('ux-offer');
    }
    this.hintBox.hidden = !lv || won;
    this.hintStepEl.textContent = `Nápověda ${lv} / ${HINT_STEPS.length}`;
    const nx = HINT_STEPS[lv];
    const nb = this.hintNextBtn, demo = $('demo');
    nb.hidden = !nx || nx.id === 'solution';
    if (nx && nx.id !== 'solution') nb.firstChild.textContent = nx.next + ' ';
    demo.hidden = !nx || nx.id !== 'solution';
    $('ux-mhint').hidden = won;
  }

  // ---------- mission header + picker ----------
  missionUI() {
    const box = this.mBox = document.querySelector('.mission');
    this.mNum = box.querySelector('p.mono');
    this.mTitle = box.querySelector('h1');
    this.mDesc = box.querySelector('p.ink2');
    const top = this.mTop = h(`<div class="ux-mtop"></div>`);
    box.insertBefore(top, this.mNum);
    top.appendChild(this.mNum);
    this.mStars = h(`<span class="ux-stars" id="ux-mstars" role="img" aria-label="Zatím nesplněno"></span>`);
    top.appendChild(this.mStars);
    const row = h(`<div class="ux-mrow">
      <button type="button" class="btn btn-o ux-mini" id="ux-mhint" aria-controls="ux-hintbox">Poradit <span aria-hidden="true">?</span></button>
      <button type="button" class="ux-link" id="ux-pick-mission" aria-haspopup="dialog">Vybrat misi <span aria-hidden="true">▾</span></button>
    </div>`);
    box.appendChild(row);
    // hint ladder: the tip first, "Ukázat řešení" only after it (never the primary action)
    const hb = this.hintBox = h(`<div class="ux-hintbox" id="ux-hintbox" hidden>
      <p class="mono" id="ux-hintstep"></p><p class="ux-hinttext" aria-live="polite"></p><div class="ux-hintnext"></div></div>`);
    box.appendChild(hb);
    this.hintText = hb.querySelector('.ux-hinttext');
    this.hintStepEl = hb.querySelector('#ux-hintstep');
    // the last rung: "Ukázat řešení" (#demo keeps its id and its app.js click handler)
    const demo = $('demo');
    demo.classList.remove('btn'); demo.classList.add('ux-link', 'ux-solve');
    demo.title = 'Ruka úlohu vyřeší sama – bez hvězdiček';
    this.hintNextBtn = h(`<button type="button" class="ux-link ux-solve" id="ux-hintnext">Další krok <span aria-hidden="true">→</span></button>`);
    this.hintNextBtn.addEventListener('click', () => this.hintNext());
    hb.querySelector('.ux-hintnext').append(this.hintNextBtn, demo);
    row.querySelector('#ux-mhint').addEventListener('click', () => this.hint());
    // after a win: the primary action of the card is the next mission
    this.mNext = h(`<button type="button" class="btn btn-act ux-mnext" id="ux-mnext" hidden>Další mise <span aria-hidden="true">→</span></button>`);
    box.appendChild(this.mNext);
    this.mNext.addEventListener('click', () => this.ux.nextMission());
    row.querySelector('#ux-pick-mission').addEventListener('click', () => this.openPicker());

    const dlg = this.picker = h(`<div class="ux-modal" id="ux-picker" hidden role="dialog" aria-modal="true" aria-labelledby="ux-picker-h">
      <div class="ux-modal-in">
        <div class="ux-modal-top"><p class="mono">Mise</p><button type="button" class="ux-x" aria-label="Zavřít">×</button></div>
        <h2 id="ux-picker-h">Vyberte si úkol</h2>
        <div class="ux-cards"></div>
        <p class="mono ux-progline" id="ux-cards-line"></p>
        <p class="mono-s muted">Hvězdičky a nejlepší časy se ukládají jen ve vašem prohlížeči.</p>
      </div></div>`);
    document.body.appendChild(dlg);
    trapFocus(dlg);
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
      const b = h(`<button type="button" class="ux-card${m.id === this.ux.runner.m.id ? ' cur' : ''}">
        <span class="mono">Mise ${m.n}</span>
        <b>${m.title}</b>
        <span class="ux-stars">${starStr(p ? p.stars : 0)}${badgeStr(p)}</span>
        <span class="mono-s muted">${!p ? m.starsHint : p.stars && p.time != null ? 'nejlepší čas ' + fmt(p.time) : 'Splněno · hvězdičky za ruční přenesení'}</span>
      </button>`);
      b.addEventListener('click', () => { this.closePicker(); this.ux.selectMission(m.id); });
      this.cards.appendChild(b);
    }
    // chapter 11 (after the missions): the real arm (servo setup wizard) – visible from the start, never locked (teachers link it directly)
    const pr = progressOf(prog);
    const ch = h(`<a class="ux-card ux-chapter" href="nastaveni/">
        <span class="mono">Kapitola 11</span>
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
    this.mNum.textContent = `Mise ${m.n} / ${String(MISSIONS.length).padStart(2, '0')}`;
    this.mTitle.textContent = m.title;
    this.mDesc.textContent = m.desc;
    // credits for the scanned / authored objects (CC BY 4.0 needs attribution where they are shown)
    if (!this.credit) {
      this.credit = h(`<p class="mono-s muted ux-credit"><a href="objects/LICENSES.md" target="_blank" rel="noopener"></a></p>`);
      this.mDesc.parentNode.insertBefore(this.credit, this.mDesc.nextSibling);
    }
    this.credit.hidden = !m.objects;
    if (m.objects) this.credit.firstChild.textContent = m.credit || 'Objekty: NVIDIA SimReady (CC BY 4.0)';
    const s = prog ? prog.stars : 0;
    this.mStars.innerHTML = starStr(s) + badgeStr(prog, true);
    this.mStars.setAttribute('aria-label', s ? `Nejlepší hodnocení ${s} ze 3 hvězdiček` : prog ? 'Splněno, zatím bez hvězdiček' : 'Zatím nesplněno');
    document.title = `${m.title} – SO-101 v simulaci | printedrobotics.cz`;
    // hint ladder starts again with every mission; a win swaps "Poradit" for "Další mise →"
    if (m.id !== this.hintFor) { this.hintFor = m.id; this.hintLevel = 0; }
    this.offered = false;
    const won = !!this.ux.app.won, last = MISSIONS[MISSIONS.length - 1].id === m.id;
    this.mNext.hidden = !won || last;
    this.showHint();
  }

  // ---------- mode switch + smart controls ----------
  modeUI() {
    const mount = $('ux-mode'), ux = this.ux;
    // ONE mode switch. "Táhnout ruku" = IK target ball + physics pull of any part (links 'pull');
    // "Klouby" = joint sliders + grabbing a part turns only that joint (links 'joint'). See ux.setMode().
    mount.appendChild(h(`<div class="ux-seg ux-modeseg" role="radiogroup" aria-label="Způsob ovládání">
      <button type="button" role="radio" data-mode="smart" data-tip="Ruka sleduje modrou kouli (M)">Táhnout ruku</button>
      <button type="button" role="radio" data-mode="joints" data-tip="Každý kloub zvlášť (M)">Klouby</button>
    </div>`));
    // one-line contextual help + "?" with the full list (open by itself only in the first session)
    const hl = h(`<div class="ux-hl"><p class="ux-hlt" id="ux-hlt"></p>
      <button type="button" class="ux-q" id="ux-tips-b" aria-expanded="false" aria-controls="ux-tips" aria-label="Jak ovládat">?</button></div>`);
    mount.appendChild(hl);
    const tap = (s) => (ux.touch ? s.replace(/Klikněte/g, 'Klepněte').replace(/klikněte/g, 'klepněte').replace('Dvojklik', 'Dvojí klepnutí') : s);
    const tips = this.tipsBox = h(`<div class="ux-tipsbox" id="ux-tips" hidden>
      <ul class="ux-tips" data-for="smart">
        <li><i class="dot" aria-hidden="true"></i><span>Táhněte <b>modrou kouli</b>, ruka ji sleduje. Červená = tam nedosáhne.</span></li>
        <li><i aria-hidden="true">↕</i><span>Šipky nad a pod koulí mění výšku.</span></li>
        <li><i aria-hidden="true">⟳</i><span>Kroužek, kolečko myši nebo druhý prst otáčí zápěstím.</span></li>
        <li class="ux-tip-pull"><i aria-hidden="true">✥</i><span>Chyťte kteroukoli část ruky – povolí a nechá se vést jako skutečná.</span></li>
        <li><i aria-hidden="true">☝</i><span>${tap('Klikněte na předmět – ruka ho sama vezme. Pak klikněte, kam ho položit.')}</span></li>
      </ul>
      <ul class="ux-tips" data-for="joints">
        <li><i aria-hidden="true">⇆</i><span>Posuvníky natočí každý kloub zvlášť.</span></li>
        <li><i aria-hidden="true">✥</i><span>${tap('Chyťte díl ruky ve 3D a otočte jen jeho kloubem. Dvojklik ho vrátí do výchozí polohy.')}</span></li>
        <li><i aria-hidden="true">#</i><span>Klávesy 1–6 vyberou kloub, šipky ← → s ním otáčí.</span></li>
      </ul></div>`);
    mount.appendChild(tips);
    this.grabSeg = tips.querySelector('.ux-tip-pull');   // hidden with ?real=1 (no physics pull on armed hardware)
    const tb = $('ux-tips-b');
    const setTips = (on) => { tips.hidden = !on; tb.setAttribute('aria-expanded', String(on)); };
    tb.addEventListener('click', () => setTips(tips.hidden));
    setTips(!store.get('tips-seen', false) && !ux.TEST);
    store.set('tips-seen', true);
    // the one prominent action: the gripper (in the drawing mission the gripper holds the marker)
    mount.appendChild(h(`<button type="button" class="btn ux-gripbtn" id="ux-grip" aria-pressed="false" data-tip="Mezerník">Zavřít chapadlo <span class="kbd" aria-hidden="true">␣</span></button>`));
    const smart = this.smart = h(`<div class="ux-smart" id="ux-smart">
      <div class="ux-draw" id="ux-draw" hidden>
        <button type="button" class="btn btn-o" id="ux-pen" aria-pressed="false" data-tip="Nakreslete na stůl čáru, ruka ji projede (K)">Nakreslit prstem <span aria-hidden="true">✎</span></button>
        <div class="ux-row2">
          <button type="button" class="btn btn-o" id="ux-penup" aria-pressed="false" data-tip="Zvednout / položit fix (P)">Pero nahoru <span class="kbd" aria-hidden="true">P</span></button>
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
      <details class="ux-fine" id="ux-fine">
        <summary>Zápěstí a náklon chapadla</summary>
        <div class="jn"><label for="ux-roll">Rotace zápěstí</label><output for="ux-roll" id="ux-roll-o"></output>
          <input type="range" id="ux-roll" step="any"></div>
        <div class="jn"><label for="ux-pitch">Náklon chapadla</label><output for="ux-pitch" id="ux-pitch-o"></output>
          <input type="range" id="ux-pitch" min="0" max="90" step="1"></div>
        <p class="mono-s muted ux-ik">Úhly kloubů dopočítává inverzní kinematika (metoda tlumených nejmenších čtverců), stejně jako u skutečných robotů.</p>
      </details>
    </div>`);
    mount.appendChild(smart);
    this.seg = [...mount.querySelectorAll('[data-mode]')];
    for (const b of this.seg) b.addEventListener('click', () => this.ux.setMode(b.dataset.mode));
    this.gripBtn = $('ux-grip'); this.penBtn = $('ux-pen'); this.drawBox = $('ux-draw');
    $('ux-penup').addEventListener('click', () => this.ux.togglePenUp());
    $('ux-drawview').addEventListener('click', () => {
      const ux = this.ux, top = ux.cameras.view === 'look';
      if (top) ux.cameras.set('orbit'); else ux.cameras.set('orbit', ux.runner.m.look);
      $('ux-drawview').textContent = top ? 'Pohled shora' : '3D pohled';
    });
    for (const b of this.drawBox.querySelectorAll('[data-h]')) b.addEventListener('click', () => this.ux.setDrawHelp(+b.dataset.h));
    this.gripBtn.addEventListener('click', () => this.ux.toggleGrip());
    this.penBtn.addEventListener('click', () => this.ux.togglePen());
    const roll = this.roll = $('ux-roll'), pitch = this.pitch = $('ux-pitch');
    const [lo, hi] = this.ux.ctl.kin.c.range[4];
    roll.min = lo; roll.max = hi;
    roll.addEventListener('input', () => this.ux.setRoll(+roll.value));
    pitch.addEventListener('input', () => this.ux.setPitch(+pitch.value * Math.PI / 180));
  }

  /** drawing tools only in the drawing mission; the mission's own tip lives in the hint ladder ("Poradit") */
  showTips(m) {
    this.drawBox.hidden = !m.draw;
    this.gripBtn.hidden = !!m.draw;
    if (!m.draw) this.gripOpen = undefined;   // let tick() rewrite the phone button label
    if (m.draw) { this.showDraw(this.ux); $('ux-drawview').textContent = '3D pohled'; }
    this.showHelpLine();
  }
  showHelpLine() {
    const ux = this.ux, smart = ux.mode === 'smart';
    const t = !smart ? 'Posuvníky natočí každý kloub zvlášť.'
      : ux.runner.m.draw ? 'Táhněte po papíře – fix kreslí.' : 'Táhněte modrou kouli – ruka ji sleduje.';
    const el = $('ux-hlt'); if (el.textContent !== t) el.textContent = t;
    for (const u of this.tipsBox.querySelectorAll('[data-for]')) u.hidden = u.dataset.for !== (smart ? 'smart' : 'joints');
  }

  /** grab behaviour follows the mode switch now (no own control); kept for ux.js / tests */
  showGrabMode() {}

  showDraw(ux) {
    const d = ux.draw, b = $('ux-penup'), q = $('ux-qgrip');
    if (q) { q.textContent = d.penDown ? 'Pero nahoru' : 'Pero dolů'; q.setAttribute('aria-pressed', String(!d.penDown)); }
    b.firstChild.textContent = d.penDown ? 'Pero nahoru ' : 'Pero dolů ';
    b.setAttribute('aria-pressed', String(!d.penDown));
    for (const x of this.drawBox.querySelectorAll('[data-h]')) x.setAttribute('aria-checked', String(+x.dataset.h === d.help));
  }

  showMode(mode) {
    for (const b of this.seg) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
    this.smart.hidden = mode !== 'smart';
    $('joints').hidden = mode === 'smart';
    document.body.classList.toggle('ux-smartmode', mode === 'smart');
    this.showHelpLine();
  }
  showGrip(open) {
    this.gripBtn.firstChild.textContent = open ? 'Zavřít chapadlo ' : 'Otevřít chapadlo ';
    this.gripBtn.setAttribute('aria-pressed', String(!open));
    const q = $('ux-qgrip');
    if (q && !this.ux.runner.m.draw) { q.textContent = open ? 'Zavřít chapadlo' : 'Otevřít chapadlo'; q.setAttribute('aria-pressed', String(!open)); }
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
    if (on && reveal && this.mq.matches) { this.selectTab('tools'); if (this.snap < 1) this.setSnap(1); }
  }
  /** "Připojit AI" (src/agent/index.js mounts its box right after #ux-teach): only styled as a tool row here */
  mountAI() {
    const box = document.querySelector('.ai-box'), teach = $('ux-teach');
    if (!box || !teach) return;
    if (box.previousElementSibling !== teach) teach.after(box);
    box.classList.add('ux-tool');
    // the agent's "Zeptej se AI na tuto misi" link belongs to the mission card's action row (not the phone head)
    const ask = $('ai-ask-mission'), row = this.mBox.querySelector('.ux-mrow');
    if (ask && row) row.after(ask);
  }

  // ---------- stage overlays ----------
  stageUI() {
    const st = this.stage;
    const bar = this.toolbar = h(`<div class="ux-tools" role="toolbar" aria-label="Pohled a nastavení">
      <button type="button" class="ux-tb" id="ux-view" aria-label="Přepnout pohled (C)" data-tip="Přepnout pohled (C)">${I.cam}<span class="ux-tbl" id="ux-view-l">Volný</span></button>
      <button type="button" class="ux-tb" id="ux-wrist" aria-pressed="false" aria-label="Kamera na zápěstí" data-tip="Kamera na zápěstí (V)">${I.wrist}<span class="ux-tbl">Zápěstí</span></button>
      <button type="button" class="ux-tb" id="ux-parts" aria-pressed="false" aria-label="Rozložený pohled" data-tip="Rozložený pohled – z čeho se skládá (X)">${I.parts}<span class="ux-tbl">Díly</span></button>
      <button type="button" class="ux-tb" id="ux-set" aria-expanded="false" aria-controls="ux-setpop" aria-label="Nastavení" data-tip="Barva, detail, zvuk, zkratky">${I.gear}<span class="ux-tbl">Nastavení</span></button>
    </div>`);
    st.appendChild(bar);
    // settings popover: filament colour, model detail (qualityUI), sound, shortcuts
    const pop = this.setPop = h(`<div class="ux-pop" id="ux-setpop" role="dialog" aria-modal="false" aria-labelledby="ux-set-h" hidden>
      <div class="ux-modal-top"><p class="mono" id="ux-set-h">Nastavení</p><button type="button" class="ux-x" aria-label="Zavřít nastavení">×</button></div>
      <button type="button" class="btn btn-o ux-setbtn" id="ux-sound" aria-pressed="false">${I.snd}<span>Zvuk</span> <span class="kbd" aria-hidden="true">S</span></button>
      <button type="button" class="btn btn-o ux-setbtn" id="ux-help">${I.help}<span>Klávesové zkratky a nápověda</span> <span class="kbd" aria-hidden="true">?</span></button>
    </div>`);
    st.appendChild(pop);
    const colors = document.querySelector('.colors');
    if (colors) pop.insertBefore(colors, $('ux-sound'));
    pop.querySelector('.ux-x').addEventListener('click', () => this.closeSet(true));
    $('ux-set').addEventListener('click', () => (pop.hidden ? this.openSet() : this.closeSet(true)));
    document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !$('ux-set').contains(e.target)) this.closeSet(false); }, true);
    $('ux-view').addEventListener('click', () => this.ux.cycleView());
    $('ux-wrist').addEventListener('click', () => this.ux.setWrist(!this.ux.cameras.wristOn));
    $('ux-sound').addEventListener('click', () => this.ux.setSound(!this.ux.sound.on));
    $('ux-help').addEventListener('click', () => { this.closeSet(false); this.openHelp(); });
    $('ux-parts').addEventListener('click', () => this.ux.toggleExplode());

    this.pip = h(`<div class="ux-pip" hidden aria-hidden="true"><span class="mono-s">Kamera na zápěstí</span></div>`);
    st.appendChild(this.pip);
    this.toastEl = h(`<div class="ux-toast" role="status" aria-live="polite" hidden></div>`);
    st.appendChild(this.toastEl);
    this.recBadge = h(`<div class="ux-recb mono" hidden><i aria-hidden="true"></i>REC <span id="ux-rec-t">0:00</span></div>`);
    st.appendChild(this.recBadge);
    this.playBar = h(`<div class="ux-playbar" hidden><span class="mono-s">Přehrávám ukázku</span><b><i id="ux-play-p"></i></b></div>`);
    st.appendChild(this.playBar);
    this.timer = h(`<span class="ux-timer mono" id="ux-timer" aria-hidden="true">0:00</span>`);
    $('hud').appendChild(this.timer);
    this.penHint = h(`<p class="ux-penhint mono-s" hidden>Nakreslete čáru po stole prstem nebo myší – ruka ji zopakuje</p>`);
    st.appendChild(this.penHint);
  }
  /** friend's record from a challenge link, shown in the HUD until the page is left */
  showChallenge(t) {
    if (!this.chal) { this.chal = h(`<span class="ux-chal mono"></span>`); $('hud').appendChild(this.chal); }
    this.chal.textContent = t;
  }
  showView(v) { $('ux-view-l').textContent = VIEW_LABELS[v].replace('Volný pohled', 'Volný'); }
  showWrist(on) { $('ux-wrist').setAttribute('aria-pressed', String(on)); this.pip.hidden = !on; this.pipCache = null; }
  showSound(on) { $('ux-sound').setAttribute('aria-pressed', String(on)); $('ux-sound').classList.toggle('muted', !on); }
  openSet() {
    this.setPop.hidden = false; $('ux-set').setAttribute('aria-expanded', 'true');
    const f = this.setPop.querySelector('[aria-checked=true], button:not(.ux-x)'); if (f) f.focus();
  }
  closeSet(refocus) {
    if (this.setPop.hidden) return;
    this.setPop.hidden = true; $('ux-set').setAttribute('aria-expanded', 'false');
    if (refocus) $('ux-set').focus({ preventScroll: true });
  }
  popOpen() { return !this.setPop.hidden; }
  showExplode(on) { $('ux-parts').setAttribute('aria-pressed', String(on)); }

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
    const hint = !!this.offered && !r.won && !ux.ctl.busy() && !ux.pending && !ux.teach.replaying && !ux.explode.on;
    if (hint === this.hintBtn.hidden) this.hintBtn.hidden = !hint;
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

  // ---------- win dialog ----------
  winUI() {
    const win = $('win');
    this.winStars = h(`<div class="ux-winstars" aria-hidden="true"><span>★</span><span>★</span><span>★</span></div>`);
    win.insertBefore(this.winStars, win.querySelector('h2'));
    this.winStats = h(`<p class="mono ux-winstats"></p>`);
    win.insertBefore(this.winStats, win.querySelector('.win-b'));
    this.nextBtn = h(`<button type="button" class="btn btn-o" id="ux-next">Další mise <span aria-hidden="true">→</span></button>`);
    win.querySelector('.win-b').appendChild(this.nextBtn);
    this.nextBtn.addEventListener('click', () => this.ux.nextMission());
    // staged bridge (growth panel B): first win → practice by hand, 2nd → how it is built, 3rd+ → the real arm
    const wb = win.querySelector('.win-b');
    this.guideBtn = h(`<button type="button" class="btn btn-o" id="ux-wguide">Teď ručně <span aria-hidden="true">→</span></button>`);
    this.exBtn = h(`<button type="button" class="btn btn-o" id="ux-wexplode">Z čeho se ruka skládá <span aria-hidden="true">→</span></button>`);
    this.shareBtn = h(`<button type="button" class="btn btn-o" id="ux-wshare">Sdílet rekord <span aria-hidden="true">↗</span></button>`);
    this.aiLogBtn = h(`<button type="button" class="btn btn-o" id="ux-wailog">Záznam AI <span aria-hidden="true">→</span></button>`);
    for (const b of [this.guideBtn, this.exBtn, this.shareBtn, this.aiLogBtn]) { b.hidden = true; wb.appendChild(b); }
    this.aiLogBtn.addEventListener('click', () => this.openAILog());
    this.guideBtn.addEventListener('click', () => this.ux.onboarding.afterWin());
    this.exBtn.addEventListener('click', () => { $('win').hidden = true; if (!this.ux.explode.on) this.ux.toggleExplode(); });
    this.shareBtn.addEventListener('click', () => this.ux.shareRecord());
    this.winText = win.querySelector('p:not(.mono)');
    this.winH = $('win-h');
    this.defaultWin = this.winText.textContent;
  }
  /** by: null = the visitor, 'assisted' = "Ukázat řešení", 'replay' = a recorded demonstration (no stars then). */
  showWin(m, res, best, isNew, by) {
    const again = document.getElementById('again');
    if (this.mq.matches) { this.selectTab('mission'); this.setSnap(0); }   // the win card sits right above the sheet
    this.winStars.hidden = !!by;
    if (by) {
      const n = this.ux.aiSteps || 0;
      this.winH.textContent = by === 'ai' ? `Vyřešila to AI v ${n} ${n === 1 ? 'kroku' : 'krocích'} — zkusíte to sami?`
        : by === 'assisted' ? 'Tohle zvládla ruka sama.' : 'Ukázka splnila misi.';
      this.winStats.textContent = `Čas ${fmt(res.time)} · hvězdičky se počítají jen vám`;
      this.winText.textContent = by === 'ai' ? 'V záznamu AI uvidíte každý její krok. Pak zkuste misi vyřešit sami.'
        : by === 'assisted' ? 'Řešení ukázala ruka sama – zkuste to teď vy. Stačí kliknout na kostku a pak na misku.'
        : 'Přesně takhle se skutečná SO-101 učí: z nahraných ukázek. Zkuste misi vyřešit sami.';
      again.firstChild.textContent = 'Teď to zkuste vy ';
      again.classList.add('btn-act'); again.classList.remove('btn-o');
    } else if (res.kind === 'auto') {
      // the autopilot (click-to-grab or a hint rung) carried it: done, unlocks the next mission, no stars
      this.winStars.hidden = true;
      this.winH.textContent = m.id === 'bowl' ? 'Splněno! Kostka je v misce.' : 'Splněno! ' + m.short + '.';
      this.winStats.textContent = `Čas ${fmt(res.time)} · hvězdičky jsou za ruční přenesení`;
      this.winText.textContent = 'Přenášela ruka podle vašeho kliknutí. Hvězdičky a odznak ✋ získáte, když předmět přenesete sami koulí, odznak ⚙ v režimu Klouby.';
      again.firstChild.textContent = 'Zkusit ručně ';
      again.classList.remove('btn-act'); again.classList.add('btn-o');
    } else {
      this.winH.textContent = m.id === 'bowl' ? 'Hotovo! Kostka je v misce.' : 'Hotovo! ' + m.short + ' zvládnuto.';
      const sp = this.winStars.children;
      for (let i = 0; i < 3; i++) { sp[i].className = i < res.stars ? 'on' : ''; sp[i].style.animationDelay = (0.15 + i * 0.18) + 's'; }
      this.winStars.setAttribute('aria-label', `${res.stars} ze 3 hvězdiček`);
      let st = `Čas ${fmt(res.time)}`;
      if (res.prec && m.precText) st += ` · ${m.precText(res.prec)}`;
      else if (res.prec) st += ` · přesnost ${(res.prec * 1000).toFixed(1)} mm`;
      st += ` · ${'★'.repeat(res.stars)}${'☆'.repeat(3 - res.stars)}`;
      if (res.badges && res.badges.drag) st += ' · ✋ ručně';
      if (res.badges && res.badges.joints) st += ' · ⚙ klouby';
      if (isNew) st += ' · nový rekord';
      else if (best && best.stars && best.time != null) st += ` · rekord ${fmt(best.time)}`;
      this.winStats.textContent = st;
      this.winText.textContent = res.stars < 3 && m.advice ? m.advice : this.defaultWin;
      again.firstChild.textContent = 'Zkusit znovu ';
      again.classList.remove('btn-act'); again.classList.add('btn-o');
    }
    const last = MISSIONS[MISSIONS.length - 1].id === m.id;
    this.nextBtn.hidden = last;
  }

  /**
   * Which buttons the win card shows, in order; the first is the primary one.
   *   by (assisted / replay): "Teď to zkuste vy", Další mise · guided first win: "Teď ručně", Další mise
   *   own win 2: Další mise, "Z čeho se ruka skládá" · own win 3+: Další mise, "Chci skutečnou SO-101"
   *   a 3 ★ own win also offers "Sdílet rekord". No purchase button before the 3rd win.
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
    const wb = $('win').querySelector('.win-b');
    for (const k of Object.keys(ids)) { const b = ids[k]; b.hidden = !order.includes(k); b.classList.remove('ux-primary', 'ux-full', 'btn-act'); if (k !== 'cta') b.classList.add('btn-o'); }
    order.forEach((k, i) => {
      const b = ids[k]; wb.appendChild(b);
      if (i === 0) { b.classList.add('ux-primary', 'btn-act'); b.classList.remove('btn-o'); }
    });
    if ((order.length - 1) % 2 === 1) ids[order[order.length - 1]].classList.add('ux-full');   // odd secondary count
    if (!order.includes('cta')) ids.cta.classList.remove('btn-act'); else if (order[0] !== 'cta') { ids.cta.classList.remove('btn-act'); ids.cta.classList.add('btn-o'); }
    return order;
  }

  /** "Záznam AI" on the win card: open the "Připojit AI" panel (its own log is inside) and show the log */
  openAILog() {
    if (this.mq.matches) { this.selectTab('tools'); this.setSnap(2); }
    const so = window.so101, go = () => { const l = document.querySelector('.ai-logbox'); if (l) { l.scrollIntoView({ block: 'nearest' }); const o = $('ai-open'); if (o) o.focus({ preventScroll: true }); } };
    if (so && so.openPanel) Promise.resolve(so.openPanel()).then(go, go); else go();
  }

  // ---------- help ----------
  helpUI() {
    const keys = [
      ['Myš / prst', 'tažením otáčíte pohled, kolečkem či dvěma prsty přibližujete'],
      ['Modrá koule', 'tažením vedete ruku (Táhnout ruku)'],
      ['Klik na kostku', 'ruka ji vezme; klik na misku nebo stůl ji položí'],
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
      ['S', 'zvuk'],
      ['Esc', 'zrušit pohyb, zavřít okno']
    ];
    const dlg = this.help = h(`<div class="ux-modal" id="ux-helpdlg" hidden role="dialog" aria-modal="true" aria-labelledby="ux-help-h">
      <div class="ux-modal-in">
        <div class="ux-modal-top"><p class="mono">Nápověda</p><button type="button" class="ux-x" aria-label="Zavřít">×</button></div>
        <h2 id="ux-help-h">Ovládání a zkratky</h2>
        <dl class="ux-keys">${keys.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        <label class="ux-check"><input type="checkbox" id="ux-keys-on"> Zkratky jednou klávesou (písmena, číslice, mezerník) fungují kdekoli na stránce. Vypnuté fungují jen se zaměřenou 3D scénou.</label>
        <div class="ux-row2"><button type="button" class="btn btn-o" id="ux-tour">Spustit průvodce znovu</button></div>
      </div></div>`);
    document.body.appendChild(dlg);
    trapFocus(dlg);
    dlg.querySelector('.ux-x').addEventListener('click', () => this.closeHelp());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) this.closeHelp(); });
    const ko = $('ux-keys-on');
    ko.checked = this.ux.keysOn;
    ko.addEventListener('change', () => { this.ux.keysOn = ko.checked; store.set('keys-on', ko.checked); });
    $('ux-tour').addEventListener('click', () => { this.closeHelp(); this.ux.onboarding.start(true); });
  }
  openHelp() { this.lastFocus = document.activeElement; this.help.hidden = false; this.help.querySelector('.ux-x').focus(); }
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
