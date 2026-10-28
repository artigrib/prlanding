// "Kladivo": an industrial arena with live hazards like the big shows: a corner hammer that
// punishes loitering, two saw strips that rise from the floor and a corner pit. Steel floor.
import * as THREE from 'three';
import { plateTexture, floorRects, boxWalls, cornerPosts, polycarbonate, yawTo, decal, textTexture, mesh, boxGeo, merge, glowTexture } from './kit.js';
import { Hammer, SawStrip } from './hazards.js';

const H = 6;
const PIT = { x0: -6, x1: -3.6, z0: 3.6, z1: 6 };

export const kladivo = {
  id: 'kladivo',
  name: 'Kladivo',
  description: 'Ocelová aréna s nástrahami: kladivo v rohu, pily vyjíždějící z podlahy a jáma. Kdo se zdržuje u kladiva, dostane ránu.',
  blurb: 'Kladivo, pily z podlahy a jáma',
  tags: ['kladivo', 'pily', 'jáma'],
  preview: { floor: '#7d8083', accent: '#FF5A00', dark: true },
  spec() {
    return {
      id: 'kladivo', name: this.name, description: this.description,
      env: { background: '#26272a', fog: ['#26272a', 34, 80], key: 1.5, keyColor: '#fff1e0', hemi: 0.45, hemiSky: '#c9d3dc', hemiGround: '#3a3530', envIntensity: 0.45 },
      outsideColor: '#2f3033', floorSide: '#1e1f21',
      surfaces: () => ({ floor: { mat: new THREE.MeshStandardMaterial({ color: '#ffffff', map: plateTexture(), metalness: 0.55, roughness: 0.5 }), grip: 0.95 } }),
      floor: floorRects({ x0: -H, x1: H, z0: -H, z1: H }, [PIT]),
      pits: [PIT],
      walls: boxWalls(H),
      wallStyle: { posts: cornerPosts(H), glass: polycarbonate('#d6e0e6', 0.16), rail: '#1a1a1a', lining: '#1e1f21', edge: '#cfd8de' },
      stripes: [
        [PIT.x1 - PIT.x0, (PIT.x0 + PIT.x1) / 2, PIT.z0 - 0.09, 0],
        [PIT.z1 - PIT.z0, PIT.x1 + 0.09, (PIT.z0 + PIT.z1) / 2, Math.PI / 2]
      ],
      hazards: () => [
        new Hammer({ pivot: [4.95, -4.95], target: [2.9, -2.9], height: 0.98 }),
        new SawStrip({ x: -2.3, z: -0.4, axis: 'x', len: 3.2, up: 2.6, down: 4.5 }),
        new SawStrip({ x: 2.3, z: 2.4, axis: 'z', len: 3.2, up: 2.6, down: 4.5, offset: 3.6 })
      ],
      spawn: [{ x: 4.1, z: 4.3, yaw: yawTo(4.1, 4.3, -1, -1) }, { x: -4.1, z: -4.3, yaw: yawTo(-4.1, -4.3, 1, 1) }],
      audience: { rows: 3, palette: ['#2a2a2a', '#3a3a3a', '#4a4a46', '#5a5a55', '#FF5A00', '#1F3BFF'], bench: '#1a1a1a', bg: '#26272a' },
      debris: {
        // bent steel offcuts
        pieces: [
          { x: -0.6, z: 3.3, size: [0.2, 0.025, 0.07], color: '#9a9da0', yaw: 0.4, density: 2 },
          { x: 0.8, z: -1.6, size: [0.14, 0.025, 0.09], color: '#8a8d90', yaw: 1.4, density: 2 },
          { x: -3.6, z: 1.8, size: [0.16, 0.03, 0.06], color: '#FF5A00', yaw: 2.2, density: 1 }
        ],
        opts: { metalness: 0.6, roughness: 0.35 }
      },
      decorate(group, { quality }) {
        // overhead work lights: warm pools on the floor (cheap additive quads, no extra lights)
        const pool = new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,236,210,1)'), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
        for (const [x, z] of [[-3, -3], [3, 3], [-3, 3], [3, -3]]) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), pool); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.01, z); m.renderOrder = 4; group.add(m);
        }
        // hazard sign and floor lettering
        decal(group, textTexture([{ text: 'KLADIVO', font: '700 150px "Inter Tight", Arial, sans-serif', spacing: 18 }], { color: 'rgba(255,90,0,0.55)', w: 1024, h: 256 }), 1.1, -4.9, 4.2, 1.05, 0);
        decal(group, textTexture([{ text: 'JÁMA', font: '700 150px "Inter Tight", Arial, sans-serif', spacing: 14 }], { color: 'rgba(255,255,255,0.35)', w: 1024, h: 256 }), -4.8, 2.8, 3.2, 0.8, 0);
        // steel bulkheads behind the walls (dark industrial backdrop)
        const back = new THREE.MeshLambertMaterial({ color: '#36383b' });
        const geos = [boxGeo(-30, 30, -2.5, 9, -32, -30)];
        if (quality !== 'low') for (let i = -3; i <= 3; i++) geos.push(boxGeo(i * 8 - 0.4, i * 8 + 0.4, -2.5, 9, -30, -29.2));
        group.add(mesh(merge(geos), back));
      }
    };
  }
};
