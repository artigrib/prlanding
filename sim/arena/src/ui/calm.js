// "Klidný režim" (calm mode): no camera shake, no hitstop, no automatic slow motion, no crowd and no jingles,
// quieter effects and fewer sparks. On by default with prefers-reduced-motion; ?klid=1 turns it on and remembers
// it (a teacher can share such a link), ?klid=0 turns it off. A saved choice beats the system setting.
import { store } from './store.js';

export const calm = { on: false };

/** param: the ?klid= value (or null), saved: the stored choice (true / false / null), reduce: prefers-reduced-motion */
export function resolveCalm(param, saved, reduce) {
  if (param === '1' || param === '0') return { on: param === '1', persist: true };
  if (typeof saved === 'boolean') return { on: saved, persist: false };
  return { on: !!reduce, persist: false };
}

export function initCalm({ search = '', reduce = false } = {}) {
  const r = resolveCalm(new URLSearchParams(search).get('klid'), store.get('calm', null), reduce);
  if (r.persist) store.set('calm', r.on);
  calm.on = r.on;
  return calm.on;
}

export function setCalm(on, persist = true) {
  calm.on = !!on;
  if (persist) store.set('calm', calm.on);
  return calm.on;
}
