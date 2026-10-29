// Where accepted analytics events go. Every sink gets the same validated EventRecord list.
//   NdjsonSink      always on: append-only, one file per UTC day under /data/events (docker volume);
//                   the raw source of truth until ClickHouse runs, and the backfill source afterwards.
//   ClickHouseSink  on when CLICKHOUSE_URL + CLICKHOUSE_USER + CLICKHOUSE_PASSWORD are set (HTTP, JSONEachRow).
//   AmplitudeSink   on when AMPLITUDE_API_KEY is set (HTTP V2 API, EU endpoint by default).
// Logging: fixed messages with counts and HTTP status codes only. Never keys, URLs with credentials,
// payloads, ids or IPs.
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventRecord } from './validate.ts';

export interface Sink {
  readonly name: string;
  write(events: EventRecord[]): void;
  flush(): Promise<void>;
  stats(): SinkStats;
  close(): Promise<void>;
}

export interface SinkStats {
  name: string;
  accepted: number;
  sent: number;
  dropped: number;
  queued: number;
  lastStatus: number | null;
}

type Log = (msg: Record<string, unknown>) => void;
const defaultLog: Log = (m) => console.log(JSON.stringify(m));

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ NDJSON ------------------------------------------------------------------ */

export interface NdjsonOptions {
  dir: string;
  retentionDays?: number; // files older than this are deleted (default 760 = 25 months)
  flushMs?: number;
  log?: Log;
}

export class NdjsonSink implements Sink {
  readonly name = 'ndjson';
  private buf = new Map<string, string[]>(); // day -> lines
  private timer: NodeJS.Timeout | undefined;
  private st: SinkStats = { name: 'ndjson', accepted: 0, sent: 0, dropped: 0, queued: 0, lastStatus: null };
  private lastPrune = '';
  private chain: Promise<void> = Promise.resolve();
  private opts: Required<NdjsonOptions>;

  constructor(opts: NdjsonOptions) {
    this.opts = { retentionDays: 760, flushMs: 2000, log: defaultLog, ...opts };
    if (this.opts.flushMs > 0) {
      this.timer = setInterval(() => void this.flush(), this.opts.flushMs);
      this.timer.unref();
    }
  }

  write(events: EventRecord[]): void {
    for (const e of events) {
      const k = day(e.received_at);
      let lines = this.buf.get(k);
      if (!lines) this.buf.set(k, (lines = []));
      lines.push(JSON.stringify(e));
      this.st.accepted++;
      this.st.queued++;
    }
  }

  flush(): Promise<void> {
    // serialise flushes so lines of one day are appended in order
    this.chain = this.chain.then(() => this.doFlush()).catch(() => {});
    return this.chain;
  }

  private async doFlush(): Promise<void> {
    if (this.buf.size === 0) return;
    const batch = this.buf;
    this.buf = new Map();
    await mkdir(this.opts.dir, { recursive: true });
    for (const [d, lines] of batch) {
      try {
        await appendFile(join(this.opts.dir, `events-${d}.ndjson`), lines.join('\n') + '\n', { mode: 0o640 });
        this.st.sent += lines.length;
      } catch {
        this.st.dropped += lines.length;
        this.opts.log({ msg: 'sink_error', sink: this.name, dropped: lines.length });
      }
      this.st.queued -= lines.length;
    }
    await this.prune();
  }

