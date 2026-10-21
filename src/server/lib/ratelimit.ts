/**
 * In-memory fixed-window rate limiter. Good enough for a single-process deployment;
 * swap for Redis if you scale horizontally.
 */
export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Keys can be chosen by the caller (random tokens, emails), so the table is bounded. */
const MAX_BUCKETS = 100_000;

export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private timer: NodeJS.Timeout;

  constructor(private now: () => number = Date.now) {
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref();
  }

  hit(key: string, limit: number, windowMs: number): RateResult {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      if (!b && this.buckets.size >= MAX_BUCKETS) this.makeRoom();
      b = { count: 0, resetAt: t + windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    return {
      ok: b.count <= limit,
      remaining: Math.max(0, limit - b.count),
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - t) / 1000)),
    };
  }

  reset(key: string) {
    this.buckets.delete(key);
  }

  private sweep() {
    const t = this.now();
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
  }

  /** Expired buckets go first; if a flood of distinct keys still fills the table, the oldest tenth goes. */
  private makeRoom() {
    this.sweep();
    if (this.buckets.size < MAX_BUCKETS) return;
    let drop = Math.ceil(MAX_BUCKETS / 10);
    for (const k of this.buckets.keys()) {
      this.buckets.delete(k);
      if (--drop <= 0) break;
    }
  }

  get size() {
    return this.buckets.size;
  }

  close() {
    clearInterval(this.timer);
  }
}
