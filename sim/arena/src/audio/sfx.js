// Public sound API used by main.js (kept call-compatible with the old synth version).
// Implementation: audio/arena-audio.js (game mapping), audio/core.js (bus graph, limiter, voices),
// audio/bank.js + audio/synth.js (procedural samples), audio/settings.js (pause-menu sliders).
// Everything starts lazily on the first user gesture; with no Web Audio every call is a no-op.
import { store } from '../ui/store.js';
import { ArenaAudio } from './arena-audio.js';
import { mountSettings } from './settings.js';

const A = new ArenaAudio();
const E = A.eng;
E.muted = !!store.get('muted', false);
{
  const saved = store.get('audio', null) || {};
  for (const k of ['master', 'sfx', 'amb']) { const v = +saved[k]; if (Number.isFinite(v)) E.levels[k] = Math.max(0, Math.min(1, v)); }
}

export const sfx = {
  get muted() { return E.muted; },
  get levels() { return E.levels; },
  unlock() { E.unlock(); },
  setMuted(m) { E.setMuted(m); store.set('muted', E.muted); },
  setLevels(l) { E.setLevels(l); const { master, sfx: s, amb } = E.levels; store.set('audio', { master, sfx: s, amb }); },
  listen(camera) { A.listen(camera); },
  rate(r = 1) { A.speed = r; },            // replay playback speed: one-shot pitch/tempo follow (clamped)
  hit(e = 0.5, spinner = false, p = null) { A.hit(e, spinner, p); },
  wall(e = 0.4, p = null) { A.wall(e, p); },
  flip(r = null) { A.flip(r); },
  grab(r = null) { A.grab(r); },
  fall() { A.fall(); },
  pitOpen() { A.pitOpen(); },
  beep(final = false) { A.ambience(true); A.beep(final); },
  buzzer() { A.buzzer(); },
  crowd(e = 1) { A.crowd(e); },
  jingle(win = true) { A.jingle(win); },
  click() { A.click(); },
  motor(id, level, spin = 0, r = null) { A.motor(id, level, spin, r); },
  stopMotors() { A.stopMotors(); }
};

try { if (typeof document !== 'undefined') mountSettings(sfx); } catch (_) { /* UI is optional */ }
if (typeof window !== 'undefined') window.__arenaAudio = A;     // debugging / tests
