// printedrobotics.cz — antweight arena prototype (three.js + Rapier).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildArenaVisual, buildArenaPhysics, HALF, PIT, GAP, inPit } from './arena.js';
import { ROBOTS, Robot, GRAVITY } from './robots.js';
import { createInput } from './input.js';

const COLORS = [
  { id: 'white', name: 'Bílá', hex: '#F2F2EE' },
  { id: 'grey', name: 'Šedá', hex: '#9A9A94' },
  { id: 'black', name: 'Černá', hex: '#2A2A2A' },
  { id: 'orange', name: 'Oranžová', hex: '#E8461E' },
  { id: 'blue', name: 'Modrá', hex: '#1F3BFF' }
];
const ROUND = 120, FLIP_LIMIT = 10, DT = 1 / 120;
const MODEL_URL = id => `../../models/${id}.glb`;
const KIT_URL = id => `../../sada/${id}/`;

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const own = (o, k) => k != null && Object.prototype.hasOwnProperty.call(o, k);
let playerId = own(ROBOTS, params.get('robot')) ? params.get('robot') : 'svrn';
let colorId = COLORS.some(c => c.id === params.get('color')) ? params.get('color') : 'orange';
const otherId = id => (id === 'svrn' ? 'vert150' : 'svrn');
const oppColor = c => (c === 'orange' ? '#1F3BFF' : c === 'black' ? '#9A9A94' : '#2A2A2A');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
// touch UI only for coarse pointers; a touchscreen laptop switches over on its first real touch
let touch = matchMedia('(pointer: coarse)').matches;
document.documentElement.classList.toggle('touch', touch);
const DEBUG = params.has('debug');

// ------------------------------------------------------------------ UI wiring
const ui = {
  start: $('#start'), end: $('#end'), hud: $('#hud'), msg: $('#msg'), timer: $('#timer'),
  go: $('#go'), again: $('#again'), cta: $('#cta'), back: $('#back'), colors: $('#colors'), pick: $('#pick'),
  pName: $('#p-name'), oName: $('#o-name'), pStat: $('#p-stat'), oStat: $('#o-stat'),
  pSw: $('#p-sw'), oSw: $('#o-sw'), endTitle: $('#end-title'), endWhy: $('#end-why'), endStats: $('#end-stats'),
  endKit: $('#end-kit'), endKitL: $('#end-kit-l'), ctaL: $('#cta-l'), hint: $('#hint'), wbtn: $('#fire'), wlabel: $('#fire-l'), fail: $('#fail')
};

let failed = false;
function fail(text) {
  failed = true;
  ui.fail.hidden = false; ui.end.hidden = true; ui.msg.hidden = true;
  document.body.classList.remove('playing');
  ui.fail.querySelector('p').textContent = text;
  ui.fail.querySelector('a').href = KIT_URL(playerId);
  ui.start.hidden = true; ui.hud.hidden = true;
}

// ------------------------------------------------------------------ renderer (with fallback)
let renderer;
try {
  const c = document.createElement('canvas');
  if (!(c.getContext('webgl2') || c.getContext('webgl'))) throw new Error('no webgl');
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  fail('Tvůj prohlížeč nepodporuje 3D grafiku (WebGL), takže arénu nespustíme. Robota si můžeš prohlédnout na stránce sady.');
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, touch ? 2 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('#stage').appendChild(renderer.domElement);
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', 'Aréna pro bojové roboty');
renderer.domElement.tabIndex = -1;   // focus target during a match (keys stay with the game)
// context loss: pause everything; if the browser restores it, carry on
let ctxLost = false;
renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault(); ctxLost = true;
  fail('Grafika prohlížeče se zastavila. Zkus stránku načíst znovu.');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  ctxLost = false; failed = false; ui.fail.hidden = true;
  if (game.state === 'menu') ui.start.hidden = false;
  else {
    ui.hud.hidden = false;
    if (game.state === 'end') ui.end.hidden = false; else document.body.classList.add('playing');
  }
  layout(); updateCamera(0, true); last = performance.now();
});

