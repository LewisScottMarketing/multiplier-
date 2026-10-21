import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { ZodError, type ZodType } from 'zod';
import { verifyApiKey, type ApiKeyInfo } from './auth/apikeys';
import { getSessionUser, SESSION_COOKIE } from './auth/sessions';
import type { User } from './auth/users';
import type { AppContext } from './context';
import { badRequest, forbidden, HttpError, unauthorized } from './lib/errors';

export type Env = {
  Variables: {
    app: AppContext;
    ip: string;
    reqId: string;
    user: User;
    apiKey: ApiKeyInfo;
  };
};
export type C = Context<Env>;

// ── Client IP ───────────────────────────────────────────────────────────────

/**
 * The client's IP. Behind `n` trusted proxies the address we want is the n-th entry from the
 * RIGHT of X-Forwarded-For (everything to its left is client-controlled and can be forged).
 */
export function clientIp(c: C, app: AppContext): string {
  const hops = app.config.trustProxy;
  if (hops > 0) {
    const parts = (c.req.header('x-forwarded-for') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const picked = parts[parts.length - hops];
    if (picked) return picked;
  }
  try {
    return getConnInfo(c).remote.address ?? '0.0.0.0';
  } catch {
    return '0.0.0.0';
  }
}

/**
 * The host the browser asked for. X-Forwarded-Host is only believed when a trusted proxy sits in
 * front of us (TRUST_PROXY); otherwise any client could name itself as any host.
 */
export function requestHost(c: C): string {
  const forwarded = c.get('app').config.trustProxy > 0 ? c.req.header('x-forwarded-host') : undefined;
  return (forwarded ?? c.req.header('host') ?? '').split(',')[0].trim().toLowerCase();
}

export const baseMiddleware =
  (app: AppContext): MiddlewareHandler<Env> =>
  async (c, next) => {
    c.set('app', app);
    c.set('ip', clientIp(c, app));
    c.set('reqId', crypto.randomUUID().slice(0, 8));
    const started = Date.now();
    // browsers that have seen us over https keep using https (ignored on plain http, so safe for local runs)
    if (app.config.appUrl.startsWith('https://')) c.header('Strict-Transport-Security', 'max-age=15552000');
    await next();
    const path = redactPath(c.req.path);
    if (!path.startsWith('/assets/') && path !== '/api/health') {
      app.log.debug(`${c.req.method} ${path} ${c.res.status} ${Date.now() - started}ms`, { id: c.get('reqId') });
    }
  };

/** A prospect's link token is a credential, so logs keep only its first three characters. */
export const redactPath = (p: string): string => p.replace(/^(\/(?:p|t|r|tc)\/)([A-Za-z0-9_-]{3})[A-Za-z0-9_.-]+/, '$1$2…');

// ── Error handling ──────────────────────────────────────────────────────────

export function formatZod(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export const errorHandler = (app: AppContext) => (err: Error, c: C) => {
  if (err instanceof HttpError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
  }
  if (err instanceof ZodError) {
    return c.json({ error: { code: 'validation_error', message: 'Invalid request', details: formatZod(err) } }, 400);
  }
  // hono's own errors (e.g. body limit) expose a status
  const status = (err as { status?: number }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return c.json({ error: { code: 'bad_request', message: err.message } }, status as 400);
  }
  app.log.error('unhandled error', { err, path: redactPath(c.req.path), id: c.get('reqId') });
  return c.json({ error: { code: 'internal_error', message: 'Something went wrong' } }, 500);
};

// ── Auth guards ─────────────────────────────────────────────────────────────

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Cookie-authenticated dashboard users. Also enforces same-origin for state-changing requests. */
export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const app = c.get('app');
  const user = getSessionUser(app, getCookie(c, SESSION_COOKIE));
  if (!user) throw unauthorized();
  if (UNSAFE.has(c.req.method)) assertSameOrigin(c);
  c.set('user', user);
  await next();
};

/**
 * CSRF defence for cookie auth. Browsers always send Origin (or Sec-Fetch-Site) on cross-site
 * writes; if either says "not us" we refuse. Non-browser clients send neither and are let through
 * (they cannot ride a victim's cookie).
 */
function assertSameOrigin(c: C) {
  const fetchSite = c.req.header('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw forbidden('Cross-site request blocked');
  const origin = c.req.header('origin');
  if (origin) {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      throw forbidden('Bad Origin header');
    }
    const own = requestHost(c);
    if (own && host.toLowerCase() !== own) throw forbidden('Cross-site request blocked');
  }
}

/** Machine-to-machine access (Clay's HTTP API column). `Authorization: Bearer mpl_live_…` */
export const requireApiKey: MiddlewareHandler<Env> = async (c, next) => {
  const app = c.get('app');
  const header = c.req.header('authorization') ?? '';
  const presented = header.replace(/^Bearer\s+/i, '').trim() || c.req.header('x-api-key') || '';
  // brute-force guard on failed lookups only, so a busy Clay table is never throttled by it
  const key = presented ? verifyApiKey(app, presented) : null;
  if (!key) {
    const r = app.limiter.hit(`badkey:${c.get('ip')}`, 20, 60_000);
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfterSec));
      throw new HttpError(429, 'rate_limited', 'Too many invalid API keys');
    }
    throw unauthorized('Invalid or missing API key. Send "Authorization: Bearer <key>".');
  }
  c.set('apiKey', key);
  await next();
};

export const rateLimit =
  (name: string, limit: number, windowMs: number, keyOf: (c: C) => string = (c) => c.get('ip')): MiddlewareHandler<Env> =>
  async (c, next) => {
    const r = c.get('app').limiter.hit(`${name}:${keyOf(c)}`, limit, windowMs);
    c.header('X-RateLimit-Remaining', String(r.remaining));
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfterSec));
      throw new HttpError(429, 'rate_limited', 'Too many requests, please slow down', { retry_after: r.retryAfterSec });
    }
    await next();
  };

// ── Parsing helpers ─────────────────────────────────────────────────────────

export async function jsonBody<T>(c: C, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
  return schema.parse(raw);
}

export const dashboardHeaders: MiddlewareHandler<Env> = async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Cache-Control', 'no-store');
};
