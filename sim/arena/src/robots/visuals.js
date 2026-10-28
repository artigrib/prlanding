// Procedural robot visuals, shown while a GLB loads, when it fails, or for a robot without a model.
// Built from bevelled extrusions (no raw boxes): rounded hulls, chamfered lids, lathed tyres with tread,
// spoked hubs and hex bolt heads, so a robot without a GLB still reads as a printed antweight.
// Returned parts the Robot animates:
//   wheels[]  groups spun about local X        blade + bladeAxis ('x' | 'y') + blur disc
//   flipper   pivot group (rotation.x = flipRest + hinge angle)   jaw (grabber claw, rotation.x)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RIDE } from './catalog.js';

let shared = null;
function mats() {
  if (shared) return shared;
  const m = {
    ink: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: '#b9bab5', roughness: 0.32, metalness: 0.85 }),
    bolt: new THREE.MeshStandardMaterial({ color: '#8d8d88', roughness: 0.38, metalness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2b2b29', roughness: 0.6 }),
    servo: new THREE.MeshStandardMaterial({ color: '#070707', roughness: 0.35 }),
    orange: new THREE.MeshStandardMaterial({ color: '#E8461E' }),
    blur: new THREE.MeshBasicMaterial({ color: '#c8c8c2', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
  };
  // shared between robots: main.js must not dispose these
  shared = m;
  return m;
}

// ---------------------------------------------------------------- geometry helpers (robot units, 1 u = 10 cm)
// rounded rectangle footprint (x by z), extruded up along Y from y0 to y1, bevelled top and bottom
export function slab(w, d, y0, y1, r = 0.03, bevel = 0.015) {
  const s = new THREE.Shape(), x = w / 2 - bevel, z = d / 2 - bevel, rr = Math.max(0.001, Math.min(r, x, z));
  s.moveTo(-x + rr, -z); s.lineTo(x - rr, -z); s.quadraticCurveTo(x, -z, x, -z + rr);
  s.lineTo(x, z - rr); s.quadraticCurveTo(x, z, x - rr, z); s.lineTo(-x + rr, z);
  s.quadraticCurveTo(-x, z, -x, z - rr); s.lineTo(-x, -z + rr); s.quadraticCurveTo(-x, -z, -x + rr, -z);
  return extrudeUp(s, y0, y1, bevel);
}
// closed footprint polygon [[x, z], ...] extruded up along Y with a bevel
export function prism(pts, y0, y1, bevel = 0.012) {
  const s = new THREE.Shape(); pts.forEach(([x, z], i) => i ? s.lineTo(x, -z) : s.moveTo(x, -z));
  return extrudeUp(s, y0, y1, bevel);
}
function extrudeUp(shape, y0, y1, bevel) {
  const h = Math.max(0.002, y1 - y0 - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0 + bevel, 0);
  return g;
}
// side profile [[z, y], ...] (z forward, y up) extruded across X, centred on x = 0
export function profile(pts, width, bevel = 0.01) {
  const s = new THREE.Shape(); pts.forEach(([z, y], i) => i ? s.lineTo(z, y) : s.moveTo(z, y));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.002, width - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(width - 2 * bevel) / 2); g.rotateY(-Math.PI / 2);   // shape x -> +Z (forward), extrusion -> X
  return g;
}
// tyre: lathed carcass with rounded shoulders + staggered tread lugs, axis along X
export function tyreGeometry(R, w, lugs = 18) {
  const t = 0.012, rc = R - t, ri = R * 0.62, sh = Math.min(w * 0.22, 0.022), pts = [];
  pts.push(new THREE.Vector2(ri, -w / 2));
  for (let i = 0; i <= 4; i++) { const a = -Math.PI / 2 + (i / 4) * Math.PI / 2; pts.push(new THREE.Vector2(rc - sh + Math.cos(a) * sh, -w / 2 + sh + Math.sin(a) * sh)); }
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * Math.PI / 2; pts.push(new THREE.Vector2(rc - sh + Math.cos(a) * sh, w / 2 - sh + Math.sin(a) * sh)); }
  pts.push(new THREE.Vector2(ri, w / 2));
  const parts = [new THREE.LatheGeometry(pts, 36).toNonIndexed()];
  const lw = (w - 2 * sh) / 2 + 0.006, ll = (2 * Math.PI * R / lugs) * 0.5;
  for (let i = 0; i < lugs; i++) for (const row of [0, 1]) {
    const b = new THREE.BoxGeometry(ll, lw, t * 2);            // tangential x, axial y, radial z
    b.rotateZ(row ? 0.25 : -0.25);
    b.translate(0, row ? lw / 2 + 0.002 : -lw / 2 - 0.002, rc + t * 0.3);
    b.rotateY((i + row * 0.5) / lugs * Math.PI * 2);
    parts.push(b.toNonIndexed());
  }
  const g = mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); return p; }));
  g.rotateZ(-Math.PI / 2);       // axle Y -> X
  return g;
}
// spoked hub (axis X), sits inside the tyre
export function hubGeometry(R, w) {
  const ri = R * 0.62, parts = [];
  parts.push(new THREE.CylinderGeometry(ri + 0.002, ri + 0.002, w * 0.86, 28, 1, true));
  for (const s of [-1, 1]) {
    const f = new THREE.RingGeometry(0.048, ri, 28); f.rotateX(-s * Math.PI / 2); f.translate(0, s * w * 0.18, 0); parts.push(f);
  }
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {           // spokes standing proud of both faces
    const sp = new THREE.BoxGeometry(0.03, w * 0.16, ri - 0.04); sp.translate(0, s * w * 0.26, (ri + 0.04) / 2); sp.rotateY(i / 5 * Math.PI * 2); parts.push(sp);
  }
  parts.push(new THREE.CylinderGeometry(0.046, 0.05, w * 0.9, 16));
  const g = mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); return p.index ? p.toNonIndexed() : p; }));
  g.rotateZ(-Math.PI / 2);
  return g;
}
// hex bolt heads at [[x, y, z], ...], all facing +Y (or `dir` = 'x' | '-x' | '-y' | 'z')
export function boltsGeometry(list, r = 0.024, h = 0.014, dir = 'y') {
  const parts = list.map(([x, y, z]) => {
    const b = new THREE.CylinderGeometry(r * 0.88, r, h, 6);
    b.translate(0, h / 2, 0);
    if (dir === 'x') b.rotateZ(-Math.PI / 2); else if (dir === '-x') b.rotateZ(Math.PI / 2);
    else if (dir === '-y') b.rotateZ(Math.PI); else if (dir === 'z') b.rotateX(Math.PI / 2);
    b.translate(x, y, z);
    return b.toNonIndexed();
  });
  return parts.length ? mergeGeometries(parts) : null;
}