const scene = new THREE.Scene();
scene.background = new THREE.Color('#EEEEEB');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(-5, 14, 7); key.castShadow = true;
key.shadow.mapSize.set(touch ? 1024 : 2048, touch ? 1024 : 2048);
Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
scene.add(key, new THREE.HemisphereLight(0xffffff, 0xd8d8d2, 0.85));
buildArenaVisual(scene);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

// player ring marker
const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.86, 40), new THREE.MeshBasicMaterial({ color: '#0E0E0E', transparent: true, opacity: 0.85, depthWrite: false }));
ring.rotation.x = -Math.PI / 2; ring.renderOrder = 1; scene.add(ring);

// sparks
const SPARKS = 90;
const sparkGeo = new THREE.BufferGeometry();
const sparkPos = new Float32Array(SPARKS * 3), sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS);
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: '#FF7A3D', size: 0.09, transparent: true, depthWrite: false }));
sparks.frustumCulled = false; scene.add(sparks);
let sparkI = 0, shake = 0;
const fx = {
  hit(by, p, e) {
    const n = Math.round(10 + 22 * e);
    for (let i = 0; i < n; i++) {
      const k = sparkI++ % SPARKS;
      sparkPos.set([p.x, p.y, p.z], k * 3);
      sparkVel.set([(Math.random() - 0.5) * 9, 2 + Math.random() * 7, (Math.random() - 0.5) * 9], k * 3);
      sparkLife[k] = 0.25 + Math.random() * 0.35;
    }
    if (!reduce) shake = Math.max(shake, 0.12 + 0.25 * e);
    if (navigator.vibrate && by === player && touch) try { navigator.vibrate(30); } catch (_) {}
    game.events.push({ t: +game.time.toFixed(2), type: 'hit', by: by === player ? 'player' : 'ai', e: +e.toFixed(2) });
  },
  flip(by) { game.events.push({ t: +game.time.toFixed(2), type: 'fire', by: by === player ? 'player' : 'ai' }); }
};
function stepSparks(dt) {
  for (let k = 0; k < SPARKS; k++) {
    if (sparkLife[k] <= 0) { sparkPos[k * 3 + 1] = -100; continue; }
    sparkLife[k] -= dt;
    sparkVel[k * 3 + 1] -= GRAVITY * dt;
    for (let a = 0; a < 3; a++) sparkPos[k * 3 + a] += sparkVel[k * 3 + a] * dt;
    if (sparkPos[k * 3 + 1] < 0.02) { sparkPos[k * 3 + 1] = 0.02; sparkVel[k * 3 + 1] *= -0.3; }
  }
  sparkGeo.attributes.position.needsUpdate = true;
}

// ------------------------------------------------------------------ robots
let player, ai;
function disposeRobot(r) {
  scene.remove(r.root);
  r.root.traverse(o => {
    if (!o.isMesh || o.userData.shared) return;
    o.geometry && !o.geometry.userData.fromGlb && o.geometry.dispose();
  });
  r.printMat.dispose();
}
function makeRobots() {
  if (player) { disposeRobot(player); disposeRobot(ai); }
  const pc = COLORS.find(c => c.id === colorId).hex;
  player = new Robot(ROBOTS[playerId], pc, scene);
  ai = new Robot(ROBOTS[otherId(playerId)], oppColor(colorId), scene);
  ai.handicap = 0.86;
  // park them on the start squares for the menu view
  for (const [r, s] of [[player, -1], [ai, 1]]) {
    r.root.position.set(s * 3.6, 0.27, -s * 3.6);
    r.root.rotation.y = s < 0 ? Math.PI * 0.75 : -Math.PI * 0.25;
  }
  loadModel(player); loadModel(ai);
}
const gltfLoader = new GLTFLoader(); gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const modelCache = {};
function loadModel(robot) {
  const id = robot.def.id;
  if (modelCache[id] === false) return;
  const p = modelCache[id] || (modelCache[id] = new Promise((res, rej) => gltfLoader.load(MODEL_URL(id), g => { g.scene.traverse(o => { if (o.geometry) o.geometry.userData.fromGlb = true; }); res(g.scene); }, undefined, rej)));
  p.then(sc => {
    if (robot.root.parent !== scene) return;
    const info = robot.useModel(sc.clone(true));
    hook.models[id] = info;
  }).catch(() => { modelCache[id] = false; });
}

