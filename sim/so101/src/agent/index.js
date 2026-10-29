// "Připojit AI": wires the agent API (sim-api.js) into the mission page and exposes it as window.so101.
// Installed by src/ux.js. The relay client and the panel load only when the visitor opens the panel.
// Never active with ?real=1 (real hardware armed): no API, no panel, nothing an AI could reach.

import { createSimApi, AgentError } from './sim-api.js';
import { chainFromModel } from '../kin.js';
import { MISSIONS } from '../missions.js';
import { t } from '../i18n/index.js';

const REOPEN = 'pr-ai-reopen';
export const REAL_ARMED = () => /[?&]real=1\b/.test(location.search);

/** Tool name -> API method (same mapping as backend/bridge-client/agent-bridge.js). */
export const TOOLS = {
  get_state: 'getState', get_scene: 'getScene', move_joints: 'moveJoints', move_to: 'moveTo', run_trajectory: 'runTrajectory', set_gripper: 'setGripper',
  home: 'home', stop: 'stop', snapshot: 'snapshot', list_missions: 'listMissions', start_mission: 'startMission',
  check_mission: 'checkMission', reset_scene: 'resetScene'
};

export function installAgent(ux, page) {
  if (REAL_ARMED() || (ux.links && ux.links.realArmed)) return null;
  const app = ux.app;
  const userBusy = () => !!(ux.ctl.dragging || ux.ctl.busy() || ux.pending || ux.teach.replaying || (ux.grab && ux.grab.active));
  let frames = 0;
  const api = createSimApi({
    mj: ux.mj, m: ux.m, d: ux.d, act: app.act, chain: chainFromModel(ux.mj, ux.m), world: ux.world, runner: ux.runner, missions: MISSIONS,
    userBusy,
    tookOver: () => userBusy() || ux.ctl.active,
    takeControl() {
      ux.ctl.cancel(); ux.pending = null; ux.teach.stopReplay(); app.stopDemo && app.stopDemo();
      if (ux.gizmo && ux.gizmo.clearPath) ux.gizmo.clearPath();
      if (ux.onboarding && ux.onboarding.active()) ux.onboarding.finish();
    },
    onTick() { if (++frames % 6 === 0) page.refreshSliders(); },
    afterMotion() { ux.ctl.syncFromCtrl(); page.refreshSliders(); },
    selectMission: (id) => ux.selectMission(id),
    resetScene: () => app.reset(),
    heldObject: () => ux.heldObject(),
    // no `hidden`: the sim keeps running in a background tab while an AI is linked (core.js background driver),
    // so TAB_HIDDEN is never sent from here. The real arm never gets this API (REAL_ARMED above).
    renderOk: () => !app.lost,
    snapshot: (a) => snapshot(ux, a),
    // object missions from the plain scene: reload into the object scene (ux.selectMission does it); the AI session
    // ends with the page, so the panel opens again by itself and shows a new code
    reloadInto(id) {
      try { sessionStorage.setItem(REOPEN, '1'); } catch (e) { /* private mode: the visitor opens the panel again */ }
      ux.panel.toast(t('Načítám předměty mise. Potom dejte AI nový kód.'));
      setTimeout(() => ux.selectMission(id), 400);   // after the reply has left
    }
  });
  ux.agent = api;
  // background tab: physics keeps running while an AI is paired or a motion runs (ArmSim.keepAlive / syncBg)
  let linked = false;
  const sim = page.sim;
  const syncBg = () => { if (sim && sim.syncBg) sim.syncBg(); };
  if (sim) sim.keepAlive = () => linked || api.busy;
  const onLink = (on) => { if (on !== linked) { linked = on; syncBg(); } };
  // tab strip: "● AI ovládá ruku — …" while an AI motion runs (restored a moment after the last one ends)
  let baseTitle = null, titleT = 0;
  api.on('motion', (e) => {
    syncBg();
    clearTimeout(titleT);
    if (e.phase === 'start') {
      if (baseTitle == null) baseTitle = document.title;
      document.title = '● ' + t('AI ovládá ruku') + ' — ' + baseTitle;
    } else if (baseTitle != null) {
      titleT = setTimeout(() => { if (!api.busy && baseTitle != null) { document.title = baseTitle; baseTitle = null; } }, 1500);
    }
  });
  // the person always wins: a slider or a key press ends the AI motion at once
  const take = () => { if (api.busy) api.userTakeover(); };
  document.getElementById('joints').addEventListener('input', take);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') take(); });

  const so101 = {
    version: 1,
    tools: Object.keys(TOOLS),
    limits: api.limits,
    /** Run one tool with API units; resolves with its structured result, rejects with {code, details}. */
    call(tool, args = {}, opts = {}) {
      const fn = TOOLS[tool] && api[TOOLS[tool]];
      if (!fn) return Promise.reject(new AgentError('NOT_SUPPORTED', { tool: String(tool).slice(0, 32) }));
      return Promise.resolve().then(() => fn.call(api, args, { signal: opts.signal }));
    },
    state: () => api.getState(),
    stop: () => api.stop(),
    estop: (on) => api.setEstop(on),
    get estopped() { return api.estop; },
    /** Open the "Připojit AI" panel (same as the button). */
    openPanel: () => openPanel()
  };
  for (const [tool, method] of Object.entries(TOOLS)) so101[method] = (args, opts) => so101.call(tool, args, opts);
  Object.defineProperty(window, 'so101', { value: Object.freeze(so101), configurable: true });

  // ---------- the panel entry in the side panel (built lazily) ----------
  const mount = document.createElement('section');
  mount.className = 'ai-box';
  mount.setAttribute('aria-labelledby', 'ai-h');
  mount.innerHTML = `<p class="mono" id="ai-h">${t('Ovládání přes AI')}</p>
    <p class="ink2 ai-lead">${t('Nechte svého Clauda (nebo jiného AI asistenta s MCP) ovládat tuto simulovanou ruku.')}</p>
    <button type="button" class="btn btn-o" id="ai-open" aria-expanded="false" aria-controls="ai-panel">${t('Připojit AI')} <span aria-hidden="true">✦</span></button>
    <div id="ai-panel" hidden></div>`;
  const anchor = document.getElementById('ux-teach') || document.querySelector('.row-b');
  anchor.after(mount);
  const btn = mount.querySelector('#ai-open');
  // "Zeptej se AI" on the mission card: opens the panel at the prompt for the current mission
  const mbox = document.querySelector('.mission');
  if (mbox) {
    const ask = document.createElement('button');
    ask.type = 'button'; ask.className = 'ux-link ai-askm'; ask.id = 'ai-ask-mission';
    ask.innerHTML = `${t('Zeptej se AI na tuto misi')} <span aria-hidden="true">✦</span>`;
    ask.addEventListener('click', () => { openPanel().then(() => loading && loading.then((p) => p && p.showMissionPrompt())); });
    mbox.appendChild(ask);
  }
  let loading = null;
  function openPanel() {
    if (!loading) {
      loading = import('./panel.js').then((m) => m.mountAgentPanel(mount.querySelector('#ai-panel'), { api, ux, button: btn, onLink }))
        .catch((e) => { console.error(e); loading = null; ux.panel.toast(t('Panel AI se nepodařilo načíst. Zkuste to znovu.'), 'err'); });
    }
    return loading.then((p) => p && p.open());
  }
  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-expanded') === 'true') { if (loading) loading.then((p) => p && p.collapse()); return; }
    openPanel();
  });
  try { if (sessionStorage.getItem(REOPEN)) { sessionStorage.removeItem(REOPEN); setTimeout(openPanel, 300); } } catch (e) { /* ignore */ }
  return api;
}

