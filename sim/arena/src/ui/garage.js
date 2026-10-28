// Garage data adapter: reads the physics agent's modification model from robots.js when it
// exists (MODS / statsFor / MASS_LIMIT) and falls back to stats derived from the robot defs.
import * as RB from '../robots.js';

const LIMIT = RB.MASS_LIMIT || 150;
const NAMES = { speed: 'Rychlost', agility: 'Obratnost', turn: 'Obratnost', push: 'Tlak', grip: 'Přilnavost', weapon: 'Zbraň', armor: 'Odolnost', armour: 'Odolnost', stability: 'Stabilita' };

function modsOf(id) {
  const M = RB.MODS;
  if (!M) return [];
  let list = Array.isArray(M) ? M.filter(m => !m.robots || m.robots.includes(id)) : (M[id] || []).concat(M['*'] || M.all || []);
  return list.filter(m => m && m.id).map(m => ({ id: m.id, name: m.name || m.id, desc: m.desc || m.blurb || '', grams: +m.grams || +m.mass || 0, slot: m.slot || m.id }));
}
function baseGrams(def) {
  if (def.grams) return def.grams;
  if (RB.baseGrams) try { return RB.baseGrams(def); } catch (_) {}
  return Math.round((def.mass || 1.4) * 100);
}
const clamp01 = v => Math.max(0, Math.min(1, v));

export const garageModel = {
  limit: LIMIT,
  list: modsOf,
  sameSlot(id, a, b) {
    const L = modsOf(id), A = L.find(m => m.id === a), B = L.find(m => m.id === b);
    return !!(A && B && A.slot === B.slot);
  },
  // known ids only, one per slot, keep within the mass limit (unless allowOver, for what-if checks)
  sanitize(id, ids, allowOver = false) {
    const L = modsOf(id), out = [], slots = new Set();
    let g = baseGrams(RB.ROBOTS[id] || {});
    for (const x of ids || []) {
      const m = L.find(k => k.id === x);
      if (!m || slots.has(m.slot)) continue;
      if (!allowOver && g + m.grams > LIMIT) continue;
      slots.add(m.slot); out.push(x); g += m.grams;
    }
    return out;
  },
  summary(id, mods) {
    const def = RB.ROBOTS[id] || {};
    let grams = baseGrams(def), stats = null;
    for (const m of modsOf(id)) if (mods.includes(m.id)) grams += m.grams;
    if (typeof RB.statsFor === 'function') {
      try {
        const s = RB.statsFor(def, mods);
        if (s) {
          if (typeof s.grams === 'number') grams = Math.round(s.grams);
          const src = s.bars || s;
          stats = Object.keys(src).filter(k => NAMES[k] && typeof src[k] === 'number').map(k => ({ name: NAMES[k], v: clamp01(src[k] > 1.5 ? src[k] / 10 : src[k]) }));
        }
      } catch (_) {}
    }
    if (!stats || !stats.length) {
      stats = [
        { name: 'Rychlost', v: clamp01((def.vmax || 6) / 7.5) },
        { name: 'Obratnost', v: clamp01((def.yawMax || 4.5) / 6) },
        { name: 'Tlak', v: clamp01((def.mu || 1) / 1.4) },
        { name: 'Zbraň', v: def.weapon === 'spinner' ? 0.85 : 0.65 }
      ];
    }
    return { grams: Math.round(grams), limit: LIMIT, mods: mods.length, stats };
  }
};
