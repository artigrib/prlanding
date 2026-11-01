// Registry ("Rejstřík") of open 3D-printable robotics projects: data/registry/projects.json (+ Czech summaries in
// data/registry/summary.cs.json). Checked and rendered by tools/build.mjs into /katalog/rejstrik/ and
// /en/catalogue/registry/; tests/registry.test.mjs runs the same check. Standalone:  node tools/registry.mjs
//
// Record (one per project): id, name, category, subcategory? (optional, kebab-case, e.g. for RC cars under "wheeled"),
// summary_en, homepage, repo, cad, licenses {hardware, software, docs} (exact text from the project),
// rights_class (what the HARDWARE licence lets you do with prints), printed_share, actuation, control, bom_cost,
// maturity {last_activity YYYY-MM, stars, known_builds, paper, docs_quality}, sim_model, safety_notes,
// fit {maker, school, lab, plan_guide_treatment} 1–5, sources [{url, checked}], unverified [] (internal, not shown).
// Records that the source census had twice carry the other copy, whole, under merged_from; a rights_class lowered to
// "unknown" because the hardware licence is not established keeps the census value in rights_class_census.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CATEGORIES = ['arm', 'gripper', 'hand', 'humanoid', 'legged', 'wheeled', 'tracked', 'drone', 'actuator', 'motor', 'gearbox', 'sensor', 'lidar', 'lab-automation', 'bioreactor', 'toolchanger', 'educational', 'other'];
export const RIGHTS = ['permissive', 'copyleft', 'nc', 'nd', 'proprietary', 'unknown'];
export const PRINTED = ['high', 'medium', 'low', 'unknown'];
// a hardware licence text that names no licence: such a record must not carry a licensed rights class
export const NO_HW_LICENCE = /^(unknown|none|not stated|not established|n\/a|see )/i;
// registry id -> curated catalogue entry (assets/data.js PR_ROBOTS id, or a PR_SHOWCASE id)
export const CATALOGUE = {
  'so-arm100-101': 'so101', lekiwi: 'lekiwi', xlerobot: 'xle', 'open-duck-mini': 'duck', 'amazing-hand': 'hand', 'otto-diy': 'otto',
  spotmicro: 'spot', 'sawppy-rover': 'sawppy', thor: 'thor', exomy: 'exomy', 'so-arm102': 'so102', 'nextis-aira': 'aira',
  parol6: 'parol6', 'berkeley-humanoid-lite': 'bhl', 'roboto-origin': 'origin'
};
const SHOWCASE_PATH = { origin: { cs: 'sim/origin/', en: 'en/sim/origin/' } };

export const LABELS = {
  cs: {
    cat: { arm: 'Robotická ruka', gripper: 'Chapadlo', hand: 'Robotická dlaň', humanoid: 'Humanoid', legged: 'Kráčející robot', wheeled: 'Robot na kolech', tracked: 'Pásový robot', drone: 'Dron', actuator: 'Pohon', motor: 'Motor', gearbox: 'Převodovka', sensor: 'Senzor', lidar: 'Lidar', 'lab-automation': 'Laboratorní automatizace', bioreactor: 'Bioreaktor', toolchanger: 'Výměna nástrojů', educational: 'Výukový robot', other: 'Ostatní' },
    rights: { permissive: 'Volná licence', copyleft: 'Copyleft', nc: 'Jen nekomerčně', nd: 'Bez úprav', proprietary: 'Uzavřená', unknown: 'Licence neuvedena' },
    printed: { high: 'vysoký', medium: 'střední', low: 'nízký', unknown: 'neuvedeno' },
    sim: { none: 'žádný', 'none known': 'žádný známý', unknown: 'neuvedeno', 'n/a': '—' },
    hw: 'Hardware', sw: 'Software', docs: 'Dokumentace', act: 'Pohon', simL: 'Simulační model', printedL: 'Podíl tisku', last: 'Poslední aktivita', stars: 'hvězd na GitHubu',
    fit: 'Vhodnost', maker: 'maker', school: 'škola', web: 'Web', repo: 'Repozitář', cad: 'CAD', inCat: 'Karta v katalogu', inShow: 'Ukázka v simulaci', of5: 'z 5'
  },
  en: {
    cat: { arm: 'Robot arm', gripper: 'Gripper', hand: 'Robot hand', humanoid: 'Humanoid', legged: 'Legged robot', wheeled: 'Wheeled robot', tracked: 'Tracked robot', drone: 'Drone', actuator: 'Actuator', motor: 'Motor', gearbox: 'Gearbox', sensor: 'Sensor', lidar: 'Lidar', 'lab-automation': 'Lab automation', bioreactor: 'Bioreactor', toolchanger: 'Tool changer', educational: 'Educational robot', other: 'Other' },
    rights: { permissive: 'Permissive', copyleft: 'Copyleft', nc: 'Non-commercial only', nd: 'No modifications', proprietary: 'Closed', unknown: 'No licence stated' },
    printed: { high: 'high', medium: 'medium', low: 'low', unknown: 'not stated' },
    sim: { none: 'none', 'none known': 'none known', unknown: 'not stated', 'n/a': '—' },
    hw: 'Hardware', sw: 'Software', docs: 'Docs', act: 'Actuation', simL: 'Sim model', printedL: 'Printed share', last: 'Last activity', stars: 'GitHub stars',
    fit: 'Fit', maker: 'maker', school: 'school', web: 'Website', repo: 'Repository', cad: 'CAD', inCat: 'Catalogue card', inShow: 'Showcase in the simulator', of5: 'of 5'
  }
};
// subcategory labels (optional field); an unlisted value is shown as written, hyphens as spaces
export const SUBCAT_LABELS = { cs: {}, en: {} };

