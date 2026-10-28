// Arena: 1.2 × 1.2 m antweight box (1 unit = 10 cm). Low polycarbonate walls,
// a pit in the SE corner and an open "out" gap in the north wall.
import * as THREE from 'three';

export const HALF = 6;            // 0.6 m
export const WALL_H = 1.2;        // 12 cm, low and see-through
export const WALL_T = 0.16;
export const BASE_Y = -2.5;       // pit bottom / floor outside the arena
export const PIT = { x0: 3.4, x1: 6, z0: 3.4, z1: 6 };
export const GAP = { x0: -4.5, x1: -1.5 };   // opening in the north wall (z = -HALF)

export const inPit = (x, z) => x > PIT.x0 && z > PIT.z0 && x < PIT.x1 + 0.5 && z < PIT.z1 + 0.5;

// floor blocks (top at y = 0), as [x0, x1, z0, z1]
const FLOOR = [
  [-HALF, HALF, -HALF, PIT.z0],
  [-HALF, PIT.x0, PIT.z0, HALF]
];
// walls as [x0, x1, z0, z1] footprints (outside the floor)
const WALLS = [
  [-HALF - WALL_T, HALF + WALL_T, HALF, HALF + WALL_T],          // south
  [HALF, HALF + WALL_T, -HALF - WALL_T, HALF],                     // east
  [-HALF - WALL_T, -HALF, -HALF - WALL_T, HALF],                   // west
  [-HALF - WALL_T, GAP.x0, -HALF - WALL_T, -HALF],                 // north, left of gap
  [GAP.x1, HALF + WALL_T, -HALF - WALL_T, -HALF]                   // north, right of gap
];

function gridTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#E9E9E5'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#D2D2CC'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = '#DEDED9'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function stripeTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#0E0E0E'; g.fillRect(0, 0, 64, 16);
  g.fillStyle = '#E8461E';
  for (let i = -16; i < 64; i += 16) { g.beginPath(); g.moveTo(i, 16); g.lineTo(i + 8, 16); g.lineTo(i + 16, 0); g.lineTo(i + 8, 0); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildArenaVisual(scene) {
  const group = new THREE.Group(); scene.add(group);
  const grid = gridTexture();
  const topMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: grid, roughness: 0.82, metalness: 0 });
  const sideMat = new THREE.MeshLambertMaterial({ color: '#2A2A2A' });
  const depth = -BASE_Y;
  for (const [x0, x1, z0, z1] of FLOOR) {
    const w = x1 - x0, d = z1 - z0;
    const g = new THREE.BoxGeometry(w, depth, d);
    // grid in world space: 1 tile = 10 cm
    const top = topMat.clone(); top.map = grid.clone(); top.map.repeat.set(w / 2, d / 2); top.map.offset.set(x0 / 2, -z1 / 2); top.map.needsUpdate = true;
    const m = new THREE.Mesh(g, [sideMat, sideMat, top, sideMat, sideMat, sideMat]);
    m.position.set((x0 + x1) / 2, -depth / 2, (z0 + z1) / 2);
    m.receiveShadow = true; group.add(m);
  }
  // walls: dark below floor level (pit lining), clear polycarbonate above, ink top rail
  const glass = new THREE.MeshStandardMaterial({ color: '#dfe6ea', transparent: true, opacity: 0.28, roughness: 0.15, metalness: 0, depthWrite: false });
  const rail = new THREE.MeshStandardMaterial({ color: '#0E0E0E', roughness: 0.6 });
  for (const [x0, x1, z0, z1] of WALLS) {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const up = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), glass);
    up.position.set(cx, WALL_H / 2, cz); up.renderOrder = 2; group.add(up);
    const low = new THREE.Mesh(new THREE.BoxGeometry(w, depth, d), sideMat);
    low.position.set(cx, -depth / 2, cz); low.receiveShadow = true; group.add(low);
    const r = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.06, d + 0.02), rail);
    r.position.set(cx, WALL_H, cz); r.castShadow = true; group.add(r);
  }
  // corner posts
  const postG = new THREE.BoxGeometry(0.22, WALL_H + 0.08, 0.22);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = new THREE.Mesh(postG, rail);
    p.position.set(x * (HALF + WALL_T / 2), (WALL_H + 0.08) / 2, z * (HALF + WALL_T / 2)); p.castShadow = true; group.add(p);
  }
  for (const gx of [GAP.x0, GAP.x1]) {
    const p = new THREE.Mesh(postG, rail);
    p.position.set(gx + (gx === GAP.x0 ? -0.11 : 0.11), (WALL_H + 0.08) / 2, -HALF - WALL_T / 2); p.castShadow = true; group.add(p);
  }
  // hazard stripes along the pit edges and the out gap
  const stripes = stripeTexture();
  const stripe = (len, x, z, rotY) => {
    const t = stripes.clone(); t.repeat.set(len / 0.6, 1); t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.18), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
    m.rotation.set(-Math.PI / 2, 0, rotY); m.position.set(x, 0.004, z); m.receiveShadow = true; group.add(m);
  };
  stripe(PIT.x1 - PIT.x0, (PIT.x0 + PIT.x1) / 2, PIT.z0 - 0.09, 0);
  stripe(PIT.z1 - PIT.z0, PIT.x0 - 0.09, (PIT.z0 + PIT.z1) / 2, Math.PI / 2);
  stripe(GAP.x1 - GAP.x0, (GAP.x0 + GAP.x1) / 2, -HALF + 0.09, 0);
  // start squares
  const sq = new THREE.MeshBasicMaterial({ color: '#8A8A84' });
  for (const s of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.02, 4, 1), sq);
    ring.rotation.set(-Math.PI / 2, 0, Math.PI / 4); ring.position.set(s * 3.6, 0.003, -s * 3.6); group.add(ring);
  }
  // pit floor
  const pitFloor = new THREE.Mesh(new THREE.PlaneGeometry(PIT.x1 - PIT.x0, PIT.z1 - PIT.z0), new THREE.MeshLambertMaterial({ color: '#161616' }));
  pitFloor.rotation.x = -Math.PI / 2; pitFloor.position.set((PIT.x0 + PIT.x1) / 2, BASE_Y + 0.01, (PIT.z0 + PIT.z1) / 2); pitFloor.receiveShadow = true;
  group.add(pitFloor);
  // outside floor (catches robots that leave through the gap)
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({ color: '#EEEEEB' }));
  outside.rotation.x = -Math.PI / 2; outside.position.y = BASE_Y; outside.receiveShadow = true; group.add(outside);
  return group;
}

export function buildArenaPhysics(RAPIER, world) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const depth = -BASE_Y;
  const box = (x0, x1, y0, y1, z0, z1, fr) => {
    const d = RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)
      .setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).setFriction(fr).setRestitution(0.1);
    world.createCollider(d, body);
  };
  for (const [x0, x1, z0, z1] of FLOOR) box(x0, x1, -depth, 0, z0, z1, 0.8);
  for (const [x0, x1, z0, z1] of WALLS) box(x0, x1, -depth, WALL_H, z0, z1, 0.25);
  box(-40, 40, BASE_Y - 1, BASE_Y, -40, 40, 0.8);
  return body;
}
