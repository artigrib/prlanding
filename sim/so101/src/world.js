// Scene objects of the mission table (cubes, ball, bowls, goal): ids, poses, placement.
// DOM/three-free (used by missions, planner and node tests).
// Library objects + fixtures of the object missions (src/objects/scene.js) are registered when the compiled model
// contains them (the object scene); body origin of a library object = bottom centre of its bounding box.

import { LIB_ITEMS, FIXTURES, FIXTURE_PARK, parkSpot, labelOf, LYING_QUAT } from './objects/scene.js';

export const OBJECTS = {
  cube:   { kind: 'free', half: 0.0125, label: 'oranžová kostka', acc: 'oranžovou kostku' },
  cube_b: { kind: 'free', half: 0.0125, label: 'modrá kostka', acc: 'modrou kostku' },
  ball:   { kind: 'free', half: 0.02, label: 'míček', acc: 'míček' },
  bowl:   { kind: 'mocap', label: 'modrá miska' },
  bowl2:  { kind: 'mocap', label: 'oranžová miska' },
  goal:   { kind: 'mocap', label: 'branka' }
};

// where unused objects wait (on the hidden floor, far from the table)
const PARK = {
  cube: [1.0, 0.0, -0.7375], cube_b: [1.0, 0.5, -0.7375], ball: [1.0, -0.5, -0.73],
  bowl: [1.5, 0.0, -0.75], bowl2: [1.5, 0.3, -0.75], goal: [1.5, -0.3, -0.75]
};

export class World {
  constructor(mj, m, d) {
    this.mj = mj; this.m = m; this.d = d;
    const O = mj.mjtObj;
    this.o = {};
    for (const [name, info] of Object.entries(OBJECTS)) {
      const b = mj.mj_name2id(m, O.mjOBJ_BODY.value, name);
      const e = { name, body: b, ...info, active: false };
      if (info.kind === 'free') {
        const j = m.body_jntadr[b];
        e.qadr = m.jnt_qposadr[j]; e.vadr = m.jnt_dofadr[j];
      } else e.mocap = m.body_mocapid[b];
      this.o[name] = e;
    }
    // object-mission items (only in the object scene)
    this.lib = false;
    for (const [i, it] of LIB_ITEMS.entries()) {
      const b = mj.mj_name2id(m, O.mjOBJ_BODY.value, it.name);
      if (b < 0) continue;
      this.lib = true;
      const j = m.body_jntadr[b], [label, acc] = labelOf(it.name);
      this.o[it.name] = { name: it.name, body: b, kind: 'free', lib: it, half: 0, label, acc, active: false,
        qadr: m.jnt_qposadr[j], vadr: m.jnt_dofadr[j], park: parkSpot(i), mass: m.body_mass[b] };
      PARK[it.name] = parkSpot(i);
    }
    for (const [name, fx] of Object.entries(FIXTURES)) {
      const b = mj.mj_name2id(m, O.mjOBJ_BODY.value, name);
      if (b < 0) continue;
      this.o[name] = { name, body: b, kind: 'mocap', fixture: fx, mocap: m.body_mocapid[b], label: fx.label[0], acc: fx.label[1], active: false };
      PARK[name] = [...FIXTURE_PARK[name], -0.75];
    }
    this.p = new Float64Array(3);
  }
  /** Size (m, body frame) of a library item, set by the page / tests from the manifest (sizes()). */
  sizes(map) { for (const [n, sz] of Object.entries(map)) if (this.o[n]) this.o[n].size = sz; }
  /** Centre of mass (world) of a body. */
  com(name, out) {
    const b = this.o[name].body, x = this.d.xipos; out = out || this.p;
    out[0] = x[3 * b]; out[1] = x[3 * b + 1]; out[2] = x[3 * b + 2]; return out;
  }
  /** World-frame collision vertices of a body's mesh geoms: one flat array (x, y, z, …) per convex geom. */
  points(name) {
    const m = this.m, d = this.d, b = this.o[name].body, all = [];
    for (let g = m.body_geomadr[b], n = g + m.body_geomnum[b]; g < n; g++) {
      if (m.geom_type[g] !== 7 || m.geom_contype[g] === 0) continue;
      const out = []; all.push(out);
      const id = m.geom_dataid[g], V = m.mesh_vert, a = m.mesh_vertadr[id], k = m.mesh_vertnum[id];
      const P = d.geom_xpos, M = d.geom_xmat, p = 3 * g, r = 9 * g;
      for (let i = a; i < a + k; i++) {
        const x = V[3 * i], y = V[3 * i + 1], z = V[3 * i + 2];
        out.push(P[p] + M[r] * x + M[r + 1] * y + M[r + 2] * z, P[p + 1] + M[r + 3] * x + M[r + 4] * y + M[r + 5] * z, P[p + 2] + M[r + 6] * x + M[r + 7] * y + M[r + 8] * z);
      }
    }
    return all;
  }
  /** Unit vector of body axis k (0 x, 1 y, 2 z) in world. */
  axis(name, k, out) {
    const b = this.o[name].body, M = this.d.xmat; out = out || [0, 0, 0];
    out[0] = M[9 * b + k]; out[1] = M[9 * b + 3 + k]; out[2] = M[9 * b + 6 + k]; return out;
  }

