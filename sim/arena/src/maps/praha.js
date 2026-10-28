// "PROTO ROBOT Praha": meetup tournament night. Black floor with orange grid and lettering,
// truss spotlights (fake light pools + beams, no extra real lights), LED strips, a crowd with
// phone lights, two kill-saws in the walls and a centre pit that opens at 1:00.
import * as THREE from 'three';
import { gridTexture, floorRects, boxWalls, cornerPosts, polycarbonate, decal, textTexture, glowTexture, mesh, boxGeo, merge, ORANGE, yawTo, BASE_Y } from './kit.js';
import { KillSaw, PitRelease } from './hazards.js';

const H = 6;
const PIT = { x0: -1.2, x1: 1.2, z0: -1.2, z1: 1.2 };

export const praha = {
  id: 'praha',
  name: 'PROTO ROBOT Praha',
  description: 'Noční finále pražského meetupu: reflektory, publikum, pily ve stěnách a jáma uprostřed, která se otevře v polovině zápasu.',
  blurb: 'Noční finále: pily a jáma od 1:00',
  tags: ['noc', 'pily', 'jáma od 1:00'],
  preview: { floor: '#141414', accent: '#FF5A00', dark: true },
  spec() {
    let floorMat;
    return {
      id: 'praha', name: this.name, description: this.description,
      env: { background: '#0a0a0b', fog: ['#0a0a0b', 30, 75], key: 1.25, keyColor: '#fff4ea', hemi: 0.22, hemiSky: '#ffd9c2', hemiGround: '#101010', envIntensity: 0.22 },
      outsideColor: '#0f0f10', floorSide: '#0b0b0b', pitColor: '#050505',
      surfaces: () => {
        floorMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: gridTexture({ base: '#151515', line: '#5a2208', sub: '#262019', noise: 1 }), roughness: 0.6 });
        return { floor: { mat: floorMat, grip: 1 } };
      },
      // the pit is covered: the floor has a hole, the PitRelease cover fills it until 1:00
      floor: floorRects({ x0: -H, x1: H, z0: -H, z1: H }, [PIT]),
      pits: [],
      walls: boxWalls(H),
      wallStyle: { posts: cornerPosts(H), glass: polycarbonate('#d8dde0', 0.2), rail: '#0E0E0E', lining: '#0b0b0b', edge: '#ffb38a' },
      hazards: () => [
        new PitRelease({ ...PIT, openAt: 60, warnFor: 6, surface: floorMat }),
        new KillSaw({ x: 3, z: -H, nx: 0, nz: 1 }),
        new KillSaw({ x: -3, z: H, nx: 0, nz: -1 })
      ],
      spawn: [{ x: -3.8, z: 3.4, yaw: yawTo(-3.8, 3.4, 0, 0) }, { x: 3.8, z: -3.4, yaw: yawTo(3.8, -3.4, 0, 0) }],
      audience: { rows: 4, palette: ['#1b1b1b', '#242424', '#2e2e2e', '#383838', '#5a2208'], bench: '#0d0d0d' },
      debris: {
        pieces: [
          { x: 1.9, z: 2.3, size: [0.1, 0.025, 0.16], color: ORANGE, yaw: 0.5 },
          { x: -2.2, z: -2.0, size: [0.12, 0.02, 0.07], color: '#F0F0F0', yaw: 1.7 },
          { x: 3.3, z: 1.0, size: [0.06, 0.03, 0.06], color: '#9a9da0', yaw: 0.2, density: 3 }
        ]
      },
      decorate(group, { quality }) {
        const hi = quality !== 'low';
        // floor lettering
        decal(group, textTexture([{ text: 'PROTO ROBOT', font: '700 140px "Inter Tight", Arial, sans-serif', spacing: 14 }], { color: ORANGE, w: 1024, h: 200 }), 0, -3.3, 7.2, 1.4, 0, { opacity: 0.85 });
        decal(group, textTexture([{ text: 'PRAHA · MEETUP', font: '500 90px "Geist Mono", ui-monospace, monospace', spacing: 10 }], { color: '#F0F0F0', w: 1024, h: 160 }), 0, 3.3, 5.2, 0.8, 0, { opacity: 0.55 });
        // LED strips at the wall foot (outside) – unlit orange = glow
        const led = new THREE.MeshBasicMaterial({ color: ORANGE });
        const s = [boxGeo(-H - 0.25, H + 0.25, BASE_Y + 0.02, BASE_Y + 0.12, -H - 0.32, -H - 0.24), boxGeo(-H - 0.25, H + 0.25, BASE_Y + 0.02, BASE_Y + 0.12, H + 0.24, H + 0.32),
          boxGeo(-H - 0.32, -H - 0.24, BASE_Y + 0.02, BASE_Y + 0.12, -H - 0.25, H + 0.25), boxGeo(H + 0.24, H + 0.32, BASE_Y + 0.02, BASE_Y + 0.12, -H - 0.25, H + 0.25),
          // and along the top rails
          boxGeo(-H - 0.2, H + 0.2, 1.26, 1.29, -H - 0.12, -H - 0.04), boxGeo(-H - 0.2, H + 0.2, 1.26, 1.29, H + 0.04, H + 0.12)];
        group.add(mesh(merge(s), led, { receive: false }));
        const halo = new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,90,0,1)'), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
        for (const [x, z, w, d] of [[0, -H - 0.8, 15, 2.2], [0, H + 0.8, 15, 2.2], [-H - 0.8, 0, 2.2, 15], [H + 0.8, 0, 2.2, 15]]) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), halo); m.rotation.x = -Math.PI / 2; m.position.set(x, BASE_Y + 0.02, z); m.renderOrder = 4; group.add(m);
        }
        // spotlights: light pools on the floor + soft beams from the truss
        const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,244,230,1)'), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
        const pools = [];
        const spots = [[-3.2, -3.2], [3.2, 3.2], [3.2, -3.2], [-3.2, 3.2]];
        for (const [x, z] of spots) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), poolMat.clone()); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); m.renderOrder = 4; group.add(m); pools.push(m);
        }
        const beams = [];
        if (hi) {
          const beamGeo = new THREE.CylinderGeometry(0.35, 3.0, 1, 24, 1, true); beamGeo.translate(0, -0.5, 0);
          for (const [x, z] of spots) {
            const top = new THREE.Vector3(x * 1.9, 17, z * 1.9 - 4), bottom = new THREE.Vector3(x, 0, z);
            const b = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#ffe9d6', transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
            b.position.copy(top); b.scale.y = top.distanceTo(bottom);
            b.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), bottom.clone().sub(top).normalize());
            b.renderOrder = 5; group.add(b); beams.push(b);
          }
        }
        // truss with lamp heads
        const truss = new THREE.MeshStandardMaterial({ color: '#2a2a2a', metalness: 0.7, roughness: 0.4 });
        const tg = [];
        for (const z of [-9, 9]) tg.push(boxGeo(-9, 9, 16.8, 17.2, z - 0.2, z + 0.2));
        for (const x of [-9, 9]) tg.push(boxGeo(x - 0.2, x + 0.2, 16.8, 17.2, -9, 9));
        group.add(mesh(merge(tg), truss, { receive: false }));
        // big backdrop banner behind the far crowd
        const ban = new THREE.Mesh(new THREE.PlaneGeometry(30, 5), new THREE.MeshBasicMaterial({ map: textTexture([
          { text: 'PROTO ROBOT', font: '700 150px "Inter Tight", Arial, sans-serif', color: ORANGE, y: 0.42, spacing: 16 },
          { text: 'printedrobotics.cz · antweight 150 g', font: '500 56px "Geist Mono", ui-monospace, monospace', color: '#F0F0F0', y: 0.8 }
        ], { w: 2048, h: 340, bg: '#0E0E0E' }), fog: false }));
        ban.position.set(0, 10, -27); group.add(ban);
        // phone lights twinkling in the crowd
        let phones = null;
        if (hi) {
          const n = 70, pos = new Float32Array(n * 3);
          let sd = 31; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
          for (let i = 0; i < n; i++) {
            const side = r();
            if (side < 0.6) pos.set([(r() - 0.5) * 42, BASE_Y + 3.6 + Math.floor(r() * 4) * 1.6, -14.6 - Math.floor(r() * 4) * 2.8], i * 3);
            else pos.set([(side < 0.8 ? -1 : 1) * (14 + Math.floor(r() * 4) * 2.8), BASE_Y + 3.6 + r() * 4.8, -10 + r() * 13], i * 3);
          }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          phones = new THREE.Points(g, new THREE.PointsMaterial({ color: '#fff8e8', size: 0.35, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
          group.add(phones);
        }
        let t = 0;
        return {
          frame(dt) {
            t += dt;
            // slow sweep of the pools (beams follow), phone lights twinkle
            for (let i = 0; i < pools.length; i++) {
              const p = pools[i], [x, z] = spots[i];
              p.position.x = x + Math.sin(t * 0.35 + i * 1.7) * 0.9; p.position.z = z + Math.cos(t * 0.29 + i * 2.3) * 0.9;
              p.material.opacity = 0.27 + 0.06 * Math.sin(t * 1.3 + i);
              if (beams[i]) {
                const b = beams[i];
                _d.set(p.position.x - b.position.x, -b.position.y, p.position.z - b.position.z);
                b.scale.y = _d.length(); b.quaternion.setFromUnitVectors(_down, _d.normalize());
              }
            }
            if (phones) phones.material.opacity = 0.55 + 0.3 * Math.sin(t * 2.1);
          }
        };
      }
    };
  }
};
const _d = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);