  private async prune(now = Date.now()): Promise<void> {
    const today = day(now);
    if (this.lastPrune === today) return;
    this.lastPrune = today;
    const cutoff = day(now - this.opts.retentionDays * 86_400_000);
    try {
      for (const f of await readdir(this.opts.dir)) {
        const m = /^events-(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(f);
        if (m && m[1]! < cutoff) await unlink(join(this.opts.dir, f));
      }
    } catch {
      /* best effort */
    }
  }

  stats(): SinkStats {
    return { ...this.st };
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}

/* ---------------------------------------------------------- batching HTTP sender ----------------------------------------------------------- */

export type Outcome = { ok: true } | { ok: false; retry: boolean; status: number; waitMs?: number };
type Fetch = typeof fetch;

export interface BatcherOptions {
  batchSize: number;
  intervalMs: number;
  maxQueue: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  timeoutMs: number;
  fetch: Fetch;
  log: Log;
}

const BATCHER_DEFAULTS: Omit<BatcherOptions, 'fetch' | 'log'> = {
  batchSize: 100,
  intervalMs: 5000,
  maxQueue: 5000,
  maxAttempts: 8,
  baseBackoffMs: 1000,
  maxBackoffMs: 5 * 60_000,
  timeoutMs: 10_000,
};

/** Queue + one in-flight batch at a time + exponential backoff with jitter. */
export abstract class HttpBatchSink<Row> implements Sink {
  abstract readonly name: string;
  protected o: BatcherOptions;
  private q: Row[] = [];
  private timer: NodeJS.Timeout | undefined;
  private busy: Promise<void> | null = null;
  private attempts = 0;
  private notBefore = 0;
  protected st: SinkStats;

  constructor(name: string, o: Partial<BatcherOptions>) {
    this.o = { ...BATCHER_DEFAULTS, fetch: globalThis.fetch, log: defaultLog, ...o };
    this.st = { name, accepted: 0, sent: 0, dropped: 0, queued: 0, lastStatus: null };
    if (this.o.intervalMs > 0) {
      this.timer = setInterval(() => void this.flush(), this.o.intervalMs);
      this.timer.unref();
    }
  }

  protected abstract toRow(e: EventRecord): Row;
  protected abstract send(rows: Row[], signal: AbortSignal): Promise<Outcome>;

  write(events: EventRecord[]): void {
    for (const e of events) {
      this.q.push(this.toRow(e));
      this.st.accepted++;
    }
    const over = this.q.length - this.o.maxQueue;
    if (over > 0) {
      this.q.splice(0, over); // drop the oldest; the NDJSON file still has them for a backfill
      this.st.dropped += over;
      this.o.log({ msg: 'sink_queue_full', sink: this.name, dropped: over });
    }
    this.st.queued = this.q.length;
    if (this.q.length >= this.o.batchSize) void this.flush();
  }

  /** Send everything that is due. Resolves when the queue is empty or a retry is pending. */
  flush(): Promise<void> {
    if (!this.busy) this.busy = this.drain().finally(() => (this.busy = null));
    return this.busy;
  }

  private async drain(): Promise<void> {
    while (this.q.length && Date.now() >= this.notBefore) {
      const rows = this.q.slice(0, this.o.batchSize);
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), this.o.timeoutMs);
      let res: Outcome;
      try {
        res = await this.send(rows, ctl.signal);
      } catch {
        res = { ok: false, retry: true, status: 0 };
      } finally {
        clearTimeout(t);
      }
      if (res.ok) {
        this.q.splice(0, rows.length);
        this.st.sent += rows.length;
        this.st.lastStatus = 200;
        this.attempts = 0;
      } else {
        this.st.lastStatus = res.status;
        this.attempts++;
        if (!res.retry || this.attempts >= this.o.maxAttempts) {
          this.q.splice(0, rows.length);
          this.st.dropped += rows.length;
          this.attempts = 0;
          this.o.log({ msg: 'sink_drop', sink: this.name, status: res.status, dropped: rows.length });
        } else {
          const exp = Math.min(this.o.maxBackoffMs, this.o.baseBackoffMs * 2 ** (this.attempts - 1));
          const wait = Math.max(res.waitMs ?? 0, Math.round(exp * (0.5 + Math.random() / 2)));
          this.notBefore = Date.now() + wait;
          this.o.log({ msg: 'sink_retry', sink: this.name, status: res.status, attempt: this.attempts, wait_ms: wait });
        }
      }
      this.st.queued = this.q.length;
    }
  }

  stats(): SinkStats {
    return { ...this.st, queued: this.q.length };
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.notBefore = 0;
    await this.flush();
  }
}

/* ---------------------------------------------------------------- ClickHouse --------------------------------------------------------------- */

export interface ClickHouseOptions extends Partial<BatcherOptions> {
  url: string; // e.g. https://<service>.<region>.clickhouse.cloud:8443
  user: string;
  password: string;
  database?: string;
  table?: string;
}

export interface ClickHouseRow {
  received_at: string;
  event_time: string;
  event: string;
  anon_id: string;
  session_id: number;
  seq: number;
  insert_id: string;
  path: string;
  lang: string;
  country: string;
  device: string;
  schema_version: number;
  props: Record<string, string>;
}

const chTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '');

export class ClickHouseSink extends HttpBatchSink<ClickHouseRow> {
  readonly name = 'clickhouse';
  private endpoint: string;
  private headers: Record<string, string>;

  constructor(opts: ClickHouseOptions) {
    super('clickhouse', { batchSize: 500, intervalMs: 10_000, ...opts });
    const db = opts.database ?? 'analytics';
    const table = opts.table ?? 'events';
    if (!/^[A-Za-z0-9_]+$/.test(db) || !/^[A-Za-z0-9_]+$/.test(table)) throw new Error('clickhouse: bad database/table name');
    const q = new URLSearchParams({
      query: `INSERT INTO ${db}.${table} FORMAT JSONEachRow`,
      async_insert: '1',
      wait_for_async_insert: '1',
      input_format_skip_unknown_fields: '1',
    });
    this.endpoint = opts.url.replace(/\/+$/, '') + '/?' + q.toString();
    this.headers = {
      'Content-Type': 'application/x-ndjson',
      'X-ClickHouse-User': opts.user,
      'X-ClickHouse-Key': opts.password,
    };
  }

