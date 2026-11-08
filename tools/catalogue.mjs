// Catalogue robot data: one file per robot in data/robots/<id>.json (Czech fields + `en` overrides),
// ordered by data/robots/_order.json. tools/build.mjs checks them (checkRobots) and generates the browser
// globals assets/data.js and assets/data.en.js (generateData) from them and the hand-edited modules
// data/catalogue/catalogue.js and catalogue.en.js (colours, categories, sims, licences, functions).
// The browser code (assets/app.js) is unchanged: it still reads window.PR_ROBOTS, PR_SHOWCASE, PR_EN …
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROBOTS_DIR = 'data/robots', ORDER = '_order.json';
const MOD_CS = 'data/catalogue/catalogue.js', MOD_EN = 'data/catalogue/catalogue.en.js';
export const OUT_CS = 'assets/data.js', OUT_EN = 'assets/data.en.js';

// Every field a robot file may carry, with its JSON type. A new field: add it here (and use it in app.js/build.mjs).
const T = 'string', B = 'boolean', A = 'array', O = 'object';
export const KEYS = {
  id: T, showcase: B, buy: B, glb: B, glbShow: A, sim: T, render: B, name: T, type: T, cat: T, level: T,
  hw: T, sw: T, preparing: B, author: T, alt: T, credit: T, badge: T, notAffiliated: T, short: T, lead: T, note: T,
  bomCost: T, printTime: T, software: T, setups: B, repo: T, docs: T, upstream: O, card: A, bom: A, mats: A, specs: A,
  bomSource: T, bomDocs: T, fastenersListed: B, noElectronics: B, noSoftware: B, swNotFree: B, rcControl: B, noGuide: B,
  liquids: B, syringe: B, license: O, related: A,
  '//': 'note', en: O
};
// Required fields of a catalogue kit (_order.json "robots") and of a showcase ("showcase").
export const REQUIRED = {
  robots: ['id', 'name', 'type', 'cat', 'level', 'hw', 'sw', 'author', 'alt', 'short', 'lead', 'bomCost', 'printTime', 'software', 'repo', 'docs', 'card', 'specs', 'related', 'en'],
  showcase: ['id', 'showcase', 'name', 'type', 'cat', 'level', 'author', 'alt', 'short', 'lead', 'repo', 'docs', 'card', 'specs', 'license', 'en']
};
// English overrides: which keys data.en.js PR_EN_APPLY may overlay. Kits: translated text fields (an override must
// replace a field the Czech entry has, with the same type). Showcases: the fields PR_EN_APPLY reads for them.
export const EN_KEYS = {
  robots: ['name', 'type', 'hw', 'sw', 'author', 'alt', 'credit', 'short', 'lead', 'bomCost', 'printTime', 'software', 'bomDocs', 'card', 'bom', 'mats', 'specs'],
  showcase: ['type', 'level', 'badge', 'short', 'lead', 'note', 'alt', 'card', 'notAffiliated', 'specLabels', 'specValues', 'licenseNotes']
};
const EN_REQUIRED = { robots: ['alt', 'short', 'lead', 'card', 'specs'], showcase: ['short', 'lead', 'alt'] };

const typeOf = v => Array.isArray(v) ? A : v === null ? 'null' : typeof v;
const readJson = (f, errors) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { errors.push(`${f}: ${e.message}`); return null; }
};
// the hand-edited modules, evaluated (for categories and levels)
function handGlobals(root) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, MOD_CS), 'utf8'), ctx);
  vm.runInNewContext(fs.readFileSync(path.join(root, MOD_EN), 'utf8'), ctx);
  return ctx.window;
}
const isTable = v => Array.isArray(v) && v.every(row => Array.isArray(row) && row.length >= 2 && row.every(c => typeof c === 'string'));

