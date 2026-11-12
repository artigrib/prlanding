// Dev / test view of the conveyor cell before its missions exist (?scene=conveyor&test=1 → window.__sim.conveyor).
// Loaded only by app.js in test mode in the conveyor scene. No UI: Playwright and the console drive it.
//
//   __sim.conveyor.layout()                       bins at their spots, everything else parked
//   __sim.conveyor.spawn('cup_paper1', { y, yaw })  wake a pool item onto the belt (false if the entry zone is busy)
//   __sim.conveyor.speed(0.02)                    belt target speed (m/s), 0 = pause (ramped)
//   __sim.conveyor.state()                        belt speed, slat centres, awake items and their zones
//   __sim.conveyor.bench(sec)                     physics only: steps per wall-clock second for `sec` of sim time

import { CONVEYOR_BINS } from './scene.js';

export function conveyorDev(page, ctx) {
  const ux = page.ux, w = ux.world, belt = w.belt, sim = page.sim, mj = ctx.mj, m = ctx.model, d = ctx.data;
  const show = (spec) => {
    const mission = { layout: spec };
    ux.extras.onLayout(mission);
    if (ux.objView) ux.objView.onLayout(mission);
  };
  let spec = {};
  return {
    layout() {
      ux.ctl.cancel();
      spec = Object.fromEntries(Object.entries(CONVEYOR_BINS).map(([n, p]) => [n, [p[0], p[1], 0]]));
      w.layout(spec); show(spec);
      return Object.keys(spec);
    },
    spawn(name, opts) {
      if (!w.spawn(name, opts)) return false;
      spec[name] = [0, 0, 0];
      const g = ux.extras.meshes[name]; if (g) g.visible = true;
      if (ux.objView) { ux.objView.loadGlb(name); ux.objView.sync(true); }
      return true;
    },
    speed(v) { if (v != null) belt.speed = +v; return belt.speed; },
    state() {
      return {
        speed: belt.speed, v: belt.v, wraps: belt.wraps, gap: belt.maxGap(),
        slats: belt.slats.map((s, i) => [+belt.centre(i).toFixed(4), belt.carrying(i)]),
        items: Object.fromEntries(w.active().filter((e) => e.lib).map((e) => { const p = Array.from(w.com(e.name, [0, 0, 0])); return [e.name, { p, zone: belt.zone(p) }]; })),
        time: d.time
      };
    },
    bench(sec = 5) {
      const ts = m.opt.timestep, n = Math.round(sec / ts), t0 = performance.now();
      for (let i = 0; i < n; i++) { belt.step(ts); mj.mj_step(m, d); }
      const ms = performance.now() - t0;
      sim.sync();
      return { steps: n, ms: Math.round(ms), stepsPerSec: Math.round(n / (ms / 1000)), realtime: +((n * ts) / (ms / 1000)).toFixed(2) };
    }
  };
}
