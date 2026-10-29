// Robot catalogue: data-driven robot definitions (parts + mass budget) and modifications.
//
// UNITS (sim world): 1 u = 10 cm, 1 mass unit (mu) = 100 g, time in s, gravity 30 u/s².
//   force: mu·u/s², torque: mu·u²/s², inertia: mu·u², energy: mu·u²/s² (= 1 mJ in SI).
//   Masses in the tables are real grams (the 150 g antweight limit); physics uses grams / 100.
//
// A robot = BASE design (geometry + parts list) + one option per modification slot.
// buildDef(baseId, mods) resolves everything into a flat, frozen `def` the Robot class runs on.
// Adding a robot is config: a BASES entry (+ a procedural visual in visuals.js, and/or a GLB).
// GLBs: `glbNative: true` = authored in this frame and units (tools/robots-cad, no fitting); otherwise the
// model is scaled into `glbFit` ({ size: [x, z], center: [x, z] } footprint in u) and floored at -RIDE.

export const MASS_LIMIT_G = 150;
export const RIDE = 0.27;          // chassis origin height above the floor at rest (u)
export const GRAVITY = 30;         // u/s² (arcade-tuned: 1 u = 10 cm)
export const G_PER_MU = 100;

// ---------------------------------------------------------------- shared part specs
// Tyres: mu = peak friction coefficient on the arena floor, kin = sliding/peak ratio (wheelspin),
// s0 = slip speed [u/s] at which grip saturates (softer tyre = larger), latStiff = cap on how much
// sideways sliding one step may remove (0..1, numerical safety), g = grams per wheel.
export const TYRES = {
  tpu:     { mu: 1.15, kin: 0.78, latStiff: 0.55, s0: 0.35, g: 5 },
  silikon: { mu: 1.45, kin: 0.72, latStiff: 0.65, s0: 0.3, g: 6 },
  pena:    { mu: 0.95, kin: 0.85, latStiff: 0.45, s0: 0.5, g: 3 },
  pla:     { mu: 0.62, kin: 0.80, latStiff: 0.35, s0: 0.3, g: 5 }
};
// Drive gearing (N20-class gearmotors on 2S): vFree = wheel surface speed at no load [u/s] at V_REF,
// fStall = total ground force of ALL drive motors at stall [mu·u/s²] at V_REF, iStall = amps per motor at stall.
export const GEARING = {
  std:    { vFree: 7.0, fStall: 1.00, iStall: 1.4 },   // fStall is a multiplier on the base design value
  rychly: { vFree: 8.6, fStall: 0.78, iStall: 1.4 },
  silny:  { vFree: 5.6, fStall: 1.32, iStall: 1.5 }
};
export const V_REF = 7.8;                                  // volts the motor numbers are quoted at
// 2S LiPo 300 mAh: open-circuit volts from state of charge, internal resistance (Ω)
export const BATTERY = { vFull: 8.4, vEmpty: 6.9, mAh: 300, rInt: 0.11 };

// Armour: hp = hit points per side (front, back, left, right, top, bottom), absorb = fraction of
// incoming damage the armour soaks up, g = grams added to the base chassis.
const ARMOUR = {
  std:   { hp: 1.0, absorb: 0.15, g: 0 },
  tpu:   { hp: 1.45, absorb: 0.35, g: 9, sides: true },  // soft TPU skirts: sides only, eats spinner bites
  titan: { hp: 1.35, absorb: 0.25, g: 14, front: 2.0 },  // titanium front plate
  bez:   { hp: 0.6, absorb: 0.05, g: -8 }
};

