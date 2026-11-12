// Object missions (chapters 06–10): which library objects and fixtures the mission scene contains.
// DOM/three-free (world.js, missions.js, the page and node tests use it).
//
// The plain mission scene (model/scene.xml) stays exactly as it was, so mission 01 loads nothing extra. When an
// object mission is opened, the page compiles the scene once more with every object of these missions injected
// (objectSceneXml); objects of the other missions wait parked on the hidden floor, like the cubes do.
// Visual GLBs are fetched per mission, only for the objects that mission shows.
//
// Scene profiles (opts.scene in core.js loadSim): 'plain' = model/scene.xml as it is; 'objects' = missions 06–10
// (LIB_ITEMS + their fixtures); 'conveyor' = the waste-sorting cell (CONVEYOR_ITEMS, a slat belt, rails, an end tote
// and 4 bins). Each profile compiles only its own items and fixtures, so the belt never costs missions 06–10 anything.

// Library objects (manifest ids) as mission items. `scale`: uniform scale applied honestly to collision mesh,
// mass (∝ volume) and visual – used only where the real object is too small for a 3D-printed hobby gripper.
export const LIB_ITEMS = [
  // 06 Třídicí linka: real M8 parts are 6.5 mm (nut) / 13 mm (bolt head) – below what the SO-101's printed
  // jaws pick reliably from a flat table, so the parts are shown 2.5× larger ("zvětšeno 2,5×" in the mission text).
  { name: 'nut1', id: 'factory_nut_m8_loose', scale: 2.5 },
  { name: 'nut2', id: 'factory_nut_m8_loose', scale: 2.5 },
  { name: 'nut3', id: 'factory_nut_m8_loose', scale: 2.5 },
  { name: 'bolt1', id: 'factory_bolt_m8_loose', scale: 2.5, lying: true },
  { name: 'bolt2', id: 'factory_bolt_m8_loose', scale: 2.5, lying: true },
  { name: 'bolt3', id: 'factory_bolt_m8_loose', scale: 2.5, lying: true },
  // 07 Snídaně
  { name: 'apple', id: 'food_produce_apple_b01' },
  { name: 'banana', id: 'food_produce_banana_a01' },
  // the donut (Ø 10 cm) is wider than the open jaws (~7 cm) and its hole is too small for a jaw → cupcake instead
  { name: 'cupcake', id: 'food_prepared_cupcake_a01' },
  // 08 Uklizený stůl
  { name: 'mug', id: 'mug' },
  { name: 'spoon', id: 'dishware_plastic_spoon_a01' },
  { name: 'fork', id: 'dishware_plastic_fork_a01' },
  // 71 mm is right at the open jaws' limit (it slipped out in transport): shown at 80 % = 57 × 80 mm, a common small dish sponge
  { name: 'sponge', id: 'cleaning_sponge_b01', scale: 0.8 },
  // 09 Dílna
  { name: 'screwdriver', id: 'handtool_screwdriver_phillips_ph' },
  // 10 Laboratoř
  { name: 'vial', id: 'container_vial_glass_a01' }
];

export const LIB_LABELS = {
  nut: ['matice M8', 'matici M8'], bolt: ['šroub M8', 'šroub M8'],
  apple: ['jablko', 'jablko'], banana: ['banán', 'banán'], cupcake: ['muffin', 'muffin'],
  mug: ['hrnek', 'hrnek'], spoon: ['lžička', 'lžičku'], fork: ['vidlička', 'vidličku'], sponge: ['houbička', 'houbičku'],
  screwdriver: ['šroubovák', 'šroubovák'], vial: ['lahvička', 'lahvičku'],
  // conveyor profile (waste sorting)
  cup_paper: ['papírový kelímek', 'papírový kelímek'], cup_plastic: ['plastový kelímek', 'plastový kelímek'],
  fork_plastic: ['plastová vidlička', 'plastovou vidličku'], spoon_plastic: ['plastová lžička', 'plastovou lžičku'],
  vial_glass: ['skleněná lahvička', 'skleněnou lahvičku'], socket_s: ['nástrčná hlavice 3/8″', 'nástrčnou hlavici 3/8″'],
  socket_l: ['nástrčná hlavice 1/2″', 'nástrčnou hlavici 1/2″'], nut_m: ['matice M8', 'matici M8']
};
export const labelOf = (name) => LIB_LABELS[name.replace(/\d+$/, '')] || [name, name];

