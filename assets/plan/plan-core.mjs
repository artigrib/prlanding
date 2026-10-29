// SO-101 purchase plan: pure functions over data/components/so101.json (no DOM, no network).
// Used by the /plan/so101/ page (assets/plan/plan.js), the build check (tools/check-components.mjs),
// unit tests (tests/plan-core.test.mjs) and the MCP bridge (copied to backend/bridge/src/plan/ by tools/build.mjs).
// We are not a seller: a plan lists what to buy where; the user orders and pays each shop.

const STATUSES = ['verified', 'carried', 'unverified', 'estimate'];
const round2 = (x) => Math.round(x * 100) / 100;

/* ---------------- data checks ---------------- */

/** Minimal JSON Schema (2020-12 subset) validator: type, required, properties, additionalProperties,
 *  items, enum, const, pattern, minLength, minimum, maximum, minItems, maxItems, anyOf, $ref (#/$defs/…). */
export function validateSchema(schema, data) {
  const errors = [];
  const root = schema;
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const typeOk = (t, v) => { const a = typeOf(v); return t === a || (t === 'number' && a === 'integer'); };
  function walk(s, v, path) {
    if (s.$ref) s = s.$ref.split('/').slice(1).reduce((o, k) => o[k], root);
    if (s.anyOf) {
      if (!s.anyOf.some((sub) => { const n = errors.length; walk(sub, v, path); const ok = errors.length === n; errors.length = n; return ok; }))
        errors.push(`${path}: does not match any allowed shape`);
      return;
    }
    if (s.type) { const ts = [].concat(s.type); if (!ts.some((t) => typeOk(t, v))) { errors.push(`${path}: expected ${ts.join('|')}, got ${typeOf(v)}`); return; } }
    if (s.enum && !s.enum.some((e) => e === v)) errors.push(`${path}: ${JSON.stringify(v)} not in ${JSON.stringify(s.enum)}`);
    if ('const' in s && s.const !== v) errors.push(`${path}: must be ${JSON.stringify(s.const)}`);
    if (typeof v === 'string') {
      if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${path}: ${JSON.stringify(v)} does not match ${s.pattern}`);
      if (s.minLength != null && v.length < s.minLength) errors.push(`${path}: too short`);
    }
    if (typeof v === 'number') {
      if (s.minimum != null && v < s.minimum) errors.push(`${path}: ${v} < ${s.minimum}`);
      if (s.maximum != null && v > s.maximum) errors.push(`${path}: ${v} > ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < s.minItems) errors.push(`${path}: fewer than ${s.minItems} items`);
      if (s.maxItems != null && v.length > s.maxItems) errors.push(`${path}: more than ${s.maxItems} items`);
      if (s.items) v.forEach((x, i) => walk(s.items, x, `${path}[${i}]`));
    } else if (v && typeof v === 'object') {
      for (const k of s.required || []) if (!(k in v) || v[k] === undefined) errors.push(`${path}: missing "${k}"`);
      for (const [k, x] of Object.entries(v)) {
        if (s.properties && s.properties[k]) walk(s.properties[k], x, `${path}.${k}`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, x, `${path}.${k}`);
      }
    }
  }
  walk(schema, data, '$');
  return errors;
}

