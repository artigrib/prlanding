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
  },

  // ---------------- chapters 06–10: real objects (NVIDIA SimReady, CC BY 4.0) ----------------
  {
    id: 'line', n: '06', title: 'Třídicí linka',
    desc: 'Z linky přijely matice a šrouby M8. Matice patří do oranžové přihrádky, šrouby do modré. (Díly jsou zvětšené 2,5×, aby je tištěné čelisti spolehlivě chytly.)',
    short: 'Matice a šrouby do přihrádek',
    objects: true,
    layout: { nut1: [0.18, -0.16, 0.3], bolt1: [0.235, -0.105, 0.4], nut2: [0.285, -0.165, 1.1], bolt2: [0.325, -0.06, 1.9], nut3: [0.165, -0.065, 0.7], bolt3: [0.255, -0.01, 2.6],
      bin_nut: [0.165, 0.155], bin_bolt: [0.29, 0.13] },
    tip: 'Klikněte na <b>matici</b> nebo <b>šroub</b> – ruka díl vezme. Pak klikněte na <b>přihrádku</b>: matice do oranžové, šrouby do modré.',
    advice: 'Pro 3 ★ berte díly v pořadí od nejbližšího k přihrádkám – ruka pak jezdí kratší cesty.',
    targets: { nut1: 'pick', nut2: 'pick', nut3: 'pick', bolt1: 'pick', bolt2: 'pick', bolt3: 'pick', bin_nut: 'place', bin_bolt: 'place' },
    rate: (t) => stars3(t, 100, 200),
    starsHint: '3 ★ do 100 s, 2 ★ do 200 s',
    sort: { nut1: 'bin_nut', nut2: 'bin_nut', nut3: 'bin_nut', bolt1: 'bin_bolt', bolt2: 'bin_bolt', bolt3: 'bin_bolt' },
    check(c, dt) {
      return sortCheck(c, dt, this.sort, {
        wrong: (n) => (/^nut/.test(n) ? 'Pozor, matice patří do oranžové přihrádky' : 'Pozor, šroub patří do modré přihrádky'),
        done: 'Všechny díly jsou roztříděné…',
        idle: c.smart ? 'Klikněte na díl a pak na správnou přihrádku' : 'Uchopte díl a odneste ho do přihrádky'
      });
    },
    spot: (w, fx, held) => binSpot(w, fx, held, ['nut1', 'nut2', 'nut3', 'bolt1', 'bolt2', 'bolt3']),
    solve: (ctl, w) => libSolve(ctl, w, 'line')
  },
  {
    id: 'breakfast', n: '07', title: 'Snídaně',
    desc: 'Připravte snídani: jablko, banán a muffin dejte na talíř.',
    short: 'Snídaně na talíř',
    objects: true,
    layout: { apple: [0.265, -0.125, 0.4], banana: [0.17, -0.16, -0.5], cupcake: [0.325, -0.03, 0], plate: [0.2, 0.135] },
    tip: 'Klikněte na <b>jablko</b>, <b>banán</b> nebo <b>muffin</b>, pak na <b>talíř</b>.',
    advice: 'Banán je nejtěžší (0,24 kg) – nechte ho chytit ruku uprostřed, jinak se v chapadle převáží.',
    targets: { apple: 'pick', banana: 'pick', cupcake: 'pick', plate: 'place' },
    rate: (t) => stars3(t, 60, 130),
    starsHint: '3 ★ do 60 s, 2 ★ do 130 s',
    sort: { apple: 'plate', banana: 'plate', cupcake: 'plate' },
    check(c, dt) {
      return sortCheck(c, dt, this.sort, { done: 'Snídaně je na talíři…', idle: c.smart ? 'Klikněte na jídlo a pak na talíř' : 'Přeneste jablko, banán a muffin na talíř' });
    },
    spot: (w, fx, held) => ({ apple: [-0.045, 0.045], banana: [0.025, -0.035], cupcake: [0.05, 0.05] }[held] || [0, 0]),
    solve: (ctl, w) => libSolve(ctl, w, 'breakfast')
  },
  {
    id: 'tidy', n: '08', title: 'Uklizený stůl',
    desc: 'Po snídani: hrnek, lžičku, vidličku a houbičku uklidťe na podnos.',
    short: 'Úklid na podnos',
    objects: true,
    layout: { mug: [0.27, -0.125, 0.3], spoon: [0.17, -0.12, 0.35], fork: [0.215, -0.19, -0.2], sponge: [0.33, -0.025, 0.9], tray: [0.19, 0.165] },
    tip: 'Klikněte na předmět a pak na <b>podnos</b>. Lžičku a vidličku ruka sama natočí podél podnosu.',
    advice: 'Tenkou lžičku a vidličku ruka bere těsně nad stolem – pro 3 ★ je nechte uchopit uprostřed.',
    targets: { mug: 'pick', spoon: 'pick', fork: 'pick', sponge: 'pick', tray: 'place' },
    rate: (t) => stars3(t, 80, 160),
    starsHint: '3 ★ do 80 s, 2 ★ do 160 s',
    sort: { mug: 'tray', spoon: 'tray', fork: 'tray', sponge: 'tray' },
    check(c, dt) {
      return sortCheck(c, dt, this.sort, { done: 'Stůl je uklizený…', idle: c.smart ? 'Klikněte na předmět a pak na podnos' : 'Přeneste všechno na podnos' });
    },
    spot: (w, fx, held) => ({ mug: [-0.06, 0.035], sponge: [0.065, 0.035], spoon: [0.0, -0.05], fork: [0.0, -0.015] }[held] || [0, 0]),
    align: { spoon: Math.PI / 2, fork: Math.PI / 2 },
    solve: (ctl, w) => libSolve(ctl, w, 'tidy')
  },
  {
    id: 'workshop', n: '09', title: 'Dílna',
    desc: 'Šroubovák PH1 vraťte do tištěného držáku. Musí ležet rovně v drážce.',
    short: 'Šroubovák do držáku',
    objects: true,
    layout: { screwdriver: [0.27, -0.12, 0.6], holder: [0.2, 0.15, 0] },
    tip: 'Klikněte na <b>šroubovák</b> a pak na <b>držák</b> – ruka ho natočí podél drážky.',
    advice: 'Pro 3 ★ musí šroubovák ležet v drážce do 3 mm od osy.',
    targets: { screwdriver: 'pick', holder: 'place' },
    rate: (t, prec) => Math.min(stars3(t, 30, 70), prec < 0.003 ? 3 : prec < 0.008 ? 2 : 1),
    starsHint: '3 ★: do 30 s a odchylka od osy drážky pod 3 mm',
    check(c, dt) {
      const w = c.w, s = c.s;
      if (inZone(w, 'screwdriver', 'holder') && heldFree(c, 'screwdriver')) {
        const d = alignErr(w, 'screwdriver', 'holder');
        if (d.ang < 0.35) {
          s.hold = w.speed('screwdriver') < 0.03 ? (s.hold || 0) + dt : 0;
          return { text: `Šroubovák je v držáku, odchylka ${(d.off * 1000).toFixed(1)} mm…`, ok: true, won: s.hold > 0.6, prec: d.off };
        }
        s.hold = 0;
        return { text: 'Šroubovák leží našikmo – natočte ho podél drážky' };
      }
      s.hold = 0;
      return liftHint(c, 'screwdriver', c.smart ? 'Klikněte na šroubovák, pak na držák' : 'Uchopte šroubovák a položte ho do drážky');
    },
    spot: () => [-0.012, 0],
    align: { screwdriver: 'holder' },
    solve: (ctl, w) => libSolve(ctl, w, 'workshop')
  },
  {
    id: 'lab', n: '10', title: 'Laboratoř',
    desc: 'Skleněnou lahvičku zasuňte do stojánku. Pozor, ať se nepřevrhne – pro 3 ★ musí stát svisle.',
    short: 'Lahvička do stojánku',
    objects: true,
    layout: { vial: [0.27, -0.1, 0], rack: [0.21, 0.14, 0] },
    tip: 'Klikněte na <b>lahvičku</b> a pak na <b>stojánek</b>. Ruka ji vezme vysoko, aby čelisti nezavadily o stěny.',
    advice: 'Pro 3 ★ musí lahvička stát v otvoru svisle (náklon pod 4°) – pokládejte ji pomalu a rovně shora.',
    targets: { vial: 'pick', rack: 'place' },
    rate: (t, prec) => Math.min(stars3(t, 40, 90), prec < 0.07 ? 3 : 2),
    precText: (p) => `náklon ${(p * 180 / Math.PI).toFixed(1)}°`,
    starsHint: '3 ★: do 40 s a lahvička svisle (náklon pod 4°)',
    check(c, dt) {
      const w = c.w, s = c.s, slot = rackSlot(w, 'vial', 'rack');
      if (slot >= 0 && heldFree(c, 'vial')) {
        const tilt = Math.acos(Math.min(1, w.axis('vial', 2)[2]));
        s.hold = w.speed('vial') < 0.03 ? (s.hold || 0) + dt : 0;
        return { text: `Lahvička je ve stojánku, náklon ${(tilt * 180 / Math.PI).toFixed(1)}°…`, ok: true, won: s.hold > 0.6, prec: tilt };
      }
      s.hold = 0;
      if (w.axis('vial', 2)[2] < 0.5 && w.com('vial', SA)[2] < 0.03) return { text: 'Lahvička se převrhla. Zkuste to znovu (R).' };
      return liftHint(c, 'vial', c.smart ? 'Klikněte na lahvičku, pak na stojánek' : 'Uchopte lahvičku vysoko a zasuňte ji do otvoru');
    },
    spot: () => [0, 0],
    grip: { vial: 0.72 },
    solve: (ctl, w) => libSolve(ctl, w, 'lab')
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
  // cross-section of the collision hulls across the long axis: width, centre and height of the object there.
  // The section is chosen near the COM, preferring a thick one (a fork's handle is a thin arch, its neck is not).
  const L = [-dir[1], dir[0]];
  const hulls = w.points(name).map((P) => {
    const lu = [], lz = [];
    for (let i = 0; i < P.length; i += 3) {
      const dx = P[i] - c[0], dy = P[i + 1] - c[1], l = dx * L[0] + dy * L[1];
      lu.push([l, dx * dir[0] + dy * dir[1]]); lz.push([l, P[i + 2]]);
    }
    return { lu: hull2(lu), lz: hull2(lz) };
  });
  const slice = (s0) => {
    let lo = Infinity, hi = -Infinity, zb = Infinity, zt = -Infinity;
    for (const H of hulls) {
      const a = cut(H.lu, s0), b = cut(H.lz, s0);
      if (!a || !b) continue;
      lo = Math.min(lo, a[0]); hi = Math.max(hi, a[1]); zb = Math.min(zb, b[0]); zt = Math.max(zt, b[1]);
    }
    return { lo, hi, zb, zt, s0 };
  };
  let best = null;
  for (let s0 = -0.03; s0 <= 0.0301; s0 += 0.005) {
    const q = slice(s0);
    if (!(q.hi > q.lo) || q.hi - q.lo > 0.075) continue;   // open jaws: ~75 mm
    q.score = Math.min(q.zt - q.zb, 0.02) - 0.25 * Math.abs(s0);
    if (!best || q.score > best.score + 1e-4) best = q;
  }
  if (!best) best = slice(0);
  const { lo, hi, zb, zt } = best;
  const mid = (lo + hi) / 2, width = hi - lo;
  const g = [c[0] + mid * dir[0] + best.s0 * L[0], c[1] + mid * dir[1] + best.s0 * L[1]];
  const bottom = Math.max(0, zb), top = zt, h = top - bottom;
  // finger pads reach ~5 mm below the site: keep their lower edge below the object's equator (a round part
  // pinched above it squeezes out), but no higher than 3 cm
  const z = Math.max(LIB_FLOOR, Math.min(bottom + Math.min(0.5 * h - 0.008, 0.03), top - 0.004));
  return { c, g, dir, yaw: Math.atan2(dir[1], dir[0]), width, z, top, bottom };
}

