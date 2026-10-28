// Shared building blocks for arena maps: canvas textures, merged floor / wall geometry,
// static colliders, cheap instanced audience, debris. 1 unit = 10 cm, floor top at y = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const BASE_Y = -2.5;       // floor outside the arena / pit bottom
export const WALL_H = 1.2;
export const WALL_T = 0.16;
export const GRIP_FRICTION = 0.8; // collider friction that means "normal grip" (gripAt = friction / 0.8)

export const ORANGE = '#FF5A00';
export const INK = '#0E0E0E';

// ---------------------------------------------------------------- small helpers
export const rect = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
export const inRect = (r, x, z, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
export const yawTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- textures (one canvas each, shared)
// floor tile: 1 texture repeat = 2 units (20 cm), like the CCRL-style painted grid
export function gridTexture({ base = '#E9E9E5', line = '#D2D2CC', sub = '#DEDED9', size = 256, noise = 0 } = {}) {
  const [c, g] = canvas(size, size);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  if (noise) speckle(g, size, size, noise);
  g.strokeStyle = line; g.lineWidth = 2; g.strokeRect(0, 0, size, size);
  g.strokeStyle = sub; g.lineWidth = 1;
  g.beginPath(); g.moveTo(size / 2, 0); g.lineTo(size / 2, size); g.moveTo(0, size / 2); g.lineTo(size, size / 2); g.stroke();
  return tex(c);
}
function speckle(g, w, h, amt) {
  // deterministic speckle so every map load looks identical
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < w * h * 0.02 * amt; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.04 + rnd() * 0.06})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}
// worn steel tread plate
export function plateTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#7d8083'; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 3);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const cx = x * 32 + 16 + (y % 2) * 0, cy = y * 32 + 16;
    g.save(); g.translate(cx, cy); g.rotate((x + y) % 2 ? Math.PI / 4 : -Math.PI / 4);
    g.fillStyle = '#9a9da0'; g.fillRect(-11, -2.5, 22, 5);
    g.fillStyle = '#5c5f62'; g.fillRect(-11, 2, 22, 1.5);
    g.restore();
  }
  g.strokeStyle = '#4a4c4f'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  return tex(c);
}
// ice: bluish white with cracks and skate-like scratches
export function iceTexture() {
  const [c, g] = canvas(256, 256);
  const gr = g.createLinearGradient(0, 0, 256, 256);
  gr.addColorStop(0, '#E4F1F8'); gr.addColorStop(1, '#CFE3EF');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  let s = 99;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.25 + rnd() * 0.4})`; g.lineWidth = 0.6 + rnd() * 1.4;
    const x = rnd() * 256, y = rnd() * 256, a = rnd() * Math.PI, l = 20 + rnd() * 90;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rnd() * 20, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.strokeStyle = 'rgba(120,160,190,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) { let x = rnd() * 256, y = rnd() * 256; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
  g.strokeStyle = 'rgba(150,190,215,0.6)'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256);
  return tex(c);
}
export function stripeTexture(a = INK, b = '#E8461E') {
  const [c, g] = canvas(64, 16);
  g.fillStyle = a; g.fillRect(0, 0, 64, 16);
  g.fillStyle = b;
  for (let i = -16; i < 64; i += 16) { g.beginPath(); g.moveTo(i, 16); g.lineTo(i + 8, 16); g.lineTo(i + 16, 0); g.lineTo(i + 8, 0); g.fill(); }
  const t = tex(c); t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
// soft radial glow (light pools, lamp halos)
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  const a = k => inner.replace(/[\d.]+\)$/, k.toFixed(3) + ')');
  for (let i = 0; i <= 8; i++) { const r = i / 8; gr.addColorStop(r, i === 8 ? outer : a(Math.pow(1 - r, 2.2))); }
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return tex(c, false);
}
// polycarbonate scuffs: mostly clear, fine scratches and a few smudges (used as alphaMap)
export function scuffTexture() {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#4a4a4a'; g.fillRect(0, 0, 256, 128);
  let s = 4242;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.1 + rnd() * 0.35})`; g.lineWidth = 0.5 + rnd();
    const x = rnd() * 256, y = 60 + rnd() * 68, a = (rnd() - 0.5) * 0.6, l = 6 + rnd() * 40;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const x = rnd() * 256, y = 80 + rnd() * 48, r = 6 + rnd() * 14;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // bottom edge is scuffed most (wheels, wedges)
  const gr = g.createLinearGradient(0, 128, 0, 90);
  gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 90, 256, 38);
  const t = tex(c); t.colorSpace = THREE.NoColorSpace;
  return t;
}
// text decal (logos, floor lettering); transparent background
export function textTexture(lines, { w = 1024, h = 256, color = '#fff', font = '600 150px "Inter Tight", "Helvetica Neue", Arial, sans-serif', bg = null, align = 'center' } = {}) {
  const [c, g] = canvas(w, h);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle';
  const list = Array.isArray(lines) ? lines : [lines];
  list.forEach((l, i) => {
    const f = typeof l === 'object' ? l : { text: l };
    g.font = f.font || font;
    if (f.color) g.fillStyle = f.color; else g.fillStyle = color;
    const x = align === 'center' ? w / 2 : 16;
    const y = f.y != null ? f.y * h : h * (i + 0.5) / list.length;
    if (f.spacing) {
      // manual letter spacing (canvas letterSpacing is not everywhere)
      const chars = [...f.text]; let width = 0; const ws = chars.map(ch => { const m = g.measureText(ch).width; width += m + f.spacing; return m; });
      let cx = x - (align === 'center' ? width / 2 : 0); g.textAlign = 'left';
      chars.forEach((ch, k) => { g.fillText(ch, cx, y); cx += ws[k] + f.spacing; });
      g.textAlign = align;
    } else g.fillText(f.text, x, y);
  });
  const t = tex(c, false);
  return t;
}

