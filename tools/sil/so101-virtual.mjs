#!/usr/bin/env node
// SO-101 software-in-the-loop runner — printedrobotics.cz.
//
// Runs the virtual SO-101 headless: the MuJoCo WASM model of the arm (sim/so101/model), six emulated
// STS3215 servos on one half-duplex bus (sim/so101/lib/sts3215-emu.js), physics stepped in real time,
// and the bus exposed as a virtual serial port (pty). Point the REAL, unmodified LeRobot stack at that
// port: lerobot-setup-motors, lerobot-calibrate, lerobot-teleoperate, lerobot-record, lerobot-replay.
// Optionally a second, emulated LEADER arm on its own port, moved by a script, the keyboard or a
// recorded trajectory.
//
//   node tools/sil/so101-virtual.mjs --leader            # follower + leader, ports /tmp/so101-follower, /tmp/so101-leader
//   node tools/sil/so101-virtual.mjs ctl sweep follower  # send a command to a running runner
//
// Docs: navody/so101-lerobot-simulace (CZ), en/navody/so101-lerobot-simulace (EN).
// Linux and macOS (pty). Windows: no pty — see the docs (com0com, untested).
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { loadScene, MjPlant, HandPlant, JOINT_NAMES } from './lib/plant.mjs';
import { openVirtualPort } from './lib/pty.mjs';
import { HandMover, PICK_PLACE, REST, middle, sweepSegments, parseTrajectory } from './lib/motion.mjs';
import { startServer } from './lib/server.mjs';

const HELP = `SO-101 virtual arm for LeRobot (software in the loop)

Usage: node tools/sil/so101-virtual.mjs [options]
       node tools/sil/so101-virtual.mjs ctl <command...>      (talk to a running runner)

Options:
  --follower-port PATH   virtual serial port of the follower arm   (default /tmp/so101-follower)
  --leader               also emulate a leader arm
  --leader-port PATH     virtual serial port of the leader arm     (default /tmp/so101-leader)
  --leader-motion M      what moves the leader: pickplace (default, loops), idle, keyboard,
                         or a trajectory file (.json [{q:[6 rad],t:s}] or .csv t,q0..q5)
  --factory              servos come "out of the box": all on ID 1, connected one at a time
                         (for lerobot-setup-motors; the runner re-plugs the next one after each ID write)
  --auto-hand            play the person's part in lerobot-calibrate: arms start in the middle of their
                         range, and as soon as LeRobot has written the half-turn homing offsets the
                         joints are swept through their ranges (you only press ENTER twice)
  --variant 7.4|12       servo variant (default 7.4)
  --ctl-port N           localhost control port (default 8765)
  --mirror               serve a live WebSocket mirror at ws://127.0.0.1:<ctl-port>/mirror for the browser sim
  --mirror-origin URL    extra allowed page origin for the mirror (localhost pages are always allowed)
  --hz N                 physics/servo update rate (default 250)
  --quiet                no periodic status line
  -h, --help

Commands (stdin lines, "ctl" subcommand or POST /cmd):
  middle <arm>           move the (unpowered) arm by hand to the middle of its range  (calibration step 1)
  sweep <arm>            move every joint through its range, one at a time            (calibration step 2)
  rest <arm>             move by hand to the rest pose
  play <arm> [pickplace|FILE] [once]   play a trajectory by hand (leader: drives teleoperation)
  stop <arm>             stop the hand
  key <arm> <joint 0-5> <deg>          nudge one joint by hand
  wire <arm> chain|none|0-5            plug the whole chain, nothing, or one servo into the board
  cube                   put the cube back to its start position
  status                 print state as JSON
  quit
<arm> is follower or leader.`;

// ---------------- ctl subcommand ----------------
if (process.argv[2] === 'ctl') {
  const rest = process.argv.slice(3);
  let port = 8765;
  const pi = rest.indexOf('--ctl-port');
  if (pi >= 0) { port = +rest[pi + 1]; rest.splice(pi, 2); }
  const cmd = rest.join(' ');
  const res = await fetch(`http://127.0.0.1:${port}/${cmd === 'status' ? 'status' : 'cmd'}`,
    cmd === 'status' ? {} : { method: 'POST', headers: { 'X-SIL': '1' }, body: cmd }).catch((e) => { console.error('runner not reachable:', e.message); process.exit(2); });
  const j = await res.json();
  console.log(JSON.stringify(j, null, 1));
  process.exit(res.ok && j.ok !== false ? 0 : 1);
}

