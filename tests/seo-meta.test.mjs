// Search basics for every page in sitemap.xml: the page exists, is indexable, its canonical is the sitemap URL,
// it has a unique <title> (≤ 60 chars) and meta description (≤ 155 chars), and its JSON-LD parses, carries the
// fields schema.org needs and claims no offer, price or rating (we sell nothing and have no reviews).
// Run: node --test tests/seo-meta.test.mjs   (part of npm run test:unit; run node tools/build.mjs first)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://printedrobotics.cz/';
const unesc = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const locs = [...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const fileOf = u => { let p = new URL(u).pathname.slice(1); if (p === '' || p.endsWith('/')) p += 'index.html'; return p; };
// one entry per file: a ?lang=en variant of a page is the same document
const pages = [...new Map(locs.filter(u => !new URL(u).search).map(u => [fileOf(u), u])).entries()];
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const head = f => read(f).split('</head>')[0];

test('sitemap pages exist, are indexable and canonical', () => {
  assert.ok(pages.length > 20, 'sitemap looks empty');
  const bad = [];
  for (const [f, u] of pages) {
    if (!fs.existsSync(path.join(ROOT, f))) { bad.push(`${u}: no file ${f}`); continue; }
    const h = head(f);
    if (/<meta name="robots" content="[^"]*noindex/.test(h)) bad.push(`${u}: noindex page in the sitemap`);
    const c = /<link rel="canonical" href="([^"]*)"/.exec(h);
    if (!c || c[1] !== u) bad.push(`${u}: canonical ${c ? c[1] : 'missing'}`);
  }
  assert.deepEqual(bad, []);
});

test('every sitemap page has a unique title (≤ 60) and description (≤ 155)', () => {
  const bad = [], seenT = new Map(), seenD = new Map();
  for (const [f, u] of pages) {
    const h = head(f);
    const t = /<title>([^<]*)<\/title>/.exec(h), d = /<meta name="description" content="([^"]*)"/.exec(h);
    const title = t && unesc(t[1]).trim(), desc = d && unesc(d[1]).trim();
    if (!title) bad.push(`${u}: no <title>`); else if (title.length > 60) bad.push(`${u}: title ${title.length} chars: ${title}`);
    if (!desc) bad.push(`${u}: no meta description`); else if (desc.length > 155) bad.push(`${u}: description ${desc.length} chars: ${desc}`);
    if (title) { if (seenT.has(title)) bad.push(`${u}: same title as ${seenT.get(title)}`); seenT.set(title, u); }
    if (desc) { if (seenD.has(desc)) bad.push(`${u}: same description as ${seenD.get(desc)}`); seenD.set(desc, u); }
  }
  assert.deepEqual(bad, []);
});

test('JSON-LD parses, has the required fields and no offers or ratings', () => {
  const bad = [], seen = new Set();
  const need = {
    BreadcrumbList: j => Array.isArray(j.itemListElement) && j.itemListElement.length > 0 && j.itemListElement.every((x, i) => x.position === i + 1 && x.name && String(x.item).startsWith(SITE)),
    HowTo: j => j.name && Array.isArray(j.step) && j.step.length >= 3 && j.step.every(s => s['@type'] === 'HowToStep' && s.name && s.text),
    WebSite: j => j.name && String(j.url).startsWith(SITE),
    FAQPage: j => Array.isArray(j.mainEntity) && j.mainEntity.every(q => q.name && q.acceptedAnswer && q.acceptedAnswer.text),
    Article: j => j.headline && j.datePublished,
    Product: j => j.name && j.image
  };
  for (const [f, u] of pages) {
    for (const m of read(f).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      let j;
      try { j = JSON.parse(m[1]); } catch (e) { bad.push(`${u}: invalid JSON-LD (${e.message})`); continue; }
      if (j['@context'] !== 'https://schema.org' || !j['@type']) bad.push(`${u}: JSON-LD without @context/@type`);
      seen.add(j['@type']);
      if (need[j['@type']] && !need[j['@type']](j)) bad.push(`${u}: ${j['@type']} misses required fields`);
      if (/"(offers|aggregateRating|review|price|priceCurrency)"\s*:/.test(m[1])) bad.push(`${u}: JSON-LD claims an offer, price or rating`);
    }
  }
  for (const t of ['WebSite', 'HowTo', 'BreadcrumbList']) assert.ok(seen.has(t), `no ${t} JSON-LD on any sitemap page`);
  assert.deepEqual(bad, []);
});
