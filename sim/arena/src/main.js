// printedrobotics.cz — antweight arena (three.js + Rapier).
// Game flow, cameras, HUD, menus and juice live here; robots/physics in robots.js,
// arenas in arena.js / maps/.
import { t as i18nT, isEn } from './i18n/index.js'; // first: starts the English translation before any UI is built
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
import { createReplayUI } from './ui/replay.js';
import { Recorder, deserialize, serialize as serializeReplay, isLocalReplayPath } from './replay/codec.js';
import { createBinding, remapBinding, sanitizeHazards } from './replay/scene.js';
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
  { name: 'Kancelářská sponka', level: 'easy', prefer: 'klepeto', color: 'grey' },
  { name: 'Bzučák', level: 'normal', prefer: 'vert150', color: 'blue' },
  { name: 'Ocelová Máňa', level: 'hard', prefer: 'kosa', color: 'black' }
];
const ROUND = 120, FLIP_LIMIT = 10, DT = 1 / 120;
const MODEL_URL = id => `../../models/${id}.glb`;
// only these robots have a kit page; the rest exist only in the game
const KITS = new Set(['svrn', 'vert150']);
const KIT_URL = id => (KITS.has(id) ? `../../sada/${id}/` : '../../?typ=combat#katalog');

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

// ------------------------------------------------------------------ maps (registry from arena.js / maps/)
const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d8d2, 0.85);
const MAP_LIST = ARENA.MAPS ? (ARENA.MAP_LIST || Object.keys(ARENA.MAPS)).map(id => ARENA.MAPS[id]).map(m => ({ id: m.id, name: m.name, blurb: m.description || m.blurb || '', preview: m.preview })) : [{ id: 'klasika', name: 'Klasická aréna', blurb: '' }];
// wraps the maps agent's runtime (TEAM.md) into what the game loop uses
function makeMap(id) {
  const m = ARENA.createMap(id, { scene, quality: touch ? 'low' : 'high', lights: { key, hemi }, onEvent: mapEvent });
  const pits = (m.pits || []).map(p => ({ x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2 }));
  return {
    id: m.id, name: m.name, raw: m,
    physics: (R, w) => m.attachPhysics(R, w),
    get spawns() { return m.spawnPoints || m.spawns; },
    bounds: m.bounds || { x0: -6, x1: 6, z0: -6, z1: 6 },
    hazards: pits,
    hazardAt: (x, z) => m.hazardAt(x, z),
    inPit: (x, z) => (m.inPit ? m.inPit(x, z) : false),
    outcome: p => m.outCheck(p.x, p.y, p.z),
    reset: () => m.reset && m.reset(),
    step: (dt, robots, fighting) => m.step && m.step(dt, robots, fighting),
    afterStep: robots => m.afterStep && m.afterStep(robots),
    frame: dt => m.frame && m.frame(dt),
    status: () => (m.status ? m.status() : null),
    dispose: () => m.dispose()
  };
}
// map hazards report hits / strikes / warnings here (sound, sparks, labels, judges)
function mapEvent(type, d) {
  if (!d) return;
  const p = { x: d.x || 0, y: d.y || 0.3, z: d.z || 0 };
  if (type === 'hit') {
    emitSparks(p, d.energy || 0.6); sfx.hit(d.energy || 0.6, true, p);
    if (S.shake) rig.shake(0.2);
    if (d.robot && (d.robot === player || d.robot === opp)) popLabel(p, 'Nástraha!', true);
    if (game.state === 'fight' || game.state === 'ko') recEvent({ type: 'hit', by: -1, who: d.robot === player ? 0 : d.robot === opp ? 1 : -1, p: rp(p), e: +(d.energy || 0.6).toFixed(2) });
  } else if (type === 'strike') { sfx.wall(d.energy || 0.6, p); if (S.shake) rig.shake(0.08); }
  else if (type === 'warn') sfx.beep(false);
  else if (type === 'pit-open') { sfx.pitOpen(); flash('Jáma se otevřela!', 1.4); }
}
if (!MAP_LIST.some(m => m.id === S.map)) S.map = ARENA.DEFAULT_MAP || MAP_LIST[0].id;

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
  pops: $('#pops'), mapStatus: $('#map-status'), replayBar: $('#replay-ui'), skip: $('#skip'), fullBtn: $('#full-btn'), lastBtn: $('#last-btn'), live: $('#live'), garageBtn: $('#garage-btn')
};

