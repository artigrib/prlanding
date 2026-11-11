// Newcomer playtest fixes: grasp hints from the measured offset, English for every mission line the playtest
// found in Czech, and the English start for browsers that are not Czech / Slovak (assets/i18n.js initSim browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import en from '../src/i18n/en.js';
import { MISSIONS, GRASP, graspHint, reachHint } from '../src/missions.js';

const require = createRequire(import.meta.url);
const I18N = new URL('../../../assets/i18n.js', import.meta.url).pathname;

/** a fresh PRI18N with the given URL, saved choice and browser language */
function fresh({ search = '', saved = null, langs = ['en-US'] } = {}) {
  delete globalThis.PRI18N;
  const store = new Map(saved ? [['pr-lang', saved]] : []);
  globalThis.location = { search, href: 'http://x/sim/so101/' + search };
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  Object.defineProperty(globalThis, 'navigator', { value: { languages: langs, language: langs[0] }, configurable: true, writable: true });
  delete require.cache[I18N];
  require(I18N);
  return globalThis.PRI18N;
}
const enDict = () => fresh({ search: '?lang=en' }) && (globalThis.PRI18N.addDict('en', en), globalThis.PRI18N.setLang('en'), globalThis.PRI18N);

test('sims that opt in start in English for a non-Czech browser, Czech for cs/sk, explicit choices win', () => {
  assert.equal(fresh({ langs: ['en-US'] }).detect('sim', { browser: true }), 'en');
  assert.equal(fresh({ langs: ['de-DE', 'cs'] }).detect('sim', { browser: true }), 'en');
  assert.equal(fresh({ langs: ['cs-CZ', 'en'] }).detect('sim', { browser: true }), 'cs');
  assert.equal(fresh({ langs: ['sk'] }).detect('sim', { browser: true }), 'cs');
  assert.equal(fresh({ langs: ['en-US'], saved: 'cs' }).detect('sim', { browser: true }), 'cs', 'saved CZ choice wins');
  assert.equal(fresh({ langs: ['cs-CZ'], saved: 'en' }).detect('sim', { browser: true }), 'en', 'saved EN choice wins');
  assert.equal(fresh({ langs: ['en-US'], search: '?lang=cs' }).detect('sim', { browser: true }), 'cs', '?lang= wins');
  assert.equal(fresh({ langs: ['en-US'] }).detect('sim'), 'cs', 'sims that do not opt in (arena) stay Czech');
});

const ctx = (tip, gripOpen = true, extra = {}) => ({ tip, gripOpen, touch: false, ...extra });
const CUBE = [0.25, -0.11, 0.0125];

test('grasp hints: aligned → close, above → down, within reach → the measured correction', () => {
  assert.match(graspHint(ctx([0.25, -0.11, 0.015]), CUBE), /^Teď sevřete chapadlo/);
  assert.match(graspHint(ctx([0.25, -0.11, 0.05]), CUBE), /^Sjeďte dolů/);
  assert.equal(graspHint(ctx([0.30, -0.11, 0.05]), CUBE), null, 'graspHint stays silent 5 cm off');
  assert.equal(reachHint(ctx([0.30, -0.11, 0.05]), CUBE), 'Blíž nad kostku – ještě 5 cm');
  assert.equal(reachHint(ctx([0.28, -0.11, 0.015]), CUBE), 'Výš a nad kostku – ještě 3 cm vedle');
  assert.equal(reachHint(ctx([0.25, -0.11, 0.2]), CUBE), 'Níž – ještě 19 cm');
  assert.equal(reachHint(ctx([0.25, -0.11, 0.2], false), CUBE), 'Otevřete chapadlo a sjeďte níž – ještě 19 cm');
  assert.equal(reachHint(ctx([0.25 + GRASP.hoverDz + 0.01, -0.11, 0.05]), CUBE), null, 'out of reach: the mission text speaks');
  // the reach radius / alignment are the grasp's own numbers
  assert.deepEqual(GRASP, { dh: 0.02, dz: 0.015, hoverDh: 0.03, hoverDz: 0.12 });
});

test('mission 01 by hand never says "click the cube"; clicking it does', () => {
  const m = MISSIONS.find((x) => x.id === 'bowl');
  const w = { pos: (n, o) => { o = o || [0, 0, 0]; o[0] = CUBE[0]; o[1] = CUBE[1]; o[2] = n === 'bowl' ? 0 : CUBE[2]; if (n === 'bowl') { o[0] = 0.2; o[1] = 0.15; } return o; }, speed: () => 0 };
  const run = (hand, tip) => m.check({ w, s: {}, tip, gripOpen: true, smart: true, hand }, 0).text;
  assert.equal(run(false, [0.1, 0.1, 0.1]), 'Klikněte na kostku');
  assert.equal(run(true, [0.1, 0.1, 0.1]), 'Táhněte modrou kouli nad kostku');
  assert.equal(run(true, [0.3, -0.11, 0.06]), 'Blíž nad kostku – ještě 5 cm');
});

test('every hint, mission text and star rule the playtest found in Czech has an English translation', () => {
  const I = enDict();
  const say = [
    'Kostka je v misce…', 'Táhněte modrou kouli nad kostku', 'Ruka sama bere předmět…', 'Ruka sama pokládá předmět…',
    'Ruka jede po naplánované cestě…', 'Ruka předvádí řešení – sledujte ji', 'Jakmile ruka předmět vezme, odnese ho tam.',
    'Řešení ukázala ruka sama – zkuste to teď vy, koulí nebo klouby.', 'ruka ji vezme, klik na misku nebo stůl ji položí (mise 01–03)',
    'Mise 01–03: klikněte na předmět – ruka ho sama vezme, pak klikněte, kam ho položit. Bez hvězdiček; od mise 04 už ne.',
    'Mise 01–03: klepněte na předmět – ruka ho sama vezme, pak klepněte, kam ho položit. Bez hvězdiček; od mise 04 už ne.',
    reachHint(ctx([0.30, -0.11, 0.05]), CUBE), reachHint(ctx([0.28, -0.11, 0.015]), CUBE),
    reachHint(ctx([0.25, -0.11, 0.2]), CUBE), reachHint(ctx([0.25, -0.11, 0.2], false), CUBE),
    graspHint(ctx([0.25, -0.11, 0.015], true, { touch: true }), CUBE), graspHint(ctx([0.25, -0.11, 0.05], false, { touch: true }), CUBE)
  ];
  for (const m of MISSIONS) for (const k of ['title', 'desc', 'short', 'strategy', 'advice', 'starsHint']) if (m[k]) say.push(m[k]);
  const miss = say.filter((s) => !I.has(s));
  assert.deepEqual(miss, [], 'add to src/i18n/en.js');
  assert.equal(I.t('3 ★ do 50 s, 2 ★ do 110 s'), '3 ★ under 50 s, 2 ★ under 110 s');
  assert.equal(I.t('Teď sevřete chapadlo (tlačítkem Zavřít chapadlo)'), 'Now close the gripper (with the Close the gripper button)');
});
