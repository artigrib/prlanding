// Progressive unlocking (HUD stage 3): one new control per mission, mapped onto the controls that exist.
// DOM-free (tests/unlock.test.mjs). Order and rationale: the game-UX doc, part B3 (Portal / Human Resource Machine:
// introduce → test → combine). A control is unlocked when the visitor has reached its mission: the current mission,
// or the one after the last mission won (saved progress, so a returning visitor keeps everything earned).
// "Odemknout vše" (☰ › Nastavení) and test runs (?test=1, unless ?lock=1) unlock everything.

export const UNLOCKS = [
  // id, from mission, what is new (the brief says it once: "Nové: …"), keyboard shortcuts that belong to it
  { id: 'wrist', n: 2, what: 'otáčení zápěstí a kamera na zápěstí', keys: ['A', 'D', 'V'] },
  { id: 'ask', n: 3, what: 'Zeptej se AI v nápovědě Poradit', keys: [] },
  { id: 'joints', n: 6, what: 'režim Klouby v Nástrojích (jak ruku vidí motory)', keys: ['M', '1–6'] },
  { id: 'teach', n: 7, what: 'Učit ukázkou v Nástrojích: nahrajte tah a pusťte ho znovu', keys: ['T', 'L'] },
  { id: 'export', n: 9, what: 'export ukázky (formát podobný LeRobot)', keys: [] },
  { id: 'tilt', n: 10, what: 'náklon chapadla a Připojit AI', keys: [] },
  { id: 'ai', n: 10, what: null, keys: [] }
];
export const UNLOCK_N = Object.fromEntries(UNLOCKS.map((u) => [u.id, u.n]));

/** highest mission number reached: the current one, or the one after the last mission won */
export function reached(missions, progress, currentId) {
  let r = 1;
  missions.forEach((m, i) => {
    if (m.id === currentId) r = Math.max(r, i + 1);
    if (progress && progress[m.id]) r = Math.max(r, i + 2);
  });
  return Math.min(r, missions.length);
}

export function isUnlocked(id, level, all) { return !!all || !(id in UNLOCK_N) || level >= UNLOCK_N[id]; }

/** what this mission introduces (its number is the first one where it unlocks), for the brief / a one-time note */
export function newIn(n) { return UNLOCKS.filter((u) => u.n === n && u.what).map((u) => u.what); }

export const nn = (n) => String(n).padStart(2, '0');
