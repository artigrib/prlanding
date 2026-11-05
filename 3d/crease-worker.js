// Off-main-thread hard-surface pass for the /3d/ flyover: crease-angle normals (welded back to an index)
// and feature-edge lines. Input: {id, pos: Float32Array, idx: Uint32Array|null, crease, edge (cos)}.
onmessage = ({data: {id, pos, idx, crease, edge}}) => {
  const nf = (idx ? idx.length : pos.length / 3) / 3, at = idx ? i => idx[i] : i => i;
  const FN = new Float32Array(nf * 3), U = new Float32Array(nf * 3);
  let mx = 0; for (let i = 0; i < pos.length; i++) mx = Math.max(mx, Math.abs(pos[i]));
  const q = 1e5 / (mx || 1), key = v => Math.round(pos[v*3]*q) + ',' + Math.round(pos[v*3+1]*q) + ',' + Math.round(pos[v*3+2]*q);
  const H = new Map(), corner = new Int32Array(nf * 3); // corner -> position-group id
  const groups = [];
  for (let f = 0; f < nf; f++) {
    const a = at(f*3), b = at(f*3+1), c = at(f*3+2);
    const ux = pos[b*3]-pos[a*3], uy = pos[b*3+1]-pos[a*3+1], uz = pos[b*3+2]-pos[a*3+2];
    const vx = pos[c*3]-pos[a*3], vy = pos[c*3+1]-pos[a*3+1], vz = pos[c*3+2]-pos[a*3+2];
    const x = uy*vz-uz*vy, y = uz*vx-ux*vz, z = ux*vy-uy*vx, l = Math.hypot(x, y, z) || 1;
    FN[f*3] = x; FN[f*3+1] = y; FN[f*3+2] = z; U[f*3] = x/l; U[f*3+1] = y/l; U[f*3+2] = z/l;
    for (let k = 0; k < 3; k++) { const kk = key(at(f*3+k)); let g = H.get(kk); if (g === undefined) { H.set(kk, g = groups.length); groups.push([]); } groups[g].push(f*3+k); corner[f*3+k] = g; }
  }
  // normals per corner, welded on (position group, quantised normal)
  const P = [], N = [], I = new Uint32Array(nf * 3), W = new Map();
  for (let g = 0; g < groups.length; g++) {
    const cs = groups[g];
    for (const ci of cs) {
      const fi = (ci / 3 | 0) * 3; let x = 0, y = 0, z = 0;
      for (const cj of cs) { const fj = (cj / 3 | 0) * 3; if (U[fi]*U[fj] + U[fi+1]*U[fj+1] + U[fi+2]*U[fj+2] >= crease) { x += FN[fj]; y += FN[fj+1]; z += FN[fj+2]; } }
      const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      const wk = g + ':' + Math.round(x*500) + ',' + Math.round(y*500) + ',' + Math.round(z*500);
      let vi = W.get(wk);
      if (vi === undefined) { const v = at(ci); W.set(wk, vi = P.length / 3); P.push(pos[v*3], pos[v*3+1], pos[v*3+2]); N.push(x, y, z); }
      I[ci] = vi;
    }
  }
  // feature edges: shared by two faces bending more than the edge threshold, or open
  let E = null;
  if (edge != null) {
    const EM = new Map(), out = [];
    for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
      const g0 = corner[f*3+k], g1 = corner[f*3+(k+1)%3]; if (g0 === g1) continue;
      const ek = g0 < g1 ? g0 + '_' + g1 : g1 + '_' + g0, o = EM.get(ek);
      if (o === undefined) EM.set(ek, [f, f*3+k, f*3+(k+1)%3]);
      else { if (o[0] >= 0 && U[o[0]*3]*U[f*3] + U[o[0]*3+1]*U[f*3+1] + U[o[0]*3+2]*U[f*3+2] <= edge) { const a = at(o[1]), b = at(o[2]); out.push(pos[a*3], pos[a*3+1], pos[a*3+2], pos[b*3], pos[b*3+1], pos[b*3+2]); } o[0] = -1; }
    }
    E = new Float32Array(out);
  }
  const p = new Float32Array(P), n = new Float32Array(N), ix = P.length / 3 > 65535 ? I : new Uint16Array(I);
  postMessage({id, p, n, ix, E}, [p.buffer, n.buffer, ix.buffer].concat(E ? [E.buffer] : []));
};