// ---------------------------------------------------------------- geometry helpers
// assign world-space UVs (1 repeat per `scale` units) by dominant normal; floors use x/-z
export function worldUV(geo, scale = 2, ox = 0, oz = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    let u, v;
    if (ay > 0.5) { u = (x - ox) / scale; v = -(z - oz) / scale; }
    else if (ax > 0.5) { u = z / scale; v = y / scale; }
    else { u = x / scale; v = y / scale; }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
export function boxGeo(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
// horizontal quad at height y with world UVs
export function quadGeo(x0, x1, z0, z1, y = 0, scale = 2) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return worldUV(g, scale);
}
export function merge(list) {
  const flat = list.map(g => (g.index ? g.toNonIndexed() : g));
  // all inputs must carry the same attributes
  const keys = Object.keys(flat[0].attributes);
  for (const g of flat) for (const k of Object.keys(g.attributes)) if (!keys.includes(k)) g.deleteAttribute(k);
  const m = mergeGeometries(flat, false);
  list.forEach(g => g.dispose()); flat.forEach(g => g.dispose());
  return m;
}
export function mesh(geo, mat, { cast = false, receive = true, order } = {}) {
  const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive;
  if (order != null) m.renderOrder = order;
  return m;
}

// ---------------------------------------------------------------- materials (per-map instance)
export function polycarbonate(tint = '#dfe8ee', opacity = 0.2) {
  const scuff = scuffTexture();
  return new THREE.MeshStandardMaterial({
    color: tint, transparent: true, opacity: Math.min(1, opacity * 2.2), alphaMap: scuff,
    roughness: 0.08, metalness: 0, envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide
  });
}

// ---------------------------------------------------------------- floor + walls (visual)
// floor: [{x0,x1,z0,z1, surf}] - tops grouped by surface material, sides merged in one dark mesh
export function buildFloor(group, rects, surfaces, sideColor = '#2A2A2A') {
  const bySurf = {};
  const sides = [];
  for (const r of rects) {
    (bySurf[r.surf || 'floor'] ||= []).push(quadGeo(r.x0, r.x1, r.z0, r.z1, 0, surfaces[r.surf || 'floor'].scale || 2));
    sides.push(boxGeo(r.x0, r.x1, BASE_Y, -0.001, r.z0, r.z1));
  }
  for (const k in bySurf) group.add(mesh(merge(bySurf[k]), surfaces[k].mat));
  const sideMat = new THREE.MeshLambertMaterial({ color: sideColor });
  group.add(mesh(merge(sides), sideMat));
  return sideMat;
}
// walls: polycarbonate panes above the floor, dark lining below, black top rail with bolts,
// aluminium corner posts; ~5 draw calls for any number of wall segments
export function buildWalls(group, walls, { posts = [], glass, rail = INK, lining = '#2A2A2A', bolts = true, edge = '#ffffff' } = {}) {
  const gl = [], low = [], rails = [], edges = [];
  const boltPos = [];
  for (const w of walls) {
    const g = boxGeo(w.x0, w.x1, 0, WALL_H, w.z0, w.z1);
    gl.push(worldUV(g, 4));
    edges.push(new THREE.EdgesGeometry(boxGeo(w.x0, w.x1, 0.002, WALL_H, w.z0, w.z1)));
    low.push(boxGeo(w.x0, w.x1, BASE_Y, 0, w.z0, w.z1));
    rails.push(boxGeo(w.x0 - 0.01, w.x1 + 0.01, WALL_H - 0.03, WALL_H + 0.05, w.z0 - 0.01, w.z1 + 0.01));
    if (bolts) {
      // bolts along the panel bottom and top rail, every ~1 unit, on the arena-facing side
      const along = (w.x1 - w.x0) > (w.z1 - w.z0);
      const len = along ? w.x1 - w.x0 : w.z1 - w.z0, n = Math.max(1, Math.floor(len / 1.2));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        for (const y of [0.12, WALL_H - 0.12]) {
          if (along) for (const z of [w.z0, w.z1]) boltPos.push(w.x0 + t * len, y, z, 0);
          else for (const x of [w.x0, w.x1]) boltPos.push(x, y, w.z0 + t * len, 1);
        }
      }
    }
  }
  const glassMesh = mesh(merge(gl), glass || polycarbonate(), { receive: false, order: 2 });
  group.add(glassMesh);
  const eg = mergeGeometries(edges); edges.forEach(e => e.dispose());
  const lines = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: edge, transparent: true, opacity: 0.55, depthWrite: false }));
  lines.renderOrder = 3; group.add(lines);
  group.add(mesh(merge(low), new THREE.MeshLambertMaterial({ color: lining })));
  const railMat = new THREE.MeshStandardMaterial({ color: rail, roughness: 0.55, metalness: 0.1 });
  const pg = posts.map(([x, z]) => boxGeo(x - 0.12, x + 0.12, BASE_Y, WALL_H + 0.1, z - 0.12, z + 0.12));
  group.add(mesh(merge([...rails, ...pg]), railMat, { cast: true }));
  if (bolts && boltPos.length) {
    const bg = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 6); bg.rotateX(Math.PI / 2);
    const bm = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: '#c9cbcc', metalness: 0.8, roughness: 0.3 }), boltPos.length / 4);
    const o = new THREE.Object3D();
    for (let i = 0; i < boltPos.length / 4; i++) {
      o.position.set(boltPos[i * 4], boltPos[i * 4 + 1], boltPos[i * 4 + 2]);
      o.rotation.set(0, boltPos[i * 4 + 3] ? Math.PI / 2 : 0, 0); o.updateMatrix();
      bm.setMatrixAt(i, o.matrix);
    }
    group.add(bm);
  }
  return { glass: glassMesh, rail: railMat };
}
// hazard stripes lying on the floor: [len, x, z, rotY, width?]
export function buildStripes(group, list, texture = stripeTexture()) {
  const geos = [];
  for (const [len, x, z, rotY, wd = 0.18] of list) {
    const g = new THREE.PlaneGeometry(len, wd);
    // u repeats every 0.6 units along the stripe
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 0.6);
    g.rotateX(-Math.PI / 2); g.rotateY(rotY); g.translate(x, 0.004, z);
    geos.push(g);
  }
  const m = mesh(merge(geos), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
  group.add(m);
  return m;
}
// floor decal (logo / text): flat plane slightly above the floor
export function decal(group, texture, x, z, w, h, rotY = 0, { opacity = 1, blending = THREE.NormalBlending, y = 0.003 } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, transparent: true, opacity, roughness: 0.75, depthWrite: false, blending, polygonOffset: true, polygonOffsetFactor: -1 }));
  m.rotation.set(-Math.PI / 2, 0, rotY); m.position.set(x, y, z); m.receiveShadow = true; m.renderOrder = 1;
  group.add(m); return m;
}

