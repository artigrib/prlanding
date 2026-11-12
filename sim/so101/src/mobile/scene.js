// Lab-transport campaign (missions 14–16, design: campaign "Převoz mezi laboratořemi"): the 'mobile' scene profile.
// DOM/three-free (core.js loadSim, src/mobile/view.js and node tests use it).
//
// An XLeRobot-style cart in its single-arm configuration (simplified model): a LeKiwi 3-omniwheel base under a
// 45 × 35 × 77 cm utility cart, with the Menagerie SO-101 on the top tray, driving in the map "Dvě laboratoře" (two
// 2.4 × 2.0 m labs joined by a door, one bench in each, bench tops at 0.76 m).
//
// How it is built (string transforms, like the object profiles in src/objects/scene.js):
// - so101.xml → so101_mobile.xml: the arm's `base` body moves into a body `chassis` at the tray mount. The chassis
//   has slide base_x, slide base_y, hinge base_yaw (the slides come first, so qpos[x, y] are world coordinates and
//   qpos[yaw] is the heading), the same modelling choice as XLeRobot's own MuJoCo model (simulation/mujoco/
//   xlerobot.xml: slide_joint_x, slide_joint_y, hinge_joint_z with velocity actuators). The cart's collision shell,
//   its tray, the vial rack and the bottle crate are static geoms of the chassis, so they move with it for free.
// - scene.xml: the table is removed, the floor is at z = 0, the rooms are added, the legacy mission objects (cubes,
//   ball, bowls, goal; ArmSim.ids() needs them) wait off the map, and the keyframe gets the chassis pose.
// - Three velocity actuators drive the chassis: vx, vy (world frame) and wz. PR 2 maps the body-frame command onto
//   them through the LeRobot wheel kinematics (wheelSpeeds below) and its clamp.
//
// Sources (design doc §1.2/§1.4; commits read for this PR):
// - the retail product page of the 3-tier utility cart in XLeRobot's parts list (not named in the sim, design §1.3):
//   45 × 35 × 77 cm, 6 kg per tier, 18 kg max. The page does not give the
//   tier spacing, so the lower two shelves below are drawn schematically (equal spacing), not measured.
// - LeKiwi (github.com/SIGRobotics-UIUC/LeKiwi @ efa608d7, Apache-2.0): wheel STL `URDF/meshes/
//   4-Omni-Directional-Wheel_Single_Body-v1.stl` bounding box 101.57 × 101.57 × 38.83 mm, hub 94.1 mm across and
//   38.1 mm wide, 2 rows × 6 rollers (Ø 19.8 mm, 28.8 mm long, centres at r = 40.9 mm, rows at ±9.5 mm), all measured
//   from the STL's connected components; plates `base_plate_layer{1,2}` 215.87 × 212.94 × 7 mm (bounding box).
// - XLeRobot (github.com/Vector-Wangel/XLeRobot @ b017b5e6, Apache-2.0) `simulation/mujoco/xlerobot.xml`: chassis
//   z 0.035 (layer-1 plate), layer-2 plate 0.057 above it.
// - LeRobot (github.com/huggingface/lerobot @ e6ffde60, Apache-2.0) `src/lerobot/robots/lekiwi/lekiwi.py`
//   `_body_to_wheel_raw`: wheel_radius 0.05, base_radius 0.125, wheel angles [240, 0, 120] − 90°. Ported in
//   wheelSpeeds() (NOTICE.txt §7).
// Map numbers (rooms, walls, benches, where the crate sits) are our level design, not facts about a real place.

import { box, bin, rackGeoms, C } from '../objects/scene.js';

const f5 = (v) => +(+v).toFixed(5);
const at = (v) => v.map(f5).join(' ');

