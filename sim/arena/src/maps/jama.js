// "Jáma a rampy": central pit, two floor flippers and two wall ramps you can be shoved up and,
// with a good hit, over the wall. Daylight workshop with a small crowd.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { gridTexture, floorRects, boxWalls, cornerPosts, polycarbonate, stripeTexture, mesh, INK, ORANGE, yawTo } from './kit.js';
import { FloorFlipper } from './hazards.js';

const H = 6;
const PIT = { x0: -1.3, x1: 1.3, z0: -1.3, z1: 1.3 };
const FL_W = { x0: -4.7, x1: -2.7, z0: -1, z1: 1 };
const FL_E = { x0: 2.7, x1: 4.7, z0: -1, z1: 1 };
// ramps against the north and south walls: [x0, x1, zLow, zHigh(wall), height]
const RAMPS = [[-2, 2, -4.1, -H, 0.62], [-2, 2, 4.1, H, 0.62]];

function rampPoints([x0, x1, zl, zh, h]) {
  return [[x0, 0, zl], [x1, 0, zl], [x0, 0, zh], [x1, 0, zh], [x0, h, zh], [x1, h, zh]];
}

export const jama = {
  id: 'jama',
  name: 'Jáma a rampy',
  description: 'Jáma uprostřed, dva podlahové flippery a rampy u stěn. Dobrým zásahem soupeře vyhodíte přes stěnu.',
  blurb: 'Jáma, podlahové flippery a rampy',
  tags: ['jáma', 'flippery', 'rampy'],
  preview: { floor: '#E4E1DA', accent: '#E8461E', dark: false },
  spec() {
    return {
      id: 'jama', name: this.name, description: this.description,
      env: { background: '#E9E7E2', key: 1.55, hemi: 0.8, envIntensity: 0.55 },
      surfaces: () => ({ floor: { mat: new THREE.MeshStandardMaterial({ color: '#ffffff', map: gridTexture({ base: '#E4E1DA', line: '#CFCBC2', sub: '#DAD7CF', noise: 1.5 }), roughness: 0.85 }), grip: 1 } }),
      floor: floorRects({ x0: -H, x1: H, z0: -H, z1: H }, [PIT, FL_W, FL_E]),
      pits: [PIT],
      walls: boxWalls(H),
      wallStyle: { posts: cornerPosts(H), glass: polycarbonate('#e2e9ee', 0.22) },
      stripes: [
        [2.6, 0, PIT.z0 - 0.09, 0], [2.6, 0, PIT.z1 + 0.09, 0],
        [2.78, PIT.x0 - 0.09, 0, Math.PI / 2], [2.78, PIT.x1 + 0.09, 0, Math.PI / 2]
      ],
      hazards: () => [new FloorFlipper({ ...FL_W, hinge: 'x0' }), new FloorFlipper({ ...FL_E, hinge: 'x1' })],
      spawn: [{ x: -4.4, z: 2.7, yaw: yawTo(-4.4, 2.7, 0, 3.4) }, { x: 4.4, z: -2.7, yaw: yawTo(4.4, -2.7, 0, -3.4) }],
      colliders(RAPIER, world, body) {
        for (const r of RAMPS) {
          const pts = new Float32Array(rampPoints(r).flat());
          world.createCollider(RAPIER.ColliderDesc.convexHull(pts).setFriction(0.8).setRestitution(0.05), body);
        }
      },
      audience: { rows: 3, palette: ['#4a4a46', '#6a6a64', '#3a3a3a', '#8a8a84', '#E8461E', '#2a4bd0', '#d8d8d2'], bench: '#cfcfca', bg: '#E9E7E2' },
      debris: {
        // loose wooden blocks (left-over spacers) that can be shoved into the pit
        pieces: [
          { x: -2.6, z: 3.0, size: [0.3, 0.15, 0.3], color: '#c8a97e', yaw: 0.3 },
          { x: 2.4, z: -3.2, size: [0.3, 0.15, 0.3], color: '#c09d70', yaw: 1.1 },
          { x: 0.0, z: -2.6, size: [0.45, 0.1, 0.18], color: '#d1b48a', yaw: 0.0 },
          { x: 0.3, z: 2.6, size: [0.2, 0.2, 0.2], color: '#bf9a6a', yaw: 0.7 }
        ],
        opts: { density: 0.5, friction: 0.7 }
      },
      decorate(group) {
        // ramps: plywood with a stripe on the top edge
        const ply = new THREE.MeshStandardMaterial({ color: '#d6bb8f', roughness: 0.8 });
        const st = stripeTexture(INK, ORANGE);
        for (const r of RAMPS) {
          const g = new ConvexGeometry(rampPoints(r).map(p => new THREE.Vector3(...p)));
          group.add(mesh(g, ply, { cast: true }));
          const [x0, x1, , zh, h] = r;
          const edge = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 0.16), new THREE.MeshStandardMaterial({ map: st, roughness: 0.7 }));
          st.repeat.set((x1 - x0) / 0.6, 1);
          const s = Math.sign(zh);
          edge.position.set((x0 + x1) / 2, h + 0.003, zh - s * 0.08); edge.rotation.x = -Math.PI / 2;
          group.add(edge);
        }
        // pit lights: orange glow at the pit bottom makes the hole read from above
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ color: '#5a1d05' }));
        glow.rotation.x = -Math.PI / 2; glow.position.set(0, -2.47, 0); group.add(glow);
      }
    };
  }
};
