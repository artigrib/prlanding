// Fixed-window rate limiter held in RAM only. Keys (client IPs) are never written to disk or
// logs, and the whole map is dropped every window, so nothing outlives ~1 minute.
export class RateLimiter {
  private hits = new Map<string, number>();
  private globalHits = 0;
  private windowStart: number;
  private perKey: number;
  private global: number;
  private windowMs: number;
  private maxKeys: number;
  private now: () => number;

  constructor(perKey: number, global: number, windowMs = 60_000, maxKeys = 50_000, now: () => number = Date.now) {
    this.perKey = perKey;
    this.global = global;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.now = now;
    this.windowStart = now();
  }

  /** True if `key` still has room in the current window (does not count a hit). */
  peek(key: string): boolean {
    if (this.now() - this.windowStart >= this.windowMs) return true;
    return (this.hits.get(key) ?? 0) < this.perKey;
  }

  allow(key: string): boolean {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.hits.clear();
      this.globalHits = 0;
      this.windowStart = t;
    }
    if (this.globalHits >= this.global) return false;
    const n = this.hits.get(key) ?? 0;
    if (n >= this.perKey) return false;
    // Under a flood of distinct keys, stop tracking new keys but keep the global cap.
    if (n === 0 && this.hits.size >= this.maxKeys) return false;
    this.hits.set(key, n + 1);
    this.globalHits++;
    return true;
  }
}
