// Mission 13 "Třídění odpadu III: Navrhněte linku" (waste_line) in the page: the line editor (order cards, a 4 m belt
// with 8 cell slots, two fractions per cell), the run (20 seeded runs of the line model, src/line/des.js, with a
// replay of run 1 on the schema), the result card (four metrics with the player's own-run histograms, the named stars,
// where the line falls short) and the "Jak to počítáme" panel (src/line/explain.js).
//
// Honest data: every number shown comes from the line model on the measured Skript profiles (profiles/skript-*.json,
// fetched on demand), from the stored N_min search (src/line/nmin.js) or from the measured mission 11 batches. The
// histograms compare only with the player's own earlier runs of the same order (localStorage, "vaše běhy"); there is
// no aggregate of other players and no request for one. Copy: src/line/copy.js (Czech) → src/i18n/en.js.
//
// Layout (src/ux.css "mission 13"): desktop: the editor takes the left two thirds under the top row, the 3D measuring
// cell (the physics the profiles come from) the right third; phones: the editor is a sheet between the 3D cell and
// the thumb bar, the belt runs top → bottom.

import { t, isEn } from '../i18n/index.js';
import { ORDERS, orderById, lineConfig, lineProblems, lineStars, cellsAtLeast, histogram, cleanRuns, RUNS_VER, RUNS_MAX, MAX_FRACTIONS, beltMax } from '../line/orders.js';
import { LINE, CLASSES, simulate, cellModel, summarize, seedsOf, slotX } from '../line/des.js';
import { EXPLAIN, M11_BATCH, SOURCE, m11Config } from '../line/explain.js';
import { COPY, plural, VENDOR_SOURCES } from '../line/copy.js';
import { MISSIONS, FRACTION_CS } from '../missions.js';
import { store } from './store.js';
import { trapFocus } from './panel.js';

const $ = (id) => document.getElementById(id);
const h = (html) => { const tp = document.createElement('template'); tp.innerHTML = html.trim(); return tp.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const T = (k, vars) => t(COPY[k], vars);
/** a number for the page: fixed decimals, decimal comma in Czech */
const num = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : (isEn ? x.toFixed(d) : x.toFixed(d).replace('.', ',')));
const pct = (x) => (x == null || !Number.isFinite(x) ? '–' : `${num(100 * x, x >= 0.9995 ? 0 : 1)} %`);
const cm = (v) => num(v * 100, 0);
const fr = (f) => t(FRACTION_CS[f]);
const frList = (fs) => (fs.length ? fs.map(fr).join(' + ') : T('noFraction'));
const pl = (kind, n) => t(plural(kind, n), { n });
// bin colours of the conveyor scene (src/ui/beltview.js BIN_RGB): the swatch next to each fraction name
const FR_RGB = { paper: '#1F3BFF', plastic: '#F5C219', glass: '#1F8C4D', metal: '#2B2B2B' };
const ARM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21h9M6.5 21v-3.5h4V21M8.5 17.5L11 9.5l6.5-3"/><circle cx="11" cy="9.5" r="1.4"/><path d="M17.5 6.5l2.5-1.5M17.5 6.5l1.5 2.3"/></svg>';
const STORE_CELLS = 'line-cells', STORE_RUNS = 'line-runs', STORE_ORDER = 'line-order', STORE_BEST = 'line-best';
const REPLAY_S = 6, BELT_S = 5;   // replay of run 1: 6 s on screen, one belt length per 5 s

export class LineUI {
  constructor(ux) {
    this.ux = ux;
    this.orderId = orderById(store.get(STORE_ORDER, 'A')) ? store.get(STORE_ORDER, 'A') : 'A';
    this.lines = this.loadLines();
    this.runs = cleanRuns(store.get(STORE_RUNS, null));
    const b = store.get(STORE_BEST, {}) || {};
    this.best = Object.fromEntries(ORDERS.map((o) => [o.id, Number.isInteger(b[o.id]) && b[o.id] >= 0 && b[o.id] <= 3 ? b[o.id] : 0]));
    this.sel = null;              // slot whose fractions are being edited
    this.phase = 'edit';          // edit | running | result
    this.last = null;             // the last run's result (kept across resets: the schema shows its utilisation)
    this.fresh = false;           // a winning run the mission check has not reported yet
    this.assisted = false;        // the line was loaded by the hint ladder (no stars)
    this.profiles = {}; this.models = {}; this.loadErr = null;
    this.dom();
  }
  /** Mission 13 is on (and the page is in the conveyor scene). */
  get on() { return !!(this.ux.runner.m.line && this.ux.world.belt); }
  get order() { return orderById(this.orderId); }
  get cells() { return this.lines[this.orderId]; }

  // ---------------- stored state (per-viewer conveniences, all re-checked) ----------------
  loadLines() {
    const j = store.get(STORE_CELLS, null) || {}, out = {};
    for (const o of ORDERS) {
      const l = Array.isArray(j[o.id]) ? j[o.id] : [];
      const cells = l.filter((c) => c && Number.isInteger(c.slot) && Array.isArray(c.fractions))
        .map((c) => ({ slot: c.slot, fractions: c.fractions.filter((f) => CLASSES.includes(f)).slice(0, MAX_FRACTIONS) }));
      out[o.id] = lineProblems(cells).some((p) => p.code === 'slot' || p.code === 'fractions') ? [] : cells;
    }
    return out;
  }
  persist() { store.set(STORE_CELLS, this.lines); }

  // ---------------- profiles (fetched on demand) ----------------
  async profile(v) {
    if (this.models[v]) return this.models[v];
    const k = Math.round(v * 100);
    try {
      const r = await fetch(new URL(`../../profiles/skript-${k}.json`, import.meta.url));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const p = await r.json();
      this.profiles[v] = p; this.models[v] = cellModel(p); this.loadErr = null;
    } catch (e) { this.loadErr = e.message || String(e); this.models[v] = null; }
    this.render();
    return this.models[v];
  }

