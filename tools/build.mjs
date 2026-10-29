// Builds one static page per robot: /sada/<id>/index.html (Czech) and /en/kit/<id>/index.html (English)
// with its own title, description, Open Graph preview, canonical URL, hreflang pair and Schema.org data,
// so links shared in messengers show the right robot. Also the English quiz and licence pages, and sitemap.xml.
// Run from the repo root:  node tools/build.mjs
//
// English: catalogue fields come from assets/data.en.js (overlaid on data.js), UI text from the
// Czech → English dictionary in assets/i18n.en.js — the same one assets/i18n.js applies at runtime.
// The build fails if an English page still contains Czech text, so a template change can't silently
// ship half-translated pages: add the new strings to assets/i18n.en.js.
import fs from 'node:fs';
import vm from 'node:vm';

const SITE = 'https://printedrobotics.cz/';
const read = f => fs.readFileSync(f, 'utf8');
function dataCtx(lang) {
  const ctx = { window: {} };
  vm.runInNewContext(read('assets/data.js'), ctx);
  if (lang === 'en') { vm.runInNewContext(read('assets/data.en.js'), ctx); ctx.window.PR_EN_APPLY(); }
  return ctx.window;
}
const W = { cs: dataCtx('cs'), en: dataCtx('en') };
// translator: the runtime core + dictionary, run in Node
const I = {}; I.window = I; I.globalThis = I;
vm.createContext(I);
vm.runInContext(read('assets/i18n.en.js'), I);
vm.runInContext(read('assets/i18n.js'), I);
I.PRI18N.setLang('en'); I.PRI18N.addDict('en', I.PR_I18N_EN);

const R = W.cs.PR_ROBOTS, SIMS = W.cs.PR_SIMS || {};
const tpl = read('tools/sada.template.html');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const unesc = s => String(s).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: '\u00A0' })[e]);
const ROOT = '../../';
const no = i => String(i + 1).padStart(2, '0');
const clip = (t, n) => t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n - 1)).replace(/[,;:–-]$/, '') + '…';

