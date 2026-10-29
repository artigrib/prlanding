// Generic map runtime: turns a map spec (floor rects, walls, pits, hazards, decoration) into
// the object described in TEAM.md "## Interfaces" (map registry).
import * as THREE from 'three';
import {
  BASE_Y, WALL_H, CATCH_H, catchWalls, GRIP_FRICTION, buildFloor, buildWalls, buildStripes, buildAudience, makeDebris,
  staticBody, boxCollider, inRect, disposeGroup, mesh, quadGeo
} from './kit.js';

const _lv = { x: 0, y: 0, z: 0 }, _av = { x: 0, y: 0, z: 0 };

// find the scene's main lights when main.js did not hand them over
function findLights(scene) {
  let key = null, hemi = null;
  scene.traverse(o => {
    if (o.isDirectionalLight && !key) key = o;
    if (o.isHemisphereLight && !hemi) hemi = o;
  });
  return { key, hemi };
}

export function createRuntime(spec, ctx) {
  const { scene } = ctx;
  const quality = ctx.quality || 'high';
  const emitFn = ctx.onEvent || null;
  const group = new THREE.Group(); group.name = `map:${spec.id}`;
  scene.add(group);

  // ---- environment (background, fog, light levels), restored on dispose
  const env = Object.assign({ background: '#EEEEEB', fog: null, key: 1.6, keyColor: '#ffffff', hemi: 0.85, hemiSky: '#ffffff', hemiGround: '#d8d8d2', envIntensity: 0.55 }, spec.env || {});
  const lights = ctx.lights || findLights(scene);
  const saved = {
    background: scene.background, fog: scene.fog, envIntensity: scene.environmentIntensity,
    key: lights.key && { i: lights.key.intensity, c: lights.key.color.clone() },
    hemi: lights.hemi && { i: lights.hemi.intensity, s: lights.hemi.color.clone(), g: lights.hemi.groundColor.clone() }
  };
  if (ctx.applyEnv !== false) {
    scene.background = new THREE.Color(env.background);
    scene.fog = env.fog ? new THREE.Fog(env.fog[0], env.fog[1], env.fog[2]) : null;
    scene.environmentIntensity = env.envIntensity;
    if (lights.key) { lights.key.intensity = env.key; lights.key.color.set(env.keyColor); }
    if (lights.hemi) { lights.hemi.intensity = env.hemi; lights.hemi.color.set(env.hemiSky); lights.hemi.groundColor.set(env.hemiGround); }
  }

  // ---- floor, pits, walls
  const surfaces = spec.surfaces();
  buildFloor(group, spec.floor, surfaces, spec.floorSide);
  const pitMat = new THREE.MeshLambertMaterial({ color: spec.pitColor || '#161616' });
  for (const p of spec.pits || []) {
    group.add(mesh(quadGeo(p.x0, p.x1, p.z0, p.z1, BASE_Y + 0.01), pitMat));
  }
  const outside = mesh(new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2).translate(0, BASE_Y, 0), new THREE.MeshLambertMaterial({ color: spec.outsideColor || '#EEEEEB' }));
  group.add(outside);
  const walls = buildWalls(group, spec.walls, spec.wallStyle || {});
  if (spec.stripes) buildStripes(group, spec.stripes);

  // ---- hazards
  const hazards = spec.hazards ? spec.hazards(surfaces) : [];
  for (const h of hazards) h.build(group, ctx);

  // ---- decoration / environment
  const deco = spec.decorate ? spec.decorate(group, { quality, surfaces, walls }) || {} : {};
  const audience = spec.audience && quality !== 'off' ? buildAudience(group, { quality, ...spec.audience }) : null;
  const debris = spec.debris && ctx.debris !== false ? makeDebris(group, spec.debris.pieces, spec.debris.opts) : null;

  // ---- runtime state
  const bodies = [];
  let world = null, time = 0, attached = false;
  const vel = new Map();      // robot -> {x, z, wy, ok} velocity after the last world.step (ice fallback)
  let afterStepSeen = false;

  const api = {
    emit(type, d) {
      if (type === 'hit' && audience) audience.excite(0.6 + 0.4 * (d.energy || 0.5));
      if (type === 'strike' && audience) audience.excite(0.35);
      if (emitFn) try { emitFn(type, d); } catch (e) { console.error(e); }
    }
  };

  const map = {
    id: spec.id, name: spec.name, description: spec.description,
    group,
    bounds: spec.bounds || { x0: -6, x1: 6, z0: -6, z1: 6 },
    spawnPoints: spec.spawn,
    pits: spec.pits || [],
    env,
    hazards,
    debris,
    get time() { return time; },

    attachPhysics(RAPIER, w) {
      if (attached) return;
      attached = true; world = w;
      const body = staticBody(RAPIER, world); bodies.push(body);
      for (const r of spec.floor) {
        const s = surfaces[r.surf || 'floor'];
        boxCollider(RAPIER, world, body, r.x0, r.x1, BASE_Y, 0, r.z0, r.z1, GRIP_FRICTION * (s.grip ?? 1), 0.1);
      }
      for (const r of spec.walls) boxCollider(RAPIER, world, body, r.x0, r.x1, BASE_Y, WALL_H, r.z0, r.z1, 0.25, 0.15);
      for (const r of catchWalls(spec.walls, spec.openTop)) boxCollider(RAPIER, world, body, r.x0, r.x1, WALL_H, CATCH_H, r.z0, r.z1, 0.2, 0.1);
      boxCollider(RAPIER, world, body, -45, 45, BASE_Y - 1, BASE_Y, -45, 45, GRIP_FRICTION, 0.1);
      if (spec.colliders) spec.colliders(RAPIER, world, body);
      for (const h of hazards) h.attach(RAPIER, world, bodies);
      if (debris) { debris.attach(RAPIER, world); bodies.push(...debris.bodies); }
    },

    reset() {
      time = 0; vel.clear();
      for (const h of hazards) h.reset();
      if (debris) debris.reset();
    },

    // every fixed physics step, after robot.step() and before world.step()
    step(dt, robots, fighting) {
      if (fighting) time += dt;
      for (const h of hazards) h.step(dt, robots, time, !!fighting, api);
      // low-grip fallback: scale how much the drive changed the robot's horizontal velocity
      // this step (only when robots.js does not read the floor friction itself)
      if (!afterStepSeen) return;
      for (const r of robots) {
        if (!r.body || r.usesSurfaceGrip) continue;
        const v0 = vel.get(r);
        if (!v0 || !v0.ok) continue;
        const p = r.body.translation();
        if (p.y > 0.8 || p.y < -0.3) continue;
        const g = map.gripAt(p.x, p.z);
        if (g >= 0.99) continue;
        const v = r.body.linvel(), w = r.body.angvel();
        const k = Math.max(0.04, g);
        _lv.x = v0.x + (v.x - v0.x) * k; _lv.y = v.y; _lv.z = v0.z + (v.z - v0.z) * k;
        _av.x = w.x; _av.y = v0.wy + (w.y - v0.wy) * Math.min(1, k * 2.5); _av.z = w.z;
        r.body.setLinvel(_lv, true); r.body.setAngvel(_av, true);
      }
    },
    // every fixed physics step, right after world.step() (records velocities for the ice fallback)
    afterStep(robots) {
      afterStepSeen = true;
      for (const r of robots) {
        if (!r.body) continue;
        let v0 = vel.get(r);
        if (!v0) vel.set(r, v0 = { x: 0, z: 0, wy: 0, ok: false });
        const v = r.body.linvel(), w = r.body.angvel();
        v0.x = v.x; v0.z = v.z; v0.wy = w.y; v0.ok = true;
      }
    },

    // every rendered frame (visual only)
    frame(dt) {
      for (const h of hazards) h.frame(dt);
      if (debris) debris.frame();
      if (audience) audience.frame(dt);
      if (deco.frame) deco.frame(dt, time);
    },

    // rules ------------------------------------------------------------
    outCheck(x, y, z) {
      if (y > -0.5) return null;
      for (const p of map.pits) if (inRect(p, x, z, 0.5)) return 'pit';
      for (const h of hazards) if (h.isPit && h.isPit(x, z)) return 'pit';
      return 'out';
    },
    inPit(x, z) {
      for (const p of map.pits) if (inRect(p, x, z, 0.5)) return true;
      for (const h of hazards) if (h.isPit && h.isPit(x, z)) return true;
      return false;
    },
    hazardAt(x, z) {
      for (const p of map.pits) if (inRect(p, x, z, 0.4)) return true;
      for (const g of spec.gaps || []) if (inRect(g, x, z, 0.3)) return true;
      for (const h of hazards) if (h.hazardAt(x, z)) return true;
      return false;
    },
    gripAt(x, z) {
      for (const r of spec.floor) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return surfaces[r.surf || 'floor'].grip ?? 1;
      return 1;
    },
    status() {
      for (const h of hazards) { const s = h.status && h.status(); if (s) return s; }
      return null;
    },
    excite(a) { if (audience) audience.excite(a); },

    // aliases matching the names requested in TEAM.md by the GAME/UX agent
    get spawns() { return spec.spawn; },
    half: spec.half || 6,
    outcome(p) { return map.outCheck(p.x, p.y, p.z); },
    update(dt, robots, fighting = true) { map.step(dt, robots, fighting); },

    dispose() {
      if (world) for (const b of bodies) try { world.removeRigidBody(b); } catch (_) {}
      bodies.length = 0; world = null; attached = false;
      disposeGroup(group);
      if (ctx.applyEnv !== false) {
        scene.background = saved.background; scene.fog = saved.fog; scene.environmentIntensity = saved.envIntensity;
        if (lights.key && saved.key) { lights.key.intensity = saved.key.i; lights.key.color.copy(saved.key.c); }
        if (lights.hemi && saved.hemi) { lights.hemi.intensity = saved.hemi.i; lights.hemi.color.copy(saved.hemi.s); lights.hemi.groundColor.copy(saved.hemi.g); }
      }
    }
  };
  return map;
}
