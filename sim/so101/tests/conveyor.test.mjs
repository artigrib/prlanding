// Conveyor scene profile (src/objects/scene.js PROFILES.conveyor, src/objects/belt.js): slat belt physics with the
// real batch objects in MuJoCo (node). Also: the plain and object scenes stay without a belt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadObjectScene, loadScene } from './mj-node.mjs';
import { World } from '../src/world.js';
import { Belt } from '../src/objects/belt.js';
import { BELT, CONVEYOR_ITEMS, CONVEYOR_BINS, PROFILES } from '../src/objects/scene.js';
import { MISSIONS, sceneOf, runsIn } from '../src/missions.js';

const { mj, m, d, sizes } = await loadObjectScene('conveyor');
const world = new World(mj, m, d); world.sizes(sizes);
const belt = world.belt;
const ts = m.opt.timestep;
const BINS = Object.fromEntries(Object.entries(CONVEYOR_BINS).map(([n, p]) => [n, [p[0], p[1], 0]]));
// one instance per distinct object (the batch has 8 kinds); long items go lengthwise
const KINDS = [...new Map(CONVEYOR_ITEMS.map((it) => [it.id + (it.scale || 1), it])).values()];
const yawOf = (name, k = 0) => (/fork|spoon/.test(name) ? Math.PI / 2 + 0.1 * Math.sin(k) : 0.4 + k);

function reset(speed) {
  mj.mj_resetDataKeyframe(m, d, 0);
  world.layout(BINS);
  belt.speed = speed; belt.wraps = 0; belt.onWrap = null;
  mj.mj_forward(m, d);
}
function step(n = 1) { for (let i = 0; i < n; i++) { belt.step(ts); mj.mj_step(m, d); } }
const tilt = (name, z0) => { const a = world.axis(name, 2); return Math.acos(Math.max(-1, Math.min(1, a[0] * z0[0] + a[1] * z0[1] + a[2] * z0[2]))) * 180 / Math.PI; };
const vy = (name) => d.qvel[world.o[name].vadr + 1];

test('conveyor scene: belt, slats, bins and the 11-item pool are compiled in; keyframe matches nq', () => {
  assert.equal(CONVEYOR_ITEMS.length, 11);
  assert.equal(CONVEYOR_ITEMS.filter((it) => it.fraction === 'paper').length, 2, 'at most 2 paper cups: the paper bin holds two side by side');
  assert.equal(world.scene, 'conveyor');
  assert.ok(belt && belt.n === BELT.n, 'slats');
  assert.equal(m.key_qpos.length, m.nq * m.nkey);
  for (const it of CONVEYOR_ITEMS) assert.ok(world.o[it.name] && world.o[it.name].lib, it.name);
  for (const b of Object.keys(CONVEYOR_BINS)) assert.ok(world.o[b] && world.o[b].fixture, b);
  // the objects of missions 06–10 are not in this scene
  for (const it of PROFILES.objects.items) assert.equal(world.o[it.name], undefined, it.name);
  // cycle length: the carrying zone is always covered
  assert.ok(Math.abs(belt.P - (BELT.y1 - BELT.y0 + BELT.pitch)) < 1e-9);
});

test('plain and objects scenes are unchanged: no belt, no slat bodies', async () => {
  const base = await loadScene();
  const wp = new World(base.mj, base.m, base.d);
  assert.equal(wp.scene, 'plain'); assert.equal(wp.belt, null);
  assert.equal(base.mj.mj_name2id(base.m, base.mj.mjtObj.mjOBJ_BODY.value, 'slat0'), -1);
  const ob = await loadObjectScene('objects');
  const wo = new World(ob.mj, ob.m, ob.d);
  assert.equal(wo.scene, 'objects'); assert.equal(wo.belt, null); assert.equal(Belt.of(ob.mj, ob.m, ob.d), null);
  for (const n of ['slat0', 'belt', 'bin_paper', 'cup_paper1']) assert.equal(ob.mj.mj_name2id(ob.m, ob.mj.mjtObj.mjOBJ_BODY.value, n), -1, n);
  assert.ok(/<geom name="table" type="box" size="0\.40 0\.32 0\.015" pos="0\.14 0 -0\.015"/.test(ob.xml), 'objects scene keeps the full table');
  for (const it of CONVEYOR_ITEMS) assert.equal(wo.o[it.name], undefined, it.name);
});

test('scene of each mission: plain missions run in plain/objects, the conveyor scene runs only its own', () => {
  for (const x of MISSIONS) {
    const s = sceneOf(x);
    assert.ok(['plain', 'objects', 'conveyor'].includes(s), x.id);
    assert.ok(runsIn(x, s), x.id);
    assert.equal(runsIn(x, 'conveyor'), s === 'conveyor', x.id);
  }
  assert.equal(runsIn({ id: 'x' }, 'objects'), true);
  assert.equal(runsIn({ id: 'x', objects: true }, 'plain'), false);
  assert.equal(runsIn({ id: 'x', scene: 'conveyor' }, 'objects'), false);
});

