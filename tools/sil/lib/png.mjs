// Minimal PNG encoder (8-bit RGB, no filtering) and decoder for our own files — Node built-ins only.
// printedrobotics.cz.
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * Encode an RGB buffer as PNG. `swapRB: true` stores the pixels as B,G,R — see camera.mjs for why
 * LeRobot's ZMQ camera needs that.
 */
export function encodePNG(rgb, width, height, { swapRB = false, level = 1 } = {}) {
  const stride = width * 3, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1), s = y * stride;
    raw[o] = 0;                                              // filter: none
    if (!swapRB) { raw.set(rgb.subarray(s, s + stride), o + 1); continue; }
    for (let x = 0; x < stride; x += 3) { raw[o + 1 + x] = rgb[s + x + 2]; raw[o + 2 + x] = rgb[s + x + 1]; raw[o + 3 + x] = rgb[s + x]; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8 bit, RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0))]);
}

/** Decode a PNG written by encodePNG (8-bit RGB, filter 0) — for tests. */
export function decodePNG(buf) {
  let p = 8, width = 0, height = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (crc32(buf.subarray(p + 4, p + 8 + len)) !== buf.readUInt32BE(p + 8 + len)) throw new Error('PNG CRC mismatch in ' + type);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 2) throw new Error('only 8-bit RGB'); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * 3, rgb = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) { if (raw[y * (stride + 1)] !== 0) throw new Error('only filter 0'); rgb.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride); }
  return { width, height, rgb };
}