// 2D convex hull (monotone chain) and its [min, max] along the line x = s0 (null when the line misses it)
function hull2(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function cut(H, s0) {
  let a = Infinity, b = -Infinity;
  for (let i = 0; i < H.length; i++) {
    const p = H[i], q = H[(i + 1) % H.length];
    if ((p[0] - s0) * (q[0] - s0) > 0) continue;
    const t = q[0] === p[0] ? 0 : (s0 - p[0]) / (q[0] - p[0]);
    for (const v of q[0] === p[0] ? [p[1], q[1]] : [p[1] + t * (q[1] - p[1])]) { a = Math.min(a, v); b = Math.max(b, v); }
  }
  return a <= b ? [a, b] : null;
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
  const plan = ctl.planPlace(dest, pick.end, roll, pick.ref, 0.1);   // long parts are held off their COM
  plan.steps[0].speed = LIB_CARRY;   // carry gently: long light parts swing out of a fast-moving pinch
  // release gently: the rotary jaw swinging wide open flicks light parts away
  const mark = (st) => { if (st.k === 'grip' && st.open) st.partial = 0.45; };
  plan.steps.forEach(mark);
  for (const st of plan.steps) if (st.k === 'dyn') { const fn = st.fn; st.fn = (c) => { const r = fn(c); if (r) r.forEach(mark); return r; }; }
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


/** Is the item lying still and not held (gripper open or away)? */
function heldFree(c, name) {
  const p = c.w.com(name, SB);
  return c.gripOpen || Math.hypot(c.tip[0] - p[0], c.tip[1] - p[1], c.tip[2] - p[2]) > 0.06;
}
function liftHint(c, name, idle) {
  const p = c.w.com(name, SA);
  if (p[2] > c.w.o[name].restZ + 0.02) return { text: 'Výborně! Teď ho přeneste a pusťte' };
  return { text: idle };
}
/** Generic "every item into its fixture" check; map item -> fixture. */
function sortCheck(c, dt, map, t) {
  const w = c.w, s = c.s, names = Object.keys(map);
  let n = 0, moving = 0, wrong = null, lifted = false;
  for (const k of names) {
    const ok = inZone(w, k, map[k]) && heldFree(c, k);
    if (ok) { n++; moving += w.speed(k); continue; }
    if (t.wrong) for (const f of new Set(Object.values(map))) if (f !== map[k] && inZone(w, k, f)) wrong = k;
    if (w.com(k, SA)[2] > (w.o[k].restZ || 0) + 0.02) lifted = true;
  }
  if (n === names.length) {
    s.hold = moving < 0.06 ? (s.hold || 0) + dt : 0;
    return { text: t.done, ok: true, won: s.hold > 0.6, progress: 1 };
  }
  s.hold = 0;
  if (wrong) return { text: t.wrong(wrong), progress: n / names.length };
  if (lifted) return { text: `Hotovo ${n} z ${names.length}. Přeneste ho a pusťte`, ok: n > 0, progress: n / names.length };
  return { text: n ? `Hotovo ${n} z ${names.length}. ${t.idle}` : t.idle, ok: n > 0, progress: n / names.length };
}
/** Heading error (mod π) and lateral offset of an item's long axis vs a fixture's x axis. */
function alignErr(w, name, fx) {
  const e = w.o[name], sz = e.size;
  // long horizontal body axis
  let best = null, len = -1;
  for (let k = 0; k < 3; k++) { const a = w.axis(name, k); if (Math.hypot(a[0], a[1]) > 0.7 && sz[k] > len) { len = sz[k]; best = a; } }
  const fy = w.yaw(fx), ay = best ? Math.atan2(best[1], best[0]) : 0;
  let d = ((ay - fy) % Math.PI + Math.PI) % Math.PI; if (d > Math.PI / 2) d = Math.PI - d;
  const c = w.com(name, SA), f = w.pos(fx, SB);
  const off = Math.abs(-Math.sin(fy) * (c[0] - f[0]) + Math.cos(fy) * (c[1] - f[1]));
  return { ang: d, off };
}
/** Index of the rack slot the item stands in, or -1. */
function rackSlot(w, name, rack) {
  const c = w.com(name, SA), f = w.pos(rack, SB), yaw = w.yaw(rack), fx = w.o[rack].fixture;
  const dx = c[0] - f[0], dy = c[1] - f[1];
  const lx = Math.cos(yaw) * dx + Math.sin(yaw) * dy, ly = -Math.sin(yaw) * dx + Math.cos(yaw) * dy;
  if (c[2] - f[2] > 0.07) return -1;
  return fx.slots.findIndex((sx) => Math.abs(lx - sx) < 0.016 && Math.abs(ly) < 0.016);
}
/** Free spot in a bin for the next part (3 × 2 grid in the bin frame). */
function binSpot(w, fx, held, names) {
  const spots = [[-0.022, -0.022], [0.022, -0.022], [-0.022, 0.022], [0.022, 0.022], [0, 0], [0, -0.022]];
  const f = w.pos(fx, [0, 0, 0]), yaw = w.yaw(fx);
  const taken = (sp) => names.some((n) => {
    if (n === held) return false;
    const c = w.com(n, SA), x = f[0] + Math.cos(yaw) * sp[0] - Math.sin(yaw) * sp[1], y = f[1] + Math.sin(yaw) * sp[0] + Math.cos(yaw) * sp[1];
    return Math.hypot(c[0] - x, c[1] - y) < 0.02;
  });
  return spots.find((sp) => !taken(sp)) || [0, 0];
}

/** Place target (world xy, surface z, wrist heading) for the held item `name` dropped on fixture fx. */
export function libTarget(w, mis, name, fx) {
  const f = w.pos(fx, [0, 0, 0]), yaw = w.yaw(fx);
  const sp = mis.spot ? mis.spot(w, fx, name) : [0, 0];
  const x = f[0] + Math.cos(yaw) * sp[0] - Math.sin(yaw) * sp[1], y = f[1] + Math.sin(yaw) * sp[0] + Math.cos(yaw) * sp[1];
  const surface = f[2] + (fx === 'rack' ? 0.004 : fx === 'plate' ? 0.006 : fx === 'holder' ? 0.006 : 0) + 0.002;
  const al = mis.align && mis.align[name];
  // jaws close across the long axis: aligning the item with heading h means closing along h + π/2
  // align: closing heading of the jaws (fixture name = across that fixture's axis, number = relative to its heading)
  const closeYaw = al == null ? null : typeof al === 'string' ? w.yaw(al) + Math.PI / 2 : yaw + al;
  return { xy: [x, y], surface, closeYaw };
}

/** Automatic solution of an object mission: every item in turn (the first planned now, the rest re-planned live). */
export function libSolve(ctl, w, id) {
  const mis = MISSIONS.find((m) => m.id === id);
  const map = mis.sort || Object.fromEntries(Object.entries(mis.targets).filter(([, k]) => k === 'pick').map(([n]) => [n, Object.keys(mis.targets).find((f) => mis.targets[f] === 'place')]));
  const names = Object.keys(map);
  const plan1 = (c, n, from) => {
    const t = libTarget(w, mis, n, map[n]);
    return libPickPlace(c, w, n, t.xy, t.surface, t.closeYaw, from, mis.grip && mis.grip[n] != null ? { z: mis.grip[n] } : undefined);
  };
  const [a, b] = plan1(ctl, names[0]);
  const plan = ArmController.chain(a, b);
  for (const n of names.slice(1)) plan.steps.push({ k: 'dyn', fn: (c) => { const [p, q] = plan1(c, n, c.startPoint()); return [...p.steps, ...q.steps]; } });
  plan.kind = 'pick+place';
  return plan;
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
