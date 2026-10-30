// ROBOTO ORIGIN simulation page (printedrobotics.cz code; the robot model, meshes and policy are RoboParty's,
// see NOTICE.txt). Showcase: linked from the catalogue (PR_SHOWCASE card) and the home news list.
// One script for both languages: <html lang="cs"> (sim/origin/) and <html lang="en"> (en/sim/origin/).

import { loadOrigin, OriginSim, GROUPS, hasWebGL } from './core.js';
import { JOINTS, CMD_RANGE, DEFAULT_Q } from './src/policy.js';

const EN = document.documentElement.lang === 'en';
const $ = (id) => document.getElementById(id);
const TEST = new URLSearchParams(location.search).get('test') === '1';

const S = EN ? {
  ready: 'Simulation ready. Walk with W A S D or the arrow keys.', fail: 'Something went wrong while loading. Try reloading the page or another browser.',
  lost: 'The browser reset its graphics. Wait a moment or reload the page.',
  walkHud: 'Walking policy is in control · W/S speed · A/D turn · Q/E sideways', standHud: 'On the gantry · move the joints with the sliders',
  fell: 'It fell over. Press “Stand up” to reset.', pushed: (n) => `Pushed: ${n}`, noPolicy: 'The walking policy could not start in this browser, so the robot stays on the gantry.',
  groups: { lleg: 'Left leg', rleg: 'Right leg', torso: 'Waist', larm: 'Left arm', rarm: 'Right arm' },
  cmd: (c) => `forward ${c.vx.toFixed(2)} m/s · sideways ${c.vy.toFixed(2)} m/s · turn ${c.yaw.toFixed(2)} rad/s`,
  live: 'live', target: 'target'
} : {
  ready: 'Simulace je připravená. Choďte klávesami W A S D nebo šipkami.', fail: 'Při načítání nastala chyba. Zkuste stránku obnovit, případně jiný prohlížeč.',
  lost: 'Grafika prohlížeče se resetovala. Počkejte chvíli, nebo obnovte stránku.',
  walkHud: 'Řídí naučená politika chůze · W/S rychlost · A/D otáčení · Q/E do strany', standHud: 'Na stojanu · klouby ovládáte posuvníky',
  fell: 'Spadl. Tlačítkem „Postavit“ ho vrátíte na nohy.', pushed: (n) => `Strčili jste: ${n}`, noPolicy: 'Politika chůze se v tomhle prohlížeči nespustila, robot proto zůstává na stojanu.',
  groups: { lleg: 'Levá noha', rleg: 'Pravá noha', torso: 'Pas', larm: 'Levá ruka', rarm: 'Pravá ruka' },
  cmd: (c) => `vpřed ${c.vx.toFixed(2)} m/s · do strany ${c.vy.toFixed(2)} m/s · otáčení ${c.yaw.toFixed(2)} rad/s`,
  live: 'skutečnost', target: 'cíl'
};
// joint labels from the MJCF names: left_thigh_yaw_joint -> "thigh yaw"
const PART = EN ? { thigh: 'hip', knee: 'knee', ankle: 'ankle', arm: 'shoulder', elbow: 'elbow', torso: 'waist' }
  : { thigh: 'kyčel', knee: 'koleno', ankle: 'kotník', arm: 'rameno', elbow: 'loket', torso: 'pas' };
const AXIS = EN ? { yaw: 'yaw', roll: 'roll', pitch: 'pitch' } : { yaw: 'rotace', roll: 'odklon', pitch: 'předklon' };
function jointLabel(n) {
  const p = n.replace(/^(left|right)_/, '').replace(/_joint$/, '').split('_');
  return (PART[p[0]] || p[0]) + (p[1] ? ' – ' + (AXIS[p[1]] || p[1]) : '');
}

function fail(msg) {
  $('loader').hidden = true; $('fail').hidden = false;
  if (msg) $('fail-msg').textContent = msg;
  if (TEST) window.__origin = { error: msg || 'fail' };
}

if (typeof WebAssembly !== 'object' || !hasWebGL()) fail();
else main().catch((e) => { console.error(e); fail(S.fail); });

async function main() {
  const t0 = performance.now();
  const ctx = await loadOrigin((f) => { $('prog').style.width = (f * 100).toFixed(1) + '%'; }, { noPolicy: new URLSearchParams(location.search).get('policy') === '0' });
  const sim = new OriginSim(ctx, {
    canvas: $('c'),
    onInteract: () => { $('hint').hidden = true; },
    onContextLost: () => { $('fail-msg').textContent = S.lost; $('fail').hidden = false; },
    onContextRestored: () => { $('fail').hidden = true; },
    onPush: (n) => flash(S.pushed(n.replace(/_link$/, '').replace(/_/g, ' ')))
  });
  const ui = new Page(sim, ctx.policyError);
  $('loader').hidden = true; $('hud').hidden = false; $('hint').hidden = false;
  $('sr').textContent = S.ready;
  if (TEST) { window.__origin = ui.api(); window.__origin.loadMs = Math.round(performance.now() - t0); }
  addEventListener('pagehide', (e) => { if (!e.persisted) sim.dispose(); });
}