// Fixtures: static mocap bodies made of simple boxes / cylinders (collision group 3, drawn by objects/view.js
// with the colours below). Sizes are MJCF half sizes. Wall thickness 4 mm, like a 3D-printed part.
export const C = { orange: '0.91 0.27 0.12 1', blue: '0.12 0.23 1 1', grey: '0.62 0.62 0.59 1', white: '0.95 0.95 0.93 1', dark: '0.17 0.17 0.17 1',
  yellow: '0.96 0.76 0.1 1', green: '0.12 0.55 0.3 1' };
// Box / bin / rack helpers, shared with the mobile profile (src/mobile/scene.js: the same rack and crate as static geoms
// of the cart). `at`: offset added to every position (rounded to 0.01 mm); without it the output is unchanged.
const shift = (pos, at) => (at ? pos.map((v, i) => +(v + at[i]).toFixed(5)) : pos);
export function box(name, size, pos, rgba, euler) {
  return `<geom name="${name}" type="box" size="${size.join(' ')}" pos="${pos.join(' ')}"${euler ? ` euler="0 0 ${euler}"` : ''} rgba="${rgba}" group="3" friction="0.9 0.005 0.0001"/>`;
}
export function bin(name, hx, hy, h, rgba, at) {   // open box, inside hx × hy (half), wall height h
  const t = 0.002;
  return [
    // floor: drawn only (contype 0) – parts rest on the table; a 3 mm collision plate let thin parts sink into it
    box(name + '_f', [hx + 2 * t, hy + 2 * t, 0.0008], shift([0, 0, 0.0008], at), rgba).replace('group="3"', 'group="3" contype="0" conaffinity="0"'),
    box(name + '_w0', [t, hy + 2 * t, h / 2], shift([hx + t, 0, h / 2], at), rgba),
    box(name + '_w1', [t, hy + 2 * t, h / 2], shift([-hx - t, 0, h / 2], at), rgba),
    box(name + '_w2', [hx, t, h / 2], shift([0, hy + t, h / 2], at), rgba),
    box(name + '_w3', [hx, t, h / 2], shift([0, -hy - t, h / 2], at), rgba)
  ].join('\n');
}
/** The 3-slot vial rack (FIXTURES.rack): base plate + 4 walls per slot, slots along x. `alongY`: turned 90° (slots
 *  along y); `at`: offset of the rack centre. Returns geom strings named `${name}_base`, `${name}_s{k}{a..d}`. */
