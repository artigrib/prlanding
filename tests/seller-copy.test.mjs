// Referral model guard: we sell nothing. We tell people what to buy and where, guide the build and let them
// practise on a virtual arm. A ready-made kit may come later, but only as future/conditional wording plus a
// waitlist. This test fails if the old seller copy ("we print / assemble / ship", pre-orders, "in the box",
// the "Sada s oživením" tier …) comes back into the built CZ/EN pages or the scripts that render page text.
// Run: node --test tests/seller-copy.test.mjs   (part of npm run test:unit)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SKIP = /^(node_modules|vendor|dist-hf|backend|docs|tools|tests|\.git|sim\/arena\/build|sim\/so101\/vendor)(\/|$)/;

// phrases that claim we print, assemble, ship, sell or take orders (case-insensitive)
const FORBIDDEN = [
  /\bvytiskneme\b/i, /\btiskneme\b/i, /\b(z)?kompletujeme\b/i, /\bposíláme\b/i, /v jedné krabici/i, /obsah krabice/i,
  /předobjedn/i, /\bobjednávám\b/i, /\bvyrábíme\b/i, /vyrábí tištěné díly/i, /kompletuje sadu/i,
  /sad[auy] s oživením/i, /na(?:ší|še|šich) stavebnic/i, /stavebnice pro\b/i, /prodáváme jen/i, /\bnabízíme\b/i,
  /expedic/i, /fakturu na školu/i, /vystavíme fakturu/i, /tisk a kompletace/i, /číslem zásilky/i,
  /\bwe print\b/i, /\bwe ship\b/i, /\bwe assemble\b/i, /pre-?orders?\b/i, /\bin the box\b/i, /\bour kits?\b/i,
  /\bkit includes\b/i, /\btested kit\b/i, /\bkit manufacturer\b/i, /\bwe (?:only )?sell\b(?! nothing)/i,
  /\bwe make the kit\b/i, /\bwe offer\b/i, /\bnabídneme\b/i, /\bwhen the kit launches\b/i, /\bbefore sales begin\b/i, /\bkit for\b/i
];
// clearly future/conditional wording that may contain a forbidden token; removed before checking
const ALLOW = [
  /(?:pokud|možná)\s[^.!?]{0,40}\bnabídneme\b/gi   // „Pokud hotovou sadu někdy nabídneme…“, „Hotovou sadu možná nabídneme později“
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join('/');
    if (SKIP.test(rel)) continue;
    if (e.isDirectory()) walk(path.join(dir, e.name), out);
    else if (/\.html$/.test(e.name)) out.push(rel);
  }
  return out;
}
// text a visitor or a crawler sees: page text, attributes (meta, alt, aria) and JSON-LD; markup is dropped
const visible = html => html
  .replace(/<script(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[a-z][^>]*?\s(?:content|alt|title|aria-label|placeholder)="([^"]*)"[^>]*>/gi, ' $1 ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ');
// scripts that render page text at runtime (kit page, quiz, soft forms, sim exploded view)
const SCRIPTS = ['assets/app.js', 'assets/data.js', 'assets/data.en.js', 'sim/so101/src/ui/explode.js'];
const strings = js => (js.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|\s\/\/ .*$/gm, ' ').match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) || []).filter(x => /\s/.test(x)).join(' ');

function hits(text) {
  for (const a of ALLOW) text = text.replace(a, ' ');
  return FORBIDDEN.map(re => (text.match(re) || [])[0] && text.slice(Math.max(0, text.search(re) - 50), text.search(re) + 60)).filter(Boolean);
}

test('built CZ/EN pages make no seller claims', () => {
  const pages = walk(ROOT);
  assert.ok(pages.includes('index.html') && pages.includes('en/index.html') && pages.includes('sada/so101/index.html') && pages.includes('en/kit/so101/index.html'), 'built pages not found');
  const bad = [];
  for (const p of pages) for (const h of hits(visible(fs.readFileSync(path.join(ROOT, p), 'utf8')))) bad.push(`${p}: …${h}…`);
  assert.deepEqual(bad, [], 'seller copy found (we sell nothing; a ready-made kit only as future/conditional wording):\n' + bad.join('\n'));
});

test('scripts that render page text make no seller claims', () => {
  const bad = [];
  for (const f of SCRIPTS) for (const h of hits(strings(fs.readFileSync(path.join(ROOT, f), 'utf8')))) bad.push(`${f}: …${h}…`);
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('the guard catches the old copy', () => {
  for (const s of ['Díly vám vytiskneme a pošleme v jedné krabici.', 'Předobjednávka · cenu a termín potvrdíme e-mailem', 'Sada s oživením',
    'printedrobotics.cz vyrábí tištěné díly a kompletuje sadu', 'We print, assemble and ship.', 'Pre-order', '02 — In the box', 'We only sell what the licence allows.', 'Sadu nabídneme na jaře.'])
    assert.ok(hits(s).length, 'not caught: ' + s);
  for (const s of ['Nic neprodáváme.', 'We sell nothing.', 'Hotovou sadu zatím nenabízíme.', 'Kdybychom hotovou sadu někdy nabídli, NC jen se souhlasem.', 'Pokud hotovou sadu někdy nabídneme, napíšeme.', 'Hotovou sadu možná nabídneme později.'])
    assert.equal(hits(s).length, 0, 'false positive: ' + s);
});
