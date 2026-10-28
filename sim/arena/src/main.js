// printedrobotics.cz — antweight arena (three.js + Rapier).
// Game flow, cameras, HUD, menus and juice live here; robots/physics in robots.js,
// arenas in arena.js / maps/.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as ARENA from './arena.js';
import * as RB from './robots.js';
import { createInput } from './input.js';
import { CameraRig, CAM_MODES } from './cameras.js';
import { LEVELS, createBrain } from './ai.js';
import { sfx } from './audio/sfx.js';
import { store } from './ui/store.js';
import { judge, CATS } from './ui/judges.js';
import { Replay } from './ui/replay.js';
import { garageModel } from './ui/garage.js';

const { ROBOTS, Robot } = RB;
const GRAVITY = RB.GRAVITY || 30;
const COLORS = [
  { id: 'white', name: 'Bílá', hex: '#F2F2EE' },
  { id: 'grey', name: 'Šedá', hex: '#9A9A94' },
  { id: 'black', name: 'Černá', hex: '#2A2A2A' },
  { id: 'orange', name: 'Oranžová', hex: '#E8461E' },
  { id: 'blue', name: 'Modrá', hex: '#1F3BFF' }
];
const MODES = [
  { id: 'quick', name: 'Rychlý zápas', blurb: 'Jeden zápas proti AI' },
  { id: 'ladder', name: 'Turnaj', blurb: 'Tři soupeři za sebou' },
  { id: 'duo', name: 'Dva hráči', blurb: 'Jedna klávesnice' },
  { id: 'training', name: 'Tréninková hala', blurb: 'Bez časového limitu' }
];
const LADDER = [
  { name: 'Kancelářská sponka', level: 'easy', prefer: 'svrn', color: 'grey' },
  { name: 'Bzučák', level: 'normal', prefer: 'vert150', color: 'blue' },
  { name: 'Ocelová Máňa', level: 'hard', prefer: 'svrn', color: 'black' }
];
const ROUND = 120, FLIP_LIMIT = 10, DT = 1 / 120;
const MODEL_URL = id => `../../models/${id}.glb`;
const KIT_URL = id => `../../sada/${id}/`;

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const own = (o, k) => k != null && Object.prototype.hasOwnProperty.call(o, k);
const robotIds = Object.keys(ROBOTS);
const colorHex = id => (COLORS.find(c => c.id === id) || COLORS[3]).hex;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let touch = matchMedia('(pointer: coarse)').matches;
document.documentElement.classList.toggle('touch', touch);
const DEBUG = params.has('debug');

// ------------------------------------------------------------------ settings (localStorage, all optional)
const saved = store.get('settings', {});
const S = {
  robot: own(ROBOTS, params.get('robot')) ? params.get('robot') : own(ROBOTS, saved.robot) ? saved.robot : robotIds[0],
  color: COLORS.some(c => c.id === params.get('color')) ? params.get('color') : COLORS.some(c => c.id === saved.color) ? saved.color : 'orange',
  p2robot: own(ROBOTS, saved.p2robot) ? saved.p2robot : robotIds[1] || robotIds[0],
  mode: MODES.some(m => m.id === params.get('mode')) ? params.get('mode') : MODES.some(m => m.id === saved.mode) ? saved.mode : 'quick',
  level: own(LEVELS, saved.level) && saved.level !== 'dummy' ? saved.level : 'normal',
  map: params.get('map') || saved.map || null,
  cam: CAM_MODES.some(c => c.id === saved.cam) ? saved.cam : 'tv',
  shake: saved.shake !== false && !reduce,
  autoReplay: saved.autoReplay !== false,
  mods: saved.mods && typeof saved.mods === 'object' ? saved.mods : {}
};
const saveSettings = () => store.set('settings', { robot: S.robot, color: S.color, p2robot: S.p2robot, mode: S.mode, level: S.level, map: S.map, cam: S.cam, shake: S.shake, autoReplay: S.autoReplay, mods: S.mods });
let ladder = store.get('ladder', { stage: 0, champion: 0 });
if (!ladder || typeof ladder.stage !== 'number') ladder = { stage: 0, champion: 0 };

// ------------------------------------------------------------------ maps (registry from arena.js, legacy fallback)
function legacyMap() {
  const { HALF, PIT, GAP, inPit } = ARENA;
  let group = null;
  return {
    id: 'classic', name: 'Klasická aréna', blurb: 'Jáma v rohu a výjezd ve zdi',
    visual(scene) { group = ARENA.buildArenaVisual(scene); },
    physics(R, world) { ARENA.buildArenaPhysics(R, world); },
    spawns: [{ x: -3.6, z: 3.6, yaw: Math.PI * 0.75 }, { x: 3.6, z: -3.6, yaw: -Math.PI * 0.25 }],
    bounds: { x0: -HALF, x1: HALF, z0: -HALF, z1: HALF },
    hazards: [{ x: (PIT.x0 + PIT.x1) / 2, z: (PIT.z0 + PIT.z1) / 2 }, { x: (GAP.x0 + GAP.x1) / 2, z: -HALF - 0.6 }],
    hazardAt: (x, z) => (x > PIT.x0 - 0.4 && z > PIT.z0 - 0.4) || (z < -HALF + 0.9 && x > GAP.x0 - 0.3 && x < GAP.x1 + 0.3),
    outcome: p => (p.y < -0.5 ? (inPit(p.x, p.z) ? 'pit' : 'out') : null),
    update() {},
    dispose(scene) { if (group) { scene.remove(group); group = null; } }
  };
}
// adapter for the maps agent's registry (see TEAM.md); anything missing falls back to the legacy arena
const MAP_LIST = (() => {
  const reg = ARENA.MAPS;
  if (!reg || typeof ARENA.createMap !== 'function') return [{ id: 'classic', name: 'Klasická aréna', blurb: 'Jáma v rohu a výjezd ve zdi', make: legacyMap }];
  return Object.values(reg).map(m => ({ id: m.id, name: m.name, blurb: m.blurb || '', make: () => adaptMap(ARENA.createMap(m.id)) }));
})();
function adaptMap(m) {
  const b = m.bounds || { x0: -6, x1: 6, z0: -6, z1: 6 };
  return {
    id: m.id, name: m.name, blurb: m.blurb,
    visual: scene => m.buildVisual(scene), physics: (R, w) => m.buildPhysics(R, w),
    spawns: m.spawns, bounds: b, hazards: m.hazards || [],
    hazardAt: m.hazardAt ? (x, z) => m.hazardAt(x, z) : () => false,
    outcome: p => (m.outcome ? m.outcome(p) : p.y < -0.5 ? 'out' : null),
    update: (dt, robots, fxApi) => m.update && m.update(dt, robots, fxApi),
    dispose: scene => m.dispose && m.dispose(scene)
  };
}
if (!MAP_LIST.some(m => m.id === S.map)) S.map = MAP_LIST[0].id;

