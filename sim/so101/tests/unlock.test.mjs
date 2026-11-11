// Progressive unlocking (HUD stage 3): one new control per mission (the game-UX doc's order), unlocks follow the
// saved progress, and every "Nové: …" line has an English translation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS } from '../src/missions.js';
import { UNLOCKS, UNLOCK_N, reached, isUnlocked, newIn, nn } from '../src/unlock.js';
import en from '../src/i18n/en.js';

test('unlock order: wrist 02, AI hint 03, Klouby 06, Učit ukázkou 07, export 09, tilt + Připojit AI 10', () => {
  assert.deepEqual(UNLOCK_N, { wrist: 2, ask: 3, joints: 6, teach: 7, export: 9, tilt: 10, ai: 10 });
  for (const u of UNLOCKS) assert.ok(u.n >= 2 && u.n <= MISSIONS.length, u.id);
  // never more than one new thing per mission in the brief
  for (let n = 1; n <= MISSIONS.length; n++) assert.ok(newIn(n).length <= 1, `mission ${n}`);
});

test('reached level: the current mission, or the one after the last mission won', () => {
  assert.equal(reached(MISSIONS, {}, 'bowl'), 1);
  assert.equal(reached(MISSIONS, { bowl: { done: true } }, 'bowl'), 2);          // a win unlocks the next one right away
  assert.equal(reached(MISSIONS, {}, 'tidy'), 8);                                 // opened from the picker
  assert.equal(reached(MISSIONS, { bowl: {}, stack: {}, trace: {} }, 'bowl'), 6); // returning visitor keeps what was earned
  assert.equal(reached(MISSIONS, { lab: {} }, 'bowl'), 10);
  assert.equal(reached(MISSIONS, {}, null), 1);
});

test('isUnlocked: by level, "Odemknout vše", unknown ids are never locked', () => {
  assert.equal(isUnlocked('wrist', 1), false);
  assert.equal(isUnlocked('wrist', 2), true);
  assert.equal(isUnlocked('joints', 5), false);
  assert.equal(isUnlocked('joints', 1, true), true);
  assert.equal(isUnlocked('gripper', 1), true);
  assert.equal(nn(2), '02');
});

test('EN: every "Nové" text and the lock marks are translated', () => {
  for (const u of UNLOCKS) if (u.what) assert.ok(u.what in en.strings, u.what);
  const pat = (s) => en.patterns.some(([re]) => re.test(s));
  for (const s of ['od mise 02', 'Odemkne se v misi 06', 'Kamera na zápěstí (V), od mise 02', 'Nové: otáčení zápěstí a kamera na zápěstí']) assert.ok(pat(s), s);
});
