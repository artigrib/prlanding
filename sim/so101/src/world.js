// Scene objects of the mission table (cubes, ball, bowls, goal): ids, poses, placement.
// DOM/three-free (used by missions, planner and node tests).

export const OBJECTS = {
  cube:   { kind: 'free', half: 0.0125, label: 'oranžová kostka' },
  cube_b: { kind: 'free', half: 0.0125, label: 'modrá kostka' },
  ball:   { kind: 'free', half: 0.02, label: 'míček' },
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
    this.p = new Float64Array(3);
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

  place(name, x, y, z, yaw = 0) {
    const e = this.o[name];
    if (e.kind === 'free') {
      const q = this.d.qpos, a = e.qadr;
      if (z == null) z = e.half;
      q[a] = x; q[a + 1] = y; q[a + 2] = z;
      q[a + 3] = Math.cos(yaw / 2); q[a + 4] = 0; q[a + 5] = 0; q[a + 6] = Math.sin(yaw / 2);
      const v = this.d.qvel; for (let i = 0; i < 6; i++) v[e.vadr + i] = 0;
    } else {
      const mp = this.d.mocap_pos, mq = this.d.mocap_quat, i = e.mocap;
      mp[3 * i] = x; mp[3 * i + 1] = y; mp[3 * i + 2] = z || 0;
      mq[4 * i] = Math.cos(yaw / 2); mq[4 * i + 1] = 0; mq[4 * i + 2] = 0; mq[4 * i + 3] = Math.sin(yaw / 2);
    }
  }
  park(name) { const p = PARK[name]; this.place(name, p[0], p[1], p[2]); this.o[name].active = false; }

  /** Set up a layout: { cube: [x, y, yaw?], bowl: [x, y, yaw?], ... }; everything else is parked. */
  layout(spec) {
    for (const name of Object.keys(this.o)) {
      const s = spec[name];
      if (s) { this.place(name, s[0], s[1], null, s[2] || 0); this.o[name].active = true; }
      else this.park(name);
    }
    this.mj.mj_forward(this.m, this.d);
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

  active() { return Object.values(this.o).filter((e) => e.active); }
}