// ------------------------------------------------------------------ physics
let RAPIER, world, ready = false;
import('@dimforge/rapier3d-compat').then(async mod => {
  RAPIER = mod.default || mod;
  // rapier-compat 0.19's own init() passes the inlined wasm the old way, which makes wasm-bindgen
  // log a harmless deprecation warning; there is no public option to avoid it
  await RAPIER.init();
  if (failed) return;
  world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = DT;
  buildArenaPhysics(RAPIER, world);
  ready = true;
  ui.go.disabled = false; ui.go.querySelector('span').textContent = 'Start';
}).catch(e => { console.error(e); fail('Fyzikální engine se nepodařilo načíst. Zkus stránku obnovit.'); });

function attach() {
  for (const r of [player, ai]) if (!r.body) r.attachPhysics(RAPIER, world);
}
function removeBodies() {
  for (const r of [player, ai]) if (r && r.body) { world.removeRigidBody(r.body); r.body = null; }
}

// ------------------------------------------------------------------ AI
const _l = new THREE.Vector3();
const brain = { t: 0, cmd: { throttle: 0, turn: 0, fire: false }, stuck: 0, backing: 0, backTurn: 1 };
function hazardAt(x, z) {
  return (x > PIT.x0 - 0.4 && z > PIT.z0 - 0.4) || (z < -HALF + 0.9 && x > GAP.x0 - 0.3 && x < GAP.x1 + 0.3);
}
function think(dt) {
  const me = ai.frame(), op = player.frame();
  brain.t -= dt;
  const out = brain.cmd;
  out.fire = false;
  if (ai.def.weapon === 'spinner' && !ai.weaponOn && game.time > 0.6) out.fire = true;
  if (ai.def.weapon === 'flipper') {
    if (me.up.y < 0.35 && ai.flippedTime > 0.7 && ai.cooldown <= 0) out.fire = true;
  }
  if (brain.t > 0) return out;
  if (ai.def.weapon === 'flipper') {
    const l = me.local(op.pos, _l);
    if (l.z > 0.35 && l.z < 1.2 && Math.abs(l.x) < 0.7 && ai.cooldown <= 0 && Math.random() < 0.3) out.fire = true;
  }
  brain.t = 0.08 + Math.random() * 0.06;            // reaction time
  const v = ai.body.linvel();
  const speed = Math.hypot(v.x, v.z);
  if (brain.backing > 0) {
    brain.backing -= 0.1;
    out.throttle = -0.8; out.turn = brain.backTurn * 0.7; return out;
  }
  // aim at the opponent, leading slightly
  const pv = player.body.linvel();
  const tx = op.pos.x + pv.x * 0.25, tz = op.pos.z + pv.z * 0.25;
  const heading = Math.atan2(me.fwd.x, me.fwd.z), want = Math.atan2(tx - me.pos.x, tz - me.pos.z);
  let a = want - heading; a = Math.atan2(Math.sin(a), Math.cos(a));
  out.turn = THREE.MathUtils.clamp(-a * 2.4, -1, 1);
  out.throttle = Math.cos(a) > 0.6 ? 0.88 : Math.cos(a) > 0 ? 0.45 : 0.1;
  // keep out of the pit / gap ourselves
  const ax = me.pos.x + me.fwd.x * 1.1 + v.x * 0.3, az = me.pos.z + me.fwd.z * 1.1 + v.z * 0.3;
  if (hazardAt(ax, az) && !hazardAt(op.pos.x, op.pos.z)) { out.throttle = -0.6; out.turn = a > 0 ? 1 : -1; }
  // unstick
  // stalled (wall, or a shoving match that goes nowhere): back off and come again from another angle
  const close = me.pos.distanceTo(op.pos) < 1.6;
  if (out.throttle > 0.5 && speed < 0.6) brain.stuck += close ? 0.05 : 0.1; else brain.stuck = Math.max(0, brain.stuck - 0.05);
  if (brain.stuck > 1.1) { brain.stuck = 0; brain.backing = 0.7; brain.backTurn = Math.random() < 0.5 ? -1 : 1; }
  return out;
}

// ------------------------------------------------------------------ game state
const input = createInput({ stick: $('#stick'), knob: $('#knob'), fire: ui.wbtn }, () => game.state === 'countdown' || game.state === 'fight');
const game = { state: 'loading', time: 0, left: ROUND, count: 0, acc: 0, result: null, events: [] };

