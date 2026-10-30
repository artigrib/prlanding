// Live mirror of the headless SIL runner (tools/sil/so101-virtual.mjs --mirror) — printedrobotics.cz.
// Opened only with ?mirror=<port> on the sim page; connects to ws://127.0.0.1:<port>/mirror (localhost only)
// and shows the virtual arm that LeRobot is driving: joint angles and the cube pose come from the runner,
// this page only renders them (its own physics is paused while the mirror is connected).

export function mirrorPort(search = location.search) {
  const v = new URLSearchParams(search).get('mirror');
  return v && /^\d{2,5}$/.test(v) && +v > 0 && +v < 65536 ? +v : null;
}

export function installMirror(sim, port, { onStatus = () => {} } = {}) {
  const { mj, m, d } = sim;
  const cubeAdr = sim.cubeBody >= 0 ? m.jnt_qposadr[m.body_jntadr[sim.cubeBody]] : -1;
  const ownStep = sim.step.bind(sim);
  let ws = null, live = false, closed = false, retry = 0;
  const apply = (f) => {
    if (!f || !f.follower || !Array.isArray(f.follower.q) || f.follower.q.length !== 6) return;
    for (let i = 0; i < 6; i++) { const q = +f.follower.q[i]; if (Number.isFinite(q)) { d.qpos[sim.qadr[i]] = q; d.ctrl[sim.act[i]] = q; } }
    if (cubeAdr >= 0 && Array.isArray(f.cube) && f.cube.length === 7 && f.cube.every(Number.isFinite)) for (let k = 0; k < 7; k++) d.qpos[cubeAdr + k] = f.cube[k];
    d.qvel.fill(0);
    mj.mj_forward(m, d);
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