// ---------------------------------------------------------------- the cart (chassis frame: x forward, y left, z up)
export const CART = {
  hx: 0.225, hy: 0.175,             // 45 × 35 cm footprint (cart product page)
  height: 0.77,                     // 77 cm overall (cart product page)
  tray: 0.76,                       // top tray surface = bench top (design §2.0: arm base 2 cm above it, as on the table)
  shell: [0.01, 0.75],              // collision shell: 1 cm above the floor up to under the tray (design §2.1)
  mass: 11, comZ: 0.25,             // design §4.1 (XLeRobot quotes ~12 kg in total; arm and items add the rest)
  arm: [0.13, -0.10, 0.78],         // SO-101 base mount: front-right of the tray (design §4.1)
  rack: [0.10, 0.10],               // vial rack centre, front-left, slots along y (prototype cart.mjs)
  crate: [-0.10, 0],                // bottle crate (FIXTURES.tray geometry) on the rear half of the tray
  post: 0.02                        // corner posts: drawn only, schematic
};
// LeKiwi base under the cart (see the sources above). Wheel positions follow the LeRobot matrix: wheel k rolls along
// angle a_k and sits at angle a_k − 90° on the base circle (k = 0 left, 1 back, 2 right).
export const LEKIWI = {
  wheelRadius: 0.05, baseRadius: 0.125, angles: [240, 0, 120].map((a) => a - 90),   // lekiwi.py
  wheel: { r: 0.050785, width: 0.03883, hubR: 0.04706, hubW: 0.0381, rows: 2, perRow: 6, rollerR: 0.0099,
    rollerL: 0.0288, ring: 0.0409, rowZ: 0.0095 },                                   // LeKiwi wheel STL
  plate: [0.21587, 0.21294, 0.007], plateTop: [0.035, 0.092]                       // plate STLs; xlerobot.xml heights
};

/**
 * Port of LeRobot `LeKiwi._body_to_wheel_raw` (lekiwi.py, Apache-2.0, see NOTICE.txt §7), without the raw-tick
 * conversion and clamp (PR 2): body-frame velocity (u forward m/s, v left m/s, w rad/s) → wheel angular speeds
 * (rad/s), order [left, back, right]. Each row is [cos a, sin a, base_radius]; linear rim speed / wheel_radius.
 */
export function wheelSpeeds(u, v, w, out = [0, 0, 0]) {
  const L = LEKIWI;
  for (let k = 0; k < 3; k++) {
    const a = L.angles[k] * Math.PI / 180;
    out[k] = (Math.cos(a) * u + Math.sin(a) * v + L.baseRadius * w) / L.wheelRadius;
  }
  return out;
}

/** Wheel k: centre on the base circle (chassis frame) and the unit axle direction (radial, outwards). */
export function wheelPose(k) {
  const L = LEKIWI, ra = (L.angles[k] - 90) * Math.PI / 180;
  return { pos: [L.baseRadius * Math.cos(ra), L.baseRadius * Math.sin(ra), L.wheel.r], axle: [Math.cos(ra), Math.sin(ra), 0] };
}

// Box inertia of the cart footprint × shell height with the cart mass (a solid-box estimate, not a measured value).
function cartInertia() {
  const m = CART.mass, a = 2 * CART.hx, b = 2 * CART.hy, h = CART.shell[1] - CART.shell[0];
  return [m / 12 * (b * b + h * h), m / 12 * (a * a + h * h), m / 12 * (a * a + b * b)].map((v) => f5(v)).join(' ');
}

const drawn = (g) => g.replace('group="3"', 'group="1"');   // chassis geoms are drawn by core.js build() (rgba)
function chassisXml(pose) {
  const S = CART, z0 = S.shell[0], z1 = S.shell[1], T = S.tray;
  const geoms = [
    // collision shell (not drawn): stops the cart at walls and benches, never touches the floor
    `<geom name="cart_shell" type="box" size="${S.hx} ${S.hy} ${f5((z1 - z0) / 2)}" pos="0 0 ${f5((z1 + z0) / 2)}" group="3" rgba="0.2 0.2 0.7 0.15"/>`,
    drawn(box('cart_tray', [S.hx, S.hy, 0.005], [0, 0, f5(T - 0.005)], C.white)),
    ...rackGeoms('cart_rack', C.blue, { at: [S.rack[0], S.rack[1], T], alongY: true }).map(drawn),
    drawn(bin('cart_crate', 0.11, 0.08, 0.014, C.grey, [S.crate[0], S.crate[1], T]))
  ];
  return `
    <body name="chassis" pos="0 0 0">
      <joint name="base_x" type="slide" axis="1 0 0" damping="0" limited="false"/>
      <joint name="base_y" type="slide" axis="0 1 0" damping="0" limited="false"/>
      <joint name="base_yaw" type="hinge" axis="0 0 1" damping="0" limited="false"/>
      <inertial pos="0 0 ${S.comZ}" mass="${S.mass}" diaginertia="${cartInertia()}"/>
${geoms.join('\n')}`;
}