/** A drag stick: calls set({x, y}) with -1..1 (y down). Touch never scrolls or zooms the page while on it. */
function bindStick(pad, knob, set, horizontal = false) {
  let id = null;
  const move = (e) => {
    const r = pad.getBoundingClientRect(), Rx = r.width / 2, Ry = r.height / 2;
    let x = (e.clientX - r.left - Rx) / (horizontal ? Rx - 23 : Rx), y = horizontal ? 0 : (e.clientY - r.top - Ry) / Ry;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    set({ x, y }); knob.style.transform = `translate(${x * (horizontal ? Rx - 23 : Rx * 0.6)}px, ${y * Ry * 0.6}px)`;
  };
  const end = (e) => { if (e && e.pointerId !== id) return; id = null; set({ x: 0, y: 0 }); knob.style.transform = ''; };
  pad.addEventListener('pointerdown', (e) => { id = e.pointerId; try { pad.setPointerCapture(id); } catch (err) {} move(e); e.preventDefault(); });
  pad.addEventListener('pointermove', (e) => { if (e.pointerId === id) { move(e); e.preventDefault(); } });
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
  // iOS Safari: block scroll / pinch-zoom from touches that start on the stick
  for (const t of ['touchstart', 'touchmove']) pad.addEventListener(t, (e) => e.preventDefault(), { passive: false });
}

let flashT = 0;
function flash(text) { $('hud-text').textContent = text; flashT = performance.now() + 1500; }

class Page {
  constructor(sim, policyError) {
    this.sim = sim; this.keys = new Set(); this.pad = { x: 0, y: 0 }; this.tmove = { x: 0, y: 0 }; this.tturn = { x: 0, y: 0 }; this.forced = null;
    this.cmd = { vx: 0, vy: 0, yaw: 0 };
    this.sliders();
    this.controls();
    if (!sim.policy) {
      $('mode-walk').disabled = true; $('mode-stand').checked = true;
      $('nopolicy').textContent = S.noPolicy; $('nopolicy').hidden = false;
      if (policyError) console.warn('policy:', policyError);
    }
    sim.onPolicyError = () => { $('mode-walk').disabled = true; $('mode-stand').checked = true; $('nopolicy').textContent = S.noPolicy; $('nopolicy').hidden = false; this.syncMode(); };
    sim.onFall = () => { $('sr').textContent = S.fell; };
    sim.onLowQuality = () => { $('perf').hidden = false; };
    sim.onSlow = () => { $('perf').hidden = false; $('simple-wrap').hidden = false; };
    $('simple').addEventListener('change', (e) => sim.setSimple(e.target.checked));
    sim.onFrame = (dt) => this.input(dt);
    sim.onAfter = () => this.render();
    this.syncMode();
  }

  sliders() {
    const fs = $('joints'); this.inputs = []; this.outs = [];
    for (const g of GROUPS) {
      const box = document.createElement('div'); box.className = 'jg';
      box.innerHTML = `<p class="mono jg-h">${S.groups[g.id]}</p>`;
      for (const j of g.joints) {
        const [lo, hi] = this.sim.range[j], idn = 'j' + j;
        const row = document.createElement('div'); row.className = 'jn';
        row.innerHTML = `<label for="${idn}">${jointLabel(JOINTS[j])}</label><output id="${idn}-o" for="${idn}">0°</output>` +
          `<input type="range" id="${idn}" min="${lo}" max="${hi}" step="0.01" value="${DEFAULT_Q[j]}">`;
        box.appendChild(row);
        const inp = row.querySelector('input');
        inp.addEventListener('input', () => this.sim.setSlider(j, +inp.value));
        this.inputs[j] = inp; this.outs[j] = row.querySelector('output');
      }
      fs.appendChild(box);
    }
  }

