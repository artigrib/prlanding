// Localhost control + live-mirror server for the SIL runner. Node built-ins only. printedrobotics.cz.
//
//   POST /cmd   body: one command line (e.g. "sweep follower")      -> JSON {ok, ...}
//               requires header "X-SIL: 1" (a web page cannot send it cross-origin without a preflight,
//               which this server never answers, so random sites cannot drive the virtual arm)
//   GET  /status                                                       -> JSON state
//   GET  /mirror  (WebSocket upgrade, only with --mirror)              -> JSON state frames, ~30 Hz
//
// Binds 127.0.0.1 only.
import http from 'node:http';
import crypto from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Encode one unmasked server->client WebSocket text frame (RFC 6455 §5.2). */
export function wsFrame(text) {
  const p = Buffer.from(text);
  const n = p.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, p]);
}
export const wsAccept = (key) => crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

export function startServer({ port, mirror = false, extraOrigins = [], onCommand, getStatus }) {
  const clients = new Set();
  const originOk = (o) => !o || LOCAL_ORIGIN.test(o) || extraOrigins.includes(o);
  const server = http.createServer((req, res) => {
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url === '/status') return json(200, getStatus());
    if (req.method === 'POST' && req.url === '/cmd') {
      if (req.headers['x-sil'] !== '1') return json(403, { ok: false, error: 'missing X-SIL header' });
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', async () => {
        try { json(200, { ok: true, ...(await onCommand(body.trim())) }); } catch (e) { json(400, { ok: false, error: e.message }); }
      });
      return;
    }
    json(404, { ok: false, error: 'not found' });
  });
  server.on('upgrade', (req, sock) => {
    const key = req.headers['sec-websocket-key'];
    if (!mirror || req.url !== '/mirror' || !key || !originOk(req.headers.origin)) { sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`);
    sock.setNoDelay(true);
    clients.add(sock);
    sock.on('data', (b) => { if ((b[0] & 0x0f) === 0x8) sock.end(); });   // close frame; other client frames are ignored
    sock.on('close', () => clients.delete(sock));
    sock.on('error', () => clients.delete(sock));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      server,
      clients,
      broadcast(obj) { if (!clients.size) return; const f = wsFrame(JSON.stringify(obj)); for (const c of clients) c.write(f); },
      close() { for (const c of clients) c.destroy(); server.close(); }
    }));
  });
}
