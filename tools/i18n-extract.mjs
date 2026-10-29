// Lists Czech UI strings in source files and checks them against an English dictionary.
//   node tools/i18n-extract.mjs <dict.js> <file|dir>...        (exit 1 when strings are missing)
//   node tools/i18n-extract.mjs --json <dict.js> <file|dir>... (machine-readable list)
// A string counts as Czech when it contains Czech diacritics. String literals and template
// literals in .js/.mjs and text/attributes in .html are scanned; HTML inside strings is split
// into its text pieces, ${…} becomes "{}" (those need a pattern in the dictionary).
// The dictionary is an ES module (export default { strings, patterns }) or a classic script
// that sets window.PR_I18N_EN. Matching uses the same rules as assets/i18n.js.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const json = args[0] === '--json' && args.shift();
const [dictFile, ...targets] = args;
const CZ = /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/;
const SKIP_DIR = /(^|\/)(node_modules|vendor|build|tests?|tools|model|\.git)(\/|$)/;

async function loadDict(f) {
  if (/\.m?js$/.test(f) && /export default/.test(fs.readFileSync(f, 'utf8'))) return (await import(pathToFileURL(path.resolve(f)))).default;
  const ctx = { window: {} }; ctx.globalThis = ctx.window; vm.runInNewContext(fs.readFileSync(f, 'utf8'), ctx);
  return ctx.window.PR_I18N_EN;
}
const norm = s => String(s).replace(/[\u00A0\u2060\u202F]/g, ' ').replace(/\s+/g, ' ').trim();
function files(t) {
  const st = fs.statSync(t);
  if (st.isFile()) return [t];
  return fs.readdirSync(t).flatMap(n => { const p = path.join(t, n); if (SKIP_DIR.test(p)) return []; const s = fs.statSync(p); return s.isDirectory() ? files(p) : /\.(m?js|html)$/.test(n) ? [p] : []; });
}
function pieces(s) {
  // split an HTML-ish string into text pieces; also pull out attribute values
  const out = [];
  s.replace(/\s(?:aria-label|title|placeholder|alt|data-tip)=(?:\\?["'])([^"'\\]*)/g, (m, v) => { out.push(v); return m; });
  s.replace(/<[^>]*>/g, '\u0000').split('\u0000').forEach(p => out.push(p));
  // inline-tag fragments (<b>modrou kouli</b>) count too when their string has Czech elsewhere
  const all = out.map(norm);
  return all.some(p => CZ.test(p)) ? all.filter(p => /\p{L}{2}/u.test(p) && !/^[\w.-]+$/.test(p) || CZ.test(p)) : [];
}
function scanJs(src) {
  const found = [];
  // strip comments (rough but adequate for this codebase)
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(src))) {
    let s = m[1] ?? m[2] ?? m[3];
    if (m[3] != null) s = s.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '{}');
    s = s.replace(/\\n/g, ' ').replace(/\\(['"`\\])/g, '$1').replace(/\\u00A0/gi, ' ').replace(/\\u2060/gi, '');
    found.push(...pieces(s));
  }
  return found;
}
function scanHtml(src) {
  const found = [];
  src.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/g, (m, js) => { found.push(...scanJs(js)); return ''; })
    .replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<meta[^>]*>|<title>[\s\S]*?<\/title>/g, '')
    .replace(/./gs, c => c) // keep
    .split(/(<[^>]*>)/).forEach(p => {
      if (p.startsWith('<')) p.replace(/\s(?:aria-label|title|placeholder|alt|data-tip)="([^"]*)"/g, (m, v) => { if (CZ.test(v)) found.push(norm(v)); return m; });
      else if (CZ.test(p)) found.push(norm(p));
    });
  return found;
}

const dict = dictFile && dictFile !== '-' ? await loadDict(dictFile) : { strings: {}, patterns: [] };
const keys = new Set(Object.keys(dict.strings || {}).map(norm));
const pats = dict.patterns || [];
const has = s => keys.has(s) || pats.some(p => p[0].test(s)) ||
  (s.includes(' · ') && s.split(' · ').every(x => !CZ.test(x) || keys.has(x) || pats.some(p => p[0].test(x))));
const all = new Map();
for (const t of targets) for (const f of files(t)) {
  const src = fs.readFileSync(f, 'utf8');
  for (const s of (f.endsWith('.html') ? scanHtml(src) : scanJs(src))) {
    if (!all.has(s)) all.set(s, new Set());
    all.get(s).add(f);
  }
}
const missing = [...all.keys()].filter(s => !(s.includes('{}') ? pats.some(p => p[0].test(s.replace(/\{\}/g, '1'))) || keys.has(s) : has(s)));
if (json) console.log(JSON.stringify([...all].map(([s, f]) => ({ s, files: [...f], ok: !missing.includes(s) })), null, 1));
else {
  console.log(`${all.size} Czech strings, ${all.size - missing.length} translated, ${missing.length} missing`);
  for (const s of missing) console.log('  ' + JSON.stringify(s) + '  ← ' + [...all.get(s)].map(f => path.basename(f)).join(', '));
}
process.exit(missing.length ? 1 : 0);