const isUrl = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/.test(u);
export function loadRegistry(root = '.') {
  const p = (f) => `${root}/data/registry/${f}`;
  return { records: JSON.parse(fs.readFileSync(p('projects.json'), 'utf8')), cs: JSON.parse(fs.readFileSync(p('summary.cs.json'), 'utf8')) };
}

// returns a list of problems (empty = ok); catalogueIds = ids the curated catalogue has (optional)
export function checkRegistry(records, cs = {}, catalogueIds = null) {
  const errors = [], seen = new Set();
  if (!Array.isArray(records) || !records.length) return ['projects.json: expected a non-empty array'];
  for (const [i, r] of records.entries()) {
    const at = `#${i} ${r && r.id || '?'}`;
    if (!r || typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(r.id)) { errors.push(`${at}: id must be kebab-case`); continue; }
    if (seen.has(r.id)) errors.push(`${at}: duplicate id`);
    seen.add(r.id);
    if (!r.name || typeof r.name !== 'string') errors.push(`${at}: missing name`);
    if (!CATEGORIES.includes(r.category)) errors.push(`${at}: category "${r.category}" not in ${CATEGORIES.join('|')}`);
    if ('subcategory' in r && !(typeof r.subcategory === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(r.subcategory))) errors.push(`${at}: subcategory must be a kebab-case string when present`);
    if (!RIGHTS.includes(r.rights_class)) errors.push(`${at}: rights_class "${r.rights_class}" not in ${RIGHTS.join('|')}`);
    if (!PRINTED.includes(r.printed_share)) errors.push(`${at}: printed_share "${r.printed_share}" not in ${PRINTED.join('|')}`);
    if (!r.summary_en || typeof r.summary_en !== 'string') errors.push(`${at}: missing summary_en`);
    if (!cs[r.id]) errors.push(`${at}: missing Czech summary in data/registry/summary.cs.json`);
    const urls = (Array.isArray(r.sources) ? r.sources : []).map((s) => s && s.url).filter(isUrl);
    if (!urls.length) errors.push(`${at}: needs at least one source URL`);
    for (const k of ['homepage', 'repo']) if (r[k] != null && !isUrl(r[k])) errors.push(`${at}: ${k} is not a URL`);
    if (r.cad != null && (typeof r.cad !== 'string' || !r.cad.trim())) errors.push(`${at}: cad must be a URL, a short text or null`);
    const hw = r.licenses && r.licenses.hardware;
    if (typeof hw !== 'string' || !hw.trim()) errors.push(`${at}: licenses.hardware must be the licence text (or "unknown")`);
    // never shown as licensed without an established hardware licence
    else if (r.rights_class !== 'unknown' && NO_HW_LICENCE.test(hw)) errors.push(`${at}: rights_class "${r.rights_class}" but the hardware licence is "${hw}" – use "unknown"`);
    // YYYY-MM preferred; a year with a note ("2022", "2020 (last paper)") or "unknown" is kept as written
    if (!r.maturity || !(r.maturity.last_activity == null || r.maturity.last_activity === 'unknown' || /^\d{4}(-\d{2})?\b/.test(r.maturity.last_activity))) errors.push(`${at}: maturity.last_activity must start with YYYY or YYYY-MM (or be null/"unknown")`);
    if (r.maturity && r.maturity.stars != null && !Number.isInteger(r.maturity.stars)) errors.push(`${at}: maturity.stars must be an integer or null`);
    for (const k of ['maker', 'school']) { const v = r.fit && r.fit[k]; if (!(Number.isInteger(v) && v >= 1 && v <= 5)) errors.push(`${at}: fit.${k} must be 1–5`); }
  }
  for (const id of Object.keys(cs)) if (!seen.has(id)) errors.push(`summary.cs.json: "${id}" has no record`);
  for (const [rid, cid] of Object.entries(CATALOGUE)) {
    if (!seen.has(rid)) errors.push(`CATALOGUE: registry id "${rid}" has no record`);
    if (catalogueIds && !catalogueIds.includes(cid)) errors.push(`CATALOGUE: "${cid}" is not in the curated catalogue`);
  }
  return errors;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const MK = { permissive: 'y', copyleft: 'c', nc: 'n', nd: 'n', proprietary: 'n', unknown: 'u' };
// default order (the page's "fit" sort): maker fit, then school fit, then last activity, then name
export const lastKey = (r) => (/^\d{4}(-\d{2})?/.exec(r.maturity.last_activity || '') || [''])[0];
export function sortRecords(records) {
  return [...records].sort((a, b) => (b.fit.maker - a.fit.maker) || (b.fit.school - a.fit.school)
    || lastKey(b).localeCompare(lastKey(a)) || a.name.localeCompare(b.name, 'en'));
}
export const subcatLabel = (L, s) => SUBCAT_LABELS[L][s] || s.replace(/-/g, ' ');

// static list + filter form; root = path to the site root from the page
export function renderRegistry(L, records, cs, root) {
  const T = LABELS[L], en = L === 'en', lang = en ? '' : ' lang="en"';
  const count = (k, v) => records.filter((r) => r[k] === v).length;
  const opt = (v, t, n) => `<option value="${v}">${esc(t)}${n == null ? '' : ` (${n})`}</option>`;
  const cats = CATEGORIES.filter((c) => count('category', c));
  const F = en
    ? { legend: 'Filter the registry', cat: 'Category', all: 'All', rights: 'Rights', printed: 'Printed share', fitL: 'Good fit for', any: 'Anyone', fm: 'Makers (4–5 of 5)', fs: 'Schools (4–5 of 5)', q: 'Search', qph: 'name, motor, licence…', sort: 'Sort', sFit: 'Fit (maker, school)', sSchool: 'Fit for schools', sLast: 'Last activity', sName: 'Name', reset: 'Clear filters', msg: 'Showing {n} of {total} projects', none: 'No project matches these filters.' }
    : { legend: 'Filtr rejstříku', cat: 'Kategorie', all: 'Vše', rights: 'Práva', printed: 'Podíl tisku', fitL: 'Vhodné pro', any: 'Kohokoli', fm: 'Makery (4–5 z 5)', fs: 'Školy (4–5 z 5)', q: 'Hledat', qph: 'název, motor, licence…', sort: 'Řazení', sFit: 'Vhodnost (maker, škola)', sSchool: 'Vhodnost pro školy', sLast: 'Poslední aktivita', sName: 'Název', reset: 'Zrušit filtry', msg: 'Zobrazeno {n} z {total} projektů', none: 'Filtrům neodpovídá žádný projekt.' };
  const form = `<form class="reg-f" id="reg-f" hidden data-msg="${esc(F.msg)}" aria-label="${esc(F.legend)}">
<label class="reg-q"><span>${F.q}</span><input type="search" name="q" placeholder="${esc(F.qph)}" autocomplete="off"></label>
<label><span>${F.cat}</span><select name="cat">${opt('', F.all, records.length)}${cats.map((c) => opt(c, T.cat[c], count('category', c))).join('')}</select></label>
<label><span>${F.rights}</span><select name="rights">${opt('', F.all)}${RIGHTS.map((c) => opt(c, T.rights[c], count('rights_class', c))).join('')}</select></label>
<label><span>${F.printed}</span><select name="printed">${opt('', F.all)}${PRINTED.map((c) => opt(c, T.printed[c], count('printed_share', c))).join('')}</select></label>
<label><span>${F.fitL}</span><select name="fit">${opt('', F.any)}${opt('maker', F.fm)}${opt('school', F.fs)}</select></label>
<label><span>${F.sort}</span><select name="sort">${opt('fit', F.sFit)}${opt('school', F.sSchool)}${opt('last', F.sLast)}${opt('name', F.sName)}</select></label>
<button type="reset" class="chip">${F.reset}</button>
</form>
<p class="mono reg-count" id="reg-count" aria-live="polite">${esc(F.msg.replace('{n}', records.length).replace('{total}', records.length))}</p>
<p class="reg-none" id="reg-none" hidden>${F.none}</p>`;
  const kit = (cid) => SHOWCASE_PATH[cid] ? SHOWCASE_PATH[cid][L] : en ? `en/kit/${cid}/` : `sada/${cid}/`;
  const simText = (s) => { const v = String(s || 'unknown').trim(); return T.sim[v.toLowerCase()] != null ? [T.sim[v.toLowerCase()], false] : [v, true]; };
  const lastHtml = (m) => {
    if (!m || m === 'unknown') return '—';
    if (/^\d{4}-\d{2}$/.test(m)) { const [y, mo] = m.split('-'); return `<time datetime="${m}">${en ? m : `${+mo}/${y}`}</time>`; }
    if (/^\d{4}$/.test(m)) return `<time datetime="${m}">${m}</time>`;
    return `<span${lang}>${esc(m)}</span>`;   // year with the source's note, as written
  };
  const items = sortRecords(records).map((r) => {
    const sum = en ? r.summary_en : cs[r.id];
    const lic = r.licenses || {};
    const links = [];
    const seenU = new Set();
    for (const [k, t] of [['homepage', T.web], ['repo', T.repo], ['cad', T.cad]]) {
      if (!isUrl(r[k]) || seenU.has(r[k])) continue;
      seenU.add(r[k]);
      links.push(`<a href="${esc(r[k])}" rel="noopener">${t} <span aria-hidden="true">↗</span></a>`);
    }
    const cid = CATALOGUE[r.id];
    if (cid) links.unshift(`<a class="reg-kit" href="${root}${kit(cid)}">${SHOWCASE_PATH[cid] ? T.inShow : T.inCat} <span aria-hidden="true">→</span></a>`);
    const [simV, simRaw] = simText(r.sim_model);
    const text = fold([r.name, r.id, sum, T.cat[r.category], r.subcategory || '', r.actuation || '', lic.hardware || '', lic.software || ''].join(' '));
    const sub = r.subcategory ? ` · ${esc(subcatLabel(L, r.subcategory))}` : '';
    return `<li class="reg-i" id="p-${r.id}" data-cat="${r.category}"${r.subcategory ? ` data-sub="${esc(r.subcategory)}"` : ''} data-rights="${r.rights_class}" data-printed="${r.printed_share}" data-maker="${r.fit.maker}" data-school="${r.fit.school}" data-last="${lastKey(r)}" data-name="${esc(fold(r.name))}" data-text="${esc(text)}">
<div class="reg-h"><h3>${esc(r.name)}</h3><span class="mono">${esc(T.cat[r.category])}${sub}</span></div>
<p class="reg-s">${esc(sum)}</p>
<p class="reg-lic"><span class="reg-b reg-b-${r.rights_class}"><span class="mk ${MK[r.rights_class]}" aria-hidden="true"></span>${T.rights[r.rights_class]}</span>
<span class="reg-lt">${T.hw}: <span${lang}>${esc(lic.hardware || 'unknown')}</span></span>${lic.software ? `<span class="reg-lt">${T.sw}: <span${lang}>${esc(lic.software)}</span></span>` : ''}${lic.docs ? `<span class="reg-lt">${T.docs}: <span${lang}>${esc(lic.docs)}</span></span>` : ''}</p>
<dl class="reg-d">
<div><dt>${T.act}</dt><dd${lang}>${esc(r.actuation || '—')}</dd></div>
<div><dt>${T.simL}</dt><dd${simRaw ? lang : ''}>${esc(simV)}</dd></div>
<div><dt>${T.printedL}</dt><dd>${T.printed[r.printed_share]}</dd></div>
<div><dt>${T.last}</dt><dd>${lastHtml(r.maturity.last_activity)}${r.maturity.stars != null ? ` · ${r.maturity.stars.toLocaleString(en ? 'en-GB' : 'cs-CZ')} ${T.stars}` : ''}</dd></div>
<div><dt>${T.fit}</dt><dd>${T.maker} ${r.fit.maker} ${T.of5} · ${T.school} ${r.fit.school} ${T.of5}</dd></div>
</dl>
<p class="reg-a">${links.join('')}${r.cad && !isUrl(r.cad) ? `<span class="reg-lt">${T.cad}: <span${lang}>${esc(r.cad)}</span></span>` : ''}</p>
</li>`;
  }).join('\n');
  return `${form}\n<ol class="reg-l" id="reg-l">\n${items}\n</ol>`;
}

// newest "checked" date among the sources (the page states it)
export function checkedDate(records) {
  return records.flatMap((r) => (r.sources || []).map((s) => s.checked)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort().at(-1) || null;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { records, cs } = loadRegistry();
  const errors = checkRegistry(records, cs);
  if (errors.length) { console.error('registry check failed:\n  ' + errors.join('\n  ')); process.exit(1); }
  console.log('registry ok:', records.length, 'projects');
}
