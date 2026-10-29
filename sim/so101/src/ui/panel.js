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
  parts: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 17.5h7M17.5 14v7"/></svg>'
};

export class Panel {
  constructor(ux) {
    this.ux = ux;
    this.stage = document.querySelector('.stage');
    this.missionUI();
    this.modeUI();
    this.teachUI();
    this.stageUI();
    this.winUI();
    this.helpUI();
    this.flowsUI();
  }

  // ---------- usability round 1: reachable help, phone action row, layout ----------
  flowsUI() {
    const ux = this.ux;
    // "Poradit" in the HUD: appears after 20 s without success (P1-1)
    this.hintBtn = h(`<button type="button" class="ux-hintbtn" id="ux-hint" hidden>Poradit <span aria-hidden="true">▶</span></button>`);
    $('hud').appendChild(this.hintBtn);
    this.hintBtn.addEventListener('click', () => ux.startDemo());
    // Domů / Znovu / Ukázat řešení right under the mode switch (was below the fold)
    const rowb = document.querySelector('.row-b'), mode = $('ux-mode');
    if (rowb && mode) mode.insertBefore(rowb, this.smart);
    // how grabbing a part of the arm behaves: physics pull (default) or one joint at a time
    const gm = this.grabSeg = h(`<div class="ux-grabmode">
      <p class="mono" id="ux-grab-l">Uchopení části ruky</p>
      <div class="ux-seg ux-seg-s" role="radiogroup" aria-labelledby="ux-grab-l">
        <button type="button" role="radio" data-g="pull" data-tip="Ruka povolí a celá se nechá vést – jako skutečná">Tahem</button>
        <button type="button" role="radio" data-g="joint" data-tip="Otáčí se jen uchopeným kloubem">Kloub po kloubu</button>
      </div></div>`);
    if (mode) mode.insertBefore(gm, this.smart);
    for (const b of gm.querySelectorAll('[data-g]')) b.addEventListener('click', () => { ux.links.setMode(b.dataset.g); this.showGrabMode(ux.links.mode); });
    this.showGrabMode(ux.links ? ux.links.mode : 'pull');
    if (ux.links && ux.links.realArmed) gm.hidden = true;
    // phone: HUD strip + action row under the stage, sticky with it (P1-3)
    const under = this.under = h(`<div class="ux-under">
      <div class="ux-qrow">
        <button type="button" class="btn btn-o" id="ux-qgrip">Otevřít chapadlo</button>
        <button type="button" class="btn btn-o" id="ux-qhome">Domů <span aria-hidden="true">⌂</span></button>
        <button type="button" class="btn btn-o" id="ux-qhint">Poradit <span aria-hidden="true">▶</span></button>
      </div></div>`);
    this.stage.parentNode.insertBefore(under, this.stage.nextSibling);
    // in the drawing mission the gripper holds the marker: this button lifts / lowers the pen instead
    $('ux-qgrip').addEventListener('click', () => (ux.runner.m.draw ? ux.togglePenUp() : ux.toggleGrip()));
    $('ux-qhome').addEventListener('click', () => { ux.ctl.cancel(); ux.pending = null; ux.app.goHome(); ux.ctl.syncFromCtrl(); });
    $('ux-qhint').addEventListener('click', () => ux.startDemo());
    const mq = matchMedia('(max-width:860px)'), hud = $('hud');
    const place = () => { if (mq.matches) under.insertBefore(hud, under.firstChild); else if (hud.parentNode !== this.stage) this.stage.appendChild(hud); };
    place(); mq.addEventListener ? mq.addEventListener('change', place) : mq.addListener(place);
    // maker path: exploded view from the panel (P1-6) and the servo setup link higher up (P2-12)
    const mbox = document.querySelector('.mission');
    const ex = h(`<button type="button" class="ux-link ux-exlink" id="ux-exlink">Z čeho se SO-101 skládá <span aria-hidden="true">→</span></button>`);
    mbox.appendChild(ex);
    ex.addEventListener('click', () => { if (!ux.explode.on) ux.toggleExplode(); if (mq.matches) scrollTo({ top: 0, behavior: ux.reduced ? 'auto' : 'smooth' }); });
    const setup = document.querySelector('.panel a[href="nastaveni/"]'), teach = $('ux-teach');
    if (setup && teach) {
      const wrap = h(`<div class="ux-setup"><p class="mono">Skutečná ruka</p></div>`);
      teach.parentNode.insertBefore(wrap, teach.nextSibling);
      wrap.appendChild(setup);
      wrap.appendChild(h(`<p class="mono-s muted">ID serv · kalibrace · test · diagnostika – nanečisto, bez hardwaru</p>`));
    }
  }

