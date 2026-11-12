// Software renderer for the SIL runner's virtual cameras — printedrobotics.cz.
//
// Draws the MuJoCo scene of the virtual SO-101 (arm meshes, table, cube, bowl) into an RGB buffer
// with a plain z-buffer triangle rasterizer: flat-shaded, no textures, no shadows. Pure JavaScript,
// no GPU, no OpenGL, so it runs the same in CI, in a container and on a laptop. The MuJoCo WASM
// build has no renderer of its own (mjr_* is not compiled in), hence this.
//
// It is deliberately simple. The pictures are good enough for a camera pipeline test and for
// "does the policy react to what it sees", not for training a vision policy: a real camera sees
// texture, shadows, glare, cables and a different table.
//
//   const scene = extractScene(m);                        // once: static geometry (structured-clonable)
//   const poses = geomPoses(m, d);                        // every frame: geom positions + rotations
//   renderView(scene, poses, cameraPose, { width, height, fovy }, rgb, zbuf);

export const GEOM = { PLANE: 0, SPHERE: 2, CAPSULE: 3, ELLIPSOID: 4, CYLINDER: 5, BOX: 6, MESH: 7 };

// ---------- primitive meshes (unit size; scaled per geom) ----------
function boxMesh([sx, sy, sz]) {
  const v = [];
  for (const x of [-sx, sx]) for (const y of [-sy, sy]) for (const z of [-sz, sz]) v.push(x, y, z);
  // vertex index = 4*ix + 2*iy + iz
  const f = [0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5];
  return { verts: v, tris: f };
}
function sphereMesh([rx, ry, rz], seg = 14, rings = 8, zOff = 0, zCap = 0) {
  const v = [], f = [];
  for (let i = 0; i <= rings; i++) {
    const th = Math.PI * i / rings, s = Math.sin(th), c = Math.cos(th);
    for (let j = 0; j < seg; j++) {
      const ph = 2 * Math.PI * j / seg;
      const z = rz * c;
      v.push(rx * s * Math.cos(ph), ry * s * Math.sin(ph), z + (zCap ? (z >= 0 ? zOff : -zOff) : zOff));
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = a + seg, d = b + seg;
    f.push(a, c, d, a, d, b);
  }
  return { verts: v, tris: f };
}
function cylinderMesh(r, h, seg = 18) {
  const v = [0, 0, h, 0, 0, -h], f = [];
  for (let j = 0; j < seg; j++) { const ph = 2 * Math.PI * j / seg; v.push(r * Math.cos(ph), r * Math.sin(ph), h, r * Math.cos(ph), r * Math.sin(ph), -h); }
  for (let j = 0; j < seg; j++) {
    const a = 2 + 2 * j, b = 2 + 2 * ((j + 1) % seg);
    f.push(0, a, b, 1, b + 1, a + 1, a, a + 1, b + 1, a, b + 1, b);
  }
  return { verts: v, tris: f };
}
function primitiveMesh(type, size) {
  switch (type) {
    case GEOM.BOX: return boxMesh(size);
    case GEOM.SPHERE: return sphereMesh([size[0], size[0], size[0]]);
    case GEOM.ELLIPSOID: return sphereMesh(size);
    case GEOM.CYLINDER: return cylinderMesh(size[0], size[1]);
    case GEOM.CAPSULE: return sphereMesh([size[0], size[0], size[0]], 14, 8, size[1], 1);   // hemispheres pushed apart
    default: return null;
  }
}

/**
 * Pull the drawable geometry out of a MuJoCo model, once. Returns plain typed arrays (can be posted
 * to a worker). Drawn: visual geoms (groups 0-2) and, from group 3, free or mocap objects that are
 * not part of the robot (cube_b, ball, bowls, goal: the browser sim draws those itself too). Planes
 * are skipped (the floor is under the table, out of sight).
 * opts.bodies: extra body ids whose group-3 geoms are drawn too (the conveyor's belt frame and slats);
 * opts.colors: Map body id -> [r, g, b] (0-255) for bodies whose geoms have no colour of their own (library
 * items: their MJCF carries collision hulls only, the browser draws textured GLBs instead).
 */
export function extractScene(m, { bodies = null, colors = null } = {}) {
  const geoms = [];
  for (let g = 0; g < m.ngeom; g++) {
    const type = m.geom_type[g], group = m.geom_group[g], body = m.geom_bodyid[g];
    if (type === GEOM.PLANE) continue;
    if (group > 3) continue;
    if (group === 3 && !(bodies && bodies.has(body))) {
      // free or mocap top-level bodies only (scene objects), never the arm's collision shapes
      const top = m.body_parentid[body] === 0;
      const free = m.body_jntnum[body] === 1 && m.jnt_type[m.body_jntadr[body]] === 0;
      if (!top || !(free || m.body_mocapid[body] >= 0)) continue;
    }
    let verts, tris;
    if (type === GEOM.MESH) {
      const id = m.geom_dataid[g], va = m.mesh_vertadr[id], vn = m.mesh_vertnum[id], fa = m.mesh_faceadr[id], fn = m.mesh_facenum[id];
      verts = Float32Array.from(m.mesh_vert.subarray(3 * va, 3 * (va + vn)));
      tris = Uint32Array.from(m.mesh_face.subarray(3 * fa, 3 * (fa + fn)));
    } else {
      const p = primitiveMesh(type, Array.from(m.geom_size.subarray(3 * g, 3 * g + 3)));
      if (!p) continue;
      verts = Float32Array.from(p.verts); tris = Uint32Array.from(p.tris);
    }
    const mat = m.geom_matid[g];
    const src = mat >= 0 ? m.mat_rgba.subarray(4 * mat, 4 * mat + 4) : m.geom_rgba.subarray(4 * g, 4 * g + 4);
    const rgb = colors && colors.has(body) ? colors.get(body).slice() : [src[0], src[1], src[2]].map((c) => Math.round(255 * c));
    // per-face unit normals in the geom frame
    const nrm = new Float32Array(tris.length);
    for (let t = 0; t < tris.length; t += 3) {
      const a = 3 * tris[t], b = 3 * tris[t + 1], c = 3 * tris[t + 2];
      const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
      const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[t] = nx / l; nrm[t + 1] = ny / l; nrm[t + 2] = nz / l;
    }
    geoms.push({ id: g, verts, tris, nrm, rgb });
  }
  return { ngeom: m.ngeom, geoms };
}

/** Current world poses of all geoms (copies, so they can be posted to a worker). hide: geom ids not to draw
 *  this frame (moved far below the floor: the conveyor's slats that have turned down around the head drum). */
export function geomPoses(m, d, hide = null) {
  const xpos = Float64Array.from(d.geom_xpos);
  if (hide) for (const g of hide) xpos[3 * g + 2] = -1e3;
  return { xpos, xmat: Float64Array.from(d.geom_xmat) };
}

/**
 * Camera pose with MuJoCo's convention: `mat` is the row-major 3x3 rotation whose columns are the
 * camera's x (right), y (up) and z (backwards) axes in world coordinates; the camera looks along -z.
 */
export function lookAt(pos, target, up = [0, 0, 1]) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const z = norm(sub(pos, target));                       // backwards
  let x = cross(up, z);
  if (Math.hypot(...x) < 1e-9) x = cross([0, 1, 0], z);   // looking straight along `up`
  x = norm(x);
  const y = cross(z, x);
  return { pos: pos.slice(), mat: [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]] };
}

