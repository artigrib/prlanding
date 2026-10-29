// i18n entry for the SO-101 simulator: import it first (before any UI module) from app.js,
// objects page and nastaveni/wizard.js. Czech is the default and is never translated;
// English is chosen by ?lang=en or the visitor's saved choice (see assets/i18n.js).
// Czech strings are the keys (gettext style), so there is no cs.js: Czech = the source.
import '../../../../assets/i18n.js';
import en from './en.js';

const I = globalThis.PRI18N;
export const lang = I.initSim(en);
export const t = (s, vars) => I.t(s, vars);
export const isEn = lang === 'en';
I.simSwitcher(document.getElementById('lang-sw'));