let endTimer = 0;
function startRound() {
  if (!ready || failed) return;
  clearTimeout(endTimer);
  removeBodies(); makeRobots(); attach();
  player.reset(-3.6, 3.6, Math.PI * 0.75);
  ai.reset(3.6, -3.6, -Math.PI * 0.25);
  Object.assign(brain, { t: 0, stuck: 0, backing: 0 });
  Object.assign(game, { state: 'countdown', time: 0, left: ROUND, count: 3.2, acc: 0, result: null, events: [] });
  input.reset();
  ui.start.hidden = true; ui.end.hidden = true; ui.hud.hidden = false;
  document.body.classList.add('playing'); layout();
  ui.wlabel.textContent = player.def.weapon === 'flipper' ? 'Flipper' : 'Zbraň';
  renderer.domElement.focus({ preventScroll: true });
}

function endRound(win, why) {
  if (game.state !== 'fight') return;
  game.state = 'end'; game.result = { win, why };
  document.body.classList.remove('playing');
  layout();
  const draw = win === null;
  ui.endTitle.textContent = draw ? 'Remíza' : win ? 'Výhra' : 'Prohra';
  ui.end.classList.toggle('win', !!win);
  ui.endWhy.textContent = why;
  ui.endStats.textContent = `Zásahy ${player.hits} : ${ai.hits}  ·  čas ${fmt(Math.min(ROUND, ROUND - game.left))}`;
  ui.endKit.textContent = player.def.name;
  ui.cta.href = KIT_URL(player.def.id);
  // a kit that is not on sale yet gets a "let me know" CTA instead of "build it"
  const soon = !!player.def.preparing;
  ui.endKitL.textContent = soon ? 'Stavebnici připravujeme' : 'Stavebnice';
  ui.ctaL.textContent = soon ? 'Dejte mi vědět' : 'Postav si ho';
  endTimer = setTimeout(() => { ui.end.hidden = false; ui.again.focus(); }, 900);
}

