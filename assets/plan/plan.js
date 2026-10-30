// /plan/<robot>/ and /en/plan/<robot>/ (so101, svrn): renders the purchase plan from data/components/<robot>.json.
// The page says which robot via data-robot on #plan; every radio group in #plan-form is a plan option
// (robot = config, print, and any data.options group such as the SVRN module).
// State (configuration, ticks, tracking numbers) lives only in this browser (localStorage, guarded).
// No network calls besides loading the data file; no carrier APIs; no accounts.
import { buildPlan, checkPartVariant } from './plan-core.mjs';

const host = document.getElementById('plan');
const L = host.dataset.lang === 'en' ? 'en' : 'cs';
const ROOT = host.dataset.root || '../../';
const ROBOT = /^[a-z0-9]+$/.test(host.dataset.robot || '') ? host.dataset.robot : 'so101';
const KEY = 'pr-plan-' + ROBOT;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const S = {
  cs: {
    total: 'Celkem s DPH a dopravou', goods: 'zboží', eta: 'Doručení', days: 'dní', slowest: 'podle nejpomalejší položky',
    build: 'Čas stavby (odhad)', print: 'tisk', work: 'práce', h: 'h', est: 'odhad', perPiece: '/ ks',
    qty: 'ks', ordered: 'Objednáno', open: 'Otevřít u dodavatele', alt: 'Další zdroje', notRec: 'nedoporučujeme',
    ship: 'Doprava', vat: { eu_oss: 'cena s DPH (DE 19 %), při OSS až +1,7 %', cz: 'cena s 21 % DPH', cz_nonvat: 'konečná cena (neplátce DPH)', cn_ioss: 'DPH přes IOSS, clo 3 € za položku', non_eu: 'dovoz mimo EU: DPH a clo 3 € za položku', per_vendor: 'DPH podle zvoleného dodavatele', none: '' },
    landed: 'Celkem s dopravou', subtotal: 'Zboží', status: { verified: 'ověřeno', carried: 'převzato', unverified: 'neověřeno', estimate: 'odhad' },
    joint: 'Kloub', code: 'Kód', volt: 'Napětí', ratio: 'Převod', follower_12v: 'Follower 12 V', follower_74v: 'Follower 7,4 V', leader: 'Leader 7,4 V',
    jn: { shoulder_pan: 'základna', shoulder_lift: 'rameno', elbow_flex: 'loket', wrist_flex: 'zápěstí', wrist_roll: 'rotace zápěstí', gripper: 'chapadlo' },
    flagsH: 'Zdroje, které nedoporučujeme nebo kde je třeba dát pozor', allJoints: 'všechny klouby', jointN: (a, j, n) => `${a}, kloub ${j} (${n})`,
    verdict: { match: 'Sedí', likely: 'Pravděpodobně sedí', check_selection: 'Zkontrolujte vybranou variantu', mismatch: 'Nesedí', inconsistent: 'Nedoporučujeme: inzerát si odporuje', unknown: 'Nelze určit' },
    found: 'V textu', none: 'nic', tools: 'Šrouby a horny serv: viz tabulka šroubů.', time: (p, w) => `${p ? `Tisk ${p} h (tiskárna běží sama) a ` : ''}${w} h práce podle etap návodu. Je to odhad, ne slib.`, guide: 'Návod na sestavení', stage: 'Etapa', optStage: 'volitelné', guideFor: 'v návodu: etapa',
    printNote: 'Tisk', track: 'Číslo zásilky', trackHint: 'jen u vás v prohlížeči', optional: 'volitelné',
    altH: 'Alternativa pro pár', altNote: 'Cena bez dopravy a cla, převzato', service: 'Nabídku udělá', checked: 'ověřeno',
    req: 'nutné', opt: 'volitelné', backorder: 'Sklad', printed_by_you: 'Soubory STL', fx: 'Kurz',
    part: 'Díl', need: 'Co hledat', avoid: 'Čemu se vyhnout', partFor: 'Který díl', srcs: 'Zdroje', checkedOn: 'ověřeno',
    rv: (d) => `Co píšou kupující (k ${d})`, rvNone: 'zatím žádné recenze', rvNull: 'recenze se nepodařilo přečíst', rvCount: (n) => `${n} ${n === 1 ? 'recenze' : n < 5 ? 'recenze' : 'recenzí'}`,
    rvType: { variant_mismatch: 'jiná varianta', shipping_time: 'doručení', quality: 'kvalita', missing_parts: 'chybějící díly', positive: 'kladně' },
    noteLevel: { verify: 'Ověřte', changed: 'Změna', info: 'Info' }, guideExt: 'návod projektu',
    found2: 'V textu nalezeno', problems: 'Problém',
    backorderNote: (d) => `Na objednávku${d ? ` do ${d}` : ''}. Nechcete čekat? V „Další zdroje“ můžete zvolit jiný zdroj.`,
    useSrc: 'Použít tento zdroj', useDefault: 'Zpět na doporučený zdroj', swapped: 'Zvolili jste jiný než doporučený zdroj.',
    altsH: 'Hotové sady a díly místo jednotlivých položek', landedEst: 'S dopravou a dovozem (odhad)', landedEu: 'S dopravou (odhad)', stillNeeded: 'Ještě budete potřebovat',
    contents: 'Obsah sady podle', from: 'cena',
    sc: { h: 'Šrouby na ruku', part: 'Kloub', total: 'Celkem', follower: 'Follower', leader: 'Leader', pair: 'Pro celý plán', src: 'Zdroj' },
    cfgNote: 'Bez leaderu ruku po kalibraci rozhýbete jen přehráním nahraného pohybu (lerobot-replay), například datasetu z návodu se simulací. Teleoperace a vlastní ukázky potřebují leader.'
  },
  en: {
    total: 'Total incl. VAT and shipping', goods: 'goods', eta: 'Delivery', days: 'days', slowest: 'set by the slowest line',
    build: 'Build time (estimate)', print: 'print', work: 'work', h: 'h', est: 'estimate', perPiece: '/ pc',
    qty: 'pcs', ordered: 'Ordered', open: 'Open at supplier', alt: 'Other sources', notRec: 'not recommended',
    ship: 'Shipping', vat: { eu_oss: 'price incl. VAT (DE 19 %), up to +1.7 % with OSS', cz: 'price incl. 21 % VAT', cz_nonvat: 'final price (not a VAT payer)', cn_ioss: 'VAT via IOSS, 3 € duty per line', non_eu: 'non-EU import: VAT and 3 € duty per line', per_vendor: 'VAT depends on the vendor', none: '' },
    landed: 'Landed', subtotal: 'Goods', status: { verified: 'verified', carried: 'carried', unverified: 'unverified', estimate: 'estimate' },
    joint: 'Joint', code: 'Code', volt: 'Voltage', ratio: 'Gear ratio', follower_12v: 'Follower 12 V', follower_74v: 'Follower 7.4 V', leader: 'Leader 7.4 V',
    jn: { shoulder_pan: 'base', shoulder_lift: 'shoulder', elbow_flex: 'elbow', wrist_flex: 'wrist', wrist_roll: 'wrist roll', gripper: 'gripper' },
    flagsH: 'Sources we do not recommend or that need care', allJoints: 'all joints', jointN: (a, j, n) => `${a}, joint ${j} (${n})`,
    verdict: { match: 'Matches', likely: 'Probably matches', check_selection: 'Check the selected variant', mismatch: 'Does not match', inconsistent: 'Not recommended: the listing contradicts itself', unknown: 'Cannot tell' },
    found: 'Found', none: 'nothing', tools: 'Servo screws and horns: see the screw table.', time: (p, w) => `${p ? `Printing ${p} h (unattended) and ` : ''}${w} h of work across the guide’s stages. This is an estimate, not a promise.`, guide: 'Assembly guide', stage: 'Stage', optStage: 'optional', guideFor: 'guide: stage',
    printNote: 'Print', track: 'Tracking number', trackHint: 'stored only in your browser', optional: 'optional',
    altH: 'Alternative for a pair', altNote: 'Price without shipping and duty, carried', service: 'Get a quote from', checked: 'checked',
    req: 'required', opt: 'optional', backorder: 'Stock', printed_by_you: 'STL files', fx: 'FX',
    part: 'Part', need: 'Look for', avoid: 'Avoid', partFor: 'Which part', srcs: 'Sources', checkedOn: 'checked',
    rv: (d) => `What buyers say (as of ${d})`, rvNone: 'no reviews yet', rvNull: 'reviews could not be read', rvCount: (n) => `${n} review${n === 1 ? '' : 's'}`,
    rvType: { variant_mismatch: 'wrong variant', shipping_time: 'delivery', quality: 'quality', missing_parts: 'missing parts', positive: 'positive' },
    noteLevel: { verify: 'Verify', changed: 'Changed', info: 'Info' }, guideExt: 'project guide',
    found2: 'Found in the text', problems: 'Problem',
    backorderNote: (d) => `On backorder${d ? ` until ${d}` : ''}. Don’t want to wait? Pick another source under “Other sources”.`,
    useSrc: 'Use this source', useDefault: 'Back to the recommended source', swapped: 'You picked a source other than the recommended one.',
    altsH: 'Ready-made kits and parts instead of single lines', landedEst: 'Landed incl. import (estimate)', landedEu: 'Landed (estimate)', stillNeeded: 'You will still need',
    contents: 'Kit contents per', from: 'price',
    sc: { h: 'Screws per arm', part: 'Joint', total: 'Total', follower: 'Follower', leader: 'Leader', pair: 'For the whole plan', src: 'Source' },
    cfgNote: 'Without a leader, after calibration you can only move the arm by replaying recorded motion (lerobot-replay), for example a dataset from the simulation guide. Teleoperation and your own demonstrations need a leader.'
  }
}[L];