// Load and check every data/robots/*.json. Returns { robots, showcase, errors } (entries in catalogue order).
export function loadRobots(root = '.') {
  const errors = [], dir = path.join(root, ROBOTS_DIR);
  const order = readJson(path.join(dir, ORDER), errors);
  const out = { robots: [], showcase: [], errors };
  if (!order) return out;
  if (typeOf(order) !== O || !Array.isArray(order.robots) || !Array.isArray(order.showcase) || Object.keys(order).length !== 2)
    { errors.push(`${ROBOTS_DIR}/${ORDER}: must be { "robots": [ids…], "showcase": [ids…] }`); return out; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== ORDER).map(f => f.slice(0, -5));
  const listed = [...order.robots, ...order.showcase], seen = new Set();
  for (const id of listed) {
    if (typeof id !== 'string') { errors.push(`${ORDER}: id ${JSON.stringify(id)} is not a string`); continue; }
    if (seen.has(id)) errors.push(`${ORDER}: "${id}" listed twice`);
    seen.add(id);
    if (!files.includes(id)) errors.push(`${ORDER}: "${id}" has no file ${ROBOTS_DIR}/${id}.json`);
  }
  for (const f of files) if (!seen.has(f)) errors.push(`${ROBOTS_DIR}/${f}.json: not listed in ${ORDER} (add its id where it belongs in the catalogue order)`);
  if (errors.length) return out;

  let G;
  try { G = handGlobals(root); } catch (e) { errors.push(`${MOD_CS} / ${MOD_EN}: ${e.message}`); return out; }
  const cats = Object.keys(G.PR_CATS || {}), levels = Object.keys((G.PR_EN || {}).levels || {});
  for (const kind of ['robots', 'showcase']) for (const id of order[kind]) {
    const f = `${ROBOTS_DIR}/${id}.json`, r = readJson(path.join(dir, id + '.json'), errors);
    if (!r) continue;
    if (typeOf(r) !== O) { errors.push(`${f}: must be a JSON object`); continue; }
    const err = m => errors.push(`${f}: ${m}`);
    if (r.id !== id) err(`id "${r.id}" does not match the file name`);
    for (const k of REQUIRED[kind]) if (r[k] === undefined || r[k] === '' ) err(`missing required field "${k}"`);
    for (const [k, v] of Object.entries(r)) {
      const want = KEYS[k];
      if (!want) err(`unknown field "${k}" (known fields: tools/catalogue.mjs KEYS)`);
      else if (want === 'note') { if (!(typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'string')))) err('"//" (a note, not published) must be a string or a list of strings'); }
      else if (typeOf(v) !== want) err(`"${k}" must be ${want}, is ${typeOf(v)}`);
    }
    if (kind === 'showcase' && r.showcase !== true) err('a showcase entry needs "showcase": true');
    if (kind === 'robots' && r.showcase) err('"showcase": true entries belong in _order.json "showcase"');
    if (r.cat !== undefined && !cats.includes(r.cat)) err(`cat "${r.cat}" is not a PR_CATS key (${cats.join(', ')})`);
    if (r.level !== undefined && !levels.includes(r.level)) err(`level "${r.level}" is not one of ${levels.join(', ')}`);
    for (const k of ['card', 'bom', 'mats']) if (r[k] !== undefined && !isTable(r[k])) err(`"${k}" must be a list of [label, value] string pairs`);
    if (r.specs !== undefined && !isTable(r.specs)) err('"specs" must be a list of [label, value(, source)] strings');
    if (r.license !== undefined && r.license !== null && !Array.isArray(r.license.sources)) err('"license.sources" must be a list');
    if (typeOf(r.en) === O) {
      const allowed = EN_KEYS[kind];
      for (const k of EN_REQUIRED[kind]) if (r.en[k] === undefined) err(`en: missing English "${k}"`);
      for (const [k, v] of Object.entries(r.en)) {
        if (!allowed.includes(k)) { err(`en: "${k}" is not an English override key (allowed: ${allowed.join(', ')})`); continue; }
        if (kind === 'robots') {
          if (r[k] === undefined) err(`en: "${k}" overrides a field the Czech entry does not have`);
          else if (typeOf(v) !== typeOf(r[k])) err(`en: "${k}" must be ${typeOf(r[k])} like the Czech field`);
          else if (['card', 'bom', 'mats', 'specs'].includes(k) && (!isTable(v) || v.length !== r[k].length)) err(`en: "${k}" must have the same ${r[k].length} rows as the Czech field`);
        } else if (['specLabels', 'specValues'].includes(k)) {
          if (!Array.isArray(v) || v.length !== (r.specs || []).length || !v.every(x => typeof x === 'string')) err(`en: "${k}" must list one string per spec row (${(r.specs || []).length})`);
        } else if (typeOf(v) !== (k === 'card' ? A : T)) err(`en: "${k}" has the wrong type`);
      }
    }
    out[kind].push(r);
  }
  const ids = new Set(listed);
  for (const r of [...out.robots, ...out.showcase]) for (const x of r.related || []) if (!ids.has(x)) errors.push(`${ROBOTS_DIR}/${r.id}.json: related "${x}" is not a catalogue id`);
  return out;
}
export const checkRobots = (root = '.') => loadRobots(root).errors;

