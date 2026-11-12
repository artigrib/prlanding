// Mission 12 "Třídění odpadu II: Naučte robota" (waste_teach) in the page: the three phases Ukázky → Naučit → Ověřit,
// the policy chip, the action-bar button (Naučit / Spustit politiku / Ukázky), the Nástroje → Politika section
// (episodes with delete, coverage, Naučit, Spustit, the policy select, export, the last run's analysis) and the
// mission's result card. The policy itself is src/policy/knn.js (pure) run by src/policy/run.js (the planner moves
// the arm). Formal Czech ("vy"); English through src/i18n/en.js.
//
// Phases. Demo phase (the default after every reset): the demo batch (WASTE.seed); the Teach recorder starts with the
// first input and every stop of a recording (Naučit, R, the 3 min limit) turns its per-item episodes into examples
// (kept in localStorage, with the source: 'hand', or 'script' for items the planner sorted). Naučit trains the kNN
// rule on the examples the player kept. Spustit politiku resets into the verification batch (TEACH.seed, another order
// and other yaws) and runs the rule with no player input; any player input stops it and marks the run
// "zasažení hráče" (no stars). The run's per-item analysis (src/policy/knn.js report) goes to the result card on a
// win and to Nástroje → Politika either way, with the Skript (planner) on the same batch next to it.

import { MISSIONS, TEACH, FRACTION_CS, fewDemos } from '../missions.js';
import { FRACTION_BIN, labelOf } from '../objects/scene.js';
import { beltSolve } from '../objects/beltpick.js';
import { examplesFromDemo, train, coverage, report, CAUSES, USED } from '../policy/knn.js';
import { knnSolve, KNN_LABEL } from '../policy/run.js';
import { ENV_CLASSES, cutEpisodes } from '../policy/episodes.js';
import { store } from './store.js';
import { MeasureUI } from './measure.js';

const $ = (id) => document.getElementById(id);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const FR = FRACTION_CS;
const BIN_FR = Object.fromEntries(Object.entries(FRACTION_BIN).map(([f, b]) => [b, f]));
const binName = (b) => (b && BIN_FR[b] ? `koš ${FR[BIN_FR[b]]}` : 'žádný koš');
const pct = (v) => (v == null ? '–' : `${String(+(100 * v).toFixed(1)).replace('.', ',')} %`);
const msTxt = (ms) => (ms < 0.1 ? 'méně než 0,1 ms' : `${String(+ms.toFixed(ms < 10 ? 1 : 0)).replace('.', ',')} ms`);
const ukazek = (n) => (n === 1 ? 'ukázka' : n >= 2 && n <= 4 ? 'ukázky' : 'ukázek');
const ukazekZ = (n) => (n === 1 ? 'ukázky' : 'ukázek');   // after "z": z 1 ukázky, z 4 ukázek
const STORE = 'policy-ex', VER = 1;
export const CHIP = { you: 'Ovládáte vy', script: 'Běží: Skript (plánovač)', knn: 'Běží: ' + KNN_LABEL, replay: 'Přehrávání ukázky' };

export class PolicyUI {
  constructor(ux) {
    this.ux = ux;
    this.ex = this.load();
    this.model = null; this.trainMs = 0; this.trainedSig = '';
    this.verify = false; this.starting = false; this.kind = 'knn'; this.choice = 'knn';
    this.plan = null; this.log = []; this.intervened = false; this.reported = false;
    this.scriptItems = new Set(); this.recDone = false;
    this.last = null; this.scriptLive = null;
    this.sig = '';
    this.dom();
  }
  /** Mission 12 is on (and the page is in the conveyor scene). */
  get on() { return !!(this.ux.runner.m.teach && this.ux.world.belt); }

