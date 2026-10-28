// localStorage with try/catch everywhere: private windows, blocked storage and previews
// all fall back to defaults instead of throwing.
const NS = 'pr-arena:';
export const store = {
  get(k, def) {
    try { const v = localStorage.getItem(NS + k); return v == null ? def : JSON.parse(v); } catch (_) { return def; }
  },
  set(k, v) {
    try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (_) { /* storage unavailable */ }
  }
};
