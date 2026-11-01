// OpenFlexure Microscope (lab): model with named parts, renders, NOTICE credit (CERN-OHL-S-2.0), licence and safety in both languages.
// node --test tests/catalog-openflexure.test.mjs   (part of npm run test:unit)
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
const cs = CS.PR_ROBOTS.find((x) => x.id === 'openflexure'), en = EN.PR_ROBOTS.find((x) => x.id === 'openflexure');

test('OpenFlexure is a lab kit with model, renders, copyleft licence and translated copy', () => {
  assert.ok(cs && en); assert.equal(cs.cat, 'lab'); assert.ok(!cs.sim, 'no simulation');
  assert.ok(cs.glb && exists('models/openflexure.glb'));
  assert.ok(fs.statSync(new URL('../models/openflexure.glb', import.meta.url)).size < 600 * 1024, 'GLB under 600 KB');
  for (const c of CS.PR_COLORS) assert.ok(exists(`img/openflexure_${c.id}.jpg`), c.id);
  assert.equal(cs.license.status, 'verified'); assert.equal(cs.rights.class, 'copyleft');
  for (const k of ['short', 'lead', 'alt', 'type', 'credit', 'software', 'sw']) assert.notEqual(en[k], cs[k], k + ' translated');
  assert.equal(en.bom.length, cs.bom.length); assert.equal(en.specs.length, cs.specs.length);
  assert.ok(!CS.PR_NO_SW(cs), 'not presented as an RC device without software');
  assert.ok(cs.related.every((x) => CS.PR_ROBOTS.some((y) => y.id === x)));
});

test('GLB has a named node per part and NOTICE meets CERN-OHL-S-2.0', () => {
  const glb = fs.readFileSync(new URL('../models/openflexure.glb', import.meta.url));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  const names = new Set(json.nodes.map((n) => n.name));
  for (const n of ['main_body', 'stand', 'optics_module', 'condenser', 'motor_x', 'motor_y', 'motor_z', 'raspberry_pi', 'camera']) assert.ok(names.has(n), n);
  const notice = read('models/NOTICE.txt');
  const i = notice.indexOf('openflexure.glb'); assert.ok(i >= 0);
  const block = notice.slice(i, i + 2600).replace(/\s+/g, ' ');
  for (const s of ['Richard Bowman', 'https://ohwr.org/cern_ohl_s_v2.txt', 'Modified 2026-11-01', 'Upstream source location',
    'Source location of this modified file', 'same licence, CERN-OHL-S-2.0']) assert.ok(block.includes(s), s);
});

test('safety: electronics power note, no liquids/syringe/magnet notes', () => {
  for (const [W, r, pow, other] of [[CS, cs, /napájejte/, /kapalin|tlak|magnet/], [EN, en, /Power the hardware/, /liquids|pressure|magnet/]]) {
    const w = W.PR_SAFETY(r);
    assert.ok(w.some((x) => pow.test(x)), 'power note'); assert.ok(!w.some((x) => other.test(x)), 'no unrelated lab notes');
  }
});