  // ---------------- examples (localStorage) ----------------
  load() {
    const j = store.get(STORE, null);
    if (!j || j.v !== VER || !Array.isArray(j.ex)) return [];
    // only what the policy needs, re-checked (localStorage is outside data)
    const ok = (e) => e && typeof e.item === 'string' && ENV_CLASSES.includes(e.class) && typeof e.outcome === 'string' &&
      (!e.use || (e.obs && ['yaw', 'lat', 'belt'].every((k) => Number.isFinite(e.obs[k])) && Number.isFinite(e.y) && typeof e.bin === 'string' && /^bin_[a-z]+$/.test(e.bin)));
    return j.ex.filter(ok).slice(0, 200).map((e) => Object.assign({}, e, { obs: e.obs ? Object.assign({ class: e.class }, e.obs) : undefined }));
  }
  persist() { store.set(STORE, { v: VER, ex: this.ex }); }
  /** examples a decision is learned from (the player did not delete them) */
  usable() { return this.ex.filter((e) => e.use && !e.off); }
  exSig() { return this.usable().map((e) => e.item + e.t + e.bin).join('|'); }
  dirty() { return !this.model || this.exSig() !== this.trainedSig; }
  scripted() { return this.usable().some((e) => e.src === 'script'); }
  /** demonstrations in the running recording (not cut yet): the mission check counts them */
  liveDemos() { const r = this.ux.teach.recording ? this.ux.runner.ctx.s : null; return (r && r.demos) || 0; }
  /** the episodes of the running recording so far (they become examples when it stops) */
  liveEpisodes() {
    const run = this.ux.teach.recording && !this.verify ? this.ux.runner.ctx.s.run : null;
    return run ? cutEpisodes(run.events, { end: run.t }).filter((e) => USED.includes(e.outcome)).map((e) => ({ item: e.item, class: e.class, outcome: e.outcome, bin: e.bin, use: true, live: true })) : [];
  }

  /** A stopped recording of mission 12 (Teach.stopRec): its episodes become examples, once. */
  harvest(demo) {
    if (!demo || demo.harvested || !demo.mission || demo.mission.id !== 'waste_teach' || !demo.segments) return;
    demo.harvested = true;
    const kin = this.ux.ctl.kin;
    const list = examplesFromDemo(demo, { tipOf: (q) => Array.from(kin.fk(q)) });
    for (const e of list) if (this.scriptItems.has(e.item)) e.src = 'script';
    if (!list.length) return;
    this.ex.push(...list);
    this.persist();
    this.render(true);
  }
  remove(i, off) { const e = this.ex[i]; if (!e) return; e.off = off; this.persist(); this.render(true); }
  clearAll() { this.ex = []; this.model = null; this.trainedSig = ''; this.persist(); this.render(true); }

  // ---------------- phases ----------------
  ctx() {
    const c = this.model ? this.model.coverage : {};
    return { verify: this.verify, demos: this.model ? this.model.n : 0, fractions: Object.values(c).filter((k) => k > 0).length };
  }
  /** before the scene resets (R, Spustit, a replay, "Ukázat řešení"): a running recording is cut and harvested while
   *  its batch still exists */
  beforeReset() { if (this.on && this.ux.teach.recording) this.ux.teach.stopRec(); }
  afterReset() {
    if (!this.starting) { this.verify = false; this.plan = null; }
    this.intervened = false; this.reported = false; this.recDone = false; this.scriptItems.clear();
    this.ux.runner.ctx.policy = this.ctx();
    this.render(true);
  }
  /** every frame before the mission check */
  preTick() {
    if (!this.on) return;
    const ux = this.ux, r = ux.runner, t = ux.teach;
    r.ctx.policy = this.ctx();
    // demo phase: the recording starts with the first input (before the batch's first spawn, so no reset is needed)
    if (!this.verify && r.started && !t.recording && !t.replaying && !this.recDone && !r.won) {
      const run = r.ctx.s.run;
      if (!run || run.next === 0) { t.startRec(); this.recDone = true; }
    }
    // items the planner sorts in the demo phase (hint "Nahrát ukázky skriptem", "Ukázat řešení") are scripted demos
    if (!this.verify) {
      const p = ux.ctl.plan && ux.ctl.plan.plan, held = p && p.kind === 'belt' ? ux.heldObject() : null;
      if (held) this.scriptItems.add(held);
    }
  }
  /** every frame after the mission check (before a win is shown) */
  postTick() {
    if (!this.on) return;
    const ux = this.ux, r = ux.runner, run = r.ctx.s.run;
    if (this.verify && this.plan && run && !this.reported) {
      const active = (ux.pending && ux.pending.plan === this.plan) || (ux.ctl.plan && ux.ctl.plan.plan === this.plan);
      if (!active && !run.done() && !r.won && !this.intervened) this.interrupt();
      if (run.done() && (r.won || !active)) this.finish();
    }
    const sig = [this.verify, !!this.plan, this.liveDemos(), ux.teach.recording, this.intervened, r.won].join();
    if (sig !== this.sig) this.render(false, sig);
  }
  /** the player moved the arm, the gripper or the belt during the policy run */
  interrupt() {
    if (!this.verify || !this.plan || this.reported || this.intervened) return;
    const ux = this.ux, c = ux.ctl;
    // the arrows / ball set a target while the planner still runs its plan: the policy stops here
    if (c.plan && c.plan.plan === this.plan) c.begin();
    if (ux.pending && ux.pending.plan === this.plan) ux.pending = null;
    this.intervened = true;
    this.ux.runner.auto = true;   // "Splněno" without stars (src/mastery.js)
    this.ux.panel.toast('Zasáhli jste do běhu – politika se zastavila. Tenhle běh se počítá bez hvězdiček.', null, 4000);
    this.render(true);
  }

