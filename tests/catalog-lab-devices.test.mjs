// Lab devices Sidekick and Poseidon: category, model, renders, credits, licence and lab safety notes in both languages.
// node --test tests/catalog-lab-devices.test.mjs   (part of npm run test:unit)
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
const IDS = { sidekick: 'copyleft', poseidon: 'permissive' };

test('Sidekick and Poseidon are lab kits with model, renders, credit and verified licence', () => {
  assert.equal(CS.PR_CATS.lab, 'Laboratoř'); assert.equal(EN.PR_CATS.lab, 'Lab');
  const notice = read('models/NOTICE.txt');
  for (const [id, cls] of Object.entries(IDS)) {
    const r = CS.PR_ROBOTS.find((x) => x.id === id);
    assert.ok(r, id); assert.equal(r.cat, 'lab'); assert.ok(!r.sim, id + ': no simulation');
    assert.ok(r.glb && exists(`models/${id}.glb`), id + ' glb');
    for (const c of CS.PR_COLORS) assert.ok(exists(`img/${id}_${c.id}.jpg`), `${id}_${c.id}.jpg`);
    assert.equal(r.license.status, 'verified'); assert.equal(r.rights.class, cls, id);
    assert.ok(notice.includes(`${id}.glb`), id + ' credited in models/NOTICE.txt');
    for (const k of ['short', 'lead', 'alt', 'type', 'credit']) assert.notEqual(EN.PR_ROBOTS.find((x) => x.id === id)[k], r[k], `${id}.${k} translated`);
    assert.ok(r.related.every((x) => CS.PR_ROBOTS.some((y) => y.id === x)), id + ' related ids exist');
  }
});

test('lab safety notes are keyed on flags: liquids (sidekick, poseidon), syringe (poseidon only)', () => {
  const by = (W, id) => W.PR_ROBOTS.find((x) => x.id === id);
  assert.ok(by(CS, 'sidekick').liquids && by(CS, 'poseidon').liquids && by(CS, 'poseidon').syringe && !by(CS, 'sidekick').syringe);
  for (const [W, liq, pres] of [[CS, /kapalin/, /tlak/], [EN, /liquids/, /pressure/]]) {
    const notes = (id) => (by(W, id) ? W.PR_SAFETY(by(W, id)) : []);
    assert.ok(notes('sidekick').some((w) => liq.test(w)) && notes('poseidon').some((w) => liq.test(w)), 'liquids note');
    assert.ok(notes('poseidon').some((w) => pres.test(w)), 'syringe pressure note');
    assert.ok(!notes('sidekick').some((w) => pres.test(w)), 'no syringe note on Sidekick');
    for (const id of ['so101', 'uc2']) {
      assert.ok(!notes(id).some((w) => liq.test(w) || pres.test(w)), id + ' has neither lab note');
    }
  }
});
