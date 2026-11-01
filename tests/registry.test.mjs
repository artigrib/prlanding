// Registry of open projects (data/registry, tools/registry.mjs): record check and the rendered list.
// node --test tests/registry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CATEGORIES, RIGHTS, CATALOGUE, LABELS, checkRegistry, hiddenFields, loadRegistry, renderRegistry } from '../tools/registry.mjs';

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
  d.push({ ...clone(records.find((r) => r.category === 'wheeled')), id: 'test-rc-car', name: 'Test RC car', subcategory: 'rc-car' });
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
