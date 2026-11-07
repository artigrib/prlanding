// Registry of open projects (data/registry, tools/registry.mjs): record check and the rendered list.
// node --test tests/registry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CATEGORIES, RIGHTS, CATALOGUE, LABELS, DISCIPLINES, SUBCATS, GAPS, checkRegistry, hiddenFields, loadRegistry, renderRegistry, renderGaps, disciplineOf, hazardsOf } from '../tools/registry.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { records, cs } = loadRegistry(ROOT);
const clone = (x) => JSON.parse(JSON.stringify(x));
// curated catalogue: id -> hardware licence, as tools/build.mjs passes it
const catalogue = (() => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(`${ROOT}/assets/data.js`, 'utf8'), ctx);
  return Object.fromEntries([...ctx.window.PR_ROBOTS, ...(ctx.window.PR_SHOWCASE || [])].map((r) => [r.id, r.license ? r.license.hw : r.hw]));
})();
const catalogueIds = Object.keys(catalogue);
const items = (html) => [...html.matchAll(/<li class="reg-i[^"]*"[\s\S]*?<\/li>/g)].map((m) => m[0]);
const fails = (recs, re, c = cs) => assert.ok(checkRegistry(recs, c).some((e) => re.test(e)), `expected an error matching ${re}`);

test('data passes the check (ids, categories, rights, sources, Czech summaries, catalogue links)', () => {
  assert.deepEqual(checkRegistry(records, cs, catalogue), []);
});

test('ids are unique', () => {
  assert.equal(new Set(records.map((r) => r.id)).size, records.length);
  const d = clone(records); d.push(clone(d[0]));
  fails(d, /duplicate id/);
});

test('only allowed category and rights_class values', () => {
  for (const r of records) { assert.ok(CATEGORIES.includes(r.category), r.id); assert.ok(RIGHTS.includes(r.rights_class), r.id); }
  const d = clone(records); d[0].category = 'robot'; fails(d, /category "robot"/);
  const e = clone(records); e[0].rights_class = 'free'; fails(e, /rights_class "free"/);
});

test('every record has at least one source URL', () => {
  const d = clone(records); d[0].sources = []; fails(d, /source URL/);
  const e = clone(records); e[0].sources = [{ url: 'github', checked: '2026-10-31' }]; fails(e, /source URL/);
});

test('a record without an established hardware licence is never classed as licensed', () => {
  const NOLIC = ['unknown', 'none stated (no LICENSE file in repo)', 'see upkie_parts repo', 'unknown (Thingiverse, not checked)', 'unclear - repo Apache-2.0',
    'unspecified', 'No licence stated', 'no licence stated; author asks for credit', 'not verified', 'not stated (site/repo)', 'TBD', '?', 'All rights reserved',
    "Zenodo: 'Other (Open)' - unspecified", 'n/a'];
  for (const hw of NOLIC) for (const cls of ['permissive', 'copyleft', 'nc', 'nd']) {
    const d = clone(records); d[0].licenses.hardware = hw; d[0].rights_class = cls;
    fails(d, /use "unknown"/);
  }
  // "all rights reserved" may be classed closed; an unknown licence may not
  const p = clone(records); p[0].licenses.hardware = "paid files; site '© Author, all rights reserved'"; p[0].rights_class = 'proprietary';
  assert.deepEqual(checkRegistry(p, cs).filter((e) => e.startsWith(`#0 `)), []);
  const q = clone(records); q[0].licenses.hardware = 'unknown'; q[0].rights_class = 'proprietary'; fails(q, /use "unknown"/);
  // a hardware licence listed as unverified counts as unknown
  const u = clone(records); const i = u.findIndex((r) => r.rights_class === 'permissive'); u[i].unverified = [...u[i].unverified, 'hardware license'];
  fails(u, /listed as unverified/);
});

test('registry and catalogue agree on the hardware licence of linked projects', () => {
  const d = clone(records); d.find((r) => r.id === 'roboto-origin').licenses.hardware = 'CC-BY-SA-4.0 (rpo_hardware)';
  assert.ok(checkRegistry(d, cs, catalogue).some((e) => /roboto-origin hardware licence/.test(e)));
  // "CC BY (Thingiverse)" in the catalogue is not definite: the registry must not class SpotMicro
  const e = clone(records); const sp = e.find((r) => r.id === 'spotmicro'); sp.licenses.hardware = 'CC-BY-4.0'; sp.rights_class = 'permissive';
  assert.ok(checkRegistry(e, cs, catalogue).some((x) => /spotmicro is classed/.test(x)));
  const o = records.find((r) => r.id === 'roboto-origin');
  assert.deepEqual(o.licenses, { hardware: 'CERN-OHL-W-2.0', software: 'GPL-3.0-only', docs: 'CC-BY-SA-4.0' });
});

test('unverified fields render as "neuvedeno" / "not stated", thin records show only name, summary and a link', () => {
  assert.deepEqual([...hiddenFields({ unverified: ['actuation', 'hardware license', 'stars (GitHub API blocked)', 'licence', 'printed_share', 'sim model', 'last_activity'] })].sort(),
    ['act', 'docs', 'hw', 'last', 'printed', 'sim', 'stars', 'sw']);
  assert.deepEqual([...hiddenFields({ unverified: ['all details (PMC blocked)'] })], ['all']);
  assert.deepEqual([...hiddenFields({ unverified: ['bom_cost', 'known builds', 'hardware license scope (badge only)', 'license conflict README MIT vs LICENSE'] })], []);
  for (const L of ['cs', 'en']) {
    const T = LABELS[L], html = renderRegistry(L, records, cs, '../../'), li = items(html);
    for (const r of records) {
      const x = li.find((s) => s.includes(`id="p-${r.id}"`)), H = hiddenFields(r);
      const dd = (label) => (new RegExp(`<dt>${label}</dt><dd>([\\s\\S]*?)</dd>`).exec(x) || [])[1];
      if (H.has('all')) {
        assert.ok(x.includes(T.thin) && !x.includes('<dl') && !x.includes('reg-lic') && (x.match(/rel="noopener"/g) || []).length <= 1, r.id);
        continue;
      }
      if (H.has('act')) assert.match(dd(T.act), new RegExp(`>${T.na}<`), r.id);
      if (H.has('sim')) assert.match(dd(T.simL), new RegExp(`>${T.na}<`), r.id);
      if (H.has('printed')) assert.match(dd(T.printedL), new RegExp(`>${T.na}<`), r.id);
      if (H.has('stars')) assert.ok(!dd(T.last).includes(T.stars), r.id);
      if (H.has('hw')) assert.match(x, new RegExp(`${T.hw}: <span class="reg-na">${T.naLic}</span>`), r.id);
    }
    // no research notes on the page
    assert.doesNotMatch(html, /unverified|not verified|partially verified|presumed|not checked|\(search /i);
  }
  for (const id of ['histoender', 'incubot', 'findus', 'evobot', 'personal-pipetting-robots', 'ekf-turbidostat']) assert.ok(hiddenFields(records.find((r) => r.id === id)).has('all'), id);
});

test('rendered list: unknown rights show "Licence neověřena" / "Licence not confirmed", never a licensed badge', () => {
  for (const L of ['cs', 'en']) {
    const html = renderRegistry(L, records, cs, '../../');
    const li0 = items(html);
    assert.equal(li0.length, records.length);
    for (const r of records) {
      if (hiddenFields(r).has('all')) { assert.equal(r.rights_class, 'unknown', r.id); continue; }
      const li = li0.find((x) => x.includes(`id="p-${r.id}"`));
      const badge = /<span class="reg-b reg-b-([a-z]+)">[\s\S]*?<\/span>([^<]+)<\/span>/.exec(li);
      assert.equal(badge[1], r.rights_class, r.id);
      assert.equal(badge[2], LABELS[L].rights[r.rights_class], r.id);
    }
    // every external link opens with rel="noopener"; no images
    assert.ok([...html.matchAll(/<a href="https?:[^"]*"([^>]*)>/g)].every((m) => /rel="noopener"/.test(m[1])));
    assert.ok(!/<img/.test(html));
  }
});

test('optional subcategory (e.g. RC cars under "wheeled") is accepted, shown and filterable', () => {
  const d = clone(records);
  d.push({ ...clone(records.find((r) => r.category === 'wheeled')), id: 'test-rc-car', name: 'Test RC car', subcategory: 'rc-car', merged_from: undefined });
  const c = { ...cs, 'test-rc-car': 'Testovací RC auto.' };
  assert.deepEqual(checkRegistry(d, c), []);
  const html = renderRegistry('cs', d, c, '../../');
  assert.match(html, /id="p-test-rc-car" data-cat="wheeled" data-sub="rc-car"/);
  assert.match(html, /Robot na kolech · RC auto/);
  assert.match(renderRegistry('cs', records, cs, '../../'), /<option value="wheeled\/rc-car">\u00a0\u00a0· RC auta \(\d+\)<\/option>/);
  d.at(-1).subcategory = 'RC Car'; fails(d, /subcategory/, c);
  d.at(-1).subcategory = ''; fails(d, /subcategory/, c);
});

test('Czech summaries: one per record and no extra ones', () => {
  const c = clone(cs); delete c[records[0].id]; fails(records, /missing Czech summary/, c);
  fails(records, /has no record/, { ...cs, 'no-such-project': 'x' });
});

test('catalogue links point at existing catalogue entries', () => {
  for (const cid of Object.values(CATALOGUE)) assert.ok(catalogueIds.includes(cid), cid);
});

test('discipline: optional, one of bio|chem|phys|agro|desk|robotics when present; missing counts as robotics', () => {
  assert.deepEqual(DISCIPLINES, ['bio', 'chem', 'phys', 'agro', 'desk', 'robotics']);
  for (const r of records) if ('discipline' in r) assert.ok(DISCIPLINES.includes(r.discipline), r.id);
  for (const d of ['biology', 'Bio', '', null]) { const x = clone(records); x[0].discipline = d; fails(x, /discipline/); }
  const y = clone(records); delete y[0].discipline; assert.deepEqual(checkRegistry(y, cs), []);
  assert.equal(disciplineOf({}), 'robotics');
  // lab devices of the earlier batches got a field of use; robots did not
  for (const [id, d] of [['pioreactor', 'bio'], ['sidekick', 'bio'], ['digital-pipette', 'chem'], ['uc2', 'phys'], ['so-arm100-101', 'robotics'], ['jubilee', 'robotics']]) assert.equal(disciplineOf(records.find((r) => r.id === id)), d, id);
  // every field has records (the six census batches)
  for (const d of DISCIPLINES) assert.ok(records.some((r) => disciplineOf(r) === d), d);
});

test('discipline filter: every record carries data-disc, the select lists fields and their equipment types (CZ + EN)', () => {
  for (const L of ['cs', 'en']) {
    const html = renderRegistry(L, records, cs, '../../'), li = items(html);
    for (const r of records) assert.ok(li.find((x) => x.includes(`id="p-${r.id}"`)).includes(` data-disc="${disciplineOf(r)}"`), r.id);
    const sel = /<select name="disc">([\s\S]*?)<\/select>/.exec(html)[1];
    for (const d of DISCIPLINES) assert.match(sel, new RegExp(`<option value="${d}">${LABELS[L].disc[d]} \\(${records.filter((r) => disciplineOf(r) === d).length}\\)</option>`), d);
    assert.match(sel, /<option value="bio\/centrifuge">  · (Centrifugy|Centrifuges) \(2\)<\/option>/);
    // robots' subcategories stay under the category select, field types only under the field select
    const cat = /<select name="cat">([\s\S]*?)<\/select>/.exec(html)[1];
    assert.ok(cat.includes('value="wheeled/rc-car"') && !cat.includes('centrifuge') && !sel.includes('rc-car'));
  }
  assert.deepEqual(Object.keys(LABELS.cs.disc), DISCIPLINES);
  assert.deepEqual(Object.values(LABELS.cs.disc), ['Biologie', 'Chemie', 'Fyzika', 'Zemědělství', 'Stůl', 'Robotika']);
  assert.deepEqual(Object.values(LABELS.en.disc), ['Biology', 'Chemistry', 'Physics', 'Agriculture', 'Desktop', 'Robotics']);
});

test('subcategory labels: a Czech and an English label (filter + entry) for every slug used, none unused', () => {
  const used = new Set(records.filter((r) => r.subcategory).map((r) => r.subcategory));
  for (const s of used) {
    assert.ok(SUBCATS[s], `no label row for subcategory "${s}"`);
    assert.equal(SUBCATS[s].length, 4, s);
    for (const t of SUBCATS[s]) assert.ok(typeof t === 'string' && t.trim() && !/^[a-z0-9-]+$/.test(t) || /^[A-Z]/.test(t), `${s}: label "${t}" looks like a slug`);
  }
  for (const s of Object.keys(SUBCATS)) assert.ok(used.has(s), `label row for unused subcategory "${s}"`);
  for (const s of Object.keys(SUBCATS)) assert.match(s, /^[a-z0-9][a-z0-9-]*$/);
  // the entry shows "Biologie · Centrifuga" for a field-of-use record
  const li = items(renderRegistry('cs', records, cs, '../../')).find((x) => x.includes('id="p-polyfuge"'));
  assert.match(li, /<span class="mono">Biologie · Centrifuga<\/span>/);
  const en = items(renderRegistry('en', records, cs, '../../')).find((x) => x.includes('id="p-polyfuge"'));
  assert.match(en, /<span class="mono">Biology · Centrifuge<\/span>/);
});

test('dedupe: no project twice across the census batches; merged copies kept under merged_from', () => {
  const ids = new Set(records.map((r) => r.id));
  // duplicates found across the batches: the kept record holds the other copy whole
  for (const [keep, gone] of [['openpfge', 'openpfge'], ['mtu-rotator-mixer-shaker', 'most-rotator-mixer-shaker'], ['openhw3-shaker', 'openhw3-orbital-shaker'], ['smartphone-spectrophotometer-winters', 'bethel-smartphone-spectrophotometer']]) {
    const r = records.find((x) => x.id === keep);
    assert.ok(r && r.merged_from.some((m) => m.id === gone && m.summary_en && m.licenses), keep);
    if (gone !== keep) assert.ok(!ids.has(gone), gone);
  }
  // among the field-of-use records (the census batches), the same repository is not listed under two ids
  // (robot records may share one: an actuator and the robot built from it)
  const key = (u) => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  for (const k of ['repo']) {
    const seen = new Map();
    for (const r of records.filter((x) => disciplineOf(x) !== 'robotics')) {
      if (!r[k] || /^github\.com\/[^/]+$/.test(key(r[k]))) continue;
      assert.ok(!seen.has(key(r[k])) || seen.get(key(r[k])) === r.id, `${k} ${r[k]}: ${seen.get(key(r[k]))} and ${r.id}`);
      seen.set(key(r[k]), r.id);
    }
  }
  const d = clone(records); d.push({ ...clone(records.find((r) => r.id === 'openhw3-shaker').merged_from[0]), id: 'openhw3-orbital-shaker' });
  fails(d, /merged into another record/, { ...cs, 'openhw3-orbital-shaker': 'x' });
  // a fork links its original; the NC licence of the original is inherited
  const f = records.find((r) => r.id === 'mlab-peristaltic01'), o = records.find((r) => r.id === 'phisik-parametric-peristaltic-pump');
  assert.equal(f.fork_of, o.id);
  assert.equal(o.rights_class, 'nc'); assert.equal(f.rights_class, 'nc');
  assert.match(items(renderRegistry('cs', records, cs, '../../')).find((x) => x.includes('id="p-mlab-peristaltic01"')), /<a class="reg-fork" href="#p-phisik-parametric-peristaltic-pump">Odvozeno z projektu /);
  const g = clone(records); g.find((r) => r.id === 'mlab-peristaltic01').fork_of = 'no-such'; fails(g, /fork_of/);
  // Stack-chan links its catalogue card and agrees with its licence
  assert.equal(CATALOGUE['stack-chan'], 'stackchan');
  assert.equal(normLic(records.find((r) => r.id === 'stack-chan').licenses.hardware), normLic(catalogue.stackchan));
});
const normLic = (s) => String(s).replace(/\s*\(.*$/, '').toUpperCase();

test('gaps section: one line per field of use, Czech and English, same number of types', () => {
  assert.deepEqual(Object.keys(GAPS), ['bio', 'chem', 'phys', 'agro', 'desk']);
  for (const [d, g] of Object.entries(GAPS)) { assert.ok(g.cs.length > 0, d); assert.equal(g.cs.length, g.en.length, d); }
  for (const L of ['cs', 'en']) {
    const h = renderGaps(L);
    assert.equal((h.match(/<div><dt>/g) || []).length, 5);
    for (const d of Object.keys(GAPS)) assert.ok(h.includes(`<dt>${LABELS[L].disc[d]}</dt>`), d);
    const page = fs.readFileSync(`${ROOT}/tools/content/rejstrik.${L}.html`, 'utf8');
    assert.ok(page.includes('<!--registry-gaps-->') && page.includes(L === 'en' ? '>Gaps</h2>' : '>Bílá místa</h2>'), L);
  }
  assert.ok(GAPS.phys.en.includes('air track') && GAPS.chem.en.includes('pH meter'));
  // stirrers exist in the chemistry list, so they are not a gap in biology
  assert.ok(!GAPS.bio.en.includes('magnetic stirrer') && !GAPS.bio.cs.includes('magnetické míchadlo'));
  assert.ok(GAPS.bio.en.includes('sterilisers / autoclaves') && GAPS.agro.en.includes('insect farming (mealworms, black soldier fly)'));
});

test('hazard line: derived from equipment type and safety notes, shown in CZ and EN, only for tagged records', () => {
  const want = { electropen: ['hv'], 'ag3d-gel-toolkit': ['hv'], openpfge: ['hv'], 'laser-xy-scanner': ['laser'], 'openflexure-optical-tweezers': ['laser'],
    'psf-centrifuge-lecodevert': ['rotor'], 'maasi-spin-coater': ['rotor'], 'western-inert-gas-glovebox': ['gas'], 'geiger-counter-esp32-eink': ['hv', 'radiation'],
    'openhw3-shaker': ['mains'], 'gaudilabs-3d-fiber-spectrometer': [], 'grimgork-printed-optics-mounts': [], 'so-arm100-101': [], 'ender3-syringe-pumps': [] };
  for (const [id, tags] of Object.entries(want)) assert.deepEqual(hazardsOf(records.find((r) => r.id === id)), tags, id);
  const cz = items(renderRegistry('cs', records, cs, '../../')), en = items(renderRegistry('en', records, cs, '../../'));
  assert.match(cz.find((x) => x.includes('id="p-electropen"')), /<p class="reg-hz">Pozor: vysoké napětí — jen pod dohledem dospělého\.<\/p>/);
  assert.match(en.find((x) => x.includes('id="p-electropen"')), /<p class="reg-hz">Caution: high voltage — adult supervision only\.<\/p>/);
  assert.match(cz.find((x) => x.includes('id="p-geiger-counter-esp32-eink"')), /Pozor: vysoké napětí, zdroj záření — /);
  for (const r of records) assert.equal(cz.find((x) => x.includes(`id="p-${r.id}"`)).includes('class="reg-hz"'), hazardsOf(r).length > 0, r.id);
  // the page note gains the supervision sentence; the existing note text stays
  for (const [L, a, b] of [['cs', 'Mladší stavitelé patří pod dohled dospělého.', 'Hodnocení „škola“ předpokládá práci pod dohledem učitele.'], ['en', 'Younger builders should work with an adult.', 'The “school” rating assumes work under a teacher’s supervision.']]) {
    assert.ok(fs.readFileSync(`${ROOT}/tools/content/rejstrik.${L}.html`, 'utf8').includes(`${a} ${b}</span>`), L);
  }
});

test('licences the review downgraded: unknown with a rights_note; CERN OHL without a version only copyleft when certified before v2', () => {
  for (const id of ['isaac879-pan-tilt-slider', 'ugr-arduino-autotitrator', 'smartphone-spectrophotometer-winters']) {
    const r = records.find((x) => x.id === id); assert.equal(r.rights_class, 'unknown', id); assert.ok(r.rights_note, id);
  }
  for (const id of ['satnogs-rotator', 'openpfge']) {
    const r = records.find((x) => x.id === id);
    assert.equal(r.licenses.hardware, 'CERN OHL (version not stated)', id); assert.equal(r.rights_class, 'copyleft', id); assert.match(r.rights_note, /before CERN-OHL v2/, id);
  }
  for (const id of ['mulberry-3d-printed-qpcr', 'tuebingen-printed-flow-equipment', 'laser-xy-scanner', 'most-open-source-colorimeter']) assert.ok(records.find((x) => x.id === id).rights_note, id);
});
