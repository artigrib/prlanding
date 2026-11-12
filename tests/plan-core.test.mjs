// Unit tests for the SO-101 purchase plan core (assets/plan/plan-core.mjs) and its data file.
// node --test tests/plan-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, buildTime, checkData, checkPartVariant, parseListing, validateSchema, stockState, stockText } from '../assets/plan/plan-core.mjs';
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
  assert.deepEqual(p.eta_days, [4, 6], 'bus board backorder (4–6 days) sets the ETA');
  assert.equal(p.checked.oldest, '2026-10-30');
  assert.ok(p.groups.find((g) => g.supplier === 'hornbach').lines[0].packs === 1, '2 clamps = 1 pack of 2');
  assert.deepEqual(p.variants.map((v) => v.arm), ['follower_12v']);
  assert.ok(p.tools.some((t) => t.id === 'printer'));
  assert.equal(p.affiliate_links, false);
});

test('plan totals: pair, self-printed and print service', () => {
  const p = buildPlan(data, { robot: 'pair', print: 'self' });
  assert.deepEqual(p.totals.landed_eur, [384, 405]);
  assert.deepEqual(p.variants.map((v) => v.arm), ['follower_12v', 'leader']);
  const servos = p.groups.flatMap((g) => g.lines).filter((l) => /servo\.c0/.test(l.component));
  assert.equal(sum(servos.map((l) => l.qty)), 12);
  assert.ok(p.alternative && /printed/.test(p.alternative.component), 'printed parts as an alternative; complete kits live in data.kits');
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

test('printed-part alternative: EU landed estimate, kits are compared separately', () => {
  for (const robot of ['pair_74v', 'pair']) {
    const a = buildPlan(data, { robot }).alternatives.find((x) => x.component === 'so101.printed.follower');
    assert.ok(a && a.landed.eur[0] >= a.price_eur, robot);
  }
  assert.ok(!data.components.some((c) => /bundle/.test(c.id)), 'bundles moved to data.kits');
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

test('a restock date already before the render date is never shown as current', () => {
  const bo = 'Backorder: 38 expected 2026-11-04';
  assert.deepEqual(stockState(bo, '2026-11-12'), { backorder: true, expected: '2026-11-04', past: true });
  assert.equal(stockState(bo, '2026-11-04').past, false, 'the expected day itself is still current');
  assert.equal(stockText(bo, 'cs', { checked: '2026-11-07', today: '2026-11-12' }), 'na objednávku, termín ověřte v obchodě (ověřeno 07.11.2026)');
  assert.equal(stockText(bo, 'en', { checked: '2026-11-07', today: '2026-11-12' }), 'Backorder: check the date at the shop (last checked 07.11.2026)');
  for (const l of ['cs', 'en']) assert.doesNotMatch(stockText(bo, l, { checked: '2026-11-07', today: '2026-11-12' }), /04\.11\.2026|2026-11-04/);
  // a future date is still shown
  assert.equal(stockText('Backorder: 10 expected 2026-11-13', 'cs', { today: '2026-11-12' }), 'na objednávku, naskladnění 13.11.2026');
  assert.equal(stockText('Available', 'cs', { today: '2026-11-12' }), 'skladem');
  // the plan flags it on every line and alternative, against the date it is rendered on
  const p = buildPlan(data, { robot: 'pair_74v', today: '2099-01-01' });
  const lines = p.groups.flatMap((g) => g.lines);
  for (const l of lines) if (/^Backorder: \d+ expected/.test(l.stock || '')) assert.equal(l.stock_date_past, true, l.component);
  for (const l of lines) for (const a of l.alternatives) if (/^Backorder: \d+ expected/.test(a.stock || '')) assert.equal(a.stock_date_past, true, a.id);
  const early = buildPlan(data, { robot: 'pair_74v', today: '2000-01-01' }).groups.flatMap((g) => g.lines);
  assert.ok(early.every((l) => !l.stock_date_past));
});

test('a shop label matches its link; documentation is never a shop offer', () => {
  const host = (u) => new URL(u).hostname.replace(/^www\./, '').split('.').slice(-2).join('.');
  for (const c of data.components) for (const s of c.sources) {
    assert.equal(host(s.url), host(data.suppliers[s.supplier].url), `${c.id} / ${s.id}`);
    for (const t of s.label.match(/\b(?:[a-z0-9-]+\.)+(?:fr|de|com|cz|sk|pl|ro|store|io|eu)\b/gi) || []) assert.equal(host('https://' + t), host(s.url), `${c.id} / ${s.id}: ${s.label}`);
  }
  // the README price is a reference: it cannot be picked as a source
  const ref = data.components.find((c) => c.id === 'so101.bus_board').sources.find((s) => s.kind === 'reference');
  assert.ok(ref && !/amazon/i.test(ref.label) && /github\.com/.test(ref.url));
  const alt = buildPlan(data, { robot: 'pair_74v' }).groups.flatMap((g) => g.lines).find((l) => l.component === 'so101.bus_board').alternatives.find((a) => a.id === ref.id);
  assert.equal(alt.selectable, false);
  assert.equal(buildPlan(data, { robot: 'pair_74v', sources: { 'so101.bus_board': ref.id } }).groups.flatMap((g) => g.lines).find((l) => l.component === 'so101.bus_board').source, 'eckstein');
  // the build check catches a label naming another shop's domain, another shop's name, or a docs page as an offer
  const d = clone(data), s = d.components.find((c) => c.id === 'so101.bus_board').sources.find((x) => x.id === 'eckstein');
  s.label = 'Amazon.fr (README EU link)';
  assert.ok(checkData(d, schema).some((e) => /names amazon\.fr but links to eckstein-shop\.de/i.test(e)));
  s.label = 'Botland'; assert.ok(checkData(d, schema).some((e) => /names another shop \(Botland\)/.test(e)));
  s.label = 'Eckstein'; s.url = 'https://github.com/TheRobotStudio/SO-ARM100';
  assert.ok(checkData(d, schema).some((e) => /documentation, not a shop offer/.test(e)));
  // a wiki page in the notes is marked as documentation
  const wiki = data.notes.flatMap((n) => n.sources || []).filter((x) => /\/wiki\//.test(x.url));
  assert.ok(wiki.length && wiki.every((x) => x.kind === 'docs'));
  const d2 = clone(data); for (const n of d2.notes) for (const x of n.sources || []) delete x.kind;
  assert.ok(checkData(d2, schema).some((e) => /wiki page: mark it kind "docs"/.test(e)));
});

test('OpenELAB shipping is the shop\'s published text, dispatch and transit kept apart', () => {
  const o = data.suppliers.openelab;
  assert.deepEqual(o.shipping_eur, [0, 7.95]);
  assert.deepEqual(o.dispatch_days, [1, 1]);
  assert.deepEqual(o.transit_days, [3, 5]);
  assert.equal(o.shipping_source.url, 'https://openelab.io/pages/shipping-order');
  assert.notEqual(o.shipping_status, 'verified', 'Czechia is not named on the page');
  assert.match(o.shipping_note, /€7\.95.*free over €100/);
  assert.match(o.shipping_note_cs, /7,95 €.*nad 100 € zdarma/);
});

test('Botland kit says business customers only, in both languages, from its own page', () => {
  const k = data.kits.find((x) => x.id === 'seeed_pro_botland');
  assert.equal(k.buyers, 'business_only');
  assert.match(k.note, /This store sells to registered businesses only/);
  assert.match(k.note_cs, /jen pro firmy/i);
});