  /** Naučit: cut the running recording, train on the kept examples, show the measured training time. */
  learn() {
    if (!this.on) return false;
    if (this.ux.teach.recording) this.ux.teach.stopRec();
    const n = this.usable().length;
    if (!n) { this.ux.panel.toast('Zatím žádná ukázka: roztřiďte rukou aspoň jeden předmět do koše', 'err'); return false; }
    const t0 = performance.now();
    this.model = train(this.ex);
    this.trainMs = performance.now() - t0;
    this.trainedSig = this.exSig();
    const miss = Object.entries(this.model.coverage).filter(([, k]) => !k).map(([f]) => FR[f]);
    this.ux.panel.toast(`Natrénováno za ${msTxt(this.trainMs)} z ${n} ${ukazekZ(n)}` + (miss.length ? `. Bez ukázky: ${miss.join(', ')} – ty politika nechá projet` : ''), null, 5000);
    this.choice = 'knn';
    this.render(true);
    return true;
  }
  /** Spustit: the verification batch, run by the learned rule (or the Skript, from the Politika select). */
  start(kind = this.choice) {
    if (!this.on) return false;
    const ux = this.ux;
    if (kind === 'knn' && (!this.model || this.dirty()) && !this.learn()) return false;
    ux.panel.closeWin && ux.panel.closeWin(false);
    ux.teach.stopReplay();
    this.kind = kind; this.verify = true; this.starting = true;
    ux.app.reset();
    this.starting = false;
    const r = ux.runner;
    r.ctx.policy = this.ctx();
    r.start();
    this.log = [];
    const stop = () => !!(r.ctx.s.run && r.ctx.s.run.done()), log = (e) => this.log.push(e);
    this.plan = kind === 'knn' ? knnSolve(ux.ctl, ux.world, this.model, { stop, log }) : beltSolve(ux.ctl, ux.world, { stop, log });
    if (kind === 'script') r.assisted = true;            // the planner's own run: no stars, no record
    else if (this.scripted()) r.auto = true;             // demos the planner recorded: "Splněno", no stars
    if (!ux.preview(this.plan, true)) { this.plan = null; this.verify = false; return false; }
    this.render(true);
    return true;
  }
  /** back to the demo phase (a fresh demo batch); the examples stay */
  toDemos() {
    if (!this.on) return;
    this.verify = false; this.plan = null;
    this.ux.app.reset();
    this.ux.panel.openDrawer(false);
    this.openSection();
  }
  /** the run is over: per-item analysis, kept for the card and the Politika section */
  finish() {
    if (this.reported) return;
    this.reported = true;
    const r = this.ux.runner, run = r.ctx.s.run, st = run.stats();
    const rows = report(run.items, this.log, (this.plan && this.plan.decisions) || {});
    const res = { kind: this.kind, seed: TEACH.seed, correct: st.correct, n: st.n, wrong: st.wrong, missed: st.missed, purity: st.purity, rows,
      demos: this.model ? this.model.n : 0, ms: this.trainMs, intervened: this.intervened, scripted: this.kind === 'knn' && this.scripted(), won: r.won };
    if (this.kind === 'script') this.scriptLive = res; else this.last = res;
    this.plan = null;
    this.render(true);
    if (!r.won) {
      // short of the win: the same result card, "nesplněno", with the analysis (design: a per-item failure table)
      const P = this.ux.panel, m = r.m;
      P.showWin(m, { stats: Object.assign(st, { demos: res.demos, verify: true }), stars: 0, time: r.time, kind: 'fail', failed: true }, null, false, null);
      P.stageWin(m, { by: 'fail' });
      P.openWin();
    }
  }