  controls() {
    const sim = this.sim;
    for (const r of document.querySelectorAll('input[name="mode"]')) r.addEventListener('change', () => { if (r.checked) { sim.setMode(r.value); this.syncMode(); } });
    $('shove').addEventListener('click', () => sim.shove());
    $('drop').addEventListener('click', () => { sim.drop(); this.syncMode(); });
    $('standup').addEventListener('click', () => { sim.reset(); this.syncMode(); });
    $('pose').addEventListener('click', () => { sim.resetPose(); this.syncSliders(); });
    $('explode').addEventListener('change', (e) => { sim.explodeTo = e.target.checked ? 1 : 0; });
    $('view').addEventListener('click', () => sim.resetView());
    // keyboard: only when focus is not in a form control (sliders use the arrow keys)
    const owns = (e) => !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement);
    const K = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    addEventListener('keydown', (e) => { if (K.includes(e.code) && owns(e) && !e.ctrlKey && !e.metaKey && !e.altKey) { this.keys.add(e.code); e.preventDefault(); } });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // panel joystick (desktop): up = forward, left/right = turn
    bindStick($('pad'), $('knob'), (v) => { this.pad = v; });
    // touch overlay on the canvas: left stick walks (up/down) and sidesteps (left/right), right control turns
    bindStick($('tpad-move'), $('tknob-move'), (v) => { this.tmove = v; });
    bindStick($('tpad-turn'), $('tknob-turn'), (v) => { this.tturn = v; }, true);
    $('t-standup').addEventListener('click', () => { sim.reset(); this.syncMode(); });
  }

  input(dt) {
    let vx = 0, vy = 0, yaw = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) vx += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) vx -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) yaw += 1;
    if (k.has('KeyD') || k.has('ArrowRight')) yaw -= 1;
    if (k.has('KeyQ')) vy += 1;
    if (k.has('KeyE')) vy -= 1;
    vx -= this.pad.y; yaw -= this.pad.x;
    vx -= this.tmove.y; vy -= this.tmove.x; yaw -= this.tturn.x;
    try {
      const gp = navigator.getGamepads && [...navigator.getGamepads()].find((g) => g && g.connected);
      if (gp) {
        const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
        vx -= dz(gp.axes[1] || 0); yaw -= dz(gp.axes[0] || 0); vy -= dz(gp.axes[2] || 0);
      }
    } catch (e) { /* gamepad access can be blocked by permissions policy */ }
    const scale = (v, [lo, hi]) => (v >= 0 ? Math.min(1, v) * hi : Math.max(-1, v) * -lo);
    const want = this.forced || { vx: scale(vx, CMD_RANGE.vx), vy: scale(vy, CMD_RANGE.vy), yaw: scale(yaw, CMD_RANGE.yaw) };
    const a = Math.min(1, dt * 4);                              // smooth ramps (the policy dislikes step commands)
    for (const key of ['vx', 'vy', 'yaw']) this.cmd[key] += (want[key] - this.cmd[key]) * (this.forced ? 1 : a);
    this.sim.setCmd(this.cmd);
  }

  syncMode() {
    const walk = this.sim.mode === 'walk';
    $('mode-walk').checked = walk; $('mode-stand').checked = !walk;
    $('walkbox').hidden = !walk;
    $('c').closest('.stage').classList.toggle('is-stand', !walk);
    $('joints').disabled = walk;
    $('joints-note').textContent = walk ? (EN ? 'The policy moves the joints; the sliders show the live angles.' : 'Klouby teď řídí politika; posuvníky ukazují skutečné úhly.')
      : (EN ? 'The robot hangs on a gantry; each slider sets a joint target.' : 'Robot visí na stojanu; každý posuvník nastavuje cíl jednoho kloubu.');
    if (!walk) this.syncSliders();
  }

  touchUi() { return getComputedStyle($('touch')).display !== 'none'; }

  syncSliders() { for (let j = 0; j < JOINTS.length; j++) this.inputs[j].value = this.sim.sliders[j]; }

  render() {
    const sim = this.sim, walk = sim.mode === 'walk';
    this.n = (this.n || 0) + 1;
    if (this.n % 6 === 0) {
      for (let j = 0; j < JOINTS.length; j++) {
        const q = sim.q(j);
        if (walk) this.inputs[j].value = q;
        this.outs[j].textContent = Math.round(q * 57.2958) + '°';
      }
      $('cmd').textContent = S.cmd(sim.cmd);
    }
    if (performance.now() > flashT) {
      const t = sim.fallen ? S.fell : walk ? (this.touchUi() ? $('touch').dataset.hud : S.walkHud) : S.standHud;
      if ($('hud-text').textContent !== t) $('hud-text').textContent = t;
    }
    $('hud-dot').classList.toggle('bad', !!sim.fallen);
    $('standup').classList.toggle('btn-act', !!sim.fallen);
  }

  api() {
    const sim = this.sim;
    return {
      ready: true, policy: !!sim.policy,
      mode: () => sim.mode,
      setMode: (m) => { sim.setMode(m); this.syncMode(); return sim.mode; },
      setCmd: (c) => { this.forced = c ? { vx: 0, vy: 0, yaw: 0, ...c } : null; this.input(1); return sim.cmd; },
      advance: (sec) => sim.advance(sec),
      pause: (p) => { sim.paused = !!p; },
      shove: (dir) => sim.shove(sim.base, dir),
      drop: () => sim.drop(),
      reset: () => sim.reset(),
      explode: (v) => { sim.explodeTo = sim.exploded = v ? 1 : 0; sim.sync(); },
      setSlider: (j, v) => { sim.setSlider(j, v); this.syncSliders(); },
      state: () => { const q = sim.d.qpos; return { cmd: { ...sim.cmd }, t: sim.d.time, x: q[0], y: q[1], z: q[2], fallen: sim.fallen, mode: sim.mode, policyMs: sim.policyMs, ticks: sim.policyTicks }; },
      fps: () => sim.fps,
      lowQ: () => !!sim.lowQ,
      slow: () => !!sim.slowOffered,
      simple: (on) => { sim.setSimple(on); return sim.simple; },
      render: () => { sim.sync(); sim.renderer.render(sim.scene, sim.camera); }
    };
  }
}