// ------------------------------------------------------------------ UI refs
const ui = {
  start: $('#start'), end: $('#end'), hud: $('#hud'), msg: $('#msg'), timer: $('#timer'), garage: $('#garage'), pause: $('#pause'),
  go: $('#go'), again: $('#again'), cta: $('#cta'), back: $('#back'), colors: $('#colors'), pick: $('#pick'), modes: $('#modes'),
  ctx: $('#mode-ctx'), maps: $('#maps'), mapRow: $('#map-row'),
  pName: $('#p-name'), oName: $('#o-name'), pTag: $('#p-tag'), oTag: $('#o-tag'), pStat: $('#p-stat'), oStat: $('#o-stat'), pDmg: $('#p-dmg'), oDmg: $('#o-dmg'),
  pSw: $('#p-sw'), oSw: $('#o-sw'), endTitle: $('#end-title'), endWhy: $('#end-why'), endStats: $('#end-stats'), endKicker: $('#end-kicker'),
  card: $('#card'), next: $('#next'), menuBtn: $('#to-menu'), replayBtn: $('#replay-btn'), share: $('#share'), shareMsg: $('#share-msg'),
  endKit: $('#end-kit'), endKitL: $('#end-kit-l'), ctaL: $('#cta-l'), hint: $('#hint'), wbtn: $('#fire'), wlabel: $('#fire-l'), fail: $('#fail'),
  camBtn: $('#cam-btn'), sndBtn: $('#snd-btn'), pauseBtn: $('#pause-btn'), resetBtn: $('#reset-btn'), dummyBtn: $('#dummy-btn'), tools: $('#tools'),
  pops: $('#pops'), replayBar: $('#replay-bar'), skip: $('#skip'), live: $('#live'), garageBtn: $('#garage-btn')
};

let failed = false;
function fail(text) {
  failed = true;
  for (const p of [ui.end, ui.garage, ui.pause, ui.start, ui.hud]) p.hidden = true;
  ui.fail.hidden = false; ui.msg.hidden = true; ui.tools.hidden = true;
  document.body.classList.remove('playing');
  ui.fail.querySelector('p').textContent = text;
  ui.fail.querySelector('a').href = KIT_URL(S.robot);
}

// ------------------------------------------------------------------ renderer (with fallback)
let renderer;
try {
  const c = document.createElement('canvas');
  if (!(c.getContext('webgl2') || c.getContext('webgl'))) throw new Error('no webgl');
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  fail('Váš prohlížeč nepodporuje 3D grafiku (WebGL), takže arénu nespustíme. Robota si můžete prohlédnout na stránce sady.');
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
renderer.domElement.tabIndex = -1;
let ctxLost = false;
renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault(); ctxLost = true;
  fail('Grafika prohlížeče se zastavila. Zkuste stránku načíst znovu.');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  ctxLost = false; failed = false; ui.fail.hidden = true;
  showScreen(game.state === 'menu' ? 'menu' : game.state === 'end' ? 'end' : 'play');
  last = performance.now();
});

const scene = new THREE.Scene();
scene.background = new THREE.Color('#EEEEEB');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(-5, 14, 7); key.castShadow = true;
key.shadow.mapSize.set(touch ? 1024 : 2048, touch ? 1024 : 2048);
Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
scene.add(key, new THREE.HemisphereLight(0xffffff, 0xd8d8d2, 0.85));

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const rig = new CameraRig(camera, { reduceMotion: reduce });
// split-screen (two players): one chase camera each
const camA = new THREE.PerspectiveCamera(58, 1, 0.05, 200), camB = new THREE.PerspectiveCamera(58, 1, 0.05, 200);
const rigA = new CameraRig(camA, { reduceMotion: reduce }), rigB = new CameraRig(camB, { reduceMotion: reduce });
rigA.set('chase', true); rigB.set('chase', true);
let split = false;

// player ring markers
const ringMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false });
const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.86, 40), ringMat('#0E0E0E'));
ring.rotation.x = -Math.PI / 2; ring.renderOrder = 1; scene.add(ring);
const ring2 = new THREE.Mesh(ring.geometry, ringMat('#1F3BFF'));
ring2.rotation.x = -Math.PI / 2; ring2.renderOrder = 1; scene.add(ring2);

