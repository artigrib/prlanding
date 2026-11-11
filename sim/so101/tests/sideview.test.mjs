// "Pohled z boku" (HUD stage 3): framing, target choice and the measured numbers of the side-view inset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MISSIONS, GRASP, graspHint } from '../src/missions.js';
import { sideFrame, toInset, sideTarget, measure, heightText, sideLabel } from '../src/sidegeom.js';
import en from '../src/i18n/en.js';

const W = 238, H = 138;

test('tip and target are inside the inset, the gripper body above the tip fits too', () => {
  for (const [tip, p] of [[[0.27, -0.12, 0.08], [0.25, -0.11, 0.0125]], [[0.2, 0.15, 0.2], [0.2, 0.15, 0]], [[0.3, 0.05, 0.02], [0.18, -0.16, 0.01]]]) {
    const f = sideFrame(tip, p, W / H);
    for (const q of [tip, p, [tip[0], tip[1], tip[2] + 0.06]]) {
      const [x, y] = toInset(f, q, W, H);
      assert.ok(x > 0 && x < W && y > 0 && y < H, `${q} → ${x.toFixed(0)},${y.toFixed(0)}`);
    }
    // the camera looks horizontally, towards the arm base; screen x is perpendicular to it
    assert.ok(Math.abs(f.dir[0] * f.right[0] + f.dir[1] * f.right[1]) < 1e-9);
    assert.ok(f.dir[0] * p[0] + f.dir[1] * p[1] < 0);
    // higher is up in the inset
    assert.ok(toInset(f, tip, W, H)[1] < toInset(f, [tip[0], tip[1], tip[2] - 0.01], W, H)[1]);
  }
});

test('small moves do not change the zoom (half height in whole cm)', () => {
  const p = [0.25, -0.11, 0.0125];
  const a = sideFrame([0.25, -0.11, 0.080], p, W / H), b = sideFrame([0.25, -0.11, 0.0805], p, W / H);
  assert.equal(a.halfH, b.halfH);
  assert.ok(Math.abs(a.halfH * 100 - Math.round(a.halfH * 100)) < 1e-9);
});

test('the inset looks across the default camera: the radial line is near perpendicular to its line of sight', () => {
  // desktop default camera (core.js resetView): position three (0.45, 0.42, −0.55), target (0.15, 0.08, −0.01) → MuJoCo xy
  const fx = 0.15 - 0.45, fy = 0.01 - 0.55, fl = Math.hypot(fx, fy);
  for (const m of MISSIONS) {
    for (const [k, role] of Object.entries(m.targets || {})) {
      if (role !== 'pick' && role !== 'push' || !m.layout[k] || k === 'goal') continue;   // goal: a fixture, never the target
      const [x, y] = m.layout[k], ang = Math.acos(Math.abs((x * fx + y * fy) / (Math.hypot(x, y) * fl))) * 180 / Math.PI;
      // 90° = the default view's depth is fully left/right in the inset; ≥ 50° keeps ≥ 77 % of it
      assert.ok(ang >= 50, `${m.id}/${k}: ${ang.toFixed(0)}°`);
      if (process.env.SIDE_ANGLES) console.log(`${m.id}/${k} ${ang.toFixed(0)}°`);
    }
  }
});

test('numbers are the grasp hint numbers: "ve výšce" exactly when the grasp hint says the height is right', () => {
  const p = [0.25, -0.11, 0.0125];
  for (const dz of [-0.03, -0.014, 0, 0.0149, 0.015, 0.05, 0.12]) {
    const tip = [p[0] + 0.005, p[1], p[2] + dz], { dz: d, dh } = measure(tip, p);
    assert.ok(Math.abs(d - dz) < 1e-12 && Math.abs(dh - 0.005) < 1e-12);
    const aligned = /^Teď sevřete/.test(graspHint({ tip, gripOpen: true, touch: false }, p) || '');
    assert.equal(heightText(d) === 've výšce', aligned && d > -GRASP.dz, `dz ${dz}`);
  }
  assert.equal(heightText(0.064), '6 cm');
  assert.equal(sideLabel(0.064, 0.04, 'oranžová kostka'), 'Pohled z boku: chapadlo 6 cm nad cílem (oranžová kostka), 4 cm vedle');
  assert.equal(sideLabel(0.001, 0.01, 'míček'), 'Pohled z boku: chapadlo ve výšce cíle (míček)');
});

