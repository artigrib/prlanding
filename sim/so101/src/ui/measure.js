// Měřicí buňka in the page (Nástroje → Politika, mission 12): measures the player's trained kNN policy on one cell of
// the conveyor scene, headless and fast-forwarded, and keeps the result as a policy profile (src/policy/measure.js,
// the code CI runs for profiles/skript-*.json). This is how the player's own policy gets a measured profile for the
// line of mission 13.
//
// The cell has its own MjModel (compiled again from the scene XML the page loaded) and MjData, its own World and
// ArmController, so measuring never touches the scene the player sees (World.sleep and the belt switch contacts in
// the model). The trials run in slices of ≤ 25 ms between frames (measure.js trialGen), so the page stays live and
// Zrušit stops at the next slice. A result is cached in localStorage per (model hash, speed, cell version, n): the
// same policy at the same speed is not measured twice. The Skript's CI profile at the same speed (fetched from
// profiles/) is shown next to it.

import { measureCell, measureGen, profileFrom, validateProfile, modelHash, cellVersion, MEASURE, CLASSES, OUTCOMES } from '../policy/measure.js';
import { FRACTION_CS } from '../missions.js';
import { store } from './store.js';

const $ = (id) => document.getElementById(id);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const STORE = 'policy-profiles', VER = 1, KEEP = 6;
const dec = (v, k = 0) => String(+v.toFixed(k)).replace('.', ',');
const pc = (v) => (v == null ? '–' : `${dec(100 * v)} %`);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** what failed, in the words of the mission 12 result card (src/policy/knn.js CAUSES) */
export const FAIL_CS = {
  miss: 'minul úchop', knock_off: 'shodil z pásu', drop_belt: 'upustil na pás', drop_off: 'upustil mimo koš',
  drop_other_bin: 'upustil do cizího koše', wrong_bin: 'špatný koš (podle ukázky)',
  unknown: 'neznámá třída – nechal projet', late: 'nestihl (mimo dosah)', reach: 'nestihl (mimo dosah)', full: 'plný koš – nechal projet', none: 'nedostal se k němu'
};
export const SPEEDS = MEASURE.speeds;
export const NS = [5, 10, 25];

export class MeasureUI {
  constructor(pol, parent) {
    this.pol = pol; this.ux = pol.ux;
    this.cell = null; this.job = null; this.result = null; this.status = ''; this.ref = {};
    this.speed = 0.02; this.n = 10;
    this.dom(parent);
  }

  // ---------------- cache ----------------
  key(speed = this.speed, n = this.n) { return `${modelHash(this.pol.model)}|${Math.round(speed * 100)}|${cellVersion()}|${n}`; }
  cached(key) {
    const j = store.get(STORE, null);
    if (!j || j.v !== VER || !Array.isArray(j.list)) return null;
    const e = j.list.find((x) => x && x.key === key);
    return e && e.profile && !validateProfile(e.profile).length ? e.profile : null;
  }
  remember(key, profile) {
    const j = store.get(STORE, null), list = j && j.v === VER && Array.isArray(j.list) ? j.list.filter((x) => x && x.key !== key) : [];
    list.unshift({ key, profile });
    store.set(STORE, { v: VER, list: list.slice(0, KEEP) });
  }

  // ---------------- the cell ----------------
  /** A second model + data of the conveyor scene (the XML core.js wrote into the MuJoCo file system). */
  async ensureCell() {
    if (this.cell) return this.cell;
    const [{ World }, { ArmController }] = await Promise.all([import('../world.js'), import('../controller.js')]);
    const mj = this.ux.mj, m = mj.MjModel.from_xml_path('/m/scene_conveyor.xml'), d = new mj.MjData(m);
    mj.mj_resetDataKeyframe(m, d, 0); mj.mj_forward(m, d);
    const w = new World(mj, m, d);
    const sizes = {}; for (const [n, e] of Object.entries(this.ux.world.o)) if (e.lib && e.size) sizes[n] = e.size;
    w.sizes(sizes);
    const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'].map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
    this.cell = measureCell({ mj, m, d, w, ctl: new ArmController(mj, m, d, act) });
    return this.cell;
  }
  /** The Skript's CI profile at a speed (profiles/skript-<cm/s>.json), or null. */
  async reference(speed) {
    const k = Math.round(speed * 100);
    if (!(k in this.ref)) {
      this.ref[k] = null;
      try {
        const r = await fetch(new URL(`../../profiles/skript-${k}.json`, import.meta.url));
        const p = r.ok ? await r.json() : null;
        this.ref[k] = p && !validateProfile(p).length ? p : null;
      } catch (e) { this.ref[k] = null; }
    }
    return this.ref[k];
  }