  pos(name, out) {
    const b = this.o[name].body, x = this.d.xpos; out = out || this.p;
    out[0] = x[3 * b]; out[1] = x[3 * b + 1]; out[2] = x[3 * b + 2]; return out;
  }
  // heading (rotation about z) of a body
  yaw(name) {
    const b = this.o[name].body, q = this.d.xquat, w = q[4 * b], x = q[4 * b + 1], y = q[4 * b + 2], z = q[4 * b + 3];
    return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  }
  speed(name) {
    const e = this.o[name]; if (e.kind !== 'free') return 0;
    const v = this.d.qvel; return Math.hypot(v[e.vadr], v[e.vadr + 1], v[e.vadr + 2]);
  }

  place(name, x, y, z, yaw = 0, base = 0) {
    const e = this.o[name];
    if (e.kind === 'free') {
      const q = this.d.qpos, a = e.qadr;
      let qw = Math.cos(yaw / 2), qx = 0, qy = 0, qz = Math.sin(yaw / 2);
      if (e.lib && e.lib.lying) {   // yaw ∘ lying
        const [bw, bx, by, bz] = LYING_QUAT;
        [qw, qx, qy, qz] = [qw * bw - qz * bz, qw * bx - qz * by, qw * by + qz * bx, qw * bz + qz * bw];
      }
      if (z == null) z = e.lib ? base + restZ(e, [qw, qx, qy, qz]) : e.half;
      q[a] = x; q[a + 1] = y; q[a + 2] = z;
      q[a + 3] = qw; q[a + 4] = qx; q[a + 5] = qy; q[a + 6] = qz;
      const v = this.d.qvel; for (let i = 0; i < 6; i++) v[e.vadr + i] = 0;
    } else {
      const mp = this.d.mocap_pos, mq = this.d.mocap_quat, i = e.mocap;
      mp[3 * i] = x; mp[3 * i + 1] = y; mp[3 * i + 2] = z || 0;
      mq[4 * i] = Math.cos(yaw / 2); mq[4 * i + 1] = 0; mq[4 * i + 2] = 0; mq[4 * i + 3] = Math.sin(yaw / 2);
    }
  }
  park(name) {
    const p = PARK[name]; if (!p) return; const e = this.o[name];
    if (e.lib) { this.place(name, p[0], p[1], null, 0, -0.75); this.sleep(e, true); } else this.place(name, p[0], p[1], p[2]);
    e.active = false; this.activeList = null;
  }
  /** Parked library objects: no contacts and no gravity (the object scene steps ~4x faster on phones). */
  sleep(e, on) {
    const m = this.m;
    if (!e.geoms) {
      e.geoms = [];
      for (let g = m.body_geomadr[e.body], n = g + m.body_geomnum[e.body]; g < n; g++) e.geoms.push([g, m.geom_contype[g], m.geom_conaffinity[g]]);
    }
    for (const [g, ct, ca] of e.geoms) { m.geom_contype[g] = on ? 0 : ct; m.geom_conaffinity[g] = on ? 0 : ca; }
    if (m.body_gravcomp) m.body_gravcomp[e.body] = on ? 1 : 0;
  }

  /** Set up a layout: { cube: [x, y, yaw?], bowl: [x, y, yaw?], ... }; everything else is parked. */
  layout(spec) {
    for (const name of Object.keys(this.o)) {
      const s = spec[name];
      if (s) { if (this.o[name].lib) this.sleep(this.o[name], false); this.place(name, s[0], s[1], null, s[2] || 0); this.o[name].active = true; }
      else this.park(name);
    }
    this.activeList = Object.values(this.o).filter((e) => e.active);
    this.mj.mj_forward(this.m, this.d);
    for (const e of this.activeList) if (e.lib) e.restZ = this.d.xipos[3 * e.body + 2];
  }

  /** Objects that fell off the table go back to their layout spot. Returns the name or null. */
  rescue(spec) {
    for (const name of Object.keys(spec)) {
      const e = this.o[name]; if (e.kind !== 'free') continue;
      if (this.d.xpos[3 * e.body + 2] < -0.1) {
        const s = spec[name]; this.place(name, s[0], s[1], null, s[2] || 0);
        this.mj.mj_forward(this.m, this.d);
        return name;
      }
    }
    return null;
  }

  active() { return this.activeList || (this.activeList = Object.values(this.o).filter((e) => e.active)); }
}

// height of the body origin so the lowest corner of the (rotated) bounding box rests 1 mm above the table
function restZ(e, [w, x, y, z]) {
  const s = e.size; if (!s) return 0.003;
  // third row of the rotation matrix (world z of each body axis)
  const r0 = 2 * (x * z - w * y), r1 = 2 * (y * z + w * x), r2 = 1 - 2 * (x * x + y * y);
  let lo = Infinity;
  for (const cx of [-s[0] / 2, s[0] / 2]) for (const cy of [-s[1] / 2, s[1] / 2]) for (const cz of [0, s[2]]) lo = Math.min(lo, r0 * cx + r1 * cy + r2 * cz);
  return 0.001 - lo;
}
