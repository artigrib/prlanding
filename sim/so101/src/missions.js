// Missions: layout, success checks, star rating and an automatic solution (planner) for each.
// DOM/three-free. Texts are Czech, formal "vy".

import { ArmController } from './controller.js';

const STAR_PTS = (() => {
  // 5-point star outline (closed), centre (0.215, 0.0), outer radius 5.5 cm, sampled every ~7 mm
  const cx = 0.215, cy = 0.0, R = 0.055, r = 0.024, corners = [];
  for (let k = 0; k <= 10; k++) {
    const a = Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r : R;
    corners.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return corners;
})();
function samplePolyline(c, step) {
  const out = [];
  for (let i = 1; i < c.length; i++) {
    const [ax, ay] = c[i - 1], [bx, by] = c[i], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / step));
    for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  return out;
}
export const TRACE = { corners: STAR_PTS, checkpoints: samplePolyline(STAR_PTS, 0.007), penDown: 0.016, hit: 0.009, done: 0.85 };

const near2 = (a, b, r) => Math.hypot(a[0] - b[0], a[1] - b[1]) < r;

/**
 * Grasp coaching from the gripper state (P0-3): what to do next when the tip is above / at a cube at p.
 * Returns null when the tip is not near the cube.
 */
export function graspHint(c, p) {
  const t = c.tip, dh = Math.hypot(t[0] - p[0], t[1] - p[1]), dz = t[2] - p[2];
  const key = c.touch ? 'tlačítkem Chapadlo pod scénou' : 'mezerníkem';
  if (dh < 0.02 && dz > -0.015 && dz < 0.015) {
    return c.gripOpen ? `Teď sevřete chapadlo (${key})` : 'Držíte ji – zvedněte kouli nahoru';
  }
  if (dh < 0.03 && dz >= 0.015 && dz < 0.12) {
    return c.gripOpen ? 'Sjeďte dolů ke kostce a sevřete chapadlo' : `Otevřete chapadlo (${key}) a sjeďte níž`;
  }
  return null;
}
function stars3(t, t3, t2) { return t <= t3 ? 3 : t <= t2 ? 2 : 1; }

// helper: is the object resting in a bowl?
const SA = new Float64Array(3), SB = new Float64Array(3);   // scratch: checks run every frame
function inBowl(w, obj, bowl) {
  const p = w.pos(obj, SA), b = w.pos(bowl, SB);
  return Math.hypot(p[0] - b[0], p[1] - b[1]) < 0.05 && p[2] < 0.03;
}