const nf = new Intl.NumberFormat(L === 'en' ? 'en-GB' : 'cs-CZ', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat(L === 'en' ? 'en-GB' : 'cs-CZ', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const eur = (x) => `${nf2.format(x)} €`;
const rng = (r, unit = '') => (r[0] === r[1] ? `${nf.format(r[0])}${unit}` : `${nf.format(r[0])}–${nf.format(r[1])}${unit}`);
const date = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
const pick = (o, k) => (L === 'cs' && o[k + '_cs']) || o[k];
const CZK = L === 'en' ? ' CZK' : ' Kč';
const money = (price, cur) => cur === 'CZK' ? `${nf.format(price)}${CZK}` : cur === 'EUR' ? eur(price) : `${nf.format(price)} ${cur}`;
const stock = (t) => L === 'en' ? t : String(t)
  .replace(/^Backorder: (\d+) expected (\d{4}-\d\d-\d\d)$/, (m, n, d) => `na objednávku, naskladnění ${date(d)}`)
  .replace(/^Available$/, 'skladem').replace(/^Available \(rarely stocked\)$/, 'skladem (zřídka naskladňováno)').replace(/^In store \/ 1–2 days$/, 'na prodejně / 1–2 dny').replace(/^>(\d+) pcs$/, '>$1 ks')
  .replace(/^Not shown$/, 'neuvedeno').replace(/ sold$/, ' prodáno')
  .replace(/^In stock \((\d+) pcs\)$/, 'skladem ($1 ks)').replace(/^In stock$/, 'skladem').replace(/^Out of stock$/, 'vyprodáno');
// the assembly guide: ours (relative path with #stage anchors) or the original project's page (absolute, no anchors)
const extGuide = () => /^https:/.test(data.build_time.guide[L]);
const guideUrl = (stage) => extGuide() ? data.build_time.guide[L] : ROOT + data.build_time.guide[L] + (stage ? '#' + stage : '');
const linkUrl = (k) => { const u = k.url || k['url_' + L]; return /^https:/.test(u) ? u : ROOT + u; };
const badge = (st, d) => `<span class="pb pb-${esc(st)}">${esc(S.status[st] || st)}${d ? ' ' + date(d) : ''}</span>`;

/* ---------- local state (guarded: private mode, blocked storage, previews) ---------- */
function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable: page still works */ } }
const state = Object.assign({ ordered: {}, arrived: {}, tracking: {}, src: {} }, load());
for (const k of ['ordered', 'arrived', 'tracking', 'src']) if (!state[k] || typeof state[k] !== 'object') state[k] = {};

