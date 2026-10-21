import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';
import { processDeliveries, pruneDeliveries } from '../../src/server/services/webhooks';
import { createTestApp, type TestApp } from '../helpers/app';
import { bearer, createApiKey, createLiveCampaign, demoPage, publicHeaders } from '../helpers/fixtures';

let t: TestApp;
afterEach(() => t.close());

const HUMAN = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

describe('the dashboard shell', () => {
  it('ships a strict Content-Security-Policy, so an injected tag can neither run nor phone home', async () => {
    t = await createTestApp();
    fs.mkdirSync(path.join(t.dir, 'web'), { recursive: true });
    fs.writeFileSync(path.join(t.dir, 'web', 'index.html'), '<!doctype html><div id="root"></div>');
    for (const url of ['/', '/campaigns/cmp_x/pdf', '/index.html']) {
      const res = await t.req('GET', url);
      expect(res.status, url).toBe(200);
      const csp = res.headers.get('content-security-policy') ?? '';
      const script = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
      expect(script.trim()).toBe("script-src 'self'");
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).not.toMatch(/unsafe-eval/);
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });
});

describe('transport security', () => {
  it('asks browsers to keep using https when the app is served over https', async () => {
    t = await createTestApp({ APP_URL: 'https://app.test', PUBLIC_URL: 'https://go.test' });
    expect((await t.req('GET', '/api/health')).headers.get('strict-transport-security')).toMatch(/max-age=\d+/);
    expect((await t.req('GET', '/p/zzzzzzzzzz', undefined, { host: 'go.test' })).headers.get('strict-transport-security')).toMatch(
      /max-age=\d+/,
    );
  });

  it('stays quiet over plain http, where browsers would ignore it anyway', async () => {
    t = await createTestApp();
    expect((await t.req('GET', '/api/health')).headers.get('strict-transport-security')).toBeNull();
  });
});

describe('which host a request is for', () => {
  const dashboardOn = (headers: Record<string, string>) => t.req('GET', '/api/campaigns', undefined, headers);

  it('ignores X-Forwarded-Host unless a trusted proxy is configured', async () => {
    t = await createTestApp();
    await t.login();
    // a client on the public host claiming to be the app host gets nothing
    expect((await dashboardOn({ host: 'go.test', 'x-forwarded-host': 'app.test' })).status).toBe(404);
    // and an app-host request is judged by its real Host, whatever X-Forwarded-Host says
    expect((await dashboardOn({ host: 'app.test', 'x-forwarded-host': 'go.test' })).status).toBe(200);
  });

  it('believes it when TRUST_PROXY says a proxy set it', async () => {
    t = await createTestApp({ TRUST_PROXY: '1' });
    await t.login();
    expect((await dashboardOn({ host: 'app:3000', 'x-forwarded-host': 'app.test' })).status).toBe(200);
    expect((await dashboardOn({ host: 'app:3000', 'x-forwarded-host': 'go.test' })).status).toBe(404);
  });

  it('compares hosts case-insensitively', async () => {
    t = await createTestApp();
    await t.login();
    expect((await dashboardOn({ host: 'APP.Test' })).status).toBe(200);
  });
});

describe('image uploads', () => {
  const upload = (data: Buffer, name = 'x.png') => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(data)], name));
    return t.json('POST', '/api/assets', form);
  };
  const header = (w: number, h: number) => {
    const b = Buffer.alloc(40);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'latin1');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    b[24] = 8;
    b[25] = 6;
    return b;
  };

  it('refuses an image that declares an enormous size before decoding it', async () => {
    t = await createTestApp();
    await t.login();
    const started = Date.now();
    const res = await upload(header(60_000, 60_000));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/too large/i);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('still accepts ordinary pictures and re-encodes them', async () => {
    t = await createTestApp();
    await t.login();
    const c = createCanvas(64, 40);
    const g = c.getContext('2d');
    g.fillStyle = '#4f46e5';
    g.fillRect(0, 0, 64, 40);
    const res = await upload(c.toBuffer('image/png'));
    expect(res.status).toBe(201);
    expect(res.body.asset.meta).toEqual({ width: 64, height: 40 });
  });

  it('refuses SVG and other formats that can carry script', async () => {
    t = await createTestApp();
    await t.login();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    expect((await upload(svg, 'x.svg')).status).toBe(400);
    expect((await upload(Buffer.from('<html><script>alert(1)</script></html>'), 'x.png')).status).toBe(400);
  });
});

