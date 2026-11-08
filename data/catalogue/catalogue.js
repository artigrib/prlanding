// Catalogue data, hand-edited part: colours, categories, sims, licences and the shared functions.
// The robot entries are data/robots/<id>.json; tools/build.mjs merges both into assets/data.js. Renders live in /img/<id>_<color>.jpg.
window.PR_COLORS = [
  { id: 'white', name: 'Bílá', hex: '#F2F2EE' },
  { id: 'grey', name: 'Šedá', hex: '#9A9A94' },
  { id: 'black', name: 'Černá', hex: '#2A2A2A' },
  { id: 'orange', name: 'Oranžová', hex: '#E8461E' },
  { id: 'blue', name: 'Modrá', hex: '#1F3BFF' }
];
window.PR_CATS = { arm: 'Ruce a dlaně', mobile: 'Mobilní', legged: 'Kráčející', desk: 'Stolní', combat: 'Bojoví roboti', lab: 'Laboratoř' };
window.PR_ROBOTS = []; // @robots: replaced by tools/build.mjs with data/robots/*.json in data/robots/_order.json order
// Browser demos linked from product pages (r.sim). colorParam: the sim reads ?color= (so101 does not yet).
// Sizes = uncompressed bytes of a first visit (all responses until the sim is idle, Chromium, empty cache);
// so101 measured 8 400 906 B after the MuJoCo wasm strip (tools/wasm). The loader shows the engine part only (5,3 MB).
// re-measure when sim/** changes.
window.PR_SIMS = {
  arena: { path: 'sim/arena/', robotParam: true, colorParam: true, label: 'Vyzkoušejte v aréně', note: 'Hra v prohlížeči · zdarma · ≈\u00A03,5\u00A0MB' },
  so101: { path: 'sim/so101/', label: 'Vyzkoušejte v simulaci', note: 'Simulace v prohlížeči · zdarma · ≈\u00A08,4\u00A0MB' }
};
// Robot without its own software (RC-controlled); same test in app.js and tools/build.mjs.
window.PR_NO_SW = function (r) { return !r.sw || String(r.sw).trim() === '—'; };
// Per-robot FAQ flags: r.rcControl = driven with an RC transmitter, nothing to program (even if the repo has code);
// r.swNotFree = part of the software is not free (e.g. MATLAB); r.noGuide = the project has no assembly guide.
// Safety notes built from what a robot actually contains (used by app.js and tools/build.mjs).
window.PR_SAFETY = function (r) {
  var all = JSON.stringify([r.bom || [], r.specs || [], r.lead || '']);
  var w = ['Určeno osobám od 14 let; mladší pouze pod dohledem dospělého. Pohyblivé části mohou přiskřípnout prsty.'];
  if (/LiPo|Li-Pol|Li-ion|akumulátor|baterie/i.test(all)) w.push('Lithiové akumulátory nabíjejte jen vhodnou nabíječkou, pod dohledem a mimo hořlavé předměty; poškozený článek nepoužívejte.');
  if (/\b(24|22,2|14,8) ?V\b|\d+ ?Nm/.test(all)) w.push('Silné motory: pohybující se rameno může způsobit zranění. Při oživování držte ruce mimo dosah a mějte po ruce vypínač napájení.');
  if (/pneumatick|stlačen/i.test(all)) w.push('Pneumatické chapadlo pracuje se stlačeným vzduchem – používejte jen schválený zdroj a hadice.');
  if (/230 ?V|síťov/i.test(all)) w.push('Zdroj připojený k síti 230 V smí zapojovat jen osoba s odpovídající kvalifikací.');
  if (/(^|[^a-zá-ž])magnet(?!ick)/i.test(all)) w.push('Obsahuje malé silné magnety: spolknutí více kusů může vážně poškodit střeva. Uchovávejte mimo dosah malých dětí. Při spolknutí ihned vyhledejte lékaře.');
  if (r.cat === 'combat') {
    w.push('Bojového robota zapínejte jen v uzavřené aréně nebo s odpojenou zbraní. Nejdřív zapněte vysílač, potom robota; vypínejte v opačném pořadí a před prvním zápasem ověřte failsafe (po vypnutí vysílače se robot musí zastavit).');
    if (/spinner|rotuj/i.test(all)) w.push('Rotující zbraň může vážně zranit a vymrštit úlomky: mimo arénu ji vždy zajistěte a nikdy ji neroztáčejte v ruce ani na stole.');
    if (/flipper/i.test(all)) w.push('Flipper se pohybuje prudce: při manipulaci s robotem mějte prsty mimo jeho dráhu.');
  }
  // devices that handle liquids (r.liquids) / syringe pumps that build up pressure (r.syringe; poseidon README, Safety Considerations)
  if (r.liquids) w.push('Laboratorní přístroj: kapaliny držte dál od elektroniky a zdroje, chemikálie a biologický materiál používejte jen podle pravidel laboratoře a pod dohledem. Tištěné díly z PLA nebo PETG nemusí odolat organickým rozpouštědlům. Přístroj nejdřív vyzkoušejte nasucho, bez kapalin.');
  if (r.syringe) w.push('Stříkačková pumpa vyvine velký tlak: při ucpané hadičce může stříkačka nebo spoj prasknout a vystříknout kapalinu. Proud driveru motoru nastavte podle návodu autorů a pracujte s ochrannými brýlemi.');
  if (!r.noElectronics) w.push('Hardware napájejte jen zdrojem uvedeným v návodu projektu.');
  return w;
};
// Parameters shown on the product page and in JSON-LD; unknown values ('—' or empty) are left out.
// "Co budete potřebovat": what you buy or print yourself, per the project's bill of materials (app.js and tools/build.mjs).
// We sell nothing: tier 'parts' = printed parts only, 'kit' = everything; pair: leader + follower (robots with r.setups). Items: [name, qty, kind].
window.PR_BOX = function (r, tier, pair) {
  var items = [['Tištěné díly podle STL projektu' + (r.setups ? (pair ? ' — leader i follower' : ' — follower') : ''), pair ? '2 sady' : '1 sada', 'Tisk']];
  if (tier !== 'parts') {
    if (r.id === 'so101') {
      // SO-ARM100 README, bill of materials for SO-101 (pair = follower + leader)
      items.push(['Servo Feetech STS3215 7,4 V, převod 1/345', pair ? '7×' : '6×', 'Hardware']);
      if (pair) { items.push(['Servo Feetech STS3215 7,4 V, převod 1/191', '2×', 'Hardware']); items.push(['Servo Feetech STS3215 7,4 V, převod 1/147', '3×', 'Hardware']); }
      items.push(['Řídicí deska serv', pair ? '2×' : '1×', 'Hardware'], ['Zdroj 5 V', pair ? '2×' : '1×', 'Hardware'], ['Kabel USB-C', '2×', 'Hardware'], ['Svěrky ke stolu', pair ? '4×' : '2×', 'Hardware']);
    } else { (r.bom || []).forEach(function (b) { if (r.setups && !pair && /leader/i.test(b[0]) && !/follower/i.test(b[0])) return; items.push([b[0], b[1], 'Hardware']); }); }
    if (!r.fastenersListed) items.push(['Spojovací materiál podle návodu projektu', '—', 'Hardware']);
  }
  return items;
};
// r.bomSource: where the parts list comes from. Default: the project's published BOM; 'cad': the project publishes
// no BOM and we compiled the list from its CAD assembly and docs (box title, note, FAQ and meta description say so).
window.PR_BOM_CAD = function (r) { return r.bomSource === 'cad'; };
// 'src': the project's BOM is in docs we could not check; the list was compiled from its source files (OpenSCAD, render scripts).
window.PR_BOM_SRC = function (r) { return r.bomSource === 'src'; };
window.PR_BOX_TITLE = function (r, n) { return (window.PR_BOM_CAD(r) ? 'Sestaveno z CAD a dokumentace projektu · ' : window.PR_BOM_SRC(r) ? 'Sestaveno ze zdrojových souborů projektu · ' : 'Podle kusovníku projektu · ') + n + ' položek'; };
window.PR_BOX_NOTE = function (r) { if (window.PR_BOM_CAD(r)) return 'Projekt kusovník nezveřejňuje; seznam jsme sestavili z CAD sestavy a dokumentace projektu' + (r.bomDocs ? ' (' + r.bomDocs + ')' : '') + '. Počty ověřte v CAD.'; if (window.PR_BOM_SRC(r)) return 'Seznam jsme sestavili z OpenSCAD zdrojů a renderovacích skriptů projektu' + (r.bomDocs ? ' (' + r.bomDocs + ')' : '') + ', ne z jeho kusovníku. Úplný seznam a počty ověřte v návodu projektu.'; return r.id === 'so101' ? 'Počty dle kusovníku projektu SO-ARM100 (follower 7,4 V, zdroj 5 V). Follower s 12V servy: 6× C018 a zdroj 12 V / 5 A.' : 'Položky dle kusovníku projektu; přesné počty a varianty ověřte v jeho dokumentaci.'; };
// FAQ of a kit page (app.js renders it, tools/build.mjs pre-renders it and adds it as FAQPage structured data).
window.PR_FAQ = function (r) {
  var cad = window.PR_BOM_CAD(r), src = window.PR_BOM_SRC(r);
  return [
    ['Zvládnu sestavení bez zkušeností?', 'Náročnost tohoto projektu: ' + r.level + (r.noGuide ? '. Projekt návod na sestavení nemá; repozitář obsahuje seznam dílů a videa.' : '. Návod projektu vede krok za krokem; odkaz najdete v sekci Licence a bezpečnost.')],
    [r.cat === 'lab' ? 'Můžu si sadu koupit u vás?' : 'Můžu si robota koupit u vás?', (src ? 'Ne, nic neprodáváme. Díly koupíte přímo u dodavatelů; seznam v sekci Co budete potřebovat jsme sestavili podle zdrojových souborů projektu. Hotovou sadu možná nabídneme později; chcete-li o ní vědět, nechte e-mail ve formuláři nahoře.' : cad ? 'Ne, nic neprodáváme. Díly koupíte přímo u dodavatelů; projekt kusovník nezveřejňuje, seznam v sekci Co budete potřebovat jsme sestavili z jeho CAD a dokumentace. Hotovou sadu možná nabídneme později; chcete-li o ní vědět, nechte e-mail ve formuláři nahoře.' : 'Ne, nic neprodáváme. Díly koupíte přímo u dodavatelů podle kusovníku projektu (sekce Co budete potřebovat). Hotovou sadu možná nabídneme později; chcete-li o ní vědět, nechte e-mail ve formuláři nahoře.')],
    ['Jste spojeni s autory projektu?', 'Ne. Vycházíme z otevřené dokumentace projektu ' + r.name + ' (' + r.author + ', licence ' + r.hw + '). Autoři s námi nejsou spojeni a tuto stránku neschválili.'],
    ['Jaký software budu potřebovat?', r.cat === 'combat' ? 'Žádný. Robot se ovládá RC vysílačem FlySky; přijímač Malenki Nano s ním jen spárujete, programovat nic nemusíte. Návod projektu najdete v sekci Licence a bezpečnost.'
      : r.noSoftware ? r.software + '. Návod projektu najdete v sekci Licence a bezpečnost.'
      : (window.PR_NO_SW(r) || r.rcControl) ? 'Žádný. Ovládá se běžným RC vysílačem, programovat nic nemusíte.' + (r.noGuide ? ' Projekt návod na sestavení nemá; repozitář obsahuje seznam dílů a videa.' : ' Návod projektu najdete v sekci Licence a bezpečnost.')
      : r.swNotFree ? r.software + '. Část potřebného softwaru není zdarma; odkaz na návod projektu najdete v sekci Licence a bezpečnost.'
      : r.software + '. Software je open-source a zdarma; odkaz na návod projektu najdete v sekci Licence a bezpečnost.'],
    ['Je stavba vhodná pro děti?', 'Není to hračka. ' + (r.cat === 'lab' ? 'Sestava' : 'Robot') + ' obsahuje malé díly' + (r.noElectronics ? '' : ' a elektroniku') + '; stavba je určena osobám od 14 let, mladším pouze pod dohledem dospělého, například ve škole nebo kroužku.'],
    ['Jsme škola nebo kroužek. Co nám nabízíte?', (src ? 'Nic neprodáváme ani nefakturujeme. Zdarma je hodina se simulací SO-101 a pracovní list na stránce Pro školy; díly koupíte u dodavatelů podle seznamu sestaveného ze zdrojových souborů projektu.' : cad ? 'Nic neprodáváme ani nefakturujeme. Zdarma je hodina se simulací SO-101 a pracovní list na stránce Pro školy; díly koupíte u dodavatelů podle seznamu sestaveného z CAD a dokumentace projektu.' : 'Nic neprodáváme ani nefakturujeme. Zdarma je hodina se simulací SO-101 a pracovní list na stránce Pro školy; díly koupíte u dodavatelů podle kusovníku projektu.')]
  ];
};
window.PR_SPECS = function (r) {
  return r.specs.concat([['Náročnost', r.level], ['Software', r.software], ['Náklady na díly dle autora', r.bomCost]])
    .filter(function (s) { return s[1] && String(s[1]).trim() !== '—'; });
};
window.PR_LICENSES = [
  ['Apache-2.0', 'y', 'Ano', 'Kopie licence, uvedení autora, označení změn'],
  ['MIT', 'y', 'Ano', 'Kopie licence a copyright autora'],
  ['CC BY 4.0', 'y', 'Ano', 'Uvedení autora, odkaz na zdroj a licenci'],
  ['CC BY-SA 4.0', 'c', 'Ano, s podmínkou', 'Upravené soubory zveřejňujeme pod stejnou licencí'],
  ['GPL-3.0', 'c', 'Ano, s podmínkou', 'Zdrojové soubory upravených dílů a firmwaru k dispozici'],
  ['CERN-OHL-P-2.0', 'y', 'Ano', 'Uvedení autorů a licence'],
  ['CERN-OHL-W / -S 2.0', 'c', 'Ano, s podmínkou', 'Zdroje upravené konstrukce zveřejňujeme'],
  ['CERN-OHL-1.2', 'c', 'Ano, s podmínkou', 'Kopie licence, označení změn s datem, upravené zdroje pod stejnou licencí'],
  ['CC BY-NC / vlastní NC', 'n', 'Ne', 'Pouze s písemným svolením autora']
];

