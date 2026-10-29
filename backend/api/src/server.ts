// HTTP API for printedrobotics.cz (plain node:http, no runtime dependencies).
//   GET  /health, /healthz   -> {"ok":true,"version":"<sha>"}
//   POST /e                  -> analytics batch from assets/track.js (sent only after consent), validated
//                               against schema.json and fanned out to the sinks (src/analytics/), or the
//                               legacy single event name (daily counter only). Never stores IPs or UAs.
//   OPTIONS /e               -> CORS preflight (only for allowed origins)
//   GET  /stats?days=N       -> daily aggregates; requires "Authorization: Bearer <STATS_TOKEN>"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { CounterStore } from './store.ts';
import { RateLimiter } from './ratelimit.ts';
import { isTrustedPeer, trustedCidrs } from './trusted-proxy.ts';
import { BOT_UA, countryFrom, deviceClass, validateBatch, type Schema } from './analytics/validate.ts';
import type { Sink } from './analytics/sinks.ts';

export const EVENTS: ReadonlySet<string> = new Set([
  'sim_start',
  'sim_success',
  'sim_cta',
  'arena_start',
  'arena_end',
  'arena_cta',
  'mcp_connect',
  'mcp_tool',
  'kit_view',
]);

export const MAX_BODY_BYTES = 256; // legacy single-name body

export interface AnalyticsConfig {
  schema: Schema;
  sinks: Sink[];
  /** Request header with an ISO country code set by the edge proxy (read only from trusted peers). */
  countryHeader?: string;
}

export interface ApiConfig {
  store: CounterStore;
  version: string;
  allowedOrigins: string[];
  statsToken?: string;
  trustProxy: boolean;
  perIpPerMinute?: number;
  globalPerMinute?: number;
  analytics?: AnalyticsConfig;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  const h: Record<string, string> = { ...SECURITY_HEADERS, ...headers };
  if (body === undefined) {
    res.writeHead(status, h).end();
    return;
  }
  const json = JSON.stringify(body);
  h['Content-Type'] = 'application/json; charset=utf-8';
  res.writeHead(status, h).end(json);
}

function tokenMatches(given: string, expected: string): boolean {
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

let cidrs: ReturnType<typeof trustedCidrs> | undefined;

function fromTrustedProxy(req: IncomingMessage, trustProxy: boolean): boolean {
  cidrs ??= trustedCidrs();
  return trustProxy && isTrustedPeer(req.socket.remoteAddress, cidrs);
}

function clientKey(req: IncomingMessage, trustProxy: boolean): string {
  if (fromTrustedProxy(req, trustProxy)) {
    // Only a proxy on our own Docker network (or loopback) may set X-Forwarded-For. Caddy
    // replaces the header with the real peer address (no trusted_proxies configured), so the
    // last entry is the client as seen by that proxy.
    const xff = req.headers['x-forwarded-for'];
    const v = Array.isArray(xff) ? xff[xff.length - 1] : xff;
    if (v) {
      const parts = v.split(',');
      return parts[parts.length - 1].trim();
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Parse an event name from a tiny body: either `{"e":"name"}` or the bare name. */
export function parseEvent(raw: string): string | null {
  const s = raw.trim();
  let name: unknown = s;
  if (s.startsWith('{')) {
    try {
      name = (JSON.parse(s) as { e?: unknown }).e;
    } catch {
      return null;
    }
  }
  return typeof name === 'string' && EVENTS.has(name) ? name : null;
}

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) {
      resolve(null);
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      if (!done) resolve(null);
      done = true;
    });
  });
}

export function createApi(cfg: ApiConfig): Server {
  const limiter = new RateLimiter(cfg.perIpPerMinute ?? 60, cfg.globalPerMinute ?? 6000);
  const origins = new Set(cfg.allowedOrigins);

  const corsHeaders = (origin: string): Record<string, string> => ({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if ((path === '/health' || path === '/healthz') && (req.method === 'GET' || req.method === 'HEAD')) {
        const ok = cfg.store.ping();
        send(res, ok ? 200 : 503, { ok, version: cfg.version });
        return;
      }

      if (path === '/e') {
        const origin = req.headers.origin;
        if (!origin || !origins.has(origin)) {
          send(res, 403, { error: 'origin' });
          return;
        }
        const cors = corsHeaders(origin);
        if (req.method === 'OPTIONS') {
          send(res, 204, undefined, cors);
          return;
        }
        if (req.method !== 'POST') {
          send(res, 405, { error: 'method' }, { ...cors, Allow: 'POST, OPTIONS' });
          return;
        }
        if (!limiter.allow(clientKey(req, cfg.trustProxy))) {
          req.resume();
          send(res, 429, { error: 'rate' }, { ...cors, 'Retry-After': '60' });
          return;
        }
        const an = cfg.analytics;
        const body = await readBody(req, an ? an.schema.maxBodyBytes : MAX_BODY_BYTES);
        if (body === null) {
          send(res, 413, { error: 'size' }, { ...cors, Connection: 'close' });
          return;
        }
        const trimmed = body.trim();
        if (an && trimmed.startsWith('{') && trimmed.includes('"events"')) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            send(res, 400, { error: 'json' }, cors);
            return;
          }
          if (BOT_UA.test(req.headers['user-agent'] ?? '')) {
            send(res, 204, undefined, cors); // accepted and ignored
            return;
          }
          const now = Date.now();
          const country =
            an.countryHeader && fromTrustedProxy(req, cfg.trustProxy) ? countryFrom(req.headers[an.countryHeader]) : '';
          const result = validateBatch(an.schema, parsed, { now, country, device: deviceClass(req.headers['user-agent']) });
          if (!result.ok) {
            send(res, 400, { error: 'batch' }, cors);
            return;
          }
          for (const e of result.events) cfg.store.increment(e.event);
          for (const sink of an.sinks) {
            try {
              sink.write(result.events);
            } catch {
              /* one sink never breaks the others */
            }
          }
          send(res, 204, undefined, cors);
          return;
        }
        if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
          send(res, 413, { error: 'size' }, cors);
          return;
        }
        const event = parseEvent(body);
        if (!event) {
          send(res, 400, { error: 'event' }, cors);
          return;
        }
        cfg.store.increment(event);
        send(res, 204, undefined, cors);
        return;
      }

      if (path === '/stats' && req.method === 'GET') {
        if (!cfg.statsToken) {
          send(res, 404, { error: 'not_found' });
          return;
        }
        const auth = req.headers.authorization ?? '';
        const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!given || !tokenMatches(given, cfg.statsToken)) {
          send(res, 401, { error: 'auth' }, { 'WWW-Authenticate': 'Bearer' });
          return;
        }
        const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '30', 10) || 30, 1), 366);
        const names = [...EVENTS, ...(cfg.analytics ? cfg.analytics.schema.events.keys() : [])];
        send(res, 200, {
          days,
          events: names,
          data: cfg.store.query(days),
          sinks: cfg.analytics ? cfg.analytics.sinks.map((s) => s.stats()) : [],
        });
        return;
      }

      send(res, 404, { error: 'not_found' });
    } catch {
      if (!res.headersSent) send(res, 500, { error: 'internal' });
      else res.destroy();
    }
  });

  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  return server;
}
