// Unit tests for the SO-101 purchase plan core (assets/plan/plan-core.mjs) and its data file.
// node --test tests/plan-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, buildTime, checkData, checkPartVariant, parseListing, validateSchema } from '../assets/plan/plan-core.mjs';
import { checkComponents } from '../tools/check-components.mjs';

const read = (f) => JSON.parse(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const data = read('data/components/so101.json');
const schema = read('data/components/so101.schema.json');
const clone = (x) => JSON.parse(JSON.stringify(x));

test('data file passes the schema and cross-reference check', () => {
  assert.deepEqual(checkData(data, schema), []);
  assert.deepEqual(checkComponents(new URL('../data/components', import.meta.url).pathname), []);
});

test('build check fails on a source without URL or checked date', () => {
  const d = clone(data);
  delete d.components[0].sources[0].url;
  assert.ok(checkData(d, schema).some((e) => /missing "url"/.test(e)));
  const d2 = clone(data);
  d2.components[1].sources[0].checked = '';
  assert.ok(checkData(d2, schema).some((e) => /checked/.test(e)));
  const d3 = clone(data);
  d3.components[1].sources[0].status = 'probably';
  assert.ok(checkData(d3, schema).length > 0);
});

test('a mislabeled source cannot be recommended or used by a plan', () => {
  const d = clone(data);
  const c001 = d.components.find((c) => c.id === 'so101.servo.c001');
  const bad = c001.sources.find((s) => s.flag === 'mislabeled');
  assert.ok(bad, 'OpenELAB C001 listing is flagged');
  assert.equal(bad.supplier, 'openelab');
  assert.equal(bad.recommend, false);
  bad.recommend = true;
  assert.ok(checkData(d, schema).some((e) => /mislabeled/.test(e)));
  const d2 = clone(data);
  d2.configs.pair.lines.find((l) => l.component === 'so101.servo.c001').source = 'openelab';
  assert.ok(checkData(d2, schema).some((e) => /do not recommend/.test(e)));
});

test('schema validator: types, enums, patterns, refs', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { $ref: '#/$defs/d' }, b: { enum: [1, 2] } }, $defs: { d: { type: 'string', pattern: '^x' } } };
  assert.deepEqual(validateSchema(s, { a: 'xy', b: 1 }), []);
  assert.equal(validateSchema(s, { a: 'y', b: 3 }).length, 2);
  assert.equal(validateSchema(s, {}).length, 1);
});

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test('plan totals: follower 12 V, self-printed', () => {
  const p = buildPlan(data, { robot: 'follower_12v', print: 'self' });
  // goods: 6×26.45 + 5.95 + 11.99 (Eckstein) + 199 Kč (Alza) + 179 Kč (Hornbach, pack of 2) + filament 350 g × 450 Kč/kg
  const fx = data.meta.fx_czk_per_eur;
  const goods = 6 * 26.45 + 5.95 + 11.99 + 199 / fx + 179 / fx + (0.35 * 450) / fx;
  assert.ok(Math.abs(p.totals.goods_eur[0] - goods) < 0.05, `${p.totals.goods_eur[0]} vs ${goods}`);
  // landed = goods + shipping (Eckstein 8–15, Alza 0–3, Hornbach 0–4) + up to 1.7 % OSS VAT on the Eckstein part
  const eck = 6 * 26.45 + 5.95 + 11.99;
  const lo = goods + 8, hi = goods + eck * 0.017 + 15 + 3 + 4;
  assert.deepEqual(p.totals.landed_eur, [Math.floor(lo), Math.ceil(hi)]);
  assert.deepEqual(p.totals.landed_eur, [206, 224]);
  assert.deepEqual(p.totals.landed_czk, [5000, 5420]);
  assert.equal(Math.round(sum(p.groups.map((g) => g.landed_eur[0]))), Math.round(lo));
  assert.deepEqual(p.eta_days, [21, 28], 'C018 backorder sets the ETA');
  assert.equal(p.checked.oldest, '2026-10-30');
  assert.ok(p.groups.find((g) => g.supplier === 'hornbach').lines[0].packs === 1, '2 clamps = 1 pack of 2');
  assert.deepEqual(p.variants.map((v) => v.arm), ['follower_12v']);
  assert.ok(p.tools.some((t) => t.id === 'printer'));
  assert.equal(p.affiliate_links, false);
});