export function rackGeoms(name, rgba, { at, alongY = false } = {}) {
  const xy = (v) => (alongY ? [v[1], v[0], v[2]] : v);
  const g = [box(name + '_base', xy([0.074, 0.026, 0.002]), shift(xy([0, 0, 0.002]), at), rgba)];
  for (const [k, x] of FIXTURES.rack.slots.entries()) {
    const t = 0.0025, hi = 0.021, h = 0.015, z = 0.004 + h;
    g.push(
      box(`${name}_s${k}a`, xy([t, hi + 2 * t, h]), shift(xy([x + hi + t, 0, z]), at), rgba), box(`${name}_s${k}b`, xy([t, hi + 2 * t, h]), shift(xy([x - hi - t, 0, z]), at), rgba),
      box(`${name}_s${k}c`, xy([hi, t, h]), shift(xy([x, hi + t, z]), at), rgba), box(`${name}_s${k}d`, xy([hi, t, h]), shift(xy([x, -hi - t, z]), at), rgba));
  }
  return g;
}
export const FIXTURES = {
  bin_nut: { label: ['přihrádka na matice', 'přihrádku na matice'], zone: { hx: 0.045, hy: 0.045, top: 0.03 } },
  bin_bolt: { label: ['přihrádka na šrouby', 'přihrádku na šrouby'], zone: { hx: 0.045, hy: 0.045, top: 0.03 } },
  plate: { label: ['talíř', 'talíř'], zone: { r: 0.105, top: 0.012 } },
  tray: { label: ['podnos', 'podnos'], zone: { hx: 0.11, hy: 0.08, top: 0.014 } },
  holder: { label: ['držák na šroubovák', 'držák na šroubovák'], zone: { hx: 0.085, hy: 0.02, top: 0.02 } },
  rack: { label: ['stojánek na lahvičky', 'stojánek na lahvičky'], zone: { hx: 0.021, hy: 0.021, top: 0.03 }, slots: [-0.047, 0, 0.047] },
  // conveyor profile: 4 waste bins. Glass and metal: inside 9 × 9 cm. Paper: 10 × 17 cm, so two 6 cm paper cups
  // stand side by side (in a 9 × 9 cm bin the second cup had to stack on the first and rested above the counted
  // height: beltSolve batch runs, PR 2). Plastic: 12 × 17 cm: the 16 cm fork and spoon lie lengthwise in one lane and
  // the 6.4 cm plastic cup stands in the other (objects/beltpick.js binDrop); 10 cm left no lane beside the cup
  // (batch runs, mission PR: fork and spoon skipped as "full" in 5 of 10 seeds).
  bin_paper: { label: ['koš na papír', 'koš na papír'], zone: { hx: 0.05, hy: 0.085, top: 0.04 } },
  bin_plastic: { label: ['koš na plast', 'koš na plast'], zone: { hx: 0.06, hy: 0.085, top: 0.04 } },
  bin_glass: { label: ['koš na sklo', 'koš na sklo'], zone: { hx: 0.045, hy: 0.045, top: 0.04 } },
  bin_metal: { label: ['koš na kovy', 'koš na kovy'], zone: { hx: 0.045, hy: 0.045, top: 0.04 } }
};
function fixturesXml() {
  // plate: Ø 21 cm disc with a 1.2 cm rim (simple printed-looking plate: the SimReady small plate is only 9.9 cm,
  // too small for an apple, a banana and a donut together)
  const rim = [];
  for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8;
    rim.push(box('plate_r' + k, [0.0035, 0.021, 0.006], [(0.103 * Math.cos(a)).toFixed(4), (0.103 * Math.sin(a)).toFixed(4), 0.006], C.white, a.toFixed(4)));
  }
  const rack = rackGeoms('rack', C.blue);
  return `
    <body name="bin_nut" pos="1.6 0.6 -0.75" mocap="true">
${bin('bin_nut', 0.045, 0.045, 0.03, C.orange)}
    </body>
    <body name="bin_bolt" pos="1.6 0.9 -0.75" mocap="true">
${bin('bin_bolt', 0.045, 0.045, 0.03, C.blue)}
    </body>
    <body name="plate" pos="1.6 1.2 -0.75" mocap="true">
      <geom name="plate_disc" type="cylinder" size="0.105 0.003" pos="0 0 0.003" rgba="${C.white}" group="3" friction="0.9 0.005 0.0001"/>
${rim.join('\n')}
    </body>
    <body name="tray" pos="1.6 -0.6 -0.75" mocap="true">
${bin('tray', 0.11, 0.08, 0.014, C.grey)}
    </body>
    <body name="holder" pos="1.6 -0.9 -0.75" mocap="true">
${box('holder_base', [0.085, 0.024, 0.003], [0, 0, 0.003], C.orange)}
${box('holder_l', [0.085, 0.004, 0.009], [0, 0.02, 0.009], C.orange)}
${box('holder_r', [0.085, 0.004, 0.009], [0, -0.02, 0.009], C.orange)}
${box('holder_e', [0.004, 0.024, 0.009], [0.089, 0, 0.009], C.orange)}
    </body>
    <body name="rack" pos="1.6 -1.2 -0.75" mocap="true">
${rack.join('\n')}
    </body>`;
}

// where library items wait while their mission is not active (hidden floor, z = -0.75)
export function parkSpot(i) { return [2.0 + 0.15 * (i % 6), -0.9 + 0.15 * Math.floor(i / 6), -0.745]; }
export const FIXTURE_PARK = { bin_nut: [1.6, 0.6], bin_bolt: [1.6, 0.9], plate: [1.6, 1.2], tray: [1.6, -0.6], holder: [1.6, -0.9], rack: [1.6, -1.2],
  bin_paper: [1.6, 0.6], bin_plastic: [1.6, 0.9], bin_glass: [1.6, -0.6], bin_metal: [1.6, -0.9] };

