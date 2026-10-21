import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppContext } from './context';
import { baseMiddleware, dashboardHeaders, errorHandler, type Env } from './http';
import { safeJoin, sendFile } from './lib/static';
import { authRoutes } from './routes/auth';
import { campaignRoutes } from './routes/campaigns';
import { documentRoutes } from './routes/documents';
import { previewRoutes } from './routes/preview';
import { prospectRoutes } from './routes/prospects';
import { publicRoutes } from './routes/public';
import { settingsRoutes } from './routes/settings';
import { v1Routes } from './routes/v1';
import { getWorkspace } from './services/settings';

export function createApp(ctx: AppContext) {
  const app = new Hono<Env>();
  app.use('*', baseMiddleware(ctx));
  app.onError(errorHandler(ctx));

  app.get('/api/health', (c) => c.json({ ok: true, version: process.env.npm_package_version ?? 'dev' }));

  // Dashboard + API live on the app host only. Any other host (the public links domain or a custom
  // domain) may serve personalised pages and nothing else, so page content can never reach the
  // dashboard's cookies or API.
  const appHost = new URL(ctx.config.appUrl).host;
  const publicPrefixes = ['/p/', '/t/', '/tc/', '/r/', '/c/', '/a/', '/f/', '/internal/tls-check'];
  app.use('*', async (c, next) => {
    const host = (c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '').split(',')[0].trim();
    if (!host || host === appHost) return next();
    const allowed = host === new URL(ctx.config.publicUrl).host || getWorkspace(ctx).domains.includes(host.split(':')[0].toLowerCase());
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
  api.route('/campaigns', campaignRoutes());
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
        const res = await sendFile(c, file, { immutable: rel.startsWith('assets/') });
        if (res) return res;
      }
    }
    // client-side routes fall through to the app shell
    if (c.req.path.startsWith('/api/')) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    const index = path.join(webDir, 'index.html');
    if (!fs.existsSync(index)) {
      return c.text('Dashboard not built. Run `npm run build`, or use `npm run dev` and open http://localhost:5173.', 503);
    }
    const res = await sendFile(c, index);
    return res ?? c.notFound();
  });

  return app;
}