// a minimal world: positions by name
function fakeWorld(pos, extra = {}) {
  const o = {};
  for (const [k, p] of Object.entries(pos)) o[k] = { name: k, active: true, kind: ['bowl', 'bowl2', 'goal'].includes(k) ? 'mocap' : 'free', label: k, ...(extra[k] || {}) };
  return { o, pos: (n, out) => { const p = pos[n]; out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return out; }, com: (n, out) => { const p = pos[n]; out[0] = p[0]; out[1] = p[1]; out[2] = p[2] + 0.01; return out; } };
}
const M = (id) => MISSIONS.find((m) => m.id === id);

test('target: the nearest object still to pick; holding one, where it goes', () => {
  const w = fakeWorld({ cube: [0.27, -0.06, 0.0125], cube_b: [0.16, -0.16, 0.0125], bowl: [0.14, 0.17, 0], bowl2: [0.3, 0.12, 0] });
  assert.equal(sideTarget(w, M('sort'), null, [0.17, -0.15, 0.1], () => false).name, 'cube_b');
  assert.equal(sideTarget(w, M('sort'), null, [0.27, -0.05, 0.1], () => false).name, 'cube');
  assert.equal(sideTarget(w, M('sort'), 'cube', [0.27, -0.05, 0.1], () => false).name, 'bowl2');
  assert.equal(sideTarget(w, M('sort'), 'cube_b', [0.27, -0.05, 0.1], () => false).name, 'bowl');
  // a cube already in its bowl is skipped
  const w2 = fakeWorld({ cube: [0.3, 0.12, 0.0125], cube_b: [0.16, -0.16, 0.0125], bowl: [0.14, 0.17, 0], bowl2: [0.3, 0.12, 0] });
  assert.equal(sideTarget(w2, M('sort'), null, [0.3, 0.12, 0.1], () => false).name, 'cube_b');
  assert.equal(sideTarget(fakeWorld({ cube: [0.26, -0.1, 0.0125], cube_b: [0.2, 0.1, 0.0125] }), M('stack'), 'cube', [0, 0, 0.1], () => false).name, 'cube_b');
  assert.equal(sideTarget(fakeWorld({ ball: [0.2, -0.06, 0.02], goal: [0.2, 0.17, 0] }), M('ball'), null, [0.2, 0, 0.1], () => false).name, 'ball');
  assert.equal(sideTarget(fakeWorld({}), M('trace'), null, [0.2, 0, 0.05], () => false).name, 'paper');
  // library items: centre of mass, the sort map gives the fixture, items in their zone are skipped
  const lib = fakeWorld({ apple: [0.265, -0.125, 0], banana: [0.17, -0.16, 0], cupcake: [0.325, -0.03, 0], plate: [0.2, 0.135, 0] }, { apple: { lib: {} }, banana: { lib: {} }, cupcake: { lib: {} }, plate: { kind: 'mocap' } });
  const t = sideTarget(lib, M('breakfast'), null, [0.26, -0.12, 0.1], (w, n) => n === 'apple');
  assert.equal(t.name, 'banana'); assert.equal(t.p[2], 0.01);
  assert.equal(sideTarget(lib, M('breakfast'), 'apple', [0.26, -0.12, 0.1], () => false).name, 'plate');
});

test('EN: the inset strings are translated', () => {
  const require = createRequire(import.meta.url);
  const I18N = new URL('../../../assets/i18n.js', import.meta.url).pathname;
  delete globalThis.PRI18N;
  globalThis.location = { search: '?lang=en', href: 'http://x/sim/so101/?lang=en' };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en-US'], language: 'en-US' }, configurable: true, writable: true });
  delete require.cache[I18N]; require(I18N);
  const I = globalThis.PRI18N; I.addDict('en', en); I.setLang('en');
  assert.equal(I.t('Pohled z boku'), 'Side view');
  assert.equal(I.t('ve výšce'), 'level');
  assert.equal(I.t('Pohled z boku: chapadlo 6 cm nad cílem (oranžová kostka), 4 cm vedle'), 'Side view: gripper 6 cm above the target (orange cube), 4 cm to the side');
  assert.equal(I.t('Pohled z boku: chapadlo 2 cm pod cílem (míček)'), 'Side view: gripper 2 cm below the target (the ball)');
  assert.equal(I.t('Pohled z boku: chapadlo ve výšce cíle (talíř)'), 'Side view: gripper level with the target (' + I.t('talíř') + ')');
});
