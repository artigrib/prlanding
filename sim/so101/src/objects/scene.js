// Object missions (chapters 06–10): which library objects and fixtures the mission scene contains.
// DOM/three-free (world.js, missions.js, the page and node tests use it).
//
// The plain mission scene (model/scene.xml) stays exactly as it was, so mission 01 loads nothing extra. When an
// object mission is opened, the page compiles the scene once more with every object of these missions injected
// (objectSceneXml); objects of the other missions wait parked on the hidden floor, like the cubes do.
// Visual GLBs are fetched per mission, only for the objects that mission shows.

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
  screwdriver: ['šroubovák', 'šroubovák'], vial: ['lahvička', 'lahvičku']
};
export const labelOf = (name) => LIB_LABELS[name.replace(/\d+$/, '')] || [name, name];

// Fixtures: static mocap bodies made of simple boxes / cylinders (collision group 3, drawn by objects/view.js
// with the colours below). Sizes are MJCF half sizes. Wall thickness 4 mm, like a 3D-printed part.
const C = { orange: '0.91 0.27 0.12 1', blue: '0.12 0.23 1 1', grey: '0.62 0.62 0.59 1', white: '0.95 0.95 0.93 1', dark: '0.17 0.17 0.17 1' };
function box(name, size, pos, rgba, euler) {
  return `<geom name="${name}" type="box" size="${size.join(' ')}" pos="${pos.join(' ')}"${euler ? ` euler="0 0 ${euler}"` : ''} rgba="${rgba}" group="3" friction="0.9 0.005 0.0001"/>`;
}
function bin(name, hx, hy, h, rgba) {   // open box, inside hx × hy (half), wall height h
  const t = 0.002;
  return [
    box(name + '_f', [hx + 2 * t, hy + 2 * t, 0.0015], [0, 0, 0.0015], rgba),
    box(name + '_w0', [t, hy + 2 * t, h / 2], [hx + t, 0, h / 2], rgba),
    box(name + '_w1', [t, hy + 2 * t, h / 2], [-hx - t, 0, h / 2], rgba),
    box(name + '_w2', [hx, t, h / 2], [0, hy + t, h / 2], rgba),
    box(name + '_w3', [hx, t, h / 2], [0, -hy - t, h / 2], rgba)
  ].join('\n');
}
export const FIXTURES = {
  bin_nut: { label: ['přihrádka na matice', 'přihrádku na matice'], zone: { hx: 0.045, hy: 0.045, top: 0.03 } },
  bin_bolt: { label: ['přihrádka na šrouby', 'přihrádku na šrouby'], zone: { hx: 0.045, hy: 0.045, top: 0.03 } },
  plate: { label: ['talíř', 'talíř'], zone: { r: 0.105, top: 0.012 } },
  tray: { label: ['podnos', 'podnos'], zone: { hx: 0.11, hy: 0.08, top: 0.014 } },
  holder: { label: ['držák na šroubovák', 'držák na šroubovák'], zone: { hx: 0.085, hy: 0.02, top: 0.02 } },
  rack: { label: ['stojánek na lahvičky', 'stojánek na lahvičky'], zone: { hx: 0.021, hy: 0.021, top: 0.03 }, slots: [-0.047, 0, 0.047] }
};
function fixturesXml() {
  // plate: Ø 21 cm disc with a 1.2 cm rim (simple printed-looking plate: the SimReady small plate is only 9.9 cm,
  // too small for an apple, a banana and a donut together)
  const rim = [];
  for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8;
    rim.push(box('plate_r' + k, [0.0035, 0.021, 0.006], [(0.103 * Math.cos(a)).toFixed(4), (0.103 * Math.sin(a)).toFixed(4), 0.006], C.white, a.toFixed(4)));
  }
  const rack = [box('rack_base', [0.074, 0.026, 0.002], [0, 0, 0.002], C.blue)];
  for (const [k, x] of FIXTURES.rack.slots.entries()) {
    const t = 0.0025, hi = 0.021, h = 0.015, z = 0.004 + h;
    rack.push(
      box(`rack_s${k}a`, [t, hi + 2 * t, h], [x + hi + t, 0, z], C.blue), box(`rack_s${k}b`, [t, hi + 2 * t, h], [x - hi - t, 0, z], C.blue),
      box(`rack_s${k}c`, [hi, t, h], [x, hi + t, z], C.blue), box(`rack_s${k}d`, [hi, t, h], [x, -hi - t, z], C.blue));
  }
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
export const FIXTURE_PARK = { bin_nut: [1.6, 0.6], bin_bolt: [1.6, 0.9], plate: [1.6, 1.2], tray: [1.6, -0.6], holder: [1.6, -0.9], rack: [1.6, -1.2] };

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
export const COLLISION = {
  food_produce_banana_a01: (body) => {
    const meshes = [], geoms = [];
    for (let i = 1; i < BANANA.length; i++) {
      const [ax, ay, ah, az0, az1] = BANANA[i - 1], [bx, by, bh, bz0, bz1] = BANANA[i];
      const L = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / L, ny = (bx - ax) / L;   // left normal
      const v = [];
      for (const [x, y, hw, z0, z1] of [[ax, ay, ah, az0, az1], [bx, by, bh, bz0, bz1]]) {
        for (const sgn of [-1, 1]) for (const z of [z0, z1]) v.push(x + sgn * hw * nx, y + sgn * hw * ny, z);
      }
      meshes.push(`<mesh name="${body}_s${i}" vertex="${v.map((q) => +q.toFixed(5)).join(' ')}"/>`);
      geoms.push(`<geom name="${body}_s${i}" type="mesh" mesh="${body}_s${i}" friction="0.65 0.01 0.001" condim="4" solref="0.01 1" group="3"/>`);
    }
    return { meshes: meshes.join('\n'), geoms: geoms.join('\n') };
  }
};
function applyCollision(entry, text) {
  const f = COLLISION[entry.id]; if (!f) return text;
  const { meshes, geoms } = f(entry.body);
  return text.replace(/<asset>[\s\S]*?<\/asset>/, `<asset>\n${meshes}\n</asset>`).replace(/<geom\b[^>]*\/>/g, '').replace(/(<inertial\b[^>]*\/>)/, `$1\n${geoms}`);
}