let data;
try {
  const res = await fetch(ROOT + `data/components/${ROBOT}.json`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  data = await res.json();
} catch (e) {
  $('plan-groups').innerHTML = `<p class="doc-note"><i aria-hidden="true"></i><span>${L === 'en' ? 'The plan data could not be loaded. Try reloading the page.' : 'Data plánu se nepodařilo načíst. Zkuste stránku načíst znovu.'}</span></p>`;
  throw e;
}

const form = $('plan-form');
const OPTS = [...new Set([...form.querySelectorAll('input[type=radio]')].map((i) => i.name))];   // robot, print, module…
for (const n of OPTS) {
  const v = state[n];
  const el = v != null && form.querySelector(`input[name="${n}"][value="${CSS.escape(String(v))}"]`);
  if (el) el.checked = true; else state[n] = form.querySelector(`input[name="${n}"]:checked`).value;
}
form.addEventListener('change', () => {
  for (const n of OPTS) state[n] = form.querySelector(`input[name="${n}"]:checked`).value;
  save(); render();
});
$('print-btn').addEventListener('click', () => window.print());
$('fx').textContent = nf.format(data.meta.fx_czk_per_eur);

function renderSummary(p) {
  $('stamp-date').textContent = date(p.checked.oldest);
  $('plan-stamp').title = (L === 'en' ? 'Oldest check in this plan; newest ' : 'Nejstarší ověření v tomto plánu; nejnovější ') + date(p.checked.newest);
  const b = p.build_time;
  $('plan-sum').innerHTML = `<dl class="plan-kpi">
<div class="k-main"><dt>${S.total}</dt><dd><b data-testid="plan-total-eur">${rng(p.totals.landed_eur, ' €')}</b><span>≈ ${rng(p.totals.landed_czk, CZK)}</span></dd></div>
<div><dt>${S.eta}</dt><dd><b>${rng(p.eta_days)} ${S.days}</b><span>${S.slowest}</span></dd></div>
<div><dt>${S.build}</dt><dd><b>${b.print_hours[1] ? `${S.print} ${rng(b.print_hours)} ${S.h} · ` : ''}${S.work} ${rng(b.work_hours)} ${S.h}</b><span>${S.est} · <a href="${guideUrl()}" data-testid="plan-guide-link"${extGuide() ? ' rel="noopener"' : ''}>${extGuide() ? esc(data.build_time.guide_label || S.guide) : S.guide}</a></span></dd></div>
</dl>`;
}

function renderChecks(p) {
  $('variant-table').innerHTML = `<div class="doc-t-wrap"><table class="doc-t plan-vt"><thead><tr><th scope="col">${S.part}</th><th scope="col">${S.need}</th><th scope="col">${S.avoid}</th></tr></thead>
<tbody>${p.checks.map((c) => `<tr><th scope="row">${esc(pick(c, 'name'))}</th><td>${esc(pick(c, 'need'))}</td><td>${esc(pick(c, 'avoid'))}</td></tr>`).join('')}</tbody></table></div>`;
  const sel = $('chk-exp'), prev = sel.value;
  sel.innerHTML = p.checks.map((c) => `<option value="${esc(c.id)}">${esc(pick(c, 'name'))}</option>`).join('');
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function renderVariants(p) {
  if (!p.variants.length) renderChecks(p);
  else $('variant-table').innerHTML = p.variants.map((a) => `<div class="doc-t-wrap"><table class="doc-t plan-vt"><caption>${esc(S[a.arm] || a.arm)}</caption>
<thead><tr><th scope="col">${S.joint}</th><th scope="col">${S.code}</th><th scope="col">${S.volt}</th><th scope="col">${S.ratio}</th></tr></thead>
<tbody>${a.joints.map((j) => `<tr><th scope="row">${j.joint} · ${esc(S.jn[j.name] || j.name)}</th><td><code>${j.codes.map(esc).join(' / ')}</code></td><td>${nf.format(j.voltage_v)} V</td><td>${esc(j.gear_ratio)}</td></tr>`).join('')}</tbody></table></div>`).join('');
  $('variant-how').innerHTML = data.variants[L === 'cs' ? 'how_to_verify_cs' : 'how_to_verify'].map((t) => `<li>${esc(t)}</li>`).join('')
    + data.variants[L === 'cs' ? 'rules_cs' : 'rules'].map((t) => `<li>${esc(t)}</li>`).join('');
  // every flagged source of the servos in this configuration
  const comps = new Set(p.groups.flatMap((g) => g.lines.map((l) => l.component)));
  const flags = [];
  for (const c of data.components) if (comps.has(c.id)) for (const s of c.sources) if (s.flag && s.flag !== 'out_of_stock')
    flags.push(`<li>${s.recommend ? '' : `<span class="pb pb-no">${S.notRec}</span> `}<b>${esc(data.suppliers[s.supplier]?.name || s.label)}</b> · ${esc(pick(c, 'name'))}: ${esc(pick(s, 'flag_reason'))} <a href="${esc(s.url)}" rel="noopener">${esc(L === 'en' ? 'listing' : 'inzerát')}</a></li>`);
  $('variant-flags').innerHTML = flags.length ? `<h3>${S.flagsH}</h3><ul class="plan-flags">${flags.join('')}</ul>` : '';
  if (!p.variants.length) return;
  const sel = $('chk-exp'), prev = sel.value;
  sel.innerHTML = p.variants.map((a) => `<option value="${a.arm}">${esc(S[a.arm])} · ${S.allJoints}</option>`
    + a.joints.map((j) => `<option value="${a.arm}:${j.joint}">${esc(S.jointN(S[a.arm], j.joint, S.jn[j.name]))} · ${j.codes.join('/')}</option>`).join('')).join('');
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

// buyer reviews on a listing: our short paraphrased signals, never copied text
function reviews(r) {
  if (!r) return '';
  const warn = r.signals.some((g) => g.type === 'variant_mismatch' || g.type === 'missing_parts');
  const head = `${S.rv(date(r.checked))}:`;
  let body;
  if (r.count == null && r.rating == null && !r.signals.length) body = S.rvNull;
  else if (r.count === 0) body = S.rvNone;
  else body = [r.rating != null ? `${nf.format(r.rating)}/5` : '', r.count != null ? S.rvCount(r.count) : '',
    ...r.signals.map((g) => `<span class="rv-sig rv-${esc(g.type)}">${esc(S.rvType[g.type] || g.type)}: ${esc(L === 'cs' ? g.note_cs : g.note_en)}</span>`)].filter(Boolean).join(' · ');
  return `<small class="plan-rv${warn ? ' plan-rv-warn' : ''}" data-testid="plan-reviews">${head} ${body}${r.url && r.count ? ` <a href="${esc(r.url)}" rel="noopener">${L === 'en' ? 'listing' : 'inzerát'}</a>` : ''}</small>`;
}

const backorder = (t) => { const m = /^Backorder: \d+ expected (\d{4}-\d\d-\d\d)$/.exec(t || ''); return m ? date(m[1]) : /^Backorder/.test(t || '') ? '' : null; };
function line(l, gi) {
  const k = `${current.robot}|${l.component}|${l.source}`;
  const id = `ord-${gi}-${l.component.replace(/[^a-z0-9]/gi, '-')}`;
  const price = l.range_eur ? `${rng(l.range_eur, ' €')} <span class="muted">(${S.est})</span>`
    : l.price == null ? eur(l.subtotal_eur)
    : `${money(l.price, l.currency)}${l.per > 1 ? ` / ${l.per} ${S.qty}` : ` ${S.perPiece}`} · <b>${eur(l.subtotal_eur)}</b>`;
  const qty = l.per > 1 ? `${l.qty} ${S.qty} <span class="muted">(${l.packs}× ${l.per})</span>` : `${l.qty} ${S.qty}`;
  const alts = l.alternatives.length ? `<details class="plan-alts"><summary>${S.alt} (${l.alternatives.length})</summary><ul>${l.alternatives.map((a) =>
    `<li>${a.recommend ? '' : `<span class="pb pb-no">${S.notRec}</span> `}<a href="${esc(a.url)}" rel="noopener">${esc(a.label)}</a> · ${a.price == null ? '—' : money(a.price, a.currency) + (a.per > 1 ? ` / ${a.per} ${S.qty}` : '')} ${badge(a.status, a.checked)}${a.stock ? ` <span class="muted">${S.backorder}: ${esc(stock(a.stock))}</span>` : ''}${a.flag ? `<br><span class="plan-flag">${esc(L === 'cs' ? a.flag_reason_cs : a.flag_reason)}</span>` : ''}${a.reviews ? '<br>' + reviews(a.reviews) : ''}${a.selectable ? `<br><button type="button" class="btn-link" data-swap="${esc(l.component)}" data-src="${esc(a.id === l.default_source ? '' : a.id)}">${a.id === l.default_source ? S.useDefault : S.useSrc}<span class="sr-only"> (${esc(a.label)})</span></button>` : ''}</li>`).join('')}</ul></details>` : '';
  const bo = backorder(l.stock);
  return `<li class="plan-line">
<span class="pl-chk"><input type="checkbox" id="${id}" data-k="${esc(k)}"${state.ordered[k] ? ' checked' : ''}><label for="${id}">${S.ordered}</label></span>
<span class="pl-name"><b>${esc(pick(l, 'name'))}</b>${l.stock ? `<small>${S.backorder}: ${esc(stock(l.stock))}</small>` : ''}${bo != null && l.alternatives.some((a) => a.selectable) ? `<span class="plan-flag" data-testid="plan-backorder">${esc(S.backorderNote(bo))}</span>` : ''}${l.swapped ? `<small data-testid="plan-swapped">${S.swapped}</small>` : ''}${l.flag ? `<span class="plan-flag">${esc(L === 'cs' ? l.flag_reason_cs : l.flag_reason)}</span>` : ''}${l.print_hours ? `<small>${S.printNote}: ${rng(l.print_hours)} ${S.h} (${S.est})</small>` : ''}${l.note_cs ? `<small>${esc(pick(l, 'note'))}</small>` : ''}${reviews(l.reviews)}</span>
<span class="pl-qty">${qty}</span>
<span class="pl-price">${price}</span>
<span class="pl-src">${badge(l.status, l.checked)} <a href="${esc(l.url)}" rel="noopener">${l.source === 'filament' ? S.printed_by_you : S.open}<span class="sr-only"> (${esc(pick(l, 'name'))})</span></a></span>
${alts}</li>`;
}

function renderGroups(p) {
  const groups = p.groups.filter((g) => g.supplier !== 'none');
  $('plan-groups').innerHTML = groups.map((g, gi) => `<section class="plan-grp" aria-labelledby="g-${gi}">
<header><h3 id="g-${gi}">${esc(pick(g, 'name'))}${g.country !== '—' ? ` <span class="muted">${esc(g.country)}</span>` : ''}</h3>
<dl class="pg-meta"><div><dt>${S.subtotal}</dt><dd>${rng(g.goods_eur.map((x) => Math.round(x * 100) / 100), ' €')}</dd></div>
<div><dt>${S.ship}</dt><dd>${rng(g.shipping_eur, ' €')} <span class="muted">(${S.status[g.shipping_status] || S.est})</span></dd></div>
${g.eta_days[1] ? `<div><dt>${S.eta}</dt><dd>${rng(g.eta_days)} ${S.days}</dd></div>` : ''}
<div class="pg-tot"><dt>${S.landed}</dt><dd><b>${rng([Math.floor(g.landed_eur[0]), Math.ceil(g.landed_eur[1])], ' €')}</b></dd></div></dl>
${S.vat[g.vat] ? `<p class="pg-vat">${esc(S.vat[g.vat])}</p>` : ''}
${g.services ? `<p class="pg-vat">${S.service}: ${g.services.map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.name)}</a>`).join(' · ')}</p>` : ''}
</header>
<ul class="plan-lines">${g.lines.map((l) => line(l, gi)).join('')}</ul></section>`).join('');
  const alts = p.alternatives || (p.alternative ? [p.alternative] : []);
  $('plan-alt').innerHTML = alts.length ? `<h3>${S.altsH}</h3>` + alts.map((a) => `<aside class="plan-altbox" data-testid="plan-alt"><b>${esc(pick(a, 'name'))}</b><p>${esc(pick(a, 'note'))}</p>
<p>${S.from} ${money(a.price, a.currency)}${a.currency !== 'EUR' ? ` (≈ ${eur(a.price_eur)})` : ''} ${badge(a.status, a.checked)}${a.stock ? ` · ${S.backorder}: ${esc(stock(a.stock))}` : ''} · <a href="${esc(a.url)}" rel="noopener">${esc(a.label)}</a></p>
${a.landed ? `<p><b>${a.landed.note ? S.landedEst : S.landedEu}: ${rng(a.landed.eur, ' €')}</b>${a.landed.note ? ` · ${esc(pick(a.landed, 'note'))}` : ''}</p>` : ''}
${a.still_needed.length ? `<p>${S.stillNeeded}:</p><ul>${(L === 'cs' ? a.still_needed_cs : a.still_needed).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
${a.contents_source ? `<p class="plan-src">${S.contents} <a href="${esc(a.contents_source.url)}" rel="noopener">${esc(a.contents_source.label)}</a> (${S.checkedOn} ${date(a.contents_source.checked)})</p>` : ''}</aside>`).join('') : '';
}

function renderScrews(p) {
  const el = $('plan-screws');
  if (!el) return;
  if (!p.screws) { el.innerHTML = ''; return; }
  const sc = p.screws, kinds = [...new Map(sc.arms.map((a) => [a.kind, a])).values()];
  const rowsBy = (k) => kinds.find((a) => a.kind === k).rows;
  const ids = [...new Set(kinds.flatMap((a) => a.rows.map((r) => r.id)))];
  const cell = (k, id, f) => { const r = rowsBy(k).find((x) => x.id === id); return r ? `<td title="${esc(pick(r, 'detail'))}">${r[f]}</td>` : '<td>—</td>'; };
  const head = kinds.map((a) => `<th scope="col">${S.sc[a.kind]} M2×6</th><th scope="col">${S.sc[a.kind]} M3×6</th>`).join('');
  const nameOf = (id) => { for (const a of kinds) { const r = a.rows.find((x) => x.id === id); if (r) return pick(r, 'name'); } return id; };
  el.innerHTML = `<h3 id="sroubky">${S.sc.h}</h3><div class="doc-t-wrap"><table class="doc-t plan-vt" data-testid="plan-screws"><thead><tr><th scope="col">${S.sc.part}</th>${head}</tr></thead>
<tbody>${ids.map((id) => `<tr><th scope="row">${esc(nameOf(id))}</th>${kinds.map((a) => cell(a.kind, id, 'm2') + cell(a.kind, id, 'm3')).join('')}</tr>`).join('')}
<tr><th scope="row">${S.sc.total}</th>${kinds.map((a) => `<td><b>${a.m2}</b></td><td><b>${a.m3}</b></td>`).join('')}</tr></tbody></table></div>
<p class="src">${S.sc.pair}: <b>${sc.total.m2}× M2×6</b>, <b>${sc.total.m3}× M3×6</b>. ${esc(pick(sc, 'counting'))} ${esc(pick(sc, 'included_note'))} ${badge(sc.included === 'unverified' ? 'unverified' : 'verified')} · ${S.sc.src}: <a href="${esc(sc.source.url)}" rel="noopener">${esc(sc.source.label)}</a> (${S.checkedOn} ${date(sc.checked)})</p>`;
}

function renderTools(p) {
  const tnote = p.tools_note ? pick(p, 'tools_note') : S.tools;
  $('plan-tools').innerHTML = p.tools.map((t) => `<li>${esc(pick(t, 'name'))} <span class="muted">(${t.required ? S.req : S.opt})</span></li>`).join('') + `<li>${esc(tnote)}</li>`;
  const b = p.build_time;
  $('plan-time').innerHTML = esc(S.time(b.print_hours[1] ? rng(b.print_hours) : '', rng(b.work_hours)));
  $('plan-stages').innerHTML = b.stages.map((st) => {
    const t = `${S.stage} ${esc(st.id.slice(1))} · ${esc(pick(st, 'name'))}`;
    return `<li>${extGuide() ? t : `<a href="${guideUrl(st.id)}">${t}</a>`}: ${rng(st.hours)} ${S.h}${st.optional ? ` (${S.optStage})` : ''}</li>`;
  }).join('');
}

function renderArrivals(p) {
  $('plan-arrivals').innerHTML = p.arrivals.map((a) => {
    const k = `${p.robot}|${a.id}`;
    const g = a.link ? `<a class="arr-g" href="${esc(linkUrl(a.link))}"${/^https:/.test(linkUrl(a.link)) ? ' rel="noopener"' : ''}>${esc(pick(a.link, 'label'))}</a>`
      : `<a class="arr-g" href="${guideUrl(a.guide_stage)}">${S.guideFor} ${esc(a.guide_stage.slice(1))}</a>`;
    return `<li><input type="checkbox" id="arr-${a.id}" data-a="${esc(k)}"${state.arrived[k] ? ' checked' : ''}><label for="arr-${a.id}">${esc(pick(a, 'name'))}</label>${g}</li>`;
  }).join('');
  const groups = p.groups.filter((g) => g.supplier !== 'none' && g.supplier !== 'self_print');
  $('plan-tracking').innerHTML = groups.map((g, i) => {
    const k = `${p.robot}|${g.supplier}`;
    return `<div class="field"><label for="trk-${i}">${S.track}: ${esc(pick(g, 'name'))} <span class="muted">(${S.optional}, ${S.trackHint})</span></label><input id="trk-${i}" type="text" inputmode="text" autocomplete="off" spellcheck="false" maxlength="64" data-t="${esc(k)}" value="${esc(state.tracking[k] || '')}"></div>`;
  }).join('');
  updateNext(p);
}

function updateNext(p) {
  const need = p.arrivals.filter((a) => a.needed_for_wizard).every((a) => state.arrived[`${p.robot}|${a.id}`]);
  $('plan-next').hidden = !need;
  $('plan-wait').hidden = need;
  // follower-only: say honestly what the first motion can be without a leader
  const solo = p.config.arms.length === 1 && /^follower/.test(p.config.arms[0]);
  for (const el of document.querySelectorAll('[data-solo]')) el.hidden = el.dataset.solo === '1' ? !solo : solo;
  if ($('plan-cfgnote')) { $('plan-cfgnote').hidden = !solo; $('plan-cfgnote').textContent = solo ? S.cfgNote : ''; }
}

// data-driven boxes: "verify / changed" notes and the safety block, each with dated sources
const srcList = (n) => n.sources && n.sources.length ? `<span class="plan-src">${S.srcs}: ${n.sources.map((x) => `<a href="${esc(x.url)}" rel="noopener">${esc(pick(x, 'label'))}</a> (${S.checkedOn} ${date(x.checked)})`).join(' · ')}</span>` : '';
function renderNotes(p) {
  if ($('plan-notes')) $('plan-notes').innerHTML = p.notes.map((n) => `<div class="plan-note plan-note-${esc(n.level || 'info')}" role="note" data-note="${esc(n.id)}"><b><span class="pb pb-${n.level === 'verify' ? 'unverified' : 'verified'}">${esc(S.noteLevel[n.level || 'info'])}</span> ${esc(pick(n, 'title'))}</b><p>${esc(pick(n, 'text'))}</p>${srcList(n)}</div>`).join('');
  if ($('plan-safety')) $('plan-safety').innerHTML = p.safety.map((n) => `<li data-safety="${esc(n.id)}"><b>${esc(pick(n, 'title'))}${n.level === 'verify' ? ` <span class="pb pb-unverified">${esc(S.noteLevel.verify)}</span>` : ''}</b> ${esc(pick(n, 'text'))}${srcList(n) ? '<br>' + srcList(n) : ''}</li>`).join('');
}

let current;
// SO-101: two radio groups (robot = pair | follower, fv = 74v | 12v) pick one of data.configs
const configOf = (o) => !('fv' in o) ? o.robot : o.robot === 'pair' ? (o.fv === '12v' ? 'pair' : 'pair_74v') : `follower_${o.fv}`;
function render() {
  const opts = Object.fromEntries(OPTS.map((n) => [n, state[n]]));
  const cfg = configOf(opts);
  delete opts.fv; opts.robot = cfg;
  if (!state.src[cfg] || typeof state.src[cfg] !== 'object') state.src[cfg] = {};
  opts.sources = state.src[cfg];
  current = buildPlan(data, opts);
  renderSummary(current); renderVariants(current); renderGroups(current); renderTools(current); renderScrews(current); renderArrivals(current); renderNotes(current);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-swap]');
  if (!b) return;
  const m = state.src[current.robot] || (state.src[current.robot] = {});
  if (b.dataset.src) m[b.dataset.swap] = b.dataset.src; else delete m[b.dataset.swap];
  save(); render();
  const again = document.querySelector(`.plan-line input[data-k^="${CSS.escape(current.robot + '|' + b.dataset.swap + '|')}"]`);
  if (again) again.focus();
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.k) { if (t.checked) state.ordered[t.dataset.k] = 1; else delete state.ordered[t.dataset.k]; save(); }
  if (t.dataset.a) { if (t.checked) state.arrived[t.dataset.a] = 1; else delete state.arrived[t.dataset.a]; save(); updateNext(current); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.t != null) { const v = t.value.trim().slice(0, 64); if (v) state.tracking[t.dataset.t] = v; else delete state.tracking[t.dataset.t]; save(); }
});

