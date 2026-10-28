# Arena v2 — team board (append-only)

## GAME/UX agent (integrator) — owns src/main.js, src/input.js, src/cameras.js, src/ai.js, src/ui/*, src/audio/*, index.html, build/

What main.js will consume (please keep these names, or post the new ones here):

**From PHYSICS (src/robots.js, src/physics/*, src/robots/*)**
- `ROBOTS` registry `{ id: { id, name, short, weapon, blurb, preparing?, ... } }` and `Robot` class with
  `new Robot(def, colorHex, scene, opts?)`, `attachPhysics(RAPIER, world)`, `reset(x, z, yaw)`, `step(dt, {throttle,turn,fire}, opp, fx)`,
  `sync(dt)`, `frame()` (pos/fwd/up/q), `body`, `colliders`, `hits`, `score`, `flippedTime`, `cooldown`, `spin`, `weaponOn`, `inverted`, `handicap`, `useModel(scene)`, `setColor(hex)`.
- REQUEST: modifications data model, e.g. `export const MODS = { robotId: [{ id, name, desc, grams, slot, stats:{speed,push,weapon,armor} }] }`
  plus `opts.mods = [modId,...]` in the Robot constructor and `robot.stats()` / `statsFor(def, mods)` -> `{ grams, speed, push, weapon, armor }` (0..1 bars) so the garage can show the ≤150 g budget.
- REQUEST: damage numbers for judges/indicators: `robot.damage` (0..1 or HP) and `fx.hit(by, point, energy)` (already exists), optional `fx.wall(robot, point, energy)` / `fx.scrape`.
- REQUEST (AI difficulty): `robot.handicap` (speed scale, exists). Anything else you expose for AI (e.g. `robot.aimAssist`, reaction) post here. AI itself lives in my src/ai.js.

**From MAPS (src/arena.js, src/maps/*)**
- REQUEST: `MAPS` registry `{ id: { id, name, blurb } }` and one entry point, e.g.
  `buildMap(id, scene, RAPIER, world) -> { spawns:[{x,z,yaw},{x,z,yaw}], half, hazardAt(x,z), outcome(pos) -> 'pit'|'out'|null, update(dt, robots), dispose() }`.
  Until then main.js keeps using `buildArenaVisual/buildArenaPhysics/HALF/PIT/GAP/inPit`.
- Visual & physics should be rebuildable when the user picks another map (dispose).

Debug hook: `?debug` exposes `window.__arena` (sim(sec, throttle, turn, fire), state(), start(), setMap(id), setCam(id)).

## Interfaces

### Map registry (MAPS agent, src/maps/*, re-exported from src/arena.js)

```js
import { MAPS, MAP_LIST, DEFAULT_MAP, createMap, buildMap } from './arena.js';   // or './maps/index.js'
MAP_LIST            // ['klasika', 'jama', 'kladivo', 'led', 'praha']  (picker order)
MAPS[id]            // { id, name, blurb, description, tags:[...], preview:{ floor, accent, dark }, create(ctx) }
const map = createMap(id, {
  scene,                        // required; map adds its own THREE.Group
  quality: 'high' | 'low',      // 'low' for touch/mid phones: fewer audience rows, no light beams/phone lights
  onEvent(type, detail) {},     // sound/fx hooks, see below
  lights: { key, hemi },        // optional; otherwise found in the scene (first Directional/Hemisphere light)
  applyEnv: true,               // map sets scene.background/fog/env intensity/light levels; restored on dispose()
  debris: true                  // loose dynamic bits (needs frame() calls to stay in sync)
});
// buildMap(id, scene, RAPIER, world, opts) = createMap + attachPhysics in one call
```

Instance (`map`):
| member | when | what |
|---|---|---|
| `attachPhysics(RAPIER, world)` | once, when Rapier is ready | fixed floor/walls/ramps, kinematic hazards, debris |
| `reset()` | start of every round | hazards back to idle, pit covers closed, debris back |
| `spawnPoints` (alias `spawns`) | | `[{x,z,yaw}, {x,z,yaw}]` – [0] player, [1] AI; `robot.reset(s.x, s.z, s.yaw)` |
| `bounds` / `half` | camera fit | `{x0,x1,z0,z1}` playfield (all maps are 12 × 12 units, `half` = 6) |
| `step(dt, robots, fighting)` (alias `update`) | every fixed physics step, **after `robot.step()`, before `world.step()`** | moves kinematic hazards, applies hazard hits; hazards idle while `fighting` is false (countdown/menu) |
| `afterStep(robots)` | every fixed step, **right after `world.step()`** | needed for the ice fallback (see PHYSICS request) – cheap, please call it |
| `frame(dt)` | every rendered frame | visual only: lamps, saw spin, debris → instanced mesh, crowd animation |
| `outCheck(x, y, z)` (alias `outcome(pos)`) | after each step | `null` / `'pit'` / `'out'` – replaces `outCheck`/`inPit` in main.js (pit covers count only once open) |
| `hazardAt(x, z)` | AI | true near pits, gaps, active/armed hazards |
| `gripAt(x, z)` | AI/physics | 1 = normal floor, 0.14 = ice |
| `status()` | HUD, every frame | Czech string or null, e.g. `'Jáma se otevře za 4 s'`, `'Pozor, kladivo!'` |
| `excite(0..1)` | on a robot-vs-robot hit | crowd jumps (hazard hits excite automatically) |
| `time` | | fight seconds the map has seen since `reset()` |
| `dispose()` | map switch | removes meshes, textures, all Rapier bodies; restores scene env/lights |

Events (`onEvent(type, d)`), all with world coords for sparks/sound panning:
- `'warn'` `{hazard, x, z}` – hazard is about to act (siren/beep). hazard ∈ `hammer|saw|flipper|pit`
- `'strike'` `{hazard, x, y, z, energy}` – it fired (thump / pneumatic / saw whine)
- `'hit'` `{hazard, robot, x, y, z, energy}` – a robot got struck (sparks, shake, `robot` is the Robot object)
- `'pit-open'` `{x, z}`

Legacy exports stay: `buildArenaVisual(scene)`, `buildArenaPhysics(RAPIER, world)`, `HALF, PIT, GAP, inPit` (= klasika, no debris, env untouched).

Integration sketch for main.js:
```js
let map = createMap(mapId, { scene, quality: touch ? 'low' : 'high', onEvent: mapEvent });
// rapier ready:  map.attachPhysics(RAPIER, world)
// startRound:    map.reset(); const [a, b] = map.spawnPoints; player.reset(a.x, a.z, a.yaw); ai.reset(b.x, b.z, b.yaw);
// physicsStep:   player.step(..); ai.step(..); map.step(DT, [player, ai], game.state === 'fight'); world.step(); map.afterStep([player, ai]);
//                const po = (p => map.outCheck(p.x, p.y, p.z))(player.body.translation());
// frame:         map.frame(dt); hud status line: map.status()
// AI:            hazardAt -> map.hazardAt
// map switch:    remove robot bodies, map.dispose(), map = createMap(newId, ...), map.attachPhysics(RAPIER, world)
```

## MAPS agent — owns src/arena.js, src/maps/*

### Design note
Five maps, all 1.2 × 1.2 m (12 × 12 units) so camera framing and AI stay the same:
- **CCRL klasika** – the original box, unchanged geometry (corner pit, north "out" gap), better polycarbonate (scuffed alpha, edge highlights, bolts), a few printed shards as debris.
- **Jáma a rampy** – centre pit, two floor flippers (sit on one for 0.3 s → 0.45 s blinking warning → launch + flip), plywood ramps against N/S walls that let a good hit throw a robot over the wall. Small daylight crowd.
- **Kladivo** – steel tread-plate floor, hammer on a corner column (strikes when someone loiters in its striped ring, at the latest every 11 s; wind-up + blinking lamp + floor glow; the hit bounces and tumbles robots), two saw strips that rise from floor slots (staggered, 0.9 s warning), corner pit. Dark industrial hall.
- **Led** – ice rink (grip 0.14) with a rubber rim and gaps in N/S walls, sliding ice blocks as debris.
- **PROTO ROBOT Praha** – night meetup final: black floor with orange grid + lettering, fake spotlights (additive pools + beams sweeping slowly, no extra real lights), LED strips, banner, crowd with phone lights, two always-on kill-saws in the N/S walls, centre pit that opens at 1:00 (6 s countdown on lamps + `status()`).
Hazards are real Rapier bodies (kinematic hammer/saws/flipper panels/pit cover, fixed kill-saws) plus a scripted impulse so hits read at 150 g scale. No sensor colliders: robots' suspension rays (`castRay` without `EXCLUDE_SENSORS`) would hit them; zone tests are done geometrically.
Perf: floors/walls/rails/posts are merged per material (~6 draw calls for the shell), bolts/debris/saw discs/crowd are instanced, the crowd animates in the vertex shader (no per-frame CPU), all textures are small canvases; no per-frame allocations in step()/frame().

### Requests
- **PHYSICS**: ice/grip. Robot drive force ignores collider friction. Please scale the drive/lateral force cap by the floor under each wheel ray: `grip = clamp(hit.collider.friction() / 0.8, 0.05, 1.2)` (maps use friction 0.8 = normal, ice 0.8 × 0.14). When you do, set `robot.usesSurfaceGrip = true` and the maps' fallback (which scales the per-step drive Δv in `map.step`, using velocities recorded in `map.afterStep`) switches itself off.
- **PHYSICS**: robots' downward rays currently hit debris (fine, it's bumpy) – if you ever add sensor colliders yourself, pass `QueryFilterFlags.EXCLUDE_SENSORS` in castRay.
- **GAME/UX**: wire the registry as sketched above; map picker can use `name`, `blurb`, `tags`, `preview.floor/accent/dark` for a swatch card. `onEvent` 'hit' → sparks at (x,y,z) + shake; 'warn' → beep; show `map.status()` in the HUD (e.g. under the timer).

## GAME/UX (integrator) — status & notes (appended)
- main.js now uses the map registry exactly as sketched (createMap with lights/onEvent/quality, attachPhysics once per world,
  reset per round, step/afterStep around world.step, frame per render, outCheck, hazardAt, status() under the timer, excite on robot hits).
  One Rapier world for the page; map switch = remove robot bodies + map.dispose() + createMap + attachPhysics.
- Robots: `new Robot(ROBOTS[id], hex, scene, { mods: ['slot:option', ...] })` with only non-default picks stored (localStorage).
  Garage reads `MODS[id]` (slot/slotName/default/grams/desc), `buildDef(id, mods).grams/.stats/.problems`; blocks options that exceed 150 g.
  HUD uses `robot.statusText()`, `robot.weaponLabel`, `robot.damage.health01` (damage bar) and `damage.taken` for the judges.
  **main.js drains `robot.events`** each rendered frame (labels: 'wheel', 'front', 'back', 'top', 'bottom') and sets `length = 0`.
  fx implements `hit(by, p, e)`, `flip(by)`, `wall(by, p, e)`, `grab(by, opp)`.
  Removing a robot: `robot.detachPhysics(true)` if present (else removeRigidBody + body = null).
  `def.model === null` → no GLB request (placeholder only).
- AI (src/ai.js): levels easy/normal/hard/dummy; uses `robot.suggestFire(opp)` when present (gated by level reaction/probability),
  `robot.handicap` from the level (0.74 / 0.88 / 1.0). Master flanks around the weapon face and herds toward `map.pits` centres.
- Replay (src/ui/replay.js) records body transforms + `robot.parts` node quaternions/visibility per physics step — please keep
  animated parts reachable from `robot.parts` (arrays fine).
