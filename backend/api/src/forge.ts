// Forge job API (invite-only). The api never runs CAD or talks to an LLM: it validates requests, puts
// them on the shared job volume (/jobs) for the forge-worker container and streams the worker's progress.
//
//   GET  /forge/me                         -> {label, jobs_today, jobs_per_day, active, spent_today_usd, daily_usd}
//   POST /forge/jobs        {request,lang} -> 202 {id, status:"queued"}
//   GET  /forge/jobs/:id                   -> state (status, step, cost so far)
//   GET  /forge/jobs/:id/events            -> SSE (text/event-stream), one event per line of events.ndjson
//   GET  /forge/jobs/:id/artifacts         -> list of downloadable files
//   GET  /forge/jobs/:id/artifacts/<name>  -> file (always Content-Disposition: attachment, never rendered)
//   POST /forge/jobs/:id/cancel            -> 202
// Auth: "Authorization: Bearer <invite token>". FORGE_INVITE_TOKENS holds only "label:sha256hex" entries;
// tokens themselves are never stored, compared in constant time per entry and never logged. The SSE
// stream is read with fetch() (not EventSource), so the token never appears in a URL or access log.
// Limits: request length, per-token request rate, jobs per token per day, one queued/running job per
// token, a global queue cap, and the day's spend cap (the worker's ledger in /jobs/spend) checked before
// a job is accepted. The worker enforces the per-job and per-day caps again before every LLM call.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync, appendFileSync, createReadStream } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RateLimiter } from './ratelimit.ts';

export interface TokenEntry {
  label: string;
  hash: Buffer;
}

export interface ForgeConfig {
  jobsDir: string;
  tokens: TokenEntry[];
  allowedOrigins: string[];
  dailyUsd?: number;
  jobsPerTokenPerDay?: number;
  maxQueued?: number;
  maxRequestChars?: number;
  perTokenPerMinute?: number;
  authFailuresPerMinute?: number;
  pollMs?: number;
  heartbeatMs?: number;
  maxStreamMs?: number;
  maxStreamsTotal?: number;
  /** Refuse new jobs when <jobsDir>/worker.heartbeat is older than this (ms); 0 = do not check. */
  heartbeatMaxAgeMs?: number;
  now?: () => number;
}

const TERMINAL = new Set(['done', 'failed', 'budget', 'cancelled', 'timeout', 'refused']);
const ID_RE = /^[0-9a-f]{32}$/;
const LABEL_RE = /^[a-z0-9_-]{1,32}$/;
export const ARTIFACT_RE =
  /^(bundle\.zip|part\.stl|part\.step|design\.py|report\.json|checks\.json|components\.json|render_spec\.json|job\.json|request\.json|PUBLISH\.md|guide\.(cs|en)\.(html|md)|renders\/[a-z0-9-]{1,40}\.(jpg|webp))$/;
const TYPES: Record<string, string> = {
  zip: 'application/zip',
  stl: 'model/stl',
  step: 'model/step',
  json: 'application/json',
  md: 'text/markdown; charset=utf-8',
  html: 'text/plain; charset=utf-8', // a draft fragment: downloaded, never rendered by the api origin
  py: 'text/plain; charset=utf-8',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** "label:sha256hex" entries separated by commas, semicolons or whitespace. Invalid entries are skipped. */
export function parseTokens(raw: string | undefined): TokenEntry[] {
  const out: TokenEntry[] = [];
  for (const part of (raw ?? '').split(/[\s,;]+/)) {
    const m = /^([a-z0-9_-]{1,32}):([0-9a-f]{64})$/i.exec(part.trim());
    if (m && LABEL_RE.test(m[1]!.toLowerCase())) out.push({ label: m[1]!.toLowerCase(), hash: Buffer.from(m[2]!.toLowerCase(), 'hex') });
  }
  return out;
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, data, { mode: 0o660 }); // group = the forge-worker (another uid, same gid)
  renameSync(tmp, path);
}

interface JobMeta {
  label: string;
  created: number;
}

export class Forge {
  private cfg: Required<Omit<ForgeConfig, 'now'>> & { now: () => number };
  private jobs = new Map<string, JobMeta>();
  private perToken: RateLimiter;
  private authFail: RateLimiter;
  private streams = new Map<string, number>();
  private origins: Set<string>;
  private streamsTotal = 0;