describe('public PDFs built from the address bar', () => {
  it('limits how fast one visitor can ask for them', async () => {
    t = await createTestApp();
    await t.login();
    const form = new FormData();
    form.set('file', new File([fs.readFileSync(path.resolve('tests/fixtures/playbook.pdf'))], 'playbook.pdf', { type: 'application/pdf' }));
    const { campaign } = (await t.json('POST', '/api/campaigns/import-pdf', form)).body;
    await t.json('POST', `/api/campaigns/${campaign.id}/status`, { status: 'live' });

    const get = (u: string) => t.req('GET', u, undefined, publicHeaders());
    const first = await get(`/c/${campaign.slug}.pdf`);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');
    expect(first.headers.get('x-robots-tag')).toContain('noindex');
    expect((await get(`/c/${campaign.slug}/cover.png`)).status).toBe(200);

    let status = 200;
    for (let i = 0; i < 70 && status === 200; i++)
      status = (await get(i % 2 ? `/c/${campaign.slug}.pdf` : `/c/${campaign.slug}/cover.png`)).status;
    expect(status).toBe(429);
    expect((await get(`/c/${campaign.slug}.pdf`)).headers.get('retry-after')).toBeTruthy();
    // the page itself, and everyone else’s links, are untouched
    expect((await get(`/c/${campaign.slug}`)).status).toBe(200);
  }, 60_000);
});

describe('studio previews', () => {
  it('answers a page that doesn’t exist with a clear error rather than a crash', async () => {
    t = await createTestApp();
    await t.login();
    const form = new FormData();
    form.set('file', new File([fs.readFileSync(path.resolve('tests/fixtures/playbook.pdf'))], 'playbook.pdf', { type: 'application/pdf' }));
    const { campaign } = (await t.json('POST', '/api/campaigns/import-pdf', form)).body;
    const res = await t.json('POST', `/api/campaigns/${campaign.id}/document/preview`, { document: campaign.document, page: 99 });
    expect(res.status).toBe(422);
    expect((await t.req('GET', `/api/campaigns/${campaign.id}/document/preview/0.png`)).status).toBe(422);
  }, 30_000);
});

describe('outbound webhooks', () => {
  async function receiver() {
    const received: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: JSON.parse(data) });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return {
      received,
      url: `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`,
      close: () => new Promise((r) => server.close(r)),
    };
  }

  it('does not let a prospect’s profile ping a whole Slack channel or plant links', async () => {
    t = await createTestApp({ ALLOW_PRIVATE_FETCH: 'true' });
    await t.login();
    const campaign = await createLiveCampaign(t, { name: 'Q4 <!here> push' });
    const key = await createApiKey(t);
    const rx = await receiver();
    await t.json('POST', '/api/webhooks', { name: 'Slack', kind: 'slack', url: rx.url });
    const made = await t.json(
      'POST',
      '/api/v1/personalize',
      {
        campaign: campaign.id,
        email: 'x@evil.example',
        first_name: '<@U12345>',
        company: '<!channel> <https://evil.example/login|Verify your account>',
        job_title: 'CEO',
      },
      bearer(key),
    );
    const token = new URL(made.body.url).pathname.split('/').pop();
    await t.req('POST', `/t/${token}`, { type: 'view', sid: 'abcd1234' }, publicHeaders(HUMAN));
    expect(await processDeliveries(t.ctx)).toBe(1);

    const text: string = rx.received[0].body.text;
    expect(text).toContain('&lt;!channel&gt;');
    expect(text).toContain('&lt;@U12345&gt;');
    expect(text).toContain('&lt;!here&gt;');
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<https://evil.example');
    // our own link to their page is still a real Slack link
    expect(text).toContain(`<http://go.test/p/${token}|Open their page>`);
    await rx.close();
  });

  it('won’t let a destination override headers that frame the request', async () => {
    t = await createTestApp({ ALLOW_PRIVATE_FETCH: 'true' });
    await t.login();
    for (const name of ['Host', 'content-length', 'Transfer-Encoding', 'Connection', 'Content-Type']) {
      const res = await t.json('POST', '/api/webhooks', {
        name: 'x',
        kind: 'generic',
        url: 'http://127.0.0.1:9/hook',
        auth_header: name,
        auth_value: 'v',
      });
      expect(res.status, name).toBe(400);
    }
    expect(
      (
        await t.json('POST', '/api/webhooks', {
          name: 'ok',
          kind: 'clay',
          url: 'http://127.0.0.1:9/hook',
          auth_header: 'x-clay-webhook-auth',
          auth_value: 'v',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await t.json('POST', '/api/webhooks', {
          name: 'ok',
          kind: 'generic',
          url: 'http://127.0.0.1:9/hook',
          auth_header: 'Authorization',
          auth_value: 'Bearer abc',
        })
      ).status,
    ).toBe(201);
  });
});