// ---------------------------------------------------------------- physics
export function staticBody(RAPIER, world) { return world.createRigidBody(RAPIER.RigidBodyDesc.fixed()); }
export function boxCollider(RAPIER, world, body, x0, x1, y0, y1, z0, z1, fr = GRIP_FRICTION, rest = 0.1) {
  const d = RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)
    .setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).setFriction(fr).setRestitution(rest);
  return world.createCollider(d, body);
}

// ---------------------------------------------------------------- audience (instanced, animated on the GPU)
// rows of seated silhouettes on bleachers; `excite` (0..1) makes them jump, decays in frame()
export function buildAudience(group, { rows = 3, quality = 'high', palette = ['#3a3a3a', '#4a4a46', '#5a5a55', '#2a2a2a', '#E8461E', '#1F3BFF'], bench = '#1c1c1c', sides = true, far = -19, side = 19, y0 = BASE_Y - 1.5, scale = 1, bg = '#EEEEEB', fade = 0.45 } = {}) {
  const spots = [];
  let s = 777;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const step = quality === 'low' ? 3.6 : 2.6;
  const benches = [];
  if (quality === 'low') rows = Math.min(rows, 2);
  for (let r = 0; r < rows; r++) {
    const z = far - r * 3, y = y0 + r * 2;
    benches.push(boxGeo(-side - 12, side + 12, y - 2, y, z - 1.5, z + 1.5));
    for (let x = -side - 10; x <= side + 10; x += step) if (rnd() > 0.12) spots.push([x + (rnd() - 0.5) * 0.8, y, z + (rnd() - 0.5) * 0.4, 0]);
    if (sides) for (const sx of [-1, 1]) {
      const xx = sx * (side + r * 3);
      benches.push(boxGeo(xx - 1.5, xx + 1.5, y - 2, y, far + 1.5, 2));
      for (let z = far + 2.5; z <= 1; z += step) if (rnd() > 0.15) spots.push([xx + (rnd() - 0.5) * 0.4, y, z + (rnd() - 0.5) * 0.8, sx]);
    }
  }
  group.add(mesh(merge(benches), new THREE.MeshLambertMaterial({ color: bench })));
  const body = new THREE.CapsuleGeometry(1.05 * scale, 2.2 * scale, 2, 8); body.translate(0, 2.1 * scale, 0);
  const head = new THREE.SphereGeometry(0.75 * scale, 8, 6); head.translate(0, 4.6 * scale, 0);
  const person = mergeGeometries([body.toNonIndexed(), head.toNonIndexed()]); body.dispose(); head.dispose();
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const uni = { uTime: { value: 0 }, uExcite: { value: 0 } };
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uni.uTime; sh.uniforms.uExcite = uni.uExcite;
    sh.vertexShader = 'uniform float uTime; uniform float uExcite;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float ph = instanceMatrix[3].x * 1.37 + instanceMatrix[3].z * 0.71;
      float bob = sin(uTime * (1.3 + fract(ph) * 0.8) + ph * 6.0) * 0.12;
      float jump = max(0.0, sin(uTime * (9.0 + fract(ph * 3.1) * 4.0) + ph * 11.0)) * uExcite * 1.6;
      transformed.y += (bob + jump) * smoothstep(0.0, 1.5, position.y);`);
  };
  const im = new THREE.InstancedMesh(person, mat, spots.length);
  const o = new THREE.Object3D(), col = new THREE.Color(), bgc = new THREE.Color(bg);
  spots.forEach(([x, y, z, sx], i) => {
    o.position.set(x, y, z); o.rotation.set(0, sx ? -sx * Math.PI / 2 : 0, 0);
    const k = 0.9 + rnd() * 0.25; o.scale.set(k, k, k); o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
    im.setColorAt(i, col.set(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.7 + rnd() * 0.3).lerp(bgc, fade));
  });
  im.frustumCulled = false;
  group.add(im);
  let ex = 0;
  return {
    mesh: im,
    excite(a) { ex = Math.min(1, Math.max(ex, a)); },
    frame(dt) { uni.uTime.value += dt; ex = Math.max(0, ex - dt * 0.6); uni.uExcite.value = ex; }
  };
}

// ---------------------------------------------------------------- debris (small dynamic bodies, one instanced mesh)
// pieces: [{x, z, size:[hx,hy,hz], color}] ; synced to the instanced mesh in frame()
export function makeDebris(group, pieces, { density = 0.6, friction = 0.6, roughness = 0.6, metalness = 0 } = {}) {
  const geo = new THREE.BoxGeometry(2, 2, 2);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness, metalness }), pieces.length);
  im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
  const col = new THREE.Color();
  pieces.forEach((p, i) => im.setColorAt(i, col.set(p.color || '#cccccc')));
  group.add(im);
  const bodies = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const place = (i, p) => {
    m.compose(v.set(p.x, p.y ?? p.size[1], p.z), q.setFromAxisAngle(UP, p.yaw || 0), sc.set(...p.size));
    im.setMatrixAt(i, m);
  };
  pieces.forEach((p, i) => place(i, p));
  return {
    mesh: im,
    attach(RAPIER, world) {
      for (const p of pieces) {
        const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.3).setAngularDamping(0.5).setCanSleep(true));
        world.createCollider(RAPIER.ColliderDesc.cuboid(...p.size).setDensity(p.density ?? density).setFriction(p.friction ?? friction).setRestitution(0.2), b);
        bodies.push(b);
      }
      this.reset();
    },
    reset() {
      pieces.forEach((p, i) => {
        const b = bodies[i]; if (!b) return;
        q.setFromAxisAngle(UP, p.yaw || 0);
        b.setTranslation({ x: p.x, y: (p.y ?? p.size[1]) + 0.01, z: p.z }, true);
        b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
        b.sleep();
      });
      pieces.forEach((p, i) => place(i, p)); im.instanceMatrix.needsUpdate = true;
    },
    frame() {
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.isSleeping()) continue;
        const t = b.translation(), r = b.rotation();
        // fell out of the world: park it in the pit bottom
        if (t.y < BASE_Y - 3) { b.setTranslation({ x: t.x, y: BASE_Y + 0.5, z: t.z }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); }
        m.compose(v.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w), sc.set(...pieces[i].size));
        im.setMatrixAt(i, m);
      }
      im.instanceMatrix.needsUpdate = true;
    },
    bodies
  };
}

// blinking warning lamp material helper: returns a material whose emissive is driven by setLevel(0..1)
export function lampMaterial(color = ORANGE) {
  const m = new THREE.MeshStandardMaterial({ color: '#2a1208', emissive: color, emissiveIntensity: 0.15, roughness: 0.4 });
  m.setLevel = l => { m.emissiveIntensity = 0.15 + l * 2.6; };
  return m;
}

export function disposeGroup(group) {
  const seen = new Set();
  group.traverse(o => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (seen.has(m)) continue; seen.add(m);
      for (const k of ['map', 'alphaMap', 'emissiveMap', 'roughnessMap']) if (m[k] && !seen.has(m[k])) { seen.add(m[k]); m[k].dispose(); }
      m.dispose();
    }
  });
  group.removeFromParent();
}

// ---------------------------------------------------------------- floor layout
// Split the area `b` into rectangles, leaving out `holes` and tagging each piece with the
// surface of the zone that contains it ([{x0,x1,z0,z1, surf}], later zones win).
export function floorRects(b, holes = [], zones = []) {
  const xs = new Set([b.x0, b.x1]), zs = new Set([b.z0, b.z1]);
  for (const r of [...holes, ...zones]) { xs.add(r.x0); xs.add(r.x1); zs.add(r.z0); zs.add(r.z1); }
  const X = [...xs].filter(x => x >= b.x0 && x <= b.x1).sort((a, c) => a - c);
  const Z = [...zs].filter(z => z >= b.z0 && z <= b.z1).sort((a, c) => a - c);
  const out = [];
  for (let j = 0; j < Z.length - 1; j++) {
    let run = null;
    for (let i = 0; i < X.length - 1; i++) {
      const cx = (X[i] + X[i + 1]) / 2, cz = (Z[j] + Z[j + 1]) / 2;
      const hole = holes.some(h => inRect(h, cx, cz));
      let surf = 'floor';
      for (const zn of zones) if (inRect(zn, cx, cz)) surf = zn.surf;
      if (!hole && run && run.surf === surf) { run.x1 = X[i + 1]; continue; }
      if (run) out.push(run);
      run = hole ? null : { x0: X[i], x1: X[i + 1], z0: Z[j], z1: Z[j + 1], surf };
    }
    if (run) out.push(run);
  }
  // merge identical rows vertically
  const merged = [];
  for (const r of out) {
    const m = merged.find(o => o.x0 === r.x0 && o.x1 === r.x1 && o.surf === r.surf && o.z1 === r.z0);
    if (m) m.z1 = r.z1; else merged.push({ ...r });
  }
  return merged;
}
// four walls around [-h, h]² with optional gaps: gaps = [{side:'n'|'s'|'e'|'w', a0, a1}]
export function boxWalls(h, gaps = [], t = WALL_T) {
  const sides = {
    n: (a0, a1) => ({ x0: a0, x1: a1, z0: -h - t, z1: -h }),
    s: (a0, a1) => ({ x0: a0, x1: a1, z0: h, z1: h + t }),
    w: (a0, a1) => ({ x0: -h - t, x1: -h, z0: a0, z1: a1 }),
    e: (a0, a1) => ({ x0: h, x1: h + t, z0: a0, z1: a1 })
  };
  const out = [];
  for (const s of ['n', 's', 'w', 'e']) {
    // n/s walls span the corners; e/w fit between them
    let segs = s === 'n' || s === 's' ? [[-h - t, h + t]] : [[-h, h]];
    for (const g of gaps.filter(g => g.side === s)) {
      segs = segs.flatMap(([a, b]) => (g.a1 <= a || g.a0 >= b) ? [[a, b]] : [[a, g.a0], [g.a1, b]].filter(([p, q]) => q - p > 0.01));
    }
    for (const [a, b] of segs) out.push(sides[s](a, b));
  }
  return out;
}
export function cornerPosts(h, t = WALL_T) { const o = h + t / 2; return [[-o, -o], [o, -o], [-o, o], [o, o]]; }
