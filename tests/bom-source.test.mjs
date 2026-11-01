// r.bomSource === 'cad': a robot whose project publishes no BOM must not be presented as "per the project's BOM"
// (box title, box note, FAQ, meta description), in Czech or in English. node --test tests/bom-source.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const W = { window: {} };
vm.runInNewContext(read('assets/data.js'), W);
const D = W.window;
const cad = D.PR_ROBOTS.filter((r) => r.bomSource === 'cad');
const BOM = /podle kusovníku|from the bill of materials|per the project’s bill of materials|following the bill of materials/i;

test('bomSource values are known', () => {
  for (const r of D.PR_ROBOTS) assert.ok(r.bomSource == null || r.bomSource === 'cad', r.id);
  assert.ok(cad.some((r) => r.id === 'orca'), 'ORCA publishes no hand BOM');
});

test('cad robots: box title, note and FAQ do not claim a project BOM', () => {
  for (const r of cad) {
    assert.match(D.PR_BOX_TITLE(r, 5), /^Sestaveno z CAD a dokumentace projektu · 5 položek$/);
    assert.match(D.PR_BOX_NOTE(r), /^Projekt kusovník nezveřejňuje; seznam jsme sestavili z CAD sestavy/);
    for (const [q, a] of D.PR_FAQ(r)) assert.doesNotMatch(a, /podle kusovníku projektu/, r.id + ': ' + q);
  }
  // others unchanged
  const so = D.PR_ROBOTS.find((r) => r.id === 'so101');
  assert.equal(D.PR_BOX_TITLE(so, 9), 'Podle kusovníku projektu · 9 položek');
});

test('cad robots: built pages (cs + en) say where the list comes from', () => {
  for (const r of cad) {
    for (const [f, ok] of [[`sada/${r.id}/index.html`, /podle CAD a dokumentace/], [`en/kit/${r.id}/index.html`, /compiled from the CAD and docs/]]) {
      const html = read(f);
      const desc = /<meta name="description" content="([^"]*)"/.exec(html)[1];
      assert.match(desc, ok, f);
      assert.doesNotMatch(desc, BOM, f);
      const faq = /<div class="faq" id="faq-list">(.*?)<\/div>/s.exec(html)[1];
      assert.doesNotMatch(faq, BOM, f + ' FAQ');
      const note = /<p class="mono" id="box-note"[^>]*>([^<]*)</.exec(html)[1];
      assert.doesNotMatch(note, /dle kusovníku|per the project/i, f + ' note');
      assert.doesNotMatch(html, /podle kusovníku projektu <span id="l-name2">|following the bill of materials of/, f + ' licence section');
    }
  }
});