// ------------------------------------------------------------------ juice: sparks, pops, hit-stop
const SPARKS = 120;
const sparkGeo = new THREE.BufferGeometry();
const sparkPos = new Float32Array(SPARKS * 3), sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS);
sparkPos.fill(-100);
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: '#FF7A3D', size: 0.09, transparent: true, depthWrite: false }));
sparks.frustumCulled = false; scene.add(sparks);
let sparkI = 0;
function emitSparks(p, e) {
  const n = Math.round(10 + 26 * e);
  for (let i = 0; i < n; i++) {
    const k = sparkI++ % SPARKS;
    sparkPos[k * 3] = p.x; sparkPos[k * 3 + 1] = p.y; sparkPos[k * 3 + 2] = p.z;
    sparkVel[k * 3] = (Math.random() - 0.5) * 9; sparkVel[k * 3 + 1] = 2 + Math.random() * 7; sparkVel[k * 3 + 2] = (Math.random() - 0.5) * 9;
    sparkLife[k] = 0.25 + Math.random() * 0.35;
  }
}
function stepSparks(dt) {
  for (let k = 0; k < SPARKS; k++) {
    if (sparkLife[k] <= 0) { sparkPos[k * 3 + 1] = -100; continue; }
    sparkLife[k] -= dt;
    sparkVel[k * 3 + 1] -= GRAVITY * dt;
    for (let a = 0; a < 3; a++) sparkPos[k * 3 + a] += sparkVel[k * 3 + a] * dt;
    if (sparkPos[k * 3 + 1] < 0.02 && sparkPos[k * 3 + 1] > -0.5) { sparkPos[k * 3 + 1] = 0.02; sparkVel[k * 3 + 1] *= -0.3; }
  }
  sparkGeo.attributes.position.needsUpdate = true;
}
// floating hit labels (DOM, projected from the hit point)
const pops = [];
for (let i = 0; i < 6; i++) { const d = document.createElement('div'); d.className = 'pop'; d.hidden = true; ui.pops.appendChild(d); pops.push({ el: d, t: 0, p: new THREE.Vector3() }); }
let popI = 0;
function popLabel(p, text, big) {
  const o = pops[popI++ % pops.length];
  o.p.copy(p); o.t = 1; o.el.textContent = text; o.el.classList.toggle('big', !!big); o.el.hidden = false;
}
const _pp = new THREE.Vector3();
function stepPops(dt) {
  for (const o of pops) {
    if (o.t <= 0) continue;
    o.t -= dt * 1.1;
    if (o.t <= 0 || split) { o.el.hidden = true; o.t = 0; continue; }
    _pp.copy(o.p).project(camera);
    if (_pp.z > 1) { o.el.style.opacity = 0; continue; }
    const x = (_pp.x + 1) / 2 * innerWidth, y = (1 - _pp.y) / 2 * innerHeight - (1 - o.t) * 50;
    o.el.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px) translate(-50%,-100%)`;
    o.el.style.opacity = Math.min(1, o.t * 2.5).toFixed(2);
  }
}

// ------------------------------------------------------------------ robots
let player, opp, map, brain;
const fx = {
  hit(by, p, e) {
    const victim = by === player ? opp : player;
    emitSparks(p, e);
    if (game.state === 'fight' || game.state === 'ko') replay.event({ type: 'hit', p: { x: p.x, y: p.y, z: p.z }, e });
    if (S.shake) { rig.shake(0.12 + 0.25 * e); rigA.shake(0.1 + 0.2 * e); rigB.shake(0.1 + 0.2 * e); }
    if (e > 0.4) game.hitstop = Math.max(game.hitstop, 0.04 + 0.08 * e);
    sfx.hit(e, by.def.weapon === 'spinner');
    if (e > 0.75) sfx.crowd(0.6);
    if (navigator.vibrate && touch && (by === player || victim === player)) try { navigator.vibrate(by === player ? 30 : 60); } catch (_) {}
    const dmg = Math.round(4 + 16 * e);
    if (game.state === 'fight') {
      victim.dmgTaken = Math.min(100, (victim.dmgTaken || 0) + dmg * 0.6);
      const st = stats.get(by); if (st) { st.damage += 0.3 + e; st.hits++; }
    }
    popLabel(p, by.def.weapon === 'flipper' ? 'Flip!' : e > 0.85 ? `Kritický zásah −${dmg}` : `−${dmg}`, e > 0.85);
    game.events.push({ t: +game.time.toFixed(2), type: 'hit', by: by === player ? 'p1' : 'p2', e: +e.toFixed(2) });
  },
  flip(by) {
    sfx.flip();
    game.events.push({ t: +game.time.toFixed(2), type: 'fire', by: by === player ? 'p1' : 'p2' });
  }
};
function disposeRobot(r) {
  scene.remove(r.root);
  r.root.traverse(o => {
    if (!o.isMesh || o.userData.shared) return;
    o.geometry && !o.geometry.userData.fromGlb && o.geometry.dispose();
  });
  r.printMat && r.printMat.dispose();
}
function oppSetup() {
  if (S.mode === 'duo') return { id: S.p2robot, hex: S.p2robot === S.robot && S.color === 'blue' ? colorHex('orange') : S.color === 'blue' ? colorHex('orange') : colorHex('blue'), level: null, name: ROBOTS[S.p2robot].name };
  if (S.mode === 'ladder') {
    const L = LADDER[Math.min(ladder.stage, LADDER.length - 1)];
    const id = own(ROBOTS, L.prefer) ? L.prefer : robotIds[ladder.stage % robotIds.length];
    let c = L.color === S.color ? 'white' : L.color;
    return { id, hex: colorHex(c), level: L.level, name: L.name };
  }
  const id = robotIds.find(r => r !== S.robot) || S.robot;
  const hex = S.color === 'orange' ? '#1F3BFF' : S.color === 'black' ? '#9A9A94' : '#2A2A2A';
  return { id, hex, level: S.mode === 'training' ? 'dummy' : S.level, name: ROBOTS[id].name };
}
function makeRobots() {
  if (player) { disposeRobot(player); disposeRobot(opp); }
  const o = oppSetup();
  player = new Robot(ROBOTS[S.robot], colorHex(S.color), scene, { mods: modsFor(S.robot) });
  opp = new Robot(ROBOTS[o.id], o.hex, scene, { mods: [] });
  opp.displayName = o.name;
  opp.handicap = o.level ? LEVELS[o.level].handicap : 1;
  brain = o.level ? createBrain(o.level, map) : null;
  player.dmgTaken = 0; opp.dmgTaken = 0;
  park();
  loadModel(player); loadModel(opp);
}
// menu pose on the start squares
function park() {
  if (!player || !map) return;
  map.spawns.slice(0, 2).forEach((s, i) => {
    const r = i ? opp : player;
    r.root.position.set(s.x, 0.27, s.z); r.root.rotation.set(0, s.yaw, 0);
  });
}
const gltfLoader = new GLTFLoader(); gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const modelCache = {};
function loadModel(robot) {
  const id = robot.def.model || robot.def.id;
  if (modelCache[id] === false) return;
  const p = modelCache[id] || (modelCache[id] = new Promise((res, rej) => gltfLoader.load(MODEL_URL(id), g => { g.scene.traverse(o => { if (o.geometry) o.geometry.userData.fromGlb = true; }); res(g.scene); }, undefined, rej)));
  p.then(sc => {
    if (robot.root.parent !== scene) return;
    hook.models[id] = robot.useModel(sc.clone(true));
    replay.invalidate();
  }).catch(() => { modelCache[id] = false; });
}
// mods: physics agent's data model via garage.js (empty when unavailable)
function modsFor(id) { return garageModel.sanitize(id, S.mods[id] || []); }

// ------------------------------------------------------------------ physics / world lifecycle
let RAPIER, world, ready = false;
function setMap(id) {
  const m = MAP_LIST.find(x => x.id === id) || MAP_LIST[0];
  S.map = m.id;
  if (map) map.dispose(scene);
  map = m.make();
  map.visual(scene);
  rig.invalidate();
  if (brain) brain = createBrain(brain.level.id, map);
  park();
}
function newWorld() {
  if (world) {
    for (const r of [player, opp]) if (r) r.body = null;
    try { world.free(); } catch (_) {}
  }
  world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = DT;
  map.physics(RAPIER, world);
}
import('@dimforge/rapier3d-compat').then(async mod => {
  RAPIER = mod.default || mod;
  // rapier-compat 0.19's init() passes the inlined wasm the old way (harmless deprecation warning)
  await RAPIER.init();
  if (failed) return;
  ready = true;
  ui.go.disabled = false; ui.go.querySelector('span').textContent = 'Start';
}).catch(e => { console.error(e); fail('Fyzikální engine se nepodařilo načíst. Zkuste stránku obnovit.'); });

// ------------------------------------------------------------------ game state
const input = createInput({ stick: $('#stick'), knob: $('#knob'), fire: ui.wbtn }, () => game.state === 'countdown' || game.state === 'fight');
const game = { state: 'loading', time: 0, left: ROUND, count: 0, acc: 0, result: null, events: [], hitstop: 0, ko: 0, koCount: 0, slow: 1, lastBeep: 0, pausedFrom: null, kos: 0 };
const stats = new Map();
const replay = new Replay(DT);
replay.onEvent = e => { if (e.type === 'hit') { emitSparks(e.p, e.e); sfx.hit(e.e, true); if (S.shake) rig.shake(0.08 + 0.15 * e.e); } };
const timed = () => S.mode !== 'training';

function newStats() {
  stats.clear();
  for (const r of [player, opp]) stats.set(r, { aggression: 0, control: 0, damage: 0, hits: 0 });
}
function placeAtSpawns() {
  map.spawns.slice(0, 2).forEach((s, i) => (i ? opp : player).reset(s.x, s.z, s.yaw));
}
function startRound() {
  if (!ready || failed) return;
  sfx.unlock();
  clearTimeout(endTimer);
  replay.stop();
  makeRobots();
  newWorld();
  for (const r of [player, opp]) r.attachPhysics(RAPIER, world);
  placeAtSpawns();
  brain && brain.reset();
  newStats(); replay.clear();
  Object.assign(game, { state: 'countdown', time: 0, left: ROUND, count: 3.2, acc: 0, result: null, events: [], hitstop: 0, ko: 0, slow: 1, lastBeep: 0, kos: 0 });
  input.reset();
  input.split.on = S.mode === 'duo';
  split = S.mode === 'duo' && S.cam === 'split';
  rig.set(S.mode === 'duo' && S.cam === 'split' ? 'tv' : camModeFor(), true);
  hudNames(); renderTools();
  showScreen('play');
  ui.wlabel.textContent = player.def.weapon === 'flipper' ? 'Flipper' : 'Zbraň';
  renderer.domElement.focus({ preventScroll: true });
}
function camModeFor() { return CAM_MODES.some(c => c.id === S.cam) ? S.cam : 'tv'; }

let endTimer = 0;
function nameOf(r) { return r === player ? (S.mode === 'duo' ? 'Hráč 1' : 'Vy') : (S.mode === 'duo' ? 'Hráč 2' : 'Soupeř'); }
// win: true = player (P1) wins, false = opponent (P2) wins, null = draw
function endRound(win, why, kind) {
  if (game.state !== 'fight') return;
  game.result = { win, why, kind, time: Math.min(ROUND, ROUND - game.left) };
  if (kind === 'ko') {
    game.state = 'ko'; game.ko = 1.1;      // let the knockout play out, then replay
    sfx.fall(); sfx.crowd(1);
    setText(ui.msg, 'K.O.!'); ui.msg.hidden = false;
  } else {
    game.state = 'ko'; game.ko = 0.01;
  }
}
function afterKo() {
  const r = game.result;
  if (r.kind === 'ko' && S.autoReplay && replay.length > 60) playReplay(true);
  else showEnd();
}
function showEnd() {
  replay.stop();
  game.state = 'end';
  sfx.stopMotors();
  const { win, why, kind } = game.result;
  const draw = win === null;
  const duo = S.mode === 'duo';
  let title = draw ? 'Remíza' : duo ? (win ? 'Vyhrává hráč 1' : 'Vyhrává hráč 2') : win ? 'Výhra' : 'Prohra';
  let kicker = kind === 'ko' ? 'Konec zápasu · K.O.' : 'Konec zápasu · rozhodnutí rozhodčích';
  ui.next.hidden = true;
  if (S.mode === 'ladder') {
    const stage = ladder.stage;
    kicker = `Turnaj · zápas ${stage + 1} ze ${LADDER.length}`;
    if (win) {
      ladder.stage = stage + 1;
      if (ladder.stage >= LADDER.length) { ladder.champion = (ladder.champion || 0) + 1; ladder.stage = 0; title = 'Vítěz turnaje!'; }
      else { ui.next.hidden = false; ui.next.querySelector('span').textContent = `Další soupeř: ${LADDER[ladder.stage].name}`; }
      store.set('ladder', ladder);
    }
  }
  ui.endKicker.textContent = kicker;
  ui.endTitle.textContent = title;
  ui.end.classList.toggle('win', !!win && !duo);
  ui.endWhy.textContent = why;
  renderCard(game.result.card);
  ui.endStats.textContent = `Zásahy ${player.hits} : ${opp.hits}  ·  čas ${fmt(game.result.time)}`;
  ui.endKit.textContent = player.def.name;
  ui.cta.href = KIT_URL(player.def.id);
  const soon = !!player.def.preparing;
  ui.endKitL.textContent = soon ? 'Stavebnici připravujeme' : 'Stavebnice';
  ui.ctaL.textContent = soon ? 'Dejte mi vědět' : 'Postavte si ho';
  ui.replayBtn.hidden = !(kind === 'ko' && replay.length > 60);
  ui.share.hidden = false; ui.shareMsg.textContent = '';
  ui.again.querySelector('span').textContent = S.mode === 'ladder' && !win ? 'Zkusit znovu' : 'Znovu';
  sfx.jingle(duo ? true : !!win);
  endTimer = setTimeout(() => { if (game.state !== 'end') return; showScreen('end'); (ui.next.hidden ? ui.again : ui.next).focus(); }, kind === 'ko' ? 200 : 900);
}
function renderCard(card) {
  ui.card.hidden = !card;
  if (!card) return;
  const L = S.mode === 'duo' ? ['Hráč 1', 'Hráč 2'] : ['Vy', 'Soupeř'];
  let h = `<table><caption>Bodování rozhodčích</caption><thead><tr><th scope="col"></th><th scope="col">${L[0]}</th><th scope="col">${L[1]}</th></tr></thead><tbody>`;
  for (const c of CATS) h += `<tr><th scope="row">${c.name} <small>(${c.pts})</small></th><td>${card.cats[c.id][0]}</td><td>${card.cats[c.id][1]}</td></tr>`;
  h += `<tr class="sum"><th scope="row">Celkem</th><td>${card.total[0]}</td><td>${card.total[1]}</td></tr></tbody></table>`;
  h += `<p class="mono">${card.judges.map((j, i) => `Rozhodčí ${i + 1}: ${j[0]}–${j[1]}`).join(' · ')}</p>`;
  ui.card.innerHTML = h;
}

const fmt = s => { s = Math.max(0, Math.ceil(s - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ------------------------------------------------------------------ physics step
const _dv = new Map();
function physicsStep(c1, c2) {
  game.time += DT;
  const live = game.state === 'fight';
  const idle = { throttle: 0, turn: 0, fire: false };
  const pin = live ? c1 : idle;
  const oin = live ? (brain ? brain.think(opp, player, DT, game.time) : c2) : idle;
  player.step(DT, pin, opp, fx);
  opp.step(DT, oin, player, fx);
  c1.fire = false; if (c2) c2.fire = false;
  map.update(DT, [player, opp], fx);
  world.step();
  wallKnocks();
  if (game.state === 'fight' || game.state === 'ko') replay.record(game.time, [player, opp]);
  if (!live) return;
  if (S.mode !== 'training') judgeTick();
  const po = map.outcome(player.body.translation()), oo = map.outcome(opp.body.translation());
  if (S.mode === 'training') return trainingChecks(po, oo);
  const P = nameOf(player), O = nameOf(opp), duo = S.mode === 'duo';
  if (oo) return endRound(true, oo === 'pit' ? `${duo ? 'Robot hráče 2' : 'Soupeř'} skončil v jámě.` : duo ? 'Hráč 1 vytlačil soupeře z arény.' : 'Vytlačili jste soupeře z arény.', 'ko');
  if (po) return endRound(false, po === 'pit' ? `${duo ? 'Robot hráče 1' : 'Váš robot'} skončil v jámě.` : `${duo ? 'Robot hráče 1' : 'Váš robot'} vypadl z arény.`, 'ko');
  if (opp.flippedTime >= FLIP_LIMIT) return endRound(true, `${O} se 10 s nemohl pohnout.`, 'ko');
  if (player.flippedTime >= FLIP_LIMIT) return endRound(false, `${duo ? 'Hráč 1' : 'Váš robot'} se 10 s nemohl pohnout.`, 'ko');
  void P;
}
// wall knocks: a sudden velocity change without the opponent touching = thud
function wallKnocks() {
  for (const r of [player, opp]) {
    const v = r.body.linvel(), prev = _dv.get(r) || { x: v.x, y: v.y, z: v.z, cd: 0 };
    const dv = Math.hypot(v.x - prev.x, v.y - prev.y, v.z - prev.z);
    prev.cd = Math.max(0, prev.cd - DT);
    if (dv > 2.6 && prev.cd <= 0) { prev.cd = 0.18; sfx.wall(Math.min(1, dv / 9)); }
    prev.x = v.x; prev.y = v.y; prev.z = v.z; _dv.set(r, prev);
  }
}
// aggression / control bookkeeping for the judges
function judgeTick() {
  const touchingNow = touching(player, opp);
  for (const [a, b] of [[player, opp], [opp, player]]) {
    const st = stats.get(a), v = a.body.linvel(), pa = a.body.translation(), pb = b.body.translation();
    const dx = pb.x - pa.x, dz = pb.z - pa.z, d = Math.hypot(dx, dz) || 1;
    const toward = (v.x * dx + v.z * dz) / d;
    if (d < 4.5 && toward > 0.8) st.aggression += DT;
    if (touchingNow && a.vLong > 0.5 && toward > 0.3) st.aggression += DT * 1.5;
    a.frame();
    const facing = (a.fwd.x * dx + a.fwd.z * dz) / d;
    const upright = a.up.y > 0.5 || (a.def.invertible && a.up.y < -0.5);
    if (upright && d < 3.2 && facing > 0.8) st.control += DT;
    if (upright && b.flippedTime > 0.3) st.control += DT * 2;
    if (!upright) st.control -= DT * 0.5;
  }
}
function touching(a, b) {
  let hit = false;
  for (const ca of a.colliders) for (const cb of b.colliders) {
    if (hit) return true;
    world.contactPair(ca, cb, m => { if (m.numContacts() > 0) hit = true; });
  }
  return hit;
}
let respawnT = 0;
function trainingChecks(po, oo) {
  if (respawnT > 0) return;
  let txt = null;
  if (oo || opp.flippedTime >= FLIP_LIMIT) { game.kos++; txt = `K.O. č. ${game.kos}!`; sfx.crowd(0.8); }
  else if (po || player.flippedTime >= FLIP_LIMIT) txt = 'Zpátky na start';
  if (!txt) return;
  flash(txt, 1.2);
  respawnT = 1.2;
}
let flashT = 0;
function flash(t, sec) { setText(ui.msg, t); ui.msg.hidden = false; flashT = sec; }

// the match clock runs on wall-clock time, so a slow device cannot stretch the 2:00
function tickClock(dt) {
  if (game.state !== 'fight' || !timed()) return;
  game.left -= dt;
  if (game.left <= 0) {
    game.left = 0;
    const card = judge(stats.get(player), stats.get(opp));
    const draw = card.winner === null;
    const v = card.votes;
    const how = v[0] === 3 || v[1] === 3 ? 'jednomyslně' : 'rozhodnutím 2 : 1';
    const why = draw ? 'Čas vypršel – rozhodčí se neshodli.' : `Čas vypršel – rozhodčí ${how} pro ${card.winner === 0 ? (S.mode === 'duo' ? 'hráče 1' : 'vás') : (S.mode === 'duo' ? 'hráče 2' : 'soupeře')}.`;
    endRound(draw ? null : card.winner === 0, why, 'decision');
    game.result.card = card;
    sfx.buzzer();
  }
}

// ------------------------------------------------------------------ replay
function playReplay(auto) {
  if (replay.length < 30) return showEnd();
  showScreen('replay');
  game.state = 'replay';
  replay.autoEnd = auto;
  replay.start([player, opp], reduce ? 0.5 : 0.35, 3.2, 1.1);
  rig.set('orbit');
  rig.orbit.radius = 4.2; rig.orbit.height = 2.2; rig.orbit.angle = Math.random() * 6.28;
  ui.skip.focus({ preventScroll: true });
}
function endReplay() {
  replay.stop();
  for (const r of [player, opp]) r.sync(0);
  rig.set(camModeFor(), true);
  if (replay.autoEnd) showEnd(); else { game.state = 'end'; showScreen('end'); ui.again.focus(); }
}
const orbitC = new THREE.Vector3();

// ------------------------------------------------------------------ layout / camera band
const band = { top: 16, bottom: 16, left: 0, right: 0, w: 1, h: 1 };
function layout() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  const playing = !ui.hud.hidden;
  let top = playing ? (w < 640 ? 64 : 76) : 16;
  let bottom = touch && playing ? Math.min(210, h * 0.26) : playing ? 56 : 16, left = 0, right = 0;
  for (const p of [ui.start, ui.garage]) {
    if (p.hidden) continue;
    const r = p.getBoundingClientRect();
    if (r.width < w * 0.8) left = Math.max(left, r.right); else bottom = Math.max(bottom, h - r.top + 8);
  }
  if (h - bottom - top < 140) bottom = h - top - 140;
  const sx = (left + (w - right)) / 2 - w / 2, sy = (top + (h - bottom)) / 2 - h / 2;
  const W2 = w + 2 * Math.abs(sx), H2 = h + 2 * Math.abs(sy);
  camera.setViewOffset(W2, H2, Math.abs(sx) - sx, Math.abs(sy) - sy, w, h);
  camera.aspect = W2 / H2;
  camera.updateProjectionMatrix();
  Object.assign(band, { top, bottom, left, right, w, h });
  rig.invalidate();
  const half = w > h ? [w / 2, h] : [w, h / 2];
  camA.aspect = camB.aspect = half[0] / half[1]; camA.updateProjectionMatrix(); camB.updateProjectionMatrix();
}
const portrait = () => innerHeight > innerWidth * 1.1;
addEventListener('resize', () => { layout(); updateCameras(0, true); });

function updateCameras(dt, snap) {
  if (!map) return;
  const inMatch = player && player.body && ['countdown', 'fight', 'ko', 'end'].includes(game.state);
  const garage = !ui.garage.hidden;
  if (game.state === 'replay') {
    const a = player.root.position, b = opp.root.position;
    orbitC.lerp(_pp.set((a.x + b.x) / 2, Math.max(-1, (a.y + b.y) / 2), (a.z + b.z) / 2), snap ? 1 : 1 - Math.exp(-dt * 3));
  } else if (garage && player) orbitC.copy(player.root.position);
  rig.update(dt, {
    focus: player, other: opp, bounds: map.bounds, band, portrait: portrait(),
    follow: portrait() && inMatch, snap, orbitCenter: orbitC
  });
  if (split) {
    rigA.update(dt, { focus: player, other: opp, bounds: map.bounds, band, snap });
    rigB.update(dt, { focus: opp, other: player, bounds: map.bounds, band, snap });
  }
}

// ------------------------------------------------------------------ HUD
function setText(el, t) { if (el._t !== t) { el._t = t; el.textContent = t; } }
function statusOf(r, mine) {
  if (r.flippedTime > 0.6) {
    const t = `Převrácený ${Math.max(0, Math.ceil(FLIP_LIMIT - r.flippedTime))} s`;
    if (!mine) return t;
    return t + (r.def.weapon === 'flipper' ? (touch ? ' · flipper = otočit' : ' · zbraň = otočit') : ' · jeďte a rozhoupejte se');
  }
  if (r.inverted) return 'Jede vzhůru nohama';
  if (r.def.weapon === 'spinner') return r.weaponOn ? `Zbraň ${Math.round(r.spin * 100)} %` : 'Zbraň vypnutá';
  return r.cooldown > 0 ? 'Flipper nabíjí' : 'Flipper připraven';
}
function dmgOf(r) {
  if (typeof r.damage === 'number') return r.damage <= 1 ? r.damage * 100 : r.damage;
  return r.dmgTaken || 0;
}
let lastCount = 0;
function hud() {
  if (!timed()) setText(ui.timer, game.kos ? `K.O. ${game.kos}` : 'Trénink');
  else setText(ui.timer, game.state === 'countdown' ? fmt(ROUND) : fmt(game.left));
  ui.timer.classList.toggle('low', game.state === 'fight' && timed() && game.left < 15);
  const duo = S.mode === 'duo';
  setText(ui.pStat, statusOf(player, true)); setText(ui.oStat, statusOf(opp, duo));
  ui.pStat.classList.toggle('warn', player.flippedTime > 0.6);
  ui.oStat.classList.toggle('warn', opp.flippedTime > 0.6);
  ui.pDmg.style.transform = `scaleX(${(dmgOf(player) / 100).toFixed(3)})`;
  ui.oDmg.style.transform = `scaleX(${(dmgOf(opp) / 100).toFixed(3)})`;
  if (game.state === 'countdown') {
    const n = Math.ceil(game.count - 0.2);
    if (n !== lastCount) { lastCount = n; if (n > 0 && n <= 3) sfx.beep(false); else if (n <= 0) sfx.beep(true); }
    setText(ui.msg, n > 0 ? String(n) : 'Boj!'); ui.msg.hidden = false;
  } else if (game.state === 'fight' && game.time < 0.8) { setText(ui.msg, 'Boj!'); ui.msg.hidden = false; }
  else if (game.state === 'ko') { /* K.O. stays */ }
  else if (flashT > 0) { /* training toast */ }
  else if (!ui.msg.hidden) ui.msg.hidden = true;
}
function sounds() {
  if (!player || !player.body) return;
  for (const [i, r] of [[1, player], [2, opp]]) {
    const v = r.body.linvel();
    const lvl = game.state === 'fight' || game.state === 'countdown' ? Math.min(1, Math.hypot(v.x, v.z) / (r.def.vmax || 6)) : 0;
    sfx.motor(i, lvl, game.state === 'fight' || game.state === 'ko' ? (r.spin || 0) : 0);
  }
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
const cmd1 = { throttle: 0, turn: 0, fire: false }, cmd2 = { throttle: 0, turn: 0, fire: false };
const _menuSpin = 0.25;
function frame(now) {
  requestAnimationFrame(frame);
  const wall = Math.min(0.25, Math.max(0, (now - last) / 1000)); last = now;
  if (document.hidden || ctxLost) return;
  let dt = Math.min(0.05, wall);
  const duo = S.mode === 'duo';
  const i1 = input.read(duo ? 1 : 0), i2 = duo ? input.read(2) : null;
  cmd1.throttle = i1.throttle; cmd1.turn = i1.turn; cmd1.fire = cmd1.fire || i1.fire;
  if (i2) { cmd2.throttle = i2.throttle; cmd2.turn = i2.turn; cmd2.fire = cmd2.fire || i2.fire; }

  const st = game.state;
  if (st === 'replay') {
    if (replay.tick(dt)) endReplay();
    hud();
  } else if (ready && player && player.body && (st === 'countdown' || st === 'fight' || st === 'ko' || st === 'end')) {
    if (st === 'countdown') { game.count -= dt; if (game.count <= 0) { game.state = 'fight'; game.time = 0; } }
    if (game.hitstop > 0) { game.hitstop -= wall; }
    else {
      game.acc += dt * (st === 'ko' ? 0.6 : 1);
      let n = 0;
      while (game.acc >= DT && n < 6) { physicsStep(cmd1, cmd2); game.acc -= DT; n++; }
      if (n === 6) game.acc = 0;
    }
    tickClock(wall);
    if (game.state === 'ko') { game.ko -= wall; if (game.ko <= 0) { game.state = 'end-wait'; afterKo(); } }
    if (respawnT > 0) { respawnT -= wall; if (respawnT <= 0) { placeAtSpawns(); brain && brain.reset(); } }
    if (flashT > 0) { flashT -= wall; if (flashT <= 0) ui.msg.hidden = true; }
    player.sync(dt); opp.sync(dt);
    hud();
  } else if (player && !reduce && st === 'menu' && ui.garage.hidden) {
    player.root.rotation.y += dt * _menuSpin; opp.root.rotation.y -= dt * _menuSpin;
  } else if (player && st === 'menu' && !ui.garage.hidden && !reduce) {
    player.root.rotation.y += dt * 0.5;
  }
  const showRings = player && player.body && game.state !== 'replay';
  if (showRings) {
    const p = player.body.translation(), q = opp.body.translation();
    ring.visible = p.y > -0.3; ring.position.set(p.x, 0.012, p.z);
    ring2.visible = duo && q.y > -0.3; ring2.position.set(q.x, 0.012, q.z);
  } else { ring.visible = ring2.visible = false; }
  sounds();
  stepSparks(dt);
  stepPops(dt);
  updateCameras(dt);
  if (!hook.noRender) render();
}
function render() {
  if (!split || game.state === 'menu') {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    renderer.render(scene, camera);
    return;
  }
  const w = innerWidth, h = innerHeight, land = w > h;
  renderer.setScissorTest(true);
  const vA = land ? [0, 0, w / 2, h] : [0, h / 2, w, h / 2], vB = land ? [w / 2, 0, w / 2, h] : [0, 0, w, h / 2];
  renderer.setViewport(...vA); renderer.setScissor(...vA); renderer.render(scene, camA);
  renderer.setViewport(...vB); renderer.setScissor(...vB); renderer.render(scene, camB);
  renderer.setScissorTest(false);
}

// ------------------------------------------------------------------ screens
function showScreen(s) {
  ui.start.hidden = s !== 'menu';
  ui.garage.hidden = s !== 'garage';
  ui.end.hidden = s !== 'end';
  ui.pause.hidden = s !== 'pause';
  ui.replayBar.hidden = s !== 'replay';
  ui.hud.hidden = !(s === 'play' || s === 'pause' || s === 'end' || s === 'replay');
  ui.tools.hidden = !(s === 'play');
  document.body.classList.toggle('playing', s === 'play');
  document.body.classList.toggle('split', split && s !== 'menu' && s !== 'garage');
  if (s !== 'play' && s !== 'replay') ui.msg.hidden = true;
  if (s === 'menu' || s === 'garage') { sfx.stopMotors(); split = false; document.body.classList.remove('split'); }
  layout();
  updateCameras(0, s === 'menu');
}
function toMenu() {
  clearTimeout(endTimer);
  replay.stop();
  game.state = 'menu';
  if (world) { for (const r of [player, opp]) if (r) r.body = null; try { world.free(); } catch (_) {} world = null; }
  makeRobots();
  rig.set('tv');
  showScreen('menu');
  renderMenu();
  ui.go.focus({ preventScroll: true });
}
function pause(on) {
  if (on && (game.state === 'fight' || game.state === 'countdown')) {
    game.pausedFrom = game.state; game.state = 'paused';
    sfx.stopMotors(); showScreen('pause'); $('#resume').focus();
  } else if (!on && game.state === 'paused') {
    game.state = game.pausedFrom; showScreen('play'); last = performance.now();
    renderer.domElement.focus({ preventScroll: true });
  }
}

// ------------------------------------------------------------------ menu
const btn = (cls, html, onclick, attrs = {}) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.innerHTML = html; b.onclick = e => { sfx.unlock(); sfx.click(); onclick(e); };
  for (const k in attrs) b.setAttribute(k, attrs[k]);
  return b;
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function buildMenu() {
  for (const m of MODES) ui.modes.appendChild(btn('opt', `<b>${m.name}</b><small>${m.blurb}</small>`, () => { S.mode = m.id; applyChoice(); }, { 'data-id': m.id }));
  for (const id of robotIds) ui.pick.appendChild(btn('opt', `<b>${esc(ROBOTS[id].name)}</b><small>${esc(ROBOTS[id].blurb || '')}</small>`, () => { if (S.robot === id) return; S.robot = id; applyChoice(); }, { 'data-id': id }));
  for (const c of COLORS) ui.colors.appendChild(btn('sw', '', () => { S.color = c.id; applyChoice(true); }, { 'data-id': c.id, 'aria-label': c.name, title: c.name, style: `--c:${c.hex}` }));
  ui.mapRow.hidden = MAP_LIST.length < 2;
  for (const m of MAP_LIST) ui.maps.appendChild(btn('opt', `<b>${esc(m.name)}</b><small>${esc(m.blurb || '')}</small>`, () => { if (S.map === m.id) return; setMap(m.id); renderMenu(); saveSettings(); syncUrl(); }, { 'data-id': m.id }));
}
function pressed(container, id) { container.querySelectorAll('button[data-id]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id))); }
function renderMenu() {
  pressed(ui.modes, S.mode); pressed(ui.pick, S.robot); pressed(ui.colors, S.color); pressed(ui.maps, S.map);
  $('#color-name').textContent = COLORS.find(c => c.id === S.color).name;
  // per-mode context row
  const c = ui.ctx; c.innerHTML = '';
  if (S.mode === 'quick') {
    c.innerHTML = '<div class="lbl"><span>Obtížnost</span><span id="lvl-blurb"></span></div>';
    const row = document.createElement('div'); row.className = 'seg';
    for (const id of ['easy', 'normal', 'hard']) row.appendChild(btn('', LEVELS[id].name, () => { S.level = id; saveSettings(); renderMenu(); }, { 'data-id': id, 'aria-pressed': String(S.level === id) }));
    c.appendChild(row); $('#lvl-blurb').textContent = LEVELS[S.level].blurb;
  } else if (S.mode === 'ladder') {
    const st = Math.min(ladder.stage, LADDER.length - 1);
    let h = '<div class="lbl"><span>Žebříček</span>' + (ladder.champion ? `<span>Vítězství v turnaji: ${ladder.champion}×</span>` : '') + '</div><ol class="ladder">';
    LADDER.forEach((L, i) => { h += `<li class="${i < st ? 'done' : i === st ? 'now' : ''}"><b>${esc(L.name)}</b><small>${LEVELS[L.level].name}${i < st ? ' · poražen' : i === st ? ' · na řadě' : ''}</small></li>`; });
    c.innerHTML = h + '</ol>';
    if (ladder.stage > 0) c.appendChild(btn('link', 'Začít turnaj znovu', () => { ladder.stage = 0; store.set('ladder', ladder); renderMenu(); makeRobots(); }));
  } else if (S.mode === 'duo') {
    c.innerHTML = '<div class="lbl"><span>Robot hráče 2</span></div>';
    const row = document.createElement('div'); row.className = 'seg';
    for (const id of robotIds) row.appendChild(btn('', esc(ROBOTS[id].short || ROBOTS[id].name), () => { S.p2robot = id; saveSettings(); renderMenu(); makeRobots(); }, { 'data-id': id, 'aria-pressed': String(S.p2robot === id) }));
    c.appendChild(row);
    const p = document.createElement('p'); p.className = 'hint';
    p.innerHTML = 'Hráč 1: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> + <kbd>Mezerník</kbd> · Hráč 2: šipky + <kbd>Enter</kbd> · nebo dva gamepady. <kbd>C</kbd> přepne na rozdělenou obrazovku.';
    c.appendChild(p);
  } else {
    c.innerHTML = '<p class="hint">Volná jízda bez časového limitu. Soupeř stojí jako figurína – tlačítkem <b>Soupeř jezdí</b> ho rozjedete. <kbd>R</kbd> vrátí oba roboty na start.</p>';
  }
  const g = garageModel.summary(S.robot, modsFor(S.robot));
  ui.garageBtn.querySelector('small').textContent = g.mods ? `${g.grams} g · úpravy: ${g.mods}` : `${g.grams} g · bez úprav`;
  applyHint();
}
function applyChoice(colorOnly) {
  if (colorOnly && player) { player.setColor(colorHex(S.color)); }
  else makeRobots();
  saveSettings(); syncUrl(); renderMenu(); hudNames();
}
function hudNames() {
  const o = oppSetup();
  const duo = S.mode === 'duo';
  ui.pName.textContent = ROBOTS[S.robot].name; ui.oName.textContent = o.name;
  ui.pTag.textContent = duo ? 'P1' : 'Vy'; ui.oTag.textContent = duo ? 'P2' : o.level ? LEVELS[o.level].name : 'AI';
  ui.pSw.style.background = colorHex(S.color); ui.oSw.style.background = o.hex;
  ui.back.href = KIT_URL(S.robot);
}
function syncUrl() {
  try {
    const u = new URL(location.href);
    u.searchParams.set('robot', S.robot); u.searchParams.set('color', S.color);
    if (MAP_LIST.length > 1) u.searchParams.set('map', S.map);
    history.replaceState(null, '', u);
  } catch (_) {}
}
function applyHint() {
  const w = ROBOTS[S.robot].weapon === 'flipper' ? 'flipper (i k převrácení zpět)' : 'roztočení zbraně (zap/vyp)';
  ui.hint.innerHTML = touch
    ? `Levý joystick jízda · tlačítko vpravo ${w}`
    : `<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> nebo šipky jízda · <kbd>Mezerník</kbd> ${w} · <kbd>C</kbd> kamera · <kbd>M</kbd> zvuk · <kbd>Esc</kbd> pauza · funguje i gamepad`;
}

// ------------------------------------------------------------------ garage
function openGarage() {
  showScreen('garage');
  rig.set('orbit'); rig.orbit.radius = 3.2; rig.orbit.height = 1.6;
  renderGarage();
  $('#garage-done').focus();
}
function renderGarage() {
  const root = $('#garage-body');
  const mods = modsFor(S.robot);
  const sum = garageModel.summary(S.robot, mods);
  let h = `<div class="mono">Garáž</div><h1 id="garage-h">${esc(ROBOTS[S.robot].name)}</h1>`;
  const over = sum.grams > sum.limit;
  h += `<div class="budget${over ? ' over' : ''}"><div class="lbl"><span>Hmotnost</span><span>${sum.grams} / ${sum.limit} g</span></div><div class="bar"><i style="transform:scaleX(${Math.min(1, sum.grams / sum.limit).toFixed(3)})"></i></div></div>`;
  h += '<dl class="stats">' + sum.stats.map(s => `<div><dt>${s.name}</dt><dd><span class="bar"><i style="transform:scaleX(${s.v.toFixed(3)})"></i></span></dd></div>`).join('') + '</dl>';
  root.innerHTML = h;
  const list = document.createElement('div'); list.className = 'mods';
  const avail = garageModel.list(S.robot);
  if (!avail.length) {
    const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Úpravy pro tohoto robota připravujeme.'; list.appendChild(p);
  }
  for (const m of avail) {
    const on = mods.includes(m.id);
    const test = garageModel.summary(S.robot, on ? mods.filter(x => x !== m.id) : garageModel.sanitize(S.robot, [...mods.filter(x => !garageModel.sameSlot(S.robot, x, m.id)), m.id], true));
    const blocked = !on && test.grams > test.limit;
    const b = btn('opt mod', `<b>${esc(m.name)}</b><small>${esc(m.desc || '')}</small><em>${m.grams > 0 ? '+' : ''}${m.grams} g</em>`, () => {
      const cur = modsFor(S.robot);
      S.mods[S.robot] = on ? cur.filter(x => x !== m.id) : [...cur.filter(x => !garageModel.sameSlot(S.robot, x, m.id)), m.id];
      saveSettings(); makeRobots(); renderGarage(); renderMenu();
      const again = list.querySelector(`[data-id="${m.id}"]`); again && again.focus();
    }, { 'data-id': m.id, 'aria-pressed': String(on) });
    if (blocked) { b.disabled = true; b.title = 'Překročili byste limit 150 g'; }
    list.appendChild(b);
  }
  root.appendChild(list);
  const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.innerHTML = '<span>Barva tisku</span>';
  const sws = document.createElement('div'); sws.className = 'sws';
  for (const c of COLORS) sws.appendChild(btn('sw', '', () => { S.color = c.id; applyChoice(true); renderGarage(); sws.querySelector(`[data-id="${c.id}"]`) && root.querySelector(`.sws [data-id="${c.id}"]`).focus(); }, { 'data-id': c.id, 'aria-label': c.name, title: c.name, style: `--c:${c.hex}`, 'aria-pressed': String(S.color === c.id) }));
  const wrap = document.createElement('div'); wrap.append(lbl, sws); root.appendChild(wrap);
}

// ------------------------------------------------------------------ share
async function shareResult() {
  const r = game.result; if (!r) return;
  const u = new URL(location.href);
  for (const k of [...u.searchParams.keys()]) u.searchParams.delete(k);
  u.searchParams.set('robot', S.robot); u.searchParams.set('color', S.color); u.searchParams.set('mode', S.mode);
  if (MAP_LIST.length > 1) u.searchParams.set('map', S.map);
  const opName = opp.displayName || opp.def.name;
  const verdict = r.win === null ? 'Remíza' : r.win ? (r.kind === 'ko' ? `Výhra K.O. za ${fmt(r.time)}` : 'Výhra na body') : 'Prohra';
  const text = `${verdict}: ${player.def.name} vs. ${opName} v aréně 150 g na printedrobotics.cz. Zkusíte to líp?`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Aréna 150 g', text, url: u.href }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text} ${u.href}`); ui.shareMsg.textContent = 'Odkaz zkopírován do schránky.'; }
  catch (_) { ui.shareMsg.textContent = u.href; }
}

