// Virtual cameras for the SIL runner — printedrobotics.cz.
//
// Renders the simulated scene from fixed viewpoints (and from the wrist camera in the MJCF model) in a
// worker thread and publishes the frames over ZeroMQ in the format of LeRobot's BUILT-IN ZMQ camera
// (lerobot/cameras/zmq, `type: zmq`), so an unmodified LeRobot sees them as ordinary robot cameras:
//
//   --robot.cameras="{ up: {type: zmq, server_address: 127.0.0.1, port: 5555, camera_name: up,
//                           width: 640, height: 480, fps: 30} }"
//
// Message (one per rendered frame, all cameras together; each LeRobot camera picks its camera_name):
//   {"timestamps": {"up": 1730000000.12, ...}, "images": {"up": "<base64 PNG>", ...}}
//
// Colour order: LeRobot decodes the image with cv2.imdecode (which returns B,G,R) and does not convert
// it; its own image server encodes RGB arrays with cv2.imencode (which expects B,G,R). The two swaps
// cancel, and the policy gets RGB. We therefore store the PNG with R and B swapped, so that the array
// LeRobot hands to the policy is RGB, exactly as with LeRobot's own image server. The preview at
// http://127.0.0.1:<ctl-port>/camera/<name>.png is a normal, unswapped PNG for people.
import { Worker } from 'node:worker_threads';
import { extractScene, geomPoses, lookAt } from './raster.mjs';
import { encodePNG } from './png.mjs';
import { startZmqPub } from './zmq-pub.mjs';

// World frame of sim/so101/model/scene.xml: arm base at the origin, the arm reaches towards +x,
// table top at z = 0, cube at (0.25, -0.11), bowl at (0.20, 0.15). Metres, degrees.
export const CAMERA_PRESETS = {
  up: { pos: [0.22, 0, 0.75], target: [0.22, 0, 0], up: [1, 0, 0], fovy: 50, about: 'top-down, 75 cm above the table, arm base at the bottom of the image' },
  side: { pos: [0.25, -0.62, 0.32], target: [0.15, 0, 0.04], fovy: 50, about: 'from the side (cube side), slightly above the table' },
  front: { pos: [0.78, 0, 0.36], target: [0.1, 0, 0.08], fovy: 50, about: 'facing the arm from the far end of the table' },
  wrist: { mjcf: 'wrist_cam', about: 'the wrist camera mount of the SO-101 model (gripper and what is in front of it)' }
};

// Library items (object scenes) are drawn as their collision hulls in one flat colour per waste fraction: the
// assets' textures (WebP inside the GLBs) are not decoded here. Plastic is the plastic cup's and cutlery's own glTF
// base colour (linear 0.0078 0.0667 0.2706 -> sRGB); paper, glass and metal are set by hand to read as the material.
export const FRACTION_RGB = { paper: [214, 190, 150], plastic: [22, 73, 142], glass: [170, 215, 225], metal: [150, 152, 158] };

/**
 * What a camera draws of an object scene: extractScene() options (the belt frame and slats; item colours) and,
 * per frame, the geoms to hide (slats past the head drum: turned down, not drawn, as in the browser).
 * sc: a tools/sil/lib/plant.mjs loadScene() result. Plain scene: no extras.
 */
export function sceneView({ mj, m, items = [], belt = null }) {
  const id = (n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_BODY.value, n);
  const bodies = new Set(), colors = new Map();
  if (belt) {
    if (id('belt') >= 0) bodies.add(id('belt'));
    for (const s of belt.slats) bodies.add(s.body);
  }
  for (const it of items) if (it.fraction && FRACTION_RGB[it.fraction] && id(it.name) >= 0) colors.set(id(it.name), FRACTION_RGB[it.fraction]);
  const slatGeoms = belt ? belt.slats.map((s) => { const g = []; for (let k = m.body_geomadr[s.body], n = k + m.body_geomnum[s.body]; k < n; k++) g.push(k); return g; }) : [];
  return {
    opts: { bodies, colors },
    floorZ: belt ? -0.2 : -0.05,   // conveyor: the end tote hangs below the table edge (its floor at z = −0.085)
    hide() { const out = []; if (belt) belt.slats.forEach((s, i) => { if (!belt.carrying(i)) out.push(...slatGeoms[i]); }); return out; }
  };
}

