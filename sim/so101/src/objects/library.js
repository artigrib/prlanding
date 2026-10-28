// Object library for the SO-101 sim — physics-ready objects converted by tools/assets (OpenUSD -> GLB + MJCF).
// Standalone ES module, no dependencies: works in the browser and in node (tests).
//
//   const lib = new ObjectLibrary();                       // base: sim/so101/objects/
//   const man = await lib.manifest();
//   const inst = [await lib.instance('mug', { pos: [0.22, -0.12, 0.02] })];
//   const xml = injectObjects(sceneXmlText, inst);         // -> compile with MuJoCo as usual
//   const view = await lib.attach({ THREE, loader, parent: world, mj, model, data, instances: inst });
//   ... each frame after mj_step: view.sync();
//
// Object MJCF files (written by tools/assets/convert.py) are standalone <mujoco> documents with one <asset> and one
// <worldbody><body name="obj_<id>">; every name in them starts with "obj_<id>", which is how instances get renamed.

const NAME_RE = /^[a-z][a-z0-9_]{0,47}$/;
export const DEFAULT_BASE = new URL('../../objects/', import.meta.url);

// ---------------------------------------------------------------- manifest
const REQUIRED = ['id', 'name_cs', 'category', 'mass_kg', 'size_m', 'license', 'attribution', 'source_url', 'files', 'body'];

