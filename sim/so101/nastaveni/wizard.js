// SO-101 setup wizard — printedrobotics.cz
// One code path for the virtual arm (VirtualTransport -> STS3215 emulator -> MuJoCo) and the real arm
// (SerialTransport -> Web Serial -> USB bus adapter). Only the transport differs.

import { JOINTS, DEMO, DemoPlayer, ArmSim, loadSim, hasWebGL, COLORS } from '../core.js';
import { FeetechBus, hex, ERR, decodeSM, fromBytes } from '../lib/feetech.js';
import { VirtualArm, VARIANTS } from '../lib/sts3215-emu.js';
import { VirtualTransport, SerialTransport, hasWebSerial } from '../lib/transport.js';
import * as S from '../lib/so101-setup.js';

const $ = (id) => document.getElementById(id);
const TEST = new URLSearchParams(location.search).get('test') === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = S.MOTORS.length;
const ORDER = [5, 4, 3, 2, 1, 0];                 // so_follower.setup_motors: reversed(motors)
const RAD = 180 / Math.PI;
const GRIP = [-0.17453, 1.74533];                 // gripper ctrlrange in so101.xml (rad)
const HOME_Q = [0, -1.0, 0.6, 1.2, 0, 0.3];        // scene.xml "home" keyframe (virtual arm only)
const say = (t) => { $('sr').textContent = t; };

const st = {
  step: 'port', reached: 'port', mode: null, variant: '7.4',
  idDone: new Set(), idCur: 0,
  calPhase: 'a', offsets: null, mins: {}, maxes: {}, cal: null,
  torque: false, stopped: false, busy: false,
  targets: null, cmd: null, sent: null, demo: null, speed: 30,
  live: {}, pollOn: false
};
let sim = null, arm = null, transport = null, bus = null;

// ---------- 3D ----------
const simReady = (async () => {
  if (typeof WebAssembly !== 'object' || !hasWebGL()) throw new Error('nowebgl');
  const ctx = await loadSim((f) => { $('prog').style.width = (f * 100).toFixed(1) + '%'; });
  sim = new ArmSim(ctx, {
    canvas: $('c'),
    onContextLost: () => { $('fail-msg').textContent = 'Grafika prohlížeče se resetovala. Obnovte stránku.'; $('fail').hidden = false; },
    onContextRestored: () => { $('fail').hidden = true; }
  });
  let color = 'white'; try { color = localStorage.getItem('pr-sim-color') || 'white'; } catch (e) {}
  sim.setColor((COLORS.find((c) => c.id === color) || COLORS[0]).hex);
  sim.onFrame = frame;
  sim.onAfter = after;
  if (TEST) sim.paused = true;   // Playwright drives time via __wiz.advance()
  sim.onWin = () => { $('win').hidden = false; $('win-h').focus({ preventScroll: true }); };
  $('loader').hidden = true;
  addEventListener('pagehide', (e) => { if (!e.persisted) sim.dispose(); });
  return sim;
})();
simReady.then(() => { $('v-connect').disabled = false; }).catch((e) => {
  console.error(e);
  $('loader').hidden = true; $('fail').hidden = false;
  $('port-msg').textContent = 'Virtuální ruka v tomto prohlížeči nepoběží (chybí WebGL nebo WebAssembly). Skutečnou ruku připojit můžete.';
});

