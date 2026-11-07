// Render worker for tools/sil/lib/camera.mjs: draws every camera, encodes the PNGs (R and B swapped
// for LeRobot's ZMQ camera, see camera.mjs) and builds the ZMQ message. printedrobotics.cz.
import { parentPort } from 'node:worker_threads';
import { renderView } from './raster.mjs';
import { encodePNG } from './png.mjs';

let scene = null, W = 0, H = 0, zbuf = null;
parentPort.on('message', (msg) => {
  if (msg.type === 'init') { scene = msg.scene; W = msg.width; H = msg.height; zbuf = new Float32Array(W * H); return; }
  if (msg.type !== 'render' || !scene) return;
  const t0 = performance.now();
  const timestamps = {}, images = {}, raw = {};
  for (const c of msg.cams) {
    const rgb = new Uint8Array(W * H * 3);
    renderView(scene, msg.poses, c, { width: W, height: H, fovy: c.fovy }, rgb, zbuf);
    images[c.name] = encodePNG(rgb, W, H, { swapRB: true }).toString('base64');
    timestamps[c.name] = msg.t;
    raw[c.name] = rgb;
  }
  const json = JSON.stringify({ timestamps, images });
  parentPort.postMessage({ type: 'frame', json, raw, ms: performance.now() - t0 }, Object.values(raw).map((r) => r.buffer));
});
