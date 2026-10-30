// Ready-made kits vs. parts separately (data/components/so101.json kits, assets/plan/plan-core.mjs compareKits).
// node --test tests/plan-kits.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, checkData, checkPartVariant, compareKits, kitLanded, kitVariantCheck, kitsFromEur, IOSS_LIMIT_EUR } from '../assets/plan/plan-core.mjs';

const read = (f) => JSON.parse(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const data = read('data/components/so101.json');
const schema = read('data/components/so101.schema.json');
const clone = (x) => JSON.parse(JSON.stringify(x));
const kit = (id) => data.kits.find((k) => k.id === id);

test('kits data: dated https sources, known shops and parts, stored landed cost = computed', () => {
  assert.deepEqual(checkData(data, schema), []);
  assert.ok(data.kits.length >= 4);
  for (const k of data.kits) {
    assert.match(k.url, /^https:\/\//, k.id);
    assert.ok(k.checked <= data.meta.generated, k.id);
    assert.ok(data.suppliers[k.seller], k.id);
    assert.ok(k.reviews && 'signals' in k.reviews, k.id);
  }
  // every configuration has at least one verified kit with the right servo mix
  for (const c of Object.keys(data.configs)) assert.ok(data.kits.some((k) => k.configs.includes(c) && k.status === 'verified' && kitVariantCheck(data, k, data.configs[c].arms).ok), c);
});

test('data check catches a wrong servo mix, a stale landed cost, a future date and an unknown part', () => {
  const d = clone(data);
  const k = d.kits.find((x) => x.id === 'eckstein_standard_pair');
  k.servos.leader.ratios['1/191'] = 3;
  k.landed_eur_cz = [1, 2];
  k.checked = '2099-01-01';
  k.includes.push({ component: 'so101.nope', qty: 1 });
  const e = checkData(d, schema).join('\n');
  assert.match(e, /servo mix does not fit pair_74v/);
  assert.match(e, /landed_eur_cz \[1,2\] != computed/);
  assert.match(e, /checked date missing or after meta\.generated/);
  assert.match(e, /unknown component so101\.nope/);
});

test('servo mix check: 12 V follower kit does not fit a 7.4 V pair; codes must belong to the arm', () => {
  assert.equal(kitVariantCheck(data, kit('eckstein_pro_pair'), ['follower_12v', 'leader']).ok, true);
  const bad = kitVariantCheck(data, kit('eckstein_pro_pair'), ['follower_74v', 'leader']);
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => p.issue === 'missing_arm' && p.arm === 'follower_74v'));
  const k = clone(kit('wowrobo_diy_openelab'));
  k.servos.follower_12v.codes = { C001: 6 };
  assert.ok(kitVariantCheck(data, k, ['follower_12v', 'leader']).problems.some((p) => p.issue === 'code' && p.code === 'C001'));
  assert.equal(kitVariantCheck(data, kit('wowrobo_diy_openelab'), ['follower_12v', 'leader']).codes_named, true);
  assert.equal(kitVariantCheck(data, kit('eckstein_pro_pair'), ['follower_12v', 'leader']).codes_named, false);
});

test('landed cost: EU shop = price + shipping, OSS uplift on the high end', () => {
  const l = kitLanded(data, kit('eckstein_standard_pair'));
  assert.equal(l.basis, 'eu_oss');
  assert.deepEqual(l.eur, [Math.floor(422.99 + 8), Math.ceil(422.99 * 1.017 + 15)]);
});