// ---------- licence -> rights ----------
// r.license = { hw, sw?, docs?, policy?, status, checked, sources[] }; each value is an SPDX id, an array of
// candidate ids (unconfirmed: the stricter one wins) or 'own' (our original design). Rights are derived, never
// typed in, so they cannot drift from the licence. Values: 'yes' | 'conditions' | 'no' | 'ask'.
//   sell_prints       print and sell the project's parts
//   sell_kits         sell a kit (prints + hardware + firmware/software as shipped)
//   renders_from_cad  publish our renders made from the project's CAD on a commercial site
//   accessories       sell our own accessories designed to fit (no copying of their CAD)
//   guide             publish our own guide (own text and photos; quotes follow the doc licence)
//   plan              publish a parts-buying plan (we link suppliers, we sell nothing)
// Classes: own | permissive | copyleft (GPL, LGPL, CC BY-SA, CERN-OHL-W/-S) | nd | nc | proprietary | unknown.
window.PR_LICENSE_CLASS = function (id) {
  var s = String(id == null ? '' : id).trim().toUpperCase().replace(/[\s_]+/g, '-');
  if (!s || s === '—' || s === '-') return 'unknown';
  if (s === 'OWN') return 'own';
  if (/PROPRIETARY|ALL-RIGHTS|LICENSEREF/.test(s)) return 'proprietary';
  if (/(^|-)NC(-|$)/.test(s) || /NONCOMMERCIAL/.test(s)) return 'nc';
  if (/(^|-)ND(-|$)/.test(s)) return 'nd';
  if (/^(A?GPL|LGPL|CERN-OHL-[WS]|CERN-OHL-1\.[12]$)|^CC-BY-SA|^MPL|^EUPL|^TAPR-OHL/.test(s)) return 'copyleft';
  if (/^(MIT|APACHE|BSD|ISC|ZLIB|0BSD|UNLICENSE|CC0|CC-BY(-[0-9.]+)?$|CERN-OHL-P|SOLDERPAD)/.test(s)) return 'permissive';
  return 'unknown';
};
(function () {
  var ORDER = ['own', 'permissive', 'copyleft', 'nd', 'unknown', 'nc', 'proprietary'];   // later = stricter
  var Y = 'yes', C = 'conditions', N = 'no', A = 'ask';
  // per class: [sell_prints, renders_from_cad, accessories, kit part]
  var HW = {
    own: [Y, Y, Y, Y], permissive: [Y, Y, Y, Y],
    copyleft: [C, C, Y, C],           // share-alike: modified design files published under the same licence
    nd: [C, A, Y, C],                 // verbatim copies only; a render may count as an adaptation
    unknown: [A, A, Y, A], nc: [N, N, Y, N], proprietary: [N, N, Y, N]
  };
  var SW = { own: Y, permissive: Y, copyleft: C, nd: C, unknown: A, nc: N, proprietary: N };   // shipping firmware/software in a kit
  var RANK = { yes: 0, conditions: 1, ask: 2, no: 3 };
  function strictest(v) {
    var list = Array.isArray(v) ? v : [v], best = null;
    list.forEach(function (x) { var c = window.PR_LICENSE_CLASS(x); if (best === null || ORDER.indexOf(c) > ORDER.indexOf(best)) best = c; });
    return best || 'unknown';
  }
  function worse(a, b) { return RANK[a] >= RANK[b] ? a : b; }
  window.PR_DERIVE_RIGHTS = function (lic) {
    lic = lic || {};
    var hw = strictest(lic.hw), sw = lic.sw == null || lic.sw === '—' ? null : strictest(lic.sw);
    var h = HW[hw];
    var kit = sw ? worse(h[3], SW[sw]) : h[3];
    if (lic.policy) kit = worse(kit, SW[strictest(lic.policy)]);
    return {
      class: hw, sw_class: sw,
      sell_prints: h[0], sell_kits: kit, renders_from_cad: h[1], accessories: h[2],
      guide: Y, plan: Y,
      unverified: lic.status !== 'verified',
      trademark: !!lic.trademark   // names/logos need the owner's permission whatever the licence says
    };
  };
  window.PR_RIGHTS = function (r) { return window.PR_DERIVE_RIGHTS(r.license || { hw: r.hw, sw: r.sw }); };
})();