/* ---------- i18n helpers ---------- */
const PATH = { kit: (L, id) => L === 'en' ? `en/kit/${id}/` : `sada/${id}/`, quiz: L => L === 'en' ? 'en/quiz/' : 'kviz.html', home: L => L === 'en' ? 'en/' : '' };
// translate visible text and a few attributes of a whole HTML document (scripts and styles untouched)
function translateHtml(html) {
  const tr = s => { const r = I.PRI18N.t(unesc(s).replace(/\s+/g, ' ').trim()); return r === unesc(s).replace(/\s+/g, ' ').trim() ? null : r; };
  return html.split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->)/).map((p, i) => i % 2 ? p : p
    .replace(/>([^<>]+)</g, (m, txt) => {
      if (!/\S/.test(txt)) return m;
      const r = tr(txt); if (r == null) return m;
      return '>' + /^\s*/.exec(txt)[0] + esc(r) + /\s*$/.exec(txt)[0] + '<';
    })
    .replace(/(\s(?:aria-label|title|placeholder|alt|data-tip)=")([^"]*)"/g, (m, a, v) => { const r = v && tr(v); return r == null ? m : a + esc(r) + '"'; })
  ).join('');
}
// rewrite site links of a page at `page` (path from the site root) to their English counterparts
function enLinks(html, page) {
  const up = '../'.repeat(page.split('/').length - 1);
  return html.replace(/(\shref=")([^"#][^"]*|#[^"]*)"/g, (m, a, href) => {
    if (/^(https?:|mailto:|data:|javascript:)/.test(href) || href.startsWith('#')) return m;
    const u = new URL(href, SITE + page);
    let p = u.pathname.slice(1), q = u.search, h = u.hash;
    if (/^(assets|img|models)\//.test(p) || p.startsWith('en/')) return m;
    const k = /^sada\/([^/]+)\/?$/.exec(p);
    if (k) p = PATH.kit('en', k[1]);
    else if (p === '' || p === 'index.html') p = 'en/';
    else if (p === 'kviz.html') p = 'en/quiz/';
    else if (p.startsWith('sim/')) { const s = new URLSearchParams(q); s.set('lang', 'en'); q = '?' + s.toString(); }
    else return m;
    return a + (up + p || './') + q + h + '"';
  });
}
function alternates(csPath, enPath) {
  return [`<link rel="alternate" hreflang="cs" href="${SITE}${csPath}">`, `<link rel="alternate" hreflang="en" href="${SITE}${enPath}">`, `<link rel="alternate" hreflang="x-default" href="${SITE}${csPath}">`].join('\n');
}
function switcher(L, page, csPath, enPath) {
  const up = '../'.repeat(page.split('/').length - 1);
  const rel = p => (up + p) || './';
  return `<!--lang-sw--><span class="lang-sw">${I.PRI18N.switcherHtml(L, { cs: rel(csPath), en: rel(enPath) })}</span><!--/lang-sw-->`;
}
// hreflang pair right after the canonical link (idempotent)
function setAlternates(html, csPath, enPath) {
  html = html.replace(/\n<link rel="alternate" hreflang="[^"]*" href="[^"]*">/g, '');
  return html.replace(/(<link rel="canonical" href="[^"]*">)/, `$1\n${alternates(csPath, enPath)}`);
}
// i18n assets: stylesheet, switcher in the header, English data/dictionary before app.js (idempotent)
function wireI18n(html, L, page, csPath, enPath, root) {
  html = html
    .replace(/<!--lang-sw-->[\s\S]*?<!--\/lang-sw-->/g, '')
    .replace(/\n<link rel="stylesheet" href="[^"]*assets\/i18n\.css">/g, '')
    .replace(/<script src="[^"]*assets\/(i18n|i18n\.en|data\.en|media\.en)\.js"( data-auto)?><\/script>\n/g, '');
  html = html
    .replace('<link rel="stylesheet" href="' + root + 'assets/site.css">', m => m + `\n<link rel="stylesheet" href="${root}assets/i18n.css">`)
    .replace(/(<div class="brand"><i aria-hidden="true"><\/i><a href="[^"]*">printedrobotics<\/a>)/, `$1${switcher(L, page, csPath, enPath)}`)
    .replace(`<script src="${root}assets/app.js"></script>`, (L === 'en' ? `<script src="${root}assets/i18n.en.js"></script>\n` : '') + `<script src="${root}assets/i18n.js" data-auto></script>\n<script src="${root}assets/app.js"></script>`);
  if (L === 'en') html = html
    .replace(`<script src="${root}assets/data.js"></script>`, m => m + `\n<script src="${root}assets/data.en.js"></script>`)
    .replace(`<script src="${root}assets/media.js"></script>`, m => m + `\n<script src="${root}assets/media.en.js"></script>`);
  if (!html.includes('class="lang-sw"') || !html.includes('assets/i18n.js')) throw new Error('i18n wiring failed: ' + page);
  return html;
}
// English pages must not keep Czech UI text (names of people/places are fine)
const CZ = /[ěřůčšžťďňĚŘŮČŠŽŤĎŇ]/;
const CZ_OK = /Čeština/;
function assertEnglish(html, page) {
  const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
  const bad = [];
  for (const m of visible.matchAll(/>([^<>]+)</g)) if (CZ.test(m[1]) && !CZ_OK.test(m[1])) bad.push(m[1].trim());
  for (const m of visible.matchAll(/\s(?:aria-label|title|placeholder|alt|content)="([^"]*)"/g)) if (CZ.test(m[1]) && !CZ_OK.test(m[1])) bad.push(m[1]);
  if (bad.length) throw new Error(`${page}: untranslated Czech text (add it to assets/i18n.en.js):\n  ` + [...new Set(bad)].slice(0, 30).join('\n  '));
}
function writePage(path, html) {
  const dir = path.replace(/[^/]*$/, '');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path, html);
}

/* ---------- product pages ---------- */
function kitPage(r0, L) {
  const D = W[L], r = D.PR_ROBOTS.find(x => x.id === r0.id), byId = Object.fromEntries(D.PR_ROBOTS.map(x => [x.id, x]));
  const page = PATH.kit(L, r.id), url = SITE + page, root = '../'.repeat(page.split('/').length - 1);
  // search-intent title (≤ ~60 chars) and a description cut at a word boundary to ≤ 155 chars
  let title, desc, ogTitle;
  if (L === 'en') {
    const t1 = `${r.name} kit: ${r.type.toLowerCase()} | printedrobotics.cz`;
    title = t1.length <= 64 ? t1 : `${r.name} kit | printedrobotics.cz`;
    desc = clip(r.preparing
      ? `We’re preparing a ${r.name} kit. ${r.short} Leave your email and you’ll be the first to know.`
      : `${r.name} kit: printed parts and the hardware from the bill of materials in one box. ${r.short}`, 155);
    ogTitle = `Kit for ${r.name}`;
  } else {
    const t1 = `${r.name} – stavebnice: ${r.type.toLowerCase()} | printedrobotics.cz`;
    title = t1.length <= 64 ? t1 : `${r.name} – stavebnice | printedrobotics.cz`;
    desc = clip(r.preparing
      ? `${r.name} připravujeme jako stavebnici. ${r.short} Nechte e-mail, dáme vědět jako prvním.`
      : `Stavebnice ${r.name}: vytištěné díly a hardware podle kusovníku v jedné krabici. ${r.short}`, 155);
    ogTitle = 'Stavebnice pro ' + r.name;
  }
  const H = root;
  // unknown values ('—') are omitted, same list as the runtime page
  const specs = D.PR_SPECS(r);
  const sim = r.sim && D.PR_SIMS[r.sim];
  const simCta = sim ? `<a class="sim-cta" id="sim-cta" href="${root}${sim.path}${sim.robotParam ? '?robot=' + r.id : ''}"><span><b>${esc(sim.label)}</b><small>${esc(sim.note)}</small></span><span aria-hidden="true">→</span></a>\n` : '';
  const noSw = D.PR_NO_SW(r);
  const prerender = {
    specs: specs.map(x => `<div><dt>${esc(x[0])}</dt><dd>${esc(x[1])}</dd></div>`).join(''),
    box: [['Tištěné díly podle STL projektu', '1 sada']].concat(r.bom || []).map((b, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${esc(b[0])}</span><span class="q">${esc(b[1])}</span><span class="t"></span></li>`).join(''),
    related: r.related.map(id => byId[id]).filter(Boolean).map(x => `<a href="${H}sada/${x.id}/"><b>${esc(x.name)}</b><span class="muted" style="font-size:15px">${esc(x.short)}</span></a>`).join('')
  };
  const img = `${SITE}img/${r.id}_white.jpg`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: L === 'en' ? `Kit for ${r.name}` : `Stavebnice pro ${r.name}`, description: r.lead, category: r.type,
    image: img, url, brand: { '@type': 'Brand', name: 'printedrobotics.cz' }, isBasedOn: r.repo,
    additionalProperty: specs.map(s => ({ '@type': 'PropertyValue', name: s[0], value: s[1] }))
  };
  if (L === 'en') ld.inLanguage = 'en';
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${url}">`,
    alternates(PATH.kit('cs', r.id), PATH.kit('en', r.id)),
    `<meta property="og:title" content="${esc(ogTitle)}">`,
    `<meta property="og:description" content="${esc(r.short)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="900">`,
    `<meta property="og:image:alt" content="${esc(r.alt)}">`,
    `<meta property="og:locale" content="${L === 'en' ? 'en_GB' : 'cs_CZ'}">`,
    `<meta property="og:locale:alternate" content="${L === 'en' ? 'cs_CZ' : 'en_GB'}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="preload" as="image" href="${root}img/${r.id}_white.jpg" fetchpriority="high">`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`
  ].join('\n');

  let html = tpl
    .replace(/<title>[^<]*<\/title>\n<meta name="description"[^>]*>\n<link rel="canonical"[^>]*>/, () => head)
    .replace(/(href|src)="assets\//g, `$1="${root}assets/`)
    .replace(/href="\.\/(#?[^"]*)"/g, `href="${root}$1"`)
    .replace(/href="kviz\.html"/g, `href="${root}kviz.html"`)
    .replace('<body data-page="product"', `<body data-page="product" data-robot="${r.id}" data-root="${root}"`)
    // server-rendered name so the page reads right before scripts run
    .replace('<h1 class="p-name" id="p-name"></h1>', `<h1 class="p-name" id="p-name">${esc(r.name)}</h1>`)
    .replace('<dl class="a4 specs" id="specs"></dl>', `<dl class="a4 specs" id="specs">${prerender.specs}</dl>`)
    .replace('<ol class="box" id="box"></ol>', `<ol class="box" id="box">${prerender.box}</ol>`)
    .replace('<div class="a4 rel" id="related"></div>', `<div class="a4 rel" id="related">${prerender.related}</div>`)
    .replace('<span id="l-name"></span>', `<span id="l-name">${esc(r.name)}</span>`)
    .replace('<span id="l-author"></span>', `<span id="l-author">${esc(r.author)}</span>`)
    .replace('<span id="l-name2"></span>', `<span id="l-name2">${esc(r.name)}</span>`)
    .replace('<span id="l-hw"></span>', `<span id="l-hw">${esc(r.hw)}</span>`)
    .replace(', software pod licencí <span id="l-sw"></span>.', noSw ? '. Vlastní software nepotřebuje, ovládá se RC vysílačem.' : `, software pod licencí <span id="l-sw">${esc(r.sw)}</span>.`)
    .replace('<dd style="margin:0" id="l-hw2"></dd>', `<dd style="margin:0" id="l-hw2">${esc(r.hw)}</dd>`)
    .replace('<dd style="margin:0" id="l-sw2"></dd>', `<dd style="margin:0" id="l-sw2">${noSw ? 'bez vlastního softwaru (RC vysílač)' : esc(r.sw)}</dd>`)
    .replace('id="l-repo" href="#"', `id="l-repo" href="${esc(r.repo)}"`)
    .replace('id="l-docs" href="#"', `id="l-docs" href="${esc(r.docs)}"`)
    .replace(/(<p class="ink2" style="margin-top:8px" id="safety">)[^<]*(<\/p>)/, `$1${D.PR_SAFETY(r).map(esc).join('<br>')}$2`)
    .replace('<span class="h2" id="specs-title">Parametry</span>', `<span class="h2" id="specs-title">Parametry · ${specs.length}</span>`)
    .replace('<!--sim-cta-->\n', simCta)
    .replace('<b id="po-title" style="font-weight:500;font-size:19px;display:block"></b>', `<b id="po-title" style="font-weight:500;font-size:19px;display:block">${r.preparing ? 'Upozornění na dostupnost' : 'Nezávazná předobjednávka'}</b>`)
    // hero, crumb and meta line so the page reads right without scripts (app.js rewrites the same nodes)
    .replace('<div class="tile" id="p-tile"></div>', `<div class="tile" id="p-tile"><img src="${root}img/${r.id}_white.jpg" alt="${esc(r.alt)}" fetchpriority="high" width="1200" height="900"></div>`)
    .replace('<span id="crumb-cat"></span>', `<span id="crumb-cat">${esc(D.PR_CATS[r.cat])}</span>`)
    .replace('<span id="crumb-name" style="color:var(--ink)"></span>', `<span id="crumb-name" style="color:var(--ink)">${esc(r.name)}</span>`)
    .replace('<span id="p-no"></span>', `<span id="p-no">N° ${no(R.findIndex(x => x.id === r.id))} — ${esc(r.type)}</span>`)
    .replace('<span id="p-hw"></span>', `<span id="p-hw">${esc(r.hw)}</span>`)
    .replace('<div class="mono" id="p-author"></div>', `<div class="mono" id="p-author">Open-source design: ${esc(r.author)}</div>`)
    .replace('<span id="p-cap"></span>', `<span id="p-cap">Obr. 1 — ${esc(r.name)}</span>`)
    .replace('<span id="p-credit"></span>', `<span id="p-credit">${esc(r.credit || (r.render ? 'Vizualizace z CAD projektu' : ''))}</span>`)
    .replace('<p class="ink2" style="margin:6px 0 0;font-size:17px;line-height:1.5" id="p-lead"></p>', `<p class="ink2" style="margin:6px 0 0;font-size:17px;line-height:1.5" id="p-lead">${esc(r.lead)}</p>`);
  if (r.preparing) {
    // not for sale yet: the static page must not offer a pre-order (app.js applies the same state)
    html = html
      .replace('<span>Předobjednávka · cenu a termín potvrdíme e-mailem</span>', '<span>Připravujeme · ověřujeme licenci s autory</span>')
      .replace('href="#predobjednavka">Předobjednat <span aria-hidden="true">↓</span>', 'href="#predobjednavka">Dejte mi vědět <span aria-hidden="true">↓</span>')
      .replace('<div id="prep-info" class="prep" hidden>', '<div id="prep-info" class="prep">')
      .replace('id="sec1-label">01 — Konfigurace a předobjednávka<', 'id="sec1-label">01 — Upozornění na dostupnost<')
      .replace('<span id="po-btn-t">Předobjednat</span>', '<span id="po-btn-t">Dejte mi vědět</span>')
      .replace(/ data-hide-prep>/g, ' data-hide-prep hidden>')
      .replace('<fieldset id="setups-wrap">', '<fieldset id="setups-wrap" hidden>')
      .replace('id="jump-po">Konfigurace<', 'id="jump-po">Upozornění<')
      .replace('<a class="btn btn-act" href="#predobjednavka" tabindex="-1">Předobjednat</a>', '<a class="btn btn-act" href="#predobjednavka" tabindex="-1">Dejte mi vědět</a>')
      .replace('za účelem vyřízení předobjednávky.</span>', 'za účelem zaslání upozornění na dostupnost.</span>')
      .replace('placeholder="Např. otázka ke kompletaci"', 'placeholder="Na co se těšíte?"');
    if (!html.includes('Dejte mi vědět <span')) throw new Error('template changed (preparing): ' + r.id);
  }
  if (!html.includes(`data-robot="${r.id}"`) || !html.includes('og:image') || html.includes('<!--sim-cta-->') || !html.includes('id="l-hw">')) throw new Error('template changed: ' + r.id);
  html = wireI18n(html, L, page, PATH.kit('cs', r.id), PATH.kit('en', r.id), root);
  if (L === 'en') {
    html = enLinks(translateHtml(html.replace('<html lang="cs">', '<html lang="en">')), page);
    assertEnglish(html, page);
  }
  html = html.replace('<!doctype html>\n', '<!doctype html>\n<!-- generated by tools/build.mjs from tools/sada.template.html — edit the template, not this file -->\n');
  writePage(page + 'index.html', html);
}
for (const r of R) { kitPage(r, 'cs'); kitPage(r, 'en'); }

// home: catalogue cards in the static HTML (scripts re-render the same cards with filters)
const cards = R.map((r, i) => `<a class="card" href="sada/${r.id}/"><div class="tile"><span class="tag">${r.preparing ? 'Připravujeme' : 'Předobjednávka'}</span><img src="img/${r.id}_white.jpg" alt="${esc(r.alt)}" loading="lazy" width="1200" height="900"></div>` +
  `<span class="card-meta"><span class="mono" style="color:var(--ink)">${no(i)}</span><span class="mono">${esc(r.preparing ? 'Připravujeme' : r.level)}</span></span>` +
  `<span><h3>${esc(r.name)}</h3><span class="type">${esc(r.type)}</span></span><span class="spec1">${r.card.map(c => esc(c[1])).join(' · ')}</span>` +
  `<p class="desc">${esc(r.short)}</p><span class="go">Detail sady <span aria-hidden="true">→</span></span></a>`).join('\n');
let home = read('index.html');
home = home.replace(/<div class="cards" id="cards">[\s\S]*?<\/div><!--\/cards-->|<div class="cards" id="cards"><\/div>/, `<div class="cards" id="cards">\n${cards}\n</div><!--/cards-->`)
  .replace(/<noscript><p>Pro katalog zapněte JavaScript[\s\S]*?<\/noscript>\n?/, '')
  .replace(/id="robot-count">\d+</, `id="robot-count">${R.length}<`).replace(/id="robot-count2">\d+</, `id="robot-count2">${R.length}<`);
if (!home.includes('<!--/cards-->')) throw new Error('index.html: cards placeholder not found');
fs.writeFileSync('index.html', home);

/* ---------- quiz: Czech kviz.html gets its hreflang pair + switcher in place, English copy at en/quiz/ ---------- */
{
  const page = 'en/quiz/', root = '../../';
  let src = setAlternates(read('kviz.html'), 'kviz.html', page);
  src = wireI18n(src, 'cs', 'kviz.html', 'kviz.html', page, '');
  fs.writeFileSync('kviz.html', src);
  let q = src
    .replace('<html lang="cs">', '<html lang="en">')
    .replace(/<title>[^<]*<\/title>/, '<title>Which robot is right for you? Quiz — printedrobotics.cz</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Three questions and we’ll recommend an open-source robot for your experience, goal and project size.">')
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${SITE}${page}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="Which open-source robot is right for you? A 30-second quiz">')
    .replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="Three questions about your experience, goal and project size – and we’ll recommend a robot kit.">')
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${SITE}${page}">`)
    .replace('<meta property="og:locale" content="cs_CZ">', '<meta property="og:locale" content="en_GB">')
    .replace(/(href|src)="assets\//g, `$1="${root}assets/`)
    .replace(/href="\.\/(#?[^"]*)"/g, `href="${root}$1"`)
    .replace(/<body data-page="quiz"/, `<body data-page="quiz" data-root="${root}"`);
  q = wireI18n(q, 'en', page, 'kviz.html', page, root);
  q = enLinks(translateHtml(q), page);
  assertEnglish(q, page);
  writePage(page + 'index.html', q.replace('<!doctype html>\n', '<!doctype html>\n<!-- generated by tools/build.mjs from kviz.html — edit that file, not this one -->\n'));
}

/* ---------- English licence & legal page (stub: legal text needs owner review) ---------- */
{
  const page = 'en/licence/', root = '../../';
  const rows = W.en.PR_LICENSES.map(l => `<tr><th scope="row">${esc(l[0])}</th><td><span class="mk ${l[1]}" aria-hidden="true"></span>${esc(l[2])}</td><td class="ink2">${esc(l[3])}</td></tr>`).join('');
  let p = read('tools/licence.en.template.html').replace('<!--rows-->', rows).replace(/\{root\}/g, root).replace(/\{site\}/g, SITE);
  p = wireI18n(p, 'en', page, '#licence', page, root);
  p = enLinks(p, page);
  assertEnglish(p, page);
  writePage(page + 'index.html', p);
}

// sitemap with hreflang pairs; sim/so101 is an indexable landing page, sim/arena is noindex
const pairs = [['', null], ['kviz.html', 'en/quiz/'], ...R.map(r => [PATH.kit('cs', r.id), PATH.kit('en', r.id)]), ['sim/so101/', null]];
const loc = (u, alt) => `  <url><loc>${SITE}${u}</loc>${alt ? `<xhtml:link rel="alternate" hreflang="cs" href="${SITE}${alt[0]}"/><xhtml:link rel="alternate" hreflang="en" href="${SITE}${alt[1]}"/>` : ''}</url>`;
const urls = [];
for (const [cs, en] of pairs) { urls.push(loc(cs, en && [cs, en])); if (en) urls.push(loc(en, [cs, en])); }
fs.writeFileSync('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
  urls.join('\n') + '\n</urlset>\n');
console.log('built', R.length, 'kits × 2 languages, en/quiz, en/licence (draft, noindex)');