/** Schema + cross-reference checks. Returns a list of human-readable errors (empty = ok). */
export function checkData(data, schema) {
  const errors = schema ? validateSchema(schema, data) : [];
  if (errors.length) return errors;
  const comps = Object.fromEntries(data.components.map((c) => [c.id, c]));
  const gen = data.meta.generated;
  for (const c of data.components) {
    const ids = new Set();
    for (const s of c.sources) {
      const where = `${c.id} / ${s.id}`;
      if (ids.has(s.id)) errors.push(`${where}: duplicate source id`);
      ids.add(s.id);
      if (!s.url) errors.push(`${where}: source has no URL`);
      if (!s.checked) errors.push(`${where}: source has no checked date`);
      if (s.checked > gen) errors.push(`${where}: checked ${s.checked} is after meta.generated ${gen}`);
      if (!data.suppliers[s.supplier]) errors.push(`${where}: unknown supplier "${s.supplier}"`);
      if (s.flag && (!s.flag_reason || !s.flag_reason_cs)) errors.push(`${where}: flag "${s.flag}" needs flag_reason and flag_reason_cs`);
      if (s.flag === 'mislabeled' && s.recommend) errors.push(`${where}: a mislabeled source cannot be recommended`);
      if (s.price != null && !s.currency) errors.push(`${where}: price without currency`);
    }
  }
  for (const [cid, cfg] of Object.entries(data.configs)) {
    for (const a of cfg.arms) if (!data.variants.arms[a]) errors.push(`config ${cid}: unknown arm "${a}"`);
    for (const l of cfg.lines) {
      const c = comps[l.component];
      if (!c) { errors.push(`config ${cid}: unknown component ${l.component}`); continue; }
      const s = c.sources.find((x) => x.id === l.source);
      if (!s) { errors.push(`config ${cid}: ${l.component} has no source "${l.source}"`); continue; }
      if (!s.recommend) errors.push(`config ${cid}: ${l.component} uses a source we do not recommend (${s.id})`);
      if (s.price == null) errors.push(`config ${cid}: ${l.component} / ${s.id} has no price`);
      if (l.arm && !data.variants.arms[l.arm]) errors.push(`config ${cid}: unknown arm ${l.arm}`);
    }
    if (cfg.alternative) {
      const c = comps[cfg.alternative.component];
      if (!c || !c.sources.find((x) => x.id === cfg.alternative.source)) errors.push(`config ${cid}: bad alternative`);
    }
  }
  for (const k of data.printing.service.sources) if (!data.suppliers[k]) errors.push(`printing.service: unknown supplier ${k}`);
  for (const arm of Object.values(data.variants.arms)) for (const j of arm.joints) for (const code of j.codes) {
    const v = data.variants.codes[code];
    if (!v) errors.push(`variants: unknown code ${code}`);
    else if (v.voltage_v !== arm.voltage_v) errors.push(`variants: ${code} (${v.voltage_v} V) on a ${arm.voltage_v} V arm`);
  }
  return errors;
}

/* ---------------- plan ---------------- */

export const CONFIGS = ['follower_12v', 'pair'];
export const PRINT = ['self', 'service'];

export function toEur(data, price, currency) {
  if (price == null) return null;
  if (currency === 'EUR') return price;
  if (currency === 'CZK') return price / data.meta.fx_czk_per_eur;
  if (currency === 'RON' && data.meta.fx_ron_per_eur) return price / data.meta.fx_ron_per_eur;
  throw new Error('no FX rate for ' + currency);
}

const maxRange = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1])];

/**
 * Build a purchase plan.
 * @param {object} data  data/components/so101.json
 * @param {{robot?: 'follower_12v'|'pair', print?: 'self'|'service'}} opts
 */