  constructor(cfg: ForgeConfig) {
    this.cfg = {
      dailyUsd: 5,
      jobsPerTokenPerDay: 5,
      maxQueued: 5,
      maxRequestChars: 1200,
      perTokenPerMinute: 60,
      authFailuresPerMinute: 10,
      pollMs: 400,
      heartbeatMs: 15_000,
      maxStreamMs: 20 * 60_000,
      maxStreamsTotal: 50,
      heartbeatMaxAgeMs: 120_000,
      now: Date.now,
      ...cfg,
    } as Forge['cfg'];
    const now = this.cfg.now;
    this.perToken = new RateLimiter(this.cfg.perTokenPerMinute, 100_000, 60_000, 10_000, now);
    this.authFail = new RateLimiter(this.cfg.authFailuresPerMinute, 100_000, 60_000, 50_000, now);
    this.origins = new Set(cfg.allowedOrigins);
    mkdirSync(join(this.cfg.jobsDir, 'queue'), { recursive: true, mode: 0o2770 });
    this.loadIndex();
  }

  private loadIndex(): void {
    for (const name of readdirSync(this.cfg.jobsDir)) {
      if (!ID_RE.test(name)) continue;
      const m = readJson(join(this.cfg.jobsDir, name, 'meta.json'));
      if (m && typeof m.label === 'string' && typeof m.created === 'number') this.jobs.set(name, { label: m.label, created: m.created });
    }
  }

  private auth(req: IncomingMessage): string | null {
    const h = req.headers.authorization ?? '';
    const given = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (given.length < 24 || given.length > 200) return null;
    const g = createHash('sha256').update(given, 'utf8').digest();
    let found: string | null = null;
    for (const t of this.cfg.tokens) if (timingSafeEqual(g, t.hash) && found === null) found = t.label; // no early exit
    return found;
  }

  private status(id: string): Record<string, unknown> {
    const st = readJson(join(this.cfg.jobsDir, id, 'state.json')) ?? { status: 'queued' };
    return st;
  }

  private active(label: string): string | null {
    for (const [id, m] of this.jobs) {
      if (m.label !== label) continue;
      if (!existsSync(join(this.cfg.jobsDir, id))) {
        this.jobs.delete(id); // removed by the worker's retention cleanup
        continue;
      }
      const s = this.status(id).status;
      if (typeof s !== 'string' || !TERMINAL.has(s)) return id;
    }
    return null;
  }

  private jobsToday(label: string): number {
    const d = day(this.cfg.now());
    let n = 0;
    for (const m of this.jobs.values()) if (m.label === label && day(m.created) === d) n++;
    return n;
  }

  workerAlive(): boolean {
    if (!this.cfg.heartbeatMaxAgeMs) return true;
    try {
      const t = Number(readFileSync(join(this.cfg.jobsDir, 'worker.heartbeat'), 'utf8').trim()) * 1000;
      return Number.isFinite(t) && this.cfg.now() - t < this.cfg.heartbeatMaxAgeMs;
    } catch {
      return false;
    }
  }

  spentToday(): number {
    const s = readJson(join(this.cfg.jobsDir, 'spend', `${day(this.cfg.now())}.json`));
    return s && typeof s.usd === 'number' ? s.usd : 0;
  }

  private cors(req: IncomingMessage): Record<string, string> | null {
    const origin = req.headers.origin;
    if (!origin) return {};
    if (!this.origins.has(origin)) return null;
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Last-Event-ID',
      'Access-Control-Expose-Headers': 'Content-Disposition',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
  }

