// Camera views of the mobile scene (design §3.3): Za vozíkem (chase) → Shora (map) → Kamera vozíku (front camera).
//
// - Za vozíkem: the orbit target follows the chassis through a critically damped spring (smooth time 0.25 s, design
//   §3.3), and the camera keeps its offset in the chassis frame, so it turns with the cart. The player can still orbit
//   and zoom: the new offset is kept when the drag ends. Motion-sickness care: the follow never overshoots
//   (critical damping), the heading follows with the same lag, and with prefers-reduced-motion (or ?klid=1) the
//   camera does not turn with the cart at all (it only slides along); view changes are cuts, never swoops.
// - Shora: straight down over both rooms, fitted to the canvas (on a portrait canvas lab B is at the top).
// - Kamera vozíku: what the MJCF camera `front_cam` on the cart sees (src/mobile/scene.js), drawn 4:3 like the
//   LeKiwi front camera's 640 × 480 stream, with its vertical field of view; no cutaway walls (a real camera cannot
//   see through them).
// The default camera (Za vozíkem from the start pose) looks over the cart's right shoulder into the door, and the
// walls between the camera and the cart, its target or either bench are cut down to bench height (view.js), so lab B
// is readable from the start.
// Three.js coordinates are (x, z_mj, −y_mj); this module works in MuJoCo coordinates and converts at the end.

export const VIEW_ORDER = ['chase', 'top', 'front'];
export const VIEW_LABEL = { chase: 'Za vozíkem', top: 'Shora', front: 'Kamera vozíku' };
export const SMOOTH_T = 0.25;   // s, design §3.3

// Chase framing (chassis frame, metres; camera design, not facts about the robot): the target sits ahead of the cart
// at about tray height; the camera behind it, over the right shoulder (the arm side), above the 2.2 m walls.
const CHASE = {
  target: [1.1, 0, 0.3],
  wide: [-2.1, -0.8, 3.1],      // offset camera − target
  narrow: [-2.3, -0.6, 3.9]
};

/**
 * Critically damped spring towards `target` (the "SmoothDamp" integrator used in game cameras): no overshoot,
 * reaches the target in about smoothTime. state = { x, v }; returns the new x.
 */
export function smoothDamp(state, target, smoothTime, dt) {
  if (!(dt > 0)) return state.x;
  const omega = 2 / smoothTime, k = omega * dt;
  const e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
  const change = state.x - target, temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * e;
  let x = target + (change + temp) * e;
  // never overshoot (the polynomial approximation can, for very large dt)
  if ((target - state.x > 0) === (x > target)) { x = target; state.v = 0; }
  state.x = x;
  return x;
}
/** Angle difference b − a wrapped to (−π, π]. */
export function angDiff(a, b) { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d <= -Math.PI) d += 2 * Math.PI; return d; }

export class CameraRig {
  /** sim: ArmSim; T: three; opts: { reduced, base() → {x, y, yaw}, frontCam: camera id in the model, map: MAP, fovy,
   *  insetTop() → CSS px of the canvas top covered by the top bar } */
  constructor(sim, T, opts) {
    this.sim = sim; this.T = T; this.o = opts;
    this.view = 'chase';
    this.reduced = !!opts.reduced;
    const c = sim.controls;
    this.drag = false;
    c.addEventListener('start', () => { this.drag = true; });
    c.addEventListener('end', () => { this.drag = false; this.keepOffset(); });
    this.front = new T.PerspectiveCamera(opts.fovy, 4 / 3, 0.02, 30);
    this.m4 = new T.Matrix4(); this.size = new T.Vector2();
    this.sx = { x: 0, v: 0 }; this.sy = { x: 0, v: 0 }; this.syaw = { x: 0, v: 0 };
    this.snap();
  }

  narrow() { return matchMedia('(max-width:860px)').matches; }

  /** Jump the follow state to the cart (start, reset, view change): no smoothing across a cut. */
  snap() {
    const b = this.o.base();
    this.sx.x = b.x; this.sy.x = b.y; this.syaw.x = this.reduced ? 0 : b.yaw;
    this.sx.v = this.sy.v = this.syaw.v = 0;
    const o = this.narrow() ? CHASE.narrow : CHASE.wide;
    this.off = o.slice();   // camera − target, chassis frame (world frame with reduced motion)
  }

  /** After the player orbited / zoomed: keep the new offset (expressed in the follow frame). */
  keepOffset() {
    if (this.view !== 'chase') return;
    const cam = this.sim.camera.position, tg = this.sim.controls.target;
    const w = [cam.x - tg.x, -(cam.z - tg.z), cam.y - tg.y], a = this.syaw.x, c = Math.cos(a), s = Math.sin(a);
    this.off = [c * w[0] + s * w[1], -s * w[0] + c * w[1], w[2]];
  }

  set(view) {
    if (!VIEW_ORDER.includes(view)) return this.view;
    this.view = view;
    const c = this.sim.controls;
    c.enabled = view !== 'front';
    if (view === 'chase') { c.minDistance = 0.4; c.maxDistance = 6; c.maxPolarAngle = Math.PI * 0.45; this.snap(); this.chase(0); }
    if (view === 'top') this.top();
    return view;
  }
  cycle() { return this.set(VIEW_ORDER[(VIEW_ORDER.indexOf(this.view) + 1) % VIEW_ORDER.length]); }

