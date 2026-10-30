// Licence -> rights derivation (assets/data.js PR_LICENSE_CLASS / PR_DERIVE_RIGHTS) and its use on the catalogue,
// the showcase entry, the arena robots and the purchase-plan data. node --test tests/rights.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
function load(lang) {
  const ctx = { window: {} };
  vm.runInNewContext(read('assets/data.js'), ctx);
  if (lang === 'en') { vm.runInNewContext(read('assets/data.en.js'), ctx); ctx.window.PR_EN_APPLY(); }
  return ctx.window;
}
const W = load('cs');
const cls = W.PR_LICENSE_CLASS, derive = W.PR_DERIVE_RIGHTS;
const KEYS = ['sell_prints', 'sell_kits', 'renders_from_cad', 'accessories', 'guide', 'plan'];
const pick = (r) => Object.fromEntries(KEYS.map((k) => [k, r[k]]));
const byId = (id) => W.PR_ROBOTS.find((r) => r.id === id);

test('licence ids map to classes', () => {
  for (const id of ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'CC-BY-4.0', 'CC BY 4.0', 'CERN-OHL-P-2.0', 'CC0-1.0']) assert.equal(cls(id), 'permissive', id);
  for (const id of ['GPL-3.0', 'GPL-3.0-only', 'LGPL-2.1', 'AGPL-3.0', 'CC-BY-SA-4.0', 'CC BY-SA 4.0', 'CERN-OHL-W-2.0', 'CERN-OHL-S-2.0', 'MPL-2.0']) assert.equal(cls(id), 'copyleft', id);
  for (const id of ['CC-BY-NC-4.0', 'CC BY-NC-SA 4.0', 'CC-BY-NC-ND-4.0']) assert.equal(cls(id), 'nc', id);
  assert.equal(cls('CC-BY-ND-4.0'), 'nd');
  assert.equal(cls('LicenseRef-proprietary'), 'proprietary');
  assert.equal(cls('own'), 'own');
  for (const id of ['', null, '—', 'CC BY (Thingiverse)', 'WTFPL-ish']) assert.equal(cls(id), 'unknown', String(id));
});

test('derivation table per licence class', () => {
  const all = (v) => Object.fromEntries(KEYS.map((k) => [k, v]));
  assert.deepEqual(pick(derive({ hw: 'MIT', sw: 'Apache-2.0' })), all('yes'));
  assert.deepEqual(pick(derive({ hw: 'own' })), all('yes'));
  assert.deepEqual(pick(derive({ hw: 'CC-BY-SA-4.0' })), { sell_prints: 'conditions', sell_kits: 'conditions', renders_from_cad: 'conditions', accessories: 'yes', guide: 'yes', plan: 'yes' });
  assert.deepEqual(pick(derive({ hw: 'CC-BY-NC-4.0' })), { sell_prints: 'no', sell_kits: 'no', renders_from_cad: 'no', accessories: 'yes', guide: 'yes', plan: 'yes' });
  assert.deepEqual(pick(derive({ hw: 'CC-BY-ND-4.0' })), { sell_prints: 'conditions', sell_kits: 'conditions', renders_from_cad: 'ask', accessories: 'yes', guide: 'yes', plan: 'yes' });
  assert.deepEqual(pick(derive({ hw: 'LicenseRef-proprietary' })), { sell_prints: 'no', sell_kits: 'no', renders_from_cad: 'no', accessories: 'yes', guide: 'yes', plan: 'yes' });
  assert.deepEqual(pick(derive({})), { sell_prints: 'ask', sell_kits: 'ask', renders_from_cad: 'ask', accessories: 'yes', guide: 'yes', plan: 'yes' });
  // kit = hardware AND shipped software/policy: permissive hardware with GPL firmware sells only with conditions
  assert.equal(derive({ hw: 'MIT', sw: 'GPL-3.0' }).sell_kits, 'conditions');
  assert.equal(derive({ hw: 'MIT', sw: 'GPL-3.0' }).sell_prints, 'yes');
  assert.equal(derive({ hw: 'MIT', sw: 'MIT', policy: 'CC-BY-NC-4.0' }).sell_kits, 'no');
  // unconfirmed between two licences: the stricter one decides
  assert.equal(derive({ hw: ['CC-BY-SA-4.0', 'CC-BY-NC-SA-4.0'] }).sell_prints, 'no');
  assert.equal(derive({ hw: ['MIT', 'CC-BY-SA-4.0'] }).class, 'copyleft');
  assert.equal(derive({ hw: 'MIT', status: 'verified' }).unverified, false);
  assert.equal(derive({ hw: 'MIT' }).unverified, true);
});

