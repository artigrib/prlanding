// Where the demo page (objects.html) puts library objects on the SO-101 table. Positions are checked by
// test/objects.test.mjs: each object settles and the scripted top-down pick (pick.js) lifts it.
export const DEMO_LAYOUT = [
  { id: 'mug', pos: [0.17, -0.16], yaw: 0 },
  { id: 'elephant', pos: [0.24, 0.02], yaw: 0 },
  { id: 'dino', pos: [0.30, 0.06], yaw: Math.PI / 2 }
];

// Spare spots for objects added to the manifest later (filled in order; not pick-tested). They keep >= 11 cm
// from the demo objects, the cube, the bowl and each other, so only objects with a small footprint get one.
export const SPARE_SPOTS = [[0.40, -0.05], [0.42, 0.17], [0.40, -0.22], [0.06, 0.20], [0.02, -0.22], [0.30, 0.25],
  [-0.12, 0.18], [-0.12, -0.18]];
export const SPARE_MAX_RADIUS = 0.06;   // m, half the horizontal diagonal of the object's bounding box

export const yawQuat = (yaw) => [Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)];

// manifest -> [{ id, pos: [x, y, z], quat }] (z: a few mm above the table so objects settle onto it)
export function layoutFor(manifest, dropHeight = 0.004) {
  const ids = new Set(manifest.objects.map((o) => o.id));
  const out = DEMO_LAYOUT.filter((l) => ids.has(l.id)).map((l) => ({ id: l.id, pos: [...l.pos, dropHeight], quat: yawQuat(l.yaw) }));
  let k = 0;
  for (const o of manifest.objects) {
    if (out.some((l) => l.id === o.id) || k >= SPARE_SPOTS.length) continue;
    if (Math.hypot(o.size_m[0], o.size_m[1]) / 2 > SPARE_MAX_RADIUS) continue;   // too big for a spare spot
    out.push({ id: o.id, pos: [...SPARE_SPOTS[k++], dropHeight], quat: [1, 0, 0, 0] });
  }
  return out;
}
