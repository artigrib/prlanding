// Virtual serial port for the SIL runner: spawns tools/sil/pty-bridge.py (stdlib Python: pty + termios)
// and exposes it as an event emitter. printedrobotics.cz.
//
//   const port = await openVirtualPort('/tmp/so101-follower');
//   port.on('data', (bytes, baud) => ...);   // what LeRobot wrote, and the baud rate the port is set to
//   port.write(Uint8Array)                   // servo replies back to LeRobot
//   port.close()
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pty-bridge.py');

export function openVirtualPort(link, { python = process.env.SIL_PYTHON || 'python3', baud = 1_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [BRIDGE, '--link', link], { stdio: ['pipe', 'pipe', 'inherit'] });
    const port = new EventEmitter();
    port.link = link; port.baud = baud; port.device = null; port.child = child;
    let buf = Buffer.alloc(0), ready = false;
    child.stdout.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= 3) {
        const type = buf[0], len = buf.readUInt16LE(1);
        if (buf.length < 3 + len) break;
        const payload = buf.subarray(3, 3 + len);
        buf = buf.subarray(3 + len);
        if (type === 0) port.emit('data', new Uint8Array(payload), port.baud);
        else if (type === 1) { const b = payload.readUInt32LE(0); if (b > 0) { port.baud = b; port.emit('baud', b); } }
        else if (type === 2) { port.device = payload.toString(); if (!ready) { ready = true; resolve(port); } }
      }
    });
    child.on('error', (e) => { if (!ready) reject(e); else port.emit('error', e); });
    child.on('exit', (code) => { if (!ready) reject(new Error(`pty-bridge exited (${code}) for ${link}`)); port.emit('close', code); });
    port.write = (bytes) => { if (child.stdin.writable) child.stdin.write(Buffer.from(bytes)); };
    port.close = () => { try { child.kill('SIGTERM'); } catch (e) { /* already gone */ } };
  });
}