const fmt = s => { s = Math.max(0, Math.ceil(s - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function outCheck(r) {
  // a robot tossed over the wall only counts once it lands outside
  const p = r.body.translation();
  return p.y < -0.5 ? (inPit(p.x, p.z) ? 'pit' : 'out') : null;
}

function physicsStep(cmd) {
  game.time += DT;
  const pin = game.state === 'fight' ? cmd : { throttle: 0, turn: 0, fire: false };
  const ain = game.state === 'fight' ? think(DT) : { throttle: 0, turn: 0, fire: false };
  player.step(DT, pin, ai, fx);
  ai.step(DT, ain, player, fx);
  cmd.fire = false;
  world.step();
  if (game.state !== 'fight') return;
  // pushing points (aggression, for the judges): only while the bodies actually touch and
  // the robot is driving into the other one
  if (touching(player, ai)) {
    for (const [a, b] of [[player, ai], [ai, player]]) {
      const v = a.body.linvel(), dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
      if (a.vLong > 0.5 && a.contacts > 0 && (v.x * dx + v.z * dz) / d > 0.3) a.score += DT * 0.5;
    }
  }
  const po = outCheck(player), ao = outCheck(ai);
  if (ao) return endRound(true, ao === 'pit' ? 'Soupeř skončil v jámě.' : 'Vytlačil jsi soupeře z arény.');
  if (po) return endRound(false, po === 'pit' ? 'Tvůj robot skončil v jámě.' : 'Tvůj robot vypadl z arény.');
  if (ai.flippedTime >= FLIP_LIMIT) return endRound(true, 'Soupeř se 10 s nemohl pohnout.');
  if (player.flippedTime >= FLIP_LIMIT) return endRound(false, 'Tvůj robot se 10 s nemohl pohnout.');
}
function touching(a, b) {
  let hit = false;
  for (const ca of a.colliders) for (const cb of b.colliders) {
    if (hit) return true;
    world.contactPair(ca, cb, m => { if (m.numContacts() > 0) hit = true; });
  }
  return hit;
}
// the match clock runs on wall-clock time, so a slow device cannot stretch the 2:00
function tickClock(dt) {
  if (game.state !== 'fight') return;
  game.left -= dt;
  if (game.left <= 0) {
    game.left = 0;
    const a = Math.round(player.score), b = Math.round(ai.score);
    endRound(a === b ? null : a > b, `Čas vypršel – rozhodnutí rozhodčích ${a} : ${b}.`);
  }
}

// ------------------------------------------------------------------ camera fit
const camState = { target: new THREE.Vector3(), dist: 20, init: false };
function layout() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  let top = ui.hud.hidden ? 16 : (w < 640 ? 64 : 76);
  let bottom = touch && !ui.hud.hidden ? Math.min(210, h * 0.26) : 16, left = 0, right = 0;
  if (!ui.start.hidden) {
    // menu: keep the arena clear of the start panel (side panel on desktop, bottom sheet on phones)
    const r = ui.start.getBoundingClientRect();
    if (r.width < w * 0.8) left = r.right; else bottom = Math.max(bottom, h - r.top + 8);
    if (h - bottom - top < 140) bottom = h - top - 140;
  }
  // centre the projection in the free band
  const sx = (left + (w - right)) / 2 - w / 2, sy = (top + (h - bottom)) / 2 - h / 2;
  const W2 = w + 2 * Math.abs(sx), H2 = h + 2 * Math.abs(sy);
  camera.setViewOffset(W2, H2, Math.abs(sx) - sx, Math.abs(sy) - sy, w, h);
  camera.aspect = W2 / H2;
  camera.updateProjectionMatrix();
  camState.band = { top, bottom, left, right, w, h };
}
const portrait = () => innerHeight > innerWidth * 1.1;
const fitPts = Array.from({ length: 8 }, () => new THREE.Vector3()), _n = new THREE.Vector3(), _dir = new THREE.Vector3();
const fitCache = { key: '', d: 0 };
function fitDistance(bx0, bx1, bz0, bz1, target, el) {
  const { top, bottom, left, w, h } = camState.band;
  // the bisection is only redone when the framed box or the screen changes noticeably
  const key = [bx0, bx1, bz0, bz1].map(v => Math.round(v * 8)).join() + `|${el}|${top}|${bottom}|${left}|${w}|${h}`;
  if (key === fitCache.key) return fitCache.d;
  const dir = _dir.set(0, Math.sin(el), Math.cos(el));
  let i = 0;
  for (const x of [bx0, bx1]) for (const z of [bz0, bz1]) for (const y of [-0.5, 1.2]) fitPts[i++].set(x, y, z);
  const fits = d => {
    camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target); camera.updateMatrixWorld();
    for (const p of fitPts) {
      const n = _n.copy(p).project(camera);
      const sx = (n.x + 1) / 2 * w, sy = (1 - n.y) / 2 * h;
      if (n.z > 1 || sx < left + 6 || sx > w - 6 || sy < top + 4 || sy > h - bottom - 4) return false;
    }
    return true;
  };
  let lo = 4, hi = 120;
  for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
  fitCache.key = key; fitCache.d = hi;
  return hi;
}
const _tgt = new THREE.Vector3();
function updateCamera(dt, snap) {
  const el = THREE.MathUtils.degToRad(portrait() ? 64 : 52);
  let x0 = -HALF - 0.3, x1 = HALF + 0.3, z0 = -HALF - 0.3, z1 = HALF + 0.3;
  const following = portrait() && player && player.body && (game.state === 'fight' || game.state === 'countdown');
  if (following) {
    // phones: frame both robots (min 8 × 8 units) so they stay readable
    const a = player.body.translation(), b = ai.body.translation();
    const cx = THREE.MathUtils.clamp((a.x + b.x) / 2, -2, 2), cz = THREE.MathUtils.clamp((a.z + b.z) / 2, -2, 2);
    const hx = Math.max(4.2, Math.abs(a.x - b.x) / 2 + 1.8), hz = Math.max(4.2, Math.abs(a.z - b.z) / 2 + 1.8);
    x0 = Math.max(x0, cx - hx); x1 = Math.min(x1, cx + hx); z0 = Math.max(z0, cz - hz); z1 = Math.min(z1, cz + hz);
  }
  const tgt = _tgt.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const d = fitDistance(x0, x1, z0, z1, tgt, el);
  const k = snap || !camState.init ? 1 : 1 - Math.exp(-dt * 2.2);
  camState.init = true;
  camState.target.lerp(tgt, k); camState.dist += (d - camState.dist) * k;
  const dir = _dir.set(0, Math.sin(el), Math.cos(el));
  camera.position.copy(camState.target).addScaledVector(dir, camState.dist);
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 1.4); }
  camera.lookAt(camState.target);
}
addEventListener('resize', () => { layout(); fitCache.key = ''; updateCamera(0, true); });

