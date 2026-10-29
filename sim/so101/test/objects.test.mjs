// Object library: manifest, MJCF instancing/injection, and a MuJoCo (WASM) drop + pick check of the demo layout.
// Run: node --test sim/so101/test/objects.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ObjectLibrary, validateManifest, splitMjcf, instanceXml, injectObjects } from '../src/objects/library.js';
import { layoutFor, DEMO_LAYOUT } from '../src/objects/layout.js';
import { armIds, makePick } from '../src/objects/pick.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OBJ = path.join(DIR, 'objects');
const man = JSON.parse(fs.readFileSync(path.join(OBJ, 'manifest.json'), 'utf8'));
const scene = fs.readFileSync(path.join(DIR, 'model/scene.xml'), 'utf8');
const fsFetch = async (u) => {
  const b = fs.readFileSync(new URL(u));
  return { ok: true, status: 200, json: async () => JSON.parse(b), text: async () => b.toString('utf8'),
    arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const lib = () => new ObjectLibrary({ base: pathToFileURL(OBJ + '/'), fetch: fsFetch });

test('manifest is valid and every listed file exists within budget', () => {
  const v = validateManifest(man);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.ok(man.objects.length >= 3);
  const allowed = new Set(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'Apache-2.0', 'MIT', 'BSD-3-Clause', 'BSD-2-Clause']);
  for (const o of man.objects) {
    assert.ok(allowed.has(o.license), `${o.id}: licence ${o.license}`);
    assert.ok(o.attribution && /^https:\/\//.test(o.source_url), `${o.id}: attribution/source`);
    assert.ok(o.name_cs && o.category);
    const glb = fs.readFileSync(path.join(OBJ, o.files.glb));
    assert.ok(glb.length <= 300 * 1024, `${o.id}: GLB ${glb.length} B`);
    assert.equal(glb.toString('latin1', 0, 4), 'glTF');
    const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
    assert.ok(json.extensionsUsed.includes('EXT_meshopt_compression'), `${o.id}: meshopt`);
    const xml = fs.readFileSync(path.join(OBJ, o.files.mjcf), 'utf8');
    assert.match(xml, new RegExp(`<body name="${o.body}"`));
    assert.match(xml, /<inertial [^>]*mass="/);
  }
  assert.ok(fs.readFileSync(path.join(OBJ, 'LICENSES.md'), 'utf8').includes(man.objects[0].attribution));
});

test('validateManifest rejects bad entries', () => {
  const good = man.objects[0];
  const bad = (patch) => validateManifest({ version: 1, objects: [{ ...good, ...patch }] }).ok;
  assert.equal(bad({}), true);
  assert.equal(bad({ license: '' }), false);
  assert.equal(bad({ id: 'Bad Id' }), false);
  assert.equal(bad({ body: 'other' }), false);
  assert.equal(bad({ mass_kg: -1 }), false);
  assert.equal(bad({ size_m: [0.1, 0.1] }), false);
  assert.equal(bad({ files: { glb: '../x.glb', mjcf: 'a.xml' } }), false);
  assert.equal(validateManifest({ version: 1, objects: [good, good] }).ok, false);
  assert.equal(validateManifest({ objects: [] }).ok, false);
});

test('instanceXml renames every entity and sets the pose', () => {
  const o = man.objects.find((x) => x.id === 'mug');
  const text = fs.readFileSync(path.join(OBJ, o.files.mjcf), 'utf8');
  const it = instanceXml(o, text, { name: 'mug2', pos: [0.1, -0.2, 0.03], quat: [0, 0, 0, 1] });
  assert.ok(!/obj_mug/.test(it.asset + it.body), 'old names left');
  assert.match(it.body, /<body name="mug2" pos="0\.1 -0\.2 0\.03" quat="0 0 0 1">/);
  assert.match(it.body, /<freejoint name="mug2"\/>/);
  assert.match(it.asset, /<mesh name="mug2_c0"/);
  assert.equal((it.body.match(/mesh="mug2_c\d+"/g) || []).length, (it.asset.match(/<mesh /g) || []).length);
  assert.deepEqual(it.qpos, [0.1, -0.2, 0.03, 0, 0, 0, 1]);
  assert.throws(() => instanceXml(o, text, { name: 'Bad name' }));
  assert.throws(() => splitMjcf('<mujoco/>'));
});

test('injectObjects adds assets, bodies and extends keyframes', () => {
  const tiny = (n) => ({ id: n, name: n, asset: `<mesh name="${n}_c0" vertex="0 0 0 1 0 0 0 1 0 0 0 1"/>`,
    body: `<body name="${n}" pos="0 0 0"><freejoint/></body>`, qpos: [1, 2, 3, 1, 0, 0, 0] });
  const src = '<mujoco><worldbody><body name="a"/></worldbody><worldbody></worldbody>' +
    '<keyframe><key name="k" qpos="9" qvel="8"/><key qpos="7"/></keyframe></mujoco>';
  const out = injectObjects(src, [tiny('o1'), tiny('o2')]);
  assert.ok(out.indexOf('<asset>') < out.indexOf('<worldbody>'));
  assert.ok(out.lastIndexOf('<body name="o2"') > out.lastIndexOf('<worldbody>'), 'bodies go into the last worldbody');
  assert.match(out, /<key name="k" qpos="9 1 2 3 1 0 0 0 1 2 3 1 0 0 0" qvel="8 0 0 0 0 0 0 0 0 0 0 0 0"\/>/);
  assert.match(out, /<key qpos="7 1 2 3 1 0 0 0 1 2 3 1 0 0 0"\/>/);
  assert.equal(injectObjects(src, []), src);
  assert.throws(() => injectObjects(src, [tiny('o1'), tiny('o1')]), /duplicate/);
  assert.throws(() => injectObjects('<mujoco/>', [tiny('o1')]), /worldbody/);
});

test('ObjectLibrary fetches lazily and caches', async () => {
  let n = 0;
  const L = new ObjectLibrary({ base: pathToFileURL(OBJ + '/'), fetch: (u) => { n++; return fsFetch(u); } });
  await L.manifest(); await L.manifest();
  assert.equal(n, 1);
  await L.instance('dino'); await L.instance('dino', { name: 'dino_b' });
  assert.equal(n, 2);
  await assert.rejects(L.instance('nope'), /unknown object/);
});

// ---------------------------------------------------------------- MuJoCo (vendored WASM)
async function mujocoWithScene(instances) {
  const loadMujoco = (await import(pathToFileURL(path.join(DIR, 'vendor/mujoco/mujoco.js')))).default;
  const mj = await loadMujoco({ wasmBinary: fs.readFileSync(path.join(DIR, 'vendor/mujoco/mujoco.wasm')) });
  mj.FS.mkdir('/m'); mj.FS.mkdir('/m/assets');
  mj.FS.writeFile('/m/so101.xml', fs.readFileSync(path.join(DIR, 'model/so101.xml')));
  for (const f of fs.readdirSync(path.join(DIR, 'model/assets'))) mj.FS.writeFile('/m/assets/' + f, fs.readFileSync(path.join(DIR, 'model/assets', f)));
  mj.FS.writeFile('/m/scene_objects.xml', injectObjects(scene, instances));
  const m = mj.MjModel.from_xml_path('/m/scene_objects.xml');
  return { mj, m };
}

test('demo layout: objects compile into the SO-101 scene, settle, and each can be picked up', async () => {
  const L = lib();
  const layout = layoutFor(await L.manifest());
  assert.deepEqual(layout.slice(0, DEMO_LAYOUT.length).map((l) => l.id), DEMO_LAYOUT.map((l) => l.id));
  const inst = await Promise.all(layout.map((l) => L.instance(l.id, { pos: l.pos, quat: l.quat })));
  const { mj, m } = await mujocoWithScene(inst);
  const body = (n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_BODY.value, n);
  // the scene itself may gain free bodies (missions add cubes/balls): compare against the bare scene
  mj.FS.writeFile('/m/scene_bare.xml', scene);
  const bare = mj.MjModel.from_xml_path('/m/scene_bare.xml');
  assert.equal(m.nq, bare.nq + 7 * inst.length);
  assert.equal(m.nkey, bare.nkey);
  bare.delete();
  for (const it of inst) {   // every placed object (large extras may have no spare spot in the demo)
    const o = (await L.manifest()).objects.find((x) => x.id === it.id);
    const b = body(it.name);
    assert.ok(b >= 0);
    assert.ok(Math.abs(m.body_mass[b] - o.mass_kg) < 1e-3 * o.mass_kg + 1e-6, `${o.id} mass`);
  }
  // gripper conventions pick.js relies on (site x = approach, z = closing axis)
  const ids = armIds(mj, m);
  for (const id of DEMO_LAYOUT.map((l) => l.id)) {
    const d = new mj.MjData(m);
    mj.mj_resetDataKeyframe(m, d, 0);
    for (let i = 0; i < 300; i++) mj.mj_step(m, d);     // 1.2 s: settle
    for (const it of inst) {
      const b = body(it.name);
      const v = Math.hypot(d.cvel[6 * b + 3], d.cvel[6 * b + 4], d.cvel[6 * b + 5]);
      // curated demo objects must be at rest; imported extras on spare spots only must not misbehave
      const curated = DEMO_LAYOUT.some((l) => 'obj_' + l.id === it.name);
      assert.ok(v < (curated ? 0.03 : 0.1), `${it.name} still moving (${v.toFixed(3)} m/s)`);
      assert.ok(d.xpos[3 * b + 2] > -0.005 && d.xpos[3 * b + 2] < 0.02, `${it.name} rests on the table`);
    }
    const o = (await L.manifest()).objects.find((x) => x.id === id);
    const b = body(o.body), z0 = d.xpos[3 * b + 2];
    const P = makePick(mj, m, d, ids, b, o.size_m);
    assert.ok(P.reachable, `${id}: IK target reachable`);
    let guard = 0;
    while (P.step(m.opt.timestep) !== 'done' && guard++ < 5000) mj.mj_step(m, d);
    for (let i = 0; i < 250; i++) mj.mj_step(m, d);    // hold 1 s
    const lifted = d.xpos[3 * b + 2] - z0;
    assert.ok(lifted > 0.04, `${id}: lifted only ${(lifted * 100).toFixed(1)} cm`);
    for (let i = 0; i < m.nq; i++) assert.ok(Number.isFinite(d.qpos[i]));
    d.delete();
  }
  m.delete();
});
