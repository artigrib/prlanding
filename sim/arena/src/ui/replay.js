// Instant replay: ring buffer of robot transforms (and animated parts) recorded every physics
// step; played back slowed down while the physics world is frozen.
const MAXP = 16;            // animated part nodes per robot
const STRIDE = 7 + MAXP * 6;

function partNodes(r) {
  const out = [];
  const add = v => { if (!v) return; if (Array.isArray(v)) v.forEach(add); else if (v.isObject3D && out.length < MAXP) out.push(v); };
  if (r.parts) for (const k in r.parts) add(r.parts[k]);
  return out;
}

export class Replay {
  constructor(dt, seconds = 6) {
    this.n = Math.round(seconds / dt);
    this.buf = null; this.times = new Float64Array(this.n); this.nodes = [];
    this.head = 0; this.length = 0; this.events = [];
    this.playing = false; this.onEvent = null;
  }
  clear() { this.head = 0; this.length = 0; this.events.length = 0; this.playing = false; }
  invalidate() {}
  record(t, robots) {
    if (!this.buf || this.buf.length !== this.n * robots.length * STRIDE) this.buf = new Float32Array(this.n * robots.length * STRIDE);
    const i = this.head;
    this.times[i] = t;
    this.nodes[i] = robots.map(partNodes);
    robots.forEach((r, k) => {
      const o = (i * robots.length + k) * STRIDE, b = this.buf;
      const p = r.body.translation(), q = r.body.rotation();
      b[o] = p.x; b[o + 1] = p.y; b[o + 2] = p.z; b[o + 3] = q.x; b[o + 4] = q.y; b[o + 5] = q.z; b[o + 6] = q.w;
      const nodes = this.nodes[i][k];
      for (let j = 0; j < nodes.length; j++) {
        const nd = nodes[j], qq = nd.quaternion, oo = o + 7 + j * 6;
        b[oo] = qq.x; b[oo + 1] = qq.y; b[oo + 2] = qq.z; b[oo + 3] = qq.w; b[oo + 4] = nd.visible ? 1 : 0;
        b[oo + 5] = nd.material && !Array.isArray(nd.material) ? nd.material.opacity : 1;
      }
    });
    this.lastT = t;
    this.head = (i + 1) % this.n; this.length = Math.min(this.n, this.length + 1);
  }
  event(e) { e.t = this.lastT || 0; this.events.push(e); if (this.events.length > 64) this.events.shift(); }
  // index of the k-th oldest frame
  idx(k) { return (this.head - this.length + k + this.n) % this.n; }
  start(robots, speed = 0.35, before = 3.2, after = 1.1) {
    if (!this.length) return;
    this.robots = robots; this.speed = speed;
    const t1 = this.times[this.idx(this.length - 1)], t0 = Math.max(this.times[this.idx(0)], t1 - before - after);
    this.t = t0; this.t1 = t1; this.k = 0; this.hold = 0.5;
    while (this.k < this.length - 1 && this.times[this.idx(this.k)] < t0) this.k++;
    this.evI = this.events.findIndex(e => e.t >= t0); if (this.evI < 0) this.evI = this.events.length;
    this.playing = true;
    this.apply();
  }
  stop() { this.playing = false; }
  // returns true when finished
  tick(dt) {
    if (!this.playing) return true;
    if (this.t >= this.t1) { this.hold -= dt; return this.hold <= 0; }
    this.t = Math.min(this.t1, this.t + dt * this.speed);
    while (this.k < this.length - 2 && this.times[this.idx(this.k + 1)] <= this.t) this.k++;
    while (this.evI < this.events.length && this.events[this.evI].t <= this.t) { this.onEvent && this.onEvent(this.events[this.evI]); this.evI++; }
    this.apply();
    return false;
  }
  apply() {
    const R = this.robots, a = this.idx(this.k), b = this.idx(Math.min(this.length - 1, this.k + 1));
    const ta = this.times[a], tb = this.times[b];
    const f = tb > ta ? Math.min(1, Math.max(0, (this.t - ta) / (tb - ta))) : 0;
    R.forEach((r, k) => {
      const oa = (a * R.length + k) * STRIDE, ob = (b * R.length + k) * STRIDE, B = this.buf;
      r.root.position.set(B[oa] + (B[ob] - B[oa]) * f, B[oa + 1] + (B[ob + 1] - B[oa + 1]) * f, B[oa + 2] + (B[ob + 2] - B[oa + 2]) * f);
      r.root.quaternion.set(B[oa + 3], B[oa + 4], B[oa + 5], B[oa + 6]);
      const qb = r.root.quaternion.clone().set(B[ob + 3], B[ob + 4], B[ob + 5], B[ob + 6]);
      r.root.quaternion.slerp(qb, f);
      const nodes = this.nodes[a] && this.nodes[a][k] || [];
      for (let j = 0; j < nodes.length; j++) {
        const nd = nodes[j], oo = oa + 7 + j * 6;
        nd.quaternion.set(B[oo], B[oo + 1], B[oo + 2], B[oo + 3]);
        nd.visible = B[oo + 4] > 0.5;
        if (nd.material && !Array.isArray(nd.material) && nd.material.transparent) nd.material.opacity = B[oo + 5];
      }
    });
  }
}