  // ---------------- editing ----------------
  touch() {
    // any change to the line: a new design, the hint's line is no longer what runs
    this.assisted = false;
    this.persist();
    this.ux.runner.start();
    if (this.phase === 'result') this.phase = 'edit';
    this.render();
  }
  setOrder(id) {
    if (!orderById(id) || id === this.orderId && this.phase !== 'running') { this.render(); return; }
    if (this.phase === 'running') return;
    this.orderId = id; store.set(STORE_ORDER, id);
    this.sel = null; this.assisted = false; this.phase = 'edit';
    this.ux.app.reset();   // the belt of the 3D cell takes the order's speed; a shown card goes away
    this.profile(this.order.v);
  }
  cellAt(slot) { return this.cells.find((c) => c.slot === slot) || null; }
  /** a new cell in a slot (default: the first free one), with the first two fractions no cell sorts yet */
  addCell(slot) {
    if (this.phase === 'running') return false;
    const used = new Set(this.cells.map((c) => c.slot));
    if (slot == null) slot = Array.from({ length: LINE.maxCells }, (_, i) => i).find((i) => !used.has(i));
    if (slot == null || used.has(slot)) { this.ux.panel.toast(T('full', { n: LINE.maxCells }), 'err'); return false; }
    const covered = new Set(this.cells.flatMap((c) => c.fractions));
    const fractions = CLASSES.filter((f) => !covered.has(f)).slice(0, MAX_FRACTIONS);
    this.cells.push({ slot, fractions });
    this.sel = slot;
    this.touch();
    return true;
  }
  removeCell(slot) {
    const i = this.cells.findIndex((c) => c.slot === slot);
    if (i < 0) return;
    this.cells.splice(i, 1);
    if (this.sel === slot) this.sel = null;
    this.touch();
  }
  toggleFraction(slot, f) {
    const c = this.cellAt(slot); if (!c) return;
    const i = c.fractions.indexOf(f);
    if (i >= 0) c.fractions.splice(i, 1);
    else if (c.fractions.length < MAX_FRACTIONS) c.fractions.push(f);
    else return;
    this.touch();
  }
  moveCell(slot, d) {
    const c = this.cellAt(slot), to = slot + d;
    if (!c || to < 0 || to >= LINE.maxCells) return;
    const o = this.cellAt(to);
    if (o) o.slot = slot;   // swap with the neighbour
    c.slot = to; this.sel = to;
    this.touch();
  }
  clear() { this.lines[this.orderId] = []; this.sel = null; this.touch(); }
  /** tests and the hint: replace the line ([{ slot, fractions }] or [[fractions], …] in slots 0, 1, …) */
  setCells(list) {
    const cells = list.map((c, i) => (Array.isArray(c) ? { slot: i, fractions: c.slice() } : { slot: c.slot, fractions: c.fractions.slice() }));
    if (lineProblems(cells).some((p) => p.code === 'slot' || p.code === 'fractions')) return false;
    this.lines[this.orderId] = cells; this.sel = null;
    this.touch();
    return true;
  }

  // ---------------- the run ----------------
  problemText(cells) {
    const p = lineProblems(cells)[0];
    if (!p) return null;
    if (p.code === 'empty') return T('needCell');
    return T('needFraction', { x: num(slotX(p.slot), 2) });
  }
  /**
   * Spustit linku: 20 seeded runs of the line model (des.js) of the current line; run 1 is replayed on the schema
   * while the rest is computed (not with reduced motion). opts.instant: no replay; opts.hold: stop the replay at
   * that many seconds and wait (tests: a screenshot of the running state; lineSkip() goes on).
   */
  async run(opts = {}) {
    if (!this.on || this.phase === 'running') return false;
    const o = this.order, cells = this.cells.map((c) => ({ slot: c.slot, fractions: c.fractions.slice() })), P = this.ux.panel;
    const bad = this.problemText(cells);
    if (bad) { P.toast(bad, 'err'); return false; }
    const model = await this.profile(o.v);
    if (!model) { P.toast(T('loadFail', { err: this.loadErr || '' }), 'err'); return false; }
    const ux = this.ux, r = ux.runner;
    if (r.won || ux.app.won || P.winOpen()) ux.app.reset();
    P.closeHint(false); P.closeDrawer(false);
    r.start();
    if (opts.assisted) r.assisted = true;   // "Ukázat řešení": the robot solved it (no stars, no record)
    if (this.assisted) r.auto = true;   // the hint's line: "Splněno", no stars (src/mastery.js)
    this.sel = null; this.phase = 'running'; this.fresh = false;
    this.progress = { k: 0, n: LINE.seeds };
    const config = lineConfig(o, cells), models = { [o.policy]: model }, seeds = seedsOf(LINE.seeds);
    const first = simulate(config, models, seeds[0], { trace: true });
    const runs = [first];
    const replay = !opts.instant && !ux.reduced;
    this.replay = replay ? this.startReplay(first, config, opts.hold) : null;
    this.render();
    for (let i = 1; i < seeds.length; i++) {
      if (!opts.instant && i % 4 === 0) await frame();   // the page stays live; 20 runs take well under a second
      runs.push(simulate(config, models, seeds[i]));
      this.progress.k = i + 1; this.renderRun();
    }
    this.progress.k = seeds.length; this.renderRun();
    if (this.replay) await this.replay.done;
    this.replay = null; this.clearItems();
    this.finish(o, cells, runs);
    return true;
  }
  finish(o, cells, runs) {
    const summary = summarize(runs), stars = lineStars(o, summary, runs, cells.length), ux = this.ux;
    const prev = this.runs[o.id] ? this.runs[o.id].slice() : [];
    const rec = { n: cells.length, sorted: summary.sorted.mean, purity: summary.purity.mean == null ? 0 : summary.purity.mean, missed: summary.missed.mean + summary.lost.mean, win: stars.win };
    (this.runs[o.id] = this.runs[o.id] || []).push(rec);
    this.runs[o.id] = this.runs[o.id].slice(-RUNS_MAX);
    store.set(STORE_RUNS, { v: RUNS_VER, orders: this.runs });
    const own = !this.assisted && !ux.runner.assisted;
    if (own && stars.win && stars.stars > this.best[o.id]) { this.best[o.id] = stars.stars; store.set(STORE_BEST, this.best); }
    this.last = { id: o.id, cells, summary, runs, stars, prev, rec, assisted: !own, seeds: runs.length };
    this.phase = 'result';
    this.render();
    if (stars.win) { this.fresh = true; return; }   // the mission check reports the win (src/missions.js lineCheck)
    // short of the order: the same result card, "nesplněno", with where the line falls short
    const P = ux.panel, m = ux.runner.m;
    P.showWin(m, { stats: { stars: 0 }, stars: 0, time: ux.runner.time, kind: 'fail', failed: true }, null, false, 'fail');
    P.stageWin(m, { by: 'fail' });
    P.openWin();
  }
  /** "Ukázat řešení" (hint rung 4): the search's line, run by the page; the robot solved it (no stars, no record). */
  solve() {
    if (!this.on) return false;
    if (!this.loadBest()) return false;
    this.run({ assisted: true });
    return true;
  }
  loadBest() {
    const s = this.order.search;
    if (!s || !s.best) return false;
    this.setCells(s.best.cells);
    this.assisted = true;
    return true;
  }

