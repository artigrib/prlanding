// In-memory token buckets and windowed counters. Single process, no persistence (by design).

export type Clock = () => number;

export class TokenBucket {
  private tokens: number;
  private last: number;
  private ratePerSec: number;
  private burst: number;
  private now: Clock;
  constructor(ratePerSec: number, burst: number, now: Clock = Date.now) {
    this.ratePerSec = ratePerSec; this.burst = burst; this.now = now;
    this.tokens = burst;
    this.last = now();
  }
  take(n = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.ratePerSec);
    this.last = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
  /** ms until n tokens are available */
  waitMs(n = 1): number {
    return this.tokens >= n ? 0 : Math.ceil(((n - this.tokens) / this.ratePerSec) * 1000);
  }
}

/** Keyed buckets with lazy cleanup of idle keys. */
export class KeyedBuckets {
  private m = new Map<string, { b: TokenBucket; seen: number }>();
  private ratePerSec: number;
  private burst: number;
  private now: Clock;
  private maxKeys: number;
  constructor(ratePerSec: number, burst: number, now: Clock = Date.now, maxKeys = 50_000) {
    this.ratePerSec = ratePerSec; this.burst = burst; this.now = now; this.maxKeys = maxKeys;
  }
  take(key: string, n = 1): boolean {
    let e = this.m.get(key);
    if (!e) {
      if (this.m.size >= this.maxKeys) this.sweep(true);
      e = { b: new TokenBucket(this.ratePerSec, this.burst, this.now), seen: 0 };
      this.m.set(key, e);
    }
    e.seen = this.now();
    return e.b.take(n);
  }
  sweep(force = false): void {
    const idle = (this.burst / this.ratePerSec) * 1000;
    const t = this.now();
    for (const [k, e] of this.m) if (force || t - e.seen > idle) this.m.delete(k);
  }
  get size(): number { return this.m.size; }
}

/**
 * Per-IP failure tracking for `connect`: N failures inside a sliding window put the IP
 * into a cool-down during which every attempt is refused without looking at the code.
 */
export class FailureGate {
  private m = new Map<string, { fails: number[]; until: number }>();
  private maxFails: number;
  private windowMs: number;
  private cooldownMs: number;
  private now: Clock;
  constructor(maxFails: number, windowMs: number, cooldownMs: number, now: Clock = Date.now) {
    this.maxFails = maxFails; this.windowMs = windowMs; this.cooldownMs = cooldownMs; this.now = now;
  }
  blocked(key: string): number {
    const e = this.m.get(key);
    const t = this.now();
    return e && e.until > t ? e.until - t : 0;
  }
  fail(key: string): void {
    const t = this.now();
    let e = this.m.get(key);
    if (!e) { e = { fails: [], until: 0 }; this.m.set(key, e); }
    e.fails = e.fails.filter((x) => t - x < this.windowMs);
    e.fails.push(t);
    if (e.fails.length >= this.maxFails) { e.until = t + this.cooldownMs; e.fails = []; }
  }
  sweep(): void {
    const t = this.now();
    for (const [k, e] of this.m) if (e.until <= t && e.fails.every((x) => t - x >= this.windowMs)) this.m.delete(k);
  }
}