// ------------------------------------------------------------------ toolbar / keys
function cycleCam() {
  const list = S.mode === 'duo' ? ['tv', 'split', 'top'] : CAM_MODES.map(c => c.id);
  const i = list.indexOf(S.cam);
  S.cam = list[(i + 1) % list.length] || 'tv';
  saveSettings();
  split = S.mode === 'duo' && S.cam === 'split' && game.state !== 'menu';
  document.body.classList.toggle('split', split);
  if (!split) rig.set(S.cam === 'split' ? 'tv' : S.cam);
  else { rigA.set('chase', true); rigB.set('chase', true); }
  renderTools();
  announce(`Kamera: ${camName()}`);
}
const camName = () => S.cam === 'split' ? 'Rozdělená obrazovka' : (CAM_MODES.find(c => c.id === S.cam) || CAM_MODES[0]).name;
function renderTools() {
  ui.camBtn.querySelector('span').textContent = camName();
  ui.sndBtn.querySelector('span').textContent = sfx.muted ? 'Zvuk vyp.' : 'Zvuk zap.';
  ui.sndBtn.setAttribute('aria-pressed', String(!sfx.muted));
  ui.resetBtn.hidden = ui.dummyBtn.hidden = S.mode !== 'training';
  ui.dummyBtn.setAttribute('aria-pressed', String(!!(brain && brain.level.id !== 'dummy')));
  $('#shake-opt').checked = S.shake; $('#shake-opt').disabled = reduce;
  $('#replay-opt').checked = S.autoReplay;
}
function toggleMute() { sfx.setMuted(!sfx.muted); renderTools(); announce(sfx.muted ? 'Zvuk vypnut' : 'Zvuk zapnut'); }
function announce(t) { ui.live.textContent = t; }
function trainingReset() { if (S.mode === 'training' && player && player.body) { placeAtSpawns(); brain && brain.reset(); } }
function toggleDummy() {
  if (S.mode !== 'training') return;
  brain = createBrain(brain && brain.level.id === 'dummy' ? 'easy' : 'dummy', map);
  opp.handicap = brain.level.handicap;
  renderTools(); announce(brain.level.id === 'dummy' ? 'Soupeř stojí' : 'Soupeř jezdí');
}
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  sfx.unlock();
  const inField = e.target && e.target.closest && e.target.closest('input,select,textarea');
  if (inField) return;
  if (game.state === 'replay' && !e.repeat && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) { e.preventDefault(); endReplay(); return; }
  if (e.code === 'Escape') {
    if (game.state === 'paused') pause(false);
    else if (game.state === 'fight' || game.state === 'countdown') pause(true);
    else if (!ui.garage.hidden) closeGarage();
    return;
  }
  if (e.repeat) return;
  const live = ['fight', 'countdown', 'ko', 'end'].includes(game.state);
  if (e.code === 'KeyP' && live) pause(true);
  if (e.code === 'KeyC' && (live || game.state === 'paused')) cycleCam();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyR' && S.mode === 'training') trainingReset();
  if (e.code === 'KeyT' && S.mode === 'training') toggleDummy();
});
function closeGarage() { rig.set('tv'); showScreen('menu'); renderMenu(); ui.garageBtn.focus(); }

