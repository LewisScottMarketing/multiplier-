import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { changePassword, authenticate, countUsers, createUser } from '../auth/users';
import { createSession, destroyOtherSessions, destroySession, SESSION_COOKIE } from '../auth/sessions';
import { HttpError, unauthorized } from '../lib/errors';
import { jsonBody, rateLimit, requireUser, type C, type Env } from '../http';

const password = z.string().min(10, 'Use at least 10 characters').max(200);
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export function authRoutes() {
  const r = new Hono<Env>();

  const startSession = (c: C, userId: string) => {
    const app = c.get('app');
    const { token, expiresAt } = createSession(app, userId, { ip: c.get('ip'), ua: c.req.header('user-agent') });
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: app.config.cookieSecure,
      sameSite: 'Lax',
      path: '/',
      expires: new Date(expiresAt),
    });
  };

  /** Public: tells the login screen whether to show "create your account" instead. */
  r.get('/status', (c) => {
    const app = c.get('app');
    return c.json({ setup_required: countUsers(app) === 0 });
  });

  r.post('/setup', rateLimit('setup', 10, 3600_000), async (c) => {
    const app = c.get('app');
    const body = await jsonBody(c, z.object({ email, name: z.string().trim().max(120).default(''), password }));
    const user = await createUser(app, { ...body, role: 'owner' }, { onlyIfEmpty: true });
    startSession(c, user.id);
    return c.json({ user }, 201);
  });

  r.post('/login', rateLimit('login-ip', 30, 10 * 60_000), async (c) => {
    const app = c.get('app');
    const body = await jsonBody(c, z.object({ email, password: z.string().min(1).max(200) }));
    const emailKey = `login-email:${body.email}`;
    const gate = app.limiter.hit(emailKey, 8, 10 * 60_000);
    if (!gate.ok) {
      c.header('Retry-After', String(gate.retryAfterSec));
      throw new HttpError(429, 'rate_limited', 'Too many attempts for this account. Try again later.');
    }
    const user = await authenticate(app, body.email, body.password);
    if (!user) throw unauthorized('Incorrect email or password');
    app.limiter.reset(emailKey);
    startSession(c, user.id);
    return c.json({ user });
  });

  r.post('/logout', (c) => {
    const app = c.get('app');
    destroySession(app, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  r.get('/me', requireUser, (c) => c.json({ user: c.get('user') }));

  r.post('/password', requireUser, async (c) => {
    const app = c.get('app');
    const body = await jsonBody(c, z.object({ current: z.string().min(1).max(200), next: password }));
    const ok = await changePassword(app, c.get('user').id, body.current, body.next);
    if (!ok) throw new HttpError(400, 'wrong_password', 'Current password is incorrect');
    destroyOtherSessions(app, c.get('user').id, getCookie(c, SESSION_COOKIE));
    return c.json({ ok: true });
  });

  return r;
}