const { values: opt } = parseArgs({
  options: {
    'follower-port': { type: 'string', default: '/tmp/so101-follower' },
    leader: { type: 'boolean', default: false },
    'leader-port': { type: 'string', default: '/tmp/so101-leader' },
    'leader-motion': { type: 'string', default: 'pickplace' },
    factory: { type: 'boolean', default: false },
    'auto-hand': { type: 'boolean', default: false },
    variant: { type: 'string', default: '7.4' },
    'ctl-port': { type: 'string', default: '8765' },
    mirror: { type: 'boolean', default: false },
    'mirror-origin': { type: 'string', multiple: true, default: [] },
    hz: { type: 'string', default: '250' },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  }
});
if (opt.help) { console.log(HELP); process.exit(0); }
const log = (...a) => console.log('[so101-virtual]', ...a);
const T0 = performance.now(), clock = () => (performance.now() - T0) / 1000;
// sim/so101/lib/*.js are ES modules shared with the browser (no package.json "type" there): keep Node quiet about it
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') console.warn(w); });
const { VirtualArm } = await import('../../sim/so101/lib/sts3215-emu.js');

// ---------------- the arms ----------------
const scene = await loadScene();
const fPlant = new MjPlant(scene);
const arms = {};

function makeArm(name, plant, { factory, mountShift = 0 }) {
  const arm = new VirtualArm({ variant: opt.variant, plant });
  arm.servos.forEach((s, i) => {
    s.mount = (s.mount + mountShift * (i + 1)) % 4096;     // every arm is assembled a bit differently
    if (!factory) s.setReg('ID', i + 1, true);              // as if lerobot-setup-motors had been run
  });
  arm.setWiring(factory ? 5 : 'chain');                     // factory: only the gripper servo plugged in
  const hand = new HandMover(plant);
  const A = { name, arm, plant, hand, port: null, factory, idWrittenAt: null, rx: 0, tx: 0, lastBaud: 1_000_000, homing: new Map() };
  // --auto-hand: watch for lerobot-calibrate's set_half_turn_homings (Homing_Offset := 0 on every motor,
  // then the computed offset on every motor) and start the range-of-motion sweep right after it
  arm.servos.forEach((s, i) => {
    const write = s.write.bind(s);
    s.write = (addr, data, p) => {
      write(addr, data, p);
      if (A.factory && addr <= 5 && addr + data.length > 5 && A.arm.wiring === i) A.idWrittenAt = clock();
      if (!opt['auto-hand'] || addr > 32 || addr + data.length <= 31) return;
      // 1st write after a reset = 0 (reset_calibration), 2nd = the half-turn offset (may itself be 0)
      const n = A.homing.get(i) || 0;
      A.homing.set(i, s.reg('Homing_Offset') === 0 && n !== 1 ? 1 : n === 1 ? 2 : 0);
      if ([...A.homing.values()].filter((v) => v === 2).length === 6) {
        A.homing.clear();
        setTimeout(() => { const segs = sweepSegments(plant.range); hand.play(segs, { name: 'sweep' }); log(`${name}: homing offsets written -> sweeping every joint through its range (${segs.reduce((t, x) => t + x.t, 0).toFixed(0)} s), wait for "sweep done"`); }, 300);
      }
    };
  });
  hand.onIdle = (what) => { if (what === 'sweep') log(`${name}: sweep done${opt['auto-hand'] ? ' - press ENTER in lerobot-calibrate' : ''}`); };
  if (opt['auto-hand']) hand.play([{ q: middle(plant.range), t: 0.5 }], { name: 'middle' });
  return A;
}

arms.follower = makeArm('follower', fPlant, { factory: opt.factory });
if (opt.leader) {
  const lPlant = new HandPlant(fPlant.range, REST);
  arms.leader = makeArm('leader', lPlant, { factory: opt.factory, mountShift: 211 });
  // pick-and-place loop: the follower drops the cube in the bowl each round; put it back for the next one
  arms.leader.hand.onLoop = (name) => { if (name === 'pickplace') fPlant.respawnCube(); };
}

function leaderMotion(spec, once = false) {
  const L = arms.leader;
  if (!L) throw new Error('no leader arm (start with --leader)');
  if (!spec || spec === 'pickplace') return L.hand.play(PICK_PLACE, { loop: !once, name: 'pickplace' });
  if (spec === 'idle' || spec === 'keyboard') return L.hand.stop();
  const segs = parseTrajectory(fs.readFileSync(spec, 'utf8'));
  L.hand.play(segs, { loop: !once, name: 'trajectory' });
}