  /** Handles every /forge/* request. `clientIp` is only used as an in-memory rate-limit key. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, clientIp: string): Promise<void> {
    const cors = this.cors(req);
    const send = (status: number, body?: unknown, extra: Record<string, string> = {}): void => {
      const h: Record<string, string> = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(cors ?? {}), ...extra };
      if (body === undefined) res.writeHead(status, h).end();
      else res.writeHead(status, { ...h, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
    };
    if (cors === null) return send(403, { error: 'origin' });
    if (req.method === 'OPTIONS') return send(204);

    if (!this.authFail.peek(clientIp)) {
      req.resume();
      return send(429, { error: 'rate' }, { 'Retry-After': '60' });
    }
    const label = this.auth(req);
    if (!label) {
      this.authFail.allow(clientIp);
      req.resume();
      return send(401, { error: 'auth' }, { 'WWW-Authenticate': 'Bearer' });
    }
    if (!this.perToken.allow(label)) {
      req.resume();
      return send(429, { error: 'rate' }, { 'Retry-After': '60' });
    }

    const parts = url.pathname.split('/').filter(Boolean); // ["forge", ...]
    if (parts.length === 2 && parts[1] === 'me' && req.method === 'GET') {
      return send(200, {
        label,
        jobs_today: this.jobsToday(label),
        jobs_per_day: this.cfg.jobsPerTokenPerDay,
        active: this.active(label),
        spent_today_usd: Math.round(this.spentToday() * 100) / 100,
        daily_usd: this.cfg.dailyUsd,
      });
    }
    if (parts.length === 2 && parts[1] === 'jobs' && req.method === 'POST') return this.create(req, label, send);

    const id = parts[2];
    if (parts[1] !== 'jobs' || !id || !ID_RE.test(id)) return send(404, { error: 'not_found' });
    const meta = this.jobs.get(id);
    if (!meta || meta.label !== label) return send(404, { error: 'not_found' }); // other tokens' jobs do not exist for you
    const jobDir = join(this.cfg.jobsDir, id);

    if (parts.length === 3 && req.method === 'GET') {
      return send(200, { id, created: new Date(meta.created).toISOString(), ...this.status(id), artifacts: this.listArtifacts(jobDir) });
    }
    if (parts.length === 4 && parts[3] === 'events' && req.method === 'GET') {
      const n = this.streams.get(label) ?? 0;
      if (n >= 3 || this.streamsTotal >= this.cfg.maxStreamsTotal) return send(429, { error: 'streams' });
      const last = Number.parseInt(String(req.headers['last-event-id'] ?? url.searchParams.get('from') ?? '0'), 10);
      return this.stream(req, res, jobDir, Number.isFinite(last) && last > 0 ? last : 0, label, cors ?? {});
    }
    if (parts.length === 4 && parts[3] === 'artifacts' && req.method === 'GET') return send(200, { id, artifacts: this.listArtifacts(jobDir) });
    if (parts.length >= 5 && parts[3] === 'artifacts' && req.method === 'GET') {
      return this.artifact(res, jobDir, parts.slice(4).join('/'), cors ?? {}, send);
    }
    if (parts.length === 4 && parts[3] === 'cancel' && req.method === 'POST') {
      req.resume();
      const st = this.status(id).status;
      if (typeof st === 'string' && TERMINAL.has(st)) return send(409, { error: 'finished', status: st });
      let wasQueued = false;
      try {
        unlinkSync(join(this.cfg.jobsDir, 'queue', `${id}.json`));
        wasQueued = true;
      } catch {
        /* already taken by the worker */
      }
      if (wasQueued) {
        const t = new Date(this.cfg.now()).toISOString().replace(/\.\d+Z$/, 'Z');
        appendFileSync(join(jobDir, 'events.ndjson'), JSON.stringify({ seq: 1, t, type: 'end', status: 'cancelled', message: 'cancelled before start' }) + '\n');
        writeAtomic(join(jobDir, 'state.json'), JSON.stringify({ status: 'cancelled', step: null, cost_usd: 0, tokens: 0 }));
      } else {
        writeFileSync(join(jobDir, 'cancel'), '');
      }
      return send(202, { id, status: wasQueued ? 'cancelled' : 'cancelling' });
    }
    return send(404, { error: 'not_found' });
  }

  private async create(req: IncomingMessage, label: string, send: (s: number, b?: unknown, h?: Record<string, string>) => void): Promise<void> {
    const raw = await readBody(req, 8192);
    if (raw === null) return send(413, { error: 'size' }, { Connection: 'close' });
    let body: { request?: unknown; lang?: unknown };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return send(400, { error: 'json' });
    }
    if (typeof body !== 'object' || body === null || typeof body.request !== 'string') return send(400, { error: 'request' });
    const text = body.request.normalize('NFC').replace(/\r\n?/g, '\n').trim();
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/.test(text)) return send(400, { error: 'characters' });
    if (text.length < 8 || text.length > this.cfg.maxRequestChars) return send(400, { error: 'length', min: 8, max: this.cfg.maxRequestChars });
    const lang = body.lang === 'en' ? 'en' : 'cs';
    if (this.spentToday() >= this.cfg.dailyUsd) return send(503, { error: 'budget_daily' });
    if (!this.workerAlive()) return send(503, { error: 'worker_down' });
    if (this.active(label)) return send(409, { error: 'busy', active: this.active(label) });
    if (this.jobsToday(label) >= this.cfg.jobsPerTokenPerDay) return send(429, { error: 'quota', jobs_per_day: this.cfg.jobsPerTokenPerDay });
    const queued = readdirSync(join(this.cfg.jobsDir, 'queue')).filter((f) => f.endsWith('.json')).length;
    if (queued >= this.cfg.maxQueued) return send(503, { error: 'queue_full' });

    const id = randomBytes(16).toString('hex');
    const created = this.cfg.now();
    const dir = join(this.cfg.jobsDir, id);
    mkdirSync(dir, { mode: 0o2770 }); // setgid: the worker's files inherit the shared group
    writeAtomic(join(dir, 'meta.json'), JSON.stringify({ id, label, created }));
    writeAtomic(join(dir, 'state.json'), JSON.stringify({ status: 'queued', step: null, cost_usd: 0, tokens: 0 }));
    writeAtomic(join(this.cfg.jobsDir, 'queue', `${id}.json`), JSON.stringify({ id, request: text, lang, created: new Date(created).toISOString() }));
    this.jobs.set(id, { label, created });
    return send(202, { id, status: 'queued', position: queued + 1 });
  }

  private listArtifacts(jobDir: string): string[] {
    const out: string[] = [];
    const base = join(jobDir, 'out');
    const walk = (rel: string, depth: number): void => {
      let names: string[];
      try {
        names = readdirSync(join(base, rel));
      } catch {
        return;
      }
      for (const n of names) {
        const r = rel ? `${rel}/${n}` : n;
        let st;
        try {
          st = lstatSync(join(base, r));
        } catch {
          continue;
        }
        if (st.isDirectory() && depth < 1) walk(r, depth + 1);
        else if (st.isFile() && ARTIFACT_RE.test(r)) out.push(r);
      }
    };
    walk('', 0);
    return out.sort();
  }

  private artifact(
    res: ServerResponse,
    jobDir: string,
    name: string,
    cors: Record<string, string>,
    send: (s: number, b?: unknown, h?: Record<string, string>) => void,
  ): void {
    if (!ARTIFACT_RE.test(name)) return send(404, { error: 'not_found' });
    const base = resolve(jobDir, 'out');
    const p = resolve(base, name);
    if (!p.startsWith(base + sep)) return send(404, { error: 'not_found' });
    let st;
    try {
      // no symlinks anywhere below the job dir (out/, renders/, the file itself)
      if (lstatSync(base).isSymbolicLink()) return send(404, { error: 'not_found' });
      if (name.includes('/') && lstatSync(resolve(base, name.split('/')[0]!)).isSymbolicLink()) return send(404, { error: 'not_found' });
      st = lstatSync(p);
    } catch {
      return send(404, { error: 'not_found' });
    }
    if (!st.isFile() || st.size > 64 * 1024 * 1024) return send(404, { error: 'not_found' });
    const ext = name.split('.').pop() ?? '';
    const file = name.split('/').pop()!;
    res.writeHead(200, {
      ...cors,
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': String(st.size),
      'Content-Disposition': `attachment; filename="${file}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-site',
    });
    createReadStream(p).on('error', () => res.destroy()).pipe(res);
  }

  private stream(req: IncomingMessage, res: ServerResponse, jobDir: string, from: number, label: string, cors: Record<string, string>): void {
    this.streams.set(label, (this.streams.get(label) ?? 0) + 1);
    this.streamsTotal++;
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      Connection: 'keep-alive',
    });
    res.write(`retry: 3000\n: forge ${JSON.stringify(this.status(jobDir.split(sep).pop()!).status ?? 'queued')}\n\n`);
    const path = join(jobDir, 'events.ndjson');
    let offset = 0;
    let rest = '';
    let closed = false;
    const started = this.cfg.now();
    const finish = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      clearInterval(beat);
      this.streams.set(label, Math.max(0, (this.streams.get(label) ?? 1) - 1));
      this.streamsTotal = Math.max(0, this.streamsTotal - 1);
      res.end();
    };
    const tick = (): void => {
      if (closed) return;
      if (this.cfg.now() - started > this.cfg.maxStreamMs) return finish();
      if (!existsSync(path)) return;
      const size = statSync(path).size;
      if (size <= offset) return;
      const fd = openSync(path, 'r');
      const buf = Buffer.alloc(Math.min(size - offset, 4 * 1024 * 1024));
      const n = readSync(fd, buf, 0, buf.length, offset);
      closeSync(fd);
      offset += n;
      const lines = (rest + buf.subarray(0, n).toString('utf8')).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: { seq?: unknown; type?: unknown };
        try {
          ev = JSON.parse(line) as typeof ev;
        } catch {
          continue;
        }
        const seq = typeof ev.seq === 'number' ? ev.seq : 0;
        if (seq <= from) continue;
        res.write(`id: ${seq}\nevent: forge\ndata: ${JSON.stringify(ev)}\n\n`);
        if (ev.type === 'end') return finish();
      }
    };
    const poll = setInterval(tick, this.cfg.pollMs);
    const beat = setInterval(() => !closed && res.write(': ping\n\n'), this.cfg.heartbeatMs);
    req.on('close', finish);
    tick();
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolveBody) => {
    if (Number(req.headers['content-length'] ?? 0) > limit) {
      req.resume();
      resolveBody(null);
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
        resolveBody(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => !done && resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => {
      if (!done) resolveBody(null);
      done = true;
    });
  });
}
