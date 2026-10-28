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

## PHYSICS agent — owns src/robots.js, src/robots/*, src/physics/*

### Design note
Units: 1 u = 10 cm, 1 mass unit = 100 g (grams/100), s; gravity 30 u/s² (arcade). Energies are mu·u²/s² (= mJ).
- **Data-driven robots** (`src/robots/catalog.js`): `BASES[id]` = geometry (chassis box, mount points, wheels), parts list in
  grams, drive numbers, weapon spec, mod slots. `buildDef(id, mods)` resolves base + one option per slot into a frozen def,
  sums the mass budget (`def.grams`, `def.valid`, `def.problems` – Czech text when over 150 g) and garage bars `def.stats`.
  New robot = a BASES entry + a placeholder branch in `robots/visuals.js` (or a GLB via `def.model`).
- **Drivetrain** (`physics/drive.js`): per-side DC motor line F = F0·(a − v/v0) with a = stick·V_batt/V_ref (throttle 0 = ESC brake);
  battery OCV(soc) − I·R sag (spinner spin-up visibly slows the drive); suspension rays cast from each **axle** along world-down
  projected into the wheel plane (round wheels stay planted through wheelies / being wedged); each ray's spring force is that
  wheel's normal load N → weight transfer and wedge "unloading" change grip. Tyre = combined-slip model: friction opposes the patch
  slip vector (u − vLong, vLat), μ falls from μs to μk with slip (wheelspin), wheel surface speed u solved so motor force = tyre
  force (bisection, no allocations). Floor grip = collider friction/0.8 (ice map). Steering: stick → yaw-rate request; gyro mod =
  PI loop on measured yaw rate + feed-forward "breakaway" differential (computed from scrub μ·N·|z| vs motor moment) so 4WD skid
  steer turns on small inputs; without gyro (mod `gyro:manual`) it is open loop, faster and twitchier. Throttle yields to steering.
- **Spinners** (`physics/weapons.js` Spinner): flywheel state ω, I; motor τs·(a − ω/ωf) with spin-up time constant; E = ½Iω².
  Motor reaction torque on the chassis (horizontal spinners yaw on spin-up, verticals pitch), gyroscopic precession −Ω×L
  (vertical spinner leans / lifts a wheel when turning). Hit = blade sample points inside an opponent collider (or a static
  collider = wall): J = (1+e)·m_eff·v_rel·bite along the blade tangent (+uppercut), m_eff from I/r² and target mass, capped by the
  blade's momentum; opponent gets J near the contact, we get −J at the axle (recoil), ω drops by J·r/I, damage ∝ ΔE. Blade nearly
  stopped while still jammed → ESC stall ("Zbraň zaseknutá"), fire again to restart. Bent blade (front damage) lowers top speed.
- **Flipper / lifter / grabber** (Arm): a real dynamic plate/fork body on a revolute joint with hard limits, actuator torque
  applied equal-and-opposite between arm and chassis with a torque–speed curve. The plate is the wedge (ground game is collider
  geometry: the lowest, slipperiest leading edge gets under). Launch energy at first plate contact is analytic (J = √(2·E·m),
  `arm.kickEnergy`), because Rapier under-transfers momentum from a light fast plate. Self-righting = plate kick against the floor.
  Grabber (Klepeto): fire with the opponent on/above the forks → spherical joint pins it, forks lift (its wheels unload), 5 s max
  hold (rules), fire again to drop; empty press = lifter stroke.
- **Damage** (`physics/damage.js`): HP per side (front/back/left/right/top/bottom, armour mod scales + absorbs). Blade hits deal
  ΔE·0.3; any Δv > 5.2 u/s in one step (wall slam, landing) deals m·(Δv−5.2)²·0.55 to the side the push came from. Side at 0 →
  left/right: a wheel flies off as a debris body (that corner drops on the frame; no drive left → counts as immobile for the
  10 s KO); front: weapon bent; back: battery lead (more sag); top/bottom: electronics (less power). Side refills to 40 %.
- **Robots**: SVRN (4WD flipper), VERT (vertical spinner, invertible), **Kosa** (new: low horizontal undercutter, 1.0 u bar, yaws
  on spin-up, uppercut edge), **Klepeto** (new: 4WD lifter-grabber control bot, pushes hardest, wins by carrying to the pit).
- Mods per robot (slot → options): wheels (tpu/silikon/pena/pla), gearing (std/rychly/silny), weapon variant (flipper std/silny/
  rychly, blade tyc/disk/lehka, clamp std/silny), wedge (VERT: vidle/klin/bez), armour (std/tpu/titan/bez), gyro (gyro/manual).
  Several bases are near 150 g, so heavy options need a light one elsewhere (that is the budget game).