// Factory mode: after lerobot-setup-motors has given the plugged-in servo its ID, "re-plug" the next one
// (setup_motors goes from the gripper down to shoulder_pan), then connect the whole chain. A person swaps
// the cable and then presses ENTER, so the swap happens when LeRobot starts looking for the next motor
// (its broadcast ping), or after 2 s for someone slower than the script.
function factoryStep(A, now, ping = false) {
  if (!A.factory || A.arm.wiring === 'chain' || A.arm.wiring === 'none') return;
  const k = A.arm.wiring, s = A.arm.servos[k];
  if (A.idWrittenAt == null || s.saved[5] !== k + 1) return;
  if (!ping && now - A.idWrittenAt < 2.0) return;
  A.idWrittenAt = null;
  const next = k - 1;
  A.arm.setWiring(next >= 0 ? next : 'chain');
  log(`${A.name}: ${JOINT_NAMES[k]} has ID ${k + 1}; now plugged in: ${next >= 0 ? JOINT_NAMES[next] + ' only' : 'the whole chain'}`);
  if (next < 0) A.factory = false;
}
const BROADCAST_PING = [0xFF, 0xFF, 0xFE, 0x02, 0x01];
const hasBroadcastPing = (b) => { for (let i = 0; i + 5 <= b.length; i++) if (BROADCAST_PING.every((x, k) => b[i + k] === x)) return true; return false; };

// ---------------- commands ----------------
const armOf = (n) => { const A = arms[n]; if (!A) throw new Error(`unknown arm "${n}" (follower${opt.leader ? ' | leader' : ''})`); return A; };
function status() {
  const one = (A) => ({
    port: A.port && A.port.link, device: A.port && A.port.device, baud: A.port && A.port.baud,
    wiring: A.arm.wiring, hand: A.hand.name,
    q: A.plant.qs().map((v) => +v.toFixed(4)),
    servos: A.arm.servos.map((s) => ({ id: s.id, powered: s.powered, torque: s.mem[40], present: s.reg('Present_Position'), goal: s.reg('Goal_Position'), homing: s.reg('Homing_Offset'), min: s.reg('Min_Position_Limit'), max: s.reg('Max_Position_Limit'), temp: s.mem[63] })),
    packets: { rx: A.rx, tx: A.tx }
  });
  return { t: +fPlant.d.time.toFixed(3), follower: one(arms.follower), ...(arms.leader ? { leader: one(arms.leader) } : {}), cube: fPlant.cube().map((v) => +v.toFixed(4)) };
}
async function command(line) {
  const [c, a, ...more] = line.split(/\s+/).filter(Boolean);
  if (!c) return {};
  switch (c) {
    case 'status': return status();
    case 'quit': setTimeout(shutdown, 50); return { bye: true };
    case 'cube': fPlant.respawnCube(); return {};
    case 'middle': { const A = armOf(a); A.hand.play([{ q: middle(A.plant.range), t: 1.5 }], { name: 'middle' }); return { busyS: 1.5 }; }
    case 'rest': { const A = armOf(a); A.hand.play([{ q: REST, t: 1.5 }], { name: 'rest' }); return { busyS: 1.5 }; }
    case 'sweep': { const A = armOf(a); const segs = sweepSegments(A.plant.range); A.hand.play(segs, { name: 'sweep' }); return { busyS: +segs.reduce((s, x) => s + x.t, 0).toFixed(1) }; }
    case 'play': {
      const A = armOf(a), once = more.includes('once'), spec = more.find((x) => x !== 'once') || 'pickplace';
      if (A.name === 'leader') leaderMotion(spec, once);
      else A.hand.play(spec === 'pickplace' ? PICK_PLACE : parseTrajectory(fs.readFileSync(spec, 'utf8')), { loop: !once, name: spec });
      return {};
    }
    case 'stop': armOf(a).hand.stop(); return {};
    case 'key': { const A = armOf(a), j = +more[0], deg = +more[1]; if (!(j >= 0 && j < 6) || !isFinite(deg)) throw new Error('key <arm> <joint 0-5> <deg>'); A.hand.nudge(j, deg * Math.PI / 180); return {}; }
    case 'wire': {
      const A = armOf(a), w = more[0];
      const v = w === 'chain' || w === 'none' ? w : +w;
      if (!(v === 'chain' || v === 'none' || (v >= 0 && v < 6))) throw new Error('wire <arm> chain|none|0-5');
      A.arm.setWiring(v); return { wiring: v };
    }
    default: throw new Error(`unknown command "${c}"`);
  }
}

