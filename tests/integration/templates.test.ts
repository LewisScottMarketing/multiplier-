import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageSchema } from '../../src/shared/schema';
import { TEMPLATES } from '../../src/shared/templates';
import { createTestApp, type TestApp } from '../helpers/app';
import { createLiveCampaign, demoPage, publicHeaders } from '../helpers/fixtures';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

describe('starter templates', () => {
  it('are listed for the new-campaign gallery, to signed-in users only', async () => {
    expect((await t.req('GET', '/api/campaigns/templates')).status).toBe(401);
    await t.login();
    const { status, body } = await t.json('GET', '/api/campaigns/templates');
    expect(status).toBe(200);
    expect(body.templates.map((x: { id: string }) => x.id)).toEqual(TEMPLATES.map((x) => x.id));
    for (const x of body.templates) {
      expect(x).toMatchObject({
        name: expect.any(String),
        blurb: expect.any(String),
        use: expect.any(String),
        brand: expect.stringMatching(/^#/),
      });
      // the gallery gets descriptions, not whole pages
      expect(x).not.toHaveProperty('blocks');
    }
  });

  it('start a campaign from the chosen template, in its own style', async () => {
    await t.login();
    const res = await t.json('POST', '/api/campaigns', { name: 'Audit run', template: 'free-audit' });
    expect(res.status).toBe(201);
    const c = res.body.campaign;
    expect(c.name).toBe('Audit run');
    expect(c.source).toMatchObject({ type: 'scratch', template: 'free-audit' });
    expect(PageSchema.safeParse(c.page).success).toBe(true);
    expect(c.page.blocks[0].type).toBe('hero');
    expect(c.page.theme.gradient).toBe(true);
    expect(c.page.theme.font).toBe('manrope');
    const stored = await t.json('GET', `/api/campaigns/${c.id}`);
    expect(stored.body.campaign.page.blocks.map((b: { type: string }) => b.type)).toEqual(
      c.page.blocks.map((b: { type: string }) => b.type),
    );
    // a template ships ready to send: nothing for the author to fix before it can go out
    expect(stored.body.issues.filter((i: { level: string }) => i.level === 'warn')).toEqual([]);
  });

  it('still make a basic campaign when no template is named, and refuse a template that does not exist', async () => {
    await t.login();
    const plain = await t.json('POST', '/api/campaigns', { name: 'Plain' });
    expect(plain.status).toBe(201);
    expect(plain.body.campaign.page.blocks.length).toBeGreaterThan(3);
    const bad = await t.json('POST', '/api/campaigns', { name: 'Nope', template: 'does-not-exist' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('does-not-exist');
  });

  it('give two campaigns made from one template blocks that do not share ids', async () => {
    await t.login();
    const a = await t.json('POST', '/api/campaigns', { name: 'A', template: 'proposal' });
    const b = await t.json('POST', '/api/campaigns', { name: 'B', template: 'proposal' });
    const ids = (r: { body: { campaign: { page: { blocks: Array<{ id: string }> } } } }) => r.body.campaign.page.blocks.map((x) => x.id);
    expect(ids(a).some((id) => ids(b).includes(id))).toBe(false);
  });

  it('can be previewed as a sample prospect in the gallery, inside the dashboard but nowhere else', async () => {
    expect((await t.req('GET', '/preview/template/personal-pitch')).status).toBe(401);
    await t.login();
    const res = await t.req('GET', '/preview/template/personal-pitch');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval/);
    const html = await res.text();
    expect(html).toContain('Jane');
    expect(html).toContain('Northwind Traders');
    expect((await t.req('GET', '/preview/template/nope')).status).toBe(404);
  });
});

describe('self-hosted fonts', () => {
  const FILE = 'manrope-latin-wght-normal.woff2';

  it('are served from our own server, with a long cache, without a login', async () => {
    const res = await t.req('GET', `/f/manrope/files/${FILE}`, undefined, publicHeaders());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('font/woff2');
    expect(res.headers.get('cache-control')).toMatch(/immutable/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('wOF2');
  });

  it('only hand out the font files, and nothing else on disk', async () => {
    for (const url of [
      '/f/manrope/files/../package.json',
      '/f/manrope/files/..%2Fpackage.json',
      '/f/manrope/files/%2e%2e/%2e%2e/package.json',
      '/f/inter/files/manrope-latin-wght-normal.woff2', // another family's file
      '/f/manrope/files/manrope-latin-wght-normal.woff',
      '/f/manrope/files/manrope-latin-wght-italic.woff2',
      '/f/manrope/files/manrope-nonsense-wght-normal.woff2',
      '/f/not-a-font/files/not-a-font-latin-wght-normal.woff2',
      '/f/manrope/package.json',
      '/f/.bin/files/x-wght-normal.woff2',
    ]) {
      const res = await t.req('GET', url, undefined, publicHeaders());
      // refused outright, or (for paths the URL parser tidies away before routing) not a font route at all
      expect([404, 503], url).toContain(res.status);
      expect(res.headers.get('content-type') ?? '', url).not.toContain('font');
      expect(await res.text(), url).not.toContain('"name"');
    }
  });

  it('are what a page refers to when its theme asks for them, and only those', async () => {
    await t.login();
    const page = demoPage();
    page.theme = { ...page.theme, font: 'manrope', heading_font: 'fraunces' };
    const c = await createLiveCampaign(t, { page });
    const html = await (await t.req('GET', `/c/${c.slug}`, undefined, publicHeaders())).text();
    expect(html).toContain('@font-face');
    expect(html).toContain('url(/f/manrope/files/');
    expect(html).toContain('url(/f/fraunces/files/');
    expect(html).not.toContain('/f/inter/');
    expect(html).not.toContain('/f/space-grotesk/');
    expect(html).toContain('rel="preload"');
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('are not fetched at all by a page that sticks to system type', async () => {
    await t.login();
    const page = demoPage();
    page.theme = { ...page.theme, font: 'system', heading_font: 'serif' };
    const c = await createLiveCampaign(t, { page });
    const html = await (await t.req('GET', `/c/${c.slug}`, undefined, publicHeaders())).text();
    expect(html).not.toContain('@font-face');
    expect(html).not.toContain('/f/');
  });
});