// --- JS literal output (single quotes, one robot per line; tests grep data.js for literal rows) ---
const jsStr = s => "'" + s.replace(/[\\'\u0000-\u001f\u2028\u2029]/g, c =>
  ({ '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c] || '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + "'";
const jsKey = k => /^[A-Za-z_$][\w$]*$/.test(k) ? k : jsStr(k);
export function js(v) {
  if (typeof v === 'string') return jsStr(v);
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v);
  if (Array.isArray(v)) return '[' + v.map(js).join(', ') + ']';
  const ks = Object.keys(v).filter(k => k !== '//');
  return ks.length ? '{ ' + ks.map(k => jsKey(k) + ': ' + js(v[k])).join(', ') + ' }' : '{}';
}
const czech = r => { const o = {}; for (const k of Object.keys(r)) if (k !== 'en' && k !== '//') o[k] = r[k]; return o; };

const HEADER = '// GENERATED by tools/build.mjs from data/robots/*.json and %MOD% — edit those, not this file (see data/robots/README.md).\n';
function fill(src, file, marks) {
  for (const [mark, body] of Object.entries(marks)) {
    const re = new RegExp(`^.*// @${mark}\\b.*$`, 'gm'), n = (src.match(re) || []).length;
    if (n !== 1) throw new Error(`${file}: expected exactly one "// @${mark}" marker line, found ${n}`);
    src = src.replace(re, () => body);
  }
  return src;
}
// Returns { cs, en }: the full text of assets/data.js and assets/data.en.js. Throws on invalid data.
export function generateData(root = '.') {
  const { robots, showcase, errors } = loadRobots(root);
  if (errors.length) throw new Error('data/robots check failed:\n  ' + errors.join('\n  '));
  const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
  const list = rs => rs.map(r => '  ' + js(czech(r))).join(',\n');
  const map = rs => rs.filter(r => r.en && Object.keys(r.en).length).map(r => '    ' + jsKey(r.id) + ': ' + js(r.en)).join(',\n');
  const cs = HEADER.replace('%MOD%', MOD_CS) + fill(rd(MOD_CS), MOD_CS, {
    robots: `window.PR_ROBOTS = [\n${list(robots)}\n];`,
    showcase: `window.PR_SHOWCASE = [\n${list(showcase)}\n];`
  });
  const en = HEADER.replace('%MOD%', MOD_EN) + fill(rd(MOD_EN), MOD_EN, {
    robots: `  robots: {\n${map(robots)}\n  },`,
    showcase: `  showcase: {\n${map(showcase)}\n  },`
  });
  return { cs, en };
}