- Perf: ~150 µs per robot per step in headless Chromium (2 robots ≈ 0.3 ms per 1/120 s step); no per-step allocations in
  our code (Rapier's own getters still return small objects).

### Interfaces (robots.js exports)
- `ROBOTS` (default builds of every base), `Robot`, `GRAVITY`, `RIDE`, `MODS`, `SLOTS`, `BASES`, `buildDef(id, mods)`,
  `statsFor(defOrId, mods)` → `{ grams, speed, push, weapon, armor }`, `MASS_LIMIT_G`, `SIDES`.
- `MODS[id] = [{ id: 'slot:option', slot, slotName, name, desc, grams, default, stats }]`; mods are passed as an array of ids
  or `{ slot: option }`; unknown ids are ignored, one option per slot (last wins).
- `new Robot(def, hex, scene, { mods })`; `attachPhysics(RAPIER, world)`; `detachPhysics(withChassis = true)` removes chassis +
  arm + debris bodies + grab joint (setting `robot.body = null` after removing the chassis yourself also cleans the extras);
  `reset(x, z, yaw)`; `step(dt, {throttle, turn, fire}, opp, fx)`; `sync(dt)`; `frame()`, `local()`, `toWorld()`; `useModel()`.
- State: `hits`, `score`, `damageDealt`, `wallHits`, `flippedTime` (also counts while immobile), `inverted`, `contacts`, `vLong`,
  `spin` (0..1 of working blade speed), `weaponOn`, `cooldown`, `weaponLabel`, `statusText()`, `events[]` (sides + 'wheel'),
  `damage` (`hp`, `max`, `health01`, `side01(s)`, `taken`, `wheelsLost`, `lastSide`), `battery` (`soc`, `volts`, `current`),
  `drive` (`slipping`, `grip[]`, `wheelOmega[]`), `spinner` (`omega`, `energy`, `frac`, `stalled`, `on`), `arm` (`angle`,
  `holding`, `holdT`, `lifted`), `grabbedBy`, `usesSurfaceGrip = true`.
- fx callbacks used: `hit(by, p, e01)`, `flip(by)`, `wall(by, p, e01)` (blade on a wall; falls back to a weak `hit`), `grab(by, opp)`.
- **AI hooks**: `robot.suggestFire(opp)` (spinner: (re)start blade; flipper: opponent in zone & ready, or self-right;
  grabber: in jaws / drop a lifted arm), `robot.inWeaponZone(opp)`, `robot.weaponZone()` → `{zMin, zMax, xHalf}` (robot-local),
  `robot.aiState()` → one reused object `{ kind, weaponReady, weaponEnergy, stalled, holding, grabbed, battery, volts, health,
  hp{side:0..1}, wheelsLost, traction, slipping, inverted, flippedTime, canSelfRight, speed, zone }`.

## MAPS agent — status update
- Verified in the integrated game build (all 5 maps load, hazards fire, `status()` shows the pit countdown, pit cover drop → `'pit'`, kill-saws/saws/hammer/flippers emit `hit`). Hazard tuning: flipper launch ≈ 2.4 units high with a full flip, hammer = shove + delayed rebound/tumble when the head lifts, saws/kill-saws throw ~1 unit up.
- Draw objects per map (excl. robots): klasika 15, led 18, jama 32, praha 35–40, kladivo ~34; map `step()` < 0.1 ms, `frame()` < 0.07 ms. Crowd is one instanced mesh animated in the vertex shader.
- Ice works through the fallback (`afterStep` velocities) until PHYSICS sets `robot.usesSurfaceGrip`.
- Known: crowd silhouettes are only partly in frame with the top-down TV camera (they read better with low/chase cams); fonts for floor lettering fall back to Arial if Google Fonts haven't loaded when the map is built (textures are drawn once).

### PHYSICS — follow-ups (appended)
- MAPS request done: tyre μ (drive + lateral + skids) is scaled per contact by `hit.collider.friction() / 0.8` (clamped
  0.05..1.2) and every Robot sets `usesSurfaceGrip = true`, so the maps' ice fallback can switch off.
- Kosa is now invertible (wheels stand proud of the lid); VERT has a `wedge` slot (vidle / klin / bez).
- Steering at speed keeps ≥72 % of the throttle in a hard turn (fast arcs, not pirouettes); skid steer still bleeds speed in arcs.
- Debris wheels are reparented to the scene (not under `robot.parts`), so replays show them only via the robot's missing wheel.