describe('tracked buttons', () => {
  it('count a click for a person, not for a link checker’s HEAD request', async () => {
    t = await createTestApp();
    await t.login();
    const campaign = await createLiveCampaign(t);
    const key = await createApiKey(t);
    const made = await t.json(
      'POST',
      '/api/v1/personalize',
      { campaign: campaign.id, email: 'jane@acme.com', first_name: 'Jane' },
      bearer(key),
    );
    const token = new URL(made.body.url).pathname.split('/').pop();
    const clicks = async () => (await t.json('GET', `/api/prospects/${made.body.id}`)).body.prospect.engagement.clicks;

    const head = await t.req('HEAD', `/r/${token}/header`, undefined, publicHeaders(HUMAN));
    expect(head.status).toBe(302);
    expect(await clicks()).toBe(0);
    const get = await t.req('GET', `/r/${token}/header`, undefined, publicHeaders(HUMAN));
    expect(get.status).toBe(302);
    expect(get.headers.get('location')).toContain('https://cal.com/acme/intro');
    expect(await clicks()).toBe(1);
  });
});

describe('block ids', () => {
  it('must be plain, since they end up in HTML attributes and in tracked-link paths', async () => {
    t = await createTestApp();
    await t.login();
    const campaign = await createLiveCampaign(t);
    const page = demoPage();
    for (const bad of ['x" onfocus="alert(1)', 'a.b', 'has space', '']) {
      const res = await t.json('PUT', `/api/campaigns/${campaign.id}`, {
        page: { ...page, blocks: [{ ...page.blocks[0], id: bad }, ...page.blocks.slice(1)] },
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await t.json('PUT', `/api/campaigns/${campaign.id}`, {
      page: { ...page, blocks: [{ ...page.blocks[0], id: 'hero_2-b' }, ...page.blocks.slice(1)] },
    });
    expect(ok.status).toBe(200);
  });
});

describe('erasing people', () => {
  const count = (where = '1=1') => t.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM webhook_deliveries WHERE ${where}`)!.n;

  it('takes the copies already queued or sent to Clay, Slack and the like with them', async () => {
    t = await createTestApp({ ALLOW_PRIVATE_FETCH: 'true' });
    await t.login();
    const campaign = await createLiveCampaign(t);
    const key = await createApiKey(t);
    await t.json('POST', '/api/webhooks', { name: 'Everything', kind: 'generic', url: 'http://127.0.0.1:9/hook', events: ['*'] });
    const ann = await t.json(
      'POST',
      '/api/v1/personalize',
      { campaign: campaign.id, email: 'ann@acme.com', first_name: 'Ann' },
      bearer(key),
    );
    await t.json('POST', '/api/v1/personalize', { campaign: campaign.id, email: 'bob@acme.com', first_name: 'Bob' }, bearer(key));
    expect(count()).toBe(2);
    expect(count(`prospect_id = '${ann.body.id}' AND campaign_id = '${campaign.id}'`)).toBe(1);

    expect((await t.json('DELETE', `/api/prospects/${ann.body.id}`)).status).toBe(200);
    expect(count(`payload LIKE '%ann@acme.com%'`)).toBe(0);
    expect(count()).toBe(1);

    expect((await t.json('DELETE', `/api/campaigns/${campaign.id}`)).status).toBe(200);
    expect(count()).toBe(0);
  });

  it('keeps delivery logs only as long as they are useful', async () => {
    t = await createTestApp({ ALLOW_PRIVATE_FETCH: 'true' });
    await t.login();
    const hook = (await t.json('POST', '/api/webhooks', { name: 'Hook', kind: 'generic', url: 'http://127.0.0.1:9/hook' })).body.webhook;
    const day = 86_400_000;
    const now = Date.now();
    const add = (id: string, status: string, ageDays: number) =>
      t.ctx.db.run(
        `INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, next_attempt_at, created_at) VALUES (?, ?, 'page.viewed', '{}', ?, ?, ?)`,
        id,
        hook.id,
        status,
        now,
        now - ageDays * day,
      );
    add('old_ok', 'delivered', 15);
    add('new_ok', 'delivered', 13);
    add('old_failed', 'failed', 31);
    add('recent_failed', 'failed', 20);
    add('old_pending', 'pending', 40); // still being retried: never pruned
    expect(pruneDeliveries(t.ctx, now)).toBe(2);
    const left = t.ctx.db.all<{ id: string }>('SELECT id FROM webhook_deliveries ORDER BY id').map((r) => r.id);
    expect(left).toEqual(['new_ok', 'old_pending', 'recent_failed']);
  });
});