  protected toRow(e: EventRecord): ClickHouseRow {
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.props)) props[k] = String(v);
    return {
      received_at: chTime(e.received_at),
      event_time: chTime(e.time),
      event: e.event,
      anon_id: e.anon_id,
      session_id: e.session_id,
      seq: e.seq,
      insert_id: e.insert_id,
      path: e.path,
      lang: e.lang,
      country: e.country,
      device: e.device,
      schema_version: e.schema_version,
      props,
    };
  }

  protected async send(rows: ClickHouseRow[], signal: AbortSignal): Promise<Outcome> {
    const r = await this.o.fetch(this.endpoint, {
      method: 'POST',
      headers: this.headers,
      body: rows.map((x) => JSON.stringify(x)).join('\n') + '\n',
      signal,
    });
    await r.arrayBuffer().catch(() => undefined); // drain; the body is never logged
    if (r.ok) return { ok: true };
    return { ok: false, retry: r.status === 429 || r.status >= 500, status: r.status };
  }
}

/* ---------------------------------------------------------------- Amplitude ---------------------------------------------------------------- */

export const AMPLITUDE_EU = 'https://api.eu.amplitude.com/2/httpapi';

export interface AmplitudeOptions extends Partial<BatcherOptions> {
  apiKey: string;
  endpoint?: string;
}

export interface AmplitudeEvent {
  device_id: string;
  session_id: number;
  event_type: string;
  time: number;
  insert_id: string;
  platform: string;
  language?: string;
  country?: string;
  event_properties: Record<string, string | number | boolean>;
}

export class AmplitudeSink extends HttpBatchSink<AmplitudeEvent> {
  readonly name = 'amplitude';
  private endpoint: string;
  private key: string;

  constructor(opts: AmplitudeOptions) {
    // Free plan guidance: at most 10 events per batch.
    super('amplitude', { batchSize: 10, intervalMs: 3000, ...opts });
    this.endpoint = opts.endpoint ?? AMPLITUDE_EU;
    this.key = opts.apiKey;
  }

  protected toRow(e: EventRecord): AmplitudeEvent {
    // No `ip` field: Amplitude then has no visitor IP (the request comes from our server, never the browser).
    // No user_id, no user properties: device_id is the random anonymous id from the browser.
    const ev: AmplitudeEvent = {
      device_id: e.anon_id,
      session_id: e.session_id,
      event_type: e.event,
      time: e.time,
      insert_id: e.insert_id,
      platform: 'Web',
      event_properties: { ...e.props, path: e.path, device: e.device },
    };
    if (e.lang) ev.language = e.lang;
    if (e.country) ev.country = e.country;
    return ev;
  }

  protected async send(rows: AmplitudeEvent[], signal: AbortSignal): Promise<Outcome> {
    const r = await this.o.fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: '*/*' },
      body: JSON.stringify({ api_key: this.key, events: rows }),
      signal,
    });
    await r.arrayBuffer().catch(() => undefined); // the response may echo details; never logged
    if (r.ok) return { ok: true };
    // 429: pause 30 s per the API docs; 5xx: retry (insert_id deduplicates); 400/413: drop
    if (r.status === 429) return { ok: false, retry: true, status: 429, waitMs: 30_000 };
    return { ok: false, retry: r.status >= 500, status: r.status };
  }
}

/* ------------------------------------------------------------------ factory ----------------------------------------------------------------- */

export interface SinkEnv {
  ANALYTICS_DIR?: string;
  ANALYTICS_RETENTION_DAYS?: string;
  CLICKHOUSE_URL?: string;
  CLICKHOUSE_USER?: string;
  CLICKHOUSE_PASSWORD?: string;
  CLICKHOUSE_DATABASE?: string;
  CLICKHOUSE_TABLE?: string;
  AMPLITUDE_API_KEY?: string;
  AMPLITUDE_ENDPOINT?: string;
}

/** Sinks from the environment. Empty / missing values switch a sink off. */
export function sinksFromEnv(env: SinkEnv, log: Log = defaultLog): Sink[] {
  const sinks: Sink[] = [
    new NdjsonSink({
      dir: env.ANALYTICS_DIR || '/data/events',
      retentionDays: Number(env.ANALYTICS_RETENTION_DAYS) > 0 ? Number(env.ANALYTICS_RETENTION_DAYS) : 760,
      log,
    }),
  ];
  const chUrl = (env.CLICKHOUSE_URL ?? '').trim();
  if (chUrl && env.CLICKHOUSE_USER && env.CLICKHOUSE_PASSWORD) {
    if (!/^https:\/\//.test(chUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(chUrl)) {
      log({ msg: 'sink_config', sink: 'clickhouse', ok: false, reason: 'url must be https' });
    } else {
      sinks.push(
        new ClickHouseSink({
          url: chUrl,
          user: env.CLICKHOUSE_USER,
          password: env.CLICKHOUSE_PASSWORD,
          database: env.CLICKHOUSE_DATABASE || 'analytics',
          table: env.CLICKHOUSE_TABLE || 'events',
          log,
        }),
      );
    }
  }
  const key = (env.AMPLITUDE_API_KEY ?? '').trim();
  if (key) sinks.push(new AmplitudeSink({ apiKey: key, endpoint: env.AMPLITUDE_ENDPOINT || AMPLITUDE_EU, log }));
  return sinks;
}
