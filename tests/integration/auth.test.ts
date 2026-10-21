import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

describe('auth', () => {
  it('reports setup_required until the first account exists', async () => {
    expect((await t.json('GET', '/api/auth/status')).body).toEqual({ setup_required: true });
    await t.login();
    expect((await t.json('GET', '/api/auth/status')).body).toEqual({ setup_required: false });
  });

  it('only allows setup once', async () => {
    await t.login();
    const again = await t.json('POST', '/api/auth/setup', { email: 'x@y.co', password: 'another long password' }, { cookie: '' });
    expect(again.status).toBe(409);
  });

  it('refuses concurrent first-run requests beyond the first', async () => {
    const attempt = (email: string) =>
      t.json('POST', '/api/auth/setup', { email, password: 'another long password' }, { cookie: '' });
    const results = await Promise.all([attempt('a@x.co'), attempt('b@x.co'), attempt('c@x.co')]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('rejects weak passwords and invalid emails', async () => {
    expect((await t.json('POST', '/api/auth/setup', { email: 'a@x.co', password: 'short' })).status).toBe(400);
    expect((await t.json('POST', '/api/auth/setup', { email: 'nope', password: 'long enough password' })).status).toBe(400);
  });

  it('protects /me and returns the user once signed in', async () => {
    expect((await t.json('GET', '/api/auth/me')).status).toBe(401);
    await t.login();
    const me = await t.json('GET', '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('owner@example.com');
  });

  it('sets an httpOnly, SameSite=Lax session cookie', async () => {
    const res = await t.req('POST', '/api/auth/setup', { email: 'a@x.co', password: 'long enough password' });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('logs in with the right password only, without revealing which part was wrong', async () => {
    await t.login();
    const bad = await t.json('POST', '/api/auth/login', { email: 'owner@example.com', password: 'wrong password!!' }, { cookie: '' });
    const unknown = await t.json('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'wrong password!!' }, { cookie: '' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
    const good = await t.req('POST', '/api/auth/login', { email: 'OWNER@example.com', password: 'correct horse battery' }, { cookie: '' });
    expect(good.status).toBe(200);
  });

  it('locks an account out after repeated failures', async () => {
    await t.login();
    let last = 0;
    for (let i = 0; i < 10; i++) {
      last = (await t.json('POST', '/api/auth/login', { email: 'owner@example.com', password: 'nope nope nope' }, { cookie: '' })).status;
    }
    expect(last).toBe(429);
  });

  it('logout invalidates the session', async () => {
    await t.login();
    await t.json('POST', '/api/auth/logout');
    expect((await t.json('GET', '/api/auth/me')).status).toBe(401);
  });

  it('blocks cross-site writes made with the session cookie (CSRF)', async () => {
    await t.login();
    const evil = await t.json('POST', '/api/auth/password', { current: 'correct horse battery', next: 'a brand new password' }, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const sameSite = await t.json('POST', '/api/auth/password', { current: 'correct horse battery', next: 'a brand new password' }, { 'sec-fetch-site': 'cross-site' });
    expect(sameSite.status).toBe(403);
    const ok = await t.json('POST', '/api/auth/password', { current: 'correct horse battery', next: 'a brand new password' }, { origin: 'http://app.test' });
    expect(ok.status).toBe(200);
  });

  it('changing the password signs out other sessions but keeps this one', async () => {
    await t.login();
    const first = t.cookie;
    const second = await t.req('POST', '/api/auth/login', { email: 'owner@example.com', password: 'correct horse battery' }, { cookie: '' });
    const secondCookie = (second.headers.get('set-cookie') ?? '').split(';')[0];
    expect(secondCookie).not.toBe(first);
    await t.json('POST', '/api/auth/password', { current: 'correct horse battery', next: 'a brand new password' });
    expect((await t.json('GET', '/api/auth/me')).status).toBe(200);
    expect((await t.json('GET', '/api/auth/me', undefined, { cookie: secondCookie })).status).toBe(401);
  });
});
