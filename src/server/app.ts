import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppContext } from './context';
import { baseMiddleware, dashboardHeaders, errorHandler, type Env } from './http';
import { safeJoin, sendFile } from './lib/static';
import { authRoutes } from './routes/auth';

export function createApp(ctx: AppContext) {
  const app = new Hono<Env>();
  app.use('*', baseMiddleware(ctx));
  app.onError(errorHandler(ctx));

  app.get('/api/health', (c) => c.json({ ok: true, version: process.env.npm_package_version ?? 'dev' }));

  // ── Dashboard API (cookie auth) ───────────────────────────────────────────
  const api = new Hono<Env>();
  api.use('*', dashboardHeaders);
  api.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024, onError: () => { throw Object.assign(new Error('Request too large'), { status: 413 }); } }));
  api.route('/auth', authRoutes());
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