test('pool items wait parked and asleep; spawn wakes one onto the belt; park puts it back to sleep', () => {
  reset(0);
  const asleep = (e) => e.geoms.every(([g]) => m.geom_contype[g] === 0 && m.geom_conaffinity[g] === 0) && m.body_gravcomp[e.body] === 1;
  for (const it of CONVEYOR_ITEMS) { const e = world.o[it.name]; assert.ok(!e.active && asleep(e), it.name + ' parked asleep'); assert.ok(world.com(it.name)[2] < -0.5); }
  const e = world.o.cup_paper1;
  assert.equal(world.spawn('cup_paper1'), true);
  assert.ok(e.active && !asleep(e) && e.geoms.some(([g, ct]) => ct && m.geom_contype[g] === ct), 'woken: contacts restored, gravity on');
  step(250);
  const p = world.com('cup_paper1');
  assert.equal(belt.zone(p), 'entry');
  assert.ok(Math.abs(p[0] - BELT.x) < 0.005 && p[2] > BELT.top, `resting on the slats at ${Array.from(p).map((v) => v.toFixed(3))}`);
  // the entry zone is busy: a second item is not placed on top of the first
  assert.equal(world.spawn('vial_glass1'), false);
  assert.equal(world.o.vial_glass1.active, false);
  assert.ok(asleep(world.o.vial_glass1));
  // a fork across the belt does not fit between the rails
  assert.throws(() => world.spawn('fork_plastic1', { yaw: 0, force: true }), /across the belt/);
  belt.speed = 0.04; step(Math.round(2.5 / ts));
  assert.equal(world.spawn('vial_glass1'), true, 'entry clear once the cup has moved on');
  world.park('cup_paper1'); mj.mj_forward(m, d);
  assert.ok(!e.active && asleep(e) && world.com('cup_paper1')[2] < -0.5, 'parked again');
});

for (const V of [0.02, 0.04]) {
  test(`every batch object rides at ${V * 100} cm/s: speed V ± 10 % within 1 s, tilt < 10°`, () => {
    for (const it of KINDS) {
      reset(V);
      step(Math.round(1.0 / ts));                 // belt up to speed (ramp: V / BELT.accel ≤ 0.8 s)
      assert.ok(Math.abs(belt.v - V) < 1e-9);
      world.spawn(it.name, { yaw: yawOf(it.name) });
      const z0 = world.axis(it.name, 2, [0, 0, 0]).slice();
      let worst = 0;
      step(Math.round(1.0 / ts));
      const v1 = vy(it.name), y1 = world.com(it.name)[1];
      for (let k = 0; k < 40; k++) { step(Math.round(0.05 / ts)); worst = Math.max(worst, tilt(it.name, z0)); }
      const mean = (world.com(it.name)[1] - y1) / 2.0;
      assert.ok(Math.abs(v1 - V) <= 0.1 * V, `${it.name}: v = ${(v1 * 100).toFixed(2)} cm/s after 1 s`);
      assert.ok(Math.abs(mean - V) <= 0.1 * V, `${it.name}: mean ${(mean * 100).toFixed(2)} cm/s over 1–3 s`);
      assert.ok(worst < 10, `${it.name}: tilted ${worst.toFixed(1)}°`);
      assert.ok(Math.abs(world.com(it.name)[0] - BELT.x) < BELT.hw, `${it.name} stays between the rails`);
    }
  });
}

