import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processDeliveries } from '../../src/server/services/webhooks';
import { createTestApp, type TestApp } from '../helpers/app';
import { bearer, createApiKey, createLiveCampaign, publicHeaders } from '../helpers/fixtures';

let t: TestApp;
let key: string;
let campaign: { id: string; slug: string };

const mk = async (row: Record<string, unknown>) => {
  const res = await t.json('POST', '/api/v1/personalize', { campaign: campaign.id, ...row }, bearer(key));
  return { ...res.body, token: new URL(res.body.url).pathname.split('/').pop()! as string };
};
const get = (path: string, ua?: string) => t.req('GET', path, undefined, publicHeaders(ua));

beforeEach(async () => {
  t = await createTestApp({ ALLOW_PRIVATE_FETCH: 'true' });
  await t.login();
  campaign = await createLiveCampaign(t);
  key = await createApiKey(t);
});
afterEach(() => t.close());

describe('GET /p/:token', () => {
  it('serves the page personalised for that person, with persona blocks and security headers', async () => {
    const jane = await mk({ email: 'jane@acme.com', first_name: 'Jane', company: 'Acme, Inc.', job_title: 'VP of Marketing' });
    const res = await get(`/p/${jane.token}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Prepared for Jane at Acme, Inc.');
    expect(html).toContain('Pipeline plan for Acme, Inc.');
    expect(html).toContain('Marketing-specific copy for Acme.'); // company_short
    expect(html).not.toContain('Sales-specific copy');
    expect(res.headers.get('content-security-policy')).toContain("object-src 'none'");
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');

    const sam = await mk({ email: 'sam@globex.io', first_name: 'Sam', company: 'Globex', job_title: 'Head of Sales' });
    const samHtml = await (await get(`/p/${sam.token}`)).text();
    expect(samHtml).toContain('Sales-specific copy');
    expect(samHtml).not.toContain('Marketing-specific copy');
  });

  it('renders a hostile name harmlessly', async () => {
    const p = await mk({ email: 'x@y.co', first_name: '<script>alert(1)</script>', company: '"><img src=x onerror=alert(1)>' });
    const html = await (await get(`/p/${p.token}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toMatch(/<img[^>]*onerror/);
  });

  it('answers unknown tokens, unpublished campaigns and malformed tokens identically (404)', async () => {
    const p = await mk({ email: 'a@b.co' });
    await t.json('POST', `/api/campaigns/${campaign.id}/status`, { status: 'draft' });
    const draft = await get(`/p/${p.token}`);
    const unknown = await get('/p/zzzzzzzzzz');
    const malformed = await get('/p/..%2F..%2Fetc');
    expect([draft.status, unknown.status, malformed.status]).toEqual([404, 404, 404]);
    expect(await draft.text()).toBe(await unknown.text());
  });

  it('rate limits token guessing', async () => {
    let last = 0;
    for (let i = 0; i < 60; i++) last = (await get('/p/aaaaaaaaaa')).status;
    expect(last).toBe(429);
  });

  it('does not serve dashboard routes on the public host', async () => {
    const res = await t.req('GET', '/api/campaigns', undefined, { host: 'go.test' });
    expect(res.status).toBe(404);
    expect((await t.req('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { host: 'go.test', cookie: '' })).status).toBe(404);
    expect((await t.req('GET', '/p/zzzzzzzzzz', undefined, { host: 'evil.example' })).status).toBe(404);
  });
});

describe('tracking', () => {
  it('counts a human view once per browser session and ignores link scanners', async () => {
    const p = await mk({ email: 'jane@acme.com', first_name: 'Jane' });
    await get(`/p/${p.token}`, 'Mozilla/5.0 (compatible; Proofpoint URL Defense)');
    await t.req('POST', `/t/${p.token}`, { type: 'view', sid: 'scan1' }, publicHeaders('Mozilla/5.0 (compatible; Proofpoint URL Defense)'));
    await t.req('POST', `/t/${p.token}`, { type: 'view', sid: 'hl1', wd: 1 }, publicHeaders()); // webdriver
    let one = await t.json('GET', `/api/prospects/${p.id}`);
    expect(one.body.prospect.engagement.views).toBe(0);

    await get(`/p/${p.token}`);
    await t.req('POST', `/t/${p.token}`, { type: 'view', sid: 'human1' }, publicHeaders());
    await t.req('POST', `/t/${p.token}`, { type: 'view', sid: 'human1' }, publicHeaders()); // retried beacon
    one = await t.json('GET', `/api/prospects/${p.id}`);
    expect(one.body.prospect.engagement.views).toBe(1);
    expect(one.body.prospect.engagement.first_seen_at).toBeTruthy();
    expect(one.body.timeline.some((e: { type: string; is_bot: boolean }) => e.type === 'view' && e.is_bot)).toBe(true); // kept for transparency
  });

  it('accumulates engaged time per session using the maximum, not the sum of heartbeats', async () => {
    const p = await mk({ email: 'jane@acme.com' });
    const beat = (sid: string, s: number, i = 1) =>
      t.req('POST', `/t/${p.token}`, { type: 'engaged', sid, s, scroll: 40, i }, publicHeaders());
    await t.req('POST', `/t/${p.token}`, { type: 'view', sid: 'sess1' }, publicHeaders());
    await beat('sess1', 15);
    await beat('sess1', 30);
    await beat('sess1', 45);
    await beat('sess2', 20);
    const one = await t.json('GET', `/api/prospects/${p.id}`);
    expect(one.body.prospect.engagement.engaged_seconds).toBe(65);
    expect(one.body.prospect.engagement.score).toBeGreaterThan(10);
  });

  it('rejects oversized or malformed beacons', async () => {
    const p = await mk({ email: 'jane@acme.com' });
    expect((await t.req('POST', `/t/${p.token}`, { type: 'nope', sid: 'abc12345' }, publicHeaders())).status).toBe(400);
    expect((await t.req('POST', `/t/${p.token}`, { type: 'view', sid: 'a'.repeat(5000) }, publicHeaders())).status).toBe(400);
  });

  it('records clicks through the tracked redirect and sends people to the saved destination', async () => {
    const p = await mk({ email: 'jane@acme.com', first_name: 'Jane' });
    const html = await (await get(`/p/${p.token}`)).text();
    expect(html).toContain(`href="/r/${p.token}/hero1.primary"`);
    const res = await get(`/r/${p.token}/hero1.primary`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://cal.com/acme/intro');
    const header = await get(`/r/${p.token}/header.header`);
    expect(header.headers.get('location')).toBe('https://cal.com/acme/intro?name=Jane');
    const one = await t.json('GET', `/api/prospects/${p.id}`);
    expect(one.body.prospect.engagement.clicks).toBe(2);
    expect(one.body.prospect.engagement.stage).toBe('engaged');
  });

  it('is not an open redirect: unknown links and non-link buttons 404', async () => {
    const p = await mk({ email: 'jane@acme.com' });
    expect((await get(`/r/${p.token}/hero1.secondary`)).status).toBe(404); // secondary is a "document" action
    expect((await get(`/r/${p.token}/nope.primary`)).status).toBe(404);
    expect((await get(`/r/${p.token}/..%2F..%2F`)).status).toBe(404);
    expect((await get(`/r/${p.token}/hero1.primary?to=https://evil.com`)).headers.get('location')).toBe('https://cal.com/acme/intro');
  });

  it('does not count clicks made by scanners', async () => {
    const p = await mk({ email: 'jane@acme.com' });
    await get(`/r/${p.token}/hero1.primary`, 'curl/8.0');
    expect((await t.json('GET', `/api/prospects/${p.id}`)).body.prospect.engagement.clicks).toBe(0);
  });
});

describe('forms', () => {
  const submit = (token: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    t.req('POST', `/p/${token}/submit`, body, { ...publicHeaders(), accept: 'application/json', ...headers });

  it('stores a submission, fills a missing email and marks the prospect converted', async () => {
    const p = await mk({ first_name: 'Jane', company: 'Acme' });
    const res = await submit(p.token, { _block: 'form1', name: 'Jane Doe', email: 'Jane@Acme.com', message: 'Hello!' });
    expect(res.status).toBe(200);
    const one = await t.json('GET', `/api/prospects/${p.id}`);
    expect(one.body.prospect.engagement.stage).toBe('converted');
    expect(one.body.prospect.email).toBe('jane@acme.com');
    expect(one.body.submissions[0].data).toEqual({ name: 'Jane Doe', email: 'Jane@Acme.com', message: 'Hello!' });
  });

  it('validates required fields and email format', async () => {
    const p = await mk({ first_name: 'Jane' });
    const missing = await submit(p.token, { _block: 'form1', email: 'a@b.co' });
    expect(missing.status).toBe(422);
    const bad = await submit(p.token, { _block: 'form1', name: 'J', email: 'nope' });
    expect(bad.status).toBe(422);
  });

  it('ignores fields the form never declared', async () => {
    const p = await mk({ first_name: 'Jane' });
    await submit(p.token, { _block: 'form1', name: 'J', email: 'a@b.co', admin: 'true', __proto__: 'x' });
    const one = await t.json('GET', `/api/prospects/${p.id}`);
    expect(Object.keys(one.body.submissions[0].data).sort()).toEqual(['email', 'name']);
  });

  it('swallows honeypot hits without recording anything', async () => {
    const p = await mk({ first_name: 'Jane' });
    const res = await submit(p.token, { _block: 'form1', name: 'Bot', email: 'bot@x.co', _hp: 'http://spam' });
    expect(res.status).toBe(200);
    expect((await t.json('GET', `/api/prospects/${p.id}`)).body.submissions).toHaveLength(0);
  });

  it('supports classic form posts (no JavaScript) with a redirect back to the page', async () => {
    const p = await mk({ first_name: 'Jane' });
    const form = new FormData();
    form.set('_block', 'form1');
    form.set('name', 'Jane');
    form.set('email', 'jane@acme.com');
    const res = await t.req('POST', `/p/${p.token}/submit`, form, publicHeaders());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/p/${p.token}?sent=1`);
  });

  it('rate limits submissions', async () => {
    const p = await mk({ first_name: 'Jane' });
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await submit(p.token, { _block: 'form1', name: 'J', email: 'a@b.co' })).status;
    expect(last).toBe(429);
  });
});

describe('generic page /c/:slug', () => {
  it('serves fallbacks to anonymous visitors', async () => {
    const html = await (await get(`/c/${campaign.slug}`)).text();
    expect(html).toContain('Pipeline plan for your team');
    expect(html).toContain('Prepared for you at your team');
  });

  it('personalises from URL parameters only when the campaign allows it', async () => {
    const off = await (await get(`/c/${campaign.slug}?first_name=Jane&company=Zorbo`)).text();
    expect(off).not.toContain('Zorbo');
    await t.json('PUT', `/api/campaigns/${campaign.id}`, { settings: { allow_url_params: true } });
    const on = await (await get(`/c/${campaign.slug}?first_name=Jane&company=Zorbo&job_title=Head%20of%20Sales`)).text();
    expect(on).toContain('Prepared for Jane at Zorbo');
    expect(on).toContain('Sales-specific copy');
  });

  it('escapes hostile URL parameters', async () => {
    await t.json('PUT', `/api/campaigns/${campaign.id}`, { settings: { allow_url_params: true } });
    const html = await (await get(`/c/${campaign.slug}?company=%3Cscript%3Ealert(1)%3C/script%3E`)).text();
    expect(html).not.toContain('<script>alert(1)');
  });

  it('404s for unpublished campaigns', async () => {
    await t.json('POST', `/api/campaigns/${campaign.id}/status`, { status: 'draft' });
    expect((await get(`/c/${campaign.slug}`)).status).toBe(404);
  });
});

describe('outbound webhooks (the Clay feedback loop)', () => {
  async function receiver() {
    const received: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];
    let status = 200;
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: JSON.parse(data) });
        res.statusCode = status;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
    return { received, url, setStatus: (s: number) => (status = s), close: () => new Promise((r) => server.close(r)) };
  }

  it('pushes a flat row to a Clay table webhook when a prospect first opens their page, with the auth header', async () => {
    const rx = await receiver();
    const created = await t.json('POST', '/api/webhooks', {
      name: 'Clay table',
      kind: 'clay',
      url: rx.url,
      auth_header: 'x-clay-webhook-auth',
      auth_value: 'secret-token',
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('secret-token');

    const p = await mk({
      email: 'jane@acme.com',
      external_id: 'ext-9',
      first_name: 'Jane',
      last_name: 'Doe',
      company: 'Acme',
      job_title: 'CMO',
    });
    await t.req('POST', `/t/${p.token}`, { type: 'view', sid: 'sess1' }, publicHeaders());
    await t.req('POST', `/t/${p.token}`, { type: 'view', sid: 'sess2' }, publicHeaders()); // second view: not "first"
    expect(await processDeliveries(t.ctx)).toBe(1);

    expect(rx.received).toHaveLength(1);
    expect(rx.received[0].headers['x-clay-webhook-auth']).toBe('secret-token');
    expect(rx.received[0].body).toMatchObject({
      event: 'page.first_viewed',
      external_id: 'ext-9',
      email: 'jane@acme.com',
      first_name: 'Jane',
      company: 'Acme',
      stage: 'opened',
      views: 1,
      department: 'marketing',
    });
    expect(rx.received[0].body.page_url).toBe(p.url);
    await rx.close();
  });

  it('flattens form submissions into form_<field> columns for Clay', async () => {
    const rx = await receiver();
    await t.json('POST', '/api/webhooks', { name: 'Clay', kind: 'clay', url: rx.url, events: ['form.submitted'] });
    const p = await mk({ email: 'jane@acme.com', first_name: 'Jane' });
    await t.req(
      'POST',
      `/p/${p.token}/submit`,
      { _block: 'form1', name: 'Jane Doe', email: 'jane@acme.com', message: 'Call me' },
      { ...publicHeaders(), accept: 'application/json' },
    );
    await processDeliveries(t.ctx);
    expect(rx.received[0].body).toMatchObject({ event: 'form.submitted', form_name: 'Jane Doe', form_message: 'Call me' });
    await rx.close();
  });

  it('signs generic webhooks and retries failures with backoff', async () => {
    const rx = await receiver();
    const created = await t.json('POST', '/api/webhooks', { name: 'Generic', kind: 'generic', url: rx.url, events: ['*'] });
    expect(created.body.secret).toMatch(/^whsec_/);
    rx.setStatus(500);
    const p = await mk({ email: 'jane@acme.com' });
    await t.req('POST', `/t/${p.token}`, { type: 'view', sid: 'sess1' }, publicHeaders());
    await processDeliveries(t.ctx);
    const hook = (await t.json('GET', '/api/webhooks')).body.webhooks[0];
    expect(hook.stats).toMatchObject({ pending: 2, delivered: 0 }); // prospect.created + page.first_viewed
    expect(await processDeliveries(t.ctx)).toBe(0); // not due yet (backoff)
    t.ctx.db.run('UPDATE webhook_deliveries SET next_attempt_at = 0');
    rx.setStatus(200);
    await processDeliveries(t.ctx);
    expect((await t.json('GET', '/api/webhooks')).body.webhooks[0].stats).toMatchObject({ pending: 0, delivered: 2 });
    const viewed = rx.received.filter((r) => r.body.event === 'page.first_viewed').pop()!;
    expect(viewed.headers['x-multiplier-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(viewed.body).toMatchObject({ event: 'page.first_viewed', prospect: { email: 'jane@acme.com' } });
    await rx.close();
  });

  it('blocks webhook targets on private networks when SSRF protection is on', async () => {
    const strict = await createTestApp();
    await strict.login();
    const bad = await strict.json('POST', '/api/webhooks', { name: 'x', kind: 'generic', url: 'http://169.254.169.254/latest/meta-data' });
    expect(bad.status).toBe(400);
    expect((await strict.json('POST', '/api/webhooks', { name: 'x', kind: 'generic', url: 'https://localhost/hook' })).status).toBe(400);
    expect((await strict.json('POST', '/api/webhooks', { name: 'x', kind: 'generic', url: 'https://127.0.0.1/hook' })).status).toBe(400);
    await strict.close();
  });
});
