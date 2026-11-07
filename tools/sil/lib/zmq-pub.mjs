// Minimal ZeroMQ PUB socket (ZMTP 3.0, NULL security, TCP) in plain Node — printedrobotics.cz.
//
// Just enough of https://rfc.zeromq.org/spec/23/ for LeRobot's built-in ZMQ camera
// (lerobot/cameras/zmq: a pyzmq SUB socket that subscribes to everything) to receive our frames:
// greeting, READY handshake, subscriptions, single-frame messages. No CURVE, no multipart sends.
// Like a real PUB socket it drops messages for a subscriber that cannot keep up (high-water mark),
// so a slow policy never makes the simulation wait.
//
//   const pub = await startZmqPub({ port: 5555 });
//   pub.send('{"images": {...}}');
//   pub.close();
import net from 'node:net';

/** Our 64-byte greeting: signature, version 3.0, mechanism NULL, as-server 0. */
export function greeting() {
  const g = Buffer.alloc(64);
  g[0] = 0xFF; g[9] = 0x7F; g[10] = 3; g[11] = 0;
  g.write('NULL', 12, 'ascii');
  return g;
}
/** A command frame (flags 0x04) with ZMTP metadata properties. */
export function commandFrame(name, props = {}) {
  const parts = [Buffer.from([name.length]), Buffer.from(name, 'ascii')];
  for (const [k, v] of Object.entries(props)) {
    const vb = Buffer.from(v), len = Buffer.alloc(4); len.writeUInt32BE(vb.length);
    parts.push(Buffer.from([k.length]), Buffer.from(k, 'ascii'), len, vb);
  }
  const body = Buffer.concat(parts);
  return Buffer.concat([body.length < 256 ? Buffer.from([0x04, body.length]) : (() => { const h = Buffer.alloc(9); h[0] = 0x06; h.writeBigUInt64BE(BigInt(body.length), 1); return h; })(), body]);
}
/** A single-part message frame. */
export function messageFrame(payload) {
  const b = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (b.length < 256) return Buffer.concat([Buffer.from([0x00, b.length]), b]);
  const h = Buffer.alloc(9); h[0] = 0x02; h.writeBigUInt64BE(BigInt(b.length), 1);
  return Buffer.concat([h, b]);
}
/** Largest frame we accept from a subscriber (they only send READY and subscriptions). */
export const MAX_PEER_FRAME = 65536;

/** Split a byte stream into ZMTP frames; returns { frames: [{flags, body}], rest }. Throws on an oversized frame. */
export function parseFrames(buf, maxFrame = Infinity) {
  const frames = [];
  let p = 0;
  while (p + 2 <= buf.length) {
    const flags = buf[p];
    let size, head;
    if (flags & 0x02) {
      if (p + 9 > buf.length) break;
      const big = buf.readBigUInt64BE(p + 1);
      if (Number.isFinite(maxFrame) && big > BigInt(maxFrame)) throw new Error(`ZMTP frame of ${big} bytes is too large`);
      size = Number(big); head = 9;
    } else { size = buf[p + 1]; head = 2; }
    if (size > maxFrame) throw new Error(`ZMTP frame of ${size} bytes is too large`);
    if (p + head + size > buf.length) break;
    frames.push({ flags, body: buf.subarray(p + head, p + head + size) });
    p += head + size;
  }
  return { frames, rest: buf.subarray(p) };
}

