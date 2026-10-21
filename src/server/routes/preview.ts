import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { getSessionUser, SESSION_COOKIE } from '../auth/sessions';
import { unauthorized, notFound } from '../lib/errors';
import type { Env } from '../http';

/**
 * Serves builder previews. These live outside /api on purpose: the response carries the public
 * page's own Content-Security-Policy, which an <iframe srcdoc> could not have.
 */
export function previewRoutes() {
  const r = new Hono<Env>();
  r.get('/preview/:id', (c) => {
    const app = c.get('app');
    const user = getSessionUser(app, getCookie(c, SESSION_COOKIE));
    if (!user) throw unauthorized();
    const hit = app.previews.get(c.req.param('id'), user.id);
    if (!hit) throw notFound('Preview');
    return new Response(hit.html, { headers: hit.headers });
  });
  return r;
}