// ---------- camera snapshot (rendered from the sim's own three.js scene, modest resolution) ----------
const VIEWS = {
  overview: { pos: [0.45, 0.42, -0.55], at: [0.15, 0.08, -0.01] },
  top: { pos: [0.16, 0.85, 0.0001], at: [0.16, 0, 0], up: [1, 0, 0] },   // robot x (forward) points up in the image
  side: { pos: [0.18, 0.16, -0.78], at: [0.18, 0.12, 0] }
};

const BG = '#e9e9e4';
/** true when the snapshot holds (almost) nothing but the background fill: the WebGL draw produced no scene */
function blankCanvas(c2, w, h) {
  const px = c2.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 0; i < px.length; i += 16) {             // every 4th pixel is plenty
    if (Math.abs(px[i] - 0xe9) + Math.abs(px[i + 1] - 0xe9) + Math.abs(px[i + 2] - 0xe4) > 12) n++;
  }
  return n < (w * h / 4) * 0.01;                         // under 1 % of the image differs from the fill
}

/**
 * Wait, without blocking the page, until the GPU has finished the work already queued (earlier frames). The
 * snapshot's read-back below is synchronous and would otherwise wait for that backlog on the main thread; with a
 * slow (software) GPU that can take long enough to starve the relay heartbeat. WebGL2 fence, polled by timer.
 */