// ------------------------------------------------------------------ HUD
// write text only when it changes (live regions would otherwise re-announce every frame)
function setText(el, t) { if (el._t !== t) { el._t = t; el.textContent = t; } }
function hud() {
  setText(ui.timer, game.state === 'countdown' ? fmt(ROUND) : fmt(game.left));
  ui.timer.classList.toggle('low', game.state === 'fight' && game.left < 15);
  const st = r => {
    if (r.flippedTime > 0.6) {
      const t = `Převrácený ${Math.max(0, Math.ceil(FLIP_LIMIT - r.flippedTime))} s`;
      if (r !== player) return t;
      return t + (r.def.weapon === 'flipper' ? (touch ? ' · flipper = otočit' : ' · mezerník = otočit') : ' · jeď a rozhoupej se');
    }
    if (r.inverted) return 'Jede vzhůru nohama';
    if (r.def.weapon === 'spinner') return r.weaponOn ? `Zbraň ${Math.round(r.spin * 100)} %` : 'Zbraň vypnutá';
    return r.cooldown > 0 ? 'Flipper nabíjí' : 'Flipper připraven';
  };
  setText(ui.pStat, st(player)); setText(ui.oStat, st(ai));
  ui.pStat.classList.toggle('warn', player.flippedTime > 0.6);
  ui.oStat.classList.toggle('warn', ai.flippedTime > 0.6);
  if (game.state === 'countdown') {
    const n = Math.ceil(game.count - 0.2);
    setText(ui.msg, n > 0 ? String(n) : 'Boj!'); ui.msg.hidden = false;
  } else if (game.state === 'fight' && game.time < 0.8) { setText(ui.msg, 'Boj!'); ui.msg.hidden = false; }
  else if (!ui.msg.hidden) ui.msg.hidden = true;
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
const cmd = { throttle: 0, turn: 0, fire: false };
function frame(now) {
  requestAnimationFrame(frame);
  const wall = Math.min(0.25, Math.max(0, (now - last) / 1000)); last = now;
  if (document.hidden || ctxLost) return;
  let dt = Math.min(0.05, wall);
  const inp = input.read();
  cmd.throttle = inp.throttle; cmd.turn = inp.turn; cmd.fire = cmd.fire || inp.fire;
  if (game.state === 'end' && inp.fire && !ui.end.hidden) startRound();

  if (ready && player && player.body && (game.state === 'countdown' || game.state === 'fight' || game.state === 'end')) {
    if (game.state === 'countdown') { game.count -= dt; if (game.count <= 0) { game.state = 'fight'; game.time = 0; } }
    game.acc += dt;
    let n = 0;
    while (game.acc >= DT && n < 6) { physicsStep(cmd); game.acc -= DT; n++; }
    if (n === 6) game.acc = 0;
    tickClock(wall);
    player.sync(dt); ai.sync(dt);
    const p = player.body.translation();
    ring.visible = p.y > -0.3; ring.position.set(p.x, 0.012, p.z);
    hud();
  } else {
    ring.visible = false;
    if (player && !reduce && game.state !== 'end') { player.root.rotation.y += dt * 0.25; ai.root.rotation.y -= dt * 0.25; }
  }
  stepSparks(dt);
  updateCamera(dt);
  if (!hook.noRender) renderer.render(scene, camera);
}

// ------------------------------------------------------------------ menu
// menu buttons are built once; selection only flips aria-pressed (keeps keyboard focus in place)
const pickBtns = [], colorBtns = [];
function buildPick() {
  for (const id of Object.keys(ROBOTS)) {
    const d = ROBOTS[id];
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt'; b.dataset.id = id;
    b.innerHTML = `<b>${d.name}</b><small>${d.blurb}</small>`;
    b.onclick = () => { if (playerId === id) return; playerId = id; renderPick(); applyChoice(); };
    ui.pick.appendChild(b); pickBtns.push(b);
  }
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sw'; b.dataset.id = c.id; b.style.setProperty('--c', c.hex);
    b.setAttribute('aria-label', c.name); b.title = c.name;
    b.onclick = () => { colorId = c.id; renderPick(); applyChoice(true); };
    ui.colors.appendChild(b); colorBtns.push(b);
  }
}
function renderPick() {
  pickBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === playerId)));
  colorBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === colorId)));
  $('#color-name').textContent = COLORS.find(c => c.id === colorId).name;
}
function applyChoice(colorOnly) {
  const pc = COLORS.find(c => c.id === colorId).hex;
  if (colorOnly && player) { player.setColor(pc); ai.setColor(oppColor(colorId)); }
  else { removeBodies(); makeRobots(); }
  ui.pName.textContent = ROBOTS[playerId].name; ui.oName.textContent = ROBOTS[otherId(playerId)].name;
  ui.pSw.style.background = pc; ui.oSw.style.background = oppColor(colorId);
  ui.back.href = KIT_URL(playerId);
  const u = new URL(location.href); u.searchParams.set('robot', playerId); u.searchParams.set('color', colorId);
  history.replaceState(null, '', u);
  applyHint();
}
function applyHint() {
  const w = ROBOTS[playerId].weapon === 'flipper' ? 'flipper (i k převrácení zpět)' : 'roztočení zbraně (zap/vyp)';
  ui.hint.innerHTML = touch
    ? `Levý joystick jízda · tlačítko vpravo ${w}`
    : `<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> nebo šipky jízda · <kbd>Mezerník</kbd> ${w} · funguje i gamepad`;
}

