// Room registry: one room per connected tab. Pairing codes, the Allow handshake, session handles,
// call routing with deadlines/cancellation, idempotency, rate limits. Transport-agnostic: the relay
// gives each room a TabLink; unit tests use a fake one.

import { formatCode, hamming, keyOf, newCode, newId, newSessionHandle, normalizeCode, SESSION_RE } from './codes.ts';
import type { Config } from './config.ts';
import { FailureGate, KeyedBuckets, TokenBucket } from './ratelimit.ts';
import { sanitizeClientName, sanitizeErrorCode, sanitizeImage, sanitizeStructured } from './sanitize.ts';
import { deadlineFor as deadlineOf, MISSIONS, VIEWS, type ErrorCode } from './schemas.ts';
import { log } from './log.ts';

export class BridgeError extends Error {
  code: ErrorCode;
  details?: Record<string, unknown>;
  constructor(code: ErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

export interface TabLink {
  send(msg: Record<string, unknown>): void;
  close(code: number, reason: string): void;
}

export interface TabResult {
  structured: Record<string, unknown>;
  image?: { mimeType: 'image/jpeg' | 'image/png'; data: string; bytes: number };
  dropped: number;
}

type Decision = 'allow' | 'deny' | 'timeout' | 'cancelled';
type EndReason = 'closed' | 'revoked' | 'heartbeat' | 'expired' | 'replaced' | 'shutdown';

interface PendingCall {
  tool: string;
  resolve: (r: TabResult) => void;
  reject: (e: BridgeError) => void;
  timer: NodeJS.Timeout;
  session: Session;
}

interface Pending {
  pairId: string;
  resolve: (decision: Decision) => void;
  timer: NodeJS.Timeout;
}

export interface Session {
  handle: string;
  key: string;
  room: Room;
  createdAt: number;
  lastUsed: number;
  client: string;
  calls: TokenBucket;
  snaps: TokenBucket;
  inflight: number;
  idem: Map<string, { at: number; argsKey: string; promise: Promise<TabResult> }>;
}

export interface Room {
  id: string;
  ip: string;
  link: TabLink;
  createdAt: number;
  lastSeen: number;
  code: string | null;
  codeExp: number;
  codeFails: number;
  pending: Pending | null;
  session: Session | null;
  calls: Map<string, PendingCall>;
  caps: { views: string[]; missions: string[] };
  closed: boolean;
}

export class Registry {
  readonly rooms = new Map<string, Room>();
  private codes = new Map<string, Room>();          // canonical code -> room
  private sessions = new Map<string, Session>();    // keyOf(handle) -> session
  private tombstones = new Map<string, { reason: EndReason; at: number }>();
  private tabsPerIp = new Map<string, number>();
  private connectBuckets: KeyedBuckets;
  private gate: FailureGate;
  readonly stats = { pairOk: 0, pairFail: 0, pairDenied: 0, calls: 0, callErrors: 0, rateLimited: 0 };

  readonly cfg: Config;
  private now: () => number;
  constructor(cfg: Config, now: () => number = Date.now) {
    this.cfg = cfg; this.now = now;
    this.connectBuckets = new KeyedBuckets(cfg.connectPerMin / 60, cfg.connectPerMin, now);
    this.gate = new FailureGate(cfg.connectFailsPer10Min, 10 * 60_000, cfg.connectCooldownMs, now);
  }

  get sessionCount(): number { return this.sessions.size; }

  // ---------------- tabs ----------------

  /** Admission check before the WebSocket upgrade completes. */
  canAdmit(ip: string): ErrorCode | null {
    if (this.rooms.size >= this.cfg.maxRooms) return 'CAPACITY';
    if ((this.tabsPerIp.get(ip) || 0) >= this.cfg.maxTabsPerIp) return 'RATE_LIMITED';
    return null;
  }

  addTab(link: TabLink, ip: string, hello: Record<string, any>): Room {
    const caps = hello && typeof hello.capabilities === 'object' && hello.capabilities ? hello.capabilities : {};
    const room: Room = {
      id: newId('r_'), ip, link, createdAt: this.now(), lastSeen: this.now(),
      code: null, codeExp: 0, codeFails: 0, pending: null, session: null, calls: new Map(),
      caps: {
        views: Array.isArray(caps.views) ? caps.views.filter((v: unknown) => (VIEWS as readonly unknown[]).includes(v)) : ['overview'],
        missions: Array.isArray(caps.missions) ? caps.missions.filter((m: unknown) => typeof m === 'string' && m in MISSIONS).slice(0, 32) : []
      },
      closed: false
    };
    this.rooms.set(room.id, room);
    this.tabsPerIp.set(ip, (this.tabsPerIp.get(ip) || 0) + 1);
    this.issueCode(room, 'welcome');
    log('tab_open', { rooms: this.rooms.size });
    return room;
  }

  private issueCode(room: Room, t: 'welcome' | 'code'): void {
    if (room.code) this.codes.delete(room.code);
    let c = newCode();
    while (this.codes.has(c)) c = newCode();
    room.code = c;
    room.codeExp = this.now() + this.cfg.codeTtlMs;
    room.codeFails = 0;
    this.codes.set(c, room);
    const msg: Record<string, unknown> = { t, code: formatCode(c), codeExp: room.codeExp, ttlMs: this.cfg.codeTtlMs };
    if (t === 'welcome') Object.assign(msg, { room: room.id, hb: this.cfg.hbSec, maxFrameBytes: this.cfg.maxFrameBytes });
    room.link.send(msg);
  }

  private burnCode(room: Room): void {
    if (room.code) this.codes.delete(room.code);
    room.code = null;
    room.codeExp = 0;
  }

  removeTab(room: Room, reason: EndReason): void {
    if (room.closed) return;
    room.closed = true;
    this.burnCode(room);
    if (room.pending) { clearTimeout(room.pending.timer); room.pending.resolve('cancelled'); room.pending = null; }
    this.endSession(room, reason, false);
    this.rooms.delete(room.id);
    const n = (this.tabsPerIp.get(room.ip) || 1) - 1;
    if (n <= 0) this.tabsPerIp.delete(room.ip); else this.tabsPerIp.set(room.ip, n);
    log('tab_close', { reason, rooms: this.rooms.size, sessions: this.sessions.size });
  }

  /** End the room's session (if any), fail its in-flight calls fast, remember why for later calls. */
  private endSession(room: Room, reason: EndReason, notifyTab: boolean): void {
    for (const [id, c] of room.calls) {
      clearTimeout(c.timer);
      c.reject(new BridgeError('TAB_GONE', { reason }));
      room.calls.delete(id);
    }
    const s = room.session;
    if (!s) return;
    this.sessions.delete(s.key);
    this.tombstones.set(s.key, { reason, at: this.now() });
    room.session = null;
    if (notifyTab && !room.closed) {
      room.link.send({ t: 'unpaired', reason });
      this.issueCode(room, 'code');
    }
  }

  onTabMessage(room: Room, msg: Record<string, any>): void {
    room.lastSeen = this.now();
    switch (msg.t) {
      case 'ping': room.link.send({ t: 'pong', id: typeof msg.id === 'string' ? msg.id.slice(0, 64) : undefined }); return;
      case 'pong': return;
      case 'approve': {
        const p = room.pending;
        if (!p || msg.pairId !== p.pairId) return;
        clearTimeout(p.timer);
        room.pending = null;
        p.resolve(msg.decision === 'allow' ? 'allow' : 'deny');
        return;
      }
      case 'result': return this.onResult(room, msg);
      case 'revoke': return this.endSession(room, 'revoked', true);
      case 'rotate': if (!room.session && !room.pending) this.issueCode(room, 'code'); return;
      case 'event': return; // estop etc. are reflected in the tab's own result meta; nothing to relay unprompted
      default: return;      // unknown types are dropped
    }
  }

  private onResult(room: Room, msg: Record<string, any>): void {
    const id = typeof msg.id === 'string' ? msg.id : '';
    const c = room.calls.get(id);
    if (!c) return;
    room.calls.delete(id);
    clearTimeout(c.timer);
    if (msg.ok === true) {
      const s = sanitizeStructured(msg.structured ?? {});
      if (!s) return c.reject(new BridgeError('TAB_ERROR', { reason: 'bad_result' }));
      let image: TabResult['image'];
      if (msg.image != null) {
        const img = sanitizeImage(msg.image);
        if (!img) return c.reject(new BridgeError('TAB_ERROR', { reason: 'bad_image' }));
        image = img;
      }
      c.resolve({ structured: s.value, image, dropped: s.dropped });
    } else {
      const e = msg.error && typeof msg.error === 'object' ? msg.error : {};
      const det = sanitizeStructured(e.details ?? {});
      c.reject(new BridgeError(sanitizeErrorCode(e.code), det?.value));
    }
  }

  // ---------------- pairing ----------------

  async connect(codeInput: string, ip: string, clientName: string, signal?: AbortSignal): Promise<{ session: string; room: Room }> {
    const blocked = this.gate.blocked(ip);
    if (blocked) { this.stats.rateLimited++; throw new BridgeError('RATE_LIMITED', { retry_after_ms: blocked }); }
    if (!this.connectBuckets.take(ip)) { this.stats.rateLimited++; throw new BridgeError('RATE_LIMITED', { retry_after_ms: 3000 }); }

    const code = normalizeCode(codeInput);
    const room = code ? this.codes.get(code) : undefined;
    if (!code || !room) {
      this.gate.fail(ip);
      this.stats.pairFail++;
      if (code) this.chargeNearMisses(code);
      throw new BridgeError('PAIRING_FAILED');
    }
    if (room.codeExp <= this.now()) {
      this.gate.fail(ip);
      this.stats.pairFail++;
      this.issueCode(room, 'code');
      throw new BridgeError('PAIRING_FAILED', { reason: 'expired' });
    }
    if (room.pending) {
      // Same answer and same failure accounting as a wrong code: a distinct BUSY here would tell
      // a guesser that the code is valid (someone else is pairing with it right now).
      this.gate.fail(ip);
      this.stats.pairFail++;
      throw new BridgeError('PAIRING_FAILED');
    }
    if (this.sessions.size >= this.cfg.maxSessions) throw new BridgeError('CAPACITY', { max_sessions: this.cfg.maxSessions });

    const pairId = newId('p_');
    const name = sanitizeClientName(clientName);
    const decision = await new Promise<Decision>((resolve) => {
      const timer = setTimeout(() => { room.pending = null; resolve('timeout'); }, this.cfg.approvalTimeoutMs);
      room.pending = { pairId, resolve, timer };
      signal?.addEventListener('abort', () => {
        if (room.pending?.pairId !== pairId) return;
        clearTimeout(timer); room.pending = null; resolve('cancelled');
      }, { once: true });
      room.link.send({ t: 'pair_request', pairId, client: { name }, expiresMs: this.cfg.approvalTimeoutMs });
    });

    if (room.closed) throw new BridgeError('TAB_GONE', { reason: 'closed' });
    if (decision !== 'allow') {
      if (decision !== 'deny') room.link.send({ t: 'pair_cancel', pairId, reason: decision });
      if (decision === 'cancelled') throw new BridgeError('CANCELLED');
      this.stats.pairDenied++;
      this.gate.fail(ip);
      // A denial means someone the user did not expect has the code: rotate it at once.
      // A timeout counts as one wrong try against the code.
      if (decision === 'deny' || ++room.codeFails >= this.cfg.codeMaxFails) this.issueCode(room, 'code');
      throw new BridgeError('PAIRING_DENIED', { reason: decision });
    }
    if (room.session || room.code !== code) throw new BridgeError('PAIRING_FAILED', { reason: 'superseded' });
    if (this.sessions.size >= this.cfg.maxSessions) throw new BridgeError('CAPACITY', { max_sessions: this.cfg.maxSessions });

    this.burnCode(room); // single use
    const handle = newSessionHandle();
    const s: Session = {
      handle, key: keyOf(handle), room, createdAt: this.now(), lastUsed: this.now(), client: name,
      calls: new TokenBucket(this.cfg.callsPerSec, this.cfg.callsBurst, this.now),
      snaps: new TokenBucket(this.cfg.snapshotsPerSec, 2, this.now),
      inflight: 0, idem: new Map()
    };
    room.session = s;
    this.sessions.set(s.key, s);
    room.link.send({ t: 'paired', client: { name } });
    this.stats.pairOk++;
    log('paired', { sessions: this.sessions.size });
    return { session: handle, room };
  }

  /** Wrong guesses within Hamming distance 1 of a live code count against that code (typos/targeted guessing). */
  private chargeNearMisses(code: string): void {
    for (const [c, room] of this.codes) {
      if (hamming(c, code) <= 1 && ++room.codeFails >= this.cfg.codeMaxFails) this.issueCode(room, 'code');
    }
  }

  // ---------------- calls ----------------

  resolveSession(handle: unknown): Session {
    if (typeof handle !== 'string' || !SESSION_RE.test(handle)) throw new BridgeError('NOT_CONNECTED');
    const key = keyOf(handle);
    const s = this.sessions.get(key);
    if (!s) {
      const t = this.tombstones.get(key);
      if (t) throw new BridgeError('TAB_GONE', { reason: t.reason });
      throw new BridgeError('NOT_CONNECTED');
    }
    const t = this.now();
    if (t - s.lastUsed > this.cfg.sessionIdleMs || t - s.createdAt > this.cfg.sessionMaxMs) {
      this.endSession(s.room, 'expired', true);
      throw new BridgeError('TAB_GONE', { reason: 'expired' });
    }
    return s;
  }

  async call(handle: unknown, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<TabResult> {
    const s = this.resolveSession(handle);
    const { session: _omit, ...fwd } = args; // the tab never sees the handle
    const argsKey = JSON.stringify(fwd);
    if (argsKey.length > this.cfg.maxArgsBytes) throw new BridgeError('INVALID_ARGUMENT', { reason: 'args_too_large', max_bytes: this.cfg.maxArgsBytes });

    const rid = typeof fwd.request_id === 'string' ? tool + ':' + fwd.request_id : null;
    if (rid) {
      const hit = s.idem.get(rid);
      if (hit && this.now() - hit.at < this.cfg.idempotencyTtlMs) {
        if (hit.argsKey !== argsKey) throw new BridgeError('INVALID_ARGUMENT', { reason: 'request_id_reused_with_different_args' });
        s.lastUsed = this.now();
        return hit.promise;
      }
    }
    if (tool !== 'stop') {
      if (!s.calls.take()) { this.stats.rateLimited++; throw new BridgeError('RATE_LIMITED', { retry_after_ms: s.calls.waitMs() }); }
      if (tool === 'snapshot' && !s.snaps.take()) { this.stats.rateLimited++; throw new BridgeError('RATE_LIMITED', { retry_after_ms: s.snaps.waitMs() }); }
      if (s.inflight >= this.cfg.maxInflightPerSession) throw new BridgeError('BUSY', { reason: 'too_many_inflight', max: this.cfg.maxInflightPerSession });
    }
    s.lastUsed = this.now();
    const p = this.dispatch(s, tool, fwd, signal);
    if (rid) {
      if (s.idem.size >= 256) this.pruneIdem(s, true);
      s.idem.set(rid, { at: this.now(), argsKey, promise: p });
      p.catch(() => {});
    }
    return p;
  }

  private dispatch(s: Session, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<TabResult> {
    const room = s.room;
    const id = newId('c_');
    const deadlineMs = deadlineOf(tool, args, this.cfg.snapshotDeadlineMs);
    this.stats.calls++;
    s.inflight++;
    return new Promise<TabResult>((resolve, reject) => {
      const done = () => { s.inflight--; };
      const timer = setTimeout(() => {
        if (!room.calls.delete(id)) return;
        done();
        room.link.send({ t: 'cancel', id, reason: 'deadline' });
        reject(new BridgeError('TIMEOUT', { deadline_ms: deadlineMs }));
      }, deadlineMs + 1500);
      room.calls.set(id, {
        tool, session: s, timer,
        resolve: (r) => { done(); resolve(r); },
        reject: (e) => { done(); this.stats.callErrors++; reject(e); }
      });
      signal?.addEventListener('abort', () => {
        const c = room.calls.get(id);
        if (!c) return;
        room.calls.delete(id);
        clearTimeout(c.timer);
        room.link.send({ t: 'cancel', id, reason: 'client' });
        c.reject(new BridgeError('CANCELLED'));
      }, { once: true });
      room.link.send({ t: 'call', id, tool, args, deadlineMs });
    });
  }

  private pruneIdem(s: Session, force = false): void {
    const t = this.now();
    for (const [k, v] of s.idem) if (force || t - v.at >= this.cfg.idempotencyTtlMs) { s.idem.delete(k); if (force && s.idem.size < 128) break; }
  }

  // ---------------- housekeeping ----------------

  /** Called every few seconds: heartbeats are checked by the relay; here codes, sessions, caches. */
  sweep(): void {
    const t = this.now();
    for (const room of this.rooms.values()) {
      if (room.code && room.codeExp <= t && !room.pending) this.issueCode(room, 'code');
      const s = room.session;
      if (s) {
        if (t - s.lastUsed > this.cfg.sessionIdleMs || t - s.createdAt > this.cfg.sessionMaxMs) this.endSession(room, 'expired', true);
        else this.pruneIdem(s);
      }
    }
    for (const [k, v] of this.tombstones) if (t - v.at > this.cfg.tombstoneMs) this.tombstones.delete(k);
    this.connectBuckets.sweep();
    this.gate.sweep();
  }

  shutdown(): void {
    for (const room of [...this.rooms.values()]) {
      room.link.send({ t: 'bye', reason: 'server_restart' });
      this.removeTab(room, 'shutdown');
      room.link.close(1012, 'server restart');
    }
  }
}