  /** Změřit buňku: the cached result, or a new measurement. Returns 'cached' | 'started' | false. */
  start(o = {}) {
    if (o.speed != null && SPEEDS.includes(+o.speed)) this.speed = +o.speed;
    if (o.n != null && +o.n >= 1 && +o.n <= 100) this.n = Math.round(+o.n);
    if (this.job || !this.pol.model || this.pol.dirty()) return false;
    const key = this.key(), hit = this.cached(key);
    this.reference(this.speed).then(() => this.render());
    if (hit) { this.result = Object.assign({}, hit, { cachedHit: true }); this.status = 'Z mezipaměti: tahle politika už byla při této rychlosti změřená.'; this.render(); return 'cached'; }
    const job = this.job = { key, speed: this.speed, n: this.n, i: 0, total: this.n * CLASSES.length, t0: performance.now(), sim: 0, cancel: false, model: this.pol.model };
    this.result = null; this.status = 'Měří se…';
    this.render();
    this.ensureCell().then((C) => {
      if (job.cancel) return this.end(job, null);
      const g = measureGen(C, { kind: 'knn', model: job.model }, job.speed, job.n, { onTrial: (t, i) => { job.i = i; job.sim += t.t; } });
      const slice = () => {
        if (job.cancel) return this.end(job, null);
        const t0 = performance.now();
        try {
          while (performance.now() - t0 < 25) {
            const x = g.next();
            if (x.done) return this.end(job, x.value);
          }
        } catch (e) { this.status = 'Měření selhalo: ' + (e && e.message ? e.message : e); return this.end(job, null, true); }
        this.progress();
        setTimeout(slice, 0);
      };
      setTimeout(slice, 0);
    }).catch((e) => { this.status = 'Měřicí buňka se nenačetla: ' + (e && e.message ? e.message : e); this.end(job, null, true); });
    return 'started';
  }
  cancel() { if (this.job) this.job.cancel = true; }
  end(job, trials, failed) {
    if (this.job !== job) return;
    this.job = null;
    const wall = (performance.now() - job.t0) / 1000;
    if (trials) {
      const p = profileFrom(trials, { policy: 'knn', speed: job.speed, source: 'browser', measured_at: new Date().toISOString().slice(0, 10), model: modelHash(job.model), wall_s: Math.round(wall) });
      this.remember(job.key, p);
      this.result = p;
      this.status = `Změřeno v prohlížeči za ${mmss(wall)}: ${trials.length} předmětů, ${dec(job.sim / Math.max(wall, 1e-3), 1)}× rychleji než skutečný čas.`;
    } else if (!failed) this.status = `Zrušeno po ${job.i} z ${job.total} předmětů – nic se neuložilo.`;
    this.render();
  }

