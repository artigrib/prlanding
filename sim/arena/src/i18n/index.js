// i18n entry for the arena: import it first in src/main.js (esbuild bundles it into build/arena.js).
// Czech is the default and is never translated; English via ?lang=en or the visitor's saved choice
// (see assets/i18n.js). Czech strings are the keys (gettext style), so there is no cs.js.
import '../../../../assets/i18n.js';
import en from './en.js';

const I = globalThis.PRI18N;
export const lang = I.initSim(en);
export const t = (s, vars) => I.t(s, vars);
export const isEn = lang === 'en';