  // ---------- mission header + picker ----------
  missionUI() {
    const box = document.querySelector('.mission');
    this.mNum = box.querySelector('p.mono');
    this.mTitle = box.querySelector('h1');
    this.mDesc = box.querySelector('p.ink2');
    const row = h(`<div class="ux-mrow">
      <span class="ux-stars" id="ux-mstars" aria-label=""></span>
      <button type="button" class="ux-link" id="ux-pick-mission" aria-haspopup="dialog">Vybrat misi <span aria-hidden="true">▾</span></button>
    </div>`);
    box.appendChild(row);
    this.progLine = h(`<p class="mono ux-progline" id="ux-progline"></p>`);
    box.appendChild(this.progLine);
    this.mStars = row.querySelector('#ux-mstars');
    row.querySelector('button').addEventListener('click', () => this.openPicker());

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
        <span class="ux-stars">${starStr(p ? p.stars : 0)}</span>
        <span class="mono-s muted">${p ? 'nejlepší čas ' + fmt(p.time) : m.starsHint}</span>
      </button>`);
      b.addEventListener('click', () => { this.closePicker(); this.ux.selectMission(m.id); });
      this.cards.appendChild(b);
    }
    // chapter 11 (after the missions): the real arm (servo setup wizard) – visible from the start, never locked (teachers link it directly)
    const pr = progressOf(prog);
    const ch = h(`<a class="ux-card ux-chapter" href="nastaveni/">
        <span class="mono">Kapitola 11</span>
        <b>Skutečná ruka</b>
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
    this.mStars.innerHTML = starStr(s);
    this.mStars.setAttribute('aria-label', s ? `Nejlepší hodnocení ${s} ze 3 hvězdiček` : 'Zatím nesplněno');
    document.title = `${m.title} – SO-101 v simulaci | printedrobotics.cz`;
    const pr = progressOf(this.ux.progress);
    const nx = MISSIONS.find((x) => !(this.ux.progress[x.id]) && x.id !== m.id);
    this.progLine.textContent = progressText(pr) + (nx ? ` · další: ${nx.title}` : '');
  }