  /** Straight down over both rooms, fitted to the canvas. */
  top() {
    const sim = this.sim, cam = sim.camera, c = sim.controls, M = this.o.map;
    const hx = M.room[0] + 1.5 * M.wall + 0.1, hy = M.room[1] / 2 + M.wall + 0.1;   // half extents with a margin
    const portrait = cam.aspect < 1;
    // portrait: the map's long axis runs up the screen (lab B at the top)
    const [halfW, halfH] = portrait ? [hy, hx] : [hx, hy];
    // the top bar (mission chip, goal line) covers the upper edge of the canvas: fit the map below it
    const ch = sim.renderer.domElement.clientHeight || 1, inset = Math.min(ch * 0.4, this.o.insetTop ? this.o.insetTop() : 0);
    const k = ch / (ch - inset);   // the map must fit into the free part of the height
    const tv = Math.tan(cam.fov * Math.PI / 360), H = Math.max(halfH * k / tv, halfW / (tv * cam.aspect)) + M.h;
    c.minDistance = 0.4; c.maxDistance = H + 2; c.maxPolarAngle = Math.PI * 0.45;
    // move the target towards the screen's top by half the inset, so the map centres in the free part
    const mpp = 2 * H * tv / ch, sh = inset / 2 * mpp;
    c.target.set(portrait ? sh : 0, 0, portrait ? 0 : -sh);
    // a tiny horizontal offset picks the screen's up direction (OrbitControls looks from the offset side)
    if (portrait) cam.position.set(c.target.x - 1e-3, H, 0); else cam.position.set(0, H, c.target.z + 1e-3);
    cam.lookAt(c.target); c.update();
    this.topH = H;
  }

  /** Per physics frame (also inside the test hook's advance()). */
  update(dt) {
    if (this.view === 'chase') this.chase(dt);
  }

  chase(dt) {
    const b = this.o.base(), sim = this.sim, cam = sim.camera, tg = sim.controls.target;
    if (dt > 0) {
      smoothDamp(this.sx, b.x, SMOOTH_T, dt); smoothDamp(this.sy, b.y, SMOOTH_T, dt);
      if (!this.reduced) {
        // unwrap the heading so the spring takes the short way round
        const goal = this.syaw.x + angDiff(this.syaw.x, b.yaw);
        smoothDamp(this.syaw, goal, SMOOTH_T, dt);
      }
    }
    const a = this.syaw.x, c = Math.cos(a), s = Math.sin(a), T0 = CHASE.target;
    const tx = this.sx.x + c * T0[0] - s * T0[1], ty = this.sy.x + s * T0[0] + c * T0[1], tz = T0[2];
    const o = this.off, ox = c * o[0] - s * o[1], oy = s * o[0] + c * o[1], oz = o[2];
    if (this.drag) {
      // the player is orbiting: carry the camera along with the target, leave the angle to them
      const dx = tx - tg.x, dz = -ty - tg.z, dy = tz - tg.y;
      cam.position.x += dx; cam.position.y += dy; cam.position.z += dz;
      tg.set(tx, tz, -ty);
      return;
    }
    tg.set(tx, tz, -ty);
    cam.position.set(tx + ox, tz + oz, -(ty + oy));
    cam.lookAt(tg);
  }

  /** Pose of the front camera from MuJoCo (cam_xpos / cam_xmat: looks along −z, y up, as in three.js). */
  frontPose() {
    const d = this.sim.d, i = this.o.frontCam, p = d.cam_xpos, M = d.cam_xmat, e = this.m4.elements, r = 9 * i, q = 3 * i;
    e[0] = M[r]; e[4] = M[r + 1]; e[8] = M[r + 2]; e[12] = p[q];
    e[1] = M[r + 3]; e[5] = M[r + 4]; e[9] = M[r + 5]; e[13] = p[q + 1];
    e[2] = M[r + 6]; e[6] = M[r + 7]; e[10] = M[r + 8]; e[14] = p[q + 2];
    e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
    this.sim.world.updateMatrixWorld();
    const f = this.front;
    f.matrixWorld.multiplyMatrices(this.sim.world.matrixWorld, this.m4);
    f.matrixWorld.decompose(f.position, f.quaternion, f.scale);
    f.updateMatrixWorld(true);
  }

  /** The 4:3 picture of the front camera, centred in the canvas (CSS px). */
  frontRect() {
    const cv = this.sim.renderer.domElement, w = cv.clientWidth, h = cv.clientHeight;
    const fw = Math.min(w, h * 4 / 3), fh = fw * 3 / 4;
    return { x: Math.round((w - fw) / 2), y: Math.round((h - fh) / 2), w: Math.round(fw), h: Math.round(fh), cw: w, ch: h };
  }

  /** Draw the frame (sim.onRender). before(view) / after() let view.js switch the cutaway walls. */
  render(before, after) {
    const r = this.sim.renderer, s = this.sim.scene;
    if (this.view !== 'front') { before && before(this.view); r.render(s, this.sim.camera); after && after(); return; }
    this.frontPose();
    before && before('front');
    const rc = this.frontRect();
    r.getSize(this.size);   // CSS px, like setViewport / setScissor
    r.setClearColor(0x1b1b1b, 1); r.clear();
    const y = this.size.y - rc.y - rc.h;
    r.setScissorTest(true); r.setScissor(rc.x, y, rc.w, rc.h); r.setViewport(rc.x, y, rc.w, rc.h);
    r.setClearColor(0xf4f4f1, 1); r.clear();
    r.render(s, this.front);
    r.setScissorTest(false); r.setViewport(0, 0, this.size.x, this.size.y);
    r.setClearColor(0x000000, 0);
    after && after();
  }
}