// ---------------------------------------------------------------- base designs
// Geometry in robot-local coords (+Z forward, +Y up, +X = left side). Chassis origin rides RIDE above floor.
//   chassis: collider half extents [x, y, z] + offset, grams of frame (printed shell incl. screws)
//   mounts:  suspension/contact points [x, z, drives(1) | skid(0)] — ray-cast "wheels"
//   wheels:  visual wheel positions [x, z]; wheelR wheel radius (u)
//   drive.fStall: total stall push of the drive at V_REF with std gearing [mu·u/s²]
//   yawRate: the turn rate [rad/s] the stick asks for at full deflection
//   parts: everything that has mass (grams). Mods add/remove grams on top of this.
export const BASES = {
  svrn: {
    id: 'svrn', name: 'Project SVRN', short: 'SVRN', weapon: 'flipper', weaponKind: 'flipper',
    blurb: 'Pohon 4×4, klín a flipper', model: 'svrn', glbNative: true,
    chassis: { half: [0.54, 0.15, 0.45], offset: [0, 0, 0], friction: 0.35 },
    mounts: [[0.4, 0.3, 1], [-0.4, 0.3, 1], [0.4, -0.3, 1], [-0.4, -0.3, 1]],
    wheels: [[0.48, 0.28], [-0.48, 0.28], [0.48, -0.28], [-0.48, -0.28]], wheelR: 0.2,
    drive: { fStall: 66, motors: 4, vMul: 1.0 }, yawRate: 4.6, gyro: true,
    parts: { frame: 44, electronics: 10, battery: 12, driveMotors: 4 * 9, tyres: 4, flipperServo: 13, flipperPlate: 11 },
    // flipper: plate hinged at its top edge; hull points relative to the pivot (chassis-aligned at rest)
    arm: {
      pivot: [0, 0.12, 0.42],
      hull: (() => { const p = []; for (const s of [-1, 1]) p.push(s * 0.5, -0.01, 0, s * 0.5, -0.27, 0, s * 0.5, -0.375, 0.44, s * 0.5, -0.335, 0.44); return p; })(),
      friction: 0.04, range: 1.25, torque: 120, speed: 22, hold: 12, kick: 0.16, cooldown: 0.9, kickEnergy: 44
    },
    // swappable front modules (Project SVRN is a modular pusher base): flipper, wedge or grabber on the same hinge
    modules: {
      klin: {
        weaponKind: 'wedge',
        // lower, longer and rigid: same hinge, held at rest (tools/robots-cad/svrn.py KLIN_ROOT / KLIN_TIP)
        arm: { range: 0.02, torque: 30, hold: 30, kick: 0, kickEnergy: 0, cooldown: 99, friction: 0.25,
          hull: (() => { const p = []; for (const s of [-1, 1]) p.push(s * 0.52, -0.09, -0.02, s * 0.52, -0.24, -0.02, s * 0.52, -0.375, 0.54, s * 0.52, -0.355, 0.54); return p; })() }
      },
      chapadlo: { weaponKind: 'grabber', arm: { friction: 0.6, range: 0.75, torque: 40, speed: 5, hold: 14, kick: 0, cooldown: 0.5, grab: { zone: [0.45, 1.15, 0.5], hold: 5, lift: 0.45, cooldown: 1.6 } } }
    },
    glbYaw: 0,
    slots: ['modul', 'wheels', 'gearing', 'flipper', 'armour', 'gyro']
  },
  vert150: {
    id: 'vert150', name: 'Vertikální spinner 150 g', short: 'VERT', weapon: 'spinner', weaponKind: 'vertical',
    preparing: true, blurb: 'Dvoukolový vertikální spinner', model: 'vert150', invertible: true,
    chassis: { half: [0.56, 0.12, 0.4], offset: [0, -0.01, -0.05], friction: 0.35 },
    mounts: [[0.42, -0.15, 1], [-0.42, -0.15, 1], [0.16, 0.36, 0], [-0.16, 0.36, 0]],
    wheels: [[0.48, -0.15], [-0.48, -0.15]], wheelR: 0.25,
    drive: { fStall: 52, motors: 2, vMul: 0.96 }, yawRate: 5.2, gyro: true,
    parts: { frame: 36, electronics: 10, battery: 12, driveMotors: 2 * 9, tyres: 2, weaponMotor: 18, blade: 30, forks: 6, hub: 6 },
    // vertical spinner: axis = local -X (front edge of the blade moves UP), axle position, blade radius
    spinner: { axis: [-1, 0, 0], axle: [0, 0, 0.5], radius: 0.29, I: 0.0125, wFree: 215, spinUp: 0.75, teeth: 2, e: 0.25, uppercut: 0, arc: [-95, 70], iStall: 16 },
    glbYaw: 0, glbWheels: /^wheel_\d+(_tyre|_hub)?$/i, glbFit: { size: [1.09, 1.24], center: [0, 0.17] },
    slots: ['wheels', 'gearing', 'blade', 'wedge', 'armour', 'gyro']
  },
  kosa: {
    id: 'kosa', name: 'Kosa – horizontální spinner', short: 'KOSA', weapon: 'spinner', weaponKind: 'horizontal',
    blurb: 'Nízký podřezávač s dlouhou čepelí', model: 'kosa', glbNative: true, invertible: true,
    chassis: { half: [0.5, 0.12, 0.4], offset: [0, 0.0, -0.06], friction: 0.35 },
    mounts: [[0.38, -0.18, 1], [-0.38, -0.18, 1], [0.2, 0.26, 0], [-0.2, 0.26, 0]],
    wheels: [[0.43, -0.18], [-0.43, -0.18]], wheelR: 0.225,   // wheels stand proud of the lid: drives upside down
    drive: { fStall: 54, motors: 2, vMul: 1.04 }, yawRate: 4.4, gyro: true,
    parts: { frame: 34, electronics: 10, battery: 12, driveMotors: 2 * 9, tyres: 2, weaponMotor: 18, blade: 38, hub: 6 },
    // horizontal spinner: axis = +Y (counter-clockwise from above: the front tip sweeps to the robot's left)
    spinner: { axis: [0, 1, 0], axle: [0, -0.16, 0.42], radius: 0.5, I: 0.03, wFree: 125, spinUp: 0.9, teeth: 2, e: 0.2, uppercut: 0.28, arc: [-115, 115], iStall: 18 },
    glbYaw: 0,
    slots: ['wheels', 'gearing', 'blade', 'armour', 'gyro']
  },
  klepeto: {
    id: 'klepeto', name: 'Klepeto – zvedák s kleštěmi', short: 'KLEP', weapon: 'flipper', weaponKind: 'grabber',
    blurb: 'Chytí soupeře, zvedne ho a odveze', model: 'klepeto', glbNative: true,
    chassis: { half: [0.52, 0.16, 0.4], offset: [0, 0.01, -0.08], friction: 0.4 },
    mounts: [[0.38, 0.18, 1], [-0.38, 0.18, 1], [0.38, -0.3, 1], [-0.38, -0.3, 1]],
    wheels: [[0.44, 0.18], [-0.44, 0.18], [0.44, -0.3], [-0.44, -0.3]], wheelR: 0.19,
    drive: { fStall: 78, motors: 4, vMul: 0.9 }, yawRate: 4.0, gyro: true,
    parts: { frame: 36, electronics: 10, battery: 12, driveMotors: 4 * 9, tyres: 4, liftServo: 12, forks: 12, clamp: 8 },
    // lifting forks hinged at the top-front of the chassis, tips just above the floor
    arm: {
      pivot: [0, 0.1, 0.3],
      hull: (() => { const p = []; for (const s of [-1, 1]) p.push(s * 0.42, 0.0, 0, s * 0.42, -0.2, 0, s * 0.42, -0.355, 0.62, s * 0.42, -0.33, 0.62); return p; })(),
      friction: 0.6, range: 0.75, torque: 40, speed: 5, hold: 14, kick: 0, cooldown: 0.5,
      grab: { zone: [0.5, 1.25, 0.55], hold: 5, lift: 0.5, cooldown: 1.6 }
    },
    glbYaw: 0,
    slots: ['wheels', 'gearing', 'clamp', 'armour', 'gyro']
  }
};

