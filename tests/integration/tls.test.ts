import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app';

let t: TestApp;
afterEach(() => t.close());

const ask = (domain: string, headers: Record<string, string> = {}) =>
  t.req('GET', `/internal/tls-check?domain=${encodeURIComponent(domain)}`, undefined, { host: 'app:3000', ...headers });

describe('on-demand TLS check (called by Caddy)', () => {
  it('approves the app host, the links host and domains added in settings, and nothing else', async () => {
    t = await createTestApp();
    await t.login();
    expect((await ask('go.example.com')).status).toBe(404);
    const w = await t.json('GET', '/api/settings');
    await t.json('PUT', '/api/settings/workspace', { ...w.body.workspace, domains: ['go.example.com'] });
    expect((await ask('go.example.com')).status).toBe(200);
    expect(await (await ask('GO.Example.com')).text()).toBe('ok');
    expect((await ask('app.test')).status).toBe(200);
    expect((await ask('go.test')).status).toBe(200);
    expect((await ask('evil.example.org')).status).toBe(404);
    expect((await ask('')).status).toBe(404);
  });

  it('is answered under the proxy’s internal hostname, not only the app host', async () => {
    t = await createTestApp();
    const res = await ask('app.test', { host: 'caddy.internal' });
    expect(res.status).toBe(200);
  });

  it('ignores callers from the public internet, even through a proxy', async () => {
    t = await createTestApp({ TRUST_PROXY: '1' });
    expect((await ask('app.test', { 'x-forwarded-for': '8.8.8.8' })).status).toBe(404);
    expect((await ask('app.test', { 'x-forwarded-for': '10.1.2.3' })).status).toBe(200);
  });
});