async function gpuIdle(gl, maxMs = 120000) {
  if (!gl || !gl.fenceSync) return;
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return;
  gl.flush();
  try {
    for (const t0 = performance.now(); performance.now() - t0 < maxMs;) {
      const s = gl.clientWaitSync(sync, 0, 0);
      if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED || s === gl.WAIT_FAILED) return;
      await new Promise((res) => setTimeout(res, 15));
    }
  } finally { gl.deleteSync(sync); }
}

async function snapshot(ux, a) {
  const app = ux.app, T = ux.T, r = app.renderer, d = ux.d, m = ux.m;
  if (app.lost) throw new AgentError('RENDER_UNAVAILABLE');
  await gpuIdle(r.getContext());
  if (app.lost) throw new AgentError('RENDER_UNAVAILABLE');
  // a background tab steps physics without syncing the meshes (core.js bgTick): bring them up to date first
  app.sync(); if (ux.extras) ux.extras.sync();
  const width = a.width || 512, height = Math.round(width * 0.75);
  let cam;
  if (a.view === 'wrist') {
    const ci = ux.mj.mj_name2id(m, ux.mj.mjtObj.mjOBJ_CAMERA.value, 'wrist_cam');
    if (ci < 0) throw new AgentError('NOT_SUPPORTED', { view: 'wrist' });
    cam = new T.PerspectiveCamera(70, width / height, 0.005, 5);
    const p = d.cam_xpos, M = d.cam_xmat, o3 = 3 * ci, o9 = 9 * ci, mat = new T.Matrix4();
    mat.set(M[o9], M[o9 + 1], M[o9 + 2], p[o3], M[o9 + 3], M[o9 + 4], M[o9 + 5], p[o3 + 1], M[o9 + 6], M[o9 + 7], M[o9 + 8], p[o3 + 2], 0, 0, 0, 1);
    app.world.updateMatrixWorld();
    cam.matrixAutoUpdate = false;
    cam.matrixWorld.multiplyMatrices(app.world.matrixWorld, mat);
    cam.matrixWorld.decompose(cam.position, cam.quaternion, cam.scale);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  } else {
    const v = VIEWS[a.view] || VIEWS.overview;
    cam = new T.PerspectiveCamera(40, width / height, 0.01, 10);
    cam.position.set(...v.pos);
    if (v.up) cam.up.set(...v.up);
    cam.lookAt(new T.Vector3(...v.at));
    cam.updateMatrixWorld(true);
  }
  const size = r.getSize(new T.Vector2()), ratio = r.getPixelRatio();
  const out = document.createElement('canvas');
  out.width = width; out.height = height;
  const g = ux.gizmo, hide = g ? [g.root, g.ghost, g.drop, g.foot].filter(Boolean) : [];
  const vis = hide.map((o) => o.visible);
  const c2 = out.getContext('2d', { willReadFrequently: true });
  // render on demand into the output canvas; a hidden or busy tab can hand back an empty drawing buffer, so the
  // result is checked and rendered once more before giving up (never send an empty image to the AI)
  const draw = () => {
    r.shadowMap.needsUpdate = true;
    r.render(app.scene, cam);
    c2.fillStyle = BG;     // the WebGL canvas is transparent (CSS gradient behind it); JPEG has no alpha
    c2.fillRect(0, 0, width, height);
    c2.drawImage(r.domElement, 0, 0, width, height);   // same task: the drawing buffer is still valid
    return !blankCanvas(c2, width, height);
  };
  let drawn = false;
  try {
    hide.forEach((o) => { o.visible = false; });       // the real scene only: no gizmo, ghost or path preview
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    r.setScissorTest(false);
    r.setViewport(0, 0, width, height);
    drawn = draw();
    if (!drawn) {                                       // retry once after a forced, completed render
      const gl = r.getContext(); app.sync(); if (ux.extras) ux.extras.sync();
      if (gl && gl.finish) gl.finish();
      drawn = draw();
    }
  } finally {
    hide.forEach((o, i) => { o.visible = vis[i]; });
    r.setPixelRatio(ratio);
    r.setSize(size.x, size.y, false);
    r.setViewport(0, 0, size.x, size.y);
    // repaint the page view, but not in a hidden tab: nobody sees it, and with software GL a full-size frame can
    // block the page for seconds (the relay heartbeat must keep flowing)
    if (!document.hidden) { if (ux.cameras) ux.cameras.render(); else r.render(app.scene, app.camera); }
  }
  if (!drawn) throw new AgentError('RENDER_UNAVAILABLE', { reason: 'empty_render' });
  const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.82));
  if (!blob || !blob.size) throw new AgentError('RENDER_UNAVAILABLE', { reason: 'empty_image' });
  return { blob, view: a.view || 'overview', width, height, sim_time_s: Math.round(d.time * 10) / 10 };
}