/** so101.xml → so101_mobile.xml: the arm on the cart (its base body inside `chassis`). */
export function mobileArmXml(so101Xml) {
  const BASE = '<body name="base" pos="0 0 0" quat="1 0 0 0"';
  if (!so101Xml.includes(BASE) || (so101Xml.match(/<worldbody>/g) || []).length !== 1) throw new Error('mobile: so101.xml layout changed');
  return so101Xml
    .replace(BASE, `<body name="base" pos="${at(CART.arm)}" quat="1 0 0 0"`)
    .replace('<worldbody>', '<worldbody>' + chassisXml())
    .replace('</worldbody>', '    </body>\n  </worldbody>');
}

// ---------------------------------------------------------------- map "Dvě laboratoře" (world frame, floor z = 0)
// Lab A x ∈ [−2.45, −0.05], lab B x ∈ [0.05, 2.45] (2.4 m each inside), y ∈ [−1, 1]; the shared 0.1 m wall at x = 0
// has a 0.8 m door (missions 14–15; mission 16 narrows it to 0.6 m) under a lintel at 2.0 m.
export const MAP = {
  room: [2.4, 2.0], wall: 0.1, h: 2.2, door: 0.8, lintel: 2.0,
  labs: [{ id: 'A', x: -1.25 }, { id: 'B', x: 1.25 }],
  bench: { top: 0.76, hx: 0.30, hy: 0.60, t: 0.03, leg: 0.02 },   // 0.6 × 1.2 m top at 0.76 m (design §2.0)
  benches: [{ id: 'bench_a', x: -2.15, y: 0 }, { id: 'bench_b', x: 2.15, y: 0 }],   // along the outer end walls
  start: [-1.25, 0, 0],                                         // cart pose in the keyframe: lab A, facing the door
  park: [20, 0]                                                 // legacy mission objects wait here, off the map
};
const WALL = '0.93 0.93 0.91 1', BENCH = '0.86 0.87 0.88 1', LEG = '0.35 0.36 0.38 1';
// static world geoms are group 3: src/mobile/view.js draws them as merged meshes (one per material)
const wallGeom = (name, hx, hy, hz, x, y, z, rgba = WALL) =>
  `<geom name="${name}" type="box" size="${at([hx, hy, hz])}" pos="${at([x, y, z])}" rgba="${rgba}" group="3" friction="0.8 0.005 0.0001"/>`;
export function roomsXml(door = MAP.door) {
  const M = MAP, t = M.wall, ix = M.room[0] + t / 2, iy = M.room[1] / 2, h = M.h, ox = ix + t / 2, oy = iy + t / 2;
  const seg = (iy - door / 2) / 2, segY = door / 2 + seg, B = M.bench;
  const g = [
    wallGeom('wall_n', ox + t / 2, t / 2, h / 2, 0, oy, h / 2),
    wallGeom('wall_s', ox + t / 2, t / 2, h / 2, 0, -oy, h / 2),
    wallGeom('wall_w', t / 2, iy, h / 2, -ox, 0, h / 2),
    wallGeom('wall_e', t / 2, iy, h / 2, ox, 0, h / 2),
    wallGeom('wall_mid_s', t / 2, seg, h / 2, 0, -segY, h / 2),
    wallGeom('wall_mid_n', t / 2, seg, h / 2, 0, segY, h / 2),
    wallGeom('door_lintel', t / 2, door / 2, (h - M.lintel) / 2, 0, 0, (h + M.lintel) / 2)
  ];
  for (const b of M.benches) {
    // only the top collides; the legs are drawn (contype 0) so nothing snags on them
    g.push(wallGeom(b.id, B.hx, B.hy, B.t / 2, b.x, b.y, B.top - B.t / 2, BENCH));
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      g.push(wallGeom(`${b.id}_leg${sx > 0 ? 'f' : 'r'}${sy > 0 ? 'l' : 'r'}`, B.leg, B.leg, (B.top - B.t) / 2,
        b.x + sx * (B.hx - 0.05), b.y + sy * (B.hy - 0.05), (B.top - B.t) / 2, LEG).replace('group="3"', 'group="3" contype="0" conaffinity="0"'));
    }
  }
  return '\n' + g.join('\n') + '\n';
}