// ---------------------------------------------------------------- modifications
// slot → options. `g` = grams added (negative saves weight), `fx` = what it changes in buildDef.
// stats (0..1 deltas) are only for the garage bars; physics comes from fx.
const SLOT_NAMES = { modul: 'Modul', wedge: 'Klín', wheels: 'Kola', gearing: 'Převody', flipper: 'Flipper', blade: 'Zbraň', clamp: 'Kleště', armour: 'Pancíř', gyro: 'Elektronika' };
export const SLOTS = SLOT_NAMES;
const OPTIONS = {
  modul: [
    { id: 'flipper', name: 'Flipper', desc: 'Kloubová ocelová deska na servu – převrací soupeře', g: 0, default: true },
    { id: 'klin', name: 'Klín', desc: 'Pevný široký ocelový klín bez serva, −9 g', g: -9 },
    { id: 'chapadlo', name: 'Chapadlo', desc: 'Vidlice a kleště: chytí, zvedne a odveze, +3 g', g: 3 }
  ],
  wheels: [
    { id: 'tpu', name: 'TPU pneu', desc: 'Tištěné TPU pneumatiky, dobrý kompromis', g: 0, default: true },
    { id: 'silikon', name: 'Silikonové', desc: 'Lepí se k podlaze, víc trakce na tlačení, +1 g/kolo', g: 1, perWheel: true },
    { id: 'pena', name: 'Pěnová', desc: 'Lehká a měkká, méně přilnavá, −2 g/kolo', g: -2, perWheel: true },
    { id: 'pla', name: 'Tvrdé PLA', desc: 'Kloužou – snadno se točí, špatně tlačí', g: 0 }
  ],
  gearing: [
    { id: 'std', name: 'Standard', desc: 'Vyvážená rychlost a síla', g: 0, default: true },
    { id: 'rychly', name: 'Rychlý převod', desc: 'O ~25 % rychlejší, slabší při tlačení', g: 0 },
    { id: 'silny', name: 'Silný převod', desc: 'Pomalejší, ale přetlačí skoro každého', g: 0 }
  ],
  flipper: [
    { id: 'std', name: 'Servo 25 kg', desc: 'Standardní flipper', g: 0, default: true },
    { id: 'silny', name: 'Silné servo', desc: 'Hodí výš, nabíjí déle, +5 g', g: 5 },
    { id: 'rychly', name: 'Rychlé servo', desc: 'Kratší nabíjení, slabší kop, −2 g', g: -2 }
  ],
  blade: [
    { id: 'tyc', name: 'Ocelová tyč', desc: 'Standardní čepel', g: 0, default: true },
    { id: 'disk', name: 'Těžký disk', desc: 'Víc energie (½Iω²), roztáčí se déle, +8 g', g: 8 },
    { id: 'lehka', name: 'Lehká čepel', desc: 'Rychle roztočená, slabší zásah, −8 g', g: -8 }
  ],
  clamp: [
    { id: 'std', name: 'Kleště', desc: 'Drží až 5 s', g: 0, default: true },
    { id: 'silny', name: 'Silné servo', desc: 'Zvedne výš, +5 g', g: 5 }
  ],
  wedge: [
    { id: 'vidle', name: 'Vidlice', desc: 'Dvě nízké vidlice před zbraní', g: 0, default: true },
    { id: 'klin', name: 'Široký klín', desc: 'Ocelový klín přes celou šířku – lépe podjede soupeře, +6 g', g: 6 },
    { id: 'bez', name: 'Bez klínu', desc: 'Lehčí, ale soupeř se snadno dostane pod vás, −6 g', g: -6 }
  ],
  armour: [
    { id: 'std', name: 'Tištěný plast', desc: 'Základní odolnost', g: 0, default: true },
    { id: 'tpu', name: 'TPU boky', desc: 'Měkké boky pohltí zásahy z boku, +9 g', g: 9 },
    { id: 'titan', name: 'Titanový štít', desc: 'Pevná příď, +14 g', g: 14 },
    { id: 'bez', name: 'Bez pancíře', desc: 'Lehký a křehký, −8 g', g: -8 }
  ],
  gyro: [
    { id: 'gyro', name: 'Gyro asistent', desc: 'Drží směr a dávkuje zatáčení', g: 0, default: true },
    { id: 'manual', name: 'Bez gyra', desc: 'Čisté ruční řízení – rychlejší otáčení, těžší jízda', g: -1 }
  ]
};

