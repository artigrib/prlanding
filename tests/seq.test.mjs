// /3d/ image-sequence scrub: load order, scroll mapping, manifest/assets integrity.
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import {loadOrder, scrollU, frameFor, nearest} from '../3d/seq-core.mjs';

test('loadOrder starts first/last/middle and covers every frame once', () => {
  for (const n of [1, 2, 3, 80, 150]) {
    const o = loadOrder(n);
    assert.equal(o.length, n); assert.equal(new Set(o).size, n);
    if (n >= 3) assert.deepEqual(o.slice(0, 3), [0, n - 1, (n - 1) >> 1]);
  }
});
test('scrollU dwells on a thesis and maps ends', () => {
  const c = [100, 200, 300];
  assert.equal(scrollU(0, c), 0); assert.equal(scrollU(999, c), 2);
  assert.equal(scrollU(110, c), 0); assert.equal(scrollU(150, c), .5); assert.equal(scrollU(150, c, true), 1);
});
test('frameFor clamps and hits both ends', () => {
  assert.equal(frameFor(0, 12, 150), 0); assert.equal(frameFor(12, 12, 150), 149); assert.equal(frameFor(99, 12, 150), 149);
});
test('nearest finds closest loaded frame', () => {
  assert.equal(nearest(5, [1, 0, 0, 0, 0, 0, 0, 1]), 7); assert.equal(nearest(2, [0, 0, 0]), -1);
});
test('manifest frames exist, within budget', () => {
  const M = JSON.parse(fs.readFileSync('3d/seq/manifest.json'));
  let total = 0;
  for (const k of ['desktop', 'mobile']) {
    const s = M[k]; assert.ok(s.frames >= 60 && s.frames <= 160, k);
    for (let i = 0; i < s.frames; i++) {
      const f = `3d/seq/${s.dir}/${String(i).padStart(3, '0')}.webp`, b = fs.statSync(f).size;
      assert.ok(b < 120 * 1024, f); total += b;
    }
  }
  assert.ok(total < 12 * 1048576, 'total ' + total);
});