test('applied to SO-101, LeKiwi, SVRN, spinner, Kosa, Klepeto with sources', () => {
  for (const id of ['so101', 'lekiwi']) {
    const r = byId(id);
    assert.equal(r.license.status, 'verified', id);
    assert.ok(r.license.sources.every((u) => /^https:\/\/github\.com\//.test(u)), id);
    assert.deepEqual(pick(r.rights), pick(derive({ hw: 'Apache-2.0', sw: 'Apache-2.0' })), id);
    assert.equal(r.rights.unverified, false);
  }
  const svrn = byId('svrn');
  assert.equal(svrn.rights.class, 'permissive'); assert.equal(svrn.rights.unverified, true);
  const spin = byId('vert150');
  assert.deepEqual([spin.rights.class, spin.rights.sell_prints, spin.rights.sell_kits], ['nc', 'no', 'no']);
  for (const id of ['kosa', 'klepeto']) {
    const a = W.PR_ARENA_LICENSES[id];
    assert.equal(a.rights.class, 'own'); assert.equal(a.rights.sell_kits, 'yes');
    assert.ok(read(a.sources[0]).includes('original design, printedrobotics.cz, CC BY 4.0'), id);
  }
  for (const r of W.PR_ROBOTS) {
    assert.ok(r.rights && KEYS.every((k) => ['yes', 'conditions', 'no', 'ask'].includes(r.rights[k])), r.id);
    if (r.license) { assert.ok(r.license.sources.length && /^\d{4}-\d\d-\d\d$/.test(r.license.checked), r.id); }
  }
});

test('ROBOTO ORIGIN showcase: copyleft hardware, trademark flag, no buy path', () => {
  const o = W.PR_SHOWCASE.find((r) => r.id === 'origin');
  assert.equal(o.showcase, true); assert.equal(o.buy, false);
  assert.ok(!W.PR_ROBOTS.some((r) => r.id === 'origin'), 'not a catalogue kit (no kit page, no order form)');
  assert.equal(o.license.hw, 'CERN-OHL-W-2.0'); assert.equal(o.license.sw, 'GPL-3.0-only');
  assert.deepEqual(pick(o.rights), { sell_prints: 'conditions', sell_kits: 'conditions', renders_from_cad: 'conditions', accessories: 'yes', guide: 'yes', plan: 'yes' });
  assert.equal(o.rights.trademark, true);
  assert.ok(o.specs.every((s) => s.length === 3 && s[2]), 'every spec names its upstream source');
  assert.match(o.upstream.commit, /^[0-9a-f]{40}$/);
  const en = load('en').PR_SHOWCASE.find((r) => r.id === 'origin');
  assert.equal(en.specs.length, o.specs.length);
  assert.equal(JSON.stringify(en.specs.map((s) => s[2])), JSON.stringify(o.specs.map((s) => s[2])));
  assert.equal(JSON.stringify(pick(en.rights)), JSON.stringify(pick(o.rights)));
  assert.ok(!/[ěščřžýáíéůú]/i.test(en.lead + en.short + en.specs.map((s) => s[0] + s[1]).join('')), 'English text has no Czech');
});

test('purchase-plan data carries the same licence as the catalogue', () => {
  for (const id of ['so101', 'svrn']) {
    const meta = JSON.parse(read(`data/components/${id}.json`)).meta, r = byId(id);
    assert.equal(meta.license.hw, r.license.hw, id);
    assert.equal(meta.license.sw, r.license.sw, id);
    assert.equal(meta.license.status, r.license.status, id);
    assert.deepEqual(pick(derive(meta.license)), pick(r.rights), id);
  }
});
