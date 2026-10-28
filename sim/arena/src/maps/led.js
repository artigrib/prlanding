// "Led": an ice rink. The middle is low-grip ice (robots drift and carry momentum), the rim
// is rubber. Open gaps in the north and south walls: slide the opponent out.
import * as THREE from 'three';
import { iceTexture, gridTexture, floorRects, boxWalls, cornerPosts, polycarbonate, WALL_T, yawTo, mesh, boxGeo, merge } from './kit.js';

const H = 6;
const ICE = { x0: -4.6, x1: 4.6, z0: -4.6, z1: 4.6, surf: 'ice' };
const GAPS = [{ side: 'n', a0: -1.6, a1: 1.6 }, { side: 's', a0: -1.6, a1: 1.6 }];

export const led = {
  id: 'led',
  name: 'Led',
  description: 'Kluziště: uprostřed led, po okraji gumový pás. Roboti kloužou a nesou setrvačnost, ve dvou stěnách jsou výjezdy.',
  blurb: 'Kluzký led a dva výjezdy',
  tags: ['led', 'výjezdy'],
  preview: { floor: '#DCEBF3', accent: '#1F3BFF', dark: false },
  spec() {
    return {
      id: 'led', name: this.name, description: this.description,
      env: { background: '#E6EEF2', key: 1.5, keyColor: '#f4f9ff', hemi: 0.9, hemiSky: '#eef6ff', hemiGround: '#cad6de', envIntensity: 0.7 },
      outsideColor: '#E3EBEF',
      surfaces: () => ({
        floor: { mat: new THREE.MeshStandardMaterial({ color: '#ffffff', map: gridTexture({ base: '#3b3f44', line: '#2c2f33', sub: '#34383c', noise: 2 }), roughness: 0.95 }), grip: 1 },
        ice: { mat: new THREE.MeshStandardMaterial({ color: '#ffffff', map: iceTexture(), roughness: 0.12, metalness: 0, envMapIntensity: 1.4 }), grip: 0.14, scale: 4 }
      }),
      floor: floorRects({ x0: -H, x1: H, z0: -H, z1: H }, [], [ICE]),
      gaps: [{ x0: -1.6, x1: 1.6, z0: -H - 0.6, z1: -H + 0.6 }, { x0: -1.6, x1: 1.6, z0: H - 0.6, z1: H + 0.6 }],
      walls: boxWalls(H, GAPS),
      wallStyle: { posts: [...cornerPosts(H), ...[-1, 1].flatMap(s => [[-1.71, s * (H + WALL_T / 2)], [1.71, s * (H + WALL_T / 2)]])], glass: polycarbonate('#e6f2fa', 0.22), rail: '#1F3BFF' },
      stripes: [[3.2, 0, -H + 0.09, 0], [3.2, 0, H - 0.09, 0]],
      spawn: [{ x: -3.6, z: 3.6, yaw: Math.PI * 0.75 }, { x: 3.6, z: -3.6, yaw: -Math.PI * 0.25 }],
      audience: { rows: 2, palette: ['#c43a2b', '#1F3BFF', '#2a2a2a', '#f2f2ee', '#3a6a4a', '#d9a400'], bench: '#d0dbe2' },
      debris: {
        // ice blocks: slippery, a bit heavy, great for shoving around
        pieces: [
          { x: -1.6, z: -1.2, size: [0.26, 0.2, 0.26], color: '#cfe9f7', yaw: 0.3, friction: 0.02, density: 0.35 },
          { x: 1.8, z: 1.4, size: [0.26, 0.2, 0.26], color: '#d8eef9', yaw: 1.0, friction: 0.02, density: 0.35 },
          { x: 0.3, z: -2.4, size: [0.2, 0.16, 0.2], color: '#c6e3f3', yaw: 0.8, friction: 0.02, density: 0.35 },
          { x: -0.4, z: 2.2, size: [0.2, 0.16, 0.2], color: '#d4ecf8', yaw: 2.0, friction: 0.02, density: 0.35 }
        ],
        opts: { roughness: 0.1 }
      },
      decorate(group) {
        // red / blue rink lines painted under the ice
        const line = (x0, x1, z0, z1, c) => { const m = mesh(boxGeo(x0, x1, 0.001, 0.003, z0, z1), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, depthWrite: false })); m.renderOrder = 1; group.add(m); };
        line(-4.6, 4.6, -0.06, 0.06, '#c43a2b');
        line(-4.6, 4.6, -2.4, -2.3, '#1F3BFF'); line(-4.6, 4.6, 2.3, 2.4, '#1F3BFF');
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.18, 48), new THREE.MeshBasicMaterial({ color: '#c43a2b', transparent: true, opacity: 0.55, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004; ring.renderOrder = 1; group.add(ring);
        // snow banks outside the gaps
        const snow = new THREE.MeshLambertMaterial({ color: '#f7fbfd' });
        group.add(mesh(merge([boxGeo(-3, 3, -2.5, -2.2, -H - 3.2, -H - 1.4), boxGeo(-3, 3, -2.5, -2.2, H + 1.4, H + 3.2)]), snow));
      }
    };
  }
};
