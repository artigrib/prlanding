// Result card (HUD stage 2): star thresholds moved from rate() closures into data (m.stars). The ratings must be
// identical to the closures they replaced, and the "next star" targets the card shows come from the same numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS, nextStar } from '../src/missions.js';
import { createRequire } from 'node:module';
import en from '../src/i18n/en.js';

// time-rated missions (the conveyor missions rate named stars: tests/waste-hand.test.mjs)
const TIMED = MISSIONS.filter((m) => !m.belt && !m.line);   // conveyor missions rate named stars (waste-hand, knn-policy, line-orders tests)

const require = createRequire(import.meta.url);
const I18N = new URL('../../../assets/i18n.js', import.meta.url).pathname;
function enDict() {
  delete globalThis.PRI18N;
  globalThis.location = { search: '?lang=en', href: 'http://x/sim/so101/?lang=en' };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en-US'], language: 'en-US' }, configurable: true, writable: true });
  delete require.cache[I18N];
  require(I18N);
  const I = globalThis.PRI18N; I.addDict('en', en); I.setLang('en');
  return I;
}

// the rate() bodies as they were before the refactor (sim/so101/src/missions.js on main, HUD stage 1)
const s3 = (t, t3, t2) => (t <= t3 ? 3 : t <= t2 ? 2 : 1);
const OLD = {
  bowl: (t) => s3(t, 25, 60),
  stack: (t, prec) => Math.min(s3(t, 30, 75), prec < 0.004 ? 3 : prec < 0.008 ? 2 : 1),
  sort: (t) => s3(t, 50, 110),
  ball: (t, prec) => Math.min(s3(t, 25, 60), prec < 0.02 ? 3 : 2),
  trace: (t, prec) => Math.min(s3(t, 60, 150), prec < 0.0025 ? 3 : prec < 0.005 ? 2 : 1),
  line: (t) => s3(t, 100, 200),
  breakfast: (t) => s3(t, 60, 130),
  tidy: (t) => s3(t, 80, 160),
  workshop: (t, prec) => Math.min(s3(t, 30, 70), prec < 0.003 ? 3 : prec < 0.008 ? 2 : 1),
  lab: (t, prec) => Math.min(s3(t, 40, 90), prec < 0.07 ? 3 : 2)
};

test('rate() from the threshold data gives the same stars as the old closures over a grid of inputs', () => {
  assert.deepEqual(TIMED.map((m) => m.id).sort(), Object.keys(OLD).sort(), 'every mission has a reference');
  const eps = 1e-9;
  const times = [0, 0.1, 1, 300, 3600];
  for (let t = 0; t <= 260; t += 0.5) times.push(t);
  const precs = [0, 1, 0.5, 0.1];
  for (let p = 0; p <= 0.1; p += 0.00025) precs.push(p);
  for (const m of TIMED) {
    const S = m.stars;
    for (const v of [S.t3, S.t2]) times.push(v - eps, v, v + eps);
    for (const v of [S.p3, S.p2]) if (v != null) precs.push(v - eps, v, v + eps);
  }
  let n = 0;
  for (const m of TIMED) for (const t of times) for (const p of precs) {
    const a = m.rate(t, p), b = OLD[m.id](t, p);
    if (a !== b) assert.fail(`${m.id} rate(${t}, ${p}) = ${a}, was ${b}`);
    n++;
  }
  assert.ok(n > 100000, n + ' ratings compared');
});

test('nextStar: the limit of the next star level and whether the run meets it', () => {
  const bowl = TIMED.find((m) => m.id === 'bowl'), stack = TIMED.find((m) => m.id === 'stack');
  const ball = TIMED.find((m) => m.id === 'ball'), trace = TIMED.find((m) => m.id === 'trace');
  assert.deepEqual(nextStar(bowl, 41, 0), { stars: 2, next: 3, time: { v: 41, limit: 25, met: false }, prec: null });
  assert.deepEqual(nextStar(bowl, 70, 0).time, { v: 70, limit: 60, met: false });
  assert.equal(nextStar(bowl, 70, 0).next, 2);
  assert.deepEqual(nextStar(bowl, 20, 0), { stars: 3, next: 3, time: { v: 20, limit: 25, met: true }, prec: null });
  // precision missions: both criteria for the next level
  const s = nextStar(stack, 20, 0.005);
  assert.equal(s.stars, 2); assert.equal(s.next, 3);
  assert.deepEqual([s.time.limit, s.time.met, s.prec.limit, s.prec.met, s.prec.unit], [30, true, 0.004, false, 'mm']);
  const tr = nextStar(trace, 100, 0.006);   // 1 ★ by precision: 2 ★ needs ≤ 150 s and < 5 mm
  assert.deepEqual([tr.stars, tr.next, tr.time.limit, tr.time.met, tr.prec.limit, tr.prec.met], [1, 2, 150, true, 0.005, false]);
  const bl = nextStar(ball, 70, 0.03);       // ball: no precision limit for 2 ★
  assert.deepEqual([bl.stars, bl.next, bl.prec.limit, bl.prec.met], [1, 2, null, true]);
  // the card's numbers match the star rule the brief shows (starsHint)
  for (const m of TIMED) assert.ok(m.starsHint.includes(String(m.stars.t3)), m.id + ': starsHint names the 3 ★ time');
});

test('every result card string has an English translation', () => {
  const I = enDict();
  const has = (s) => I.t(s) !== s || /^[\d:.,\s★✓°mm–-]*$/.test(s);
  const say = ['Váš čas', 'Čas', 'Hvězdičky', 'jen ručně, bez ukázky', 's ukázkou', 'Ručně, bez ukázky.',
    'S ukázkou – hvězdičky jsou za ruční přenesení.', 'Zkusit znovu', 'Další mise', 'To byla poslední mise.', 'Výsledek mise',
    'Mise 01 / 10 · splněno', 'Pro 3 ★', 'do 0:25', 'pod 4 mm', 'pod 2,5 mm', 'pod 4°', '0:41,3', '3,2 mm', '4,1°', 'splněno',
    'Další: 02 · Věž ze dvou kostek', '2 ze 3 hvězdiček'];
  for (const m of TIMED) {
    say.push(m.done.replace(/[^.!]$/, '$&.'));
    if (m.stars.prec) say.push(m.stars.prec);
  }
  const miss = say.filter((s) => !has(s));
  assert.deepEqual(miss, [], 'add to src/i18n/en.js');
  assert.equal(I.t('Mise 05 / 10 · splněno'), 'Mission 05 / 10 · complete');
  assert.equal(I.t('0:41,3'), '0:41.3');
  assert.equal(I.t('pod 2,5 mm'), 'under 2.5 mm');
  assert.equal(I.t('Další: 06 · Matice a šrouby do přihrádek'), 'Next: 06 · Nuts and bolts into bins');
});