  // ---------------- replay of run 1 on the schema ----------------
  startReplay(trace, config, hold) {
    const L = LINE.length, v = config.v, t0 = L / v, speed = (L / v) / BELT_S;
    const byItem = new Map();
    for (const a of trace.attempts) { if (!byItem.has(a.item)) byItem.set(a.item, []); byItem.get(a.item).push(a); }
    const items = trace.items.filter((it) => it.tArr <= t0 + REPLAY_S * speed && it.tArr + L / v >= t0);
    const slotOfCell = config.cells.map((c) => Math.round((c.x - LINE.firstSlot) / LINE.slot));
    let resolve; const done = new Promise((r) => { resolve = r; });
    const st = { t: 0, speed, skip: false, hold, done, resolve, last: performance.now(), items, byItem, t0, v, L, slotOfCell, sorted: config.cells.map(() => 0) };
    const tick = () => {
      if (this.replay !== st) return;
      const now = performance.now();
      if (!(hold != null && st.t >= hold)) st.t += Math.min(0.1, (now - st.last) / 1000);
      st.last = now;
      this.drawReplay(st);
      if (st.skip || st.t >= REPLAY_S) { st.resolve(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return st;
  }
  skip() { if (this.replay) { this.replay.skip = true; this.replay.hold = null; } }
  /** item states at line time ts: on the belt at s(t) = v (t − t_arrival), held by a cell, or gone */
  drawReplay(st) {
    const ts = st.t0 + st.t * st.speed, layer = this.itemsEl, busy = new Map();
    let k = 0;
    for (const it of st.items) {
      if (it.tArr > ts) continue;
      let gone = false, held = null;
      for (const a of st.byItem.get(it.id) || []) {
        if (a.t > ts) break;
        const close = a.t + a.tg, ready = close + a.tr;
        if (ts < ready) { if (ts >= close) held = a; busy.set(a.cell, a); break; }
        if (!['miss', 'drop_belt'].includes(a.outcome)) { gone = true; break; }
      }
      const s = st.v * (ts - it.tArr);
      if (gone || held || s >= st.L) continue;
      let dot = layer.children[k++];
      if (!dot) { dot = document.createElement('i'); layer.appendChild(dot); }
      dot.style.setProperty('--p', (100 * s / st.L).toFixed(2) + '%');
      dot.style.setProperty('--c', FR_RGB[it.cls]);
      dot.hidden = false;
    }
    for (let i = k; i < layer.children.length; i++) layer.children[i].hidden = true;
    // cells: busy (and with which fraction in the jaws), sorted so far in the counted window
    st.slotOfCell.forEach((slot, ci) => {
      const el = this.slotEls[slot] && this.slotEls[slot].querySelector('.ux-lcell'); if (!el) return;
      const a = busy.get(ci);
      el.classList.toggle('busy', !!a);
      el.style.setProperty('--hold', a ? FR_RGB[a.cls] : 'transparent');
    });
    this.replayEl.textContent = T('replay', { x: num(st.speed, 0) });
  }
  clearItems() {
    if (this.itemsEl) this.itemsEl.textContent = '';
    for (const el of this.root.querySelectorAll('.ux-lcell.busy')) el.classList.remove('busy');
  }

  // ---------------- mission hooks (src/ux.js) ----------------
  objectiveText() {
    const o = this.order, X = num(100 * o.X, 0);
    if (this.phase === 'running') return T('computing', { seeds: LINE.seeds, min: LINE.horizon / 60 });
    const L = this.last;
    if (this.phase === 'result' && L && L.id === o.id) {
      const s = L.summary;
      if (L.stars.win) return T('winLine', { sorted: num(s.sorted.mean), purity: pct(s.purity.mean) });
      const pOk = s.purity.mean != null && s.purity.mean >= o.X - 1e-9;
      return T('failLine', { sorted: num(s.sorted.mean), F: o.F, purity: pct(s.purity.mean), mark: pOk ? '✓' : '✗' });
    }
    return T('objective', { id: o.id, F: o.F, X });
  }
  preTick() {
    if (!this.on) return;
    const r = this.ux.runner;
    r.ctx.line = { text: this.objectiveText(), won: this.fresh && !r.won, ok: this.phase === 'result' && !!(this.last && this.last.stars.win),
      stats: this.last ? { stars: Math.max(1, this.last.stars.stars), order: this.last.id, n: this.last.cells.length } : null };
  }
  postTick() { if (this.on && this.fresh && this.ux.runner.won) this.fresh = false; }
  afterReset() {
    const on = this.on;
    document.body.classList.toggle('ux-line-on', on);
    if (!on) { this.render(); return; }
    if (this.ux.world.belt) this.ux.world.belt.speed = this.order.v;   // the 3D cell's belt runs at the order's speed
    if (this.phase === 'result') this.phase = 'edit';   // "Upravit linku", R, another order: back to the editor
    this.fresh = false;
    this.profile(this.order.v);
    this.render();
  }
  /** hint ladder texts (src/missions.js hints, src/ui/panel.js showHint) */
  hintText(id) {
    const o = this.order, s = o.search;
    if (!s) return '';
    if (id === 'ghost') return T('hintCap', { cap: num(s.cap1.sorted), pair: frList(s.cap1.cells), F: o.F, k: pl('cell', cellsAtLeast(o)) });
    return T('hintShow', { n: pl('cell', s.n), sorted: num(s.best.sorted) });
  }
  /** rung 2: the capacity text is the hint; the schema already shows utilisation and losses after a run */
  hintGhost() { return this.on; }
  /** rung 3: load the search's line (assisted: "Splněno", no stars) */
  hintPartial() {
    if (!this.on || this.phase === 'running' || !this.loadBest()) return false;
    this.ux.panel.toast(T('shown'));
    return true;
  }

  // ---------------- DOM ----------------
  dom() {
    const ux = this.ux, P = ux.panel;
    const root = this.root = h(`<section class="ux-line" id="ux-line" aria-labelledby="ux-line-h" hidden>
      <div class="ux-line-top">
        <h2 class="ux-line-h" id="ux-line-h"><span class="mono"></span> <span class="mono-s muted"></span></h2>
        <button type="button" class="ux-link ux-line-how" id="ux-line-how"></button>
      </div>
      <div class="ux-lorders" role="radiogroup" id="ux-lorders"></div>
      <div class="ux-lflow">
        <p class="mono-s ux-lin" id="ux-lin"></p>
        <div class="ux-lstrip" id="ux-lstrip"><div class="ux-lbelt" id="ux-lbelt" aria-hidden="true"><div class="ux-lwins"></div><div class="ux-litems"></div></div></div>
        <p class="mono-s ux-lout" id="ux-lout"></p>
      </div>
      <div class="ux-lpick" id="ux-lpick" hidden></div>
      <div class="ux-lfoot">
        <p class="mono-s ux-lstatus" id="ux-lstatus" aria-live="polite"></p>
        <div class="ux-lrun" id="ux-lrun" hidden><span class="mono-s" id="ux-lrun-t"></span><b><i id="ux-lrun-p"></i></b><span class="mono-s" id="ux-lreplay"></span><button type="button" class="ux-link" id="ux-lskip"></button></div>
        <p class="mono-s muted ux-lpol" id="ux-lpol"></p>
        <button type="button" class="ux-link ux-lclear" id="ux-lclear"></button>
      </div>
    </section>`);
    document.querySelector('.sim').insertBefore(root, $('ux-under'));
    root.querySelector('.ux-line-h .mono').textContent = T('scheme');
    root.querySelector('.ux-line-h .mono-s').textContent = '· ' + T('schemeSub');
    $('ux-line-how').textContent = T('howTo');
    $('ux-lskip').textContent = T('skip');
    $('ux-lclear').textContent = T('clear');
    $('ux-lpol').textContent = T('policy');
    $('ux-lorders').setAttribute('aria-label', T('orders'));
    this.itemsEl = root.querySelector('.ux-litems'); this.winsEl = root.querySelector('.ux-lwins');
    this.replayEl = $('ux-lreplay');
    // slots: built once, filled by render()
    const strip = $('ux-lstrip');
    this.slotEls = [];
    for (let k = 0; k < LINE.maxCells; k++) {
      const el = h(`<div class="ux-lslot" style="--k:${k + 1}" data-slot="${k}"></div>`);
      const u = h(`<div class="ux-lutil mono-s" style="--k:${k + 1}" aria-hidden="true"></div>`);
      strip.append(el, u);
      this.slotEls.push(el); el.util = u;
    }
    // keyboard: render() rebuilds the slot and picker markup, so the control that was used gets the focus back
    const refocus = (sel) => { const b = this.root.querySelector(sel); if (b && !b.disabled) b.focus({ preventScroll: true }); };
    strip.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const k = +b.closest('[data-slot]').dataset.slot;
      if (b.dataset.act === 'add') { if (this.addCell(k)) refocus('#ux-lpick button[data-act="frac"]'); return; }
      this.sel = this.sel === k ? null : k; this.render();
      refocus(`.ux-lslot[data-slot="${k}"] button`);
      if (this.sel != null && this.ux.panel.mq.matches) { const pk = $('ux-lpick'); if (pk.scrollIntoView) pk.scrollIntoView({ block: 'nearest' }); }
    });
    $('ux-lpick').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b || this.sel == null) return;
      const a = b.dataset.act, k = this.sel, f = b.dataset.f;
      if (a === 'frac') { this.toggleFraction(k, f); refocus(`#ux-lpick button[data-f="${f}"]`); }
      else if (a === 'up' || a === 'down') { this.moveCell(k, a === 'up' ? -1 : 1); refocus(`#ux-lpick button[data-act="${a}"]`); }
      else if (a === 'rm') { this.removeCell(k); refocus(`.ux-lslot[data-slot="${k}"] button`); }
      else if (a === 'done') { this.sel = null; this.render(); refocus(`.ux-lslot[data-slot="${k}"] button`); }
    });
    $('ux-lorders').addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) this.setOrder(b.dataset.id); });
    $('ux-lorders').addEventListener('keydown', (e) => {
      const i = ORDERS.findIndex((o) => o.id === this.orderId), d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      const n = ORDERS[(i + d + ORDERS.length) % ORDERS.length];
      this.setOrder(n.id);
      const b = $('ux-lorders').querySelector(`[data-id="${n.id}"]`); if (b) b.focus();
    });
    $('ux-line-how').addEventListener('click', () => this.openExplain());
    $('ux-lskip').addEventListener('click', () => this.skip());
    $('ux-lclear').addEventListener('click', () => this.clear());
    // action bar: Spustit linku (the mission's one prominent action) · Přidat buňku, before Znovu
    this.runBtn = h(`<button type="button" class="ux-ab ux-ab-main" id="ux-line-run" hidden></button>`);
    this.addBtn = h(`<button type="button" class="ux-ab" id="ux-line-add" hidden></button>`);
    $('reset').before(this.runBtn, this.addBtn);
    this.runBtn.textContent = T('run') + ' ';
    this.runBtn.appendChild(h(`<span aria-hidden="true">▶</span>`));
    this.addBtn.textContent = T('addCell');
    this.runBtn.addEventListener('click', () => this.run());
    this.addBtn.addEventListener('click', () => this.addCell());
    // chip on the 3D view: what it shows
    this.chip = h(`<span class="ux-chip-cell mono-s" hidden></span>`);
    this.chip.textContent = T('cell3d');
    P.chips.prepend(this.chip);
    // desktop: the editor starts under the top row (the objective may wrap)
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.place()).observe($('ux-top'));
    this.explainDom();
  }
  place() {
    const top = $('ux-top'), sim = document.querySelector('.sim');
    if (!top || !sim || this.root.hidden) return;
    const desk = !this.ux.panel.mqCompact.matches;
    this.root.style.top = desk ? Math.max(76, Math.round(top.getBoundingClientRect().bottom - sim.getBoundingClientRect().top + 12)) + 'px' : '';
  }

  render() {
    const on = this.on, ux = this.ux, P = ux.panel;
    this.root.hidden = !on; this.runBtn.hidden = !on; this.addBtn.hidden = !on; this.chip.hidden = !on;
    document.body.classList.toggle('ux-line-on', on);
    if (!on) { $('ux-abar').classList.remove('ux-line-ab'); return; }
    P.gripBtn.hidden = true;   // the line has no gripper action; Space and Nástroje still move the 3D arm
    $('ux-abar').classList.add('ux-ab5', 'ux-line-ab');
    const o = this.order, running = this.phase === 'running';
    // order cards
    const oc = $('ux-lorders');
    if (!oc.children.length) for (const x of ORDERS) oc.appendChild(h(`<button type="button" role="radio" class="ux-lorder" data-id="${x.id}"></button>`));
    for (const b of oc.children) {
      const x = orderById(b.dataset.id), cur = x.id === o.id, st = this.best[x.id] || 0;
      b.setAttribute('aria-checked', String(cur)); b.tabIndex = cur ? 0 : -1; b.disabled = running && !cur;
      const html = `<span class="mono ux-lo-k">${esc(T('order', { id: x.id }))}</span><span class="ux-lo-id" aria-hidden="true">${x.id}</span>` +
        `<b>${esc(T('orderF', { F: x.F }))} <span class="ux-lo-x">${esc(T('orderX', { X: num(100 * x.X, 0) }))}</span></b>` +
        `<span class="mono-s ux-lo-l">${esc(T('orderBelt', { v: cm(x.v), lambda: x.lambda }))}</span><span class="mono-s ux-lo-s">${esc(T('orderBeltS', { v: cm(x.v), lambda: x.lambda }))}</span>` +
        `<span class="mono-s ux-lo-min ux-lo-l">${esc(T('orderMin', { n: pl('robot', x.search.n) }))}</span><span class="mono-s ux-lo-min ux-lo-s">${esc(T('orderMinS', { n: x.search.n }))}</span>` +
        `<span class="ux-stars ux-lo-st">${[0, 1, 2].map((i) => `<i class="${i < st ? 'on' : ''}">★</i>`).join('')}</span>`;
      b.setAttribute('aria-label', T('orderAria', { id: x.id, F: x.F, X: num(100 * x.X, 0), v: cm(x.v), lambda: x.lambda, n: pl('robot', x.search.n) }) + ` · ${st} ★`);
      if (b.dataset.h !== html) { b.innerHTML = html; b.dataset.h = html; }
    }
    // flow labels
    const L = this.last && this.last.id === o.id && this.phase !== 'running' ? this.last : null;
    $('ux-lin').textContent = T('inflow', { lambda: o.lambda }) + ' · ' + T('beltLen', { L: LINE.length, v: cm(o.v) });
    let out = T('beltEnd');
    if (L) {
      const s = L.summary, byC = CLASSES.map((c) => [c, s.missedByClass[c].mean]).filter(([, x]) => x >= 0.05);
      out += ' ' + T('vPerMin', { m: num(s.missed.mean + s.lost.mean) }) + (byC.length ? ': ' + byC.map(([c, x]) => `${fr(c)} ${num(x)}`).join(' · ') : '');
    }
    $('ux-lout').textContent = out;
    // slots and cells
    const model = this.models[o.v];
    this.winsEl.textContent = '';
    this.slotEls.forEach((el, k) => {
      const c = this.cellAt(k), x = num(slotX(k), 2), sel = this.sel === k;
      let html;
      if (!c) html = `<span class="mono-s ux-lx">${esc(T('slot', { x }))}</span><button type="button" class="ux-ladd" data-act="add" aria-label="${esc(T('addHere', { x }))}"${running ? ' disabled' : ''}><span aria-hidden="true">+</span></button>`;
      else {
        const chips = c.fractions.length ? c.fractions.map((f) => `<i style="--c:${FR_RGB[f]}"><b aria-hidden="true"></b>${esc(fr(f))}</i>`).join('') : `<i class="none">${esc(T('noFraction'))}</i>`;
        html = `<span class="mono-s ux-lx">${esc(T('slot', { x }))}</span><button type="button" class="ux-lcell${sel ? ' sel' : ''}${c.fractions.length ? '' : ' bad'}" data-act="cell" aria-expanded="${sel}" aria-controls="ux-lpick" aria-label="${esc(T('cellAria', { x, fr: frList(c.fractions) }))}"${running ? ' disabled' : ''}>${ARM}<span class="ux-lfr">${chips}</span></button>`;
      }
      if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
      el.classList.toggle('has', !!c);
      // utilisation of this cell in the last run of this order (same line only)
      let u = '';
      if (L && c && !running) {
        const ci = L.cells.slice().sort((a, b) => a.slot - b.slot).findIndex((q) => q.slot === k && q.fractions.join() === c.fractions.join());
        if (ci >= 0) { const v = L.summary.cells[ci].utilisation.mean; u = `<span class="ux-lbar"><i style="--u:${(100 * v).toFixed(1)}%"></i></span><span>${esc(T('util', { u: num(100 * v, 0) }))}</span>`; }
      }
      if (el.util.dataset.h !== u) { el.util.innerHTML = u; el.util.dataset.h = u; }
      // reach window of the cell on the belt (measured: profile window_m per fraction, their span)
      if (c && model && c.fractions.length) {
        const w = c.fractions.map((f) => model.classes[f] && model.classes[f].window).filter(Boolean);
        if (w.length) {
          const a = slotX(k) + Math.min(...w.map((q) => q[0])), b = slotX(k) + Math.max(...w.map((q) => q[1]));
          const s = document.createElement('span');
          s.style.setProperty('--a', (100 * a / LINE.length).toFixed(2) + '%'); s.style.setProperty('--b', (100 * (b - a) / LINE.length).toFixed(2) + '%');
          if (sel) s.className = 'sel';
          this.winsEl.appendChild(s);
        }
      }
    });
    // picker
    const pk = $('ux-lpick'), c = this.sel != null ? this.cellAt(this.sel) : null;
    pk.hidden = !c || running;
    if (c && !running) {
      const x = num(slotX(c.slot), 2), full = c.fractions.length >= MAX_FRACTIONS;
      const html = `<p class="mono ux-lpick-h">${esc(T('pickTitle', { x }))}</p>` +
        `<div class="ux-lfracs" role="group" aria-label="${esc(T('pickTitle', { x }))}">${CLASSES.map((f) => { const on = c.fractions.includes(f); return `<button type="button" class="ux-lfrac" data-act="frac" data-f="${f}" aria-pressed="${on}"${!on && full ? ' disabled' : ''} style="--c:${FR_RGB[f]}"><b aria-hidden="true"></b>${esc(fr(f))}</button>`; }).join('')}</div>` +
        `<p class="mono-s muted ux-lpick-help">${esc(T('pickHelp'))}</p>` +
        `<div class="ux-lpick-b"><button type="button" class="btn btn-o" data-act="up"${c.slot === 0 ? ' disabled' : ''}>${esc(T('upstream'))}</button><button type="button" class="btn btn-o" data-act="down"${c.slot === LINE.maxCells - 1 ? ' disabled' : ''}>${esc(T('downstream'))}</button>` +
        `<button type="button" class="btn btn-o" data-act="rm">${esc(T('remove'))}</button><button type="button" class="btn btn-o" data-act="done">${esc(T('done'))}</button></div>`;
      if (pk.dataset.h !== html) { pk.innerHTML = html; pk.dataset.h = html; }
    } else pk.dataset.h = '';
    // status and buttons
    const bad = this.problemText(this.cells), n = this.cells.length;
    let status = T('count', { n, max: LINE.maxCells });
    if (!model) status += ' · ' + (this.loadErr ? T('loadFail', { err: this.loadErr }) : T('loading'));
    else if (bad) status += ' · ' + bad;
    else if (L) { const s = L.summary; status += ' · ' + T('last', { sorted: num(s.sorted.mean), purity: pct(s.purity.mean), missed: num(s.missed.mean + s.lost.mean) }); }
    $('ux-lstatus').textContent = status;
    this.runBtn.disabled = running || !model || !!bad;
    this.addBtn.disabled = running || n >= LINE.maxCells;
    $('ux-lclear').hidden = !n || running;
    $('ux-lrun').hidden = !running;
    this.root.classList.toggle('running', running);
    this.renderRun();
    this.place();
  }
  renderRun() {
    if (this.phase !== 'running' || !this.progress) return;
    const p = this.progress;
    $('ux-lrun-t').textContent = T('runOf', { k: p.k, n: p.n });
    $('ux-lrun-p').style.width = (100 * p.k / p.n).toFixed(1) + '%';
    if (!this.replay) this.replayEl.textContent = '';
    $('ux-lskip').hidden = !this.replay;
  }

  // ---------------- "Jak to počítáme" ----------------
  explainDom() {
    const sec = EXPLAIN.sections.map((s) => `<h3 class="mono">${esc(t(s.title))}</h3><ul>${s.items.map((i) => `<li>${esc(t(i))}</li>`).join('')}</ul>`).join('');
    const dlg = this.explain = h(`<div class="ux-modal ux-lexp" id="ux-line-explain" role="dialog" aria-modal="true" aria-labelledby="ux-lexp-h" hidden>
      <div class="ux-modal-in">
        <div class="ux-modal-top"><h2 id="ux-lexp-h">${esc(t(EXPLAIN.title))}</h2><button type="button" class="ux-x" aria-label="${esc(T('close'))}">×</button></div>
        <p class="ink2">${esc(t(EXPLAIN.intro))}</p>
        <div class="ux-lexp-order" id="ux-lexp-order"></div>
        ${sec}
      </div></div>`);
    document.body.appendChild(dlg);
    trapFocus(dlg);
    dlg.querySelector('.ux-x').addEventListener('click', () => this.closeExplain());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) this.closeExplain(); });
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.closeExplain(); } });
  }
  async openExplain() {
    this.lastFocus = document.activeElement;
    this.explain.hidden = false;
    this.explain.querySelector('.ux-x').focus({ preventScroll: true });
    await this.fillExplain();
  }
  closeExplain() {
    if (this.explain.hidden) return;
    this.explain.hidden = true;
    if (this.lastFocus && this.lastFocus.isConnected) this.lastFocus.focus({ preventScroll: true });
  }
  modalOpen() { return !this.explain.hidden; }
  /** the order's own lines: arrivals, belt maximum, the profile, the N_min search, and the model check against the
   *  measured mission 11 batches (DES of the same batch, 200 seeds, on the 2 cm/s profile) */
  async fillExplain() {
    const o = this.order, box = $('ux-lexp-order'), lines = [];
    lines.push(T('arrivalsUniform', { lambda: o.lambda }));
    lines.push(t(EXPLAIN.beltMax, { v: cm(o.v), max: num(beltMax(o), 0) }));
    await this.profile(o.v);
    const p = this.profiles[o.v];
    if (p) lines.push(t(EXPLAIN.profile, { policy: t('Skript (plánovač)'), v: cm(p.speed), date: p.measured_at, source: t(SOURCE[p.source] || p.source), n: p.n }));
    const s = o.search;
    if (s) lines.push(T('nminText', { id: o.id, n: s.n, passing: s.passing, total: s.total }));
    const m2 = await this.profile(0.02);
    if (m2) {
      if (this.m11Des == null) {
        const cfg = m11Config(), seeds = seedsOf(200);
        this.m11Des = seeds.reduce((a, sd) => a + simulate(cfg, { skript: m2 }, sd).totals.sorted, 0) / seeds.length;
      }
      const meas = M11_BATCH.sorted.reduce((a, b) => a + b, 0) / M11_BATCH.sorted.length;
      lines.push(t(EXPLAIN.check, { des: num(this.m11Des), measured: num(meas), runs: M11_BATCH.sorted.length }));
    }
    box.innerHTML = lines.map((x) => `<p class="mono-s">${esc(x)}</p>`).join('');
  }

  // ---------------- result card (src/ui/panel.js showWin) ----------------
  fillWin(m, res, P, cell, again) {
    const L = this.last;
    if (!L) return;
    const o = orderById(L.id), s = L.summary, st = L.stars, failed = !!res.failed;
    P.win.classList.add('ux-result-pol', 'ux-result-line');
    if (failed) {
      P.winK.textContent = `Mise ${m.n} / ${String(MISSIONS.length).padStart(2, '0')} · nesplněno`;
      P.winDemo.hidden = true; P.winStars.hidden = true;
      const pOk = s.purity.mean != null && s.purity.mean >= o.X - 1e-9;
      P.winH.textContent = s.sorted.mean < o.F - 1e-9 ? T('headFail', { sorted: num(s.sorted.mean), F: o.F }) : !pOk ? T('headFailPurity', { purity: pct(s.purity.mean), X: num(100 * o.X, 0) }) : T('headFail', { sorted: num(s.sorted.mean), F: o.F });
    } else P.winH.textContent = T('headWin', { id: o.id });
    // four metrics, each with the histogram of the player's runs of this order (this run marked)
    const all = L.prev.concat([L.rec]), n = all.length;
    const metric = (key, val, sub, ok, values, lo, hi, bins, target, ends) => {
      const d = h(`<div class="ux-lm"><dt>${esc(T(key))}</dt><dd><span>${esc(val)}</span>${ok ? '<span class="ux-wok" aria-hidden="true">✓</span>' : ''}</dd>${sub ? `<p class="mono-s ux-lm-sub">${esc(sub)}</p>` : ''}</div>`);
      d.appendChild(histEl(values, lo, hi, bins, target, ends, n > 1 ? T('histOwn', { n }) : T('histFirst'), T('histNow')));
      P.winVals.appendChild(d);
    };
    const outs = all.map((r) => r.sorted), purs = all.map((r) => r.purity), miss = all.map((r) => r.missed);
    const oHi = Math.max(o.F * 1.5, ...outs), pLo = Math.min(o.X - 0.05, ...purs), mHi = Math.max(o.lambda, ...miss);
    metric('mRobots', String(L.cells.length), T('vMin', { n: o.search.n }), st.fewest, all.map((r) => r.n), 0.5, LINE.maxCells + 0.5, LINE.maxCells, o.search.n + 0.5, ['1', String(LINE.maxCells)]);
    metric('mOutput', T('vOutput', { mean: num(s.sorted.mean) }), T('vBand', { p5: num(s.sorted.p5), p95: num(s.sorted.p95) }) + ' · ' + T('vTarget', { F: o.F }),
      s.sorted.mean >= o.F - 1e-9, outs, 0, oHi, 10, o.F, ['0', num(oHi, 0)]);
    metric('mPurity', pct(s.purity.mean), T('vTargetX', { X: num(100 * o.X, 0) }), s.purity.mean != null && s.purity.mean >= o.X - 1e-9, purs, pLo, 1, 10, o.X, [`${num(100 * pLo, 0)} %`, '100 %']);
    metric('mMissed', T('vPerMin', { m: num(s.missed.mean + s.lost.mean) }), T('vBand', { p5: num(s.missed.p5), p95: num(s.missed.p95) }), false, miss, 0, mHi, 10, null, ['0', num(mHi, 0)]);
    // named stars (the measured value next to a missed one)
    const named = failed ? [T('starWinNo', { sorted: num(s.sorted.mean), F: o.F })] : [T('starWin'),
      st.purity ? T('starPurity', { X: num(100 * o.X, 0), seeds: L.seeds }) : T('starPurityNo', { p: pct(st.minPurity) }),
      st.fewest ? T('starMin', { n: o.search.n }) : T('starMinNo', { n: L.cells.length, nmin: o.search.n })];
    P.winText.innerHTML = (L.assisted && !failed ? `<span>${esc(T('assisted'))}</span><br>` : '') + named.map((x) => `<span>${esc(x)}</span>`).join(' · ') +
      (failed ? `<br><span>${esc(T('starsNeedWin'))}</span>` : '');
    again.firstChild.textContent = T('editLine') + ' ';
    again.classList.remove('btn-act'); again.classList.add('btn-o');
    P.winStats.hidden = true;
    // where it falls short, the profile and the realism line
    let box = $('ux-wlx');
    if (!box) { box = h(`<div class="ux-wlx" id="ux-wlx"></div>`); P.winStats.after(box); }
    box.hidden = false;
    const cellsSorted = L.cells.slice().sort((a, b) => a.slot - b.slot);
    const byC = CLASSES.map((c) => `${fr(c)} ${num(s.missedByClass[c].mean)}`).join(' · ');
    const rows = cellsSorted.map((c, i) => `<li>${esc(T('cellRow', { x: num(slotX(c.slot), 2), fr: frList(c.fractions), u: num(100 * s.cells[i].utilisation.mean, 0), s: num(s.cells[i].sorted.mean / (LINE.horizon / 60)) }))}</li>`).join('');
    const p = this.profiles[o.v];
    const prof = p ? t(EXPLAIN.profile, { policy: t('Skript (plánovač)'), v: cm(p.speed), date: p.measured_at, source: t(SOURCE[p.source] || p.source), n: p.n }) : '';
    box.innerHTML = `<p class="mono ux-wlx-h">${esc(T('where'))}</p><p class="mono-s">${esc(T('missedBy', { list: byC }))}</p><ul class="ux-wlx-cells">${rows}</ul>` +
      `<p class="mono-s muted">${esc(prof)}</p>` +
      `<p class="mono-s muted ux-wlx-real">${esc(T('realism', { cap: num(o.search.cap1.sorted), v: cm(o.v) }))} <span>${esc(T('sources'))}</span> ${VENDOR_SOURCES.map((x) => `<a href="${x.href}" target="_blank" rel="noopener">${esc(x.label)}</a>`).join(', ')}</p>` +
      `<button type="button" class="ux-link" id="ux-wlx-how">${esc(T('howTo'))}</button>`;
    $('ux-wlx-how').addEventListener('click', () => this.openExplain());
  }
  /** test hook state */
  state() {
    const L = this.last;
    return { on: this.on, order: this.orderId, phase: this.phase, cells: this.cells.map((c) => ({ slot: c.slot, fractions: c.fractions.slice() })), sel: this.sel,
      assisted: this.assisted, loaded: !!this.models[this.order.v], best: Object.assign({}, this.best), runs: (this.runs[this.orderId] || []).length,
      last: L ? { id: L.id, n: L.cells.length, sorted: L.summary.sorted.mean, purity: L.summary.purity.mean, missed: L.summary.missed.mean + L.summary.lost.mean, stars: L.stars } : null,
      orders: ORDERS.map((o) => ({ id: o.id, v: o.v, lambda: o.lambda, F: o.F, X: o.X, nmin: o.search.n })), replay: !!this.replay };
  }
}

