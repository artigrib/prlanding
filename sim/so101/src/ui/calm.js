// Calm mode for the SO-101 sim (the arena's "Klidný režim"): ?klid=1 turns it on and remembers it, ?klid=0 turns it
// off. It is a flag, not a panel control: calm = reduced motion (no cinematic orbit, no confetti, short camera
// moves), and ?klid=1 also switches the sound off (sound is off by default anyway).
import { store } from './store.js';

export function calmMode(search = typeof location !== 'undefined' ? location.search : '') {
  const q = new URLSearchParams(search).get('klid');
  if (q === '1' || q === '0') store.set('calm', q === '1');
  if (q === '1') store.set('sound', false);
  return store.get('calm', false) === true;
}