/** Scale a converted object MJCF uniformly (mesh vertices via <mesh scale>, inertial pos, mass ∝ s³, inertia ∝ s⁵). */
export function scaleMjcf(text, s) {
  if (!s || s === 1) return text;
  const f = (v) => String(+(+v).toPrecision(6));
  return text
    .replace(/<mesh\b([^>]*?)(\/?)>/g, (m, a, end) => `<mesh${a.replace(/\sscale="[^"]*"/, '')} scale="${s} ${s} ${s}"${end}>`)
    .replace(/<inertial\b([^>]*)\/>/, (m, a) => '<inertial' + a
      .replace(/\bpos="([^"]*)"/, (q, v) => `pos="${v.trim().split(/\s+/).map((x) => f(x * s)).join(' ')}"`)
      .replace(/\bmass="([^"]*)"/, (q, v) => `mass="${f(v * s * s * s)}"`)
      .replace(/\bfullinertia="([^"]*)"/, (q, v) => `fullinertia="${v.trim().split(/\s+/).map((x) => f(x * s ** 5)).join(' ')}"`)
      .replace(/\bdiaginertia="([^"]*)"/, (q, v) => `diaginertia="${v.trim().split(/\s+/).map((x) => f(x * s ** 5)).join(' ')}"`) + '/>');
}

// Collision replacements. The converter gives every object one convex hull; for the curved banana that hull is a
// filled "D" 6 cm wide (jaws close on air). Here: a chain of convex segments along the banana's centre line
// (estimated from the outer hull arc, ~30 mm thick), same mass and inertia as authored.
// Each row: centre x, y, half width, bottom z, top z (body frame, m).
const BANANA = [
  [0.050, -0.0770, 0.004, 0.013, 0.025], [-0.010, -0.0740, 0.008, 0.008, 0.028], [-0.024, -0.0560, 0.012, 0.003, 0.031],
  [-0.034, -0.0360, 0.015, 0.0005, 0.0315], [-0.042, -0.0150, 0.015, 0.0005, 0.0315], [-0.043, 0.0000, 0.015, 0.0005, 0.0315],
  [-0.039, 0.0250, 0.015, 0.0005, 0.031], [-0.031, 0.0450, 0.013, 0.001, 0.029], [-0.019, 0.0610, 0.010, 0.004, 0.027],
  [-0.006, 0.0730, 0.007, 0.007, 0.022]
];
// Thin cutlery: its single hull has slanted sides that act as a wedge – the jaws squeeze a 16 g spoon out. The
// replacement is a chain of slices along the length, cut from the object's own hull vertices (true arch shape,
// vertical sides). Rows as above, computed from the MJCF.
function slicesFromHull(text, n = 9) {
  const v = /vertex="([^"]*)"/.exec(text)[1].trim().split(/\s+/).map(Number), P = [];
  for (let i = 0; i < v.length; i += 3) P.push(v.slice(i, i + 3));
  const x0 = Math.min(...P.map((p) => p[0])), x1 = Math.max(...P.map((p) => p[0])), rows = [];
  for (let k = 0; k <= n; k++) {
    const x = x0 + (x1 - x0) * k / n, near = P.filter((p) => Math.abs(p[0] - x) <= (x1 - x0) / n * 0.75);
    if (!near.length) continue;
    const ys = near.map((p) => p[1]), zs = near.map((p) => p[2]);
    const yc = (Math.min(...ys) + Math.max(...ys)) / 2, hw = Math.max(0.0025, (Math.max(...ys) - Math.min(...ys)) / 2);
    let z0 = Math.min(...zs), z1 = Math.max(...zs);
    if (z1 - z0 < 0.0025) { const zc = (z0 + z1) / 2; z0 = zc - 0.00125; z1 = zc + 0.00125; }
    rows.push([x, yc, hw, Math.max(0, z0), z1]);
  }
  return rows;
}
function chain(rows, body, fr) {
  const meshes = [], geoms = [];
  for (let i = 1; i < rows.length; i++) {
    const [ax, ay, ah, az0, az1] = rows[i - 1], [bx, by, bh, bz0, bz1] = rows[i];
    const L = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / L, ny = (bx - ax) / L;   // left normal
    const v = [];
    for (const [x, y, hw, z0, z1] of [[ax, ay, ah, az0, az1], [bx, by, bh, bz0, bz1]]) {
      for (const sgn of [-1, 1]) for (const z of [z0, z1]) v.push(x + sgn * hw * nx, y + sgn * hw * ny, z);
    }
    meshes.push(`<mesh name="${body}_s${i}" vertex="${v.map((q) => +q.toFixed(5)).join(' ')}"/>`);
    geoms.push(`<geom name="${body}_s${i}" type="mesh" mesh="${body}_s${i}" friction="${fr} 0.01 0.001" condim="4" solref="0.01 1" group="3"/>`);
  }
  return { meshes: meshes.join('\n'), geoms: geoms.join('\n') };
}
export const COLLISION = {
  dishware_plastic_spoon_a01: (body, text) => chain(slicesFromHull(text), body, 0.4),
  dishware_plastic_fork_a01: (body, text) => chain(slicesFromHull(text), body, 0.4),
  food_produce_banana_a01: (body) => chain(BANANA, body, 0.65)
};
function applyCollision(entry, text) {
  const f = COLLISION[entry.id]; if (!f) return text;
  const { meshes, geoms } = f(entry.body, text);
  return text.replace(/<asset>[\s\S]*?<\/asset>/, `<asset>\n${meshes}\n</asset>`).replace(/<geom\b[^>]*\/>/g, '').replace(/(<inertial\b[^>]*\/>)/, `$1\n${geoms}`);
}

