// SO-101 in-browser simulation — mission page (printedrobotics.cz)
// Physics/rendering live in core.js (shared with the setup wizard in nastaveni/).
// Model: MuJoCo Menagerie robotstudio_so101 (Apache-2.0), see NOTICE.txt.

import './src/i18n/index.js'; // first: English translation (?lang=en) starts before any UI is built
import { COLORS, JOINTS, DEMO, DemoPlayer, ArmSim, loadSim, hasWebGL } from './core.js';

const $ = (id) => document.getElementById(id);
const TEST = new URLSearchParams(location.search).get('test') === '1';  // Playwright hook only

function fail(msg) {
  $('loader').hidden = true;
  $('fail').hidden = false;
  document.body.classList.add('sim-fail');
  if (msg) $('fail-msg').textContent = msg;
  if (TEST) window.__sim = { error: msg || 'fail' };
}
if (typeof WebAssembly !== 'object' || !hasWebGL()) {
  fail();
} else {
  main().catch((e) => {
    console.error(e);
    fail('Při načítání simulace nastala chyba. Zkuste stránku obnovit, případně jiný prohlížeč.');
  });
}

async function main() {
  const t0 = performance.now();
  const bar = $('prog');
  const copy = loadingCopy(t0);   // [ux-hook:loading] honest progress text on slow networks
  const ctx = await loadSim((f) => { bar.style.width = (f * 100).toFixed(1) + '%'; copy(f); });
  copy.done();
  const sim = new ArmSim(ctx, {
    canvas: $('c'),
    onInteract: () => { $('hint').hidden = true; },
    onContextLost: () => {
      $('fail-msg').textContent = 'Grafika prohlížeče se resetovala. Počkejte chvíli, nebo obnovte stránku.';
      $('reload').hidden = false; $('fail').hidden = false;
    },
    onContextRestored: () => { $('fail').hidden = true; $('reload').hidden = true; }
  });
  $('reload').addEventListener('click', () => location.reload());
  const app = new MissionPage(sim);
  // [ux-hook:install] optional UX layer (src/ux.js: smart move, missions, replay, cameras, exploded view…).
  // The plain slider sim keeps working if it fails to load.
  try { await (await import('./src/ux.js')).install(app, { THREE: ctx.THREE, mj: ctx.mj, TEST }); }
  catch (e) { console.warn('UX layer disabled:', e); app.ux = null; sim.onRender = null; }
  $('loader').hidden = true;
  $('hud').hidden = false;
  $('hint').hidden = false;
  $('sr').textContent = 'Simulace je připravena, ovládání je dostupné.';
  if (TEST) { window.__sim = app.api(); window.__sim.loadMs = Math.round(performance.now() - t0); }
  // free WASM heap objects (Embind handles are not garbage-collected)
  addEventListener('pagehide', (e) => { if (!e.persisted) sim.dispose(); });
}

// ---------- [ux-hook:loading] progress text: size, percent, time left (from the recent rate) ----------
function loadingCopy(t0) {
  const sub = $('loader-sub'), MB = 11.6, hist = [];
  let last = 0;
  const tick = setInterval(() => upd(last), 1000);
  function upd(f) {
    const now = performance.now(), el = (now - t0) / 1000;
    hist.push([now, f]); while (hist.length > 1 && now - hist[0][0] > 3000) hist.shift();
    if (el < 3) return;                                   // fast connections never see the numbers
    const [ta, fa] = hist[0], rate = (f - fa) / Math.max(0.001, (now - ta) / 1000);
    let txt = `Stahujeme fyzikální engine (${MB.toLocaleString('cs-CZ')} MB)… ${Math.round(f * 100)} %`;
    if (rate > 0.002 && f < 0.98) { const left = (1 - f) / rate; txt += ` · ještě asi ${left > 90 ? Math.round(left / 60) + ' min' : Math.max(1, Math.round(left / 5) * 5) + ' s'}`; }
    txt += ' · příště se načte z mezipaměti';
    if (el > 15) txt += '. Mezitím: v simulaci kliknete na kostku a ruka ji sama vezme.';
    if (txt !== sub.textContent) sub.textContent = txt;
  }
  const fn = (f) => { last = f; upd(f); };
  fn.done = () => clearInterval(tick);
  return fn;
}

class MissionPage {
  constructor(sim) {
    this.sim = sim; this.demo = null;
    this.ux = null;
    sim.onFrame = (dt) => { if (this.ux) this.ux.pre(dt); this.tickDemo(dt); };    // [ux-hook:pre]
    sim.onAfter = (dt) => { if (!(this.ux && this.ux.check(dt))) this.hud(sim.check(dt)); };  // [ux-hook:check]
    sim.onWin = () => this.win();
    this.ui();
    this.setColor(this.loadColor());
  }