/** Lying bolt: rotate 90° about y so the shank lies on the table (the parts come off a conveyor this way). */
const LYING = [Math.SQRT1_2, 0, Math.SQRT1_2, 0];

/**
 * Build the object-mission scene: fixtures + every LIB_ITEMS instance (parked) injected into scene.xml.
 * lib: ObjectLibrary (fetch-based). Returns { xml, items: [{ name, id, entry, scale }] }.
 */
export async function objectSceneXml(sceneXml, lib, { injectObjects, instanceXml }) {
  await lib.manifest();
  const items = [], inst = [];
  for (const [i, it] of LIB_ITEMS.entries()) {
    const entry = await lib.entry(it.id);
    const text = scaleMjcf(applyCollision(entry, await lib.mjcf(it.id)), it.scale);
    const p = parkSpot(i);
    inst.push(instanceXml(entry, text, { name: it.name, pos: p, quat: it.lying ? LYING : [1, 0, 0, 0] }));
    items.push({ ...it, entry, scale: it.scale || 1 });
  }
  const j = sceneXml.lastIndexOf('</worldbody>');
  const withFx = sceneXml.slice(0, j) + fixturesXml() + '\n  ' + sceneXml.slice(j);
  return { xml: injectObjects(withFx, inst), items };
}

/** Body-frame size (m) of an item after scaling. */
export function itemSize(item) { const s = item.scale || 1; return item.entry.size_m.map((v) => v * s); }
export const LYING_QUAT = LYING;