// Legacy mission objects of scene.xml (ArmSim.ids() and build() need cube and bowl): off the map, free bodies
// floating with gravity compensation (no contacts, no cost), mocap bodies 10 cm above the floor.
const LEGACY = { cube: [0, 0], cube_b: [0, 0.2], ball: [0, 0.4], bowl: [0.4, 0], bowl2: [0.4, 0.4], goal: [0.8, 0] };
const LEGACY_FREE = ['cube', 'cube_b', 'ball'];
const legacyPos = (n) => [MAP.park[0] + LEGACY[n][0], MAP.park[1] + LEGACY[n][1], 0.1];

const ARM_HOME = '0 -1.0 0.6 1.2 0 0.3';   // scene.xml keyframe (unchanged)
/** scene.xml → the mobile scene (includes so101_mobile.xml). Every edit must apply (the source layout is checked). */
export function mobileSceneEdit(xml) {
  let out = xml;
  const sub = (re, to, what) => {
    const n = out.replace(re, to);
    if (n === out) throw new Error('mobile scene edit did not apply: ' + what);
    out = n;
  };
  sub('<include file="so101.xml"/>', '<include file="so101_mobile.xml"/>', 'include');
  sub(/\s*<!-- table top[^>]*-->\s*<geom name="table"[^>]*\/>/, '', 'table');
  sub(/<geom name="floor" type="plane" size="[^"]*" pos="0 0 -0\.75" group="3"\/>/,
    '<geom name="floor" type="plane" size="2.6 1.1 0.1" pos="0 0 0" group="3" friction="0.8 0.005 0.0001"/>', 'floor');
  for (const n of Object.keys(LEGACY)) {
    sub(new RegExp(`<body name="${n}" pos="[^"]*"`), `<body name="${n}" pos="${at(legacyPos(n))}"${LEGACY_FREE.includes(n) ? ' gravcomp="1"' : ''}`, n);
  }
  // keyframe: chassis pose first (its joints come first in qpos), then the arm, then the parked free objects
  const free = LEGACY_FREE.map((n) => at(legacyPos(n)) + ' 1 0 0 0').join('  ');
  sub(/<keyframe>[\s\S]*<\/keyframe>/, `<keyframe>
    <key name="home"
      qpos="${at(MAP.start)}  ${ARM_HOME}  ${free}"
      ctrl="${ARM_HOME}  0 0 0"/>
  </keyframe>
  <actuator>
    <!-- chassis velocity actuators (design §4.1): kv 2000, ±120 N (about what 3 wheel servos push: STS3215 stall
         torque 2.94 N·m / 0.05 m wheel radius ≈ 59 N per wheel, an estimate); yaw kv 60, ±12 N·m. ctrl 0 = brake. -->
    <velocity name="base_vx" joint="base_x" kv="2000" forcerange="-120 120"/>
    <velocity name="base_vy" joint="base_y" kv="2000" forcerange="-120 120"/>
    <velocity name="base_wz" joint="base_yaw" kv="60" forcerange="-12 12"/>
  </actuator>`, 'keyframe');
  return out;
}

/** Profile for src/objects/scene.js objectSceneXml (no library items yet: the missions' vials come with PR 5). */
export const MOBILE_PROFILE = {
  items: [], fixtures: () => roomsXml(), edit: mobileSceneEdit,
  arm: { file: 'so101_mobile.xml', edit: mobileArmXml }
};