export const MISSIONS = [
  {
    id: 'bowl', n: '01', title: 'Přeneste kostku do misky',
    desc: 'Natočte ruku ke kostce, otevřete chapadlo, sjeďte dolů, sevřete a přeneste kostku do modré misky.',
    short: 'Kostka do misky',
    layout: { cube: [0.25, -0.11], bowl: [0.20, 0.15] },
    openStart: true,
    tip: 'Klikněte na <b>kostku</b> – ruka ji sama vezme. Pak klikněte na <b>misku</b>.',
    targets: { cube: 'pick', bowl: 'place' },
    rate: (t) => stars3(t, 25, 60),
    starsHint: '3 ★ do 25 s, 2 ★ do 60 s',
    check(c, dt) {
      const w = c.w, cube = w.pos('cube', c.s.a || (c.s.a = new Float64Array(3)));
      if (inBowl(w, 'cube', 'bowl')) {
        c.s.hold = w.speed('cube') < 0.05 ? (c.s.hold || 0) + dt : 0;
        return { text: 'Kostka je v misce…', ok: true, won: c.s.hold > 0.5 };
      }
      c.s.hold = 0;
      if (cube[2] > 0.03) return { text: 'Výborně! Přeneste ji nad misku a pusťte' };
      const gh = graspHint(c, cube); if (gh) return { text: gh };
      return { text: c.smart ? 'Klikněte na kostku, nebo táhněte modrou kouli' : 'Natočte ruku ke kostce a sjeďte k ní' };
    },
    solve: (ctl, w) => pickPlace(ctl, w, 'cube', bowlDrop(w, 'bowl'))
  },
  {
    id: 'stack', n: '02', title: 'Postavte věž',
    desc: 'Položte oranžovou kostku přesně na modrou. Čím přesněji a rychleji, tím víc hvězdiček.',
    short: 'Věž ze dvou kostek',
    layout: { cube: [0.26, -0.10, 0.3], cube_b: [0.20, 0.10] },
    openStart: true,
    tip: 'Klikněte na <b>oranžovou kostku</b>, pak na <b>modrou</b> – ruka postaví věž.',
    advice: 'Pro 3 ★ pokládejte pomalu a natočte kostku kroužkem zápěstí tak, aby lícovala s modrou.',
    targets: { cube: 'pick', cube_b: 'place' },
    rate: (t, prec) => Math.min(stars3(t, 30, 75), prec < 0.004 ? 3 : prec < 0.008 ? 2 : 1),
    starsHint: '3 ★: do 30 s a odchylka pod 4 mm',
    check(c, dt) {
      const w = c.w, a = w.pos('cube', c.s.a || (c.s.a = new Float64Array(3))), b = w.pos('cube_b', c.s.b || (c.s.b = new Float64Array(3)));
      const off = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const onTop = off < 0.014 && a[2] > b[2] + 0.018 && a[2] < b[2] + 0.032;
      const free = Math.hypot(c.tip[0] - a[0], c.tip[1] - a[1], c.tip[2] - a[2]) > 0.03 || c.gripOpen;
      if (onTop && free) {
        c.s.hold = w.speed('cube') < 0.05 ? (c.s.hold || 0) + dt : 0;
        return { text: `Věž stojí, odchylka ${(off * 1000).toFixed(1)} mm…`, ok: true, won: c.s.hold > 0.6, prec: off };
      }
      c.s.hold = 0;
      if (onTop) return { text: 'Teď kostku pusťte', ok: true };
      if (a[2] > 0.03) return { text: 'Přeneste oranžovou kostku nad modrou a pomalu ji spusťte' };
      const gh = graspHint(c, a); if (gh) return { text: gh };
      return { text: c.smart ? 'Klikněte na oranžovou kostku, pak na modrou' : 'Uchopte oranžovou kostku' };
    },
    solve: (ctl, w) => { const b = w.pos('cube_b', [0, 0, 0]); return pickPlace(ctl, w, 'cube', [b[0], b[1], b[2] + 0.0265]); }
  },
  {
    id: 'sort', n: '03', title: 'Roztřiďte barvy',
    desc: 'Oranžovou kostku dejte do oranžové misky a modrou do modré.',
    short: 'Třídění podle barev',
    layout: { cube: [0.27, -0.06, 0.5], cube_b: [0.16, -0.16, -0.3], bowl: [0.14, 0.17], bowl2: [0.30, 0.12] },
    openStart: true,
    tip: 'Klikněte na kostku a pak na <b>misku stejné barvy</b>.',
    targets: { cube: 'pick', cube_b: 'pick', bowl: 'place', bowl2: 'place' },
    rate: (t) => stars3(t, 50, 110),
    starsHint: '3 ★ do 50 s, 2 ★ do 110 s',
    check(c, dt) {
      const w = c.w, o = inBowl(w, 'cube', 'bowl2'), b = inBowl(w, 'cube_b', 'bowl');
      const wrong = inBowl(w, 'cube', 'bowl') || inBowl(w, 'cube_b', 'bowl2');
      if (o && b) {
        c.s.hold = w.speed('cube') + w.speed('cube_b') < 0.08 ? (c.s.hold || 0) + dt : 0;
        return { text: 'Obě kostky jsou na svém místě…', ok: true, won: c.s.hold > 0.5 };
      }
      c.s.hold = 0;
      if (wrong) return { text: 'Pozor, kostka je ve špatné misce' };
      for (const [n, done] of [['cube', o], ['cube_b', b]]) {
        if (done) continue;
        const pp = w.pos(n, c.s.a || (c.s.a = new Float64Array(3)));
        if (pp[2] > 0.03) return { text: n === 'cube' ? 'Teď ji položte do oranžové misky' : 'Teď ji položte do modré misky', ok: o || b };
        const gh = graspHint(c, pp); if (gh) return { text: gh, ok: o || b };
      }
      if (o) return { text: c.smart ? 'Oranžová je hotová. Klikněte na modrou kostku, pak na modrou misku' : 'Oranžová je hotová, teď modrá do modré misky', ok: true };
      if (b) return { text: c.smart ? 'Modrá je hotová. Klikněte na oranžovou kostku, pak na oranžovou misku' : 'Modrá je hotová, teď oranžová do oranžové misky', ok: true };
      return { text: c.smart ? 'Klikněte na kostku a pak na misku stejné barvy' : 'Oranžová do oranžové, modrá do modré' };
    },
    solve: (ctl, w) => {
      const [a, b] = pickPlace(ctl, w, 'cube', bowlDrop(w, 'bowl2'), null, true);
      const [c, d] = pickPlace(ctl, w, 'cube_b', bowlDrop(w, 'bowl'), b.end, true);
      return ArmController.chain(a, b, c, d);
    }
  },
  {
    id: 'ball', n: '04', title: 'Dostrkejte míček do branky',
    desc: 'Míček se uchopit nedá. Zavřete chapadlo a dostrkejte ho jako hokejkou do branky.',
    short: 'Míček do branky',
    layout: { ball: [0.20, -0.06], goal: [0.20, 0.17, Math.PI / 2] },
    tip: 'Klikněte na <b>míček</b> – ruka ho dostrká do branky. Nebo ho strkejte koulí se zavřeným chapadlem.',
    targets: { ball: 'push', goal: 'push' },
    rate: (t, prec) => Math.min(stars3(t, 25, 60), prec < 0.02 ? 3 : 2),
    starsHint: '3 ★: do 25 s a míček blízko středu branky',
    check(c, dt) {
      const w = c.w, p = w.pos('ball', c.s.a || (c.s.a = new Float64Array(3))), g = w.pos('goal', c.s.b || (c.s.b = new Float64Array(3))), yaw = w.yaw('goal');
      const dx = p[0] - g[0], dy = p[1] - g[1];
      const lx = Math.cos(yaw) * dx + Math.sin(yaw) * dy, ly = -Math.sin(yaw) * dx + Math.cos(yaw) * dy;
      const inside = lx > -0.045 && lx < 0.042 && Math.abs(ly) < 0.05 && p[2] < 0.04;
      if (inside) {
        c.s.hold = w.speed('ball') < 0.03 ? (c.s.hold || 0) + dt : 0;
        return { text: 'Gól! Míček se zastavuje…', ok: true, won: c.s.hold > 0.5, prec: Math.hypot(dx, dy) };
      }
      c.s.hold = 0;
      return { text: c.smart ? 'Klikněte na míček – ruka ho dostrká, nebo ho strkejte koulí' : 'Sjeďte za míček a strkejte ho k brance' };
    },
    solve: (ctl, w) => pushPlan(ctl, w)
  },
  {
    id: 'trace', n: '05', title: 'Obkreslete hvězdu',
    desc: 'Ruka drží fix. Táhněte po papíře a fix kreslí – výška se drží sama, magnet vám pomáhá zůstat na čáře. Nebo hvězdu nakreslete prstem a ruka ji přesně zopakuje.',
    short: 'Kreslení hvězdy',
    layout: {},
    pen: true,
    tip: 'Táhněte po <b>papíře</b> – fix kreslí. <b>Pero nahoru</b> (P) mezi tahy. Nebo <b>Nakreslit prstem</b> – ruka čáru zopakuje.',
    // steep view over the paper from the far side, so the arm (coming from the base) does not hide the tip
    // (three.js coords: x, z_mj, -y_mj)
    look: { t: [0.215, 0.0, 0.0], p: [0.43, 0.38, -0.0001], pn: [0.47, 0.46, -0.0001] },
    draw: true,
    targets: {},
    // tuned so a beginner finishes in < 2 min; 3 ★ still needs a precise line
    rate: (t, prec) => Math.min(stars3(t, 60, 150), prec < 0.0025 ? 3 : prec < 0.005 ? 2 : 1),
    starsHint: '3 ★: do 60 s a průměrná odchylka čáry pod 2,5 mm',
    check(c) {
      const s = c.s;
      if (!s.hit) { s.hit = new Uint8Array(TRACE.checkpoints.length); s.n = 0; s.errSum = 0; s.errN = 0; }
      const t = c.tip;
      if (t[2] < TRACE.penDown) {
        const cp = TRACE.checkpoints;
        let best = 1;
        for (let i = 0; i < cp.length; i++) {
          const dd = Math.hypot(t[0] - cp[i][0], t[1] - cp[i][1]);
          if (dd < best) best = dd;
          if (dd < TRACE.hit && !s.hit[i]) { s.hit[i] = 1; s.n++; }
        }
        // precision: distance of the ink to the star outline (only near the star, so stray lines count once)
        const seg = distToPolyline(t, TRACE.corners);
        if (seg < 0.03) { s.errSum += seg; s.errN++; }
      }
      const cov = s.n / TRACE.checkpoints.length, prec = s.errN ? s.errSum / s.errN : 1;
      if (cov >= TRACE.done) return { text: 'Hvězda je hotová!', ok: true, won: true, prec, progress: cov };
      if (s.n) return { text: `Obkresleno ${Math.round(cov * 100)} %`, ok: cov > 0.5, prec, progress: cov };
      return { text: c.smart ? (c.touch ? 'Táhněte prstem po papíře – fix kreslí. Nebo zvolte Nakreslit prstem' : 'Táhněte myší po papíře – fix kreslí. P zvedne pero') : 'Sjeďte hrotem k papíru a táhněte po hvězdě', progress: 0 };
    },
    solve: (ctl) => ctl.planPath(TRACE.corners.map(([x, y]) => [x, y, 0.009]), { grip: false, speed: 0.05, roll: 0 })
  }
];

