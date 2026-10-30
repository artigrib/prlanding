// Purchase plans: pure functions over data/components/<robot>.json (so101.json, svrn.json; no DOM, no network).
// Used by the /plan/<robot>/ pages (assets/plan/plan.js), the build check (tools/check-components.mjs),
// unit tests (tests/plan-core.test.mjs) and the MCP bridge (copied to backend/bridge/src/plan/ by tools/build.mjs).
// We are not a seller: a plan lists what to buy where; the user orders and pays each shop.
// One model for every robot: configs (lines of component + source), optional choice groups (data.options,
// e.g. the SVRN front module), printing (self | service), build_time stages, arrivals, and a part check that
// is either servo-variant based (data.variants.arms/codes, SO-101) or rule based (data.variants.checks, SVRN).

const STATUSES = ['verified', 'carried', 'unverified', 'estimate'];
const REVIEW_SIGNALS = ['variant_mismatch', 'shipping_time', 'quality', 'missing_parts', 'positive'];
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
      if (s.reviews) {
        const r = s.reviews;
        if (r.checked > gen) errors.push(`${where}: reviews checked ${r.checked} is after meta.generated ${gen}`);
        if (r.count === 0 && (r.rating != null || r.signals.length)) errors.push(`${where}: reviews with count 0 cannot have a rating or signals`);
        for (const g of r.signals) if (!REVIEW_SIGNALS.includes(g.type) || !g.note_cs || !g.note_en) errors.push(`${where}: bad review signal`);
      }
    }
  }
  // config lines and option lines share the same checks
  const lineErrors = (where, l) => {
    const c = comps[l.component];
    if (!c) { errors.push(`${where}: unknown component ${l.component}`); return; }
    const s = c.sources.find((x) => x.id === l.source);
    if (!s) { errors.push(`${where}: ${l.component} has no source "${l.source}"`); return; }
    if (!s.recommend) errors.push(`${where}: ${l.component} uses a source we do not recommend (${s.id})`);
    if (s.price == null) errors.push(`${where}: ${l.component} / ${s.id} has no price`);
    if (l.arm && !(data.variants.arms || {})[l.arm]) errors.push(`${where}: unknown arm ${l.arm}`);
  };
  for (const [cid, cfg] of Object.entries(data.configs)) {
    for (const a of cfg.arms || []) if (!(data.variants.arms || {})[a]) errors.push(`config ${cid}: unknown arm "${a}"`);
    for (const l of cfg.lines) lineErrors(`config ${cid}`, l);
    for (const alt of [].concat(cfg.alternative || [], cfg.alternatives || [])) {
      const c = comps[alt.component];
      if (!c || !c.sources.find((x) => x.id === alt.source)) errors.push(`config ${cid}: bad alternative ${alt.component}`);
      if (alt.still_needed && (!alt.still_needed_cs || alt.still_needed.length !== alt.still_needed_cs.length)) errors.push(`config ${cid}: alternative ${alt.component} needs still_needed_cs of the same length`);
    }
  }
  // screw table: every arm points to a screw list, rows have counts
  if (data.screws) {
    for (const [a, arm] of Object.entries(data.variants.arms || {})) if (!data.screws.arms[arm.screws]) errors.push(`variants.arms.${a}: unknown screw list "${arm.screws}"`);
    for (const [k, rows] of Object.entries(data.screws.arms)) for (const r of rows)
      if (!Number.isInteger(r.m2) || !Number.isInteger(r.m3) || !r.detail || !r.detail_cs) errors.push(`screws.${k}.${r.id}: needs integer m2/m3 and detail/detail_cs`);
    if (!/^https:\/\//.test(data.screws.source.url) || data.screws.checked > gen) errors.push('screws: source needs an https URL and a checked date not after meta.generated');
  }
  for (const [k, opt] of Object.entries(data.options || {})) {
    if (!opt.values[opt.default]) errors.push(`option ${k}: default "${opt.default}" is not one of its values`);
    for (const [v, val] of Object.entries(opt.values)) for (const l of val.lines) lineErrors(`option ${k}=${v}`, l);
  }
  for (const k of data.printing.service.sources) if (!data.suppliers[k]) errors.push(`printing.service: unknown supplier ${k}`);
  for (const [id, ck] of Object.entries(data.variants.checks || {})) {
    if (!comps[ck.component]) errors.push(`variants.checks.${id}: unknown component ${ck.component}`);
    for (const r of [{ re: ck.identify }, ...ck.good, ...ck.bad, ...(ck.warn || [])]) {
      try { new RegExp(r.re, 'i'); } catch { errors.push(`variants.checks.${id}: bad regex ${r.re}`); }
    }
  }
  for (const a of data.arrivals) if (!a.guide_stage && !a.link) errors.push(`arrival ${a.id}: needs guide_stage or link`);
  for (const n of [...(data.notes || []), ...(data.safety || [])]) for (const src of n.sources || []) {
    if (!/^https:\/\//.test(src.url)) errors.push(`note ${n.id}: source without https URL`);
    if (!src.checked || src.checked > gen) errors.push(`note ${n.id}: source checked date missing or after meta.generated`);
  }
  for (const arm of Object.values(data.variants.arms || {})) for (const j of arm.joints) for (const code of j.codes) {
    const v = data.variants.codes[code];
    if (!v) errors.push(`variants: unknown code ${code}`);
    else if (v.voltage_v !== arm.voltage_v) errors.push(`variants: ${code} (${v.voltage_v} V) on a ${arm.voltage_v} V arm`);
  }
  // ready-made kits: dated https sources, known shop and parts, a correct servo mix when verified, stored landed cost = computed
  const kitIds = new Set();
  for (const k of data.kits || []) {
    const where = `kit ${k.id}`;
    if (kitIds.has(k.id)) errors.push(`${where}: duplicate id`);
    kitIds.add(k.id);
    if (!/^https:\/\//.test(k.url)) errors.push(`${where}: needs an https URL`);
    if (!k.checked || k.checked > gen) errors.push(`${where}: checked date missing or after meta.generated ${gen}`);
    if (!data.suppliers[k.seller]) { errors.push(`${where}: unknown seller "${k.seller}"`); continue; }
    if (k.price[0] > k.price[1]) errors.push(`${where}: price range low > high`);
    for (const c of k.configs) if (!data.configs[c]) errors.push(`${where}: unknown config ${c}`);
    for (const x of [...k.includes, ...k.missing]) if (!comps[x.component]) errors.push(`${where}: unknown component ${x.component}`);
    for (const x of k.missing) { const c = comps[x.component]; if (c && !c.sources.some((s) => s.recommend && s.price != null)) errors.push(`${where}: missing ${x.component} has no priced recommended source`); }
    if (k.missing_other.length !== k.missing_other_cs.length) errors.push(`${where}: missing_other_cs must match missing_other`);
    if ((k.printed === 'included') === !!k.missing_print) errors.push(`${where}: printed "${k.printed}" contradicts missing_print`);
    if (k.reviews && k.reviews.checked > gen) errors.push(`${where}: reviews checked after meta.generated`);
    if (k.status === 'verified') for (const c of k.configs) {
      const v = kitVariantCheck(data, k, data.configs[c].arms || []);
      if (!v.ok) errors.push(`${where}: servo mix does not fit ${c}: ${JSON.stringify(v.problems)}`);
    }
    let landed = null;
    try { landed = kitLanded(data, k).eur; } catch (e) { errors.push(`${where}: ${e.message}`); }
    if (landed && JSON.stringify(landed) !== JSON.stringify(k.landed_eur_cz)) errors.push(`${where}: landed_eur_cz ${JSON.stringify(k.landed_eur_cz)} != computed ${JSON.stringify(landed)}`);
  }
  return errors;
}

/* ---------------- plan ---------------- */

export const CONFIGS = ['pair_74v', 'pair', 'follower_74v', 'follower_12v'];   // SO-101 (first = default); every data file lists its own in data.configs
export const PRINT = ['self', 'service'];

export function toEur(data, price, currency) {
  if (price == null) return null;
  if (currency === 'EUR') return price;
  if (currency === 'CZK') return price / data.meta.fx_czk_per_eur;
  if (currency === 'RON' && data.meta.fx_ron_per_eur) return price / data.meta.fx_ron_per_eur;
  throw new Error('no FX rate for ' + currency);
}

const maxRange = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1])];

