// Unit tests for the Project SVRN purchase plan: the same plan core (assets/plan/plan-core.mjs) as the SO-101,
// driven by data/components/svrn.json (configs, the module option, rule-based part checks, notes, safety, reviews).
// node --test tests/plan-svrn.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, checkData, checkPartVariant } from '../assets/plan/plan-core.mjs';

const read = (f) => JSON.parse(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const data = read('data/components/svrn.json');
const schema = read('data/components/svrn.schema.json');
const so101 = read('data/components/so101.json');
const clone = (x) => JSON.parse(JSON.stringify(x));
const lines = (p) => p.groups.flatMap((g) => g.lines);

test('svrn data passes the schema and cross-reference check', () => {
  assert.deepEqual(checkData(data, schema), []);
});

test('build check catches bad option lines, regexes, review signals and undated note sources', () => {
  const d = clone(data);
  d.options.module.values.flipper.lines[0].source = 'fls_mg90s';   // not recommended (needs a BEC)
  assert.ok(checkData(d, schema).some((e) => /option module=flipper.*do not recommend/.test(e)));
  const d2 = clone(data);
  d2.variants.checks.esc.good[0].re = '([';
  assert.ok(checkData(d2, schema).some((e) => /bad regex/.test(e)));
  const d3 = clone(data);
  d3.components[0].sources[0].reviews = { rating: 4, count: 0, checked: '2026-10-30', signals: [] };
  assert.ok(checkData(d3, schema).some((e) => /count 0/.test(e)));
  const d4 = clone(data);
  d4.components[0].sources[0].reviews = { rating: 4, count: 3, checked: '2026-10-30', signals: [{ type: 'rumour', note_cs: 'x', note_en: 'x' }] };
  assert.ok(checkData(d4, schema).length > 0);
  const d5 = clone(data);
  delete d5.safety[5].sources[0].checked;
  assert.ok(checkData(d5, schema).length > 0);
});

test('svrn plan: robot only, flipper, self-printed', () => {
  const p = buildPlan(data, { robot: 'robot_only', module: 'flipper', print: 'self' });
  const fx = data.meta.fx_czk_per_eur;
  // FLS (not a VAT payer, 129 Kč shipping): HV 34.98 + 4×7.79 + 2 packs of wheels 1.03 + switch 0.49 + JST 2×0.21 + wire 0.25 + screws 3.2 + PTK servo 11.08
  const fls = 34.98 + 4 * 7.79 + 2 * 1.03 + 0.49 + 0.42 + 0.25 + 3.2 + 11.08;
  const lipo = 259 / fx, fil = (70 / 1000) * 450 / fx;
  const lo = fls + 5.33 + lipo + 3 + fil, hi = fls + 5.33 + lipo + 5 + fil;
  assert.deepEqual(p.totals.landed_eur, [Math.floor(lo), Math.ceil(hi)]);
  assert.deepEqual(p.totals.landed_eur, [103, 106]);
  assert.deepEqual(p.options, { module: 'flipper' });
  assert.equal(p.robot_id, 'svrn');
  assert.equal(p.groups.find((g) => g.supplier === 'fls').tax_eur[1], 0, 'FLS is not a VAT payer: no OSS uplift');
  assert.deepEqual(p.eta_days, [2, 5]);
  assert.equal(p.checked.oldest, '2026-10-29');
  // the controller is the HV: 4× N10 is beyond the standard Nano (one N10 per channel)
  const ctrl = lines(p).find((l) => l.component.startsWith('svrn.ctrl'));
  assert.equal(ctrl.component, 'svrn.ctrl.malenki_nano_hv');
  assert.equal(lines(p).find((l) => l.component === 'svrn.motor.n10').qty, 4);
  assert.equal(lines(p).find((l) => l.component === 'svrn.wheels').packs, 2, '4 wheels = 2 packs of 2');
  assert.ok(lines(p).some((l) => l.component === 'svrn.servo'));
  assert.equal(p.variants.length, 0);
  assert.deepEqual(p.checks.map((c) => c.id), ['esc', 'motor', 'servo', 'lipo']);
  assert.ok(p.tools.some((t) => t.id === 'tx_own'), 'robot only: says a transmitter and charger are needed');
  assert.ok(!p.arrivals.some((a) => a.id === 'tx'));
  for (const l of lines(p)) { assert.match(l.url, /^https:\/\//); assert.match(l.checked, /^\d{4}-\d\d-\d\d$/); assert.ok(l.status); }
  assert.equal(p.affiliate_links, false);
});

test('svrn plan: modules and the starter config', () => {
  const flip = buildPlan(data, { robot: 'robot_only', module: 'flipper' });
  const wedge = buildPlan(data, { robot: 'robot_only', module: 'wedge' });
  const grab = buildPlan(data, { robot: 'robot_only', module: 'grabber' });
  assert.ok(!lines(wedge).some((l) => l.component === 'svrn.servo'), 'the wedge has no servo');
  assert.ok(lines(grab).some((l) => l.component === 'svrn.servo'));
  assert.ok(wedge.totals.landed_eur[0] < flip.totals.landed_eur[0]);
  assert.ok(!wedge.notes.some((n) => n.id === 'servo_bec') && flip.notes.some((n) => n.id === 'servo_bec'));
  assert.ok(!wedge.arrivals.some((a) => a.id === 'servo'));
  const st = buildPlan(data, { robot: 'starter', module: 'flipper' });
  assert.deepEqual(st.totals.landed_eur, [241, 248]);
  assert.ok(lines(st).some((l) => l.component === 'svrn.tx.fsi6x') && lines(st).some((l) => l.component === 'svrn.charger'));
  assert.ok(st.arrivals.some((a) => a.id === 'tx') && !st.tools.some((t) => t.id === 'tx_own'));
  // the charger must go down to 1C for the 300 mAh pack; fixed 1.2 A chargers are flagged, not recommended
  const ch = lines(st).find((l) => l.component === 'svrn.charger');
  assert.match(ch.name, /0\.1/);
  assert.ok(ch.alternatives.some((a) => /e3/.test(a.label) && !a.recommend && a.flag));
  const svc = buildPlan(data, { robot: 'robot_only', print: 'service' });
  assert.deepEqual(svc.groups.find((g) => g.supplier === 'print_service').goods_eur, [15, 40]);
  assert.throws(() => buildPlan(data, { robot: 'robot_only', module: 'spinner' }), RangeError);
  assert.throws(() => buildPlan(data, { robot: 'pair' }), RangeError);
});

test('svrn plan: safety, LiPo shipping finding, verify notes and reviews', () => {
  const p = buildPlan(data, {});
  assert.equal(p.robot, 'robot_only', 'first config is the default');
  assert.deepEqual(p.safety.map((s) => s.id), ['not_toy', 'supervision', 'lipo_handling', 'lipo_charging', 'lipo_storage', 'lipo_shipping']);
  const ship = p.safety.find((s) => s.id === 'lipo_shipping');
  assert.equal(ship.level, 'verify', 'domestic carrier rules could not be verified');
  assert.ok(ship.sources.some((s) => /zasilkovna\.cz/.test(s.url)) && ship.sources.some((s) => /ceskaposta\.cz/.test(s.url)));
  assert.match(p.safety[0].title_cs, /Není to hračka/);
  assert.ok(p.notes.find((n) => n.id === 'esc_hv').sources.some((s) => /bristolbotbuilders/.test(s.url)));
  // reviews: summarised by us; 0 reviews on the FLS listing, unreadable at Rotorama
  const hv = lines(p).find((l) => l.component === 'svrn.ctrl.malenki_nano_hv');
  assert.deepEqual([hv.reviews.count, hv.reviews.rating, hv.reviews.signals.length], [0, null, 0]);
  const st = buildPlan(data, { robot: 'starter' });
  const ch = lines(st).find((l) => l.component === 'svrn.charger');
  assert.equal(ch.reviews.count, null);
  // a variant_mismatch signal becomes a plan warning
  const d = clone(data);
  d.components.find((c) => c.id === 'svrn.motor.n10').sources[0].reviews = { rating: 3.5, count: 4, checked: '2026-10-30', signals: [{ type: 'variant_mismatch', note_cs: 'dorazily jiné otáčky', note_en: 'wrong rpm arrived' }] };
  assert.ok(buildPlan(d, {}).warnings.some((w) => w.flag === 'reviews_variant_mismatch'));
});

test('svrn part checks: controller, motors, servo, LiPo', () => {
  const v = (t, e) => checkPartVariant(data, t, e).verdict;
  assert.equal(v('Malenki Nano HV, 2-4S, 3A per channel', 'svrn:esc'), 'match');
  assert.equal(v('Malenki Nano 1-2S dual ESC + receiver', 'esc'), 'mismatch');
  assert.equal(v('Malenki-Nano AFHDS 2A', 'svrn:esc'), 'mismatch');
  assert.equal(v('N10 DC motor with gearbox 6V 1000 rpm', 'svrn:motor'), 'match');
  assert.equal(v('N20 gearmotor 6V 300rpm', 'svrn:motor'), 'mismatch');
  assert.equal(v('N10 3V 1080rpm', 'svrn:motor'), 'check_selection');
  assert.ok(checkPartVariant(data, 'N10 motor 1000 rpm / 600 rpm', 'svrn:motor').warnings.length, 'several rpm options');
  assert.equal(v('PTK 7462W MG servo 4.8-8.4V', 'svrn:servo'), 'match');
  assert.equal(v('MG90S servo 4.8-6V metal gears', 'svrn:servo'), 'mismatch');
  assert.equal(v('KingMax C507 servo', 'svrn:servo'), 'unknown');
  assert.equal(v('Gens ace LiPo 7.4V 300mAh 2S JST-SYP', 'svrn:lipo'), 'match');
  assert.equal(v('LiPo 3S 11.1V 300mAh', 'svrn:lipo'), 'mismatch');
  assert.equal(v('LiPo 1S 3.7V 300mAh', 'svrn:lipo'), 'mismatch');
  const xt = checkPartVariant(data, 'Tattu 450mAh 2S1P 75C XT30 LiPo', 'svrn:lipo');
  assert.equal(xt.verdict, 'match');
  assert.equal(xt.warnings.length, 1, 'XT30 plug flagged (450 mAh stays under the size warning)');
  const m = checkPartVariant(data, 'Malenki Nano 1-2S', 'svrn:esc');
  assert.match(m.advice_cs, /Standardní Malenki Nano/);
  assert.equal(m.ok, false);
  assert.throws(() => checkPartVariant(data, 'x', 'svrn:wheel'), RangeError);
  // the SO-101 checker is unchanged by the generalisation
  assert.equal(checkPartVariant(so101, 'Feetech STS3215 C001 7.4V 1/191', 'leader:2').verdict, 'inconsistent');
});

test('svrn page exists in both languages and the catalogue lists the HV controller', () => {
  for (const f of ['plan/svrn/index.html', 'en/plan/svrn/index.html']) {
    const html = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.match(html, /data-robot="svrn"/);
    assert.match(html, /printables\.com\/model\/1272536/);
  }
  assert.match(fs.readFileSync(new URL('../assets/data.js', import.meta.url), 'utf8'), /\['Malenki Nano HV \(přijímač \+ regulátory\)', '1×'\]/);
  assert.match(fs.readFileSync(new URL('../assets/data.en.js', import.meta.url), 'utf8'), /\['Malenki Nano HV \(receiver \+ speed controllers\)', '1×'\]/);
});
