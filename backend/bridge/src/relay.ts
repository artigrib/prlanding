// WebSocket relay on /tab: Origin check, admission limits, frame cap, message allow-list,
// per-socket message rate limit and a two-way JSON heartbeat.

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import type { Config } from './config.ts';
import { TokenBucket } from './ratelimit.ts';
import type { Registry, Room } from './rooms.ts';
import { log } from './log.ts';
import { isTrustedPeer, trustedCidrs } from './trusted-proxy.ts';

const TAB_TYPES = new Set(['hello', 'ping', 'pong', 'approve', 'result', 'event', 'revoke', 'rotate']);
const HELLO_TIMEOUT_MS = 5000;

export function isDevOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch { return false; }
}

export function tabOriginAllowed(cfg: Config, origin: string | undefined): boolean {
  if (!origin) return false;
  return cfg.tabOrigins.includes(origin) || (cfg.dev && isDevOrigin(origin));
}

let cidrs: ReturnType<typeof trustedCidrs> | undefined;

/** Client IP for rate limits/logs. X-Forwarded-For counts only from a proxy on our Docker network or loopback. */
export function clientIp(cfg: Config, req: IncomingMessage): string {
  cidrs ??= trustedCidrs();
  if (cfg.trustProxy && isTrustedPeer(req.socket.remoteAddress, cidrs)) {
    const xff = req.headers['x-forwarded-for'];
    const v = Array.isArray(xff) ? xff.join(',') : xff;
    if (v) {
      const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1]!;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

export class Relay {
  private wss: WebSocketServer;
  private hb: NodeJS.Timeout;
  private sockets = new Map<WebSocket, { room: Room | null; last: number; bucket: TokenBucket }>();

  private cfg: Config;
  private reg: Registry;
  constructor(cfg: Config, reg: Registry) {
    this.cfg = cfg; this.reg = reg;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: cfg.maxFrameBytes, perMessageDeflate: false, clientTracking: false });
    this.hb = setInterval(() => this.heartbeat(), cfg.hbSec * 1000);
    this.hb.unref();
  }

  /** Handle an HTTP upgrade for /tab. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const reject = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!tabOriginAllowed(this.cfg, req.headers.origin)) { log('tab_reject', { why: 'origin' }); return reject(403, 'Forbidden'); }
    const ip = clientIp(this.cfg, req);
    const why = this.reg.canAdmit(ip);
    if (why) { log('tab_reject', { why }); return reject(why === 'CAPACITY' ? 503 : 429, why === 'CAPACITY' ? 'Service Unavailable' : 'Too Many Requests'); }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws, ip));
  }

  private onSocket(ws: WebSocket, ip: string): void {
    const st = { room: null as Room | null, last: Date.now(), bucket: new TokenBucket(this.cfg.tabMsgsPerSec, this.cfg.tabMsgsPerSec * 2) };
    this.sockets.set(ws, st);
    const helloTimer = setTimeout(() => { if (!st.room) ws.close(4000, 'hello expected'); }, HELLO_TIMEOUT_MS);
    const send = (m: Record<string, unknown>) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ v: 1, ts: Date.now(), ...m })); };

    ws.on('message', (data: RawData, isBinary: boolean) => {
      st.last = Date.now();
      if (isBinary) return ws.close(1003, 'text frames only');
      if (!st.bucket.take()) return ws.close(4429, 'rate limit');
      let msg: any;
      try { msg = JSON.parse(data.toString()); } catch { return ws.close(1007, 'bad json'); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.v !== 1 || !TAB_TYPES.has(msg.t)) return; // drop unknown
      if (!st.room) {
        if (msg.t !== 'hello') return;
        clearTimeout(helloTimer);
        // re-check admission (another socket may have taken the last slot meanwhile)
        if (this.reg.canAdmit(ip)) return ws.close(1013, 'capacity');
        st.room = this.reg.addTab({ send, close: (c, r) => ws.close(c, r) }, ip, msg);
        return;
      }
      if (msg.t === 'hello') return;
      this.reg.onTabMessage(st.room, msg);
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      this.sockets.delete(ws);
      if (st.room) this.reg.removeTab(st.room, 'closed');
    });
    ws.on('error', () => { /* close follows */ });
  }

  private heartbeat(): void {
    const now = Date.now();
    const dead = this.cfg.hbSec * this.cfg.hbMissFactor * 1000;
    for (const [ws, st] of this.sockets) {
      if (now - st.last > dead) {
        if (st.room) this.reg.removeTab(st.room, 'heartbeat');
        st.room = null;
        ws.terminate();
        this.sockets.delete(ws);
        continue;
      }
      if (st.room && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ v: 1, t: 'ping', ts: now }));
    }
    this.reg.sweep();
  }

  get size(): number { return this.sockets.size; }

  close(): void {
    clearInterval(this.hb);
    for (const ws of this.sockets.keys()) ws.terminate();
    this.sockets.clear();
    this.wss.close();
  }
}
