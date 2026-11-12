// Waste-sorting batch on the conveyor (mission 11 "Třídění odpadu I: Ručně", id waste_hand). DOM/three-free:
// the mission check (src/missions.js), tools/belt-measure.mjs and the node tests use it.
//
// A batch is the 11-item pool of the conveyor scene (src/objects/scene.js CONVEYOR_ITEMS) in a seeded order with
// seeded yaws. WasteRun spawns one item every `every` s at the belt entry once the run has started; a spawn into a
// busy entry zone is retried every `retry` s (World.spawn refuses it). Every tick it classifies each item:
//   queued (not spawned yet) · belt (riding, entry included) · held (lifted in the closed jaws) · moving (in a bin,
//   not at rest yet) · bin (at rest in a bin, gripper open or away: the sortCheck rule of missions 06–10) ·
//   stuck (on the belt but not carried along for 3 s while the belt runs: wedged between the rails; a hand can still
//   take it off) · tote (dropped off the belt head: missed) · floor (fell off the table: missed) · table (anywhere else)
// tote and floor are final. It also counts the time the belt stood while the run was on (the Pás star).

import { CONVEYOR_ITEMS, CONVEYOR_BINS, FRACTION_BIN } from './scene.js';
import { inZone } from '../missions.js';

export const WASTE = {
  speed: 0.02,     // m/s: the only belt speed of mission 11 (tracking pick measured best at 2 cm/s, PR 2)
  every: 10,       // s between spawns (design §2; the arm keeps up: beltSolve cycle ≈ 10 s)
  retry: 0.2,      // s: next try when the entry zone is busy
  seed: 1,         // the mission's batch (same order and yaws for every player)
  still: 0.6,      // s at rest in a bin before it counts (as sortCheck)
  free: 0.06       // m: gripper tip farther than this from the item (or open) = not holding it
};

export const FRACTIONS = ['paper', 'plastic', 'glass', 'metal'];
const FRACTION = Object.fromEntries(CONVEYOR_ITEMS.map((it) => [it.name, it.fraction]));
const LONG = /^(fork|spoon)_/;

export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
/** Yaw on the belt: long items lengthwise (± 0.35 rad), the rest any. */
export const yawFor = (name, r) => (LONG.test(name) ? Math.PI / 2 + (r() - 0.5) * 0.7 : r() * Math.PI * 2);

/** Seeded batch: the pool in an order where a fraction never comes twice in a row more than once, and yaws. */
export function batchOrder(seed, pool = CONVEYOR_ITEMS.map((it) => it.name)) {
  const r = rng(seed);
  for (;;) {
    const a = pool.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    let rep = 0; for (let i = 1; i < a.length; i++) if (FRACTION[a[i]] === FRACTION[a[i - 1]]) rep++;
    if (rep <= 1) return { order: a, yaw: a.map((n) => yawFor(n, r)) };
  }
}

const BINS = Object.keys(CONVEYOR_BINS);
const FINAL = new Set(['tote', 'floor']);

export class WasteRun {
  /** w: World of the conveyor scene. o: WASTE overrides (seed, every, …). */
  constructor(w, o = {}) {
    this.w = w; this.o = Object.assign({}, WASTE, o);
    const { order, yaw } = batchOrder(this.o.seed);
    this.items = order.map((name, i) => ({ name, yaw: yaw[i], fraction: FRACTION[name], state: 'queued', bin: null, still: 0 }));
    this.t = 0; this.next = 0; this.tNext = 0; this.retries = 0;
    this.paused = 0; this.pauseT = 0; this.pauses = 0; this.wasPaused = false;
    this.events = []; this.last = null;
    this.p = new Float64Array(3);
  }
  get n() { return this.items.length; }
  item(name) { return this.items.find((it) => it.name === name) || null; }