export function validateManifest(man) {
  const errors = [];
  if (!man || man.version !== 1 || !Array.isArray(man.objects)) return { ok: false, errors: ['bad manifest header'] };
  const seen = new Set();
  for (const o of man.objects) {
    const id = o && o.id;
    for (const k of REQUIRED) if (o[k] == null || o[k] === '') errors.push(`${id}: missing ${k}`);
    if (!NAME_RE.test(String(id))) errors.push(`${id}: bad id`);
    if (seen.has(id)) errors.push(`${id}: duplicate id`);
    seen.add(id);
    if (o.body !== 'obj_' + id) errors.push(`${id}: body must be obj_${id}`);
    if (!(o.mass_kg > 0 && o.mass_kg < 5)) errors.push(`${id}: mass out of range`);
    if (!Array.isArray(o.size_m) || o.size_m.length !== 3 || !o.size_m.every((s) => s > 0 && s < 1)) errors.push(`${id}: bad size_m`);
    if (o.files && (!/\.glb$/.test(o.files.glb || '') || !/\.xml$/.test(o.files.mjcf || ''))) errors.push(`${id}: bad files`);
    for (const f of Object.values(o.files || {})) if (/^\/|\.\.|:/.test(f)) errors.push(`${id}: file path must be relative`);
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------- MJCF helpers (pure string functions)
export function splitMjcf(text) {
  const a = /<asset>([\s\S]*?)<\/asset>/.exec(text);
  const b = /<worldbody>([\s\S]*)<\/worldbody>/.exec(text);
  if (!a || !b) throw new Error('object MJCF needs one <asset> and one <worldbody>');
  return { asset: a[1].trim(), body: b[1].trim() };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const num = (v) => (Math.abs(v) < 1e-12 ? '0' : String(+v.toFixed(6)));

// One placed copy of an object: names re-prefixed (obj_mug -> name), body pose set. Returns the pieces
// injectObjects() needs plus the 7 freejoint qpos values for keyframes.
export function instanceXml(entry, mjcfText, { name = entry.body, pos = [0, 0, 0], quat = [1, 0, 0, 0] } = {}) {
  if (!NAME_RE.test(name)) throw new Error('bad instance name: ' + name);
  const { asset, body } = splitMjcf(mjcfText);
  const re = new RegExp(`(\\b(?:name|mesh)=")${esc(entry.body)}(?=["_])`, 'g');
  const rename = (s) => s.replace(re, `$1${name}`);
  const pose = `pos="${pos.map(num).join(' ')}" quat="${quat.map(num).join(' ')}"`;
  const placed = rename(body).replace(/<body\b([^>]*)>/, (m, attrs) =>
    `<body${attrs.replace(/\s(?:pos|quat|euler|axisangle|xyaxes|zaxis)="[^"]*"/g, '')} ${pose}>`);
  return { id: entry.id, name, asset: rename(asset), body: placed, qpos: [...pos, ...quat] };
}

// Insert object instances into a scene MJCF string:
//  - an extra <asset> block before the first <worldbody> (MJCF allows several asset sections)
//  - bodies at the end of the LAST worldbody (so their freejoints come last in qpos)
//  - every <key> gets the instances' qpos (pose) and zero qvel appended, so keyframes keep matching nq/nv
export function injectObjects(sceneXml, instances) {
  if (!instances || !instances.length) return sceneXml;
  const names = new Set();
  for (const it of instances) {
    if (names.has(it.name)) throw new Error('duplicate instance name: ' + it.name);
    names.add(it.name);
  }
  const i = sceneXml.indexOf('<worldbody'), j = sceneXml.lastIndexOf('</worldbody>');
  if (i < 0 || j < 0) throw new Error('scene has no <worldbody>');
  const assets = instances.map((it) => `<asset>\n${it.asset}\n</asset>`).join('\n');
  const bodies = instances.map((it) => it.body).join('\n');
  let out = sceneXml.slice(0, j) + bodies + '\n' + sceneXml.slice(j);
  out = out.slice(0, i) + assets + '\n' + out.slice(i);
  const q = instances.map((it) => it.qpos.map(num).join(' ')).join(' ');
  const v = instances.map(() => '0 0 0 0 0 0').join(' ');
  return out.replace(/<key\b[^>]*>/g, (tag) => tag
    .replace(/\bqpos="([^"]*)"/, (m, a) => `qpos="${a.trim()} ${q}"`)
    .replace(/\bqvel="([^"]*)"/, (m, a) => `qvel="${a.trim()} ${v}"`));
}

// ---------------------------------------------------------------- library (fetch + lazy GLB)
export class ObjectLibrary {
  constructor({ base = DEFAULT_BASE, fetch: f = globalThis.fetch } = {}) {
    this.base = new URL(base, DEFAULT_BASE);
    this.fetch = (u) => f(u);   // unbound call: window.fetch throws "Illegal invocation" otherwise
    this._man = null; this._xml = new Map(); this._glb = new Map();
  }

  async _get(rel, kind) {
    const r = await this.fetch(new URL(rel, this.base));
    if (!r.ok) throw new Error(`HTTP ${r.status} ${rel}`);
    return kind === 'json' ? r.json() : kind === 'bytes' ? new Uint8Array(await r.arrayBuffer()) : r.text();
  }

  async manifest() {
    if (!this._man) {
      const man = await this._get('manifest.json', 'json');
      const v = validateManifest(man);
      if (!v.ok) throw new Error('invalid objects manifest: ' + v.errors.slice(0, 3).join('; '));
      this._man = man;
      this.byId = new Map(man.objects.map((o) => [o.id, o]));
    }
    return this._man;
  }

  async entry(id) {
    await this.manifest();
    const e = this.byId.get(id);
    if (!e) throw new Error('unknown object: ' + id);
    return e;
  }

  async mjcf(id) {
    const e = await this.entry(id);
    if (!this._xml.has(id)) this._xml.set(id, this._get(e.files.mjcf, 'text'));
    return this._xml.get(id);
  }

  async instance(id, opts = {}) {
    const e = await this.entry(id);
    return instanceXml(e, await this.mjcf(id), opts);
  }

  // GLB is fetched only when first needed and parsed once; each call returns a fresh clone.
  async glb(id, loader) {
    const e = await this.entry(id);
    if (!this._glb.has(id)) {
      this._glb.set(id, this._get(e.files.glb, 'bytes').then((b) => new Promise((res, rej) =>
        loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', (g) => res(g.scene), rej))));
    }
    return (await this._glb.get(id)).clone(true);
  }

  // Create visuals for compiled instances. `parent` is a Z-up group (MuJoCo frame). Returns { sync, items }.
  async attach({ THREE, loader, parent, mj, model, data, instances }) {
    const items = await Promise.all(instances.map(async (it) => {
      const body = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, it.name);
      if (body < 0) throw new Error('instance not in model: ' + it.name);
      const g = new THREE.Group();
      const vis = await this.glb(it.id, loader);
      vis.rotation.x = Math.PI / 2;            // glTF Y-up -> MuJoCo Z-up
      vis.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(vis);
      parent.add(g);
      return { ...it, bodyId: body, group: g };
    }));
    const sync = () => {
      const xp = data.xpos, xq = data.xquat;
      for (const it of items) {
        const b = it.bodyId;
        it.group.position.set(xp[3 * b], xp[3 * b + 1], xp[3 * b + 2]);
        it.group.quaternion.set(xq[4 * b + 1], xq[4 * b + 2], xq[4 * b + 3], xq[4 * b]);
      }
    };
    sync();
    return { items, sync };
  }
}
