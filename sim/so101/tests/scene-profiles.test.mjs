// Scene profiles stay in sync: src/objects/scene.js SCENES / profileOf, the missions' scene (src/missions.js sceneOf),
// app.js (which scene a mission or a dev URL loads) and core.js loadSim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCENES, PROFILES, profileOf } from '../src/objects/scene.js';
import { MISSIONS, sceneOf } from '../src/missions.js';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../core.js', import.meta.url), 'utf8');
const listOf = (name) => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]*\\])`).exec(app)[1].replace(/'/g, '"'));

test('the scene list: plain + every profile', async () => {
  assert.deepEqual(SCENES, ['plain', 'objects', 'conveyor', 'mobile']);
  for (const s of SCENES.slice(1)) {
    const P = await profileOf(s);
    assert.ok(Array.isArray(P.items) && typeof P.fixtures === 'function', s);
  }
  await assert.rejects(profileOf('nope'), /unknown scene profile/);
  // the object profiles never load the mobile module or edit the arm
  assert.equal(PROFILES.mobile, undefined);
  for (const s of ['objects', 'conveyor']) assert.equal((await profileOf(s)).arm, undefined, s);
  assert.equal((await profileOf('mobile')).arm.file, 'so101_mobile.xml');
});

test('every mission runs in a known scene, and app.js maps the same missions to the same scenes', () => {
  for (const x of MISSIONS) assert.ok(SCENES.includes(sceneOf(x)), x.id + ': ' + sceneOf(x));
  const lists = { objects: 'OBJECT_MISSIONS', conveyor: 'CONVEYOR_MISSIONS', mobile: 'MOBILE_MISSIONS' };
  for (const [scene, name] of Object.entries(lists)) {
    assert.deepEqual(listOf(name), MISSIONS.filter((x) => sceneOf(x) === scene).map((x) => x.id), name);
  }
  assert.deepEqual(listOf('MOBILE_MISSIONS'), [], 'no mobile missions before campaign PR 5');
  // dev views without a mission (?scene=…&test=1) name real profiles
  for (const s of listOf('DEV_SCENES')) assert.ok(SCENES.includes(s) && s !== 'plain', s);
  assert.ok(listOf('DEV_SCENES').includes('mobile'));
});

test('core.js loadSim compiles profiles through objectSceneXml and writes the edited arm MJCF', () => {
  assert.match(core, /S\.objectSceneXml\(xml, lib, L, profile\)/);
  assert.match(core, /if \(built\.arm\) mj\.FS\.writeFile\('\/m\/' \+ built\.arm\.file/);
});