const pickReviews = (r) => (r ? { rating: r.rating, count: r.count, checked: r.checked, url: r.url || null, signals: r.signals.map((g) => ({ ...g })) } : null);
const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/**
 * Build a purchase plan.
 * @param {object} data  data/components/<robot>.json
 * @param {{robot?: string, config?: string, print?: 'self'|'service', sources?: Object<string,string>, [option: string]: string}} opts
 *   robot/config = a key of data.configs (SO-101: pair_74v | pair | follower_74v | follower_12v; SVRN: robot_only | starter);
 *   any key of data.options (SVRN: module = flipper | wedge | grabber) picks that option's value;
 *   sources = { component id: source id } swaps a line to another recommended, priced source (e.g. when one is on backorder).
 */
export function buildPlan(data, opts = {}) {
  const configs = Object.keys(data.configs);
  const robot = opts.config || opts.robot || configs[0], print = opts.print || 'self';
  const cfg = data.configs[robot];
  if (!cfg) throw new RangeError(`unknown robot config "${robot}" (use ${configs.join(' or ')})`);
  if (!PRINT.includes(print)) throw new RangeError(`unknown print option "${print}" (use ${PRINT.join(' or ')})`);
  const comps = Object.fromEntries(data.components.map((c) => [c.id, c]));
  const fx = data.meta.fx_czk_per_eur, oss = data.meta.oss_vat_uplift;
  const groups = new Map();
  const warnings = [];
  let oldest = null, newest = null;

  // chosen options (e.g. SVRN front module): their lines join the config's lines
  const options = {}, optLines = [];
  let extraGrams = 0;
  for (const [k, opt] of Object.entries(data.options || {})) {
    const v = opts[k] || opt.default, val = opt.values[v];
    if (!val) throw new RangeError(`unknown ${k} "${v}" (use ${Object.keys(opt.values).join(', ')})`);
    options[k] = v; optLines.push(...val.lines); extraGrams += val.print_grams || 0;
  }
  const printGrams = cfg.print_grams + extraGrams;

  const swaps = opts.sources || {};
  for (const l of [...cfg.lines, ...optLines]) {
    const c = comps[l.component];
    const want = swaps[l.component];
    const swap = want && want !== l.source ? c.sources.find((x) => x.id === want && x.recommend && x.price != null) : null;
    const s = swap || c.sources.find((x) => x.id === l.source);
    const sup = data.suppliers[s.supplier];
    const packs = Math.ceil(l.qty / (s.per || 1));
    const unit = toEur(data, s.price, s.currency);
    const subtotal = round2(unit * packs);
    const eta = s.eta_days || sup.eta_days_estimate || [0, 0];
    if (!oldest || s.checked < oldest) oldest = s.checked;
    if (!newest || s.checked > newest) newest = s.checked;
    const alternatives = c.sources.filter((x) => x.id !== s.id).map((x) => ({
      id: x.id, supplier: x.supplier, label: x.label, url: x.url, price: x.price, currency: x.currency, per: x.per,
      checked: x.checked, status: x.status, recommend: x.recommend, flag: x.flag || null, stock: x.stock || null,
      selectable: !!(x.recommend && x.price != null && x.flag !== 'out_of_stock'),
      flag_reason: x.flag_reason || null, flag_reason_cs: x.flag_reason_cs || null, reviews: pickReviews(x.reviews)
    }));
    const line = {
      component: c.id, name: c.name, name_cs: c.name_cs, qty: l.qty, packs, per: s.per || 1, arm: l.arm || null,
      source: s.id, label: s.label, url: s.url, price: s.price, currency: s.currency, unit_eur: round2(unit), subtotal_eur: subtotal,
      checked: s.checked, status: s.status, stock: s.stock, eta_days: eta,
      flag: s.flag || null, flag_reason: s.flag_reason || null, flag_reason_cs: s.flag_reason_cs || null,
      note: s.note_cs ? s.note : null, note_cs: s.note_cs || null, reviews: pickReviews(s.reviews),
      default_source: l.source, swapped: !!swap,
      alternatives
    };
    for (const g of (s.reviews && s.reviews.signals) || []) if (g.type === 'variant_mismatch' || g.type === 'missing_parts')
      warnings.push({ component: c.id, source: s.id, flag: 'reviews_' + g.type, reason: g.note_en, reason_cs: g.note_cs, reviews_checked: s.reviews.checked });
    if (s.flag) warnings.push({ component: c.id, source: s.id, flag: s.flag, reason: s.flag_reason, reason_cs: s.flag_reason_cs });
    for (const a of alternatives) if (a.flag === 'mislabeled') warnings.push({ component: c.id, source: a.id, flag: a.flag, reason: a.flag_reason, reason_cs: a.flag_reason_cs, not_recommended: true });
    if (!groups.has(s.supplier)) groups.set(s.supplier, { supplier: s.supplier, name: sup.name, name_cs: sup.name_cs || sup.name, country: sup.country, url: sup.url, vat: sup.vat, lines: [] });
    groups.get(s.supplier).lines.push(line);
  }

  // printed parts. units = printed sets (SO-101: arms; SVRN: one robot)
  const arms = cfg.print_units || (cfg.arms || []).length || 1;
  const R = data.meta.robot;
  const legacy = !!cfg.arms;   // SO-101 wording and component ids
  if (print === 'self') {
    const p = data.printing.self;
    const eur = round2((printGrams / 1000) * p.filament_czk_per_kg / fx);
    const mat = p.material || 'PLA+';
    groups.set('self_print', {
      supplier: 'self_print', name: 'Printed by you', name_cs: 'Tisknete sami', country: '—', url: p.stl_url, vat: 'none', estimate: true,
      lines: [{ component: legacy ? (cfg.arms.includes('leader') ? 'so101.printed.follower+leader' : 'so101.printed.follower') : `${R}.printed`,
        name: `Filament ${mat} ≈ ${printGrams} g (estimate)`, name_cs: `Filament ${mat} ≈ ${printGrams} g (odhad)`,
        qty: 1, packs: 1, per: 1, arm: null, source: 'filament', label: mat, url: p.stl_url, price: null, currency: 'EUR', unit_eur: eur, subtotal_eur: eur,
        checked: data.meta.generated, status: p.status, stock: '', eta_days: [0, 0], flag: null, flag_reason: null, flag_reason_cs: null, note: null, note_cs: null, reviews: null, alternatives: [], print_hours: buildTime(data, arms, 'self').print_hours }],
      shipping_override: [0, 0]
    });
  } else {
    const p = data.printing.service;
    const per = p.price_eur_per_unit || p.price_eur_per_arm;
    const lo = per[0] * arms, hi = per[1] * arms;
    const sups = p.sources.map((k) => data.suppliers[k]);
    const ship = sups.reduce((r, s) => [Math.min(r[0], s.shipping_eur[0]), Math.max(r[1], s.shipping_eur[1])], [Infinity, 0]);
    groups.set('print_service', {
      supplier: 'print_service', name: 'Print service (quote)', name_cs: 'Tiskový servis (nabídka)', country: sups.map((s) => s.country).join(' / '), url: sups[0].url, vat: 'cz', estimate: true,
      services: p.sources.map((k) => ({ id: k, name: data.suppliers[k].name, url: data.suppliers[k].url })),
      lines: [{ component: `${R}.printed`,
        name: p.line_name ? fill(p.line_name, { n: arms }) : `Printed parts, ${arms} arm${arms > 1 ? 's' : ''} (estimate)`,
        name_cs: p.line_name_cs ? fill(p.line_name_cs, { n: arms }) : `Tištěné díly, ${arms === 1 ? '1 ruka' : arms + ' ruce'} (odhad)`,
        qty: arms, packs: arms, per: 1, arm: null, source: 'quote', label: sups.map((s) => s.name).join(' / '), url: sups[0].url, price: null, currency: 'EUR',
        unit_eur: null, subtotal_eur: null, range_eur: [lo, hi], checked: data.meta.generated, status: p.status, stock: '', eta_days: p.eta_days,
        flag: null, flag_reason: null, flag_reason_cs: null, note: null, note_cs: null, reviews: null, alternatives: [] }],
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
      if ((g.vat === 'cn_ioss' || g.vat === 'non_eu') && sup && sup.duty_eur_per_line) taxHi += sup.duty_eur_per_line;
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

  // ready-made alternatives (bundles, kits, printed parts): price, a landed estimate for non-EU imports, what is still needed
  const alternatives = [].concat(cfg.alternative || [], cfg.alternatives || []).map((alt) => {
    const c = comps[alt.component], s = c.sources.find((x) => x.id === alt.source), sup = data.suppliers[s.supplier];
    const price_eur = round2(toEur(data, s.price, s.currency));
    let landed = null;
    if (alt.import) {
      const im = alt.import, ship = sup.shipping_eur;
      // low: price already final, no fees; high: import VAT on goods + duty + shipping, plus the carrier's clearance fee
      const hi = (price_eur + ship[1]) * (1 + im.duty_rate[1]) * (1 + im.vat_rate) + im.clearance_eur[1];
      landed = { eur: [Math.floor(price_eur + ship[0] + im.clearance_eur[0]), Math.ceil(hi)], status: im.status, note: im.note, note_cs: im.note_cs };
    } else if (sup.vat === 'eu_oss') {
      landed = { eur: [Math.floor(price_eur + sup.shipping_eur[0]), Math.ceil(price_eur * (1 + oss) + sup.shipping_eur[1])], status: 'estimate', note: null, note_cs: null };
    }
    return { component: c.id, name: c.name, name_cs: c.name_cs, label: s.label, url: s.url, price: s.price, currency: s.currency,
      price_eur, checked: s.checked, status: s.status, stock: s.stock || null, supplier: s.supplier, note: alt.note, note_cs: alt.note_cs,
      landed, still_needed: alt.still_needed || [], still_needed_cs: alt.still_needed_cs || [], contents_source: alt.contents_source || null };
  });
  const alternative = alternatives[0] || null;
  const screws = cfg.arms && data.screws ? screwTable(data, cfg.arms) : null;
  const noteVars = data.screws ? screwVars(data) : {};

  const roundEur = (r) => [Math.floor(r[0]), Math.ceil(r[1])];
  const roundCzk = (r) => [Math.floor((r[0] * fx) / 10) * 10, Math.ceil((r[1] * fx) / 10) * 10];
  const landed = roundEur([totLo, totHi]);
  const plan = {
    robot, robot_id: R, print, options, config: { id: robot, name: cfg.name, name_cs: cfg.name_cs, arms: cfg.arms || [] },
    seller_of_record: 'each supplier (we are not the seller and never place orders)',
    affiliate_links: !!data.meta.affiliate_links,
    groups: out,
    totals: {
      goods_eur: [round2(goodsLo), round2(goodsHi)],
      landed_eur: landed,
      landed_czk: roundCzk([totLo, totHi]),
      includes: 'goods incl. VAT, EU OSS VAT uplift (up to +1.7 %), non-EU duty where applicable, shipping estimate',
      fx_czk_per_eur: fx
    },
    eta_days: eta,
    checked: { oldest, newest },
    warnings,
    variants: cfg.arms ? requiredVariants(data, cfg.arms) : [],
    checks: partChecks(data),
    tools: data.tools.filter((t) => (!t.only_print || t.only_print === print) && (!t.only_config || t.only_config === robot)),
    tools_note: data.tools_note || null, tools_note_cs: data.tools_note_cs || null,
    build_time: build,
    arrivals: data.arrivals.filter((a) => (!a.only_config || a.only_config === robot) && (!a.only_option || Object.entries(a.only_option).every(([k, v]) => [].concat(v).includes(options[k])))),
    notes: (data.notes || []).filter((n) => !n.only_option || Object.entries(n.only_option).every(([k, v]) => [].concat(v).includes(options[k])))
      .map((n) => ({ ...n, text: fill(n.text, noteVars), text_cs: fill(n.text_cs, noteVars) })),
    safety: data.safety || [],
    screws,
    alternative, alternatives
  };
  // ready-made kits vs. parts bought separately (SO-101: data.kits), compared against this plan's own total
  plan.kits = data.kits ? compareKits(data, plan) : null;
  return plan;
}

/* ---------------- ready-made kits ---------------- */

/** EU low-value import limit: up to 150 € VAT goes through IOSS at checkout; above it there is no IOSS. */
export const IOSS_LIMIT_EUR = 150;
const KIT_BLOCKERS = ['not_verified', 'variant_mismatch', 'out_of_stock', 'business_only', 'no_cz_shipping'];

/**
 * Landed cost of a kit delivered to CZ, in EUR [low, high].
 * EU seller: price incl. VAT + shipping, plus the OSS uplift (DE 19 % → CZ 21 %) on the high end.
 * Non-EU import (kit.import), customs value = goods + shipping:
 *   ≤ 150 € → IOSS: VAT charged at checkout, plus the flat EU duty per line (supplier.duty_eur_per_line);
 *   > 150 € → no IOSS: 21 % import VAT on (value + duty), the duty and the carrier's clearance fee.
 *   import.price_includes_vat: true (seller ships duty paid), false (VAT always due), null (unknown → low end without it).
 */
export function kitLanded(data, kit) {
  const sup = data.suppliers[kit.seller];
  const p = kit.price.map((x) => toEur(data, x, kit.currency));
  const ship = kit.shipping_eur || sup.shipping_eur;
  const value = [p[0] + ship[0], p[1] + ship[1]];
  if (!kit.import) {
    const up = sup.vat === 'eu_oss' ? data.meta.oss_vat_uplift : 0;
    return { eur: [Math.floor(value[0]), Math.ceil(p[1] * (1 + up) + ship[1])], basis: sup.vat === 'eu_oss' ? 'eu_oss' : 'domestic', status: sup.shipping_status };
  }
  const im = kit.import, duty = sup.duty_eur_per_line || 0;
  const bound = (v, i) => {
    if (v <= IOSS_LIMIT_EUR) return v + duty;
    const d = im.duty_rate[i], fee = im.clearance_eur[i];
    const vatDue = im.price_includes_vat === false || (im.price_includes_vat == null && i === 1);
    return v * (1 + d) * (vatDue ? 1 + im.vat_rate : 1) + fee;
  };
  return { eur: [Math.floor(bound(value[0], 0)), Math.ceil(bound(value[1], 1))], basis: value[1] > IOSS_LIMIT_EUR ? 'import_vat' : 'ioss', status: im.status || 'estimate' };
}

/** Does a kit's servo mix (kit.servos: per arm voltage, gear-ratio counts, optional code counts) fit the arms? */
export function kitVariantCheck(data, kit, arms) {
  const problems = [];
  for (const a of arms) {
    const arm = data.variants.arms[a], have = (kit.servos || {})[a];
    if (!have) { problems.push({ arm: a, issue: 'missing_arm' }); continue; }
    if (have.voltage_v !== arm.voltage_v) problems.push({ arm: a, issue: 'voltage', expected: arm.voltage_v, found: have.voltage_v });
    const need = {};
    for (const j of arm.joints) { const r = data.variants.codes[j.codes[0]].gear_ratio; need[r] = (need[r] || 0) + 1; }
    for (const r of new Set([...Object.keys(need), ...Object.keys(have.ratios || {})]))
      if ((need[r] || 0) !== ((have.ratios || {})[r] || 0)) problems.push({ arm: a, issue: 'gear_ratio', ratio: r, expected: need[r] || 0, found: (have.ratios || {})[r] || 0 });
    if (have.codes) {
      const allowed = new Set(arm.joints.flatMap((j) => j.codes));
      for (const [c, n] of Object.entries(have.codes)) {
        const v = data.variants.codes[c];
        if (!allowed.has(c) || !v) problems.push({ arm: a, issue: 'code', code: c });
        else if ((have.ratios || {})[v.gear_ratio] == null || n > have.ratios[v.gear_ratio]) problems.push({ arm: a, issue: 'code_ratio', code: c });
      }
    }
  }
  return { ok: problems.length === 0, codes_named: arms.every((a) => !!((kit.servos || {})[a] || {}).codes), problems };
}

/**
 * Kits for the plan's configuration, each with its landed cost, what is still missing (priced from this plan's own
 * sources: e.g. power supplies, printed parts per the chosen print option) and a total; plus the recommendation.
 * Recommendation = the cheapest total (upper bound, then lower) among kits that are verified, have the right servo mix,
 * are in stock, sell to consumers and are not known to skip CZ; the kit is recommended only when that total is not above
 * the parts plan's upper bound. Never by commission: there are no affiliate links.
 */
export function compareKits(data, plan) {
  const cfg = data.configs[plan.robot], arms = cfg.arms || [];
  const comps = Object.fromEntries(data.components.map((c) => [c.id, c]));
  const parts = plan.totals.landed_eur;
  const printGroup = plan.groups.find((g) => g.supplier === 'self_print' || g.supplier === 'print_service');
  const printCost = printGroup ? printGroup.landed_eur : [0, 0];
  const kits = data.kits.filter((k) => k.configs.includes(plan.robot)).map((k) => {
    const landed = kitLanded(data, k);
    const variant = kitVariantCheck(data, k, arms);
    // missing parts: the source this plan uses for that component (else its first recommended priced source), shipping once per shop
    const missing = [], shipBy = new Map();
    let mLo = 0, mHi = 0;
    for (const m of k.missing) {
      const c = comps[m.component];
      const line = cfg.lines.find((l) => l.component === m.component);
      const s = (line && c.sources.find((x) => x.id === line.source)) || c.sources.find((x) => x.recommend && x.price != null);
      const sup = data.suppliers[s.supplier];
      const eur = round2(toEur(data, s.price, s.currency) * Math.ceil(m.qty / (s.per || 1)));
      mLo += eur; mHi += eur * (sup.vat === 'eu_oss' ? 1 + data.meta.oss_vat_uplift : 1);
      shipBy.set(s.supplier, sup.shipping_eur);
      missing.push({ component: c.id, name: c.name, name_cs: c.name_cs, qty: m.qty, source: s.id, label: s.label, url: s.url, supplier: s.supplier, eur });
    }
    for (const sh of shipBy.values()) { mLo += sh[0]; mHi += sh[1]; }
    if (k.missing_print) {
      mLo += printCost[0]; mHi += printCost[1];
      missing.push({ component: arms.includes('leader') ? 'so101.printed.follower+leader' : 'so101.printed.follower', name: 'Printed parts (per your print option)', name_cs: 'Tištěné díly (podle zvoleného tisku)',
        qty: Math.max(1, arms.length), source: plan.print, label: printGroup ? printGroup.name : '', url: null, supplier: printGroup ? printGroup.supplier : null, eur_range: printCost });
    }
    const missingEur = [Math.floor(mLo), Math.ceil(mHi)];
    const total = [landed.eur[0] + missingEur[0], landed.eur[1] + missingEur[1]];
    const blockers = [];
    if (k.status !== 'verified') blockers.push('not_verified');
    if (!variant.ok) blockers.push('variant_mismatch');
    if (k.in_stock === false) blockers.push('out_of_stock');
    if (k.buyers === 'business_only') blockers.push('business_only');
    if (k.ships_cz === 'no') blockers.push('no_cz_shipping');
    const sup = data.suppliers[k.seller];
    return {
      id: k.id, name: k.name, name_cs: k.name_cs, seller: k.seller, seller_name: sup.name, country: sup.country, url: k.url,
      price: k.price, currency: k.currency, price_eur: k.price.map((x) => round2(toEur(data, x, k.currency))), price_note: k.price_note || null, price_note_cs: k.price_note_cs || null,
      landed_eur: landed.eur, landed_basis: landed.basis, import: k.import ? { ...k.import } : null,
      missing, missing_eur: missingEur, missing_other: k.missing_other, missing_other_cs: k.missing_other_cs,
      total_eur: total, includes: k.includes.map((x) => ({ ...x })), printed: k.printed, assembled: k.assembled,
      variant, ships_cz: k.ships_cz, buyers: k.buyers, in_stock: k.in_stock, stock: k.stock, eta_days: k.eta_days || null,
      checked: k.checked, status: k.status, note: k.note, note_cs: k.note_cs, reviews: pickReviews(k.reviews),
      eligible: blockers.length === 0, blockers
    };
  });
  kits.sort((a, b) => b.eligible - a.eligible || a.total_eur[1] - b.total_eur[1] || a.total_eur[0] - b.total_eur[0]);
  const best = kits.find((k) => k.eligible) || null;
  let recommendation;
  if (!best) recommendation = { choice: 'parts', reason: kits.length ? 'no_eligible_kit' : 'no_kit', kit: null, parts_eur: parts };
  else if (best.total_eur[1] <= parts[1]) recommendation = { choice: 'kit', reason: 'kit_cheaper_or_equal', kit: best.id, kit_total_eur: best.total_eur, parts_eur: parts, difference_eur: parts[1] - best.total_eur[1] };
  else recommendation = { choice: 'parts', reason: 'parts_cheaper', kit: best.id, kit_total_eur: best.total_eur, parts_eur: parts, difference_eur: best.total_eur[1] - parts[1] };
  recommendation.basis = 'cheapest landed total (upper bound) among verified, in-stock kits with the right servo mix that sell to consumers; compared with the parts plan total for the same print option; no affiliate links';
  return { config: plan.robot, print: plan.print, kits, best: best ? best.id : null, recommendation };
}

/** "Ready-made kits from X €": the lowest landed cost of an eligible kit for any of the given configurations (default: all). */
export function kitsFromEur(data, configs = Object.keys(data.configs)) {
  const ok = (data.kits || []).filter((k) => k.status === 'verified' && k.in_stock !== false && k.buyers !== 'business_only' && k.ships_cz !== 'no'
    && k.configs.some((c) => configs.includes(c) && kitVariantCheck(data, k, data.configs[c].arms || []).ok));
  return ok.length ? Math.min(...ok.map((k) => kitLanded(data, k).eur[0])) : null;
}

/**
 * Screws per arm (data.screws, from the official assembly steps): rows per joint and totals, for the plan page,
 * the MCP tool, the assembly guide and the checklist (tools/build.mjs expands {sc:…} tokens from this).
 * @param {string[]} arms  arm ids from data.variants.arms (e.g. ['follower_74v', 'leader'])
 */
export function screwTable(data, arms) {
  const S = data.screws;
  const per = arms.map((a) => {
    const kind = data.variants.arms[a].screws, rows = S.arms[kind];
    return { arm: a, kind, rows: rows.map((r) => ({ ...r })), m2: rows.reduce((t, r) => t + r.m2, 0), m3: rows.reduce((t, r) => t + r.m3, 0) };
  });
  return {
    sizes: S.sizes, status: S.status, checked: S.checked, source: S.source, counting: S.counting, counting_cs: S.counting_cs,
    included: S.included, included_note: S.included_note, included_note_cs: S.included_note_cs,
    arms: per, total: { m2: per.reduce((t, a) => t + a.m2, 0), m3: per.reduce((t, a) => t + a.m3, 0) }
  };
}
function screwVars(data) {
  const sum = (k, f) => data.screws.arms[k].reduce((t, r) => t + r[f], 0);
  return { f_m2: sum('follower', 'm2'), f_m3: sum('follower', 'm3'), l_m2: sum('leader', 'm2'), l_m3: sum('leader', 'm3') };
}

/** Rule-based part checks (data.variants.checks), summarised for the page and the MCP tool. */
export function partChecks(data) {
  return Object.entries((data.variants && data.variants.checks) || {}).map(([id, c]) => ({
    id, component: c.component, name: c.name, name_cs: c.name_cs, need: c.need, need_cs: c.need_cs, avoid: c.avoid, avoid_cs: c.avoid_cs, status: c.status
  }));
}

/**
 * Build-time estimate from the guide's stages (data.build_time.stages): the plan page, the MCP tool and the
 * assembly guide (navody/so101-sestaveni, expanded by tools/build.mjs) all read this, so they always agree.
 * Stages with h_per_arm scale with the number of arms; only_print stages drop out for the other print option.
 */
export function buildTime(data, arms, print = 'self') {
  const bt = data.build_time;
  const stages = bt.stages.filter((st) => !st.only_print || st.only_print === print).map((st) => {
    const pa = st.h_per_arm || st.h_per_unit;
    const h = pa ? [pa[0] * arms, pa[1] * arms] : st.h;
    return { id: st.id, name: st.name, name_cs: st.name_cs, hours: [round2(h[0]), round2(h[1])], optional: !!st.optional, per_arm: pa || null };
  });
  const lo = stages.reduce((a, st) => a + st.hours[0], 0), hi = stages.reduce((a, st) => a + st.hours[1], 0);
  const printer = print === 'self' ? round2((bt.printer_h_per_unit ?? bt.printer_h_per_arm) * arms) : 0;
  return {
    status: 'estimate', arms, print,
    stages,
    work_hours: [Math.round(lo), Math.ceil(hi)],
    print_hours: [printer, printer],
    guide: bt.guide, guide_external: /^https:/.test(bt.guide.en)
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
  if (data.variants.checks) return checkPartSpec(data, text, expect);
  if (/^kit:/.test(String(expect || '').trim())) return checkKitListing(data, text, String(expect).trim().slice(4));
  const V = data.variants;
  let allowed, voltage, ratios, label;
  const e = String(expect || '').trim();
  const mJoint = /^([a-z0-9_]+):([1-6])$/.exec(e);
  if (mJoint && !V.arms[mJoint[1]]) throw new RangeError(`unknown arm "${mJoint[1]}" (use ${Object.keys(V.arms).join(', ')})`);
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
    match: ['The listing names the right variant. When the servos arrive, keep the parcel separate and label every servo straight away.', 'Inzerát uvádí správnou variantu. Po doručení držte balík zvlášť a každé servo hned popište.'],
    likely: ['Voltage and gear ratio fit, but no variant code is named. Ask the seller for the code before ordering.', 'Napětí a převod sedí, ale kód varianty chybí. Před objednáním se zeptejte prodejce na kód.'],
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

/** Servo counts in kit listing text: "2 × 1:191", "1:345 x6", "3× STS3215 1/147", "1 × C001", "C018 x 6". */
export function parseKitListing(text) {
  let t = String(text || '').slice(0, 5000);
  const ratios = {}, codes = {};
  const add = (o, k, n) => { o[k] = (o[k] || 0) + Number(n); };
  const R = '1\\s*[:/]\\s*(345|191|147)(?!\\d)', C = '(?:STS?-?3215-?)?C0?(001|018|044|046|047|01|18|44|46|47)(?!\\d)', X = '\\s*[×xX*]\\s*';
  const take = (re, f) => { t = t.replace(new RegExp(re, 'g'), (...m) => { f(m); return ' '; }); };
  const code = (c) => 'C0' + c.replace(/^0/, '').padStart(2, '0');
  // codes first, then ratios; the gap between a count and its ratio may not hold another count or a code
  const gap = (n) => `(?:(?!\\d{1,2}${X}|C0?\\d{2}|1\\s*[:/]\\s*\\d{3})[^\\n;]){0,${n}}?`;
  take(`(?<![\\d.,])(\\d{1,2})${X}${gap(20)}${C}`, (m) => add(codes, code(m[2]), m[1]));
  take(`${C}${X}(\\d{1,2})(?!\\d)`, (m) => add(codes, code(m[1]), m[2]));
  take(`(?<![\\d.,])(\\d{1,2})${X}${gap(40)}${R}`, (m) => add(ratios, '1/' + m[2], m[1]));
  take(`${R}\\)?${X}(\\d{1,2})(?!\\d)`, (m) => add(ratios, '1/' + m[1], m[2]));
  const { voltages } = parseListing(text);
  return { ratios, codes, voltages };
}

/**
 * Check a ready-made kit listing (pasted text) against a configuration's servo mix, e.g. expect "pair" (7.4 V leader + 12 V follower).
 * Counts gear ratios and codes over the whole kit, checks the follower voltage, and names a kit from our data
 * when the text contains its URL or item number.
 */
export function checkKitListing(data, text, config) {
  const cfg = data.configs[config];
  if (!cfg || !cfg.arms) throw new RangeError(`unknown kit config "${config}" (use kit:${Object.keys(data.configs).join(', kit:')})`);
  const V = data.variants;
  const need = {}, allowed = new Set(), volts = new Set();
  for (const a of cfg.arms) {
    volts.add(V.arms[a].voltage_v);
    for (const j of V.arms[a].joints) { const r = V.codes[j.codes[0]].gear_ratio; need[r] = (need[r] || 0) + 1; j.codes.forEach((c) => allowed.add(c)); }
  }
  const f = parseKitListing(text);
  // counted ratios + ratios of counted codes (their text spans never overlap)
  for (const [c, n] of Object.entries(f.codes)) if (V.codes[c]) f.ratios[V.codes[c].gear_ratio] = (f.ratios[V.codes[c].gear_ratio] || 0) + n;
  const t = String(text || '');
  // a kit from our data: its URL, or its shop item number in the name, e.g. "(ER01050)" (not "ER01050-F")
  const item = (k) => (/\(([A-Z]{2}\d{5}(?:-[A-Z0-9]+)?)\)/.exec(k.name) || [])[1];
  const known = (data.kits || []).find((k) => t.includes(k.url) || (item(k) && new RegExp(`(?<![A-Z0-9-])${item(k)}(?![A-Z0-9-])`).test(t)));
  const mismatches = [], warnings = [];
  const fr = Object.keys(f.ratios);
  const ratioExact = fr.length > 0 && Object.keys(need).every((r) => f.ratios[r] === need[r]) && fr.every((r) => need[r]);
  for (const r of fr) if (!need[r] || f.ratios[r] > need[r]) mismatches.push({ field: 'gear_ratio', ratio: r, expected: need[r] || 0, found: f.ratios[r] });
  for (const c of Object.keys(f.codes)) if (!allowed.has(c)) mismatches.push({ field: 'code', expected: [...allowed], found: c });
  const wants12 = volts.has(12);
  if (wants12 && f.voltages.length && !f.voltages.includes(12)) mismatches.push({ field: 'voltage_v', expected: [...volts], found: f.voltages });
  if (!wants12 && f.voltages.includes(12)) {
    if (f.voltages.includes(7.4)) warnings.push({ code: 'multiple_variants', detail: 'The listing mentions 7.4 V and 12 V: make sure you select the 7.4 V follower.', detail_cs: 'Inzerát zmiňuje 7,4 V i 12 V: ověřte, že vybíráte follower 7,4 V.' });
    else mismatches.push({ field: 'voltage_v', expected: [...volts], found: f.voltages });
  }
  if (wants12 && !f.voltages.includes(12) && !f.codes.C018 && !f.codes.C047) warnings.push({ code: 'no_voltage', detail: 'The text does not say the follower is 12 V.', detail_cs: 'Text neuvádí, že follower je 12 V.' });
  if (fr.length && !ratioExact && !mismatches.length) warnings.push({ code: 'incomplete', detail: 'Some servos in the kit are not described in the text.', detail_cs: 'Část serv sady text nepopisuje.' });
  if (known && known.status === 'verified' && !kitVariantCheck(data, known, cfg.arms).ok) mismatches.push({ field: 'kit', expected: config, found: known.id });
  const multi = warnings.some((w) => w.code === 'multiple_variants');
  let verdict;
  if (mismatches.length) verdict = 'mismatch';
  else if (multi) verdict = 'check_selection';
  else if (ratioExact && (wants12 ? f.voltages.includes(12) || f.codes.C018 : true)) verdict = 'match';
  else if (fr.length || Object.keys(f.codes).length || (known && known.configs.includes(config))) verdict = 'likely';
  else verdict = 'unknown';
  const mix = Object.entries(need).map(([r, n]) => `${n}× ${r}`).join(', ');
  const ADVICE = {
    match: [`The kit’s servo mix fits (${mix}). Label every servo when it arrives.`, `Serva v sadě sedí (${mix}). Po doručení každé servo popište.`],
    likely: [`Nothing contradicts the mix this configuration needs (${mix}), but the text does not show all of it. Ask the seller for the per-joint list.`, `Nic neodporuje potřebné sestavě (${mix}), ale text ji neukazuje celou. Zeptejte se prodejce na seznam po kloubech.`],
    check_selection: ['The listing offers several variants. Make sure the option you select is the right one.', 'Inzerát nabízí více variant. Ověřte, že vybíráte tu správnou.'],
    mismatch: [`This kit does not have the servo mix this configuration needs (${mix}).`, `Tato sada nemá sestavu serv, kterou konfigurace potřebuje (${mix}).`],
    inconsistent: ['', ''],
    unknown: [`Not enough information in the text. Look for the servo list: ${mix}${wants12 ? ', follower 12 V' : ''}.`, `V textu chybí údaje. Hledejte seznam serv: ${mix}${wants12 ? ', follower 12 V' : ''}.`]
  };
  return {
    expected: { label: `kit:${config}`, codes: [...allowed], voltage_v: wants12 ? 12 : 7.4, gear_ratios: Object.keys(need), ratio_counts: need },
    found: { codes: Object.keys(f.codes), voltages: f.voltages, ratios: fr, ratio_counts: f.ratios, code_counts: f.codes },
    verdict, ok: verdict === 'match' || verdict === 'likely', mismatches, warnings,
    known_kit: known ? { id: known.id, name: known.name, status: known.status, checked: known.checked, configs: known.configs } : null,
    advice: ADVICE[verdict][0], advice_cs: ADVICE[verdict][1]
  };
}

/**
 * Rule-based check of a listing against one part of a robot (data.variants.checks; SVRN: esc, motor, servo, lipo).
 * Each check has regexes: identify (is this the kind of part), good (signals of the right spec),
 * bad (signals of a wrong spec, with a reason) and warn (things to double-check). Only parses the given text.
 */
export function checkPartSpec(data, text, expect) {
  const checks = data.variants.checks;
  const id = String(expect || '').trim().replace(/^[a-z0-9]+:/, '');
  const ck = checks[id];
  if (!ck) throw new RangeError(`unknown part "${expect}": use ${Object.keys(checks).join(', ')}`);
  const t = String(text || '').slice(0, 5000);
  const hit = (re) => { const m = new RegExp(re, 'i').exec(t); return m ? m[0] : null; };
  const identified = !!hit(ck.identify);
  const good = ck.good.map((g) => ({ ...g, m: hit(g.re) })).filter((g) => g.m);
  const bad = ck.bad.map((g) => ({ ...g, m: hit(g.re) })).filter((g) => g.m);
  const warnings = (ck.warn || []).map((g) => ({ ...g, m: hit(g.re) })).filter((g) => g.m)
    .map((g) => ({ code: 'check', found: g.m, detail: g.reason, detail_cs: g.reason_cs }));
  const voltages = [...new Set([...t.matchAll(/(?<![\d.,])(\d{1,2}(?:[.,]\d)?)\s*V(?![a-zA-Z])/g)].map((m) => Number(m[1].replace(',', '.'))))];
  let verdict;
  if (good.length && bad.length) verdict = 'check_selection';
  else if (bad.length) verdict = 'mismatch';
  else if (good.length) verdict = identified ? 'match' : 'likely';
  else verdict = 'unknown';
  const mismatches = bad.map((b) => ({ field: 'spec', expected: ck.need, found: b.m, reason: b.reason, reason_cs: b.reason_cs }));
  const ADVICE = {
    match: ['The listing shows the spec this part needs. Still check the label or datasheet when it arrives.', 'Inzerát uvádí parametry, které díl potřebuje. Po doručení je stejně zkontrolujte na štítku nebo v datasheetu.'],
    likely: ['The spec fits, but the text does not clearly say what part it is. Check the listing title.', 'Parametry sedí, ale z textu není jasné, o jaký díl jde. Zkontrolujte název inzerátu.'],
    check_selection: ['The listing mentions both a fitting and an unsuitable option. Make sure you select the right one.', 'Inzerát zmiňuje vhodnou i nevhodnou variantu. Ověřte, že vybíráte tu správnou.'],
    mismatch: ['This listing does not fit this part. Do not order it for this robot.', 'Tento inzerát pro tento díl nesedí. Pro tohoto robota ho neobjednávejte.'],
    unknown: [`Not enough information in the text. Look for: ${ck.need}`, `V textu chybí údaje. Hledejte: ${ck.need_cs}`]
  };
  const why = bad[0] ? [' ' + bad[0].reason, ' ' + bad[0].reason_cs] : ['', ''];
  return {
    expected: { label: ck.name, codes: [], voltage_v: ck.voltage_v ?? null, gear_ratios: [], need: ck.need, need_cs: ck.need_cs },
    found: { codes: [], voltages, ratios: [], signals: good.map((g) => g.what), problems: bad.map((b) => b.m) },
    verdict, ok: verdict === 'match' || verdict === 'likely', mismatches, warnings,
    advice: ADVICE[verdict][0] + why[0], advice_cs: ADVICE[verdict][1] + why[1]
  };
}

export { STATUSES, REVIEW_SIGNALS, KIT_BLOCKERS };
