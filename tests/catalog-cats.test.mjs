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

test('lab wording is data-driven: no electronics/software claims, magnet rule only for magnets', () => {
  const uc2 = CS.PR_ROBOTS.find((r) => r.id === 'uc2'), uc2en = EN.PR_ROBOTS.find((r) => r.id === 'uc2');
  assert.equal(uc2.noElectronics, true); assert.equal(uc2.noSoftware, true);
  const faq = CS.PR_FAQ(uc2).flat().join(' ');
  assert.ok(faq.includes('Můžu si sadu koupit u vás?') && faq.includes('Sestava obsahuje malé díly;'), 'lab FAQ');
  assert.ok(!/elektroniku|open-source a zdarma/.test(faq), 'no electronics / software claims');
  assert.ok(!CS.PR_SAFETY(uc2).some((w) => /napájejte/.test(w)) && !EN.PR_SAFETY(uc2en).some((w) => /Power the hardware/.test(w)), 'no power line');
  assert.ok(CS.PR_SAFETY(uc2).some((w) => /ihned vyhledejte lékaře/.test(w)) && EN.PR_SAFETY(uc2en).some((w) => /seek medical help/.test(w)));
  // non-lab kit keeps the robot wording and the power line
  const so = CS.PR_ROBOTS.find((r) => r.id === 'so101');
  assert.ok(CS.PR_FAQ(so).flat().join(' ').includes('Robot obsahuje malé díly a elektroniku'));
  assert.ok(CS.PR_SAFETY(so).some((w) => /napájejte/.test(w)));
  // magnet rule: not triggered by "magnetický enkodér"
  const fake = { id: 'x', cat: 'arm', bom: [['Magnetický enkodér AS5600', '1×']], specs: [], lead: 'Má magnetický enkodér.' };
  assert.ok(!CS.PR_SAFETY(fake).some((w) => /magnety/.test(w)), 'magnetický enkodér is not a loose magnet');
  assert.ok(CS.PR_SAFETY({ id: 'y', cat: 'lab', bom: [['Kuličkový magnet 5 mm', '32×']], specs: [], lead: '' }).some((w) => /magnety/.test(w)));
  // the catalogue heading counts robots and lab devices separately, from the data
  const nr = CS.PR_ROBOTS.filter((r) => r.cat !== 'lab').length, nl = CS.PR_ROBOTS.length - nr;
  assert.ok(read('index.html').includes(`<!--cat-h-->${nr} robotů a ${nl} laboratorní`), 'home catalogue heading');
  assert.ok(read('katalog/index.html').includes(`${nr} robotů a ${nl} laboratorní`), 'catalogue page heading');
});
