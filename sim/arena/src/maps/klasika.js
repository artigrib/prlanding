// "CCRL klasika": the realistic 1.2 × 1.2 m antweight box the arena started with.
// Pit in the SE corner, an open "out" gap in the north wall. Geometry is identical to the
// original arena.js so legacy exports (HALF, PIT, GAP, inPit) stay true.
import * as THREE from 'three';
import { gridTexture, floorRects, boxWalls, cornerPosts, polycarbonate, WALL_T, decal, textTexture } from './kit.js';

export const HALF = 6;
export const PIT = { x0: 3.4, x1: 6, z0: 3.4, z1: 6 };
export const GAP = { x0: -4.5, x1: -1.5 };

export const klasika = {
  id: 'klasika',
  name: 'CCRL klasika',
  description: 'Věrná 1,2 m aréna jako na soutěžích: jáma v rohu a výjezd ze severní stěny.',
  blurb: 'Jáma v rohu a výjezd ve stěně',
  tags: ['jáma', 'výjezd'],
  preview: { floor: '#E9E9E5', accent: '#E8461E', dark: false },
  spec() {
    return {
      id: 'klasika', name: this.name, description: this.description,
      env: { background: '#EEEEEB' },
      surfaces: () => ({ floor: { mat: new THREE.MeshStandardMaterial({ color: '#ffffff', map: gridTexture({ noise: 1 }), roughness: 0.82 }), grip: 1 } }),
      floor: floorRects({ x0: -HALF, x1: HALF, z0: -HALF, z1: HALF }, [PIT]),
      pits: [PIT],
      gaps: [{ x0: GAP.x0, x1: GAP.x1, z0: -HALF - 0.6, z1: -HALF + 0.6 }],
      walls: boxWalls(HALF, [{ side: 'n', a0: GAP.x0, a1: GAP.x1 }]),
      wallStyle: { posts: [...cornerPosts(HALF), [GAP.x0 - 0.11, -HALF - WALL_T / 2], [GAP.x1 + 0.11, -HALF - WALL_T / 2]], glass: polycarbonate('#dfe8ee', 0.22) },
      stripes: [
        [PIT.x1 - PIT.x0, (PIT.x0 + PIT.x1) / 2, PIT.z0 - 0.09, 0],
        [PIT.z1 - PIT.z0, PIT.x0 - 0.09, (PIT.z0 + PIT.z1) / 2, Math.PI / 2],
        [GAP.x1 - GAP.x0, (GAP.x0 + GAP.x1) / 2, -HALF + 0.09, 0]
      ],
      spawn: [{ x: -3.6, z: 3.6, yaw: Math.PI * 0.75 }, { x: 3.6, z: -3.6, yaw: -Math.PI * 0.25 }],
      debris: {
        // a few printed shards and a lost hex nut from earlier fights
        pieces: [
          { x: 1.2, z: 1.9, size: [0.09, 0.025, 0.14], color: '#E8461E', yaw: 0.6 },
          { x: -1.8, z: -0.8, size: [0.12, 0.02, 0.06], color: '#F2F2EE', yaw: 1.9 },
          { x: 0.4, z: -2.6, size: [0.05, 0.03, 0.05], color: '#b9bab5', yaw: 0.2, density: 3 },
          { x: -0.9, z: 3.3, size: [0.07, 0.02, 0.1], color: '#2A2A2A', yaw: 2.4 }
        ],
        opts: { density: 0.5, friction: 0.5 }
      },
      decorate(group) {
        // start squares (as on the original)
        const sq = new THREE.MeshBasicMaterial({ color: '#8A8A84' });
        for (const s of [-1, 1]) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.02, 4, 1), sq);
          ring.rotation.set(-Math.PI / 2, 0, Math.PI / 4); ring.position.set(s * 3.6, 0.003, -s * 3.6); group.add(ring);
        }
        // "OUT" lettering below the gap and a small centre mark
        decal(group, textTexture([{ text: 'OUT', font: '600 170px "Geist Mono", ui-monospace, monospace', spacing: 30 }], { color: '#C9C9C3', w: 512, h: 256 }), (GAP.x0 + GAP.x1) / 2, -HALF - 1.6, 2.4, 1.2, 0, { y: -2.49 });
        decal(group, textTexture([{ text: '150 g', font: '500 120px "Geist Mono", ui-monospace, monospace' }], { color: '#D7D7D1', w: 512, h: 256 }), 0, 0, 2.2, 1.1, 0, { opacity: 0.9 });
      }
    };
  }
};