function setTouchUI(on) {
  if (touch === on) return;
  touch = on; document.documentElement.classList.toggle('touch', on);
  applyHint(); layout();
}
addEventListener('pointerdown', e => { sfx.unlock(); if (e.pointerType === 'touch') setTouchUI(true); }, { capture: true, passive: true });

// ------------------------------------------------------------------ boot
try {
  ui.go.onclick = () => { sfx.unlock(); startRound(); };
  ui.again.onclick = startRound;
  ui.next.onclick = startRound;
  ui.menuBtn.onclick = toMenu;
  ui.replayBtn.onclick = () => playReplay(false);
  ui.skip.onclick = endReplay;
  ui.share.onclick = shareResult;
  ui.garageBtn.onclick = openGarage;
  $('#garage-done').onclick = closeGarage;
  $('#resume').onclick = () => pause(false);
  $('#restart').onclick = startRound;
  $('#quit').onclick = toMenu;
  ui.camBtn.onclick = cycleCam; ui.sndBtn.onclick = toggleMute; ui.pauseBtn.onclick = () => pause(true);
  ui.resetBtn.onclick = trainingReset; ui.dummyBtn.onclick = toggleDummy;
  $('#shake-opt').onchange = e => { S.shake = e.target.checked; saveSettings(); };
  $('#replay-opt').onchange = e => { S.autoReplay = e.target.checked; saveSettings(); };
  new ResizeObserver(() => { layout(); updateCameras(0, true); }).observe(ui.start);
  new ResizeObserver(() => { layout(); }).observe(ui.garage);
  setMap(S.map);
  buildMenu();
  makeRobots(); renderMenu(); hudNames(); renderTools(); syncUrl();
  game.state = 'menu';
  rig.set('tv', true);
  showScreen('menu');
  requestAnimationFrame(frame);
} catch (e) {
  fail('Arénu se nepodařilo spustit. Zkuste stránku obnovit.');
  throw e;
}