/** "up" -> {name: up, preset: up}; "top=up" -> {name: top, preset: up} (name = LeRobot camera_name). */
export function parseCameraSpec(spec) {
  const [name, preset = name] = String(spec).split('=');
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`camera name "${name}": letters, digits, _ . - only`);
  if (!CAMERA_PRESETS[preset]) throw new Error(`unknown camera view "${preset}" (${Object.keys(CAMERA_PRESETS).join(', ')})`);
  return { name, preset };
}

export function parseSize(s) {
  const m = /^(\d+)x(\d+)$/.exec(String(s));
  if (!m) throw new Error(`camera size "${s}": use WIDTHxHEIGHT, e.g. 640x480`);
  const w = +m[1], h = +m[2];
  if (w < 16 || h < 16 || w > 1920 || h > 1080) throw new Error('camera size between 16x16 and 1920x1080');
  return [w, h];
}

/** Camera poses for this instant (fixed presets, or the MJCF camera attached to the wrist). */
export function cameraPoses(mj, m, d, cams) {
  return cams.map(({ name, preset }) => {
    const p = CAMERA_PRESETS[preset];
    if (p.mjcf) {
      const id = mj.mj_name2id(m, mj.mjtObj.mjOBJ_CAMERA.value, p.mjcf);
      if (id < 0) throw new Error(`camera ${p.mjcf} not in the model`);
      return { name, pos: Array.from(d.cam_xpos.subarray(3 * id, 3 * id + 3)), mat: Array.from(d.cam_xmat.subarray(9 * id, 9 * id + 9)), fovy: m.cam_fovy[id] };
    }
    return { name, ...lookAt(p.pos, p.target, p.up), fovy: p.fovy };
  });
}

/**
 * Start the cameras: a render worker and the ZMQ publisher. Call tick() from the physics loop; it
 * hands the current poses to the worker whenever the previous frame is done and 1/fps has passed.
 */
export async function startCameras({ mj, m, d, specs, width = 640, height = 480, fps = 15, port = 5555, host = '127.0.0.1', log = () => {}, view = null }) {
  const cams = specs.map(parseCameraSpec);
  const names = new Set();
  for (const c of cams) { if (names.has(c.name)) throw new Error(`camera "${c.name}" given twice`); names.add(c.name); }
  cameraPoses(mj, m, d, cams);                              // fail early on a bad MJCF camera
  const pub = await startZmqPub({ port, host, log });
  const worker = new Worker(new URL('./camera-worker.mjs', import.meta.url));
  worker.postMessage({ type: 'init', scene: extractScene(m, view ? view.opts : {}), width, height, floorZ: view ? view.floorZ : undefined });
  const latest = new Map();                                 // name -> raw RGB of the last frame (for the preview)
  let busy = false, lastPost = -Infinity, frames = 0, renderMs = 0, closed = false, failed = null;
  const ready = new Promise((resolve) => {
    worker.on('message', (msg) => {
      if (msg.type === 'frame') {
        busy = false; frames++; renderMs = msg.ms;
        for (const [n, raw] of Object.entries(msg.raw)) latest.set(n, raw);
        pub.send(msg.json);
        if (frames === 1) resolve();
      }
    });
  });
  worker.on('error', (e) => { failed = e; log('camera worker failed:', e.message); });
  return {
    cams, width, height, fps, ready,
    get port() { return pub.port; },
    tick(nowS) {
      if (busy || closed || failed || nowS - lastPost < 1 / fps) return false;
      busy = true; lastPost = nowS;
      worker.postMessage({ type: 'render', poses: geomPoses(m, d, view ? view.hide() : null), cams: cameraPoses(mj, m, d, cams), t: Date.now() / 1000 });
      return true;
    },
    /** Normal (unswapped) PNG of the newest frame of one camera, or null. */
    previewPNG(name) { const raw = latest.get(name); return raw ? encodePNG(raw, width, height, { level: 6 }) : null; },
    status() { return { port: pub.port, width, height, fps, frames, renderMs: +renderMs.toFixed(1), subscribers: pub.peers.size, cameras: cams.map((c) => `${c.name}=${c.preset}`) }; },
    close() { closed = true; pub.close(); worker.terminate(); }
  };
}