  // ---------------- DOM ----------------
  dom(parent) {
    const vOpt = SPEEDS.map((s) => `<option value="${s}">${s * 100} cm/s</option>`).join(''), nOpt = NS.map((n) => `<option value="${n}">${n}</option>`).join('');
    this.el = h(`<div class="ux-meas" id="ux-meas">
      <h4 class="mono ux-meas-h">Měřicí buňka</h4>
      <p class="ink2 ux-meas-what">Změří naučenou politiku na jedné buňce: fyzika MuJoCo bez vykreslování, zrychleně, každý předmět sám na pásu. Výsledek (úspěšnost, časy cyklu, příčiny selhání) je profil politiky pro linku v misi 13.</p>
      <div class="ux-meas-sel">
        <label class="ux-pol-sel"><span class="mono-s">Rychlost pásu</span><select id="ux-meas-v">${vOpt}</select></label>
        <label class="ux-pol-sel"><span class="mono-s">Předmětů z každé frakce</span><select id="ux-meas-n">${nOpt}</select></label>
      </div>
      <div class="ux-row2 ux-meas-btns">
        <button type="button" class="btn btn-o" id="ux-meas-go">Změřit buňku</button>
        <button type="button" class="btn btn-o" id="ux-meas-stop" hidden>Zrušit</button>
      </div>
      <progress id="ux-meas-bar" max="1" value="0" hidden></progress>
      <p class="mono-s" id="ux-meas-st" aria-live="polite"></p>
      <div id="ux-meas-res"></div>
    </div>`);
    parent.appendChild(this.el);
    $('ux-meas-v').value = String(this.speed); $('ux-meas-n').value = String(this.n);
    $('ux-meas-v').addEventListener('change', (e) => { this.speed = +e.target.value; this.result = null; this.status = ''; this.render(); });
    $('ux-meas-n').addEventListener('change', (e) => { this.n = +e.target.value; this.result = null; this.status = ''; this.render(); });
    $('ux-meas-go').addEventListener('click', () => this.start());
    $('ux-meas-stop').addEventListener('click', () => this.cancel());
    $('ux-meas-res').addEventListener('click', (e) => { if (e.target.closest('#ux-meas-dl')) this.download(); });
  }
  progress() {
    const j = this.job; if (!j) return;
    const bar = $('ux-meas-bar'); bar.hidden = false; bar.max = j.total; bar.value = j.i;
    $('ux-meas-st').textContent = `Měří se: ${j.i} z ${j.total} předmětů · ${mmss((performance.now() - j.t0) / 1000)}`;
  }
  render() {
    const run = !!this.job, ready = this.pol.model && !this.pol.dirty();
    $('ux-meas-go').disabled = run || !ready;
    $('ux-meas-stop').hidden = !run;
    $('ux-meas-v').disabled = run; $('ux-meas-n').disabled = run;
    $('ux-meas-v').value = String(this.speed);
    const sel = $('ux-meas-n');   // a test or link can ask for another n than the three offered
    if (!sel.querySelector(`option[value="${this.n}"]`)) sel.appendChild(h(`<option value="${this.n}">${this.n}</option>`));
    sel.value = String(this.n);
    $('ux-meas-bar').hidden = !run;
    if (run) this.progress();
    else $('ux-meas-st').textContent = this.status || (ready ? '' : 'Nejdřív stiskněte Naučit – měří se naučená politika.');
    // a result belongs to the model it measured: after Naučit with other demos it is not shown (it stays cached)
    if (this.result && this.result.model !== modelHash(this.pol.model)) { this.result = null; this.status = ''; }
    const res = $('ux-meas-res'); res.textContent = '';
    if (this.result && !run) res.appendChild(this.table(this.result));
  }
  table(p) {
    const el = h(`<div class="ux-meas-out"></div>`);
    el.appendChild(h(`<p class="mono-s"><b>Naučené pravidlo (kNN) + plánovač</b> · ${dec(p.speed * 100)} cm/s · ${p.n_per_class} z každé frakce · naměřeno ${p.source === 'browser' ? 'v prohlížeči' : 'v CI'} ${p.measured_at}</p>`));
    const tb = h(`<table class="ux-pol-cmp ux-meas-tab"><thead><tr><th scope="col">Frakce</th><th scope="col">Roztříděno</th><th scope="col">Úspěch na pokus</th><th scope="col">Cyklus (medián)</th><th scope="col">Selhání</th></tr></thead><tbody></tbody></table>`);
    const body = tb.lastChild;
    for (const c of CLASSES) {
      const s = p.classes[c]; if (!s) continue;
      const items = Math.round(s.sorted_per_item * s.trials), cyc = s.quantiles.t_cycle_success.p50;
      const f = OUTCOMES.slice(1).filter((k) => s.outcomes[k]).map((k) => `${FAIL_CS[k]} ${s.outcomes[k]}×`)
        .concat(Object.entries(s.passes).map(([k, v]) => `${FAIL_CS[k] || k} ${v}×`));
      body.appendChild(h(`<tr><th scope="row">${FRACTION_CS[c]}</th><td>${items} z ${s.trials}</td><td>${s.attempts ? pc(s.success_per_attempt) : '–'}</td><td>${cyc == null ? '–' : dec(cyc, 1) + ' s'}</td><td class="muted">${f.join(', ') || '–'}</td></tr>`));
    }
    el.appendChild(tb);
    const r = this.ref[Math.round(p.speed * 100)];
    if (r) el.appendChild(h(`<p class="mono-s muted">Pro srovnání Skript (plánovač) při ${dec(r.speed * 100)} cm/s: roztříděno ${pc(r.sorted_per_item)} předmětů, cyklus ${dec(r.quantiles.t_cycle_success.p50, 1)} s (medián; ${r.n_per_class} z každé frakce, naměřeno v CI ${r.measured_at}).</p>`));
    el.appendChild(h(`<button type="button" class="ux-link" id="ux-meas-dl">Stáhnout profil (JSON) <span aria-hidden="true">⤓</span></button>`));
    return el;
  }
  download() {
    const p = this.result; if (!p) return;
    const q = Object.assign({}, p); delete q.cachedHit;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(q)], { type: 'application/json' }));
    a.download = `profil-knn-${Math.round(p.speed * 100)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  /** test hook (window.__sim.measureState) */
  state() {
    const j = this.job, p = this.result;
    return { running: !!j, i: j ? j.i : null, total: j ? j.total : null, status: $('ux-meas-st').textContent, cached: !!(p && p.cachedHit), key: this.pol.model ? this.key() : null,
      result: p ? { n: p.n, n_per_class: p.n_per_class, speed: p.speed, source: p.source, model: p.model, outcomes: p.outcomes, passes: p.passes, sorted_per_item: p.sorted_per_item,
        rows: [...document.querySelectorAll('#ux-meas-res tbody tr')].map((r) => [...r.children].map((c) => c.textContent)) } : null,
      ref: !!this.ref[Math.round(this.speed * 100)] };
  }
}