test('plan totals: pair, self-printed and print service', () => {
  const p = buildPlan(data, { robot: 'pair', print: 'self' });
  assert.deepEqual(p.totals.landed_eur, [388, 413]);
  assert.deepEqual(p.variants.map((v) => v.arm), ['follower_12v', 'leader']);
  const servos = p.groups.flatMap((g) => g.lines).filter((l) => /servo\.c0/.test(l.component));
  assert.equal(sum(servos.map((l) => l.qty)), 12);
  assert.ok(p.alternative && /seeed/.test(p.alternative.component));
  const s = buildPlan(data, { robot: 'pair', print: 'service' });
  const ps = s.groups.find((g) => g.supplier === 'print_service');
  assert.deepEqual(ps.goods_eur, [60, 150], '2 arms × 30–75 € estimate');
  assert.ok(!s.groups.some((g) => g.supplier === 'self_print'));
  assert.ok(!s.tools.some((t) => t.id === 'printer'), 'no printer needed with a print service');
  assert.ok(s.totals.landed_eur[0] > p.totals.landed_eur[0]);
  // every priced line links to a source with a date and status
  for (const g of p.groups) for (const l of g.lines) { assert.match(l.url, /^https:\/\//); assert.match(l.checked, /^\d{4}-\d\d-\d\d$/); assert.ok(l.status); }
});

test('default plan is the standard pair; follower 7.4 V and 12 V configs both exist', () => {
  const p = buildPlan(data, {});
  assert.equal(p.robot, 'pair_74v');
  assert.deepEqual(p.variants.map((v) => [v.arm, v.voltage_v]), [['follower_74v', 7.4], ['leader', 7.4]]);
  const servos = p.groups.flatMap((g) => g.lines).filter((l) => /servo\.c0/.test(l.component));
  assert.equal(sum(servos.filter((l) => l.component === 'so101.servo.c001').map((l) => l.qty)), 7, '6 follower + 1 leader C001');
  assert.ok(!p.groups.flatMap((g) => g.lines).some((l) => l.component === 'so101.psu_12v'), 'no 12 V supply in a 7.4 V pair');
  assert.equal(p.groups.flatMap((g) => g.lines).find((l) => l.component === 'so101.psu_5v').qty, 2);
  const f = buildPlan(data, { robot: 'follower_74v' });
  assert.deepEqual(f.variants[0].joints.map((j) => j.codes), Array(6).fill(['C001']));
  assert.deepEqual(f.totals.landed_eur, [191, 209]);
  assert.equal(checkPartVariant(data, 'STS3215-C001 7.4V 1/345', 'follower_74v:3').verdict, 'match');
  assert.equal(checkPartVariant(data, 'STS3215-C018 12V 1/345', 'follower_74v').verdict, 'mismatch');
});

test('screw table: per joint and per arm, one source for plan, guide and checklist', () => {
  const p = buildPlan(data, { robot: 'pair_74v' });
  assert.deepEqual(p.screws.arms.map((a) => [a.kind, a.m2, a.m3]), [['follower', 24, 50], ['leader', 25, 46]]);
  assert.deepEqual(p.screws.total, { m2: 49, m3: 96 });
  assert.equal(p.screws.included, 'unverified', 'screws with the servos are not confirmed');
  assert.equal(buildPlan(data, { robot: 'follower_12v' }).screws.total.m3, 50);
  assert.match(p.notes.find((n) => n.id === 'screws').text_cs, /follower 24× M2×6 a až 50× M3×6/);
  // the guide and the checklist are generated from the same table (tools/build.mjs {sc:…})
  for (const f of ['navody/so101-sestaveni/index.html', 'en/guides/so101-assembly/index.html']) {
    const g = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.match(g, /data-testid="screw-table"/, f);
    assert.match(g, /<td><b>24<\/b><\/td><td><b>50<\/b><\/td><td><b>25<\/b><\/td><td><b>46<\/b><\/td>/, f);
  }
  assert.match(fs.readFileSync(new URL('../navody/so101-sestaveni/kontrolni-seznam/index.html', import.meta.url), 'utf8'), /follower 24× M2×6 a 50× M3×6/);
  assert.match(fs.readFileSync(new URL('../en/guides/so101-assembly/checklist/index.html', import.meta.url), 'utf8'), /follower 24× M2×6 and 50× M3×6/);
});

test('a backordered line can be swapped to another recommended source', () => {
  const p = buildPlan(data, { robot: 'pair', sources: { 'so101.servo.c018': 'openelab' } });
  const l = p.groups.flatMap((g) => g.lines).find((x) => x.component === 'so101.servo.c018');
  assert.equal(l.source, 'openelab'); assert.equal(l.swapped, true); assert.equal(l.default_source, 'eckstein');
  // a source we do not recommend is ignored
  const q = buildPlan(data, { robot: 'pair_74v', sources: { 'so101.servo.c001': 'openelab' } });
  assert.equal(q.groups.flatMap((g) => g.lines).find((x) => x.component === 'so101.servo.c001').source, 'eckstein');
});

test('kit alternatives: landed estimate with import VAT and what is still needed', () => {
  const p = buildPlan(data, { robot: 'pair' });
  const seeed = p.alternatives.find((a) => /seeed/.test(a.component));
  assert.ok(seeed.landed.eur[1] > seeed.price_eur * 1.21, 'import VAT and fees above 150 €');
  assert.ok(seeed.still_needed_cs.some((t) => /Zdroje/.test(t)));
  assert.ok(buildPlan(data, {}).alternatives.some((a) => /eckstein_standard/.test(a.component)));
});

test('next step needs servos, board, power supply and USB cable; Python 3.12', () => {
  assert.deepEqual(data.arrivals.filter((a) => a.needed_for_wizard).map((a) => a.id).sort(), ['board', 'psu', 'servos', 'usb']);
  assert.match(data.tools.find((t) => t.id === 'pc').name, /Python 3\.12/);
  assert.ok(data.tools.some((t) => t.id === 'camera' && !t.required));
});

test('plan rejects unknown options', () => {
  assert.throws(() => buildPlan(data, { robot: 'leader_only' }), RangeError);
  assert.throws(() => buildPlan(data, { print: 'laser' }), RangeError);
});

test('parseListing finds codes, voltages and ratios', () => {
  assert.deepEqual(parseListing('Feetech STS3215-C018 12V 30KG 1:345 servo'), { codes: ['C018'], voltages: [12], ratios: ['1/345'] });
  assert.deepEqual(parseListing('STS3215 7,4 V 19 kg 1/147 (C046)'), { codes: ['C046'], voltages: [7.4], ratios: ['1/147'] });
  assert.deepEqual(parseListing('nothing here 5V 2A'), { codes: [], voltages: [], ratios: [] });
});

test('variant checker: match, mismatch, contradiction, multi-variant, unknown', () => {
  assert.equal(checkPartVariant(data, 'Feetech STS3215-C018 12V 1/345', 'follower_12v').verdict, 'match');
  assert.equal(checkPartVariant(data, 'Feetech STS3215-C018 12V 1/345', 'follower_12v:3').ok, true);
  assert.equal(checkPartVariant(data, 'STS3215 12V 30kg 1/345 bus servo', 'follower_12v').verdict, 'likely');
  // the known OpenELAB error: C001 shown as 1/191
  const bad = checkPartVariant(data, 'Feetech STS3215 C001 7.4V 1/191', 'leader:2');
  assert.equal(bad.verdict, 'inconsistent');
  assert.equal(bad.ok, false);
  assert.ok(bad.warnings.some((w) => w.code === 'listing_contradiction' && w.field === 'gear_ratio'));
  // a 7.4 V servo offered for the 12 V follower
  const m = checkPartVariant(data, 'STS3215-C001 7.4V 1/345', 'follower_12v');
  assert.equal(m.verdict, 'mismatch');
  assert.deepEqual(m.mismatches.map((x) => x.field).sort(), ['code', 'voltage_v']);
  // wrong ratio for leader joint 1 (needs C044 1/191)
  assert.equal(checkPartVariant(data, 'STS3215-C046 7.4V 1/147', 'leader:1').verdict, 'mismatch');
  assert.equal(checkPartVariant(data, 'STS3215-C044 7.4V 1/191', 'C044').verdict, 'match');
  assert.equal(checkPartVariant(data, 'STS3215 7.4V variants: C001 1/345, C044 1/191, C046 1/147', 'leader:4').verdict, 'check_selection');
  assert.equal(checkPartVariant(data, 'Smart servo, metal gears', 'leader').verdict, 'unknown');
  assert.ok(checkPartVariant(data, 'STS3215-C047 12V 1/345', 'follower_12v').warnings.some((w) => w.code === 'unverified_code'));
  assert.throws(() => checkPartVariant(data, 'x', 'arm7'), RangeError);
});

test('build time comes from the guide stages and agrees with the assembly guide', () => {
  const pair = buildPlan(data, { robot: 'pair', print: 'self' }).build_time;
  assert.deepEqual(pair.work_hours, [10, 19], 'navody/so101-sestaveni: 10–19 h per pair');
  assert.deepEqual(pair.print_hours, [16.5, 16.5]);
  assert.deepEqual(pair.stages.map((s) => s.id), ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  assert.deepEqual(pair.stages.find((s) => s.id === 'e3').hours, [4, 8]);
  const one = buildPlan(data, { robot: 'follower_12v', print: 'self' }).build_time;
  assert.deepEqual(one.work_hours, [7, 14]);
  assert.deepEqual(one.stages.find((s) => s.id === 'e3').hours, [2, 4]);
  const svc = buildTime(data, 2, 'service');
  assert.ok(!svc.stages.some((s) => s.id === 'e1'), 'print stage drops out with a print service');
  assert.deepEqual(svc.print_hours, [0, 0]);
  // the generated guide shows the same numbers
  const guide = fs.readFileSync(new URL('../navody/so101-sestaveni/index.html', import.meta.url), 'utf8');
  assert.match(guide, /odhad 10 až 19 hodin práce/);
  assert.match(guide, /≈ 16,5 h tiskárny \+ 1,5–3 h práce/);
  assert.ok(data.arrivals.every((a) => /^e[0-6]$/.test(a.guide_stage)));
});
