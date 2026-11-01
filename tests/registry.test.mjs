// Registry of open projects (data/registry, tools/registry.mjs): record check and the rendered list.
// node --test tests/registry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CATEGORIES, RIGHTS, CATALOGUE, LABELS, checkRegistry, loadRegistry, renderRegistry } from '../tools/registry.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { records, cs } = loadRegistry(ROOT);
const clone = (x) => JSON.parse(JSON.stringify(x));
const catalogueIds = (() => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(`${ROOT}/assets/data.js`, 'utf8'), ctx);
  return [...ctx.window.PR_ROBOTS, ...(ctx.window.PR_SHOWCASE || [])].map((r) => r.id);
})();
const fails = (recs, re, c = cs) => assert.ok(checkRegistry(recs, c).some((e) => re.test(e)), `expected an error matching ${re}`);

test('data passes the check (ids, categories, rights, sources, Czech summaries, catalogue links)', () => {
  assert.deepEqual(checkRegistry(records, cs, catalogueIds), []);
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
  for (const [hw, cls] of [['unknown', 'permissive'], ['none stated (no LICENSE file in repo)', 'copyleft'], ['see upkie_parts repo', 'nc'], ['unknown (Thingiverse, not checked)', 'proprietary']]) {
    const d = clone(records); d[0].licenses.hardware = hw; d[0].rights_class = cls;
    fails(d, /use "unknown"/);
  }
});

test('rendered list: unknown rights show "Licence neuvedena" / "No licence stated", never a licensed badge', () => {
  for (const L of ['cs', 'en']) {
    const html = renderRegistry(L, records, cs, '../../');
    const items = [...html.matchAll(/<li class="reg-i"[\s\S]*?<\/li>/g)].map((m) => m[0]);
    assert.equal(items.length, records.length);
    for (const r of records) {
      const li = items.find((x) => x.includes(`id="p-${r.id}"`));
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
  assert.match(html, /Robot na kolech · rc car/);
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