/** Lying bolt: rotate 90° about y so the shank lies on the table (the parts come off a conveyor this way). */
const LYING = [Math.SQRT1_2, 0, Math.SQRT1_2, 0];

// ---------------------------------------------------------------- conveyor profile (waste sorting, M11–M13)
// Batch pool: 11 items: 2 paper cups and 3 items of each other fraction (design: campaign §1 had 3 paper cups; the
// paper bin holds two cups side by side, a third one had no room, so a batch has at most 2). The paper cup is shown at 75 %
// (6.0 cm instead of 8.0 cm across: at full size the printed jaws, ~7.5 cm open, cannot close on it); the nut at 2.5×
// as in mission 06. Scaling covers collision, mass and visual together (scaleMjcf), see NOTICE.txt §6.
export const CONVEYOR_ITEMS = [
  { name: 'cup_paper1', id: 'dishware_cup_paper_a01', scale: 0.75, fraction: 'paper' },
  { name: 'cup_paper2', id: 'dishware_cup_paper_a01', scale: 0.75, fraction: 'paper' },
  { name: 'cup_plastic1', id: 'dishware_plastic_cup_a01', fraction: 'plastic' },
  { name: 'fork_plastic1', id: 'dishware_plastic_fork_a01', fraction: 'plastic' },
  { name: 'spoon_plastic1', id: 'dishware_plastic_spoon_a01', fraction: 'plastic' },
  { name: 'vial_glass1', id: 'container_vial_glass_a01', fraction: 'glass' },
  { name: 'vial_glass2', id: 'container_vial_glass_a01', fraction: 'glass' },
  { name: 'vial_glass3', id: 'container_vial_glass_a01', fraction: 'glass' },
  { name: 'socket_s1', id: 'handtool_socket_3_8in_a01', fraction: 'metal' },
  { name: 'socket_l1', id: 'handtool_socket_1_2in_a01', fraction: 'metal' },
  { name: 'nut_m1', id: 'factory_nut_m8_loose', scale: 2.5, fraction: 'metal' }
];

// Belt along y at x = 0.24 m, carrying zone y0..y1, 10 cm wide. Slats on slide joints (velocity set every step by
// objects/belt.js, which also wraps them): n slats of `pitch`, n · pitch = (y1 − y0) + pitch, so the carrying zone
// is always covered. A slat whose centre has passed the head drum (y1) has "turned down around the drum": it loses
// its contacts and is not drawn, so what it carried drops into the end tote; it wraps to the tail half a pitch later,
// empty. Slat top at `top`, 1.5 mm above the table (slats never touch it). Side rails 15 mm high. The table of this
// profile ends half a pitch before the head (`edge`), where the end tote hangs below the belt.
export const BELT = {
  x: 0.24, y0: -0.30, y1: 0.30, hw: 0.05, n: 11, pitch: 0.06, gap: 0.0005, z: 0.003, hz: 0.0015, top: 0.0045,
  rail: { h: 0.015, t: 0.004, gap: 0.002 }, accel: 0.05, entry: 0.08, edge: 0.27,
  tote: { hx: 0.07, y0: 0.274, y1: 0.414, floor: -0.085 }   // floor above World.rescue's −0.1 m
};
// Bin spots (§3): near side (0.12, ±0.17), far side (0.38, ±0.14); every bin measured as a placement target with
// tools/belt-measure.mjs bins (PR 2). The paper and plastic bins lie along y (17 cm), clear of the belt rail.
export const CONVEYOR_BINS = { bin_paper: [0.12, -0.17], bin_plastic: [0.11, 0.17], bin_glass: [0.38, -0.14], bin_metal: [0.38, 0.14] };
export const FRACTION_BIN = { paper: 'bin_paper', plastic: 'bin_plastic', glass: 'bin_glass', metal: 'bin_metal' };

