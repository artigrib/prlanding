// The SO-101 arrival checklist ("Co už dorazilo" on /plan/so101/) and the printable build checklist must match the
// purchase plan in data/components/so101.json for every configuration: same parts, same quantities, same servo codes.
// node --test tests/arrivals-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan } from '../assets/plan/plan-core.mjs';

const ROOT = new URL('../', import.meta.url);
const data = JSON.parse(fs.readFileSync(new URL('data/components/so101.json', ROOT), 'utf8'));
const comps = Object.fromEntries(data.components.map((c) => [c.id, c]));
const CONFIGS = ['pair_74v', 'pair', 'follower_74v', 'follower_12v'];   // pair / follower × 7.4 V / 12 V follower
const purchasable = (l) => comps[l.component].sources.find((s) => s.id === l.source).supplier !== 'none';
const key = (component, arm) => `${component}|${arm || '-'}`;

test('the plan offers exactly pair and follower-only, each with a 7.4 V and a 12 V follower', () => {
  assert.deepEqual(Object.keys(data.configs).sort(), [...CONFIGS].sort());
  const follower = (c) => data.configs[c].arms.find((a) => a.startsWith('follower'));
  assert.deepEqual(CONFIGS.map((c) => data.variants.arms[follower(c)].voltage_v), [7.4, 12, 7.4, 12]);
  assert.deepEqual(CONFIGS.map((c) => data.configs[c].arms.includes('leader')), [true, true, false, false]);
});

test('every arrival names the components it covers, and every purchasable component has exactly one arrival', () => {
  const owner = {};
  for (const a of data.arrivals) {
    assert.ok(Array.isArray(a.components) && a.components.length, `arrival ${a.id} lists its components`);
    for (const c of a.components) {
      assert.ok(c === 'printed' || comps[c], `arrival ${a.id}: unknown component ${c}`);
      assert.ok(!owner[c], `${c} is in arrivals ${owner[c]} and ${a.id}`);
      owner[c] = a.id;
    }
  }
  for (const cfg of Object.values(data.configs)) for (const l of cfg.lines.filter(purchasable)) assert.ok(owner[l.component], `${l.component} has no arrival`);
  for (const c of data.components.filter((x) => x.code)) assert.ok(data.variants.codes[c.code] && c.name.includes(c.code), `${c.id}: code ${c.code}`);
});

for (const config of CONFIGS) for (const print of ['self', 'service']) {
  test(`arrival checklist = purchase plan: ${config}, print ${print}`, () => {
    const cfg = data.configs[config];
    const p = buildPlan(data, { config, print });
    // expected straight from the config lines (not from the plan output), plus one printed set per arm
    const want = {};
    for (const l of cfg.lines.filter(purchasable)) want[key(l.component, l.arm)] = (want[key(l.component, l.arm)] || 0) + l.qty;
    for (const arm of cfg.arms) want[key('printed', arm)] = 1;
    const got = {};
    for (const a of p.arrivals) for (const it of a.items || []) {
      const k = key(it.component, it.arm);
      assert.ok(!(k in got), `${k} listed twice`);
      got[k] = it.qty;
    }
    assert.deepEqual(got, want);
    // the printed-parts arrival covers what the plan buys for printing (filament or a quoted service)
    const printLines = p.groups.flatMap((g) => g.lines).filter((l) => l.component.startsWith('so101.printed'));
    assert.equal(printLines.length, 1);
    if (print === 'service') assert.equal(printLines[0].qty, cfg.arms.length);
    for (const a of p.arrivals) {
      const items = a.items || [];
      assert.ok(items.length, `${a.id}: nothing to tick off in ${config}`);
      for (const it of items.filter((x) => x.component !== 'printed')) {
        const c = comps[it.component];
        assert.equal(it.code, c.code || null);
        // the label shows quantity and variant code, in both languages
        const shown = `${it.qty}×${c.code || c.short ? ' ' + (c.code || c.short) : ''}`;
        for (const n of [a.name, a.name_cs]) assert.ok(n.includes(shown), `${a.id}: "${n}" lacks "${shown}"`);
      }
    }
    // servo quantities per arm agree with the variant table (joints per code)
    for (const arm of cfg.arms) {
      const perCode = {};
      for (const j of data.variants.arms[arm].joints) perCode[j.codes[0]] = (perCode[j.codes[0]] || 0) + 1;
      const servos = {};
      for (const a of p.arrivals) for (const it of a.items || []) if (it.arm === arm && it.code) servos[it.code] = (servos[it.code] || 0) + it.qty;
      assert.deepEqual(servos, perCode, `${config} ${arm}`);
    }
  });
}

test('the printable build checklist names each arm’s servo count, gear ratio and code (cs + en)', () => {
  for (const L of ['cs', 'en']) {
    const html = fs.readFileSync(new URL(`tools/content/checklist.${L}.html`, ROOT), 'utf8');
    for (const [id, arm] of Object.entries(data.variants.arms)) {
      const perCode = {};
      for (const j of arm.joints) perCode[j.codes[0]] = (perCode[j.codes[0]] || 0) + 1;
      for (const [code, n] of Object.entries(perCode)) {
        const ratio = data.variants.codes[code].gear_ratio;
        // followers as "6× 1/345 (C001)"; the mixed leader joint by joint as "1/191 (C044)"
        const want = id === 'leader' ? `${ratio} (${code})` : `${n}× ${ratio} (${code})`;
        assert.ok(html.includes(want), `checklist.${L}: ${id} needs "${want}"`);
      }
    }
  }
});