// Robots of the arena (sim/arena) that are not catalogue kits: licence of our own models.
window.PR_ARENA_LICENSES = {
  // original designs, printedrobotics.cz; published as CC BY 4.0 (tools/robots-cad/kosa.py, klepeto.py headers)
  kosa: { hw: 'own', status: 'verified', checked: '2026-10-30', published: 'CC-BY-4.0', sources: ['tools/robots-cad/kosa.py'] },
  klepeto: { hw: 'own', status: 'verified', checked: '2026-10-30', published: 'CC-BY-4.0', sources: ['tools/robots-cad/klepeto.py'] }
};

// Showcases: open projects we present but do not sell (no kit page, no order form). The catalogue shows them
// after the kits with a card that links to the simulation (sim/<r.sim>/). Every number names its upstream source.
window.PR_SHOWCASE = []; // @showcase: replaced by tools/build.mjs with the _order.json "showcase" entries of data/robots/

// derived rights on every entry that carries a licence (catalogue kits and showcases)
window.PR_ROBOTS.concat(window.PR_SHOWCASE).forEach(function (r) { r.rights = window.PR_RIGHTS(r); });
Object.keys(window.PR_ARENA_LICENSES).forEach(function (k) { window.PR_ARENA_LICENSES[k].rights = window.PR_DERIVE_RIGHTS(window.PR_ARENA_LICENSES[k]); });