let failed = false;
function fail(text) {
  failed = true;
  // a replay must not stay on top of the error panel (GPU context lost mid-replay)
  try { if (rui.active) { rui.playback.playing = false; ui.replayBar.hidden = true; } } catch (_) { /* rui not created yet */ }
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
let pixelRatio = Math.min(devicePixelRatio || 1, touch ? 1.75 : 1.75);
renderer.setPixelRatio(pixelRatio);
// adaptive resolution: if frames stay slow (mid phones), step the pixel ratio down
const perf = { ema: 1 / 60, slow: 0 };
function adaptQuality(wall) {
  if (hook.halt || wall <= 0 || wall > 0.2) return;
  perf.ema += (wall - perf.ema) * 0.05;
  perf.slow = perf.ema > 1 / 30 ? perf.slow + wall : 0;
  if (perf.slow > 2 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.25); perf.slow = 0; perf.ema = 1 / 45;
    renderer.setPixelRatio(pixelRatio); layout();
  }
}
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
  const st = game.state;
  showScreen(st === 'menu' ? 'menu' : st === 'end' ? 'end' : st === 'replay' ? 'replay' : st === 'paused' ? 'pause' : 'play');
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
scene.add(key, hemi);

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
function clearPops() { for (const o of pops) { o.t = 0; o.el.hidden = true; } }
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
    if (game.state === 'fight' || game.state === 'ko') recEvent({ type: 'hit', by: by === player ? 0 : 1, p: rp(p), e: +e.toFixed(2) });
    if (S.shake) { rig.shake(0.12 + 0.25 * e); rigA.shake(0.1 + 0.2 * e); rigB.shake(0.1 + 0.2 * e); }
    if (e > 0.4) game.hitstop = Math.max(game.hitstop, 0.04 + 0.08 * e);
    sfx.hit(e, by.def.weapon === 'spinner', p);
    if (e > 0.75) sfx.crowd(0.6);
    map && map.raw.excite && map.raw.excite(Math.min(1, 0.3 + e));
    if (navigator.vibrate && touch && (by === player || victim === player)) try { navigator.vibrate(by === player ? 30 : 60); } catch (_) {}
    const dmg = Math.round(4 + 16 * e);
    if (game.state === 'fight') {
      victim.dmgTaken = Math.min(100, (victim.dmgTaken || 0) + dmg * 0.6);
      const st = stats.get(by); if (st) { st.damage += 0.3 + e; st.hits++; }
    }
    popLabel(p, by.def.weapon === 'flipper' ? 'Flip!' : e > 0.85 ? `Kritický zásah −${dmg}` : `−${dmg}`, e > 0.85);
    if (game.events.length < 400) game.events.push({ t: +game.time.toFixed(2), type: 'hit', by: by === player ? 'p1' : 'p2', e: +e.toFixed(2) });
  },
  wall(by, p, e) {
    sfx.wall(Math.min(1, e + 0.2), p); emitSparks(p, e * 0.6);
    if (S.shake && e > 0.4) rig.shake(0.08 + 0.12 * e);
  },
  grab(by) { sfx.grab(by); popLabel(by.root.position, 'Chycen!', false); },
  flip(by) {
    sfx.flip(by);
    recEvent({ type: 'fire', by: by === player ? 0 : 1 });
    if (game.events.length < 400) game.events.push({ t: +game.time.toFixed(2), type: 'fire', by: by === player ? 'p1' : 'p2' });
  }
};
function disposeRobot(r) {
  scene.remove(r.root);
  r.root.traverse(o => {
    if (!o.isMesh || o.userData.shared) return;
    o.geometry && !o.geometry.userData.fromGlb && o.geometry.dispose();
  });
  r.printMat && r.printMat.dispose();
  // per-robot materials (cloned GLB print materials, spinner blur disc)
  (r.printMats || []).forEach(m => m !== r.printMat && m.userData.perRobot && m.dispose());
  if (r.parts && r.parts.blur && r.parts.blur.material) r.parts.blur.material.dispose();
}
let quickOpp = null, selfBrain = null;   // selfBrain: debug-only AI pilot for the player
function oppSetup() {
  if (S.mode === 'duo') return { id: S.p2robot, hex: S.p2robot === S.robot && S.color === 'blue' ? colorHex('orange') : S.color === 'blue' ? colorHex('orange') : colorHex('blue'), level: null, name: ROBOTS[S.p2robot].name };
  if (S.mode === 'ladder') {
    const L = LADDER[Math.min(ladder.stage, LADDER.length - 1)];
    const id = own(ROBOTS, L.prefer) ? L.prefer : robotIds[ladder.stage % robotIds.length];
    let c = L.color === S.color ? 'white' : L.color;
    return { id, hex: colorHex(c), level: L.level, name: L.name };
  }
  if (!quickOpp || quickOpp === S.robot || !own(ROBOTS, quickOpp)) {
    const others = robotIds.filter(r => r !== S.robot);
    quickOpp = others.length ? others[Math.floor(Math.random() * others.length)] : S.robot;
  }
  const id = quickOpp;
  const hex = S.color === 'orange' ? '#1F3BFF' : S.color === 'black' ? '#9A9A94' : '#2A2A2A';
  return { id, hex, level: S.mode === 'training' ? 'dummy' : S.level, name: ROBOTS[id].name };
}
function makeRobots() {
  if (player) { if (world) removeBodies(); disposeRobot(player); disposeRobot(opp); }
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
  const id = 'model' in robot.def ? robot.def.model : robot.def.id;
  if (!id || modelCache[id] === false) return;
  const p = modelCache[id] || (modelCache[id] = new Promise((res, rej) => gltfLoader.load(MODEL_URL(id), g => { g.scene.traverse(o => { if (o.geometry) o.geometry.userData.fromGlb = true; }); res(g.scene); }, undefined, rej)));
  p.then(sc => {
    if (robot.root.parent !== scene) return;
    hook.models[id] = robot.useModel(sc.clone(true));
  }).catch(() => { modelCache[id] = false; });
}
// mods: physics agent's data model via garage.js (empty when unavailable)
function modsFor(id) { return garageModel.sanitize(id, S.mods[id] || []); }