  /** c: { started, tip, gripOpen }. Spawns on schedule, classifies the items, logs transitions. */
  tick(dt, c) {
    const w = this.w, belt = w.belt;
    if (!c.started) return;
    this.t += dt;
    const paused = belt.speed === 0;
    if (paused) { this.paused += dt; this.pauseT += dt; if (!this.wasPaused) this.pauses++; } else this.pauseT = 0;
    this.wasPaused = paused;
    if (this.next < this.n && this.t >= this.tNext) {
      const it = this.items[this.next];
      if (w.spawn(it.name, { yaw: it.yaw })) { it.state = 'belt'; it.spawnT = this.t; this.next++; this.tNext = this.t + this.o.every; }
      else { this.tNext = this.t + this.o.retry; this.retries++; }
    }
    for (const it of this.items) {
      if (it.state === 'queued' || FINAL.has(it.state)) continue;
      const s = this.classify(it, dt, c);
      if (s !== it.state) this.change(it, s);
    }
  }

  classify(it, dt, c) {
    const w = this.w, p = w.com(it.name, this.p), t = c.tip, e = w.o[it.name];
    const free = c.gripOpen || Math.hypot(t[0] - p[0], t[1] - p[1], t[2] - p[2]) > this.o.free;
    const fx = BINS.find((b) => inZone(w, it.name, b));
    if (fx && free) {
      it.still = w.speed(it.name) < 0.03 ? it.still + dt : 0;
      it.bin = fx;
      return it.still >= this.o.still ? 'bin' : it.state === 'bin' ? 'bin' : 'moving';
    }
    it.still = 0; it.bin = null;
    if (!free && p[2] > (e.restZ || 0) + 0.008) return 'held';
    const z = w.belt.zone(p);
    if (z === 'belt' || z === 'entry') {
      const v = w.belt.v;
      if (Math.abs(v) < 0.01) return it.state === 'stuck' ? 'stuck' : 'belt';   // the belt stands: nothing to compare
      it.stall = Math.abs(w.d.qvel[e.vadr + 1]) < 0.3 * Math.abs(v) ? (it.stall || 0) + dt : 0;
      return it.stall > 3 ? 'stuck' : 'belt';
    }
    it.stall = 0;
    if (z === 'tote') return 'tote';
    if (p[2] < -0.05) return 'floor';
    return 'table';
  }

  change(it, s) {
    const prev = it.state; it.state = s;
    const ev = { ev: s, name: it.name, fraction: it.fraction, t: this.t, from: prev };
    if (s === 'bin') { ev.bin = it.bin; ev.ok = it.bin === FRACTION_BIN[it.fraction]; }
    this.events.push(ev);
    if (s === 'bin' || s === 'tote' || s === 'floor' || s === 'stuck') this.last = ev;
  }

  /** Every item spawned and at rest off the belt (in a bin, in the tote, on the floor or lying on the table). */
  done() {
    if (this.next < this.n) return false;
    return this.items.every((it) => it.state === 'bin' || it.state === 'stuck' || FINAL.has(it.state) || (it.state === 'table' && this.w.speed(it.name) < 0.02));
  }

  stats() {
    const byBin = Object.fromEntries(BINS.map((b) => [b, { correct: 0, wrong: 0 }]));
    const missedBy = Object.fromEntries(FRACTIONS.map((f) => [f, 0]));
    let correct = 0, wrong = 0, belt = 0, lost = 0;
    for (const it of this.items) {
      if (it.state === 'bin') {
        const ok = it.bin === FRACTION_BIN[it.fraction];
        if (ok) correct++; else wrong++;
        byBin[it.bin][ok ? 'correct' : 'wrong']++;
        continue;
      }
      if (it.state === 'belt') belt++;
      if (FINAL.has(it.state)) lost++;
      if (FINAL.has(it.state) || it.state === 'table' || it.state === 'stuck') missedBy[it.fraction]++;
    }
    const inBins = correct + wrong;
    return { n: this.n, spawned: this.next, correct, wrong, missed: this.n - inBins, lost, onBelt: belt,
      purity: inBins ? correct / inBins : null, byBin, missedBy, paused: this.paused, pauses: this.pauses, retries: this.retries };
  }
}
