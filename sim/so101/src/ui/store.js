// localStorage with try/catch (private mode, blocked storage, previews): never throws.
const P = 'pr-sim-';
export const store = {
  get(k, def) {
    try { const v = localStorage.getItem(P + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
};