  // ---------- mode switch + smart controls ----------
  modeUI() {
    const mount = $('ux-mode');
    mount.appendChild(h(`<div class="ux-seg" role="radiogroup" aria-label="Způsob ovládání">
      <button type="button" role="radio" data-mode="smart" data-tip="Ruka sleduje modrou kouli (M)">Chytrý pohyb</button>
      <button type="button" role="radio" data-mode="joints" data-tip="Každý kloub zvlášť posuvníkem (M)">Klouby</button>
    </div>`));
    const smart = this.smart = h(`<div class="ux-smart" id="ux-smart">
      <ul class="ux-tips">
        <li><i class="dot" aria-hidden="true"></i><span>Táhněte <b>modrou kouli</b>, ruka ji sleduje. Červená = tam nedosáhne.</span></li>
        <li><i aria-hidden="true">↕</i><span>Šipky nad a pod koulí mění výšku.</span></li>
        <li><i aria-hidden="true">⟳</i><span>Kroužek, kolečko myši nebo druhý prst otáčí zápěstím.</span></li>
        <li><i aria-hidden="true">☝</i><span>Klikněte na <b>kostku</b> – ruka ji sama vezme. Pak klikněte na <b>misku</b>.</span></li>
      </ul>
      <div class="ux-row2">
        <button type="button" class="btn btn-o" id="ux-grip" aria-pressed="false" data-tip="Mezerník">Zavřít chapadlo <span class="kbd" aria-hidden="true">␣</span></button>
        <button type="button" class="btn btn-o" id="ux-pen" aria-pressed="false" data-tip="Nakreslete na stůl čáru, ruka ji projede (K)">Nakreslit prstem <span aria-hidden="true">✎</span></button>
      </div>
      <div class="ux-draw" id="ux-draw" hidden>
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
      <div class="jn"><label for="ux-roll">Rotace zápěstí</label><output for="ux-roll" id="ux-roll-o"></output>
        <input type="range" id="ux-roll" step="any"></div>
      <div class="jn"><label for="ux-pitch">Náklon chapadla</label><output for="ux-pitch" id="ux-pitch-o"></output>
        <input type="range" id="ux-pitch" min="0" max="90" step="1"></div>
      <p class="mono-s muted ux-ik">Úhly kloubů dopočítává inverzní kinematika (metoda tlumených nejmenších čtverců), stejně jako u skutečných robotů.</p>
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

  /** last smart-move tip follows the mission (P2-1); "Klepněte" on touch */
  showTips(m) {
    const li = this.smart.querySelector('.ux-tips li:last-child span');
    let t = m.tip || '';
    if (this.ux.touch) t = t.replace(/Klikněte/g, 'Klepněte').replace(/myší nebo prstem/g, 'prstem');
    if (li && li.innerHTML !== t) li.innerHTML = t;
    this.drawBox.hidden = !m.draw;
    if (!m.draw) this.gripOpen = undefined;   // let tick() rewrite the phone button label
    if (m.draw) { this.showDraw(this.ux); $('ux-drawview').textContent = '3D pohled'; }
  }

  showGrabMode(m) { if (this.grabSeg) for (const b of this.grabSeg.querySelectorAll('[data-g]')) b.setAttribute('aria-checked', String(b.dataset.g === m)); }

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
    mount.appendChild(h(`<section class="ux-teach" aria-labelledby="ux-teach-h">
      <p class="mono" id="ux-teach-h">Učení ukázkou</p>
      <p class="ink2">Nahrajte, jak úkol řešíte, a nechte ruku pohyb zopakovat. <b>Tohle je princip učení napodobováním:</b> skutečná SO-101 se z desítek takových ukázek (nahraných ovládací rukou) naučí úkol sama, třeba metodou ACT v knihovně LeRobot.</p>
      <div class="ux-row3">
        <button type="button" class="btn btn-o" id="ux-rec" aria-pressed="false" data-tip="Nahrávání (T)"><span class="rec" aria-hidden="true"></span><span class="l">Nahrát</span></button>
        <button type="button" class="btn btn-o" id="ux-play" disabled data-tip="Přehrát ukázku (L)">Přehrát <span aria-hidden="true">▶</span></button>
        <button type="button" class="btn btn-o" id="ux-loop" aria-pressed="false" disabled data-tip="Přehrávat dokola">Smyčka <span aria-hidden="true">↻</span></button>
      </div>
      <div class="ux-row3 ux-teach2">
        <button type="button" class="btn btn-o" id="ux-trim" disabled data-tip="Odstraní klid na začátku a konci">Oříznout</button>
        <button type="button" class="btn btn-o" id="ux-del" disabled>Smazat</button>
        <button type="button" class="btn btn-o" id="ux-import" data-tip="Ukázku od učitele nebo z jiného počítače">Nahrát <span aria-hidden="true">↑</span></button>
      </div>
      <input type="file" id="ux-import-f" accept="application/json,.json" hidden>
      <button type="button" class="ux-link" id="ux-share" disabled>Sdílet ukázku odkazem (třeba studentům) <span aria-hidden="true">🔗</span></button>
      <button type="button" class="ux-link" id="ux-export" disabled>Stáhnout ukázku jako JSON (formát podobný LeRobot) <span aria-hidden="true">⤓</span></button>
      <p class="mono-s muted" id="ux-teach-s" aria-live="polite">Zatím žádná ukázka.</p>
    </section>`));
    $('ux-rec').addEventListener('click', () => this.ux.toggleRec());
    $('ux-play').addEventListener('click', () => this.ux.togglePlay());
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
    $('ux-import').disabled = t.recording;
    play.firstChild.textContent = t.replaying ? 'Stop ' : 'Přehrát ';
    play.querySelector('span').textContent = t.replaying ? '■' : '▶';
    loop.setAttribute('aria-pressed', String(t.loop));
    s.textContent = t.recording ? 'Nahrávám… pohybujte rukou.' : t.replaying ? 'Přehrávám ukázku.'
      : t.demo ? `${t.shared ? 'Sdílená ukázka' : t.restored ? 'Ukázka z minula' : 'Ukázka'}: ${fmt(t.duration())}, ${t.demo.t.length} snímků (mise ${t.demo.mission.n}).` : 'Zatím žádná ukázka.';
    this.recBadge.hidden = !t.recording; this.playBar.hidden = !t.replaying;
    this.stage.classList.toggle('ux-replaying', t.replaying);
  }

  // ---------- stage overlays ----------
  stageUI() {
    const st = this.stage;
    const bar = this.toolbar = h(`<div class="ux-tools" role="toolbar" aria-label="Pohled a zvuk">
      <button type="button" class="ux-tb" id="ux-view" aria-label="Přepnout pohled (C)" data-tip="Přepnout pohled (C)">${I.cam}<span class="ux-tbl" id="ux-view-l">Volný</span></button>
      <button type="button" class="ux-tb" id="ux-wrist" aria-pressed="false" aria-label="Kamera na zápěstí" data-tip="Kamera na zápěstí (V)">${I.wrist}<span class="ux-tbl">Zápěstí</span></button>
      <button type="button" class="ux-tb" id="ux-parts" aria-pressed="false" aria-label="Rozložený pohled" data-tip="Rozložený pohled – z čeho se skládá (X)">${I.parts}<span class="ux-tbl">Díly</span></button>
      <button type="button" class="ux-tb" id="ux-sound" aria-pressed="false" aria-label="Zvuk" data-tip="Zvuk (S)">${I.snd}<span class="ux-tbl">Zvuk</span></button>
      <button type="button" class="ux-tb" id="ux-help" aria-label="Klávesové zkratky a nápověda" data-tip="Nápověda (?)">${I.help}<span class="ux-tbl">Zkratky</span></button>
    </div>`);
    st.appendChild(bar);
    $('ux-view').addEventListener('click', () => this.ux.cycleView());
    $('ux-wrist').addEventListener('click', () => this.ux.setWrist(!this.ux.cameras.wristOn));
    $('ux-sound').addEventListener('click', () => this.ux.setSound(!this.ux.sound.on));
    $('ux-help').addEventListener('click', () => this.openHelp());
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

  toast(msg, kind) {
    const t = this.toastEl;
    t.textContent = msg; t.className = 'ux-toast' + (kind ? ' ' + kind : ''); t.hidden = false;
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 2600 : 2200);
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
    const hint = r.time > 20 && !r.won && !ux.ctl.busy() && !ux.pending && !ux.teach.replaying && !ux.explode.on;
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
    for (const b of [this.guideBtn, this.exBtn, this.shareBtn]) { b.hidden = true; wb.appendChild(b); }
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
    this.winStars.hidden = !!by;
    if (by) {
      this.winH.textContent = by === 'assisted' ? 'Tohle zvládla ruka sama.' : 'Ukázka splnila misi.';
      this.winStats.textContent = `Čas ${fmt(res.time)} · hvězdičky se počítají jen vám`;
      this.winText.textContent = by === 'assisted' ? 'Řešení ukázala ruka sama – zkuste to teď vy. Stačí kliknout na kostku a pak na misku.'
        : 'Přesně takhle se skutečná SO-101 učí: z nahraných ukázek. Zkuste misi vyřešit sami.';
      again.firstChild.textContent = 'Teď to zkuste vy ';
      again.classList.add('btn-act'); again.classList.remove('btn-o');
    } else {
      this.winH.textContent = m.id === 'bowl' ? 'Hotovo! Kostka je v misce.' : 'Hotovo! ' + m.short + ' zvládnuto.';
      const sp = this.winStars.children;
      for (let i = 0; i < 3; i++) { sp[i].className = i < res.stars ? 'on' : ''; sp[i].style.animationDelay = (0.15 + i * 0.18) + 's'; }
      this.winStars.setAttribute('aria-label', `${res.stars} ze 3 hvězdiček`);
      let st = `Čas ${fmt(res.time)}`;
      if (res.prec && m.precText) st += ` · ${m.precText(res.prec)}`;
      else if (res.prec) st += ` · přesnost ${(res.prec * 1000).toFixed(1)} mm`;
      st += ` · ${'★'.repeat(res.stars)}${'☆'.repeat(3 - res.stars)}`;
      if (isNew) st += ' · nový rekord';
      else if (best) st += ` · rekord ${fmt(best.time)}`;
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
    const ids = { cta: $('cta'), again: $('again'), next: this.nextBtn, guide: this.guideBtn, ex: this.exBtn, share: this.shareBtn };
    const last = MISSIONS[MISSIONS.length - 1].id === m.id;
    let order;
    if (by) order = ['again', 'next'];
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

  // ---------- help ----------
  helpUI() {
    const keys = [
      ['Myš / prst', 'tažením otáčíte pohled, kolečkem či dvěma prsty přibližujete'],
      ['Modrá koule', 'tažením vedete ruku (chytrý pohyb)'],
      ['Klik na kostku', 'ruka ji vezme; klik na misku nebo stůl ji položí'],
      ['←  →  ↑  ↓', 'posun cíle po stole'],
      ['PgUp / PgDn', 'výška cíle (také Q / E)'],
      ['A / D', 'rotace zápěstí'],
      ['Mezerník / G', 'otevřít / zavřít chapadlo'],
      ['M', 'chytrý pohyb ↔ klouby'],
      ['K', 'nakreslit cestu prstem – ruka ji projede'],
      ['P', 'kreslení: pero nahoru / dolů'],
      ['1 – 6', 'vybrat kloub (pak ← → otáčí, Esc zruší)'],
      ['Shift + 1 – 5', 'výběr mise'],
      ['Část ruky', 'tahem ruku vedete (celá povolí); v režimu Kloub po kloubu otočíte jen tím kloubem, dvojklik = výchozí poloha'],
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
function starStr(n) { let s = ''; for (let i = 0; i < 3; i++) s += `<i class="${i < n ? 'on' : ''}">★</i>`; return s; }
