// Builds one static page per robot: /sada/<id>/index.html
// with its own title, description, Open Graph preview, canonical URL and Schema.org data,
// so links shared in messengers show the right robot. Also rewrites sitemap.xml.
// Run from the repo root:  node tools/build.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const SITE = 'https://printedrobotics.cz/';
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync('assets/data.js', 'utf8'), ctx);
const R = ctx.window.PR_ROBOTS, SIMS = ctx.window.PR_SIMS || {};
const tpl = fs.readFileSync('tools/sada.template.html', 'utf8');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ROOT = '../../';
const no = i => String(i + 1).padStart(2, '0');

for (const r of R) {
  const url = `${SITE}sada/${r.id}/`;
  // search-intent title (≤ ~60 chars) and a description cut at a word boundary to ≤ 155 chars
  const t1 = `${r.name} – stavebnice: ${r.type.toLowerCase()} | printedrobotics.cz`;
  const title = t1.length <= 64 ? t1 : `${r.name} – stavebnice | printedrobotics.cz`;
  const clip = (t, n) => t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n - 1)).replace(/[,;:–-]$/, '') + '…';
  const desc = clip(r.preparing
    ? `${r.name} připravujeme jako stavebnici. ${r.short} Nechte e-mail, dáme vědět jako prvním.`
    : `Stavebnice ${r.name}: vytištěné díly a hardware podle kusovníku v jedné krabici. ${r.short}`, 155);
  const byId = Object.fromEntries(R.map(x => [x.id, x]));
  const H = `../../`;
  // unknown values ('—') are omitted, same list as the runtime page
  const specs = ctx.window.PR_SPECS(r);
  const sim = r.sim && SIMS[r.sim];
  const simCta = sim ? `<a class="sim-cta" id="sim-cta" href="${ROOT}${sim.path}${sim.robotParam ? '?robot=' + r.id : ''}"><span><b>${esc(sim.label)}</b><small>${esc(sim.note)}</small></span><span aria-hidden="true">→</span></a>\n` : '';
  const noSw = !r.sw || r.sw === '—';
  const prerender = {
    specs: specs.map(x => `<div><dt>${esc(x[0])}</dt><dd>${esc(x[1])}</dd></div>`).join(''),
    box: [['Tištěné díly podle STL projektu', '1 sada']].concat(r.bom || []).map((b, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${esc(b[0])}</span><span class="q">${esc(b[1])}</span><span class="t"></span></li>`).join(''),
    related: r.related.map(id => byId[id]).filter(Boolean).map(x => `<a href="${H}sada/${x.id}/"><b>${esc(x.name)}</b><span class="muted" style="font-size:15px">${esc(x.short)}</span></a>`).join('')
  };
  const img = `${SITE}img/${r.id}_white.jpg`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: `Stavebnice pro ${r.name}`, description: r.lead, category: r.type,
    image: img, url, brand: { '@type': 'Brand', name: 'printedrobotics.cz' }, isBasedOn: r.repo,
    additionalProperty: specs.map(s => ({ '@type': 'PropertyValue', name: s[0], value: s[1] }))
  };
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:title" content="${esc('Stavebnice pro ' + r.name)}">`,
    `<meta property="og:description" content="${esc(r.short)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="900">`,
    `<meta property="og:image:alt" content="${esc(r.alt)}">`,
    `<meta property="og:locale" content="cs_CZ">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="preload" as="image" href="${ROOT}img/${r.id}_white.jpg" fetchpriority="high">`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`
  ].join('\n');

  let html = tpl
    .replace(/<title>[^<]*<\/title>\n<meta name="description"[^>]*>\n<link rel="canonical"[^>]*>/, head)
    .replace(/(href|src)="assets\//g, `$1="${ROOT}assets/`)
    .replace(/href="\.\/(#?[^"]*)"/g, `href="${ROOT}$1"`)
    .replace(/href="kviz\.html"/g, `href="${ROOT}kviz.html"`)
    .replace('<body data-page="product"', `<body data-page="product" data-robot="${r.id}" data-root="${ROOT}"`)
    // server-rendered name so the page reads right before scripts run
    .replace('<h1 class="p-name" id="p-name"></h1>', `<h1 class="p-name" id="p-name">${esc(r.name)}</h1>`)
    .replace('<dl class="a4 specs" id="specs"></dl>', `<dl class="a4 specs" id="specs">${prerender.specs}</dl>`)
    .replace('<ol class="box" id="box"></ol>', `<ol class="box" id="box">${prerender.box}</ol>`)
    .replace('<div class="a4 rel" id="related"></div>', `<div class="a4 rel" id="related">${prerender.related}</div>`)
    .replace('<span id="l-name"></span>', `<span id="l-name">${esc(r.name)}</span>`)
    .replace('<span id="l-author"></span>', `<span id="l-author">${esc(r.author)}</span>`)
    .replace('<span id="l-name2"></span>', `<span id="l-name2">${esc(r.name)}</span>`)
    .replace('<span id="l-hw"></span>', `<span id="l-hw">${esc(r.hw)}</span>`)
    .replace(', software pod licencí <span id="l-sw"></span>.', noSw ? ' (vlastní software nepotřebuje, ovládá se RC vysílačem).' : `, software pod licencí <span id="l-sw">${esc(r.sw)}</span>.`)
    .replace('<dd style="margin:0" id="l-hw2"></dd>', `<dd style="margin:0" id="l-hw2">${esc(r.hw)}</dd>`)
    .replace('<dd style="margin:0" id="l-sw2"></dd>', `<dd style="margin:0" id="l-sw2">${noSw ? 'bez vlastního softwaru (RC vysílač)' : esc(r.sw)}</dd>`)
    .replace('id="l-repo" href="#"', `id="l-repo" href="${esc(r.repo)}"`)
    .replace('id="l-docs" href="#"', `id="l-docs" href="${esc(r.docs)}"`)
    .replace(/(<p class="ink2" style="margin-top:8px" id="safety">)[^<]*(<\/p>)/, `$1${ctx.window.PR_SAFETY(r).map(esc).join('<br>')}$2`)
    .replace('<span class="h2" id="specs-title">Parametry</span>', `<span class="h2" id="specs-title">Parametry · ${specs.length}</span>`)
    .replace('<!--sim-cta-->\n', simCta)
    // hero, crumb and meta line so the page reads right without scripts (app.js rewrites the same nodes)
    .replace('<div class="tile" id="p-tile"></div>', `<div class="tile" id="p-tile"><img src="${ROOT}img/${r.id}_white.jpg" alt="${esc(r.alt)}" fetchpriority="high" width="1200" height="900"></div>`)
    .replace('<span id="crumb-cat"></span>', `<span id="crumb-cat">${esc(ctx.window.PR_CATS[r.cat])}</span>`)
    .replace('<span id="crumb-name" style="color:var(--ink)"></span>', `<span id="crumb-name" style="color:var(--ink)">${esc(r.name)}</span>`)
    .replace('<span id="p-no"></span>', `<span id="p-no">N° ${no(R.indexOf(r))} — ${esc(r.type)}</span>`)
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
      .replace('<fieldset id="setups-wrap">', '<fieldset id="setups-wrap" hidden>');
    if (!html.includes('Dejte mi vědět <span')) throw new Error('template changed (preparing): ' + r.id);
  }
  if (!html.includes(`data-robot="${r.id}"`) || !html.includes('og:image') || html.includes('<!--sim-cta-->') || !html.includes('id="l-hw">')) throw new Error('template changed: ' + r.id);
  fs.mkdirSync(`sada/${r.id}`, { recursive: true });
  html = html.replace('<!doctype html>\n', '<!doctype html>\n<!-- generated by tools/build.mjs from tools/sada.template.html — edit the template, not this file -->\n');
  fs.writeFileSync(`sada/${r.id}/index.html`, html);
}

