// Every object name shown on objects.html / in the missions has an English translation (smoke-en fails otherwise,
// and only once the page has finished loading – which made it depend on the runner's speed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import en from '../src/i18n/en.js';
import { LIB_LABELS, FIXTURES } from '../src/objects/scene.js';

const man = JSON.parse(fs.readFileSync(new URL('../objects/manifest.json', import.meta.url), 'utf8'));

test('manifest object names have EN translations', () => {
  const miss = [...new Set(man.objects.map((o) => o.name_cs))].filter((n) => !(n in en.strings));
  assert.deepEqual(miss, [], 'add to src/i18n/en.js: ' + miss.join(', '));
});

test('mission object and fixture labels have EN translations', () => {
  const labels = [...Object.values(LIB_LABELS).flat(), ...Object.values(FIXTURES).flatMap((f) => f.label)];
  const miss = [...new Set(labels)].filter((n) => !(n in en.strings));
  assert.deepEqual(miss, [], 'add to src/i18n/en.js: ' + miss.join(', '));
});
