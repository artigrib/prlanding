// Garage data adapter over the physics agent's catalogue (robots.js: MODS, buildDef, statsFor,
// MASS_LIMIT_G). A build = one option per slot; we store only the non-default picks ('slot:option').
import * as RB from '../robots.js';

const LIMIT = RB.MASS_LIMIT_G || 150;
const STAT_NAMES = [['speed', 'Rychlost'], ['push', 'Tlak'], ['weapon', 'Zbraň'], ['armor', 'Odolnost']];

function modsOf(id) { return (RB.MODS && RB.MODS[id]) || []; }
function build(id, mods) {
  try { return RB.buildDef ? RB.buildDef(id, mods) : RB.ROBOTS[id]; } catch (_) { return RB.ROBOTS[id]; }
}
const gramsOf = def => Math.round(def.grams || def.massG || (def.mass || 1.5) * 100);

export const garageModel = {
  limit: LIMIT,
  // [{ slot, name, options: [{ id, name, desc, grams, default }] }]
  slots(id) {
    const out = [];
    for (const m of modsOf(id)) {
      let s = out.find(x => x.slot === m.slot);
      if (!s) out.push(s = { slot: m.slot, name: m.slotName || m.slot, options: [] });
      s.options.push(m);
    }
    return out;
  },
  // known, non-default ids, one per slot, and the whole build within the mass limit
  sanitize(id, ids) {
    const L = modsOf(id), seen = new Set(), out = [];
    for (const x of Array.isArray(ids) ? ids : []) {
      const m = L.find(k => k.id === x);
      if (!m || m.default || seen.has(m.slot)) continue;
      seen.add(m.slot); out.push(x);
    }
    while (out.length && gramsOf(build(id, out)) > LIMIT) out.pop();
    return out;
  },
  // pick option `modId` (replaces that slot's choice)
  choose(id, mods, modId) {
    const m = modsOf(id).find(k => k.id === modId);
    if (!m) return mods;
    const rest = mods.filter(x => { const k = modsOf(id).find(o => o.id === x); return k && k.slot !== m.slot; });
    return m.default ? rest : [...rest, modId];
  },
  isOn(id, mods, modId) {
    const m = modsOf(id).find(k => k.id === modId);
    if (!m) return false;
    const picked = mods.find(x => x.split(':')[0] === m.slot);
    return picked ? picked === modId : !!m.default;
  },
  gramsWith(id, mods) { return gramsOf(build(id, mods)); },
  summary(id, mods) {
    const def = build(id, mods);
    const st = def.stats || (RB.statsFor ? RB.statsFor(id, mods) : null) || {};
    const stats = STAT_NAMES.filter(([k]) => typeof st[k] === 'number').map(([k, name]) => ({ name, v: Math.max(0, Math.min(1, st[k])) }));
    if (!stats.length) stats.push({ name: 'Rychlost', v: Math.min(1, (def.vmax || 6) / 9) });
    return { grams: gramsOf(def), limit: LIMIT, mods: mods.length, stats, problems: def.problems || [] };
  }
};
