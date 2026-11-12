// Live mirror of the headless SIL runner (tools/sil/so101-virtual.mjs --mirror) — printedrobotics.cz.
// Opened only with ?mirror=<port> on the sim page; connects to ws://127.0.0.1:<port>/mirror (localhost only)
// and shows the virtual arm that LeRobot is driving: joint angles and the cube pose come from the runner,
// this page only renders them (its own physics is paused while the mirror is connected).
//
// Object scenes (runner --scene conveyor, tools/sil/lib/plant.mjs mirrorFrame): a frame also carries every library
// item's free-joint pose (`items`), the mocap poses (`mocap`: bins) and, on the conveyor, the slat joint positions
// (`belt.slats`). They are applied only when the frame's `scene` is the page's scene (same compiled model, so the
// same bodies and qpos addresses); a frame of another scene is reported (status 'scene') and not drawn.

export function mirrorPort(search = location.search) {
  const v = new URLSearchParams(search).get('mirror');
  return v && /^\d{2,5}$/.test(v) && +v > 0 && +v < 65536 ? +v : null;
}

const PARKED_Z = -0.5;   // parked items wait on the hidden floor (src/objects/scene.js parkSpot, z ≈ −0.745)
const finite = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);

/**
 * Pure part of the mirror: write one runner frame into MjData. Returns { ok, out: [items out on the table] } or
 * { ok: false, why } (bad frame, or another scene). Exported for the node tests.
 * sim: { mj, m, d, qadr, act, cubeBody, belt? }; scene: the page's scene profile ('plain' | 'objects' | 'conveyor').
 */
export function applyFrame(sim, f, scene = 'plain', cache = {}) {
  const { mj, m, d } = sim;
  if (!f || !f.follower || !finite(f.follower.q, 6)) return { ok: false, why: 'frame' };
  if ((f.scene || 'plain') !== scene) return { ok: false, why: 'scene', scene: f.scene || 'plain' };
  for (let i = 0; i < 6; i++) { const q = +f.follower.q[i]; d.qpos[sim.qadr[i]] = q; d.ctrl[sim.act[i]] = q; }
  const cubeAdr = sim.cubeBody >= 0 ? m.jnt_qposadr[m.body_jntadr[sim.cubeBody]] : -1;
  if (cubeAdr >= 0 && finite(f.cube, 7)) for (let k = 0; k < 7; k++) d.qpos[cubeAdr + k] = f.cube[k];
  const out = [];
  if (f.items && typeof f.items === 'object') {
    const adr = cache.items || (cache.items = new Map());
    for (const [name, p] of Object.entries(f.items)) {
      if (!finite(p, 7)) continue;
      if (!adr.has(name)) {
        const b = mj.mj_name2id(m, mj.mjtObj.mjOBJ_BODY.value, name);
        adr.set(name, b >= 0 && m.body_jntnum[b] === 1 && m.jnt_type[m.body_jntadr[b]] === 0 ? m.jnt_qposadr[m.body_jntadr[b]] : -1);
      }
      const a = adr.get(name);
      if (a < 0) continue;
      for (let k = 0; k < 7; k++) d.qpos[a + k] = p[k];
      if (p[2] > PARKED_Z) out.push(name);
    }
  }
  if (f.mocap && finite(f.mocap.pos, d.mocap_pos.length) && finite(f.mocap.quat, d.mocap_quat.length)) {
    d.mocap_pos.set(f.mocap.pos); d.mocap_quat.set(f.mocap.quat);
  }
  const belt = sim.belt;
  if (belt && f.belt && finite(f.belt.slats, belt.slats.length)) belt.slats.forEach((s, i) => { d.qpos[s.q] = f.belt.slats[i]; });
  d.qvel.fill(0);
  mj.mj_forward(m, d);
  if (belt) belt.sync();   // which slats carry (and are drawn) follows their positions
  return { ok: true, out };
}

/**
 * opts.scene: the page's scene profile; opts.onItems(names): the library items now out on the table (the page shows
 * them, hides the rest); opts.onStatus('live' | 'lost' | 'scene', detail).
 */
export function installMirror(sim, port, { onStatus = () => {}, onItems = null, scene = 'plain' } = {}) {
  const ownStep = sim.step.bind(sim), cache = {};
  let ws = null, live = false, closed = false, retry = 0, lastOut = '', wrong = null;
  const apply = (f) => {
    const r = applyFrame(sim, f, scene, cache);
    if (!r.ok) { if (r.why === 'scene' && wrong !== r.scene) { wrong = r.scene; onStatus('scene', r.scene); } return; }
    if (wrong) { wrong = null; onStatus('live'); }
    const key = r.out.join(',');
    if (onItems && key !== lastOut) { lastOut = key; onItems(r.out); }
  };
  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`ws://127.0.0.1:${port}/mirror`);
    ws.onopen = () => { live = true; retry = 0; sim.step = () => {}; onStatus('live'); };
    ws.onmessage = (e) => { try { apply(JSON.parse(e.data)); } catch (err) { /* malformed frame: skip */ } };
    ws.onclose = () => {
      if (live) { live = false; sim.step = ownStep; onStatus('lost'); }
      if (!closed) setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
    };
  };
  connect();
  return { close() { closed = true; if (ws) ws.close(); sim.step = ownStep; }, get live() { return live; } };
}