export function buildPlan(data, opts = {}) {
  const robot = opts.robot || 'follower_12v', print = opts.print || 'self';
  const cfg = data.configs[robot];
  if (!cfg) throw new RangeError(`unknown robot config "${robot}" (use ${CONFIGS.join(' or ')})`);
  if (!PRINT.includes(print)) throw new RangeError(`unknown print option "${print}" (use ${PRINT.join(' or ')})`);
  const comps = Object.fromEntries(data.components.map((c) => [c.id, c]));
  const fx = data.meta.fx_czk_per_eur, oss = data.meta.oss_vat_uplift;
  const groups = new Map();
  const warnings = [];
  let oldest = null, newest = null;

  for (const l of cfg.lines) {
    const c = comps[l.component];
    const s = c.sources.find((x) => x.id === l.source);
    const sup = data.suppliers[s.supplier];
    const packs = Math.ceil(l.qty / (s.per || 1));
    const unit = toEur(data, s.price, s.currency);
    const subtotal = round2(unit * packs);
    const eta = s.eta_days || sup.eta_days_estimate || [0, 0];
    if (!oldest || s.checked < oldest) oldest = s.checked;
    if (!newest || s.checked > newest) newest = s.checked;
    const alternatives = c.sources.filter((x) => x.id !== s.id).map((x) => ({
      id: x.id, supplier: x.supplier, label: x.label, url: x.url, price: x.price, currency: x.currency, per: x.per,
      checked: x.checked, status: x.status, recommend: x.recommend, flag: x.flag || null,
      flag_reason: x.flag_reason || null, flag_reason_cs: x.flag_reason_cs || null
    }));
    const line = {
      component: c.id, name: c.name, name_cs: c.name_cs, qty: l.qty, packs, per: s.per || 1, arm: l.arm || null,
      source: s.id, label: s.label, url: s.url, price: s.price, currency: s.currency, unit_eur: round2(unit), subtotal_eur: subtotal,
      checked: s.checked, status: s.status, stock: s.stock, eta_days: eta,
      flag: s.flag || null, flag_reason: s.flag_reason || null, flag_reason_cs: s.flag_reason_cs || null,
      alternatives
    };
    if (s.flag) warnings.push({ component: c.id, source: s.id, flag: s.flag, reason: s.flag_reason, reason_cs: s.flag_reason_cs });
    for (const a of alternatives) if (a.flag === 'mislabeled') warnings.push({ component: c.id, source: a.id, flag: a.flag, reason: a.flag_reason, reason_cs: a.flag_reason_cs, not_recommended: true });
    if (!groups.has(s.supplier)) groups.set(s.supplier, { supplier: s.supplier, name: sup.name, name_cs: sup.name_cs || sup.name, country: sup.country, url: sup.url, vat: sup.vat, lines: [] });
    groups.get(s.supplier).lines.push(line);
  }

  // printed parts
  const arms = cfg.arms.length;
  if (print === 'self') {
    const p = data.printing.self;
    const eur = round2((cfg.print_grams / 1000) * p.filament_czk_per_kg / fx);
    groups.set('self_print', {
      supplier: 'self_print', name: 'Printed by you', name_cs: 'Tisknete sami', country: '—', url: p.stl_url, vat: 'none', estimate: true,
      lines: [{ component: cfg.arms.includes('leader') ? 'so101.printed.follower+leader' : 'so101.printed.follower', name: `Filament PLA+ ≈ ${cfg.print_grams} g (estimate)`, name_cs: `Filament PLA+ ≈ ${cfg.print_grams} g (odhad)`,
        qty: 1, packs: 1, per: 1, arm: null, source: 'filament', label: 'PLA+', url: p.stl_url, price: null, currency: 'EUR', unit_eur: eur, subtotal_eur: eur,
        checked: data.meta.generated, status: p.status, stock: '', eta_days: [0, 0], flag: null, flag_reason: null, flag_reason_cs: null, alternatives: [], print_hours: buildTime(data, arms, 'self').print_hours }],
      shipping_override: [0, 0]
    });
  } else {
    const p = data.printing.service;
    const lo = p.price_eur_per_arm[0] * arms, hi = p.price_eur_per_arm[1] * arms;
    const sups = p.sources.map((k) => data.suppliers[k]);
    const ship = sups.reduce((r, s) => [Math.min(r[0], s.shipping_eur[0]), Math.max(r[1], s.shipping_eur[1])], [Infinity, 0]);
    groups.set('print_service', {
      supplier: 'print_service', name: 'Print service (quote)', name_cs: 'Tiskový servis (nabídka)', country: sups.map((s) => s.country).join(' / '), url: sups[0].url, vat: 'cz', estimate: true,
      services: p.sources.map((k) => ({ id: k, name: data.suppliers[k].name, url: data.suppliers[k].url })),
      lines: [{ component: 'so101.printed', name: `Printed parts, ${arms} arm${arms > 1 ? 's' : ''} (estimate)`, name_cs: `Tištěné díly, ${arms === 1 ? '1 ruka' : arms + ' ruce'} (odhad)`,
        qty: arms, packs: arms, per: 1, arm: null, source: 'quote', label: sups.map((s) => s.name).join(' / '), url: sups[0].url, price: null, currency: 'EUR',
        unit_eur: null, subtotal_eur: null, range_eur: [lo, hi], checked: data.meta.generated, status: p.status, stock: '', eta_days: p.eta_days,
        flag: null, flag_reason: null, flag_reason_cs: null, alternatives: [] }],
      shipping_override: ship
    });
  }

  // per-group landed cost: goods + (EU OSS VAT uplift | CN duty) + shipping
  const out = [];
  let totLo = 0, totHi = 0, goodsLo = 0, goodsHi = 0, eta = [0, 0];
  for (const g of groups.values()) {
    const sup = data.suppliers[g.supplier];
    let gLo = 0, gHi = 0, taxHi = 0, lineEta = [0, 0];
    for (const l of g.lines) {
      const r = l.range_eur || [l.subtotal_eur, l.subtotal_eur];
      gLo += r[0]; gHi += r[1];
      if (g.vat === 'eu_oss') taxHi += r[1] * oss;
      if (g.vat === 'cn_ioss' && sup && sup.duty_eur_per_line) taxHi += sup.duty_eur_per_line;
      lineEta = maxRange(lineEta, l.eta_days);
    }
    const ship = g.shipping_override || (sup ? sup.shipping_eur : [0, 0]);
    const landed = [round2(gLo + ship[0]), round2(gHi + taxHi + ship[1])];
    goodsLo += gLo; goodsHi += gHi; totLo += landed[0]; totHi += landed[1];
    eta = maxRange(eta, lineEta);
    out.push({
      ...g, shipping_override: undefined,
      goods_eur: [round2(gLo), round2(gHi)], tax_eur: [0, round2(taxHi)], shipping_eur: ship,
      shipping_status: sup ? sup.shipping_status : 'estimate', landed_eur: landed, eta_days: lineEta
    });
  }
  out.sort((a, b) => (a.supplier === 'none') - (b.supplier === 'none') || b.landed_eur[1] - a.landed_eur[1]);

  const build = buildTime(data, arms, print);

  let alternative = null;
  if (cfg.alternative) {
    const c = comps[cfg.alternative.component], s = c.sources.find((x) => x.id === cfg.alternative.source);
    alternative = { component: c.id, name: c.name, name_cs: c.name_cs, label: s.label, url: s.url, price: s.price, currency: s.currency,
      price_eur: round2(toEur(data, s.price, s.currency)), checked: s.checked, status: s.status, note: cfg.alternative.note, note_cs: cfg.alternative.note_cs };
  }

  const roundEur = (r) => [Math.floor(r[0]), Math.ceil(r[1])];
  const roundCzk = (r) => [Math.floor((r[0] * fx) / 10) * 10, Math.ceil((r[1] * fx) / 10) * 10];
  const landed = roundEur([totLo, totHi]);
  return {
    robot, print, config: { id: robot, name: cfg.name, name_cs: cfg.name_cs, arms: cfg.arms },
    seller_of_record: 'each supplier (we are not the seller and never place orders)',
    affiliate_links: !!data.meta.affiliate_links,
    groups: out,
    totals: {
      goods_eur: [round2(goodsLo), round2(goodsHi)],
      landed_eur: landed,
      landed_czk: roundCzk([totLo, totHi]),
      includes: 'goods incl. VAT, EU OSS VAT uplift (up to +1.7 %), CN duty where applicable, shipping estimate',
      fx_czk_per_eur: fx
    },
    eta_days: eta,
    checked: { oldest, newest },
    warnings,
    variants: requiredVariants(data, cfg.arms),
    tools: data.tools.filter((t) => !t.only_print || t.only_print === print),
    build_time: build,
    arrivals: data.arrivals,
    alternative
  };
}