// approximate garage-bar deltas (0..1 scale) per option
const STAT_FX = {
  'wheels:silikon': { push: 0.12, speed: -0.02 }, 'wheels:pena': { push: -0.06, speed: 0.02 }, 'wheels:pla': { push: -0.25 },
  'gearing:rychly': { speed: 0.2, push: -0.15 }, 'gearing:silny': { speed: -0.18, push: 0.22 },
  'flipper:silny': { weapon: 0.15 }, 'flipper:rychly': { weapon: -0.08 },
  'blade:disk': { weapon: 0.18 }, 'blade:lehka': { weapon: -0.15 },
  'clamp:silny': { weapon: 0.12 },
  'wedge:klin': { push: 0.06, armor: 0.04 }, 'wedge:bez': { push: -0.08 },
  'armour:tpu': { armor: 0.2 }, 'armour:titan': { armor: 0.3 }, 'armour:bez': { armor: -0.3 }
};

// MODS registry (for the garage UI): MODS[robotId] = [{ id, name, desc, grams, slot, slotName, default, stats }]
// Mod ids are `${slot}:${option}` and unique per robot.
export const MODS = {};
for (const id of Object.keys(BASES)) {
  const b = BASES[id];
  MODS[id] = [];
  for (const slot of b.slots) for (const o of OPTIONS[slot]) {
    const nW = b.wheels.length;
    MODS[id].push({ id: `${slot}:${o.id}`, slot, slotName: SLOT_NAMES[slot], name: o.name, desc: o.desc, grams: o.perWheel ? o.g * nW : o.g, default: !!o.default, stats: STAT_FX[`${slot}:${o.id}`] || {} });
  }
}