// debug / test hook, only with ?debug (headless tests drive the simulation directly)
const hook = {
  noRender: false,
  sim(sec, th = 0, tu = 0, fire = false) {
    const c = { throttle: th, turn: tu, fire }, c2 = { throttle: 0, turn: 0, fire: false };
    for (let i = 0; i < Math.round(sec / DT); i++) {
      if (game.state === 'countdown') { game.count -= DT; if (game.count <= 0) { game.state = 'fight'; game.time = 0; } continue; }
      if (game.state !== 'fight' && game.state !== 'ko') break;
      c.throttle = th; c.turn = tu; physicsStep(c, c2); c.fire = false; tickClock(DT);
      if (game.state === 'ko') { game.ko -= DT; if (game.ko <= 0) { game.state = 'end-wait'; afterKo(); break; } }
    }
    player.sync(sec); opp.sync(sec); hud();
    return this.state();
  },
  game, input, models: {}, renderer, scene, camera, rig, replay, S, ladder: () => ladder,
  get player() { return player; }, get ai() { return opp; }, get ready() { return ready; }, get map() { return map; },
  setMode(m) { S.mode = m; applyChoice(); }, setMap(id) { setMap(id); renderMenu(); }, cycleCam, setLevel(l) { S.level = l; renderMenu(); },
  skipReplay: () => game.state === 'replay' && endReplay(), garage: openGarage, closeGarage, pause, toMenu, frame(n = 1) { for (let i = 0; i < n; i++) { updateCameras(1 / 60); stepPops(1 / 60); } render(); },
  state() {
    const s = r => { const t = r.body ? r.body.translation() : r.root.position; const u = r.up; return { x: +t.x.toFixed(2), y: +t.y.toFixed(2), z: +t.z.toFixed(2), up: u ? +u.y.toFixed(2) : 1, spin: +(r.spin || 0).toFixed(2), hits: r.hits, flipped: +(r.flippedTime || 0).toFixed(1), dmg: Math.round(dmgOf(r)) }; };
    return { state: game.state, left: +game.left.toFixed(1), result: game.result && { win: game.result.win, why: game.result.why, kind: game.result.kind }, player: s(player), ai: s(opp), cam: rig.mode, mode: S.mode, map: S.map };
  },
  start: startRound
};
if (DEBUG) window.__arena = hook;