/**
 * Build-time estimate from the guide's stages (data.build_time.stages): the plan page, the MCP tool and the
 * assembly guide (navody/so101-sestaveni, expanded by tools/build.mjs) all read this, so they always agree.
 * Stages with h_per_arm scale with the number of arms; only_print stages drop out for the other print option.
 */
export function buildTime(data, arms, print = 'self') {
  const bt = data.build_time;
  const stages = bt.stages.filter((st) => !st.only_print || st.only_print === print).map((st) => {
    const h = st.h_per_arm ? [st.h_per_arm[0] * arms, st.h_per_arm[1] * arms] : st.h;
    return { id: st.id, name: st.name, name_cs: st.name_cs, hours: [round2(h[0]), round2(h[1])], optional: !!st.optional, per_arm: st.h_per_arm || null };
  });
  const lo = stages.reduce((a, st) => a + st.hours[0], 0), hi = stages.reduce((a, st) => a + st.hours[1], 0);
  const printer = print === 'self' ? round2(bt.printer_h_per_arm * arms) : 0;
  return {
    status: 'estimate', arms, print,
    stages,
    work_hours: [Math.round(lo), Math.ceil(hi)],
    print_hours: [printer, printer],
    guide: bt.guide
  };
}

export function requiredVariants(data, arms) {
  return arms.map((a) => ({
    arm: a, voltage_v: data.variants.arms[a].voltage_v,
    joints: data.variants.arms[a].joints.map((j) => ({ ...j, voltage_v: data.variants.codes[j.codes[0]].voltage_v, gear_ratio: data.variants.codes[j.codes[0]].gear_ratio }))
  }));
}