// home: catalogue cards in the static HTML (scripts re-render the same cards with filters)
const cards = R.map((r, i) => `<a class="card" href="sada/${r.id}/"><div class="tile"><span class="tag">${r.preparing ? 'Připravujeme' : 'Předobjednávka'}</span><img src="img/${r.id}_white.jpg" alt="${esc(r.alt)}" loading="lazy" width="1200" height="900"></div>` +
  `<span class="card-meta"><span class="mono" style="color:var(--ink)">${no(i)}</span><span class="mono">${esc(r.preparing ? 'Připravujeme' : r.level)}</span></span>` +
  `<span><h3>${esc(r.name)}</h3><span class="type">${esc(r.type)}</span></span><span class="spec1">${r.card.map(c => esc(c[1])).join(' · ')}</span>` +
  `<p class="desc">${esc(r.short)}</p><span class="go">Detail sady <span aria-hidden="true">→</span></span></a>`).join('\n');
let home = fs.readFileSync('index.html', 'utf8');
home = home.replace(/<div class="cards" id="cards">[\s\S]*?<\/div><!--\/cards-->|<div class="cards" id="cards"><\/div>/, `<div class="cards" id="cards">\n${cards}\n</div><!--/cards-->`)
  .replace(/<noscript><p>Pro katalog zapněte JavaScript[\s\S]*?<\/noscript>\n?/, '')
  .replace(/id="robot-count">\d+</, `id="robot-count">${R.length}<`).replace(/id="robot-count2">\d+</, `id="robot-count2">${R.length}<`);
if (!home.includes('<!--/cards-->')) throw new Error('index.html: cards placeholder not found');
fs.writeFileSync('index.html', home);

// sim/so101 is an indexable landing page (canonical + description in its own head); sim/arena is noindex
const urls = ['', 'kviz.html', ...R.map(r => `sada/${r.id}/`), 'sim/so101/'];
fs.writeFileSync('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u => `  <url><loc>${SITE}${u}</loc></url>`).join('\n') + '\n</urlset>\n');
console.log('built', R.length, 'pages');
