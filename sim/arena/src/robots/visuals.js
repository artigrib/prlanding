// Placeholder meshes built from primitives (used until / instead of a GLB).
// Returned parts the Robot animates:
//   wheels[]  groups spun about local X        blade + bladeAxis ('x' | 'y') + blur disc
//   flipper   pivot group (rotation.x = flipRest + hinge angle)   jaw (grabber claw, rotation.x)
import * as THREE from 'three';
import { RIDE } from './catalog.js';

let shared = null;
function mats() {
  if (shared) return shared;
  const m = {
    ink: new THREE.MeshStandardMaterial({ color: '#1d1d1d', roughness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: '#b9bab5', roughness: 0.35, metalness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2A2A2A', roughness: 0.6 }),
    orange: new THREE.MeshStandardMaterial({ color: '#E8461E' }),
    blur: new THREE.MeshBasicMaterial({ color: '#c8c8c2', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
  };
  // shared between robots: main.js must not dispose these
  shared = m;
  return m;
}

export function buildPlaceholder(def, printMat) {
  const M = mats();
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    if (mat !== printMat) m.userData.sharedMat = true;
    parent.add(m); return m;
  };
  const parts = { wheels: [] };
  const wheelGeo = new THREE.CylinderGeometry(def.wheelR, def.wheelR, 0.12, 20); wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(def.wheelR * 0.45, def.wheelR * 0.45, 0.13, 6); hubGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of def.wheels) {
    const w = new THREE.Group(); w.position.set(x, -RIDE + def.wheelR, z); g.add(w);
    add(wheelGeo, M.ink, 0, 0, 0, w); add(hubGeo, printMat, 0, 0, 0, w);
    parts.wheels.push(w);
  }
  const blurDisc = (r, axis, parent) => {
    const mat = M.blur.clone(); mat.userData.own = true;
    const b = new THREE.Mesh(new THREE.CircleGeometry(r, 40), mat);
    if (axis === 'x') b.rotation.y = Math.PI / 2; else b.rotation.x = -Math.PI / 2;
    parent.add(b); return b;
  };
  // hinged plate / forks from the def's arm hull
  const armPivot = () => {
    const a = def.arm, pivot = new THREE.Group(); pivot.position.fromArray(a.pivot); g.add(pivot);
    parts.flipper = pivot; parts.flipRest = 0;
    return pivot;
  };

  if (def.id === 'svrn') {
    add(new THREE.BoxGeometry(0.82, 0.26, 0.86), printMat, 0, -0.01, -0.02);
    add(new THREE.BoxGeometry(0.62, 0.04, 0.56), M.dark, 0, 0.13, -0.08);            // lid
    add(new THREE.BoxGeometry(0.06, 0.05, 0.06), M.orange, 0.22, 0.165, -0.28);       // switch
    const pivot = armPivot();
    // plate from the hinge (top) to the tip at local (0, −0.375, 0.44)
    const tip = new THREE.Vector3(0, -0.375 + 0.02, 0.44), len = tip.length(), ang = Math.atan2(-tip.y, tip.z);
    const holder = new THREE.Group(); holder.rotation.x = ang; pivot.add(holder);
    add(new THREE.BoxGeometry(0.98, 0.035, len), M.steel, 0, 0, len / 2, holder);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.18, 0.5), M.dark, s * 0.555, -0.02, 0);   // TPU side armour
  } else if (def.id === 'vert150') {
    add(new THREE.BoxGeometry(0.74, 0.2, 0.74), printMat, 0, -0.02, -0.08);
    add(new THREE.BoxGeometry(0.6, 0.03, 0.58), M.dark, 0, 0.095, -0.1);
    if (def.wedge === 'klin') {
      // full-width steel wedge under the blade
      // two steel wedgelets either side of the blade slot
      const len = Math.hypot(0.4, 0.33), ang = Math.atan2(0.33, 0.4);
      const k = new THREE.Group();
      for (const sx of [-1, 1]) { const w = add(new THREE.BoxGeometry(0.36, 0.03, len), M.steel, sx * 0.31, -0.08, 0.5, k); w.rotation.x = ang; }
      g.add(k);
      parts.extras = [k];      // kept when a GLB replaces the placeholder (the model has forks only)
    } else if (def.wedge !== 'bez') {
      for (const s of [-1, 1]) { const f = add(new THREE.BoxGeometry(0.07, 0.2, 0.42), printMat, s * 0.13, -0.03, 0.42); f.rotation.x = -0.12; }
    }
    const axle = new THREE.Group(); axle.position.fromArray(def.spinner.axle); g.add(axle);
    const blade = new THREE.Group(); axle.add(blade);
    add(new THREE.BoxGeometry(0.075, 0.56, 0.11), M.steel, 0, 0, 0, blade);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.09, 0.16), M.steel, 0, s * 0.24, s * 0.03, blade);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 12).rotateZ(Math.PI / 2), M.dark, 0, 0, 0, axle);
    parts.blade = blade; parts.bladeAxis = 'x'; parts.blur = blurDisc(0.29, 'x', axle);
    add(new THREE.BoxGeometry(0.06, 0.05, 0.06), M.orange, -0.22, 0.12, -0.32);
  } else if (def.id === 'kosa') {
    // low wedge-shaped body, motor pod at the front, long bar blade sweeping the sides
    const body = new THREE.Shape(); // side profile (z, y), extruded across x
    body.moveTo(-0.46, -0.13); body.lineTo(0.3, -0.13); body.lineTo(0.3, 0.02); body.lineTo(0.05, 0.12); body.lineTo(-0.46, 0.12); body.closePath();
    const bg = new THREE.ExtrudeGeometry(body, { depth: 0.66, bevelEnabled: false }); bg.rotateY(-Math.PI / 2); bg.translate(0.33, 0, 0);
    add(bg, printMat, 0, 0, 0);
    add(new THREE.BoxGeometry(0.44, 0.03, 0.34), M.dark, 0, 0.125, -0.2);
    add(new THREE.BoxGeometry(0.06, 0.05, 0.06), M.orange, 0.16, 0.16, -0.32);
    const ax = def.spinner.axle;
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 16), M.dark, ax[0], ax[1] + 0.1, ax[2]);   // weapon motor
    add(new THREE.BoxGeometry(0.3, 0.05, 0.22), printMat, 0, ax[1] + 0.03, ax[2] - 0.12);     // motor mount
    const axle = new THREE.Group(); axle.position.fromArray(ax); g.add(axle);
    const blade = new THREE.Group(); axle.add(blade);
    const L = def.spinner.radius * 2;
    add(new THREE.BoxGeometry(L, 0.04, 0.09), M.steel, 0, 0, 0, blade);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.1, 0.05, 0.12), M.steel, s * (L / 2 - 0.05), 0, s * 0.03, blade);  // impactors
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 12), M.dark, 0, 0.02, 0, axle);
    parts.blade = blade; parts.bladeAxis = 'y'; parts.blur = blurDisc(def.spinner.radius, 'y', axle);
    // front skids
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.06, 0.16), M.dark, s * 0.2, -0.22, 0.24);
  } else if (def.id === 'klepeto') {
    add(new THREE.BoxGeometry(0.74, 0.3, 0.74), printMat, 0, 0.0, -0.1);
    add(new THREE.BoxGeometry(0.56, 0.04, 0.5), M.dark, 0, 0.16, -0.14);
    add(new THREE.BoxGeometry(0.06, 0.05, 0.06), M.orange, -0.2, 0.2, -0.36);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.1, 0.14, 0.16), M.dark, s * 0.3, 0.1, 0.22);   // servo towers
    const pivot = armPivot();
    // two fork tines + cross bar, from the hinge down to the tips
    const tip = new THREE.Vector3(0, -0.345, 0.62), len = tip.length(), ang = Math.atan2(-tip.y, tip.z);
    const holder = new THREE.Group(); holder.rotation.x = ang; pivot.add(holder);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.1, 0.04, len), M.steel, s * 0.3, 0, len / 2, holder);
      add(new THREE.BoxGeometry(0.1, 0.06, 0.1), M.steel, s * 0.3, 0.04, len - 0.06, holder);   // hooked tip
    }
    add(new THREE.BoxGeometry(0.7, 0.05, 0.08), printMat, 0, 0.0, 0.06, holder);
    // top jaw (closes onto the opponent while holding)
    const jaw = new THREE.Group(); jaw.position.set(0, 0.16, 0.02); pivot.add(jaw);
    add(new THREE.BoxGeometry(0.06, 0.05, 0.62), printMat, 0.2, 0, 0.3, jaw);
    add(new THREE.BoxGeometry(0.06, 0.05, 0.62), printMat, -0.2, 0, 0.3, jaw);
    add(new THREE.BoxGeometry(0.5, 0.05, 0.06), M.steel, 0, 0, 0.6, jaw);
    add(new THREE.BoxGeometry(0.5, 0.14, 0.04), M.steel, 0, -0.07, 0.62, jaw);
    parts.jaw = jaw; parts.jawOpen = -0.42; jaw.rotation.x = -0.42;
  } else {
    add(new THREE.BoxGeometry(def.chassis.half[0] * 1.6, def.chassis.half[1] * 2, def.chassis.half[2] * 2), printMat, 0, 0, 0);
  }
  return { group: g, parts };
}

// a loose wheel for debris (fresh geometry, disposed with the debris)
export function wheelDebrisMesh(def, printMat) {
  const M = mats();
  const w = new THREE.Group();
  const geo = new THREE.CylinderGeometry(def.wheelR, def.wheelR, 0.12, 16); geo.rotateZ(Math.PI / 2);
  const t = new THREE.Mesh(geo, M.ink); t.castShadow = true; w.add(t);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(def.wheelR * 0.45, def.wheelR * 0.45, 0.13, 6).rotateZ(Math.PI / 2), printMat); w.add(hub);
  return w;
}