/**
 * Render one view into `rgb` (Uint8Array, width*height*3, RGB order) using `zbuf`
 * (Float32Array, width*height) as scratch. Returns the number of triangles drawn.
 */
export function renderView(scene, poses, cam, { width: W, height: H, fovy = 60, near = 0.005, background = [214, 218, 222], floorZ = -0.05 }, rgb, zbuf) {
  // background: a soft vertical gradient (wall behind the table)
  for (let y = 0; y < H; y++) {
    const k = 1 - 0.18 * y / H;
    const r = background[0] * k, g = background[1] * k, b = background[2] * k;
    for (let x = 0, i = 3 * y * W; x < W; x++, i += 3) { rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b; }
  }
  zbuf.fill(0);                                            // stores 1/depth; 0 = infinitely far
  const f = (H / 2) / Math.tan(fovy * Math.PI / 360), cx = W / 2, cy = H / 2;
  const C = cam.mat, cp = cam.pos;
  // light: key light from above-front, plus a headlight along the view direction
  const L = [0.3, -0.4, 0.87], V = [C[2], C[5], C[8]];
  let drawn = 0;
  let sx = new Float32Array(0), sy = sx, iz = sx;
  for (const g of scene.geoms) {
    const id = g.id, P = poses.xpos, R = poses.xmat;
    const px = P[3 * id], py = P[3 * id + 1], pz = P[3 * id + 2];
    if (pz < floorZ) continue;                             // parked under the table
    const r = R.subarray(9 * id, 9 * id + 9);
    // M = C^T R (geom frame -> camera frame), t = C^T (p - cam)
    const M = new Float64Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[3 * i + j] = C[i] * r[j] + C[3 + i] * r[3 + j] + C[6 + i] * r[6 + j];
    const dx = px - cp[0], dy = py - cp[1], dz = pz - cp[2];
    const tx = C[0] * dx + C[3] * dy + C[6] * dz, ty = C[1] * dx + C[4] * dy + C[7] * dz, tz = C[2] * dx + C[5] * dy + C[8] * dz;
    const v = g.verts, n = v.length / 3;
    if (sx.length < n) { sx = new Float32Array(n); sy = new Float32Array(n); iz = new Float32Array(n); }
    let anyIn = false;
    for (let k = 0, o = 0; k < n; k++, o += 3) {
      const x = v[o], y = v[o + 1], z = v[o + 2];
      const X = M[0] * x + M[1] * y + M[2] * z + tx, Y = M[3] * x + M[4] * y + M[5] * z + ty, Z = M[6] * x + M[7] * y + M[8] * z + tz;
      const depth = -Z;
      if (depth < near) { iz[k] = -1; continue; }
      const inv = 1 / depth;
      sx[k] = cx + f * X * inv; sy[k] = cy - f * Y * inv; iz[k] = inv;
      anyIn = true;
    }
    if (!anyIn) continue;
    const t = g.tris, nr = g.nrm, [cr, cg, cb] = g.rgb;
    for (let q = 0; q < t.length; q += 3) {
      const a = t[q], b = t[q + 1], c = t[q + 2];
      const za = iz[a], zb = iz[b], zc = iz[c];
      if (za < 0 || zb < 0 || zc < 0) continue;            // crosses the near plane: dropped
      const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], qx = sx[c], qy = sy[c];
      let minX = Math.floor(Math.min(ax, bx, qx)), maxX = Math.ceil(Math.max(ax, bx, qx));
      let minY = Math.floor(Math.min(ay, by, qy)), maxY = Math.ceil(Math.max(ay, by, qy));
      if (maxX < 0 || maxY < 0 || minX >= W || minY >= H) continue;
      const area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      if (area === 0) continue;
      if (minX < 0) minX = 0; if (minY < 0) minY = 0; if (maxX > W - 1) maxX = W - 1; if (maxY > H - 1) maxY = H - 1;
      // flat shading: world normal = R n
      const n0 = nr[q], n1 = nr[q + 1], n2 = nr[q + 2];
      const wx = r[0] * n0 + r[1] * n1 + r[2] * n2, wy = r[3] * n0 + r[4] * n1 + r[5] * n2, wz = r[6] * n0 + r[7] * n1 + r[8] * n2;
      const s = 0.32 + 0.5 * Math.abs(wx * L[0] + wy * L[1] + wz * L[2]) + 0.25 * Math.abs(wx * V[0] + wy * V[1] + wz * V[2]);
      const R8 = Math.min(255, cr * s), G8 = Math.min(255, cg * s), B8 = Math.min(255, cb * s);
      const ia = 1 / area;
      let hit = false;
      for (let y = minY; y <= maxY; y++) {
        const py0 = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
          const px0 = x + 0.5;
          const w0 = ((bx - px0) * (qy - py0) - (by - py0) * (qx - px0)) * ia;
          if (w0 < 0) continue;
          const w1 = ((qx - px0) * (ay - py0) - (qy - py0) * (ax - px0)) * ia;
          if (w1 < 0) continue;
          const w2 = 1 - w0 - w1;
          if (w2 < 0) continue;
          const z = w0 * za + w1 * zb + w2 * zc;
          const pi = y * W + x;
          if (z <= zbuf[pi]) continue;
          zbuf[pi] = z;
          const o = 3 * pi;
          rgb[o] = R8; rgb[o + 1] = G8; rgb[o + 2] = B8;
          hit = true;
        }
      }
      if (hit) drawn++;
    }
  }
  return drawn;
}