// ---------------- ports ----------------
for (const A of Object.values(arms)) {
  const link = A.name === 'leader' ? opt['leader-port'] : opt['follower-port'];
  A.port = await openVirtualPort(link);
  A.port.on('data', (bytes, baud) => {
    A.rx++;
    if (A.factory && hasBroadcastPing(bytes)) factoryStep(A, clock(), true);
    const replies = A.arm.receive(bytes, baud);
    for (const r of replies) { A.port.write(r); A.tx++; }
  });
  A.port.on('baud', (b) => { if (b !== A.lastBaud) { A.lastBaud = b; log(`${A.name}: port set to ${b} Bd`); } });
  A.port.on('close', () => { if (!closing) { log(`${A.name}: pty bridge exited`); shutdown(1); } });
  log(`${A.name} arm: ${link} -> ${A.port.device}${A.factory ? '  (factory servos: ID 1, gripper plugged in alone)' : '  (IDs 1-6, chain connected)'}`);
}
if (arms.leader && !opt['auto-hand']) { try { leaderMotion(opt['leader-motion']); } catch (e) { log('leader motion:', e.message); } log(`leader motion: ${arms.leader.hand.name}`); }

const srv = await startServer({ port: +opt['ctl-port'], mirror: opt.mirror, extraOrigins: opt['mirror-origin'], onCommand: command, getStatus: status })
  .catch((e) => { log(`control port ${opt['ctl-port']} unavailable (${e.code}); commands only via stdin`); return null; });
if (srv) log(`control: http://127.0.0.1:${opt['ctl-port']}  (node tools/sil/so101-virtual.mjs ctl status)${opt.mirror ? `  mirror: ws://127.0.0.1:${opt['ctl-port']}/mirror` : ''}`);

// ---------------- real-time loop ----------------
const hz = Math.max(50, Math.min(1000, +opt.hz || 250));
let last = performance.now(), mirrorAcc = 0, statusAcc = 0;
const timer = setInterval(() => {
  const now = performance.now();
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.1) dt = 0.1;                                    // stalled process: don't spiral
  for (const A of Object.values(arms)) {
    A.hand.tick(dt);
    A.arm.update(dt);
    factoryStep(A, clock());
  }
  fPlant.step(dt);
  mirrorAcc += dt; statusAcc += dt;
  if (srv && opt.mirror && mirrorAcc >= 1 / 30) {
    mirrorAcc = 0;
    srv.broadcast({ t: fPlant.d.time, follower: { q: fPlant.qs(), torque: arms.follower.arm.servos.map((s) => s.mem[40]) }, leader: arms.leader ? { q: arms.leader.plant.qs() } : null, cube: fPlant.cubePose() });
  }
  if (!opt.quiet && statusAcc >= 5) {
    statusAcc = 0;
    const f = arms.follower;
    log(`t=${fPlant.d.time.toFixed(0)}s follower rx=${f.rx} tx=${f.tx} torque=${f.arm.servos.map((s) => s.mem[40]).join('')}` + (arms.leader ? ` leader rx=${arms.leader.rx} hand=${arms.leader.hand.name}` : ''));
  }
}, 1000 / hz);

// ---------------- stdin: keyboard (TTY) or command lines ----------------
let keyJoint = 0;
if (process.stdin.isTTY && arms.leader) {
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  log('keyboard: 1-6 pick a leader joint, a/d or arrows move it 3°, m = middle pose, w = sweep ranges, p = pick-and-place loop, s = stop, c = cube back, q = quit');
  process.stdin.on('data', (k) => {
    if (k === 'q' || k === '\u0003') return shutdown();
    if (k >= '1' && k <= '6') { keyJoint = +k - 1; log(`leader joint: ${JOINT_NAMES[keyJoint]}`); return; }
    if (k === 'a' || k === '\u001b[D' || k === '-') return arms.leader.hand.nudge(keyJoint, -3 * Math.PI / 180);
    if (k === 'd' || k === '\u001b[C' || k === '+') return arms.leader.hand.nudge(keyJoint, 3 * Math.PI / 180);
    if (k === 'p') return leaderMotion('pickplace');
    if (k === 's') return arms.leader.hand.stop();
    if (k === 'c') return fPlant.respawnCube();
    if (k === 'm') { for (const A of Object.values(arms)) A.hand.play([{ q: middle(A.plant.range), t: 1.5 }], { name: 'middle' }); return log('both arms -> middle of range'); }
    if (k === 'w') { for (const A of Object.values(arms)) A.hand.play(sweepSegments(A.plant.range), { name: 'sweep' }); return log('sweeping every joint through its range'); }
  });
} else if (!process.stdin.isTTY) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) command(line).then((r) => { if (line === 'status') console.log(JSON.stringify(r)); }, (e) => log('error:', e.message));
    }
  });
  process.stdin.on('end', () => {});                         // keep running when stdin closes (e.g. </dev/null)
}

let closing = false;
function shutdown(code = 0) {
  if (closing) return; closing = true;
  clearInterval(timer);
  for (const A of Object.values(arms)) A.port && A.port.close();
  srv && srv.close();
  if (process.stdin.isTTY) try { process.stdin.setRawMode(false); } catch (e) { /* not a tty any more */ }
  setTimeout(() => process.exit(code), 100);
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