test('slats stay contiguous (gap < 1 mm) over 120 s with items riding; a slat that wraps is empty', () => {
  reset(0.04);
  const pool = CONVEYOR_ITEMS.map((it) => it.name);
  let next = 0, worst = 0, wrapsLoaded = [], landed = 0;
  belt.onWrap = (i) => {
    const s = belt.slats[i], g = s.geom, c = belt.centre(i), h = m.geom_size[3 * g + 1];
    for (let k = 0; k < d.ncon; k++) { const ct = d.contact.get(k); if (ct.geom1 === g || ct.geom2 === g) wrapsLoaded.push(`slat${i} contact`); }
    // an item resting on it: centre of mass over the slat and its lowest point at the belt surface
    for (const e of world.active()) {
      if (!e.lib) continue;
      const p = world.com(e.name);
      if (Math.abs(p[1] - c) > h || Math.abs(p[0] - BELT.x) > BELT.hw) continue;
      let lo = Infinity;
      for (const pts of world.points(e.name)) for (let v = 2; v < pts.length; v += 3) lo = Math.min(lo, pts[v]);
      if (Math.abs(lo - BELT.top) < 0.002) wrapsLoaded.push(`${e.name} on slat${i}`);
    }
  };
  const n = Math.round(120 / ts);
  for (let i = 0; i < n; i++) {
    if (i % 250 === 0) {
      // keep the belt loaded: recycle items that reached the tote and came to rest
      for (const e of world.active()) {
        if (!e.lib) continue;
        const p = world.com(e.name);
        if (belt.zone(p) === 'tote' && world.speed(e.name) < 0.01) { world.park(e.name); landed++; }
        else assert.ok(p[2] > -0.2, `${e.name} fell outside the tote at ${Array.from(p).map((x) => x.toFixed(3))}`);
      }
      if (i % 2500 === 0) {
        const name = pool[next % pool.length];
        if (!world.o[name].active && world.spawn(name, { yaw: yawOf(name, next) })) next++;
      }
    }
    step();
    if (i % 25 === 0) worst = Math.max(worst, belt.maxGap());
  }
  assert.ok(worst < 0.001, `largest slat gap ${(worst * 1000).toFixed(3)} mm`);
  assert.ok(belt.wraps > 50, `wraps ${belt.wraps}`);
  assert.deepEqual(wrapsLoaded, []);
  assert.ok(next >= 10 && landed >= 6, `spawned ${next}, landed in the tote ${landed}`);
  console.log(`  120 s at 4 cm/s: ${belt.wraps} wraps, max gap ${(worst * 1000).toFixed(3)} mm, ${next} items spawned, ${landed} landed in the tote`);
});

test('an item that leaves the belt end lands in the end tote (counted as missed)', () => {
  for (const it of KINDS) {
    reset(0.04);
    step(Math.round(1.0 / ts));
    world.spawn(it.name, { yaw: yawOf(it.name) });
    let t = 0, z;
    for (; t < 30; t += 0.1) {
      step(Math.round(0.1 / ts));
      z = belt.zone(world.com(it.name, [0, 0, 0]));
      if (z === 'tote' && world.speed(it.name) < 0.005) break;
    }
    const p = world.com(it.name);
    assert.equal(z, 'tote', `${it.name} at ${Array.from(p).map((x) => x.toFixed(3))} after ${t.toFixed(1)} s`);
    assert.ok(p[2] > BELT.tote.floor - 0.01, `${it.name} rests on the tote floor, not below`);
  }
});

test('pause ramps the belt down and up; tall cups stay upright and stop with it', () => {
  reset(0.04);
  step(Math.round(1.0 / ts));
  world.spawn('cup_plastic1', { y: -0.26 });
  step(Math.round(1.5 / ts));
  world.spawn('cup_paper1', { y: -0.26 });
  const z0 = { cup_plastic1: world.axis('cup_plastic1', 2, [0, 0, 0]).slice(), cup_paper1: world.axis('cup_paper1', 2, [0, 0, 0]).slice() };
  step(Math.round(1.5 / ts));
  let worst = 0;
  const watch = (sec) => { for (let k = 0; k < sec / 0.02; k++) { step(5); for (const n of Object.keys(z0)) worst = Math.max(worst, tilt(n, z0[n])); } };
  belt.pause();
  watch(0.2);
  assert.ok(belt.v > 0 && belt.v < 0.04, 'ramped, not an instant stop');
  watch(1.0);
  assert.equal(belt.v, 0, 'stopped within 4 cm/s ÷ accel');
  watch(0.5);
  for (const n of Object.keys(z0)) assert.ok(world.speed(n) < 0.002, `${n} at rest on the stopped belt (${world.speed(n)})`);
  const y = world.com('cup_plastic1')[1];
  watch(1.0);
  assert.ok(Math.abs(world.com('cup_plastic1')[1] - y) < 0.001, 'no creep while paused');
  belt.speed = 0.04;
  watch(1.5);
  assert.ok(Math.abs(belt.v - 0.04) < 1e-9 && Math.abs(vy('cup_plastic1') - 0.04) < 0.004, 'running again');
  assert.ok(worst < 10, `cups tilted ${worst.toFixed(1)}° over pause and restart`);
});

test('keyframe reset puts the slats back and the belt ramps up from rest (snapshot-safe state)', () => {
  reset(0.03);
  step(Math.round(3 / ts));
  assert.ok(belt.v > 0.029);
  mj.mj_resetDataKeyframe(m, d, 0); mj.mj_forward(m, d);
  assert.equal(belt.v, 0);
  for (let i = 0; i < belt.n; i++) assert.equal(d.qpos[belt.slats[i].q], 0);
  step(1);
  assert.ok(belt.v > 0 && belt.v <= BELT.accel * ts + 1e-12, 'ramped from rest');
  assert.ok(belt.maxGap() < 0.001);
});