function setTouchUI(on) {
  if (touch === on) return;
  touch = on; document.documentElement.classList.toggle('touch', on);
  applyHint(); layout(); fitCache.key = '';
}
addEventListener('pointerdown', e => { if (e.pointerType === 'touch') setTouchUI(true); }, { capture: true, passive: true });

// any error while setting up shows the fail panel instead of a dead "Načítám…" button
try {
  ui.go.onclick = startRound;
  new ResizeObserver(() => { layout(); fitCache.key = ''; updateCamera(0, true); }).observe(ui.start);
  ui.again.onclick = startRound;
  buildPick(); renderPick(); applyChoice();
  game.state = 'menu';
  layout(); updateCamera(0, true);
  requestAnimationFrame(frame);
} catch (e) {
  fail('Arénu se nepodařilo spustit. Zkus stránku obnovit.');
  throw e;
}

// debug / test hook, only with ?debug (headless tests drive the simulation directly)
const hook = {
  noRender: false,
  // run `sec` seconds of simulation synchronously with a scripted player input
  sim(sec, th = 0, tu = 0, fire = false) {
    const c = { throttle: th, turn: tu, fire };
    for (let i = 0; i < Math.round(sec / DT); i++) {
      if (game.state === 'countdown') { game.count -= DT; if (game.count <= 0) { game.state = 'fight'; game.time = 0; } continue; }
      c.throttle = th; c.turn = tu; physicsStep(c); c.fire = false; tickClock(DT);
    }
    player.sync(sec); ai.sync(sec); hud();
    const p = player.body.translation(); ring.position.set(p.x, 0.012, p.z);
    return this.state();
  },
  game, input, models: {}, renderer, scene, camera,
  get player() { return player; }, get ai() { return ai; }, get ready() { return ready; },
  state() {
    const s = r => { const t = r.body ? r.body.translation() : r.root.position; return { x: +t.x.toFixed(2), y: +t.y.toFixed(2), z: +t.z.toFixed(2), up: r.up ? +r.up.y.toFixed(2) : 1, spin: +r.spin.toFixed(2), hits: r.hits, score: +r.score.toFixed(1), flipped: +r.flippedTime.toFixed(1) }; };
    return { state: game.state, left: +game.left.toFixed(1), result: game.result, player: s(player), ai: s(ai) };
  },
  start: startRound
};
if (DEBUG) window.__arena = hook;