export function startZmqPub({ port = 5555, host = '127.0.0.1', hwmBytes = 8 << 20, log = () => {} } = {}) {
  const peers = new Set();
  const server = net.createServer((sock) => {
    sock.setNoDelay(true);
    const peer = { sock, state: 'greeting', subs: [], buf: Buffer.alloc(0), dropped: 0 };
    sock.write(greeting());
    sock.on('data', (chunk) => {
      // a malformed or hostile peer must never take the runner down: drop that connection only
      try { onData(chunk); } catch (e) { log(`zmq: bad peer (${e.message}), closing`); sock.destroy(); peers.delete(peer); }
    });
    const onData = (chunk) => {
      peer.buf = peer.buf.length ? Buffer.concat([peer.buf, chunk]) : chunk;
      if (peer.buf.length > MAX_PEER_FRAME + 9) throw new Error('too much unparsed input');
      if (peer.state === 'greeting') {
        if (peer.buf.length < 64) return;
        const g = peer.buf.subarray(0, 64);
        if (g[0] !== 0xFF || g[9] !== 0x7F || g[10] < 3 || g.toString('ascii', 12, 16) !== 'NULL') { log('zmq: not a ZMTP 3 / NULL peer, closing'); sock.destroy(); return; }
        peer.buf = peer.buf.subarray(64);
        sock.write(commandFrame('READY', { 'Socket-Type': 'PUB' }));
        peer.state = 'handshake';
      }
      const { frames, rest } = parseFrames(peer.buf, MAX_PEER_FRAME);
      peer.buf = rest;
      for (const fr of frames) {
        if (fr.flags & 0x04) {
          const name = fr.body.toString('ascii', 1, 1 + fr.body[0]), data = fr.body.subarray(1 + fr.body[0]);
          if (fr.body.length < 1 || 1 + fr.body[0] > fr.body.length) throw new Error('truncated command');
          if (name === 'READY') {
            const type = readProps(data)['Socket-Type'];
            if (type !== 'SUB' && type !== 'XSUB') { log(`zmq: peer is ${type}, not SUB; closing`); sock.destroy(); return; }
            peer.state = 'ready'; peers.add(peer);
          } else if (peer.state !== 'ready') throw new Error(`${name} before READY`);
          else if (name === 'SUBSCRIBE') addSub(Buffer.from(data));                       // ZMTP 3.1 style
          else if (name === 'CANCEL') peer.subs = peer.subs.filter((s) => !s.equals(data));
          else if (name === 'ERROR') { sock.destroy(); return; }
        } else if (peer.state !== 'ready') throw new Error('message before READY');
        else if (fr.body.length >= 1) {                                                   // ZMTP 3.0 style
          if (fr.body[0] === 1) addSub(Buffer.from(fr.body.subarray(1)));
          else if (fr.body[0] === 0) { const t = fr.body.subarray(1); peer.subs = peer.subs.filter((s) => !s.equals(t)); }
        }
      }
    };
    const addSub = (t) => { if (peer.subs.length >= 64) throw new Error('too many subscriptions'); peer.subs.push(t); };
    const gone = () => peers.delete(peer);
    sock.on('close', gone); sock.on('error', gone);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({
      server, peers,
      get port() { return server.address().port; },
      /** Publish one message; returns how many subscribers it went to. */
      send(payload) {
        if (!peers.size) return 0;
        const b = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        let frame = null, n = 0;
        for (const p of peers) {
          if (!p.subs.some((s) => b.length >= s.length && b.subarray(0, s.length).equals(s))) continue;
          if (p.sock.writableLength > hwmBytes) { p.dropped++; continue; }
          frame = frame || messageFrame(b);
          p.sock.write(frame); n++;
        }
        return n;
      },
      close() { for (const p of peers) p.sock.destroy(); server.close(); }
    }));
  });
}

/** ZMTP metadata properties; throws on a truncated or malformed list. */
export function readProps(buf) {
  const out = {};
  let p = 0;
  while (p < buf.length) {
    const nl = buf[p];
    if (p + 1 + nl + 4 > buf.length) throw new Error('truncated property name');
    const name = buf.toString('ascii', p + 1, p + 1 + nl); p += 1 + nl;
    const vl = buf.readUInt32BE(p);
    if (p + 4 + vl > buf.length) throw new Error('truncated property value');
    out[name] = buf.toString('utf8', p + 4, p + 4 + vl); p += 4 + vl;
  }
  return out;
}