export function buildPlaceholder(def, printMat) {
  const M = mats();
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = g) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    if (mat !== printMat) m.userData.sharedMat = true;
    parent.add(m); return m;
  };
  const parts = { wheels: [] };
  const wR = def.wheelR, wW = Math.min(0.13, wR * 0.6);
  const tyreGeo = tyreGeometry(wR, wW, Math.round(wR * 80)), hubGeo = hubGeometry(wR, wW);
  for (const [x, z] of def.wheels) {
    const w = new THREE.Group(); w.position.set(x, -RIDE + wR, z); g.add(w);
    add(tyreGeo, M.ink, 0, 0, 0, w); add(hubGeo, printMat, 0, 0, 0, w);
    add(boltsGeometry([[0, 0, 0]], 0.02, wW * 0.52, x > 0 ? 'x' : '-x'), M.bolt, 0, 0, 0, w);
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
  // lid with corner bolts and a power switch
  const lid = (w, d, y, z, sw = 1) => {
    add(slab(w, d, y - 0.006, y + 0.012, 0.035, 0.005), M.dark, 0, 0, z);
    const bx = w / 2 - 0.045, bz = d / 2 - 0.045;
    add(boltsGeometry([[bx, y + 0.012, z + bz], [-bx, y + 0.012, z + bz], [bx, y + 0.012, z - bz], [-bx, y + 0.012, z - bz]], 0.022, 0.01), M.bolt);
    add(slab(0.06, 0.09, y + 0.012, y + 0.028, 0.008, 0.004), M.servo, sw * w * 0.28, 0, z - d * 0.2);
  };

  if (def.id === 'svrn') {
    add(prism([[-0.41, -0.45], [0.41, -0.45], [0.41, 0.3], [0.32, 0.41], [-0.32, 0.41], [-0.41, 0.3]], -0.14, 0.12, 0.02), printMat);
    lid(0.6, 0.56, 0.12, -0.08);
    const pivot = armPivot();
    // plate from the hinge (top) to the tip at local (0, −0.375, 0.44)
    const tip = new THREE.Vector3(0, -0.375 + 0.02, 0.44), len = tip.length(), ang = Math.atan2(-tip.y, tip.z);
    const holder = new THREE.Group(); holder.rotation.x = ang; pivot.add(holder);
    add(slab(0.98, len, -0.018, 0.018, 0.03, 0.008), M.steel, 0, 0, len / 2, holder);
    add(boltsGeometry([[-0.3, 0.018, 0.08], [0.3, 0.018, 0.08], [-0.3, 0.018, 0.3], [0.3, 0.018, 0.3]], 0.02, 0.008), M.bolt, 0, 0, 0, holder);
    for (const s of [-1, 1]) add(slab(0.03, 0.5, -0.11, 0.07, 0.01, 0.006), M.dark, s * 0.555, 0, 0);   // TPU side armour
  } else if (def.id === 'vert150') {
    add(prism([[-0.37, -0.45], [0.37, -0.45], [0.37, 0.2], [0.3, 0.29], [-0.3, 0.29], [-0.37, 0.2]], -0.12, 0.08, 0.02), printMat);
    lid(0.6, 0.56, 0.08, -0.1, -1);
    if (def.wedge === 'klin') {
      // two steel wedgelets either side of the blade slot
      const len = Math.hypot(0.4, 0.33), ang = Math.atan2(0.33, 0.4);
      const k = new THREE.Group();
      for (const sx of [-1, 1]) { const w = add(slab(0.36, len, -0.015, 0.015, 0.02, 0.006), M.steel, sx * 0.31, -0.08, 0.5, k); w.rotation.x = ang; }
      g.add(k);
      parts.extras = [k];      // kept when a GLB replaces the placeholder (the model has forks only)
    } else if (def.wedge !== 'bez') {
      for (const s of [-1, 1]) add(profile([[0.2, 0.06], [0.62, -0.25], [0.6, -0.27], [0.2, -0.12]], 0.07, 0.01), printMat, s * 0.13, 0, 0);
    }
    const axle = new THREE.Group(); axle.position.fromArray(def.spinner.axle); g.add(axle);
    const blade = new THREE.Group(); axle.add(blade);
    // vertical bar with two hooked teeth (profile in the blade plane, extruded across x)
    add(profile([[-0.055, -0.28], [0.055, -0.22], [0.055, 0.28], [-0.055, 0.22]], 0.075, 0.008), M.steel, 0, 0, 0, blade);
    for (const s of [-1, 1]) add(slab(0.08, 0.16, -0.045, 0.045, 0.01, 0.006), M.steel, 0, s * 0.24, s * 0.03, blade);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 18).rotateZ(Math.PI / 2), M.dark, 0, 0, 0, axle);
    add(boltsGeometry([[0.1, 0, 0], [-0.1, 0, 0]].map(([x]) => [x, 0, 0]), 0.03, 0.015, 'x'), M.bolt, 0, 0, 0, axle);
    parts.blade = blade; parts.bladeAxis = 'x'; parts.blur = blurDisc(0.29, 'x', axle);
  } else if (def.id === 'kosa') {
    // low flat hull with a sloped nose, side pods, weapon boom with an outrunner bell and a bar blade
    add(profile([[-0.46, -0.12], [0.3, -0.12], [0.33, 0.015], [0.12, 0.12], [-0.46, 0.12]], 0.68, 0.025), printMat);
    for (const s of [-1, 1]) {
      add(prism([[0.34, 0.07], [0.5, 0.09], [0.5, 0.24], [0.44, 0.31], [0.34, 0.31]].map(([x, z]) => [s * x, z]), -0.12, 0.07, 0.014), printMat);
      add(slab(0.16, 0.064, -0.12, 0.07, 0.012, 0.01), printMat, s * 0.42, 0, -0.458);
    }
    lid(0.54, 0.5, 0.143, -0.14);
    const ax = def.spinner.axle;
    add(slab(0.32, 0.36, 0.01, 0.07, 0.15, 0.012), printMat, 0, 0, ax[2] - 0.02);
    add(boltsGeometry([[0.075, 0.07, ax[2] + 0.075], [-0.075, 0.07, ax[2] + 0.075], [0.075, 0.07, ax[2] - 0.075], [-0.075, 0.07, ax[2] - 0.075]], 0.02, 0.01), M.bolt);
    const axle = new THREE.Group(); axle.position.fromArray(ax); g.add(axle);
    const blade = new THREE.Group(); axle.add(blade);
    add(new THREE.CylinderGeometry(0.135, 0.135, 0.136, 28), M.dark, 0, 0.09, 0, blade);       // outrunner bell
    const L = def.spinner.radius;
    add(prism([[-L + 0.03, -0.065], [-0.14, -0.09], [0.14, -0.09], [L - 0.01, -0.065], [L, 0.045], [L - 0.03, 0.065], [0.14, 0.09], [-0.14, 0.09], [-L + 0.01, 0.065], [-L, -0.045]], -0.02, 0.02, 0.006), M.steel, 0, 0, 0, blade);
    for (const s of [-1, 1]) add(slab(0.09, 0.065, -0.036, 0.036, 0.01, 0.006), M.bolt, s * (L - 0.065), 0, -s * 0.05, blade);  // impactors
    parts.blade = blade; parts.bladeAxis = 'y'; parts.blur = blurDisc(def.spinner.radius, 'y', axle);
  } else if (def.id === 'klepeto') {
    add(prism([[-0.36, -0.48], [0.36, -0.48], [0.36, 0.26], [0.3, 0.32], [-0.3, 0.32], [-0.36, 0.26]], -0.15, 0.17, 0.025), printMat);
    for (const s of [-1, 1]) add(slab(0.15, 0.065, -0.13, 0.09, 0.012, 0.01), printMat, s * 0.425, 0, -0.055);   // armour between the wheels
    lid(0.58, 0.54, 0.17, -0.16, -1);
    const pivot = armPivot();
    // two printed arms + steel scoop and tines, from the hinge down to the tips
    const tip = new THREE.Vector3(0, -0.355, 0.62), len = tip.length(), ang = Math.atan2(-tip.y, tip.z);
    const holder = new THREE.Group(); holder.rotation.x = ang; pivot.add(holder);
    for (const s of [-1, 1]) {
      add(profile([[-0.05, -0.05], [0.06, -0.062], [len - 0.12, -0.026], [len - 0.06, -0.01], [len - 0.14, 0.026], [0.22, 0.075], [-0.05, 0.04]], 0.06, 0.008), printMat, s * 0.25, 0, 0, holder);
      add(slab(0.08, len - 0.26, -0.026, 0.006, 0.01, 0.004), M.steel, s * 0.25, 0, 0.13 + (len - 0.26) / 2, holder);
    }
    add(slab(0.8, len - 0.3, -0.026, -0.01, 0.02, 0.004), M.steel, 0, 0, 0.3 + (len - 0.3) / 2, holder);
    add(slab(0.46, 0.07, -0.025, 0.055, 0.02, 0.01), printMat, 0, 0, 0.16, holder);
    // claw: rides on a mast above the hinge, closes onto the opponent while holding
    for (const s of [-1, 1]) add(profile([[-0.05, -0.02], [0.05, -0.04], [0.07, 0.14], [-0.04, 0.2]], 0.04, 0.006), printMat, s * 0.19, 0, 0, pivot);
    add(slab(0.22, 0.23, 0.1, 0.22, 0.01, 0.006), M.servo, -0.05, 0, -0.035, pivot);
    const jaw = new THREE.Group(); jaw.position.set(0, 0.16, 0.02); pivot.add(jaw);
    for (const s of [-1, 1]) add(profile([[-0.05, -0.035], [0.44, -0.025], [0.56, -0.06], [0.62, -0.14], [0.58, -0.16], [0.44, -0.065], [0.4, 0.035], [-0.05, 0.04]], 0.04, 0.006), printMat, s * 0.235, 0, 0, jaw);
    add(slab(0.51, 0.07, -0.03, 0.03, 0.015, 0.008), printMat, 0, 0, 0.4, jaw);
    const teeth = [];
    for (let i = 0; i < 5; i++) { const t = profile([[0.435, -0.032], [0.49, -0.032], [0.465, -0.125]], 0.032, 0.004); t.translate(-0.18 + i * 0.09, 0, 0); teeth.push(t); }
    add(mergeGeometries(teeth), M.steel, 0, 0, 0, jaw);
    parts.jaw = jaw; parts.jawOpen = -0.42; jaw.rotation.x = -0.42;
  } else {
    // generic printed hull for robots without a dedicated look
    const h = def.chassis.half, o = def.chassis.offset;
    add(prism([[-h[0] * 0.8, -h[2]], [h[0] * 0.8, -h[2]], [h[0] * 0.8, h[2] * 0.75], [h[0] * 0.6, h[2]], [-h[0] * 0.6, h[2]], [-h[0] * 0.8, h[2] * 0.75]].map(([x, z]) => [x, z + o[2]]), o[1] - h[1], o[1] + h[1], 0.02), printMat);
    lid(h[0] * 1.2, h[2] * 1.3, o[1] + h[1], o[2] - h[2] * 0.15);
  }
  return { group: g, parts };
}

// a loose wheel for debris (fresh geometry, disposed with the debris)
export function wheelDebrisMesh(def, printMat) {
  const M = mats();
  const w = new THREE.Group(), wW = Math.min(0.13, def.wheelR * 0.6);
  const t = new THREE.Mesh(tyreGeometry(def.wheelR, wW), M.ink); t.castShadow = true; w.add(t);
  w.add(new THREE.Mesh(hubGeometry(def.wheelR, wW), printMat));
  return w;
}