  // ---------------- labels ----------------
  /** The chip "Běží: …" (design §7): never empty in mission 12. */
  chip() {
    const ux = this.ux;
    if (ux.teach.replaying) return CHIP.replay;
    const p = ux.pending ? ux.pending.plan : ux.ctl.plan && ux.ctl.plan.plan;
    if (p && p.kind === 'knn') return CHIP.knn;
    if (p && p.kind === 'belt') return CHIP.script;
    return CHIP.you;
  }
  step() { return this.verify ? 3 : this.model && !this.dirty() ? 2 : 1; }
  coverageText() {
    const c = coverage(this.ex.concat(this.liveEpisodes()));
    return 'Ukázané frakce: ' + ENV_CLASSES.map((f) => `${FR[f]} ${c[f] ? '✓' : '–'}`).join(' · ');
  }

  // ---------------- DOM ----------------
  dom() {
    const ux = this.ux, P = ux.panel;
    // action bar: one button whose label follows the phase (Naučit → Spustit politiku → Ukázky)
    this.btn = h(`<button type="button" class="ux-ab" id="ux-policy" hidden>Naučit</button>`);
    P.hintB.before(this.btn);
    this.btn.addEventListener('click', () => this.primary());
    // stepper (desktop: the three steps; phones: "2/3 Naučit"), first in the chip column
    this.stepEl = h(`<span class="ux-chip-step mono-s" hidden></span>`);
    P.chips.prepend(this.stepEl);
    // Nástroje → Politika
    this.sec = h(`<section class="ux-sec ux-polsec" id="ux-sec-policy" aria-labelledby="ux-pol-h" hidden>
      <h3 class="mono ux-sech" id="ux-pol-h">Politika</h3>
      <p class="ink2 ux-pol-what">${KNN_LABEL}: z vašich ukázek se učí, do kterého koše, kdy na pásu a jak vysoko brát. Rukou pohybuje plánovač. Nevidí: druh a polohu předmětu zná ze simulace.</p>
      <p class="mono-s" id="ux-pol-st" aria-live="polite"></p>
      <p class="mono-s" id="ux-pol-cov"></p>
      <ol class="ux-pol-list" id="ux-pol-list"></ol>
      <p class="mono-s muted" id="ux-pol-unused" hidden></p>
      <div class="ux-row3 ux-pol-btns">
        <button type="button" class="btn btn-o" id="ux-pol-learn">Naučit</button>
        <button type="button" class="btn btn-o" id="ux-pol-run">Spustit</button>
        <button type="button" class="btn btn-o" id="ux-pol-demos">Ukázky</button>
      </div>
      <label class="ux-pol-sel"><span class="mono-s">Politika pro Spustit</span>
        <select id="ux-pol-kind">
          <option value="knn">${KNN_LABEL}</option>
          <option value="script">Skript (plánovač)</option>
          <option value="sil" disabled>Importovaná ze SIL (ACT / SmolVLA, mimo prohlížeč) – zatím není</option>
        </select></label>
      <div id="ux-pol-meas"></div>
      <div id="ux-pol-rep"></div>
      <button type="button" class="ux-link" id="ux-pol-export">Stáhnout poslední nahrávku (JSON) <span aria-hidden="true">⤓</span></button>
      <a class="ux-link" href="lerobot.html" target="_blank" rel="noopener">Převést nahrávku na dataset LeRobot <span aria-hidden="true">→</span></a>
      <button type="button" class="ux-link" id="ux-pol-clear">Smazat všechny ukázky</button>
    </section>`);
    $('ux-sec-tools').before(this.sec);
    this.meas = new MeasureUI(this, $('ux-pol-meas'));   // Měřicí buňka: the policy's measured profile (mission 13 input)
    $('ux-pol-learn').addEventListener('click', () => this.learn());
    $('ux-pol-run').addEventListener('click', () => this.start());
    $('ux-pol-demos').addEventListener('click', () => this.toDemos());
    $('ux-pol-kind').addEventListener('change', (e) => { this.choice = e.target.value === 'script' ? 'script' : 'knn'; this.render(true); });
    $('ux-pol-export').addEventListener('click', () => { if (!this.ux.teach.download()) this.ux.panel.toast('Zatím žádná nahrávka', 'err'); });
    $('ux-pol-clear').addEventListener('click', () => { this.clearAll(); this.ux.panel.toast('Ukázky smazány'); });
    $('ux-pol-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]'); if (!b) return;
      this.remove(+b.dataset.i, b.dataset.off === '1');
    });
  }
  openSection() { this.sec.scrollIntoView && this.sec.scrollIntoView({ block: 'start' }); }
  /** the action-bar button: Naučit (demo phase) → Spustit politiku (trained) → Ukázky (verification) */
  primary() {
    if (this.verify) return this.toDemos();
    if (this.model && !this.dirty() && !this.ux.teach.recording) return this.start('knn');
    return this.learn();
  }
  render(force, sig) {
    if (sig) this.sig = sig; else if (!force) return;
    const on = this.on, ux = this.ux;
    this.btn.hidden = !on; this.sec.hidden = !on; this.stepEl.hidden = !on;
    $('ux-abar').classList.toggle('ux-ab6', on);
    if (!on) return;
    const live = this.liveDemos(), n = this.usable().length, ready = this.model && !this.dirty() && !ux.teach.recording;
    const lab = this.verify ? 'Ukázky' : ready ? 'Spustit politiku' : `Naučit (${n + live})`;
    if (this.btn.textContent !== lab) this.btn.textContent = lab;
    this.btn.setAttribute('aria-label', this.verify ? 'Zpět k ukázkám' : ready ? 'Spustit naučenou politiku na nové dávce' : `Naučit politiku z ukázek (${n + live})`);
    const s = this.step(), names = ['Ukázky', 'Naučit', 'Ověřit'];
    const compact = ux.panel.mqCompact && ux.panel.mqCompact.matches;
    this.stepEl.textContent = compact ? `${s}/3 ${names[s - 1]}` : names.map((x, i) => (i + 1 === s ? `▸ ${i + 1} ${x}` : `${i + 1} ${x}`)).join(' · ');
    // section
    $('ux-pol-st').textContent = this.model
      ? `Natrénováno za ${msTxt(this.trainMs)} z ${this.model.n} ${ukazekZ(this.model.n)}` + (this.dirty() ? ' · ukázky se změnily, stiskněte Naučit' : '')
      : (n + live ? `Ukázek: ${n + live} · zatím nenaučeno` : 'Zatím žádná ukázka: roztřiďte rukou pár předmětů z pásu');
    $('ux-pol-cov').textContent = this.coverageText();
    const list = $('ux-pol-list'); list.textContent = '';
    let k = 0, unused = 0;
    this.ex.forEach((e, i) => {
      if (!e.use) { unused++; return; }
      const ok = e.outcome === 'sorted', num = e.off ? '–' : String(++k);
      const li = h(`<li class="${e.off ? 'off' : ''}"><span class="mono-s">${e.off ? 'smazáno' : 'č. ' + num}</span> <span>${ok ? '✓' : '✗'} ${FR[e.class]}: ${labelOf(e.item)[0]} → ${binName(e.bin)}${e.src === 'script' ? ' (skript)' : ''}</span>
        <button type="button" class="ux-link" data-i="${i}" data-off="${e.off ? 0 : 1}" aria-label="${e.off ? 'Vrátit ukázku' : 'Smazat ukázku č. ' + num}">${e.off ? 'Vrátit' : 'Smazat'}</button></li>`);
      list.appendChild(li);
    });
    for (const e of this.liveEpisodes()) {
      list.appendChild(h(`<li class="live"><span class="mono-s">nahrává se</span> <span>${e.outcome === 'sorted' ? '✓' : '✗'} ${FR[e.class]}: ${labelOf(e.item)[0]} → ${binName(e.bin)}</span></li>`));
    }
    const un = $('ux-pol-unused'); un.hidden = !unused; un.textContent = unused ? `Nepoužito: ${unused} (předmět propadl nebo vypadl, žádný koš)` : '';
    $('ux-pol-learn').disabled = !n && !live;
    $('ux-pol-run').disabled = this.choice === 'knn' && !n && !live;
    $('ux-pol-demos').disabled = !this.verify;
    $('ux-pol-kind').value = this.choice;
    this.meas.render();
    const rep = $('ux-pol-rep'); rep.textContent = '';
    if (this.last || this.scriptLive) rep.appendChild(this.reportEl(this.last || this.scriptLive));
  }

  /** The analysis of a run: the label, per-item failures (with the demo the decision copied) and the side-by-side. */
  reportEl(res, card) {
    const el = h(`<div class="ux-pol-rep"></div>`);
    const who = res.kind === 'script' ? 'Skript (plánovač)' : KNN_LABEL;
    // on the card the numbers are in the cells above: label and batch only
    el.appendChild(h(card ? `<p class="mono-s"><b>Běží: ${who}</b> · ověřeno na nové dávce č. ${res.seed}${res.intervened ? ' · zasažení hráče' : ''}</p>`
      : `<p class="mono-s"><b>${who}</b> · dávka č. ${res.seed}: ${res.correct} z ${res.n} · čistota ${pct(res.purity)}${res.intervened ? ' · zasažení hráče' : ''}</p>`));
    const bad = res.rows.filter((x) => !x.ok);
    if (bad.length) {
      const ul = h(`<ul class="ux-pol-fail"></ul>`);
      for (const x of bad) ul.appendChild(h(`<li>${this.rowText(x)}</li>`));
      el.appendChild(ul);
    } else el.appendChild(h(`<p class="mono-s">Všechny předměty ve svém koši.</p>`));
    el.appendChild(this.compareEl(res));
    return el;
  }
  rowText(x) {
    const lab = `${labelOf(x.item)[0]} (${FR[x.fraction]})`;
    if (x.cause === 'wrong') return `${lab}: špatný koš – ${binName(x.bin)}` + (x.by ? ` (podle ukázky č. ${x.by})` : '');
    return `${lab}: ${CAUSES[x.cause]}`;
  }
  /** Skript vs your policy vs your manual try of mission 11, on the batch they ran (design §2 M12). */
  compareEl(res) {
    const tb = h(`<table class="ux-pol-cmp"><caption class="mono-s">Stejná dávka č. ${TEACH.seed}</caption><tbody></tbody></table>`), b = tb.lastChild;
    const row = (a, v, note) => b.appendChild(h(`<tr><th scope="row">${a}</th><td>${v}</td><td class="muted">${note || ''}</td></tr>`));
    const s = this.scriptLive, ref = TEACH.script;
    if (s) row('Skript (plánovač)', `${s.correct} z ${s.n}`, 'naměřeno teď v prohlížeči');
    else if (ref) row('Skript (plánovač)', `${ref.correct} z ${ref.n}`, 'naměřeno v MuJoCo mimo prohlížeč (tools/belt-measure.mjs)');
    const p = this.last;
    row('Vaše politika', p ? `${p.correct} z ${p.n}` : 'zatím neběžela', p ? `${p.demos} ${ukazek(p.demos)}` : '');
    const m11 = store.get('waste-hand-last', null);
    row('Váš ruční pokus (mise 11)', m11 && Number.isFinite(m11.correct) ? `${m11.correct} z ${m11.n}` : 'zatím žádný', m11 ? 'jiná dávka (č. 1)' : '');
    return tb;
  }

  /** Result card of mission 12 (Panel.showWin): label, demos, training time, sorted, purity, lost; failures and the
   *  side-by-side; named stars with the measured value of a missed one. */
  fillWin(m, res, P, cell, again, manual) {
    if (!res.failed) this.finish();
    const st = res.stats, S = m.stars, p = this.kind === 'knn' ? this.last : this.scriptLive;
    const pur = st.purity != null && st.purity >= S.purity - 1e-9, few = fewDemos(S, st);
    // the policy label and the batch head the analysis below (one line); the cells are the measured values
    cell('Ukázky', this.kind === 'script' ? 'žádné' : `${st.demos} (natrénováno za ${msTxt(this.trainMs)})`, this.kind !== 'script' && few);
    cell('Roztříděno', `${st.correct} z ${st.n}`, st.correct >= S.win);
    cell('Čistota', pct(st.purity) + (st.wrong ? ` (${st.wrong} v cizím koši)` : ''), pur);
    cell('Propadlo', String(st.missed));
    P.win.classList.add('ux-result-pol');
    P.winH.textContent = res.failed ? `${this.kind === 'script' ? 'Skript roztřídil' : 'Politika roztřídila'} ${st.correct} z ${st.n} – na splnění je potřeba ${S.win}.`
      : this.kind === 'script' ? 'Skript roztřídil odpad.' : (/[.!]$/.test(m.done) ? m.done : m.done + '.');
    if (res.failed) {
      P.winK.textContent = `Mise ${m.n} / ${String(MISSIONS.length).padStart(2, '0')} · nesplněno`;
      P.winDemo.hidden = true; P.winStars.hidden = true;
    }
    const named = ['★ hotovo', pur ? '★ čistota ≥ 95 %' : `☆ čistota ${pct(st.purity)}`, few ? `★ všechny ${S.fractions} frakce, nejvýš ${S.demos} ukázek` : `☆ ukázek: ${st.demos} · frakcí ${st.fractions || 0} ze ${S.fractions}`];
    const why = res.failed ? 'Níže je, co u kterého předmětu selhalo. Upravte ukázky (smazat špatné, doplnit chybějící frakce), stiskněte Naučit a Spustit znovu.'
      : this.kind === 'script' ? 'Tohle roztřídil Skript (plánovač), ne vaše politika – bez hvězdiček.'
      : p && p.intervened ? 'Zasáhli jste do běhu – bez hvězdiček.'
        : p && p.scripted ? 'Ukázky nahrál skript – bez hvězdiček.' : null;
    P.winText.innerHTML = (why ? `<span>${why}</span> ` : named.map((x) => `<span>${x}</span>`).join(' · ') + ' ') +
      `<span>Co neumí: nevidí (druh a polohu zná ze simulace), pohyb je plánovače, druh bez ukázky nechá projet.</span>` +
      (manual && res.stars < 3 && m.advice ? ` <span>${m.advice}</span>` : '');
    // "Znovu" resets the scene, and every reset returns to the demo phase: here it means "edit the demos"
    again.firstChild.textContent = 'Upravit ukázky ';
    again.classList.remove('btn-act'); again.classList.add('btn-o');
    P.winStats.hidden = true;
    let wp = $('ux-wpol');
    if (!wp) { wp = h(`<div class="ux-wpol" id="ux-wpol"></div>`); P.winStats.after(wp); }
    wp.textContent = '';
    if (p) wp.appendChild(this.reportEl(p, true));
    wp.hidden = !p;
  }
}

/** ids of the missions that use this module (tests) */
export const POLICY_MISSIONS = MISSIONS.filter((m) => m.teach).map((m) => m.id);