  ui() {
    const box = $('joints'), sim = this.sim;
    this.sliders = JOINTS.map((j, i) => {
      const [lo, hi] = sim.range[i];
      const wrap = document.createElement('div'); wrap.className = 'jn' + (j.grip ? ' grip' : '');
      const id = 'j-' + j.name;
      wrap.innerHTML = `<label for="${id}">${j.label}</label><output for="${id}"></output>` +
        `<input type="range" id="${id}" min="${lo}" max="${hi}" step="any">`;
      const input = wrap.querySelector('input'), out = wrap.querySelector('output');
      input.addEventListener('input', () => { this.stopDemo(); this.setCtrl(i, +input.value); });
      box.appendChild(wrap);
      return { input, out, grip: !!j.grip, lo, hi };
    });
    box.disabled = false;
    for (const b of ['home', 'reset', 'demo']) $(b).disabled = false;
    $('home').addEventListener('click', () => { this.stopDemo(); sim.goHome(); this.refreshSliders(); });
    $('reset').addEventListener('click', () => this.reset());
    $('again').addEventListener('click', () => this.reset());
    $('demo').addEventListener('click', () => this.startDemo());
    $('cta').addEventListener('click', () => { try { window.dataLayer && window.dataLayer.push({ event: 'sim_cta', robot: 'so101' }); } catch (e) {} });

    const sw = $('sw');
    this.swatches = COLORS.map((c) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.title = c.name; b.setAttribute('aria-label', c.name);
      b.style.background = c.hex; b.dataset.id = c.id;
      b.addEventListener('click', () => this.setColor(c.id));
      sw.appendChild(b); return b;
    });
    this.refreshSliders();
  }

  setCtrl(i, v) { this.sim.setCtrl(i, v); this.refreshSlider(i); }
  refreshSlider(i) {
    const s = this.sliders[i], v = this.sim.ctrl(i);
    s.input.value = v;
    s.out.textContent = s.grip
      ? (v < 0.15 ? 'zavřeno' : Math.round((v - s.lo) / (s.hi - s.lo) * 100) + ' % otevřeno')
      : Math.round(v * 180 / Math.PI) + '°';
  }
  refreshSliders() { for (let i = 0; i < this.sliders.length; i++) this.refreshSlider(i); }

  setColor(id) {
    const c = COLORS.find((x) => x.id === id) || COLORS[0];
    this.sim.setColor(c.hex);
    for (const b of this.swatches) b.setAttribute('aria-checked', String(b.dataset.id === c.id));
    try { localStorage.setItem('pr-sim-color', c.id); } catch (e) {}
    this.color = c.id;
  }
  loadColor() { try { return localStorage.getItem('pr-sim-color') || 'white'; } catch (e) { return 'white'; } }

  reset() {
    this.stopDemo();
    this.sim.reset();
    const hadFocus = $('win').contains(document.activeElement);
    $('win').hidden = true;
    if (hadFocus) $('demo').focus({ preventScroll: true });
    if (this.ux) this.ux.onReset();  // [ux-hook:reset] mission layout, controller sync
    this.refreshSliders();
  }

  startDemo() {
    if (this.ux && this.ux.startDemo()) return;  // [ux-hook:demo] per-mission planner solution
    this.reset();
    this.demo = new DemoPlayer(this.sim.act.map((_, i) => this.sim.ctrl(i)), this.sim.home);
  }
  stopDemo() { this.demo = null; }
  tickDemo(dt) {
    if (!this.demo) return;
    const q = this.demo.tick(dt);
    if (!q) { this.demo = null; return; }
    q.forEach((v, i) => this.sim.setCtrl(i, v));
    this.refreshSliders();
  }

  hud({ text, ok }) {
    // write only on change: #hud-text is a live region
    if (text !== this.hudText) { $('hud-text').textContent = text; this.hudText = text; }
    if (ok !== this.hudOk) { $('hud').classList.toggle('ok', ok); this.hudOk = ok; }
  }

  win() {
    $('win').hidden = false;
    $('win-h').focus({ preventScroll: true });
    try { window.dataLayer && window.dataLayer.push({ event: 'sim_success', robot: 'so101' }); } catch (e) {}
  }

  api() {
    const sim = this.sim;
    const api = {
      ready: true,
      setTargets: (q) => { this.stopDemo(); q.forEach((v, i) => v != null && this.setCtrl(i, v)); },
      state: () => ({
        qpos: Array.from(sim.d.qpos), ctrl: Array.from(sim.d.ctrl),
        cube: Array.from(sim.d.xpos.subarray(3 * sim.cubeBody, 3 * sim.cubeBody + 3)),
        won: sim.won, hud: this.hudText, color: this.color, time: sim.d.time
      }),
      demo: () => this.startDemo(),
      advance: (sec) => sim.advance(sec, sim.m.opt.timestep),
      reset: () => this.reset(),
      setColor: (id) => this.setColor(id),
      DEMO,
      _app: this
    };
    return this.ux ? this.ux.extendApi(api) : api;  // [ux-hook:api] test hooks of the UX layer
  }
}