export function distToPolyline(p, c) {
  let best = Infinity;
  for (let i = 1; i < c.length; i++) {
    const ax = c[i - 1][0], ay = c[i - 1][1], bx = c[i][0] - ax, by = c[i][1] - ay;
    const L2 = bx * bx + by * by || 1;
    const u = Math.max(0, Math.min(1, ((p[0] - ax) * bx + (p[1] - ay) * by) / L2));
    const d = Math.hypot(p[0] - ax - u * bx, p[1] - ay - u * by);
    if (d < best) best = d;
  }
  return best;
}

// drop point above a bowl's centre (cube centre height when released)
export function bowlDrop(w, bowl) { const b = w.pos(bowl, [0, 0, 0]); return [b[0], b[1], 0.03]; }

/** Pick object `name` and place it so its centre ends at `dest`. Returns chained plan (or the two parts). */
export function pickPlace(ctl, w, name, dest, from, parts) {
  const p = w.pos(name, [0, 0, 0]);
  const pick = ctl.planPick([p[0], p[1], p[2]], w.o[name].half, w.yaw(name), from || null);
  const place = ctl.planPlace(dest, pick.end, pick.roll, () => w.pos(name, [0, 0, 0]));
  return parts ? [pick, place] : ArmController.chain(pick, place);
}

