import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppContext } from './context';
import { baseMiddleware, dashboardHeaders, errorHandler, requestHost, type Env } from './http';
import { safeJoin, sendFile } from './lib/static';
import { analyticsRoutes } from './routes/analytics';
import { authRoutes } from './routes/auth';
import { campaignRoutes } from './routes/campaigns';
import { aiRoutes } from './routes/ai';
import { documentRoutes } from './routes/documents';
import { previewRoutes } from './routes/preview';
import { prospectRoutes } from './routes/prospects';
import { publicRoutes } from './routes/public';
import { settingsRoutes } from './routes/settings';
import { v1Routes } from './routes/v1';
import { getWorkspace } from './services/settings';

/**
 * The dashboard is a same-origin single-page app: it loads its own script and styles, talks to its own
 * API and shows previews in same-origin frames, and nothing else. Locking that down means an injected
 * tag could neither run nor phone home. (Inline `style` attributes are used by the UI; scripts never.)
 */
export const SHELL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const SHELL_HEADERS = {
  'Content-Security-Policy': SHELL_CSP,
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function createApp(ctx: AppContext) {
  const app = new Hono<Env>();
  app.use('*', baseMiddleware(ctx));
  app.onError(errorHandler(ctx));

  app.get('/api/health', (c) => c.json({ ok: true, version: process.env.npm_package_version ?? 'dev' }));

  // Dashboard + API live on the app host only. Any other host (the public links domain or a custom
  // domain) may serve personalised pages and nothing else, so page content can never reach the
  // dashboard's cookies or API.
  const appHost = new URL(ctx.config.appUrl).host;
  const publicPrefixes = ['/p/', '/t/', '/tc/', '/r/', '/c/', '/a/', '/f/'];
  app.use('*', async (c, next) => {
    // the reverse proxy's certificate check arrives under the proxy's own internal hostname; the route
    // itself only answers callers on the internal network
    if (c.req.path === '/internal/tls-check') return next();
    const host = requestHost(c);
    if (!host || host === appHost) return next();
    const allowed = host === new URL(ctx.config.publicUrl).host || getWorkspace(ctx).domains.includes(host.split(':')[0]);
    if (allowed && publicPrefixes.some((p) => c.req.path.startsWith(p))) return next();
    return c.text('Not found', 404);
  });

  // ── Public pages (no auth; every response is tightly scoped) ──────────────
  // Public endpoints accept tiny bodies (beacons, forms). Scope the limit to THEIR paths only: a
  // catch-all here would also cap dashboard uploads.
  const tiny = bodyLimit({ maxSize: 64 * 1024, onError: () => { throw Object.assign(new Error('Request too large'), { status: 413 }); } });
  for (const prefix of ['/p/*', '/t/*', '/tc/*', '/r/*', '/c/*']) app.use(prefix, tiny);
  app.route('/', publicRoutes());
  app.route('/', previewRoutes());

  // ── Machine API (API key auth) ────────────────────────────────────────────
  const v1 = new Hono<Env>();
  v1.use('*', bodyLimit({ maxSize: 6 * 1024 * 1024, onError: () => { throw Object.assign(new Error('Request too large'), { status: 413 }); } }));
  v1.route('/', v1Routes());
  app.route('/api/v1', v1);

  // ── Dashboard API (cookie auth) ───────────────────────────────────────────
  const api = new Hono<Env>();
  api.use('*', dashboardHeaders);
  const apiLimit = Math.max(ctx.config.maxUploadBytes + 1024 * 1024, 12 * 1024 * 1024);
  api.use('*', bodyLimit({ maxSize: apiLimit, onError: () => { throw Object.assign(new Error('Request too large'), { status: 413 }); } }));
  api.route('/auth', authRoutes());
  api.route('/campaigns', documentRoutes()); // /import-pdf must be matched before /:id
  api.route('/campaigns', aiRoutes());
  api.route('/campaigns', campaignRoutes());
  api.route('/', analyticsRoutes());
  api.route('/', prospectRoutes());
  api.route('/', settingsRoutes());
  app.route('/api', api);

  // ── Dashboard SPA (built by Vite) ─────────────────────────────────────────
  app.get('*', async (c) => {
    const webDir = ctx.config.webDir;
    const rel = c.req.path.replace(/^\/+/, '');
    if (rel && !rel.startsWith('api/')) {
      const file = safeJoin(webDir, rel);
      if (file) {
        const res = await sendFile(c, file, { immutable: rel.startsWith('assets/'), headers: file.endsWith('.html') ? SHELL_HEADERS : undefined });
        if (res) return res;
      }
    }
    // client-side routes fall through to the app shell
    if (c.req.path.startsWith('/api/')) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    const index = path.join(webDir, 'index.html');
    if (!fs.existsSync(index)) {
      return c.text('Dashboard not built. Run `npm run build`, or use `npm run dev` and open http://localhost:5173.', 503);
    }
    const res = await sendFile(c, index, { headers: SHELL_HEADERS });
    return res ?? c.notFound();
  });

  return app;
}