/* ---------------- variant checker ---------------- */

/** Pull servo variant facts out of free listing text. */
export function parseListing(text) {
  const t = String(text || '').slice(0, 5000);
  const uniq = (a) => [...new Set(a)];
  const codes = uniq([...t.matchAll(/(?<![A-Za-z])C0?(001|018|044|046|047|01|18|44|46|47)(?!\d)/gi)].map((m) => 'C0' + m[1].replace(/^0/, '').padStart(2, '0')));
  const voltages = uniq([...t.matchAll(/(?<![\d.,])(\d{1,2}(?:[.,]\d)?)\s*V(?![a-zA-Z])/g)].map((m) => Number(m[1].replace(',', '.'))).filter((v) => v === 7.4 || v === 12));
  const ratios = uniq([...t.matchAll(/(?<!\d)1\s*[:/]\s*(147|191|345)(?!\d)/g)].map((m) => '1/' + m[1]));
  return { codes, voltages, ratios };
}

/**
 * Compare a listing title/description with the variant we need.
 * @param {object} data
 * @param {string} text  listing title or text the user pasted
 * @param {string} expect  a code ("C018"), an arm ("follower_12v" | "leader") or an arm joint ("leader:1")
 */
export function checkPartVariant(data, text, expect) {
  const V = data.variants;
  let allowed, voltage, ratios, label;
  const e = String(expect || '').trim();
  const mJoint = /^(follower_12v|leader):([1-6])$/.exec(e);
  const code = e.toUpperCase();
  if (V.codes[code]) { allowed = [code]; voltage = V.codes[code].voltage_v; label = code; }
  else if (mJoint) {
    const j = V.arms[mJoint[1]].joints[Number(mJoint[2]) - 1];
    allowed = j.codes; voltage = V.arms[mJoint[1]].voltage_v; label = `${mJoint[1]} joint ${j.joint} (${j.name})`;
  } else if (V.arms[e]) {
    allowed = [...new Set(V.arms[e].joints.flatMap((j) => j.codes))]; voltage = V.arms[e].voltage_v; label = e;
  } else throw new RangeError(`unknown expectation "${expect}": use a code (${Object.keys(V.codes).join(', ')}), an arm (${Object.keys(V.arms).join(', ')}) or arm:joint, e.g. leader:1`);
  ratios = [...new Set(allowed.map((c) => V.codes[c].gear_ratio))];

  const found = parseListing(text);
  const mismatches = [], warnings = [];
  const multi = found.codes.length > 1 || found.voltages.length > 1 || found.ratios.length > 1;
  // a listing that contradicts itself (e.g. "C001 … 1/191")
  let inconsistent = false;
  if (found.codes.length === 1 && V.codes[found.codes[0]]) {
    const k = V.codes[found.codes[0]];
    if (found.ratios.length === 1 && found.ratios[0] !== k.gear_ratio) { inconsistent = true; warnings.push({ code: 'listing_contradiction', field: 'gear_ratio', listing_code: found.codes[0], listing_value: found.ratios[0], code_value: k.gear_ratio }); }
    if (found.voltages.length === 1 && found.voltages[0] !== k.voltage_v) { inconsistent = true; warnings.push({ code: 'listing_contradiction', field: 'voltage_v', listing_code: found.codes[0], listing_value: found.voltages[0], code_value: k.voltage_v }); }
  }
  if (found.codes.length && !found.codes.some((c) => allowed.includes(c))) mismatches.push({ field: 'code', expected: allowed, found: found.codes });
  if (found.voltages.length && !found.voltages.includes(voltage)) mismatches.push({ field: 'voltage_v', expected: voltage, found: found.voltages });
  if (found.ratios.length && !found.ratios.some((r) => ratios.includes(r))) mismatches.push({ field: 'gear_ratio', expected: ratios, found: found.ratios });
  if (multi) warnings.push({ code: 'multiple_variants', detail: 'The listing mentions several variants: check the option you actually select.' });
  if (found.codes.some((c) => V.codes[c] && V.codes[c].status !== 'verified')) warnings.push({ code: 'unverified_code', detail: 'C047 is treated as equal to C018 only after checking its datasheet.' });

  let verdict;
  if (inconsistent) verdict = 'inconsistent';
  else if (mismatches.length) verdict = 'mismatch';
  else if (multi) verdict = 'check_selection';
  else if (found.codes.length) verdict = 'match';
  else if (found.voltages.length && found.ratios.length) verdict = 'likely';
  else verdict = 'unknown';

  const ADVICE = {
    match: ['The listing names the right variant. Still read the label on every servo when it arrives.', 'Inzerát uvádí správnou variantu. Po doručení stejně zkontrolujte štítek na každém servu.'],
    likely: ['Voltage and gear ratio fit, but no variant code is named. Ask the seller or check the label on arrival.', 'Napětí a převod sedí, ale kód varianty chybí. Zeptejte se prodejce nebo zkontrolujte štítek po doručení.'],
    check_selection: ['The listing offers several variants. Make sure the option you select is the right one.', 'Inzerát nabízí více variant. Ověřte, že vybíráte tu správnou.'],
    mismatch: ['This listing does not match the variant you need. Do not order it for this joint.', 'Tento inzerát neodpovídá potřebné variantě. Pro tento kloub ho neobjednávejte.'],
    inconsistent: ['The listing contradicts itself (the code and the ratio or voltage disagree). We do not recommend it.', 'Inzerát si odporuje (kód nesedí s převodem nebo napětím). Nedoporučujeme.'],
    unknown: ['Not enough information in the text. Look for the code (C018, C001, C044, C046), voltage and gear ratio.', 'V textu chybí údaje. Hledejte kód (C018, C001, C044, C046), napětí a převod.']
  };
  return {
    expected: { label, codes: allowed, voltage_v: voltage, gear_ratios: ratios },
    found, verdict, ok: verdict === 'match' || verdict === 'likely',
    mismatches, warnings, advice: ADVICE[verdict][0], advice_cs: ADVICE[verdict][1]
  };
}

export { STATUSES };
