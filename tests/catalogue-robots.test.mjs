// Catalogue robot files (data/robots/<id>.json + _order.json): schema, unique ids, complete order, English
// overrides only for known keys, and the committed assets/data.js / data.en.js equal what tools/build.mjs generates.
// tools/build.mjs runs the same check and refuses to build on an error.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRobots, checkRobots, generateData, js } from '../tools/catalogue.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every data/robots/*.json is valid', () => {
  assert.deepEqual(checkRobots(ROOT), []);
});

test('order is complete and ids are unique', () => {
  const { robots, showcase } = loadRobots(ROOT);
  const order = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/robots/_order.json'), 'utf8'));
  const files = fs.readdirSync(path.join(ROOT, 'data/robots')).filter(f => f.endsWith('.json') && f !== '_order.json').map(f => f.slice(0, -5)).sort();
  const ids = [...order.robots, ...order.showcase];
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), files);
  assert.deepEqual(robots.map(r => r.id), order.robots);
  assert.deepEqual(showcase.map(r => r.id), order.showcase);
  assert.equal(robots[0].id, 'so101', 'N° 01 stays SO-101');
});

test('committed assets/data.js and data.en.js are the generated ones', () => {
  const { cs, en } = generateData(ROOT);
  assert.equal(fs.readFileSync(path.join(ROOT, 'assets/data.js'), 'utf8'), cs, 'run node tools/build.mjs');
  assert.equal(fs.readFileSync(path.join(ROOT, 'assets/data.en.js'), 'utf8'), en, 'run node tools/build.mjs');
});

test('JS output round-trips strings with quotes, backslashes and line breaks', () => {
  const v = { a: "it's \\ a\nb\u2028", 'x-y': [1, true, null, ['p', 'q']], e: {} };
  assert.deepEqual(new Function('return ' + js(v))(), v);
});

// the checker catches broken files (run on a scratch copy of data/robots + data/catalogue)
function withCopy(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robots-'));
  for (const d of ['data/robots', 'data/catalogue']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  const rd = f => JSON.parse(fs.readFileSync(path.join(dir, 'data/robots', f), 'utf8'));
  const wr = (f, v) => fs.writeFileSync(path.join(dir, 'data/robots', f), JSON.stringify(v));
  mutate({ rd, wr, rm: f => fs.rmSync(path.join(dir, 'data/robots', f)) });
  try { return checkRobots(dir).join('\n'); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('the checker rejects broken robot files', () => {
  const cases = [
    [({ rd, wr }) => { const r = rd('otto.json'); delete r.short; wr('otto.json', r); }, /otto\.json: missing required field "short"/],
    [({ rd, wr }) => { const r = rd('otto.json'); r.id = 'spot'; wr('otto.json', r); }, /otto\.json: id "spot" does not match/],
    [({ rd, wr }) => { const o = rd('_order.json'); o.robots = o.robots.filter(x => x !== 'otto'); wr('_order.json', o); }, /otto\.json: not listed in _order\.json/],
    [({ rd, wr }) => { const o = rd('_order.json'); o.robots.push('nope'); wr('_order.json', o); }, /"nope" has no file/],
    [({ rd, wr }) => { const o = rd('_order.json'); o.robots.push('otto'); wr('_order.json', o); }, /"otto" listed twice/],
    [({ rd, wr }) => { const r = rd('otto.json'); r.en.repo = 'x'; wr('otto.json', r); }, /en: "repo" is not an English override key/],
    [({ rd, wr }) => { const r = rd('otto.json'); r.en.printTime = '1 h'; delete r.printTime; wr('otto.json', r); }, /missing required field "printTime"/],
    [({ rd, wr }) => { const r = rd('so101.json'); r.en.specs = r.en.specs.slice(1); wr('so101.json', r); }, /en: "specs" must have the same 5 rows/],
    [({ rd, wr }) => { const r = rd('origin.json'); r.en.foo = 'x'; wr('origin.json', r); }, /origin\.json: en: "foo" is not an English override key/],
    [({ rd, wr }) => { const r = rd('otto.json'); r.colour = 'red'; wr('otto.json', r); }, /unknown field "colour"/],
    [({ rd, wr }) => { const r = rd('otto.json'); r.cat = 'boats'; wr('otto.json', r); }, /cat "boats" is not a PR_CATS key/],
    [({ rd, wr }) => { const r = rd('otto.json'); r.related = ['nope']; wr('otto.json', r); }, /related "nope" is not a catalogue id/],
    [({ rd, wr }) => { const r = rd('otto.json'); r.glb = 'yes'; wr('otto.json', r); }, /"glb" must be boolean/]
  ];
  for (const [mutate, re] of cases) assert.match(withCopy(mutate), re);
  assert.equal(withCopy(() => {}), '');
});
