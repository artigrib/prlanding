// Binds the replay codec to the live scene: which channels exist (layout), how to read them from the
// running match (sample) and how to pose the scene from recorded values (apply). Playback never touches
// the physics world; it only moves the visual nodes, so it also works for imported files (robots and
// map rebuilt from the header, no Rapier bodies at all).

const MAXW = 8;                      // wheel nodes per robot that can come off (bit mask + transform)
export const HZ_KEYS = ['theta', 'h', 'y', 't', 'open', 'warned', 'state'];

// hazard spec from an untrusted file -> a clean copy, or null when anything is off
export function sanitizeHazards(list, maxHazards = 32) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > maxHazards) return null;
  const seen = new Set(), out = [];
  for (const h of list) {
    if (!h || typeof h !== 'object' || !Number.isInteger(h.i) || h.i < 0 || h.i >= maxHazards || seen.has(h.i) || !Array.isArray(h.keys) || h.keys.length > HZ_KEYS.length) return null;
    seen.add(h.i);
    const ks = new Set(), keys = [];
    for (const k of h.keys) {
      if (!k || typeof k !== 'object' || !HZ_KEYS.includes(k.k) || ks.has(k.k) || (k.kind !== 'num' && k.kind !== 'enum')) return null;
      ks.add(k.k);
      if (k.kind === 'enum') {
        if (!Array.isArray(k.table) || k.table.length > 64 || !k.table.every(x => typeof x === 'string' && x.length <= 40)) return null;
        keys.push({ k: k.k, kind: 'enum', table: k.table.slice() });
      } else keys.push({ k: k.k, kind: 'num' });
    }
    out.push({ i: h.i, keys });
  }
  return out;
}

