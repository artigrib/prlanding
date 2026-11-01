// Catalogue categories: every kit and showcase sits in a category that has a CZ and EN name and a filter button
// on the home page (assets/app.js FILTERS), and each kit's renders and 3D model exist.
// node --test tests/catalog-cats.test.mjs   (part of npm run test:unit)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const exists = (f) => fs.existsSync(new URL('../' + f, import.meta.url));
function load(lang) {
  const ctx = { window: {} };
  vm.runInNewContext(read('assets/data.js'), ctx);
  if (lang === 'en') { vm.runInNewContext(read('assets/data.en.js'), ctx); ctx.window.PR_EN_APPLY(); }
  return ctx.window;
}
const CS = load('cs'), EN = load('en');
const filterIds = [...read('assets/app.js').match(/var FILTERS = (\[[^\n]*\]);/)[1].matchAll(/\['(\w+)', '[^']*'\]/g)].map((m) => m[1]);
const i18n = read('assets/i18n.en.js');

test('every category has a CZ and EN name and a home filter', () => {
  assert.deepEqual(Object.keys(EN.PR_CATS).sort(), Object.keys(CS.PR_CATS).sort());
  for (const [k, cs] of Object.entries(CS.PR_CATS)) {
    assert.ok(filterIds.includes(k), 'filter for ' + k);
    assert.notEqual(EN.PR_CATS[k], cs, 'EN name for ' + k);
    assert.ok(i18n.includes(`'${cs}': '${EN.PR_CATS[k]}'`), 'i18n.en.js string for ' + cs);
  }
  for (const r of CS.PR_ROBOTS.concat(CS.PR_SHOWCASE || [])) assert.ok(CS.PR_CATS[r.cat], r.id + ': unknown category ' + r.cat);
});

test('lab category: UC2 with model, renders and verified licence', () => {
  assert.equal(CS.PR_CATS.lab, 'Laboratoř'); assert.equal(EN.PR_CATS.lab, 'Lab');
  const lab = CS.PR_ROBOTS.filter((r) => r.cat === 'lab');
  assert.ok(lab.some((r) => r.id === 'uc2'));
  for (const r of lab) {
    assert.ok(!r.sim, r.id + ': lab devices have no simulation');
    assert.ok(r.glb && exists(`models/${r.id}.glb`), r.id + ' glb');
    for (const c of CS.PR_COLORS) assert.ok(exists(`img/${r.id}_${c.id}.jpg`), `${r.id}_${c.id}.jpg`);
    assert.equal(r.license.status, 'verified', r.id);
    assert.ok(read('models/NOTICE.txt').includes(`${r.id}.glb`), r.id + ' credited in models/NOTICE.txt');
  }
  const uc2 = CS.PR_ROBOTS.find((r) => r.id === 'uc2');
  assert.equal(uc2.rights.class, 'copyleft');
  assert.ok(CS.PR_SAFETY(uc2).some((w) => /magnet/i.test(w)), 'magnet warning (CZ)');
  assert.ok(EN.PR_SAFETY(EN.PR_ROBOTS.find((r) => r.id === 'uc2')).some((w) => /magnet/i.test(w)), 'magnet warning (EN)');
});