/** Push a ball towards the goal with the flat side of the closed jaws; re-aims up to 3 times. */
export function pushPlan(ctl, w, tries = 3, from) {
  const b = w.pos('ball', [0, 0, 0]), g = w.pos('goal', [0, 0, 0]);
  const dx = g[0] - b[0], dy = g[1] - b[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  const z = 0.011, back = 0.055;
  const start = [b[0] - ux * back, b[1] - uy * back, z];
  // push only part of the way first when far, so the robot can re-aim
  const reach = Math.min(L - 0.015, tries > 1 && L > 0.12 ? L * 0.55 : L - 0.015);
  const end = [b[0] + ux * reach, b[1] + uy * reach, z];
  const { roll } = ctl.graspRoll(start, Math.atan2(uy, ux), ctl.home, Math.PI);
  const plan = ctl.planPath([start, end], { grip: false, speed: 0.06, roll, from, pitch: Math.PI / 2 });
  plan.kind = 'push';
  if (tries > 1) plan.steps.push({ k: 'dyn', fn: (c) => {
    const p = w.pos('ball', [0, 0, 0]), gg = w.pos('goal', [0, 0, 0]);
    if (Math.hypot(p[0] - gg[0], p[1] - gg[1]) < 0.03 || p[2] < -0.05) return null;
    return pushPlan(c, w, tries - 1, c.startPoint()).steps;
  } });
  return plan;
}

// ---------------- library objects (object missions) ----------------
const FIXED_JAW = 0.0195;
const LIB_FLOOR = 0.007;   // controller site offset for a zero-width object (cube: 0.007 at 25 mm)

/** Grasp geometry of a library object in its current pose: closing direction across the narrowest horizontal
 *  body axis, grasp height, top. Returns { c: COM, dir, yaw (closing heading), width, z, top, bottom }. */
export function libGrasp(w, name) {
  const e = w.o[name], sz = e.size, c = Array.from(w.com(name, [0, 0, 0]));
  // closing direction: across the narrowest horizontal body axis (bounding box)
  let dir = null, bw = Infinity;
  for (let k = 0; k < 3; k++) {
    const a = w.axis(name, k), hn = Math.hypot(a[0], a[1]);
    if (hn > 0.7 && sz[k] < bw) { bw = sz[k]; dir = [a[0] / hn, a[1] / hn]; }
  }
  if (!dir) dir = [1, 0];
  // local profile of the collision mesh around the COM along the long axis: width, centre and height there
  const P = w.points(name), L = [-dir[1], dir[0]];
  let lo = Infinity, hi = -Infinity, zb = Infinity, zt = -Infinity, n = 0;
  for (const band of [0.008, 0.016, 1]) {
    lo = hi = NaN; lo = Infinity; hi = -Infinity; zb = Infinity; zt = -Infinity; n = 0;
    for (let i = 0; i < P.length; i += 3) {
      const dx = P[i] - c[0], dy = P[i + 1] - c[1];
      if (Math.abs(dx * L[0] + dy * L[1]) > band) continue;
      const u = dx * dir[0] + dy * dir[1];
      lo = Math.min(lo, u); hi = Math.max(hi, u); zb = Math.min(zb, P[i + 2]); zt = Math.max(zt, P[i + 2]); n++;
    }
    if (n >= 4) break;
  }
  const mid = (lo + hi) / 2, width = hi - lo;
  const g = [c[0] + mid * dir[0], c[1] + mid * dir[1]];
  const bottom = Math.max(0, zb), top = zt, h = top - bottom;
  // finger pads reach ~5 mm below the site: keep their lower edge below the object's equator (a round part
  // pinched above it squeezes out), but no higher than 3 cm
  const z = Math.max(LIB_FLOOR, Math.min(bottom + Math.min(0.5 * h - 0.008, 0.03), top - 0.004));
  return { c, g, dir, yaw: Math.atan2(dir[1], dir[0]), width, z, top, bottom };
}

/** Pick a library object; returns the pick plan with .ref (held reference point fn) and .dz (grasp height above bottom). */
export function libPick(ctl, w, name, from, o = {}) {
  const g = libGrasp(w, name);
  if (o.z != null) g.z = Math.max(LIB_FLOOR, Math.min(g.top - 0.006, g.bottom + o.z * (g.top - g.bottom)));
  const off = Math.max(-0.014, FIXED_JAW - g.width / 2 - 0.004);   // 4 mm clear of the fixed jaw
  const plan = ctl.planPick([g.g[0], g.g[1], g.z], 0, g.yaw, from || null, { z: g.z, top: g.top, period: Math.PI, offset: off, floor: LIB_FLOOR });
  const dzc = g.z - g.c[2];
  plan.ref = () => { const p = w.com(name, [0, 0, 0]); p[2] += dzc; return p; };
  plan.dz = g.z - g.bottom;
  plan.kind = 'pick';
  return plan;
}

/** Place the held library object with its bottom at height `surface` and centre at (x, y); closeYaw (optional)
 *  turns the wrist so the jaws close along that heading (aligns long objects). */
export function libPlace(ctl, w, pick, [x, y], surface, closeYaw) {
  const dest = [x, y, surface + pick.dz];
  let roll = pick.roll;
  if (closeYaw != null) roll = ctl.graspRoll(dest, closeYaw, ctl.home, Math.PI).roll;
  const plan = ctl.planPlace(dest, pick.end, roll, pick.ref);
  plan.steps[0].speed = LIB_CARRY;   // carry gently: long light parts swing out of a fast-moving pinch
  return plan;
}
export const LIB_CARRY = 0.12;

export function libPickPlace(ctl, w, name, xy, surface, closeYaw, from, o) {
  const a = libPick(ctl, w, name, from, o), b = libPlace(ctl, w, a, xy, surface, closeYaw);
  return [a, b];
}

/** Is the library object resting inside a fixture zone (fixture frame, COM based)? */
export function inZone(w, name, fx, slack = 0) {
  const c = w.com(name, SA), f = w.pos(fx, SB), z = w.o[fx].fixture.zone, yaw = w.yaw(fx);
  const dx = c[0] - f[0], dy = c[1] - f[1];
  const lx = Math.cos(yaw) * dx + Math.sin(yaw) * dy, ly = -Math.sin(yaw) * dx + Math.cos(yaw) * dy;
  const inXY = z.r != null ? Math.hypot(lx, ly) < z.r - 0.01 + slack : Math.abs(lx) < z.hx + slack && Math.abs(ly) < z.hy + slack;
  return inXY && c[2] - f[2] < z.top + 0.06 && c[2] > f[2] - 0.01;
}

/**
 * Runs the active mission: layout, timer, success detection, rating. No DOM.
 * ctx (filled by the caller each tick): { tip: [x,y,z] actual gripper tip, gripOpen, smart }
 */
export class MissionRunner {
  constructor(world) {
    this.w = world; this.i = 0; this.ctx = { w: world, tip: new Float64Array(3), s: {}, gripOpen: true, smart: true };
    this.result = null; this.time = 0; this.won = false; this.last = { text: '' };
  }
  get m() { return MISSIONS[this.i]; }
  select(id) { const k = MISSIONS.findIndex((x) => x.id === id); if (k >= 0) this.i = k; }
  /** Apply the layout (call after the sim was reset to its keyframe). */
  setup() {
    this.w.layout(this.m.layout);
    this.ctx.s = {}; this.time = 0; this.won = false; this.result = null; this.started = false; this.assisted = false;
  }
  /** Returns the check result; sets this.won / this.result once. */
  tick(dt) {
    const r = this.m.check(this.ctx, dt) || { text: '' };
    if (this.started && !this.won) this.time += dt;
    if (r.won && !this.won) {
      this.won = true;
      const prec = r.prec != null ? r.prec : 0;
      this.result = { id: this.m.id, time: this.time, prec, stars: this.m.rate(this.time, prec) };
    }
    this.last = r;
    return r;
  }
  /** The timer starts with the first arm movement. */
  start() { this.started = true; }
}
