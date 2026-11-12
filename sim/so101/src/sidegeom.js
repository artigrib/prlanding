// Side view (HUD stage 3, playtest problem 4: no depth cue from the default camera): which object the inset frames,
// from which side, and the measured height. DOM/three-free (node tests: tests/sideview.test.mjs).
//
// The inset looks along the line from the target back to the arm base (radially inwards, from beyond the target).
// That line is close to perpendicular to the default camera's line of sight in every mission (checked by the test),
// so the offset the default view hides (along its depth) is the left/right offset in the inset, and the gripper,
// the far end of the arm, is in front of the rest of the arm. The numbers are the ones of the grasp hint
// (src/missions.js graspHint / reachHint): height = tip z − object z, sideways = horizontal distance, whole cm.

import { GRASP } from './missions.js';

const SORT03 = { cube: 'bowl2', cube_b: 'bowl' };   // mission 03: orange cube → orange bowl, blue → blue bowl

/** reference point of an object: body origin, centre of mass for library items (their origin is the bottom) */
export function refPoint(w, name, out) { return w.o[name].lib ? w.com(name, out) : w.pos(name, out); }

/** done already (resting in its place)? Cubes in a bowl, library items in their zone (inZone passed in). */
function placed(w, m, name, inZone) {
  if (m.sort && m.sort[name]) return inZone(w, name, m.sort[name]);
  for (const b of ['bowl', 'bowl2']) {
    if (!w.o[b] || !w.o[b].active) continue;
    const p = w.pos(name, [0, 0, 0]), q = w.pos(b, [0, 0, 0]);
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05 && p[2] < 0.03) return true;
  }
  return false;
}

/**
 * The object the inset is about. Holding something: where it goes (the place target). Otherwise the nearest
 * (horizontally) object still to pick or push. Drawing mission: the paper under the pen.
 * Returns { name, label, p: [x, y, z] } or null.
 */
export function sideTarget(w, m, held, tip, inZone) {
  if (m.draw) return { name: 'paper', label: 'papír', p: [tip[0], tip[1], 0] };
  const T = m.targets || {};
  if (held) {
    const fx = (m.sort && m.sort[held]) || (m.id === 'sort' && SORT03[held]) || Object.keys(T).find((k) => T[k] === 'place' && k !== held);
    if (fx && w.o[fx]) return { name: fx, label: w.o[fx].label, p: Array.from(refPoint(w, fx, [0, 0, 0])) };
  }
  let best = null, bd = Infinity;
  for (const k of Object.keys(T)) {
    if ((T[k] !== 'pick' && T[k] !== 'push') || k === held || !w.o[k] || !w.o[k].active || w.o[k].kind !== 'free') continue;
    if (placed(w, m, k, inZone)) continue;
    const p = refPoint(w, k, [0, 0, 0]), d = Math.hypot(p[0] - tip[0], p[1] - tip[1]);
    if (d < bd) { bd = d; best = { name: k, label: w.o[k].label, p: Array.from(p) }; }
  }
  return best;
}

/** height and sideways offset of the gripper tip over the target point (grasp-hint numbers) */
export function measure(tip, p) {
  return { dz: tip[2] - p[2], dh: Math.hypot(tip[0] - p[0], tip[1] - p[1]) };
}
const cm = (v) => Math.max(1, Math.round(Math.abs(v) * 100));
/** short label in the inset: "6 cm" / "ve výšce" (within the grasp band) */
const level = (dz) => dz > -GRASP.dz && dz < GRASP.top;   // the grasp hint's "close now" band (jaws below the top face)
export function heightText(dz) { return level(dz) ? 've výšce' : `${cm(dz)} cm`; }
/** accessible name of the inset */
export function sideLabel(dz, dh, label) {
  const hgt = level(dz) ? `chapadlo ve výšce cíle (${label})` : `chapadlo ${cm(dz)} cm ${dz > 0 ? 'nad' : 'pod'} cílem (${label})`;
  return `Pohled z boku: ${hgt}` + (dh >= GRASP.dh ? `, ${cm(dh)} cm vedle` : '');
}

/**
 * Orthographic framing (MuJoCo coordinates, z up): viewing direction, centre, half height, depth slab.
 * dir: unit horizontal vector the camera looks along (target → base); right: screen x axis.
 * The frame holds the tip and the target with a margin; the half height is rounded up to whole cm so small moves
 * do not zoom. Only a slab around the target is drawn: `front` beyond it and `back` towards the base (radially).
 */
export function sideFrame(tip, p, aspect) {
  let ux = p[0], uy = p[1]; const L = Math.hypot(ux, uy);
  if (L < 0.05) { ux = 1; uy = 0; } else { ux /= L; uy /= L; }
  const dir = [-ux, -uy, 0], right = [-uy, ux, 0];   // looking along dir with z up: right = dir × z
  const lat = (q) => q[0] * right[0] + q[1] * right[1], rad = (q) => q[0] * ux + q[1] * uy;
  const lt = lat(tip), lp = lat(p);
  const cx = (lt + lp) / 2;
  // vertical: the target, the tip and the gripper body above it (≈ 6 cm), the caption strip on top
  const top = Math.max(tip[2], p[2]) + 0.07, bot = Math.max(-0.01, Math.min(tip[2], p[2]) - 0.03);
  const cz = (top + bot) / 2;
  const need = Math.max(0.055, (top - bot) / 2, (Math.abs(lt - lp) / 2 + 0.035) / aspect);
  const halfH = Math.ceil(need * 100) / 100;
  const front = Math.max(0.1, rad(tip) - rad(p) + 0.06);
  // and more than `back` behind it (the base and the shoulder behind the gripper would only clutter the inset)
  const back = Math.max(0.12, rad(p) - rad(tip) + 0.08);
  // centre point in 3D: lateral cx on the line through p, height cz
  const base = rad(p);
  const centre = [ux * base + right[0] * cx, uy * base + right[1] * cx, cz];
  return { dir, right, u: [ux, uy], centre, halfH, halfW: halfH * aspect, front, back, cx, cz, lat, rad };
}

/** screen point (px, origin top-left) of a MuJoCo point in the inset of size w × h */
export function toInset(f, q, w, h) {
  return [(0.5 + (f.lat(q) - f.cx) / (2 * f.halfW)) * w, (0.5 - (q[2] - f.cz) / (2 * f.halfH)) * h];
}