const frame = () => new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));

/** A histogram strip (SVG) of the player's runs of an order; the last value is this run (marked), a dashed line at
 *  the order's target. ends: the axis labels at lo and hi. */
function histEl(values, lo, hi, bins, target, ends, label, nowLabel) {
  const counts = histogram(values, lo, hi, bins), mx = Math.max(1, ...counts), W = 100, H = 22, bw = W / bins;
  const ck = histogram([values[values.length - 1]], lo, hi, bins).findIndex((x) => x > 0);
  const bars = counts.map((c, i) => (c ? `<rect x="${(i * bw + 0.6).toFixed(2)}" y="${(H - H * c / mx).toFixed(2)}" width="${(bw - 1.2).toFixed(2)}" height="${(H * c / mx).toFixed(2)}"${i === ck ? ' class="now"' : ''}/>` : '')).join('');
  const tx = target == null ? '' : (() => { const x = (W * (target - lo) / (hi - lo)).toFixed(2); return `<line x1="${x}" x2="${x}" y1="0" y2="${H}" class="tg"/>`; })();
  return h(`<figure class="ux-lhist"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${tx}${bars}<line x1="0" x2="${W}" y1="${H}" y2="${H}" class="ax"/></svg>` +
    `<figcaption class="mono-s"><span>${esc(ends[0])}</span><span>${esc(label)} · <b>${esc(nowLabel)}</b></span><span>${esc(ends[1])}</span></figcaption></figure>`);
}
