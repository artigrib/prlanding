// Map registry. See sim/arena/TEAM.md "## Interfaces" for the contract.
//
//   import { MAPS, MAP_LIST, DEFAULT_MAP, createMap } from './maps/index.js';
//   const map = createMap(id, { scene, quality: touch ? 'low' : 'high', onEvent });
//   map.attachPhysics(RAPIER, world);           // once the world exists
//   // per round: map.reset(); robots.reset(map.spawnPoints[i])
//   // per fixed step: robots.step(); map.step(DT, [player, ai], fighting); world.step(); map.afterStep([player, ai])
//   // per frame: map.frame(dt)
//   // rules: map.outCheck(x, y, z) -> null | 'pit' | 'out'; map.hazardAt(x, z) (AI); map.status() (HUD)
//   map.dispose()                               // removes meshes + bodies, restores scene env
import { createRuntime } from './base.js';
import { klasika } from './klasika.js';
import { jama } from './jama.js';
import { kladivo } from './kladivo.js';
import { led } from './led.js';
import { praha } from './praha.js';

const defs = [klasika, jama, kladivo, led, praha];

export const MAPS = Object.fromEntries(defs.map(d => [d.id, {
  id: d.id, name: d.name, description: d.description, blurb: d.blurb || d.description, tags: d.tags, preview: d.preview,
  create: ctx => createRuntime(d.spec(), ctx)
}]));
export const MAP_LIST = defs.map(d => d.id);
export const DEFAULT_MAP = 'klasika';

export function createMap(id, ctx) {
  const def = Object.prototype.hasOwnProperty.call(MAPS, id) ? MAPS[id] : MAPS[DEFAULT_MAP];
  return def.create(ctx);
}

// convenience: build visuals and (when RAPIER/world are given) physics in one call
export function buildMap(id, scene, RAPIER, world, opts = {}) {
  const map = createMap(id, { scene, ...opts });
  if (RAPIER && world) map.attachPhysics(RAPIER, world);
  return map;
}
