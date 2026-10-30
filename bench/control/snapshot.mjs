// Schematic camera for the headless bench (vision track v0): a flat top or side projection of the table, the arm's
// links, the jaw tip and every active object, as a PNG data URL. No WebGL in node, so this is not the page's 3D render;
// it is identical for every multimodal model, which is what fairness needs. Photoreal renders: SPEC.md (v1).
import zlib from 'node:zlib';

const ARM_BODIES = ['base', 'shoulder', 'upper_arm', 'lower_arm', 'wrist', 'gripper'];
const COLOR = { cube: [232, 70, 30], cube_b: [40, 90, 200], bowl: [40, 90, 200], bowl2: [232, 70, 30], ball: [250, 250, 250], goal: [120, 120, 120] };
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function renderSchematic({ mj, m, d, world, view = 'overview', width = 512 }) {
  const W = Math.min(768, Math.max(160, width | 0)), H = Math.round(W * 0.75);
  const img = Buffer.alloc(W * H * 3, 244);
  const side = view === 'side';
  // world metres -> pixels. top: x forward = up, y left = left. side: x forward = right, z up = up.
  const span = 0.8, s = W / span;
  const px = side ? (p) => [(p[0] + 0.15) * s, H - 20 - p[2] * s] : (p) => [W / 2 - p[1] * s, H - 30 - (p[0] + 0.05) * s];
  const put = (x, y, c) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; };
  const disc = (cx, cy, r, c, ring) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const q = x * x + y * y; if (q <= r * r && (!ring || q >= (r - 2) * (r - 2))) put(cx + x, cy + y, c); } };
  const line = (a, b, c, th = 2) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1; for (let i = 0; i <= n; i++) disc(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, th, c); };
  // grid every 50 mm (table plane or floor line)
  if (side) line(px([-0.2, 0, 0]), px([0.65, 0, 0]), [150, 150, 150], 1);
  else for (let k = -8; k <= 12; k++) { line(px([k * 0.05, -0.4, 0]), px([k * 0.05, 0.4, 0]), [228, 228, 228], 0); line(px([-0.05, k * 0.05, 0]), px([0.6, k * 0.05, 0]), [228, 228, 228], 0); }
  for (const e of world.active()) {
    const p = e.lib ? world.com(e.name, [0, 0, 0]) : world.pos(e.name, [0, 0, 0]);
    const c = COLOR[e.name] || (e.fixture ? [150, 150, 150] : [90, 160, 90]);
    const r = Math.max(4, Math.round((e.half ? e.half : e.size ? Math.max(...e.size) / 2 : e.kind === 'mocap' ? 0.055 : 0.015) * s));
    const [x, y] = px(p);
    if (side && e.kind === 'mocap') line([x - r, y], [x + r, y], c, 2);      // a container seen from the side: its rim line
    else disc(x, y, r, c, e.kind === 'mocap');
  }
  const ids = ARM_BODIES.map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_BODY.value, n)).filter((b) => b >= 0);
  const pts = ids.map((b) => px([d.xpos[3 * b], d.xpos[3 * b + 1], d.xpos[3 * b + 2]]));
  const tipId = mj.mj_name2id(m, mj.mjtObj.mjOBJ_SITE.value, 'gripperframe');
  pts.push(px([d.site_xpos[3 * tipId], d.site_xpos[3 * tipId + 1], d.site_xpos[3 * tipId + 2]]));
  for (let i = 1; i < pts.length; i++) line(pts[i - 1], pts[i], [40, 40, 40], 3);
  disc(pts[0][0], pts[0][1], 8, [40, 40, 40]);
  disc(pts.at(-1)[0], pts.at(-1)[1], 4, [220, 30, 120]);
  return 'data:image/png;base64,' + encodePng(W, H, img).toString('base64');
}
