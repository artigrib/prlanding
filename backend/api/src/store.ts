// Daily aggregate counters in SQLite (node:sqlite, no native deps).
// Only (day, event, count) is stored. No IPs, no user agents, no identifiers.
// Increments are buffered in memory and flushed in one transaction every few seconds,
// so a burst of events costs one disk write, not one per request.
import { DatabaseSync } from 'node:sqlite';

export interface DayCounts {
  day: string;
  counts: Record<string, number>;
}

export class CounterStore {
  private db: DatabaseSync;
  private pending = new Map<string, number>(); // key: `${day}\t${event}`
  private timer: NodeJS.Timeout | undefined;

  constructor(path: string, flushMs = 5000) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS daily_counts (
        day   TEXT    NOT NULL,
        event TEXT    NOT NULL,
        n     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, event)
      ) WITHOUT ROWID;
    `);
    if (flushMs > 0) {
      this.timer = setInterval(() => this.flush(), flushMs);
      this.timer.unref();
    }
  }

  increment(event: string, now = new Date()): void {
    const key = `${now.toISOString().slice(0, 10)}\t${event}`;
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
  }

  flush(): void {
    if (this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    const stmt = this.db.prepare(
      'INSERT INTO daily_counts (day, event, n) VALUES (?, ?, ?) ' +
        'ON CONFLICT (day, event) DO UPDATE SET n = n + excluded.n',
    );
    this.db.exec('BEGIN');
    try {
      for (const [key, n] of batch) {
        const [day, event] = key.split('\t');
        stmt.run(day, event, n);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      // Put the counts back so they are retried on the next flush.
      for (const [key, n] of batch) this.pending.set(key, (this.pending.get(key) ?? 0) + n);
      throw err;
    }
  }

  /** Aggregates for the last `days` days (UTC), newest first. Includes unflushed counts. */
  query(days: number, now = new Date()): DayCounts[] {
    this.flush();
    const since = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const rows = this.db
      .prepare('SELECT day, event, n FROM daily_counts WHERE day >= ? ORDER BY day DESC, event')
      .all(since) as Array<{ day: string; event: string; n: number }>;
    const out: DayCounts[] = [];
    for (const r of rows) {
      let last = out[out.length - 1];
      if (!last || last.day !== r.day) {
        last = { day: r.day, counts: {} };
        out.push(last);
      }
      last.counts[r.event] = Number(r.n);
    }
    return out;
  }

  ping(): boolean {
    return this.db.prepare('SELECT 1 AS ok').get() !== undefined;
  }

  private closed = false;

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    try {
      this.flush();
    } finally {
      this.db.close();
    }
  }
}