test('landed cost: imports over 150 € pay 21 % import VAT on goods + shipping + duty, plus the clearance fee', () => {
  const base = { id: 't', seller: 'aliexpress', price: [200, 200], currency: 'EUR', import: { vat_rate: 0.21, duty_rate: [0, 0.027], clearance_eur: [0, 25], price_includes_vat: false } };
  const l = kitLanded(data, base);
  assert.equal(l.basis, 'import_vat');
  assert.deepEqual(l.eur, [Math.floor(200 * 1.21), Math.ceil(200 * 1.027 * 1.21 + 25)]);
  // VAT status unknown: the low end assumes the checkout already charged it, the high end does not
  const u = kitLanded(data, { ...base, import: { ...base.import, price_includes_vat: null } });
  assert.deepEqual(u.eur, [200, Math.ceil(200 * 1.027 * 1.21 + 25)]);
  // duty paid by the seller: no extra VAT, only duty and the fee
  assert.deepEqual(kitLanded(data, { ...base, import: { ...base.import, price_includes_vat: true } }).eur, [200, Math.ceil(200 * 1.027 + 25)]);
  // CZK prices go through the FX rate: the Seeed kit on AliExpress (6918.40 CZK ≈ 286 €) is over the IOSS limit
  const s = kitLanded(data, kit('seeed_pro_aliexpress'));
  assert.equal(s.basis, 'import_vat');
  assert.ok(6918.4 / data.meta.fx_czk_per_eur > IOSS_LIMIT_EUR);
  assert.ok(s.eur[1] >= Math.floor((6918.4 / data.meta.fx_czk_per_eur) * 1.21), 'high end includes import VAT');
});

test('landed cost: imports up to 150 € use IOSS (VAT in the price) plus the flat 3 € duty per line', () => {
  const l = kitLanded(data, { id: 't', seller: 'aliexpress', price: [120, 120], currency: 'EUR', import: { vat_rate: 0.21, duty_rate: [0, 0.027], clearance_eur: [0, 25], price_includes_vat: null } });
  assert.equal(l.basis, 'ioss');
  assert.deepEqual(l.eur, [123, 123]);
});

test('recommendation: cheapest landed total among verified, in-stock kits with the right servos; kit only when not dearer than parts', () => {
  const svc = buildPlan(data, { robot: 'pair_74v', print: 'service' }).kits;
  assert.equal(svc.recommendation.choice, 'kit');
  assert.equal(svc.recommendation.kit, 'eckstein_standard_pair');
  assert.ok(svc.recommendation.kit_total_eur[1] <= svc.recommendation.parts_eur[1]);
  assert.match(svc.recommendation.basis, /no affiliate/);
  // self-printed parts are cheaper than the kit: say so
  const self = buildPlan(data, { robot: 'pair_74v', print: 'self' }).kits;
  assert.equal(self.recommendation.choice, 'parts');
  assert.equal(self.recommendation.reason, 'parts_cheaper');
  assert.equal(self.recommendation.kit, 'eckstein_standard_pair');
  // 12 V pair: sold-out, business-only and unverified kits never win, even when cheaper
  const pair = buildPlan(data, { robot: 'pair', print: 'service' }).kits;
  assert.equal(pair.best, 'eckstein_pro_pair');
  const by = Object.fromEntries(pair.kits.map((k) => [k.id, k]));
  assert.deepEqual(by.seeed_pro_openelab.blockers, ['out_of_stock']);
  assert.deepEqual(by.seeed_pro_botland.blockers, ['business_only']);
  assert.deepEqual(by.seeed_pro_aliexpress.blockers, ['not_verified']);
  assert.ok(by.seeed_pro_botland.total_eur[0] < by.eckstein_pro_pair.total_eur[0], 'cheaper but not eligible');
  // eligible kits come first, sorted by total
  assert.equal(pair.kits[0].id, 'eckstein_pro_pair');
});