function robotChannels(i) {
  const p = `r${i}.`, L = [];
  for (const k of ['px', 'py', 'pz']) L.push([p + k, 1000]);
  for (const k of ['qx', 'qy', 'qz', 'qw']) L.push([p + k, 10000]);
  L.push([p + 'wl', 100], [p + 'wr', 100], [p + 'blade', 100], [p + 'arm', 1000], [p + 'jaw', 1000], [p + 'spin', 100],
    [p + 'hp', 1000], [p + 'flip', 10], [p + 'hits', 1], [p + 'lost', 1]);
  for (let w = 0; w < MAXW; w++) for (const k of ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw']) L.push([`${p}w${w}${k}`, k[0] === 'q' ? 10000 : 1000]);
  return L;
}

// hazards: every numeric / boolean / enum field from HZ_KEYS the hazard instance has
function hazardSpec(hazards) {
  return (hazards || []).map((h, i) => {
    const keys = [];
    for (const k of HZ_KEYS) {
      const v = h[k];
      if (typeof v === 'number' || typeof v === 'boolean') keys.push({ k, kind: 'num' });
      else if (typeof v === 'string') keys.push({ k, kind: 'enum', table: [] });
    }
    return { i, keys };
  });
}

export function createBinding(robots, rawMap, savedHazards) {
  const hazards = rawMap && rawMap.hazards || [];
  const debris = rawMap && rawMap.debris || null;
  let hz = hazardSpec(hazards);
  if (savedHazards) { hz = sanitizeHazards(savedHazards); if (!hz) throw new Error('replay: bad hazard spec'); }
  const layout = [];
  robots.forEach((r, i) => layout.push(...robotChannels(i)));
  for (const h of hz) for (const k of h.keys) layout.push([`h${h.i}.${k.k}`, k.kind === 'num' ? 1000 : 1]);
  const nDeb = debris ? debris.count : 0;
  for (let d = 0; d < nDeb; d++) for (const k of ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw']) layout.push([`d${d}${k}`, k[0] === 'q' ? 10000 : 1000]);
  const RB = robotChannels(0).length;
  const hzBase = robots.length * RB;
  let hzCount = 0; for (const h of hz) hzCount += h.keys.length;
  const debBase = hzBase + hzCount;
  const prevQ = robots.map(() => [0, 0, 0, 1]);
  const tmp7 = new Array(7);

  // wheel nodes: where each one lives when it is on the robot
  let homes = null;
  function wheelHomes() {
    homes = robots.map(r => (r.parts && r.parts.wheels || []).slice(0, MAXW).map(node => {
      const d = (r.debris || []).find(x => x.node === node);
      if (d && d.restore) return { node, parent: d.restore.parent, p: d.restore.p.clone(), q: d.restore.q.clone(), s: d.restore.s.clone() };
      return { node, parent: node.parent, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() };
    }));
  }

  return {
    layout, hazardsSpec: hz, channels: layout.length,
    // live match -> values
    sample(out) {
      robots.forEach((r, i) => {
        const o = i * RB;
        const t = r.body ? r.body.translation() : r.root.position, q = r.body ? r.body.rotation() : r.root.quaternion;
        out[o] = t.x; out[o + 1] = t.y; out[o + 2] = t.z;
        // keep quaternions on one hemisphere so interpolation never takes the long way round
        const pq = prevQ[i];
        const s = pq[0] * q.x + pq[1] * q.y + pq[2] * q.z + pq[3] * q.w < 0 ? -1 : 1;
        out[o + 3] = q.x * s; out[o + 4] = q.y * s; out[o + 5] = q.z * s; out[o + 6] = q.w * s;
        pq[0] = out[o + 3]; pq[1] = out[o + 4]; pq[2] = out[o + 5]; pq[3] = out[o + 6];
        out[o + 7] = r.wheelSpin ? r.wheelSpin[0] : 0; out[o + 8] = r.wheelSpin ? r.wheelSpin[1] : 0;
        out[o + 9] = r.bladeAngle || 0;
        out[o + 10] = r.arm ? r.arm.angle || 0 : 0;
        out[o + 11] = r.parts && r.parts.jaw ? r.parts.jaw.rotation.x : 0;
        out[o + 12] = r.spinner ? r.spinner.frac || 0 : 0;
        out[o + 13] = r.damage && typeof r.damage.health01 === 'number' ? r.damage.health01 : 1 - (r.dmgTaken || 0) / 100;
        out[o + 14] = r.flippedTime || 0;
        out[o + 15] = r.hits || 0;
        let mask = 0;
        const ws = r.parts && r.parts.wheels || [];
        for (let w = 0; w < Math.min(MAXW, ws.length); w++) {
          const n = ws[w], b = o + 17 + w * 7;
          if (n && n.userData.lost) {
            mask |= 1 << w;
            out[b] = n.position.x; out[b + 1] = n.position.y; out[b + 2] = n.position.z;
            out[b + 3] = n.quaternion.x; out[b + 4] = n.quaternion.y; out[b + 5] = n.quaternion.z; out[b + 6] = n.quaternion.w;
          } else { out[b] = out[b + 1] = out[b + 2] = out[b + 3] = out[b + 4] = out[b + 5] = 0; out[b + 6] = 1; }
        }
        out[o + 16] = mask;
      });
      let o = hzBase;
      for (const h of hz) {
        const H = hazards[h.i];
        for (const k of h.keys) {
          const v = H ? H[k.k] : 0;
          if (k.kind === 'enum') { let j = k.table.indexOf(v); if (j < 0) { j = k.table.length; k.table.push(v); } out[o++] = j; }
          else out[o++] = typeof v === 'boolean' ? (v ? 1 : 0) : (v || 0);
        }
      }
      for (let d = 0; d < nDeb; d++) { debris.getPose(d, tmp7); for (let j = 0; j < 7; j++) out[debBase + d * 7 + j] = tmp7[j]; }
      return out;
    },
    begin() { wheelHomes(); },
    // values -> scene (playback)
    apply(v, scene) {
      if (!homes) wheelHomes();
      robots.forEach((r, i) => {
        const o = i * RB;
        r.root.position.set(v[o], v[o + 1], v[o + 2]);
        r.root.quaternion.set(v[o + 3], v[o + 4], v[o + 5], v[o + 6]).normalize();
        const p = r.parts || {};
        const mask = Math.round(v[o + 16]);
        (homes[i] || []).forEach((hm, w) => {
          const n = hm.node, lost = (mask >> w) & 1;
          if (lost) {
            if (n.parent !== scene) scene.add(n);
            const b = o + 17 + w * 7;
            n.position.set(v[b], v[b + 1], v[b + 2]); n.quaternion.set(v[b + 3], v[b + 4], v[b + 5], v[b + 6]).normalize();
            n.scale.copy(hm.s);
          } else {
            if (n.parent !== hm.parent && hm.parent) { hm.parent.add(n); n.position.copy(hm.p); n.quaternion.copy(hm.q); n.scale.copy(hm.s); }
            n.rotation.x = v[o + 7 + (p.wheelSide ? p.wheelSide[w] : 0)];
          }
        });
        if (p.flipper && r.def.arm) {
          p.flipper.rotation.x = (p.flipRest || 0) + v[o + 10];
          if (p.flipperOnlyWhenFiring) p.flipper.visible = v[o + 10] < -0.06;
        }
        if (p.jaw) p.jaw.rotation.x = v[o + 11];
        if (p.blade) { if (p.bladeAxis === 'y') p.blade.rotation.y = v[o + 9]; else p.blade.rotation.x = -v[o + 9]; }
        if (p.blur) p.blur.material.opacity = Math.max(0, v[o + 12] - 0.3) * 0.55;
      });
      let o = hzBase;
      for (const h of hz) {
        const H = hazards[h.i];
        for (const k of h.keys) {
          const x = v[o++];
          if (!H || !HZ_KEYS.includes(k.k)) continue;
          if (k.kind === 'enum') { const s = k.table[Math.round(x)]; if (s != null) H[k.k] = s; }
          else H[k.k] = typeof H[k.k] === 'boolean' ? x > 0.5 : x;
        }
        if (H) { H.applyPose && H.applyPose(); H.move && H.move(); }
      }
      for (let d = 0; d < nDeb; d++) { const b = debBase + d * 7; debris.setPose(d, v[b], v[b + 1], v[b + 2], v[b + 3], v[b + 4], v[b + 5], v[b + 6]); }
    },
    // per-robot HUD numbers from a values frame
    hud(v, i) { const o = i * RB; return { hp: v[o + 13], flipped: v[o + 14], hits: Math.round(v[o + 15]), spin: v[o + 12] }; },
    robotPos(v, i, out) { const o = i * RB; return out.set(v[o], v[o + 1], v[o + 2]); },
    robotQuat(v, i, out) { const o = i * RB; return out.set(v[o + 3], v[o + 4], v[o + 5], v[o + 6]).normalize(); },
    // live state kept aside while a replay plays over a running match (pause / training)
    capture() {
      return {
        hz: hazards.map(H => Object.fromEntries(HZ_KEYS.filter(k => k in H).map(k => [k, H[k]])))
      };
    },
    restore(saved, scene) {
      // wheels back where the live match has them, hazards to their live state, debris to its bodies
      robots.forEach((r, i) => (homes && homes[i] || []).forEach(hm => {
        const n = hm.node, d = (r.debris || []).find(x => x.node === n);
        if (n.userData.lost && d) { if (n.parent !== scene) scene.add(n); }
        else if (hm.parent && n.parent !== hm.parent) { hm.parent.add(n); n.position.copy(hm.p); n.quaternion.copy(hm.q); n.scale.copy(hm.s); }
        else if (!hm.parent && n.parent === scene) scene.remove(n);
      }));
      if (saved) hazards.forEach((H, i) => { Object.assign(H, saved.hz[i] || {}); H.applyPose && H.applyPose(true); H.move && H.move(); });
      if (debris && debris.bodies && debris.bodies.length) debris.syncAll();
      for (const r of robots) if (r.body) r.sync(1e-6);
      homes = null;
    }
  };
}

// a binding whose layout differs from the track's (older file, map tweaked since): read values by name
export function remapBinding(binding, track) {
  const same = binding.layout.length === track.layout.length && binding.layout.every(([n], i) => track.layout[i][0] === n);
  if (same) return binding;
  const idx = binding.layout.map(([n]) => (track.index[n] ?? -1));
  const buf = new Float32Array(binding.layout.length);
  const map = v => { for (let i = 0; i < idx.length; i++) buf[i] = idx[i] < 0 ? (binding.layout[i][0].endsWith('qw') ? 1 : 0) : v[idx[i]]; return buf; };
  return {
    ...binding,
    apply: (v, scene) => binding.apply(map(v), scene),
    hud: (v, i) => binding.hud(map(v), i),
    robotPos: (v, i, out) => binding.robotPos(map(v), i, out),
    robotQuat: (v, i, out) => binding.robotQuat(map(v), i, out)
  };
}
