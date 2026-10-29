// Unit tests for the end-card kit link and calm mode (node >= 18, no browser): node --test tests/calm-endcard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// ui/store.js uses localStorage (try/catch): give it an in-memory one
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };

const { kitLink, countsAsWin, KIT_ROBOTS, KIT_MIN_WINS } = await import('../src/ui/endcard.js');
const { calm, initCalm, resolveCalm, setCalm } = await import('../src/ui/calm.js');

const BUY = /postav|kup|koup|objedn|buy|order|build it/i;
const MODES = ['quick', 'ladder', 'duo', 'training'];
const ROBOTS = [...KIT_ROBOTS, 'kosa', 'klepeto'];

test('no kit link before the 3rd win, in any mode', () => {
  for (const mode of MODES) for (const robot of ROBOTS) for (const win of [true, false, null]) for (let wins = 0; wins < KIT_MIN_WINS; wins++) {
    assert.equal(kitLink({ mode, win, wins, robot }), null, JSON.stringify({ mode, win, wins, robot }));
  }
});

test('never a kit link during a tournament (or in duo / training), whatever the wins', () => {
  for (const mode of ['ladder', 'duo', 'training']) for (const robot of ROBOTS) for (const win of [true, false, null]) for (const wins of [3, 4, 10, 999]) {
    assert.equal(kitLink({ mode, win, wins, robot }), null, JSON.stringify({ mode, win, wins, robot }));
  }
});

test('after the 3rd win: only a quiet "notify me" link to the kit page form, only for a won quick match', () => {
  for (const robot of KIT_ROBOTS) {
    const l = kitLink({ mode: 'quick', win: true, wins: 3, robot });
    assert.ok(l, robot);
    assert.equal(l.href, `../../sada/${robot}/#predobjednavka`);
    assert.doesNotMatch(l.label, BUY);
    assert.match(l.label, /Dejte mi vědět/);
    assert.equal(kitLink({ mode: 'quick', win: false, wins: 5, robot }), null, 'not after a loss');
    assert.equal(kitLink({ mode: 'quick', win: null, wins: 5, robot }), null, 'not after a draw');
  }
  assert.equal(kitLink({ mode: 'quick', win: true, wins: 9, robot: 'kosa' }), null, 'robots without a kit page get no link');
});

test('wins count only solo wins against the AI', () => {
  assert.equal(countsAsWin({ mode: 'quick', win: true }), true);
  assert.equal(countsAsWin({ mode: 'ladder', win: true }), true);
  assert.equal(countsAsWin({ mode: 'duo', win: true }), false);
  assert.equal(countsAsWin({ mode: 'quick', win: false }), false);
  assert.equal(countsAsWin({ mode: 'quick', win: null }), false);
});

test('the end card markup has no buy CTA: the kit row is hidden and the link is not a primary button', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const end = html.slice(html.indexOf('<section class="panel" id="end"'), html.indexOf('</section>', html.indexOf('id="end"')));
  assert.doesNotMatch(end, /Postavte si ho/);
  assert.match(end, /<p class="kit" id="kit-row" hidden><a class="link" id="cta" data-cta="arena-kit"/);
  assert.doesNotMatch(end.match(/<a[^>]*id="cta"[^>]*>/)[0], /btn-act|btn\b/);
});

test('calm mode: ?klid=1 turns it on and remembers it, ?klid=0 turns it off', () => {
  mem.clear();
  assert.equal(initCalm({ search: '?klid=1', reduce: false }), true);
  assert.equal(calm.on, true);
  assert.equal(mem.get('pr-arena:calm'), 'true');
  assert.equal(initCalm({ search: '', reduce: false }), true, 'remembered on the next visit');
  assert.equal(initCalm({ search: '?mode=quick&klid=0', reduce: true }), false, '?klid=0 beats reduced motion');
  assert.equal(initCalm({ search: '', reduce: true }), false, 'saved choice beats reduced motion');
});

test('calm mode: on by default with prefers-reduced-motion, off otherwise; the toggle persists', () => {
  mem.clear();
  assert.equal(initCalm({ search: '', reduce: true }), true);
  assert.equal(mem.has('pr-arena:calm'), false, 'the system setting is not stored as a choice');
  assert.equal(initCalm({ search: '', reduce: false }), false);
  setCalm(true);
  assert.equal(initCalm({ search: '', reduce: false }), true);
  setCalm(false, false);
  assert.equal(calm.on, false);
  assert.equal(mem.get('pr-arena:calm'), 'true', 'persist=false leaves the saved choice alone');
  assert.deepEqual(resolveCalm('x', null, false), { on: false, persist: false });
});