test('recommendation follows the data: a cheaper verified kit wins, a wrong servo mix never does', () => {
  const d = clone(data);
  const k = d.kits.find((x) => x.id === 'seeed_pro_openelab');
  k.in_stock = true; k.stock = 'In stock';
  let r = compareKits(d, buildPlan(d, { robot: 'pair', print: 'service' }));
  // Seeed kit lacks PSUs and printed parts: they are priced in from the plan
  const s = r.kits.find((x) => x.id === 'seeed_pro_openelab');
  assert.deepEqual(s.missing.map((m) => m.component).sort(), ['so101.printed.follower+leader', 'so101.psu_12v', 'so101.psu_5v']);
  assert.ok(s.total_eur[0] > s.landed_eur[0] + 60, 'print service quote and PSUs added');
  assert.equal(r.best, s.total_eur[1] <= r.kits.find((x) => x.id === 'eckstein_pro_pair').total_eur[1] ? 'seeed_pro_openelab' : 'eckstein_pro_pair');
  k.servos.follower_12v.ratios = { '1/147': 6 };
  r = compareKits(d, buildPlan(d, { robot: 'pair', print: 'service' }));
  assert.ok(r.kits.find((x) => x.id === 'seeed_pro_openelab').blockers.includes('variant_mismatch'));
  assert.equal(r.best, 'eckstein_pro_pair');
  // no eligible kit at all: parts
  for (const x of d.kits) x.in_stock = false;
  r = compareKits(d, buildPlan(d, { robot: 'pair', print: 'service' }));
  assert.deepEqual([r.recommendation.choice, r.recommendation.reason, r.best], ['parts', 'no_eligible_kit', null]);
});

test('kit page line: ready-made pair kits from the cheapest eligible landed price', () => {
  assert.equal(kitsFromEur(data, ['pair_74v', 'pair']), kitLanded(data, kit('eckstein_standard_pair')).eur[0]);
  const html = fs.readFileSync(new URL('../sada/so101/index.html', import.meta.url), 'utf8');
  assert.match(html, new RegExp(`hotové sady od ${kitsFromEur(data, ['pair_74v', 'pair'])} € za pár`));
  assert.match(html, /id="plan-cta" href="\.\.\/\.\.\/plan\/so101\/"/);
  assert.match(fs.readFileSync(new URL('../en/kit/so101/index.html', import.meta.url), 'utf8'), /ready-made kits from \d+ € for a pair/);
});

test('check_part_variant on kit listings: whole servo mix and follower voltage', () => {
  const pro = 'Leader: 1 × 1:345, 2 × 1:191, 3 × 1:147. Follower 6 × STS3215 Pro 12 V, 1:345';
  assert.equal(checkPartVariant(data, pro, 'kit:pair').verdict, 'match');
  assert.equal(checkPartVariant(data, pro, 'kit:pair_74v').verdict, 'mismatch');
  assert.equal(checkPartVariant(data, '1 × C001, 2× C044, 3× C046 (leader 7.4 V) + 6× STS3215 12 V 1/345 (follower)', 'kit:pair').verdict, 'match');
  assert.equal(checkPartVariant(data, 'leader 1:345 x1, 1:191 x2, 1:147 x3, follower 1:345 x6, 7.4V', 'kit:pair_74v').verdict, 'match');
  assert.equal(checkPartVariant(data, '12× STS3215 1:345 7.4V', 'kit:pair_74v').verdict, 'mismatch', 'a leader needs 1/191 and 1/147');
  assert.equal(checkPartVariant(data, 'SO-ARM101 kit', 'kit:pair').verdict, 'unknown');
  const k = checkPartVariant(data, 'see https://eckstein-shop.de/lerobot-soarm101-pro-dual-arm-12v_1', 'kit:pair');
  assert.equal(k.known_kit.id, 'eckstein_pro_pair');
  assert.equal(k.verdict, 'likely');
  assert.equal(checkPartVariant(data, 'Eckstein ER01060 kit', 'kit:pair_74v').verdict, 'mismatch', 'known 12 V kit for a 7.4 V pair');
  assert.equal(checkPartVariant(data, 'Eckstein ER01050-F', 'kit:follower_74v').known_kit.id, 'eckstein_standard_follower');
  assert.throws(() => checkPartVariant(data, 'x', 'kit:triple'), /unknown kit config/);
});
