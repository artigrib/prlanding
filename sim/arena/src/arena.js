// Arena facade. Maps live in ./maps/ (registry: MAPS, MAP_LIST, createMap); this file keeps the
// original single-arena exports working for code that has not moved to the registry yet.
// 1 unit = 10 cm. The legacy constants describe the "CCRL klasika" map.
import { createMap } from './maps/index.js';
import { HALF, PIT, GAP } from './maps/klasika.js';
import { WALL_H, WALL_T, BASE_Y } from './maps/kit.js';

export { MAPS, MAP_LIST, DEFAULT_MAP, createMap, buildMap } from './maps/index.js';
export { HALF, PIT, GAP, WALL_H, WALL_T, BASE_Y };

export const inPit = (x, z) => x > PIT.x0 && z > PIT.z0 && x < PIT.x1 + 0.5 && z < PIT.z1 + 0.5;

// legacy path: one klasika map, no per-step / per-frame hooks (so no debris, which needs frame())
let legacy = null;
export function buildArenaVisual(scene) {
  legacy = createMap('klasika', { scene, debris: false, applyEnv: false });
  return legacy.group;
}
export function buildArenaPhysics(RAPIER, world) {
  if (!legacy) throw new Error('buildArenaVisual() first');
  legacy.attachPhysics(RAPIER, world);
  return legacy;
}