// resolve mods list (ids, or {slot: option} object) into { slot: optionId }
function resolveMods(base, mods) {
  const pick = {};
  for (const slot of base.slots) pick[slot] = OPTIONS[slot].find(o => o.default).id;
  const list = Array.isArray(mods) ? mods : mods ? Object.keys(mods).map(k => `${k}:${mods[k]}`) : [];
  for (const m of list) {
    const [slot, opt] = String(m).split(':');
    if (base.slots.includes(slot) && OPTIONS[slot].some(o => o.id === opt)) pick[slot] = opt;
  }
  return pick;
}

const clamp01 = v => Math.max(0, Math.min(1, v));

// Build the runtime def. Returns a frozen object; `def.valid` is false if over the mass budget
// (`def.problems` explains). Physics still runs an overweight robot (the garage should block it).
export function buildDef(baseId, mods) {
  const base = BASES[baseId];
  if (!base) throw new Error('unknown robot ' + baseId);
  if (base.weapon === undefined) throw new Error('robot without weapon class');
  const pick = resolveMods(base, mods);
  const nW = base.wheels.length;
  // ---- mass budget
  const parts = { ...base.parts };
  const modList = [];
  for (const slot of base.slots) {
    const o = OPTIONS[slot].find(x => x.id === pick[slot]);
    const g = o.perWheel ? o.g * nW : o.g;
    if (g && slot !== 'wheels') parts['mod:' + slot] = g;     // tyres are priced from TYRES below
    modList.push(`${slot}:${o.id}`);
  }
  const tyre = TYRES[pick.wheels || 'tpu'];
  parts.tyres = tyre.g * nW;
  const armour = ARMOUR[pick.armour || 'std'];
  let grams = 0; for (const k in parts) grams += parts[k];
  const problems = [];
  if (grams > MASS_LIMIT_G + 1e-6) problems.push(`Přetíženo o ${Math.round(grams - MASS_LIMIT_G)} g (limit ${MASS_LIMIT_G} g)`);

  // ---- drive
  const gear = GEARING[pick.gearing || 'std'];
  const drive = {
    vFree: gear.vFree * (base.drive.vMul || 1), fStall: base.drive.fStall * gear.fStall, motors: base.drive.motors, iStall: gear.iStall,
    mu: tyre.mu, kin: tyre.kin, latStiff: tyre.latStiff, s0: tyre.s0, skidMu: 0.3, crr: 0.03
  };
  const gyro = (pick.gyro || 'gyro') === 'gyro';

  // ---- weapon
  let spinner = null, arm = null;
  if (base.spinner) {
    const s = { ...base.spinner };
    if (pick.blade === 'disk') { s.I *= 1.55; s.spinUp *= 1.45; }
    if (pick.blade === 'lehka') { s.I *= 0.62; s.spinUp *= 0.6; s.wFree *= 1.08; }
    s.tauStall = s.I * s.wFree / s.spinUp;                     // motor stall torque from the spin-up time constant
    s.energyMax = 0.5 * s.I * s.wFree * s.wFree;
    spinner = s;
  }
  if (base.arm) {
    const a = { ...base.arm, grab: base.arm.grab ? { ...base.arm.grab } : null };
    a.massG = (base.parts.flipperPlate || base.parts.forks || 10);
    const mod = base.modules && pick.modul && base.modules[pick.modul];
    if (mod) Object.assign(a, mod.arm, { grab: mod.arm.grab ? { ...mod.arm.grab } : a.grab });
    if (pick.flipper === 'silny') { a.torque *= 1.35; a.kickEnergy *= 1.4; a.cooldown *= 1.45; }
    if (pick.flipper === 'rychly') { a.torque *= 0.85; a.kickEnergy *= 0.8; a.cooldown *= 0.62; }
    if (pick.clamp === 'silny' && a.grab) { a.torque *= 1.3; a.grab.lift *= 1.3; }
    arm = a;
  }

  // ---- armour HP per side
  const hp = {};
  for (const side of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
    let m = armour.hp;
    if (armour.sides && side !== 'left' && side !== 'right') m = 1;
    if (armour.front && side === 'front') m = armour.front;
    hp[side] = Math.round(100 * m);
  }

  // ---- garage stats (0..1 bars), rough but monotonic in the physics numbers
  const mass = grams / G_PER_MU;
  const speed = clamp01((drive.vFree - 4) / 6);
  const push = clamp01((drive.fStall / mass) * Math.min(1, tyre.mu / 1.1) / 60 - 0.05);
  const weaponE = spinner ? spinner.energyMax : arm ? (arm.grab ? arm.torque * arm.range * 9 * arm.grab.lift * 2 : arm.kickEnergy * 6) : 0;
  const weapon = clamp01(weaponE / 420);
  const armor = clamp01((hp.front + hp.left + hp.right + hp.back) / 4 / 100 * 0.55 + armour.absorb);
  const stats = { grams: Math.round(grams), speed, push, weapon, armor };

  return deepFreeze({
    ...base,
    weaponKind: base.modules && pick.modul && base.modules[pick.modul] ? base.modules[pick.modul].weaponKind : base.weaponKind,
    mods: pick, modList, parts, grams, massG: grams, mass, valid: problems.length === 0, problems,
    wedge: base.slots.includes('wedge') ? pick.wedge : null,
    drive, gyro, spinner, arm, hp, armourAbsorb: armour.absorb, stats,
    // legacy fields older code reads
    vmax: drive.vFree, mu: drive.mu, yawMax: base.yawRate
  });
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o) && !(o instanceof RegExp)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

// stats for any combination without building a Robot
export function statsFor(defOrId, mods) {
  const id = typeof defOrId === 'string' ? defOrId : defOrId.id;
  return buildDef(id, mods || (typeof defOrId === 'object' ? defOrId.modList : undefined)).stats;
}