function conveyorXml() {
  const B = BELT, R = B.rail, f = (v) => +v.toFixed(5);
  const ya = B.y0 - B.pitch, yb = B.y1 + B.pitch / 2, ym = f((ya + yb) / 2), yh = f((yb - ya) / 2);
  const rx = B.hw + R.gap + R.t / 2, T = B.tote, tx = T.hx + 0.002, ty = f((T.y0 + T.y1) / 2), thy = f((T.y1 - T.y0) / 2 + 0.004);
  const dark = '0.16 0.17 0.18 1';
  const frame = [
    // drawn bed under the slats (no collision: the slats float 1.5 mm above the table)
    box('belt_bed', [B.hw + R.gap, yh, 0.0006], [B.x, ym, 0.0006], '0.3 0.31 0.32 1').replace('group="3"', 'group="3" contype="0" conaffinity="0"'),
    box('belt_rail_l', [R.t / 2, yh, R.h / 2], [f(B.x - rx), ym, R.h / 2], C.grey),
    box('belt_rail_r', [R.t / 2, yh, R.h / 2], [f(B.x + rx), ym, R.h / 2], C.grey),
    box('belt_tail', [rx + R.t / 2, R.t / 2, R.h / 2], [B.x, f(ya - R.t / 2 - 0.001), R.h / 2], C.grey),
    // drums (drawn only): where the slats turn around
    `<geom name="belt_drum_t" type="cylinder" size="0.012 ${B.hw}" pos="${B.x} ${f(ya)} -0.0105" quat="0.70711 0 0.70711 0" rgba="${C.grey}" group="3" contype="0" conaffinity="0"/>`,
    `<geom name="belt_drum_h" type="cylinder" size="0.012 ${B.hw}" pos="${B.x} ${B.y1} -0.0105" quat="0.70711 0 0.70711 0" rgba="${C.grey}" group="3" contype="0" conaffinity="0"/>`,
    // end tote, hanging on the table edge below the belt head: lost items land somewhere real
    box('tote_floor', [tx, thy, 0.002], [B.x, ty, T.floor], C.grey),
    box('tote_near', [tx, 0.002, f((0 - T.floor) / 2 - 0.0005)], [B.x, f(T.y0 - 0.002), f(T.floor / 2 - 0.0005)], C.grey),
    box('tote_far', [tx, 0.002, f((0.02 - T.floor) / 2)], [B.x, f(T.y1 + 0.002), f((0.02 + T.floor) / 2)], C.grey),
    box('tote_l', [0.002, thy, f(-T.floor / 2)], [f(B.x - T.hx - 0.002), ty, f(T.floor / 2)], C.grey),
    box('tote_r', [0.002, thy, f(-T.floor / 2)], [f(B.x + T.hx + 0.002), ty, f(T.floor / 2)], C.grey)
  ];
  const slats = [];
  for (let i = 0; i < B.n; i++) {
    slats.push(`    <body name="slat${i}" pos="${B.x} ${f(B.y0 - B.pitch / 2 + i * B.pitch)} ${B.z}">
      <joint name="slat${i}" type="slide" axis="0 1 0" damping="0" armature="10" limited="false"/>
      <geom name="slat${i}" type="box" size="${B.hw} ${f(B.pitch / 2 - B.gap / 2)} ${B.hz}" mass="0.1" friction="0.8 0.005 0.0001" rgba="${dark}" group="3"/>
    </body>`);
  }
  return `
    <body name="belt">
${frame.join('\n')}
    </body>
${slats.join('\n')}
    <body name="bin_paper" pos="${FIXTURE_PARK.bin_paper.join(' ')} -0.75" mocap="true">
${bin('bin_paper', 0.05, 0.085, 0.04, C.blue)}
    </body>
    <body name="bin_plastic" pos="${FIXTURE_PARK.bin_plastic.join(' ')} -0.75" mocap="true">
${bin('bin_plastic', 0.06, 0.085, 0.04, C.yellow)}
    </body>
    <body name="bin_glass" pos="${FIXTURE_PARK.bin_glass.join(' ')} -0.75" mocap="true">
${bin('bin_glass', 0.045, 0.045, 0.04, C.green)}
    </body>
    <body name="bin_metal" pos="${FIXTURE_PARK.bin_metal.join(' ')} -0.75" mocap="true">
${bin('bin_metal', 0.045, 0.045, 0.04, C.dark)}
    </body>`;
}