$('chk-btn').addEventListener('click', () => {
  const r = checkPartVariant(data, $('chk-text').value, $('chk-exp').value);
  const f = r.found, list = (a) => (a.length ? a.map(esc).join(', ') : S.none);
  const good = r.ok ? 'ok' : r.verdict === 'unknown' || r.verdict === 'check_selection' ? 'warn' : 'bad';
  $('chk-out').className = 'plan-chk-out chk-' + good;
  const details = f.signals
    ? `${S.found2}: ${list(f.signals)}${f.problems.length ? ` · ${S.problems}: ${list(f.problems)}` : ''}${r.warnings.length ? `<br>${r.warnings.map((w) => esc(L === 'cs' ? w.detail_cs : w.detail)).join('<br>')}` : ''}`
    : `${S.found}: ${S.code} ${list(f.codes)} · ${S.volt} ${list(f.voltages.map((v) => nf.format(v) + ' V'))} · ${S.ratio} ${list(f.ratios)}`;
  $('chk-out').innerHTML = `<b data-testid="chk-verdict" data-verdict="${r.verdict}">${esc(S.verdict[r.verdict])}</b> · ${esc(L === 'cs' ? r.advice_cs : r.advice)}<br><span class="muted">${details}</span>`;
});

render();
host.dataset.ready = '1';
