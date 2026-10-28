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