/** Scene profiles: which library items and fixtures a compiled scene contains (see the header). */
export const PROFILES = {
  objects: { items: LIB_ITEMS, fixtures: fixturesXml },
  conveyor: {
    items: CONVEYOR_ITEMS, fixtures: conveyorXml, slats: BELT.n,
    // the table ends under the belt head (BELT.edge), so items leaving the belt drop into the tote on its edge
    edit: (xml) => xml.replace(/(<geom name="table"[^>]*?)size="0\.40 0\.32 0\.015" pos="0\.14 0 -0\.015"/,
      `$1size="0.40 ${+((0.32 + BELT.edge) / 2).toFixed(4)} 0.015" pos="0.14 ${+((BELT.edge - 0.32) / 2).toFixed(4)} -0.015"`)
  }
};
// 'mobile' = the lab-transport cart in two rooms (src/mobile/scene.js MOBILE_PROFILE, loaded only for that scene)
export const SCENES = ['plain', 'objects', 'conveyor', 'mobile'];
/** The profile object of a scene name (the mobile one is imported on demand, so other scenes never load it). */
export async function profileOf(profile) {
  if (PROFILES[profile]) return PROFILES[profile];
  if (profile === 'mobile') return (await import('../mobile/scene.js')).MOBILE_PROFILE;
  throw new Error('unknown scene profile: ' + profile);
}

/**
 * Build an object scene: the profile's fixtures + every profile item (parked) injected into scene.xml.
 * lib: ObjectLibrary (fetch-based). profile: 'objects' (missions 06–10, default) | 'conveyor' | 'mobile'.
 * Returns { xml, items: [{ name, id, entry, scale }], arm }. arm (mobile only): { file, edit(so101Xml) } = the arm
 * MJCF the scene includes instead of so101.xml (the page writes edit(so101.xml) to that file before compiling).
 */
export async function objectSceneXml(sceneXml, lib, { injectObjects, instanceXml }, profile = 'objects') {
  const P = await profileOf(profile);
  if (P.items.length) await lib.manifest();
  const items = [], inst = [];
  for (const [i, it] of P.items.entries()) {
    const entry = await lib.entry(it.id);
    const text = scaleMjcf(applyCollision(entry, await lib.mjcf(it.id)), it.scale);
    const p = parkSpot(i);
    const one = instanceXml(entry, text, { name: it.name, pos: p, quat: it.lying ? LYING : [1, 0, 0, 0] });
    // compiled with gravity compensation so World.sleep() can switch it per body at run time (parked = floating)
    one.body = one.body.replace(/<body\b/, '<body gravcomp="1"');
    inst.push(one);
    items.push({ ...it, entry, scale: it.scale || 1 });
  }
  let xml = P.edit ? P.edit(sceneXml) : sceneXml;
  if (P.edit && xml === sceneXml) throw new Error('scene profile edit did not apply: ' + profile);
  // slide-joint slats (if any) come before the instances in qpos: the keyframes get their zeros first
  if (P.slats) xml = xml.replace(/<key\b[^>]*>/g, (tag) => tag.replace(/\bqpos="([^"]*)"/, (m, a) => `qpos="${a.trim()} ${Array(P.slats).fill(0).join(' ')}"`)
    .replace(/\bqvel="([^"]*)"/, (m, a) => `qvel="${a.trim()} ${Array(P.slats).fill(0).join(' ')}"`));
  const j = xml.lastIndexOf('</worldbody>');
  const withFx = xml.slice(0, j) + P.fixtures() + '\n  ' + xml.slice(j);
  return { xml: injectObjects(withFx, inst), items, arm: P.arm || null };
}

/** Body-frame size (m) of an item after scaling. */
export function itemSize(item) { const s = item.scale || 1; return item.entry.size_m.map((v) => v * s); }
export const LYING_QUAT = LYING;