// ------------------------------------------------------------------ physics / world lifecycle
let RAPIER, world, ready = false;
function setMap(id) {
  const m = MAP_LIST.find(x => x.id === id) || MAP_LIST[0];
  S.map = m.id;
  if (map) { removeBodies(); map.dispose(); }
  map = makeMap(m.id);
  if (world) map.physics(RAPIER, world);
  // player marker readable on dark arenas
  const bg = new THREE.Color((map.raw.env && map.raw.env.background) || '#EEEEEB');
  const dark = bg.r * 0.3 + bg.g * 0.59 + bg.b * 0.11 < 0.35;
  ring.material.color.set(dark ? '#F4F4F1' : '#0E0E0E');
  document.body.classList.toggle('dark-map', dark);
  rig.invalidate();
  if (brain) brain = createBrain(brain.level.id, map);
  park();
}
function ensureWorld() {
  if (world) return;
  world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = DT;
  map.physics(RAPIER, world);
}
function removeBodies() {
  for (const r of [player, opp]) if (r && r.body) {
    if (r.detachPhysics) r.detachPhysics(true); else { world.removeRigidBody(r.body); r.body = null; }
  }
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
// ---- match recording (src/replay/*): 30 Hz snapshots of robots, hazards and loose bits
let rec = null, recBind = null, recVals = null, replaySrc = null;
const recUp = [1, 1];
const rp = p => ({ x: +p.x.toFixed(2), y: +(p.y || 0).toFixed(2), z: +p.z.toFixed(2) });
function recStart() {
  recBind = createBinding([player, opp], map.raw);
  rec = new Recorder(recBind.layout, { maxSeconds: S.mode === 'training' ? 300 : ROUND + 60 });
  recVals = new Float64Array(recBind.channels);
  recUp[0] = recUp[1] = 1;
}
function recTick() {
  if (!rec || game.time + 1e-9 < rec.time) return;
  rec.push(recBind.sample(recVals));
  if (DEBUG && hook.probe) { const a = player.body.translation(), b = opp.body.translation(); hook.probe.push([rec.ticks - 1, a.x, a.y, a.z, b.x, b.y, b.z]); }
  [player, opp].forEach((r, i) => {
    const q = r.body.rotation(), up = 1 - 2 * (q.x * q.x + q.z * q.z);
    if (recUp[i] > 0.2 && up < -0.2) recEvent({ type: 'flip', who: i, p: rp(r.body.translation()) });
    if (up > 0.2 || up < -0.2) recUp[i] = up;
  });
}
function recEvent(e) { if (rec) rec.event(e); }
function replayHeader() {
  return {
    app: 'printedrobotics.cz/sim/arena', created: new Date().toISOString(), map: S.map, mode: S.mode, round: ROUND, timed: timed(),
    robots: [player, opp].map((r, i) => ({
      id: r.def.id, mods: r.def.modList, color: '#' + r.printMat.color.getHexString(),
      name: i ? (opp.displayName || r.def.name) : r.def.name, tag: (i ? ui.oTag : ui.pTag).textContent
    })),
    hazards: recBind.hazardsSpec, result: game.result ? { win: game.result.win, why: game.result.why, kind: game.result.kind } : null
  };
}
const rui = createReplayUI({
  scene, canvas: renderer.domElement,
  names: () => replayNames,
  camPose: () => ({ angle: Math.atan2(camera.position.x - orbitC.x, camera.position.z - orbitC.z) }),
  onEvent(e) {
    if (e.type === 'hit' && e.p) {
      emitSparks(e.p, e.e || 0.6);
      if (e.by >= 0) sfx.hit(e.e || 0.6, true, e.p); else sfx.wall(e.e || 0.6, e.p);   // by -1 = hazard
      if (S.shake) rig.shake(0.06 + 0.12 * (e.e || 0.6));
    }
    else if (e.type === 'fire') sfx.flip();
    else if (e.type === 'flip') sfx.wall(0.5, e.p);
    else if (e.type === 'pit' || e.type === 'out') sfx.fall();
    else if (e.type === 'ko') sfx.crowd(0.8);
  },
  onClose: closedReplay
});
let replayNames = ['Vy', 'Soupeř'];
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
  quitReplay();
  ensureWorld();
  removeBodies();
  makeRobots();
  map.reset();
  for (const r of [player, opp]) r.attachPhysics(RAPIER, world);
  placeAtSpawns();
  brain && brain.reset();
  newStats(); recStart();
  Object.assign(game, { state: 'countdown', time: 0, left: ROUND, count: 3.2, acc: 0, result: null, events: [], hitstop: 0, ko: 0, slow: 1, lastBeep: 0, kos: 0 });
  input.reset();
  input.split.on = S.mode === 'duo';
  split = S.mode === 'duo' && S.cam === 'split';
  rig.set(S.mode === 'duo' && S.cam === 'split' ? 'tv' : camModeFor(), true);
  hudNames(); renderTools();
  showScreen('play');
  ui.wlabel.textContent = player.weaponLabel || (player.def.weapon === 'flipper' ? 'Flipper' : 'Zbraň');
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
  if (r.kind === 'ko' && S.autoReplay && rec && rec.length > 60) openReplay('instant', 'auto');
  else showEnd();
}
function showEnd() {
  // once per round: a double skip / double tap must not advance the ladder twice
  if (!game.result || game.result.shown) return;
  game.result.shown = true;
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
  const soon = !!player.def.preparing, kit = KITS.has(player.def.id);
  ui.endKitL.textContent = !kit ? 'Zatím jen ve hře' : soon ? 'Stavebnici připravujeme' : 'Stavebnice';
  ui.ctaL.textContent = !kit ? 'Bojoví roboti v katalogu' : soon ? 'Dejte mi vědět' : 'Postavte si ho';
  const tr = rec && rec.length > 30;
  ui.replayBtn.hidden = !(tr && (kind === 'ko' || rec.events.some(e => e.type === 'hit')));
  ui.replayBtn.querySelector('span').textContent = kind === 'ko' ? 'Opakovat K.O.' : 'Opakovat zásah';
  ui.fullBtn.hidden = !tr;
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
const _dv = new WeakMap();
function physicsStep(c1, c2) {
  game.time += DT;
  const live = game.state === 'fight';
  const idle = { throttle: 0, turn: 0, fire: false };
  const pin = live ? (selfBrain ? selfBrain.think(player, opp, DT, game.time) : c1) : idle;
  const oin = live ? (brain ? brain.think(opp, player, DT, game.time) : c2) : idle;
  player.step(DT, pin, opp, fx);
  opp.step(DT, oin, player, fx);
  c1.fire = false; if (c2) c2.fire = false;
  map.step(DT, [player, opp], live);
  world.step();
  map.afterStep([player, opp]);
  wallKnocks();
  if (game.state === 'fight' || game.state === 'ko') recTick();
  if (!live) return;
  if (S.mode !== 'training') judgeTick();
  const po = map.outcome(player.body.translation()), oo = map.outcome(opp.body.translation());
  if (S.mode === 'training') return trainingChecks(po, oo);
  const P = nameOf(player), O = nameOf(opp), duo = S.mode === 'duo';
  if (oo) recEvent({ type: oo === 'pit' ? 'pit' : 'out', who: 1, p: rp(opp.body.translation()) });
  if (po) recEvent({ type: po === 'pit' ? 'pit' : 'out', who: 0, p: rp(player.body.translation()) });
  if (!oo && !po) for (const [r, i] of [[opp, 1], [player, 0]]) if (r.flippedTime >= FLIP_LIMIT) { recEvent({ type: 'ko', who: i, p: rp(r.body.translation()) }); break; }
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
    if (dv > 2.6 && prev.cd <= 0) { prev.cd = 0.18; sfx.wall(Math.min(1, dv / 9), r.root.position); }
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
  if (oo || opp.flippedTime >= FLIP_LIMIT) recEvent({ type: oo === 'pit' ? 'pit' : oo ? 'out' : 'ko', who: 1, p: rp(opp.body.translation()) });
  else if (po || player.flippedTime >= FLIP_LIMIT) recEvent({ type: po === 'pit' ? 'pit' : po ? 'out' : 'ko', who: 0, p: rp(player.body.translation()) });
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
    for (const [a, b] of [[player, opp], [opp, player]]) if (b.damage && typeof b.damage.taken === 'number') stats.get(a).damage = b.damage.taken / 10 + stats.get(a).hits * 0.2;
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
// kind: 'instant' (the KO / biggest hit, slow), 'full' (whole match), 'last' (last 20 s, from pause)
// back: 'auto' (KO auto replay -> end screen), 'end', 'pause'
function openReplay(kind, back) {
  if (!rec || rec.length < 30) { if (back === 'auto') showEnd(); return; }
  // never stack two replays (a late KO timer, a double tap): the open one gives its scene state back first
  if (rui.active) rui.close('silent');
  const track = rec.track();
  let win = null, title = 'Celý zápas', speed = 1;
  if (kind === 'instant') {
    const h = highlightOf(track), t = h ? h.t : track.t1;
    const ko = h && h.type !== 'hit';
    win = [t - (ko ? 3.4 : 2.6), Math.min(track.t1, t + (ko ? 1.2 : 1.6))];
    title = ko ? 'Záznam K.O.' : 'Opakovaný zásah'; speed = reduce ? 0.5 : 0.5;
  } else if (kind === 'last') { win = [track.t1 - 20, track.t1]; title = 'Posledních 20 s'; }
  replaySrc = { kind: 'live', back, saved: recBind.capture(), binding: recBind, robots: [player, opp] };
  replayNames = [player, opp].map(r => r.def.short || r.def.name);
  clearTimeout(endTimer);
  game.state = 'replay';
  sfx.stopMotors(); clearPops();
  showScreen('replay');
  try {
    rui.open({ track, binding: recBind, window: win, title, instant: kind !== 'full', autoClose: back === 'auto', speed, header: replayHeader(), timed: timed() });
  } catch (e) { console.error(e); return replayFailed(); }
  updateCameras(0, true);
  ui.skip.focus({ preventScroll: true });
}
// rui.open threw (state is 'replay' but nothing plays): go back where we came from, with a Czech message
const REPLAY_FAIL = 'Záznam se nepodařilo přehrát.';
function replayFailed(text = REPLAY_FAIL) {
  const src = replaySrc;
  if (!src || src.kind === 'file') {
    replaySrc = null;
    try { if (src && src.binding) src.binding.restore(src.saved, scene); } catch (_) { /* ignore */ }
    if (src && src.prevMap && src.prevMap !== S.map) setMap(src.prevMap);
    toMenu();
    $('#load-msg').textContent = text;
    return;
  }
  closedReplay('user');
  if (game.state === 'end') ui.shareMsg.textContent = text; else flash(text, 2);
}
function highlightOf(track) {
  const ev = track.events;
  const ko = ev.filter(e => e.type === 'ko' || e.type === 'pit' || e.type === 'out').pop();
  if (ko) return ko;
  let best = null;
  for (const e of ev) if (e.type === 'hit' && (!best || e.e > best.e)) best = e;
  return best;
}
// called by the replay UI when it closes
function closedReplay(reason) {
  const src = replaySrc; replaySrc = null;
  rig.orbit.auto = true;
  if (!src) return;
  if (src.kind === 'file') {
    // wheels back on the imported robots, hazards back to their pre-replay state
    try { src.binding.restore(src.saved, scene); } catch (_) { /* ignore */ }
    if (reason !== 'silent') { if (src.prevMap && src.prevMap !== S.map) setMap(src.prevMap); toMenu(); }
    return;
  }
  src.binding.restore(src.saved, scene);
  if (reason === 'silent') return;
  rig.set(camModeFor(), true);
  if (src.back === 'pause') { game.state = 'paused'; showScreen('pause'); $('#resume').focus(); }
  else if (src.back === 'auto') showEnd();
  else { game.state = 'end'; showScreen('end'); ui.again.focus(); }
  hud();
}
function endReplay() { rui.close('user'); }
// leave any replay without changing screens (new round, menu)
function quitReplay() { if (rui.active) rui.close('silent'); }
// import: rebuild the two robots and the arena from the file header, no physics
async function playReplayFile(file) {
  const msg = $('#load-msg'); msg.textContent = '';
  let track;
  try { track = await deserialize(new Uint8Array(await file.arrayBuffer())); } catch (e) { msg.textContent = e.message || 'Soubor se nepodařilo načíst.'; return; }
  const h = track.header || {};
  const rs = Array.isArray(h.robots) ? h.robots.slice(0, 2) : [];
  if (rs.length !== 2 || !rs.every(r => r && typeof r === 'object' && typeof r.id === 'string' && own(ROBOTS, r.id))) { msg.textContent = 'Záznam obsahuje neznámého robota.'; return; }
  // validate everything before the current robots / arena are touched
  const hzSpec = h.hazards == null ? null : sanitizeHazards(h.hazards);
  if (h.hazards != null && !hzSpec) { msg.textContent = 'Záznam je poškozený (nástrahy).'; return; }
  const mods = r => (Array.isArray(r.mods) ? r.mods.slice(0, 16).filter(m => typeof m === 'string' && m.length <= 40) : []);
  if (game.state === 'replay') quitReplay();
  const prevMap = S.map;
  if (h.map && MAP_LIST.some(m => m.id === h.map) && h.map !== S.map) setMap(h.map);
  if (world) removeBodies();
  disposeRobot(player); disposeRobot(opp);
  const col = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#9A9A94');
  replaySrc = { kind: 'file', prevMap, header: h };
  game.state = 'replay'; clearPops();
  let binding;
  try {
    player = new Robot(ROBOTS[rs[0].id], col(rs[0].color), scene, { mods: mods(rs[0]) });
    opp = new Robot(ROBOTS[rs[1].id], col(rs[1].color), scene, { mods: mods(rs[1]) });
    loadModel(player); loadModel(opp);
    binding = remapBinding(createBinding([player, opp], map.raw, hzSpec), track);
    replaySrc.binding = binding; replaySrc.saved = binding.capture();
  } catch (e) { console.error(e); return replayFailed(); }
  replayNames = rs.map(r => ROBOTS[r.id].short || ROBOTS[r.id].name);
  ui.pName.textContent = String(rs[0].name || ROBOTS[rs[0].id].name).slice(0, 60); ui.oName.textContent = String(rs[1].name || ROBOTS[rs[1].id].name).slice(0, 60);
  ui.pTag.textContent = 'P1'; ui.oTag.textContent = 'P2';
  ui.pSw.style.background = col(rs[0].color); ui.oSw.style.background = col(rs[1].color);
  showScreen('replay');
  try {
    rui.open({ track, binding, title: 'Záznam ze souboru', header: h, timed: h.timed !== false, noSave: false, speed: 1 });
  } catch (e) { console.error(e); return replayFailed(); }
  updateCameras(0, true);
}
// short-link hook: ?replay=<same-origin path> plays a stored replay (backend can come later)
async function replayFromUrl() {
  const p = params.get('replay');
  if (!isLocalReplayPath(p, location.href)) return;
  try {
    const r = await fetch(p, { credentials: 'same-origin' });
    if (!r.ok) return;
    await playReplayFile(new File([await r.arrayBuffer()], 'replay.prreplay'));
  } catch (_) { /* ignore */ }
}
function replayHud() {
  const pb = rui.playback; if (!pb) return;
  const b = pb.binding, v = pb.vals;
  const a = b.hud(v, 0), o = b.hud(v, 1);
  ui.pDmg.style.transform = `scaleX(${(1 - Math.max(0, Math.min(1, a.hp))).toFixed(3)})`;
  ui.oDmg.style.transform = `scaleX(${(1 - Math.max(0, Math.min(1, o.hp))).toFixed(3)})`;
  const st = x => (x.flipped > 0.6 ? `Převrácený ${Math.max(0, Math.ceil(FLIP_LIMIT - x.flipped))} s` : `Zásahy ${x.hits}`);
  setText(ui.pStat, st(a)); setText(ui.oStat, st(o));
  const timedRp = rui.playback && replaySrc && (replaySrc.kind === 'file' ? (replaySrc.header || {}).timed !== false : timed());
  setText(ui.timer, timedRp ? fmt(ROUND - pb.t) : fmt(pb.t));
  setText(ui.mapStatus, '');
  ui.msg.hidden = true;
}
const orbitC = new THREE.Vector3();

// ------------------------------------------------------------------ layout / camera band
const _sz = new THREE.Vector2();
const band = { top: 16, bottom: 16, left: 0, right: 0, w: 1, h: 1 };
function layout() {
  const w = innerWidth, h = innerHeight;
  // setSize resets the canvas (blank frame), so only when the size really changed
  const sz = renderer.getSize(_sz);
  if (sz.x !== w || sz.y !== h) renderer.setSize(w, h);
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
addEventListener('resize', () => { layout(); updateCameras(0, true); if (player) hudNames(); });

function updateCameras(dt, snap) {
  if (!map) return;
  const inMatch = player && player.body && ['countdown', 'fight', 'ko', 'end'].includes(game.state);
  const garage = !ui.garage.hidden;
  if (game.state === 'replay') {
    const c = rui.camera(dt) || { mode: 'tv', focus: 0 };
    const f = c.focus ? opp : player, o = c.focus ? player : opp;
    if (c.mode === 'orbit') {
      rig.orbit.auto = false;
      Object.assign(rig.orbit, c.orbit);
      const tgt = c.follow || !c.center ? f.root.position : c.center;
      orbitC.lerp(_pp.set(tgt.x, Math.max(-1.5, tgt.y), tgt.z), snap ? 1 : 1 - Math.exp(-dt * 4));
    }
    if (rig.mode !== c.mode) rig.set(c.mode, snap);
    rig.update(dt, { focus: f, other: o, bounds: map.bounds, band, portrait: portrait(), follow: true, snap, orbitCenter: orbitC });
    return;
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
  if (r.flippedTime <= 0.6 && r.statusText) return r.inverted ? 'Jede vzhůru nohama' : r.statusText();
  if (r.flippedTime > 0.6) {
    const left = Math.max(0, Math.ceil(FLIP_LIMIT - r.flippedTime));
    const t = r.up && r.up.y > 0.5 && !r.inverted ? `Nepojízdný ${left} s` : `Převrácený ${left} s`;
    if (!mine) return t;
    return t + (r.def.weapon === 'flipper' ? (touch ? ' · flipper = otočit' : ' · zbraň = otočit') : ' · jeďte a rozhoupejte se');
  }
  if (r.inverted) return 'Jede vzhůru nohama';
  if (r.def.weapon === 'spinner') return r.weaponOn ? `Zbraň ${Math.round(r.spin * 100)} %` : 'Zbraň vypnutá';
  return r.cooldown > 0 ? 'Flipper nabíjí' : 'Flipper připraven';
}
function dmgOf(r) {
  if (r.damage && typeof r.damage.health01 === 'number') return (1 - r.damage.health01) * 100;
  return r.dmgTaken || 0;
}
// damage events from robots.js: broken sides / lost wheels -> labels
const EVENT_LABEL = { wheel: 'Kolo upadlo!', front: 'Zbraň ohnutá!', back: 'Baterie poškozena!', top: 'Elektronika otřesena!', bottom: 'Elektronika otřesena!' };
function drainEvents() {
  for (const r of [player, opp]) {
    if (!r || !r.events || !r.events.length) continue;
    for (const e of r.events) if (e === 'wheel') recEvent({ type: 'wheel', who: r === player ? 0 : 1, p: rp(r.root.position) });
    for (const e of r.events) if (EVENT_LABEL[e]) { popLabel(r.root.position, EVENT_LABEL[e], true); if (e === 'wheel') sfx.crowd(0.7); }
    r.events.length = 0;
  }
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
  const ms = map && game.state === 'fight' ? map.status() : null;
  setText(ui.mapStatus, ms ? (typeof ms === 'string' ? ms : ms.text || '') : '');
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
  sfx.listen(camera);
  // replay: one-shots follow the playback rate; motor loops stay silent (state is not fight)
  sfx.rate(game.state === 'replay' && rui.playback ? rui.playback.rate() : 1);
  for (const [i, r] of [[1, player], [2, opp]]) {
    const v = r.body.linvel();
    const lvl = game.state === 'fight' || game.state === 'countdown' ? Math.min(1, Math.hypot(v.x, v.z) / (r.def.vmax || 6)) : 0;
    sfx.motor(i, lvl, game.state === 'fight' || game.state === 'ko' ? (r.spin || 0) : 0, r);
  }
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
const cmd1 = { throttle: 0, turn: 0, fire: false }, cmd2 = { throttle: 0, turn: 0, fire: false };
const _menuSpin = 0.25;
function frame(now) {
  requestAnimationFrame(frame);
  const wall = Math.min(0.25, Math.max(0, (now - last) / 1000)); last = now;
  if (document.hidden || ctxLost || hook.halt) return;
  let dt = Math.min(0.05, wall);
  adaptQuality(wall);
  const duo = S.mode === 'duo';
  const i1 = input.read(duo ? 1 : 0), i2 = duo ? input.read(2) : null;
  cmd1.throttle = i1.throttle; cmd1.turn = i1.turn; cmd1.fire = cmd1.fire || i1.fire;
  if (i2) { cmd2.throttle = i2.throttle; cmd2.turn = i2.turn; cmd2.fire = cmd2.fire || i2.fire; }

  if (input.takeStart()) {
    if (game.state === 'paused') pause(false); else if (game.state === 'fight' || game.state === 'countdown') pause(true);
    else if (game.state === 'replay') endReplay();
  }
  const st = game.state;
  if (st === 'replay') {
    rui.tick(wall);
    if (game.state === 'replay') replayHud();
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
    drainEvents();
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
  if (map) map.frame(dt);
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
  quitReplay();
  game.state = 'menu';
  if (world) removeBodies();
  quickOpp = null;
  makeRobots(); hudNames();
  rig.set('tv');
  showScreen('menu');
  renderMenu();
  ui.go.focus({ preventScroll: true });
}
function pause(on) {
  if (on && (game.state === 'fight' || game.state === 'countdown')) {
    game.pausedFrom = game.state; game.state = 'paused';
    ui.lastBtn.hidden = !(rec && rec.length > 60);
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
  for (const m of MAP_LIST) ui.maps.appendChild(btn('', `${m.preview ? `<i class="mp" style="background:${esc(m.preview.floor || '#eee')};border-color:${esc(m.preview.accent || '#0E0E0E')}"></i>` : ''}${esc(m.name)}`, () => { if (S.map === m.id) return; setMap(m.id); renderMenu(); saveSettings(); syncUrl(); }, { 'data-id': m.id }));
}
function pressed(container, id) { container.querySelectorAll('button[data-id]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id))); }
function renderMenu() {
  pressed(ui.modes, S.mode); pressed(ui.pick, S.robot); pressed(ui.colors, S.color); pressed(ui.maps, S.map);
  $('#color-name').textContent = COLORS.find(c => c.id === S.color).name;
  $('#mapdesc').textContent = (MAP_LIST.find(m => m.id === S.map) || {}).blurb || '';
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
  const narrow = innerWidth < 640, nm = id => (narrow && ROBOTS[id].short) || ROBOTS[id].name;
  ui.pName.textContent = nm(S.robot); ui.oName.textContent = o.name === ROBOTS[o.id].name ? nm(o.id) : o.name;
  ui.pName.title = ROBOTS[S.robot].name; ui.oName.title = o.name;
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
function renderGarage(focusId) {
  const root = $('#garage-body');
  const id = S.robot, mods = modsFor(id);
  const sum = garageModel.summary(id, mods);
  let h = `<div class="mono">Garáž · ${esc(ROBOTS[id].short || '')}</div><h1 id="garage-h">${esc(ROBOTS[id].name)}</h1>`;
  const pct = Math.min(1, sum.grams / sum.limit);
  h += `<div class="budget${sum.grams > sum.limit ? ' over' : ''}"><div class="lbl"><span>Hmotnost (limit ${sum.limit} g)</span><span>${sum.grams} g · rezerva ${sum.limit - sum.grams} g</span></div><div class="bar" role="meter" aria-valuemin="0" aria-valuemax="${sum.limit}" aria-valuenow="${sum.grams}" aria-label="Hmotnost robota"><i style="transform:scaleX(${pct.toFixed(3)})"></i></div></div>`;
  h += '<dl class="stats">' + sum.stats.map(x => `<div><dt>${x.name}</dt><dd><span class="bar"><i style="transform:scaleX(${x.v.toFixed(3)})"></i></span></dd></div>`).join('') + '</dl>';
  root.innerHTML = h;
  const slots = garageModel.slots(id);
  if (!slots.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Úpravy pro tohoto robota připravujeme.'; root.appendChild(p); }
  for (const sl of slots) {
    const g = document.createElement('div'); g.className = 'slot'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', sl.name);
    const cur = sl.options.find(o => garageModel.isOn(id, mods, o.id));
    g.innerHTML = `<div class="lbl"><span>${esc(sl.name)}</span><span>${esc(cur ? cur.desc : '')}</span></div>`;
    const row = document.createElement('div'); row.className = 'seg wrap';
    for (const o of sl.options) {
      const on = garageModel.isOn(id, mods, o.id);
      const next = garageModel.choose(id, mods, o.id);
      const over = !on && garageModel.gramsWith(id, next) > sum.limit;
      const b = btn('', `${esc(o.name)}${o.grams ? `<small>${o.grams > 0 ? '+' : '−'}${Math.abs(o.grams)} g</small>` : ''}`, () => {
        S.mods[id] = garageModel.choose(id, modsFor(id), o.id);
        saveSettings(); makeRobots(); renderGarage(o.id); renderMenu();
      }, { 'data-id': o.id, 'aria-pressed': String(on), title: o.desc || '' });
      if (over) { b.disabled = true; b.title = `Překročili byste limit ${sum.limit} g`; }
      row.appendChild(b);
    }
    g.appendChild(row); root.appendChild(g);
  }
  const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.innerHTML = `<span>Barva tisku</span><span>${COLORS.find(c => c.id === S.color).name}</span>`;
  const sws = document.createElement('div'); sws.className = 'sws';
  for (const c of COLORS) sws.appendChild(btn('sw', '', () => { S.color = c.id; applyChoice(true); renderGarage(c.id); }, { 'data-id': c.id, 'aria-label': c.name, title: c.name, style: `--c:${c.hex}`, 'aria-pressed': String(S.color === c.id) }));
  const wrap = document.createElement('div'); wrap.append(lbl, sws); root.appendChild(wrap);
  if (focusId) { const f = root.querySelector(`[data-id="${focusId}"]`); f && f.focus(); }
}

// ------------------------------------------------------------------ share
async function shareResult() {
  const r = game.result; if (!r) return;
  const u = new URL(location.href);
  for (const k of [...u.searchParams.keys()]) u.searchParams.delete(k);
  u.searchParams.set('robot', S.robot); u.searchParams.set('color', S.color); u.searchParams.set('mode', S.mode);
  if (MAP_LIST.length > 1) u.searchParams.set('map', S.map);
  if (isEn) u.searchParams.set('lang', 'en');
  const opName = opp.displayName || opp.def.name;
  const verdict = r.win === null ? 'Remíza' : r.win ? (r.kind === 'ko' ? `Výhra K.O. za ${fmt(r.time)}` : 'Výhra na body') : 'Prohra';
  const text = i18nT(`${verdict}: ${player.def.name} vs. ${opName} v aréně 150 g na printedrobotics.cz. Zkusíte to líp?`);
  try {
    if (navigator.share) { await navigator.share({ title: i18nT('Aréna 150 g'), text, url: u.href }); return; }
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
  if (game.state === 'replay') {
    if (!rui.active) { if (e.code === 'Escape') { e.preventDefault(); replayFailed(); } return; }
    if (rui.key(e)) e.preventDefault();
    return;
  }
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
  ui.replayBtn.onclick = () => openReplay('instant', 'end');
  ui.fullBtn.onclick = () => openReplay('full', 'end');
  ui.lastBtn.onclick = () => openReplay('last', 'pause');
  $('#load-replay').onclick = () => $('#replay-file').click();
  $('#replay-file').onchange = e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) playReplayFile(f); };
  ui.share.onclick = shareResult;
  ui.garageBtn.onclick = openGarage;
  $('#garage-done').onclick = closeGarage;
  $('#resume').onclick = () => pause(false);
  $('#restart').onclick = startRound;
  $('#quit').onclick = toMenu;
  ui.camBtn.onclick = cycleCam; ui.sndBtn.onclick = toggleMute; ui.pauseBtn.onclick = () => pause(true);
  // after a mouse click on the toolbar, Space / arrows must drive the robot again, not re-press the button
  ui.tools.addEventListener('click', () => { if (game.state === 'fight' || game.state === 'countdown') renderer.domElement.focus({ preventScroll: true }); });
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
  replayFromUrl();
} catch (e) {
  fail('Arénu se nepodařilo spustit. Zkuste stránku obnovit.');
  throw e;
}

// debug / test hook, only with ?debug (headless tests drive the simulation directly)
const hook = {
  noRender: false, halt: DEBUG && params.has('halt'),
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
  LEVELS, game, input, models: {}, renderer, scene, camera, rig, rui, get rec() { return rec; }, openReplay, playReplayFile, probe: null, async exportReplay() { return Array.from(await serializeReplay(rec.track(), replayHeader())); }, S, ladder: () => ladder,
  get player() { return player; }, get ai() { return opp; }, get ready() { return ready; }, get map() { return map; },
  setMode(m) { S.mode = m; applyChoice(); },
  selfPlay(level) { selfBrain = level ? createBrain(level, map) : null; if (selfBrain && player) player.handicap = LEVELS[level].handicap; },
  setup(o) { if (o.robot) S.robot = o.robot; if (o.opp) quickOpp = o.opp; if (o.level) S.level = o.level; if (o.map && o.map !== S.map) setMap(o.map); S.mode = o.mode || 'quick'; applyChoice(); }, setMap(id) { setMap(id); renderMenu(); }, cycleCam, setLevel(l) { S.level = l; renderMenu(); },
  skipReplay: () => game.state === 'replay' && endReplay(), garage: openGarage, closeGarage, pause, toMenu, frame(n = 1) { for (let i = 0; i < n; i++) { updateCameras(1 / 60); stepPops(1 / 60); } render(); },
  state() {
    const s = r => { const t = r.body ? r.body.translation() : r.root.position; const u = r.up; return { x: +t.x.toFixed(2), y: +t.y.toFixed(2), z: +t.z.toFixed(2), up: u ? +u.y.toFixed(2) : 1, spin: +(r.spin || 0).toFixed(2), hits: r.hits, flipped: +(r.flippedTime || 0).toFixed(1), dmg: Math.round(dmgOf(r)) }; };
    return { state: game.state, left: +game.left.toFixed(1), result: game.result && { win: game.result.win, why: game.result.why, kind: game.result.kind }, player: s(player), ai: s(opp), cam: rig.mode, mode: S.mode, map: S.map };
  },
  start: startRound
};
if (DEBUG) window.__arena = hook;
