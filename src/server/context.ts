import path from 'node:path';
import type { Config } from './config';
import { Db } from './db/database';
import { migrate } from './db/migrations';
import { createLogger, silentLogger, type Logger } from './lib/log';
import { RateLimiter } from './lib/ratelimit';
import { Storage } from './lib/storage';

/** Short-lived store for rendered previews so the builder can show them in a real iframe. */
export class PreviewStore {
  private items = new Map<string, { html: string; headers: Record<string, string>; userId: string; expires: number }>();
  put(id: string, userId: string, html: string, headers: Record<string, string>, ttlMs = 15 * 60_000) {
    if (this.items.size > 200) {
      const now = Date.now();
      for (const [k, v] of this.items) if (v.expires < now) this.items.delete(k);
      while (this.items.size > 200) this.items.delete(this.items.keys().next().value as string);
    }
    this.items.set(id, { html, headers, userId, expires: Date.now() + ttlMs });
  }
  get(id: string, userId: string): { html: string; headers: Record<string, string> } | null {
    const it = this.items.get(id);
    if (!it || it.expires < Date.now() || it.userId !== userId) return null;
    return { html: it.html, headers: it.headers };
  }
}

export interface AppContext {
  config: Config;
  db: Db;
  storage: Storage;
  log: Logger;
  limiter: RateLimiter;
  previews: PreviewStore;
  /** Resolves when background work started by a request has finished (used by tests). */
  background: Set<Promise<unknown>>;
}

export function createContext(config: Config, opts: { dbFile?: string; quiet?: boolean } = {}): AppContext {
  const db = new Db(opts.dbFile ?? path.join(config.dataDir, 'multiplier.db'));
  migrate(db);
  return {
    config,
    db,
    storage: new Storage(path.join(config.dataDir, 'files')),
    log: opts.quiet ? silentLogger : createLogger(config.logLevel, config.env === 'production'),
    limiter: new RateLimiter(),
    previews: new PreviewStore(),
    background: new Set(),
  };
}

/** Fire-and-forget helper that keeps track of the promise and never throws into the caller. */
export function runInBackground(ctx: AppContext, label: string, fn: () => Promise<unknown>): void {
  const p = fn()
    .catch((err) => ctx.log.error(`background task failed: ${label}`, { err }))
    .finally(() => ctx.background.delete(p));
  ctx.background.add(p);
}

export function closeContext(ctx: AppContext): void {
  ctx.limiter.close();
  ctx.db.close();
}