// ---------- steps ----------
const STEPS = ['port', 'ids', 'cal', 'test'];
function show(step) {
  st.step = step;
  if (STEPS.indexOf(step) > STEPS.indexOf(st.reached)) st.reached = step;
  document.querySelectorAll('.step').forEach((s) => { s.hidden = s.dataset.step !== step; });
  document.querySelectorAll('#steps li').forEach((li) => {
    const i = STEPS.indexOf(li.dataset.s);
    li.classList.toggle('done', i < STEPS.indexOf(st.reached) && li.dataset.s !== step);
    if (li.dataset.s === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    li.querySelector('button').disabled = !st.mode || i > STEPS.indexOf(st.reached) || (li.dataset.s === 'port');
  });
  const h = document.querySelector(`.step[data-step="${step}"] h2`);
  if (h && st.mode) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  $('hud').hidden = !(step === 'test' && st.mode === 'virtual');
  if (step === 'ids') renderIds();
  if (step === 'cal') enterCal();
  if (step === 'test') enterTest();
  if (step !== 'test') { st.demo = null; }
}
document.querySelectorAll('#steps button').forEach((b) => b.addEventListener('click', () => show(b.parentNode.dataset.s)));

function setBusy(on) {
  st.busy = on;
  document.body.classList.toggle('busy', on);   // buttons look inactive; task() ignores clicks meanwhile
}
async function task(fn, msgEl) {
  if (st.busy) return;
  setBusy(true);
  try { await fn(); } catch (e) {
    console.error(e);
    if (msgEl) { msgEl.textContent = e.message || String(e); msgEl.className = 'msg err'; }
  } finally { setBusy(false); }
}
const msg = (el, text, kind = '') => { el.textContent = text; el.className = 'msg' + (kind ? ' ' + kind : ''); if (text) say(text); };

// ---------- connect ----------
document.querySelectorAll('input[name=variant]').forEach((r) => r.addEventListener('change', () => { st.variant = r.value; renderFaults(); }));

// The real-arm beta is hidden until it has had a hardware safety review: only ?real=1 shows it.
const REAL_ENABLED = new URLSearchParams(location.search).get('real') === '1';
$('real-card').hidden = !REAL_ENABLED;
if (!hasWebSerial()) { $('r-ok').hidden = true; $('r-no').hidden = false; }
$('r-ack').addEventListener('change', () => { $('r-connect').disabled = !$('r-ack').checked; });

$('v-connect').addEventListener('click', () => task(async () => {
  await simReady;
  sim.reset();
  arm = new VirtualArm({ variant: st.variant, plant: sim });
  transport = new VirtualTransport(arm);
  await transport.open();
  connected('virtual');
}, $('port-msg')));

$('r-connect').addEventListener('click', () => task(async () => {
  if (!REAL_ENABLED) return;
  const t = new SerialTransport();
  try { await t.requestPort(); } catch (e) {
    msg($('port-msg'), e && e.name === 'NotFoundError' ? 'Port jste nevybrali. Zkuste to znovu a vyberte port bus adaptéru (USB Single Serial, CH343, CH340…).' : 'Port se nepodařilo vybrat: ' + e.message, 'err');
    return;
  }
  try { await t.open(); } catch (e) {
    msg($('port-msg'), 'Port nejde otevřít. Nepoužívá ho jiný program (LeRobot, Arduino IDE, terminál)? Zavřete ho a zkuste to znovu.', 'err');
    try { await t.close(); } catch (e2) {}
    return;
  }
  transport = t;
  t.ondisconnect = () => { st.torque = false; st.stopped = true; msg($('t-msg'), 'USB kabel se odpojil. Moment je vypnutý (servo bez řízení drží poslední cíl, vypněte napájení).', 'err'); updateTorqueUi(); };
  connected('real');
}, $('port-msg')));

function connected(mode) {
  st.mode = mode;
  document.body.classList.toggle('m-real', mode === 'real');
  document.body.classList.toggle('m-virtual', mode === 'virtual');
  bus = new FeetechBus(transport, { timeoutMs: mode === 'real' ? 25 : 12, onPacket: logPacket });
  $('stop').hidden = false;
  $('real-tag').hidden = mode !== 'real';
  $('diag-go').disabled = false;
  document.querySelectorAll('input[name=variant]').forEach((r) => { r.disabled = true; });
  $('v-connect').disabled = true; $('r-connect').disabled = true;
  msg($('port-msg'), 'Připojeno: ' + transport.label, 'ok');
  renderFaults();
  startPoll();
  if (mode === 'real') {
    $('t-home').innerHTML = 'Do středu <span aria-hidden="true">⌂</span>';
    // no WebGL: drive the goal stream from our own frame loop
    simReady.catch(() => {
      let last = performance.now();
      const tick = (now) => { frame(Math.min(0.05, (now - last) / 1000)); last = now; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  }
  show('ids');
}

// ---------- 2 · IDs ----------
function renderIds() {
  $('idlist').innerHTML = ORDER.map((i) => {
    const m = S.MOTORS[i], done = st.idDone.has(i), cur = !done && ORDER[st.idCur] === i;
    return `<li class="${done ? 'done' : cur ? 'cur' : ''}"><span class="mono">ID ${m.id}</span><span>${JOINTS[i].label}</span><span class="mono s">${done ? 'hotovo' : cur ? 'teď' : 'čeká'}</span></li>`;
  }).join('');
  const all = st.idDone.size === N;
  if (sim && st.mode === 'virtual') for (let i = 0; i < N; i++) sim.tintServo(i, !all && ORDER[st.idCur] === i ? '#E8461E' : null);
  if (all) {
    $('id-ask').innerHTML = 'Všechna serva mají ID. Teď je propojte kabely do řetězu (deska → základna → … → chapadlo) a ruku připojte k desce.';
    $('id-go').textContent = 'Řetěz je zapojený – ověřit';
  } else {
    const i = ORDER[st.idCur];
    $('id-ask').innerHTML = `Připojte k řídicí desce <b>jen servo: ${JOINTS[i].label.toLowerCase()}</b> (${S.MOTORS[i].name}). Ostatní serva odpojte. Zdroj nechte zapnutý.`;
    $('id-go').textContent = `Servo je připojené – nastavit ID ${S.MOTORS[i].id}`;
  }
}

$('id-go').addEventListener('click', () => task(async () => {
  if (st.idDone.size === N) return verifyChain();
  const i = ORDER[st.idCur], m = S.MOTORS[i];
  if (arm) arm.setWiring(i);
  msg($('id-msg'), 'Hledáme servo…');
  try {
    await S.setupMotor(bus, transport, m.id, (t) => logLine('# ' + t));
  } catch (e) {
    const hint = { multiple: ' Připojte k desce opravdu jen jedno servo.', none: ' Zkontrolujte kabel k servu a že je zapnutý zdroj.', model: ' Je to opravdu servo STS3215?' }[e.code] || '';
    msg($('id-msg'), e.message + hint, 'err');
    return;
  }
  st.idDone.add(i);
  st.idCur = Math.min(N - 1, st.idCur + 1);
  while (st.idDone.has(ORDER[st.idCur]) && st.idDone.size < N) st.idCur++;
  msg($('id-msg'), `Servo ${JOINTS[i].label.toLowerCase()} má teď ID ${m.id}.`, 'ok');
  renderIds();
}, $('id-msg')));

async function verifyChain() {
  if (arm) arm.setWiring('chain');
  const res = await S.scanIds(bus);
  const bad = S.IDS.filter((id) => res[id] !== 'ok');
  if (bad.length) { msg($('id-msg'), `Neodpovídá ID ${bad.join(', ')}. Zkontrolujte kabely, případně spusťte Diagnostiku níže.`, 'err'); return; }
  msg($('id-msg'), 'Všech 6 serv odpovídá na ID 1–6.', 'ok');
  if (sim) for (let i = 0; i < N; i++) sim.tintServo(i, null);
  show('cal');
}

$('id-skip').addEventListener('click', () => task(async () => {
  if (arm) {
    // practice shortcut: program all six one by one, exactly as above
    for (const i of ORDER) if (!st.idDone.has(i)) { arm.setWiring(i); await S.setupMotor(bus, transport, S.MOTORS[i].id); st.idDone.add(i); }
  } else S.MOTORS.forEach((_, i) => st.idDone.add(i));
  renderIds();
  await verifyChain();
}, $('id-msg')));

// ---------- 3 · calibration ----------
let handSliders = null;
function buildHand() {
  if (handSliders || !sim) return;
  handSliders = JOINTS.map((j, i) => {
    const [lo, hi] = sim.range[i];
    const w = document.createElement('div'); w.className = 'jn' + (j.grip ? ' grip' : '');
    w.innerHTML = `<label for="h-${j.name}">${j.label}</label><output></output><input type="range" id="h-${j.name}" min="${lo}" max="${hi}" step="any">`;
    const input = w.querySelector('input'), out = w.querySelector('output');
    input.addEventListener('input', () => { st.sweep = null; hand(i, +input.value); });
    $('hand').appendChild(w);
    return { input, out };
  });
}
function hand(i, q) {
  if (!sim || st.mode !== 'virtual') return;
  if (arm.servos[i].mem[40]) return;          // a powered servo cannot be turned by hand
  sim.hand(i, q);
}
function refreshHand() {
  if (!handSliders) return;
  handSliders.forEach((s, i) => { const v = sim.ctrl(i); if (document.activeElement !== s.input) s.input.value = v; s.out.textContent = Math.round(v * RAD) + '°'; });
}

async function enterCal() {
  buildHand();
  $('cal-a').hidden = st.calPhase !== 'a';
  $('cal-b').hidden = st.calPhase !== 'b';
  // calibration runs with torque off (so_follower.calibrate: bus.disable_torque())
  st.demo = null; st.targets = null; st.torque = false; updateTorqueUi();
  try { await S.disableTorque(bus); } catch (e) { console.error(e); }
}

// LeRobot "middle of the range": joints centred, gripper half open
const MID = [0, 0, 0, 0, 0, (GRIP[0] + GRIP[1]) / 2];
$('cal-mid-help').addEventListener('click', () => { st.sweep = { k: 0, t: 0, from: null, seq: [{ to: MID, T: 1.2 }] }; });

$('cal-mid').addEventListener('click', () => task(async () => {
  st.sweep = null;
  st.offsets = await S.setHalfTurnHomings(bus);
  st.mins = {}; st.maxes = {};
  st.calPhase = 'b'; $('cal-a').hidden = true; $('cal-b').hidden = false;
  msg($('cal-msg'), 'Střed zapsán (Homing_Offset). Všechna serva teď hlásí polohu 2047.', 'ok');
  renderRanges();
}, $('cal-msg')));

$('cal-sweep').addEventListener('click', () => {
  // Each joint: stop to stop with a short dwell, then back. Like a person would, the other joints are
  // first put where the swept link cannot hit the table (lift: elbow folded; elbow: arm raised back).
  // wrist_roll is recorded as a full turn anyway (so_follower.calibrate).
  const seq = [];
  for (let i = 0; i < N; i++) {
    if (S.MOTORS[i].name === S.FULL_TURN) continue;
    const pose = MID.slice();
    if (S.MOTORS[i].name === 'shoulder_lift') pose[2] = sim.range[2][0];
    if (S.MOTORS[i].name === 'elbow_flex') pose[1] = -1.5;
    const at = (v) => { const p = pose.slice(); p[i] = v; return p; };
    const [lo, hi] = sim.range[i];
    seq.push({ to: pose, T: 0.8 }, { to: at(lo), T: 0.9 }, { to: at(lo), T: 0.4 }, { to: at(hi), T: 1.4 }, { to: at(hi), T: 0.4 }, { to: pose, T: 0.8 });
  }
  seq.push({ to: MID, T: 0.8 });
  st.sweep = { k: 0, t: 0, from: null, seq };
});

$('cal-save').addEventListener('click', () => task(async () => {
  st.sweep = null;
  let cal;
  try { cal = S.buildCalibration(st.offsets, st.mins, st.maxes); } catch (e) {
    msg($('cal-msg'), e.message + ' Projeďte je celým rozsahem.', 'err'); return;
  }
  const short = S.MOTORS.filter((m) => m.name !== S.FULL_TURN && cal[m.name].range_max - cal[m.name].range_min < 0.6 * S.EXPECTED_SPAN[m.name]);
  await S.writeCalibration(bus, cal);
  st.cal = cal;
  testSliders = null;                    // rebuild the test sliders for the new ranges
  const blob = new Blob([S.calibrationJson(cal)], { type: 'application/json' });
  $('cal-dl').href = URL.createObjectURL(blob); $('cal-dl').hidden = false;
  if (short.length) msg($('cal-msg'), `Kalibrace uložena, ale ${short.map((m) => S.jointCs(m.name)).join(', ')} má podezřele malý rozsah. Klidně ji zopakujte.`, 'warn');
  else msg($('cal-msg'), 'Kalibrace uložena do serv (Homing_Offset, Min/Max_Position_Limit).', 'ok');
  st.calPhase = 'a';
  show('test');
}, $('cal-msg')));

function renderRanges() {
  const tb = $('range-t').tBodies[0];
  tb.innerHTML = S.MOTORS.map((m, i) => {
    const full = m.name === S.FULL_TURN;
    const p = st.live[m.id] && st.live[m.id].position;
    return `<tr><td>${JOINTS[i].label}</td><td>${full ? 0 : st.mins[m.id] ?? '—'}</td><td>${p ?? '—'}</td><td>${full ? 4095 : st.maxes[m.id] ?? '—'}</td></tr>`;
  }).join('');
}

// ---------- 4 · test ----------
let testSliders = null;
function enterTest() {
  $('t-mission').disabled = !st.torque;
  if (!st.cal || testSliders) { updateTorqueUi(); return; }
  $('tj').innerHTML = '<legend class="mono">Klouby</legend>';
  testSliders = S.MOTORS.map((m, i) => {
    const margin = st.mode === 'real' ? 0.03 : 0;
    const [lo, hi] = S.normRange(m.name, st.cal[m.name], margin);
    const w = document.createElement('div'); w.className = 'jn' + (m.name === 'gripper' ? ' grip' : '');
    w.innerHTML = `<label for="t-${m.name}">${JOINTS[i].label}</label><output></output><input type="range" id="t-${m.name}" min="${lo}" max="${hi}" step="any">`;
    const input = w.querySelector('input'), out = w.querySelector('output');
    input.addEventListener('input', () => { st.demo = null; if (st.targets) st.targets[i] = +input.value; });
    $('tj').appendChild(w);
    return { input, out, lo, hi, name: m.name };
  });
  updateTorqueUi();
}

// normalized (deg / %) <-> MuJoCo joint angle. With LeRobot DEGREES mode the middle of the
// calibrated range is 0°, which is the joint zero of the Menagerie model.
function normToQ(i, v) {
  if (S.MOTORS[i].name !== 'gripper') return v / RAD;
  return GRIP[0] + v / 100 * (GRIP[1] - GRIP[0]);
}
function qToNorm(i, q) {
  if (S.MOTORS[i].name !== 'gripper') return q * RAD;
  return (q - GRIP[0]) / (GRIP[1] - GRIP[0]) * 100;
}
// virtual arm: the folded "home" pose; real arm: the calibration middle (a pose the user set by hand)
const homeTargets = () => st.mode === 'real' ? S.MOTORS.map((m, i) => clampT(i, m.name === 'gripper' ? 50 : 0)) : HOME_Q.map((q, i) => clampT(i, qToNorm(i, q)));
const clampT = (i, v) => { const s = testSliders[i]; return Math.min(s.hi, Math.max(s.lo, v)); };

$('t-torque').addEventListener('click', () => task(async () => {
  if (st.torque) { await S.disableTorque(bus); st.torque = false; st.demo = null; updateTorqueUi(); msg($('t-msg'), 'Moment vypnutý.'); return; }
  const vmax = st.mode === 'real' ? Math.round(st.speed * 4096 / 360) : 0;
  await S.configureFollower(bus, { maxVelocity: vmax });
  const goals = await S.enableTorque(bus);
  // start exactly where the arm is
  st.targets = S.MOTORS.map((m) => clampT(S.MOTORS.indexOf(m), S.normalize(m.name, st.cal[m.name], goals.get(m.id))));
  st.cmd = st.targets.slice(); st.sent = null;
  st.torque = true; st.stopped = false;
  updateTorqueUi();
  msg($('t-msg'), st.mode === 'real' ? 'Moment zapnutý. Pohybujte pomalu, STOP nebo Esc ho kdykoli vypne.' : 'Moment zapnutý. Posuňte klouby nebo spusťte misi.', 'ok');
}, $('t-msg')));

function updateTorqueUi() {
  $('t-torque').textContent = st.torque ? 'Vypnout moment' : (st.stopped ? 'Znovu zapnout moment' : 'Zapnout moment');
  $('t-torque').classList.toggle('btn-act', !st.torque);
  $('t-torque').classList.toggle('btn-o', st.torque);
  $('tj').disabled = !st.torque;
  $('t-home').disabled = !st.torque;
  $('t-mission').disabled = !st.torque || st.mode !== 'virtual';
}

$('t-home').addEventListener('click', () => { if (!st.targets) return; st.demo = null; st.targets = homeTargets(); });
$('t-mission').addEventListener('click', () => {
  if (!st.torque || st.mode !== 'virtual') return;
  $('win').hidden = true; sim.won = false; sim.inBowl = 0;
  st.demo = new DemoPlayer(st.cmd.map((v, i) => normToQ(i, v)), HOME_Q);
  msg($('t-msg'), 'Mise běží: ruka jede podle cílů posílaných přes sběrnici (Sync Write Goal_Position).');
});
$('t-reset').addEventListener('click', () => {
  if (!sim) return;
  st.demo = null; sim.reset(); $('win').hidden = true;
  if (st.targets) { st.targets = homeTargets(); st.cmd = st.targets.slice(); }
});
$('again').addEventListener('click', () => { $('win').hidden = true; });
$('t-speed').addEventListener('input', () => {
  st.speed = +$('t-speed').value; $('t-speed-o').textContent = st.speed + ' °/s';
  if (st.torque && bus) { const v = Math.round(st.speed * 4096 / 360); bus.syncWriteReg('Goal_Velocity', new Map(S.IDS.map((id) => [id, v]))); }
});

// ---------- STOP ----------
async function stop() {
  if (!bus) return;
  st.demo = null; st.torque = false; st.stopped = true; st.targets = null;
  updateTorqueUi();
  try { await S.stopAll(bus); } catch (e) { console.error(e); }
  msg($('t-msg'), 'STOP: moment všech serv je vypnutý.', 'warn');
}
$('stop').addEventListener('click', stop);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && bus) stop(); });
addEventListener('pagehide', () => { if (st.mode === 'real' && bus) S.stopAll(bus).catch(() => {}); });

// ---------- per-frame ----------
const maxRate = () => (st.mode === 'real' ? st.speed : 150);   // °/s (and %/s for the gripper)
let lastSend = 0;
function frame(dt) {
  if (arm) arm.update(dt);
  // calibration "hand" automation
  if (st.sweep && sim) {
    const s = st.sweep, cur = s.seq[s.k];
    if (!cur) st.sweep = null;
    else {
      if (!s.from) s.from = JOINTS.map((_, i) => sim.ctrl(i));
      s.t += dt;
      const k = Math.min(1, s.t / cur.T), e = k * k * (3 - 2 * k);
      cur.to.forEach((b, i) => hand(i, s.from[i] + (b - s.from[i]) * e));
      if (k >= 1) { s.k++; s.t = 0; s.from = null; }
    }
  }
  if (st.demo && st.targets) {
    const q = st.demo.tick(dt);
    if (!q) { st.demo = null; } else q.forEach((v, i) => { st.targets[i] = clampT(i, qToNorm(i, v)); });
  }
  // rate-limited goal stream (both modes)
  if (st.torque && st.targets && st.cmd && bus) {
    const r = maxRate() * dt;
    let changed = false;
    for (let i = 0; i < N; i++) {
      const d = st.targets[i] - st.cmd[i];
      const step = Math.abs(d) <= r ? d : Math.sign(d) * r;
      if (step) { st.cmd[i] += step; changed = true; }
    }
    const now = performance.now();
    if ((changed || !st.sent) && !st.sending && (now - lastSend > 30 || TEST)) {
      const goals = new Map(S.MOTORS.map((m, i) => [m.id, S.unnormalize(m.name, st.cal[m.name], st.cmd[i])]));
      const key = [...goals.values()].join(',');
      if (key !== st.sent) {
        st.sending = true; lastSend = now;
        bus.syncWriteReg('Goal_Position', goals).finally(() => { st.sending = false; st.sent = key; });
      }
    }
  }
  if (testSliders && st.cmd) testSliders.forEach((s, i) => {
    if (document.activeElement !== s.input && st.targets) s.input.value = st.targets[i];
    const v = st.cmd[i];
    s.out.textContent = s.name === 'gripper' ? Math.round(v) + ' %' : Math.round(v) + '°';
  });
  refreshHand();
}
function after(dt) {
  if (st.step === 'test' && st.mode === 'virtual') hud(sim.check(dt));
}
let hudText = null;
function hud({ text, ok }) {
  if (text !== hudText) { $('hud-text').textContent = text; hudText = text; }
  $('hud').classList.toggle('ok', ok);
}

// ---------- live registers ----------
function startPoll() {
  if (st.pollOn) return;
  st.pollOn = true;
  (async () => {
    while (st.pollOn) {
      if (st.step !== 'ids' && !st.busy) { try { await pollOnce(); } catch (e) { console.error(e); } }
      else renderReg(true);
      await sleep(st.mode === 'real' ? 100 : 120);
    }
  })();
}
let polling = false;
async function pollOnce() {
  polling = true;
  let block, tq;
  try {
    block = await bus.syncRead(56, 11, S.IDS);   // Present_Position .. Moving
    tq = await bus.syncRead(40, 1, S.IDS);       // Torque_Enable
  } finally { polling = false; }
  for (const id of S.IDS) {
    const r = block.get(id);
    if (r.comm !== 'ok') { st.live[id] = { comm: r.comm }; continue; }
    const d = r.data;
    st.live[id] = {
      comm: 'ok', position: decodeSM(fromBytes(d, 0, 2), 15), load: decodeSM(fromBytes(d, 4, 2), 10) / 10,
      voltage: d[6] / 10, temperature: d[7], status: d[9] | r.error,
      torque: tq.get(id).comm === 'ok' ? tq.get(id).data[0] : null
    };
  }
  // calibration B: record_ranges_of_motion
  if (st.step === 'cal' && st.calPhase === 'b') {
    for (const id of S.IDS) {
      const p = st.live[id].position; if (p == null) continue;
      st.mins[id] = id in st.mins ? Math.min(st.mins[id], p) : p;
      st.maxes[id] = id in st.maxes ? Math.max(st.maxes[id], p) : p;
    }
    renderRanges();
  }
  // real arm: mirror the read positions on the 3D model
  if (st.mode === 'real' && sim && st.cal) S.MOTORS.forEach((m, i) => { const l = st.live[m.id]; if (l.position != null) sim.setCtrl(i, normToQ(i, S.normalize(m.name, st.cal[m.name], l.position))); });
  if (sim && st.step !== 'ids') S.MOTORS.forEach((m, i) => { const l = st.live[m.id]; sim.tintServo(i, l.comm !== 'ok' || l.status ? '#D23C15' : null); });
  renderReg(false);
}

const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
function renderReg(paused) {
  $('reg-note').textContent = paused ? '· během nastavování ID se nečtou' : '· živě, Sync Read';
  const tb = $('reg-t').tBodies[0];
  const V = VARIANTS[st.variant];
  const SHORT = ['základna', 'rameno', 'loket', 'náklon', 'rotace', 'chapadlo'];
  tb.innerHTML = S.MOTORS.map((m, i) => {
    const l = st.live[m.id];
    if (paused || !l) return `<tr><td>${m.id}</td><td title="${S.jointCs(m.name)}">${SHORT[i]}</td><td colspan="5" class="muted">—</td></tr>`;
    if (l.comm !== 'ok') return `<tr class="bad"><td>${m.id}</td><td title="${S.jointCs(m.name)}">${SHORT[i]}</td><td colspan="5">${l.comm === 'corrupt' ? 'chybná odpověď (kolize?)' : 'neodpovídá'}</td></tr>`;
    const vBad = l.voltage > V.okHi || l.voltage < V.okLo, tBad = l.temperature >= 60;
    const flags = [l.status & ERR.VOLTAGE ? 'napětí' : '', l.status & ERR.OVERHEAT ? 'teplota' : '', l.status & ERR.OVERLOAD ? 'přetížení' : ''].filter(Boolean).join(', ');
    return `<tr${l.status ? ' class="bad"' : ''}${flags ? ` title="Chyba: ${flags}"` : ''}><td>${m.id}</td><td title="${S.jointCs(m.name)}">${SHORT[i]}</td><td>${l.position}</td><td${vBad ? ' class="hi"' : ''}>${fmt(l.voltage)} V</td><td${tBad ? ' class="hi"' : ''}>${l.temperature} °C</td><td>${fmt(l.load, 0)} %</td><td>${l.torque ? 'zap' : 'vyp'}</td></tr>`;
  }).join('');
}
renderReg(true);

// ---------- faults + diagnostics ----------
const FAULTS = [
  ['cable', 'Uvolněný kabel', 'mezi servem 3 (loket) a 4 (zápěstí)'],
  ['supply', 'Špatný zdroj', ''],
  ['dupid', 'Duplicitní ID', 'servo chapadla zůstalo na ID 1'],
  ['range', 'Špatná kalibrace', 'loket nebyl projetý celým rozsahem'],
  ['heat', 'Přehřívání', 'rameno se opírá o překážku']
];
function renderFaults() {
  const box = $('faults');
  box.querySelectorAll('label').forEach((l) => l.remove());
  for (const [id, title, sub] of FAULTS) {
    const s = id === 'supply' ? (st.variant === '7.4' ? 'zdroj 12 V na servech 7,4 V' : 'zdroj 5 V na servech 12 V') : sub;
    const l = document.createElement('label'); l.className = 'sw-row';
    l.innerHTML = `<input type="checkbox" role="switch" data-f="${id}" ${arm && arm.faults[id] ? 'checked' : ''} ${arm ? '' : 'disabled'}><span><b>${title}</b><small>${s}</small></span>`;
    l.querySelector('input').addEventListener('change', (e) => {
      if (!arm) return;
      arm.setFault(id, e.target.checked);
      say(`${title}: ${e.target.checked ? 'zapnuto' : 'vypnuto'}`);
    });
    box.appendChild(l);
  }
}
renderFaults();

$('diag-go').addEventListener('click', () => task(async () => {
  $('diag').innerHTML = '<li class="mono">Čteme registry…</li>';
  const f = await S.diagnose(bus, { variant: st.variant });
  const L = { err: 'Chyba', warn: 'Pozor', ok: 'V pořádku' };
  $('diag').innerHTML = f.map((x) => `<li class="d-${x.level}" data-code="${x.code}"><p class="mono">${L[x.level]}</p><h3>${x.title}</h3><p>${x.text}</p>${x.fix ? `<p class="fix"><b>Jak opravit:</b> ${x.fix}</p>` : ''}</li>`).join('');
  say('Diagnostika: ' + f.map((x) => x.title).join('; '));
}));

// ---------- wire log ----------
const logLines = [];
function logLine(t) { logLines.push(t); if (logLines.length > 60) logLines.shift(); if ($('log').closest('details').open) $('log').textContent = logLines.join('\n'); }
function logPacket(dir, bytes) { if (polling) return; logLine((dir === 'tx' ? '→ ' : dir === 'rx' ? '← ' : '✕ ') + hex(bytes)); }
$('log').closest('details').addEventListener('toggle', () => { $('log').textContent = logLines.join('\n'); });

show('port');

// ---------- test hooks (Playwright) ----------
if (TEST) {
  window.__wiz = {
    ready: () => simReady.then(() => true),
    state: () => ({ step: st.step, mode: st.mode, torque: st.torque, cal: st.cal, live: st.live, won: sim && sim.won, idDone: st.idDone.size, busy: st.busy, sweep: !!st.sweep, demo: !!st.demo }),
    /** advance simulated time in 1/30 s slices, letting bus traffic flow between slices */
    advance: async (sec) => {
      for (let t = 0; t < sec; t += 1 / 30) { sim.advance(1 / 30); await sleep(0); }
    },
    /** draw one frame (the rAF loop is paused in test mode: software WebGL is too slow) */
    render: () => { sim.sync(); sim.controls.update(); sim.renderer.render(sim.scene, sim.camera); },
    fault: (name, on) => arm.setFault(name, on),
    get arm() { return arm; }
  };
}
