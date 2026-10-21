import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app';
import { bearer, createApiKey, createLiveCampaign, publicHeaders } from '../helpers/fixtures';

let t: TestApp;
let key: string;
let campaign: { id: string; slug: string };

beforeEach(async () => {
  t = await createTestApp();
  await t.login();
  campaign = await createLiveCampaign(t);
  key = await createApiKey(t);
});
afterEach(() => t.close());

const personalize = (body: Record<string, unknown>, k = key) => t.json('POST', '/api/v1/personalize', body, bearer(k));

describe('POST /api/v1/personalize (what Clay calls)', () => {
  it('creates a prospect and returns a flat, Clay-friendly response', async () => {
    const res = await personalize({ campaign: campaign.id, first_name: 'Jane', last_name: 'Doe', email: 'jane@acme.com', company: 'Acme, Inc.', job_title: 'VP of Marketing' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      status: 'created',
      first_name: 'Jane',
      seniority: 'vp',
      department: 'marketing',
      headline: 'Pipeline plan for Acme, Inc.',
    });
    expect(res.body.url).toMatch(/^http:\/\/go\.test\/p\/[A-Za-z0-9]{10}$/);
    expect(res.body.pdf_url).toBeNull(); // no PDF attached to this campaign
    expect(res.body.id).toMatch(/^prs_/);
  });

  it('is idempotent: the same row returns the same link and reports "unchanged"', async () => {
    const row = { campaign: campaign.id, email: 'jane@acme.com', first_name: 'Jane', company: 'Acme' };
    const a = await personalize(row);
    const b = await personalize(row);
    expect(b.body.url).toBe(a.body.url);
    expect(b.body.status).toBe('unchanged');
    const c = await personalize({ ...row, company: 'Acme Corp' });
    expect(c.body.url).toBe(a.body.url);
    expect(c.body.status).toBe('updated');
    const list = await t.json('GET', `/api/campaigns/${campaign.id}/prospects`);
    expect(list.body.total).toBe(1);
  });

  it('recognises the same person by external_id, email or LinkedIn URL', async () => {
    const a = await personalize({ campaign: campaign.id, external_id: 'row-1', first_name: 'A' });
    const b = await personalize({ campaign: campaign.id, external_id: 'row-1', first_name: 'B' });
    expect(b.body.url).toBe(a.body.url);
    const c = await personalize({ campaign: campaign.id, linkedin_url: 'https://www.linkedin.com/in/jane-doe/?utm=1', first_name: 'J' });
    const d = await personalize({ campaign: campaign.id, linkedin_url: 'http://linkedin.com/in/Jane-Doe', first_name: 'J' });
    expect(d.body.url).toBe(c.body.url);
  });

  it('accepts campaign by slug, and defaults to the only live campaign', async () => {
    const bySlug = await personalize({ campaign: campaign.slug, email: 'a@x.co' });
    expect(bySlug.status).toBe(200);
    const implicit = await personalize({ email: 'b@x.co' });
    expect(implicit.status).toBe(200);
    expect(implicit.body.campaign.id).toBe(campaign.id);
  });

  it('asks which campaign to use when it is ambiguous, and 404s on unknown ones', async () => {
    await createLiveCampaign(t, { name: 'Second' });
    const amb = await personalize({ email: 'a@x.co' });
    expect(amb.status).toBe(422);
    expect(amb.body.error.message).toMatch(/campaign/i);
    const nf = await personalize({ campaign: 'nope', email: 'a@x.co' });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('campaign_not_found');
  });

  it('treats unknown top-level keys as custom fields, normalising their names, and keeps nested data', async () => {
    const res = await personalize({ campaign: campaign.id, email: 'a@x.co', 'Company Industry': 'Fintech', data: { pain_point: 'low reply rates' }, enrichment: { employees: 120 } });
    expect(res.status).toBe(200);
    const list = await t.json('GET', `/api/campaigns/${campaign.id}/prospects`);
    expect(list.body.prospects[0].data).toMatchObject({ company_industry: 'Fintech', pain_point: 'low reply rates', enrichment_employees: 120 });
    expect(list.body.custom_fields).toEqual(expect.arrayContaining(['company_industry', 'pain_point']));
  });

  it('does not let empty values from Clay wipe existing data', async () => {
    await personalize({ campaign: campaign.id, email: 'a@x.co', company: 'Acme', job_title: 'CEO' });
    await personalize({ campaign: campaign.id, email: 'a@x.co', company: '', job_title: null });
    const list = await t.json('GET', `/api/campaigns/${campaign.id}/prospects`);
    expect(list.body.prospects[0]).toMatchObject({ company: 'Acme', job_title: 'CEO' });
  });

  it('refuses rows with no way to identify the person', async () => {
    const res = await personalize({ campaign: campaign.id, company: 'Acme' });
    expect(res.status).toBe(422);
  });

  it('enforces required fields with a 422 Clay will surface as a cell error — and issues no link', async () => {
    await t.json('PUT', `/api/campaigns/${campaign.id}`, { settings: { required_fields: ['first_name', 'company'] } });
    const res = await personalize({ campaign: campaign.id, email: 'a@x.co', first_name: 'Jane' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('missing_required_fields');
    expect(res.body.error.details.missing).toEqual(['company']);
    expect((await t.json('GET', `/api/campaigns/${campaign.id}/prospects`)).body.total).toBe(0);
    // a full name satisfies first_name
    const ok = await personalize({ campaign: campaign.id, email: 'a@x.co', full_name: 'Jane Doe', company: 'Acme' });
    expect(ok.status).toBe(200);
  });

  it('warns about blanks that would show, and about unpublished campaigns', async () => {
    const page = await t.json('GET', `/api/campaigns/${campaign.id}`);
    const withBare = { ...page.body.campaign.page, blocks: [...page.body.campaign.page.blocks, { id: 'bare', type: 'text', body: 'Role: {{job_title}}' }] };
    await t.json('PUT', `/api/campaigns/${campaign.id}`, { page: withBare });
    const res = await personalize({ campaign: campaign.id, email: 'a@x.co', first_name: 'Jane' });
    expect(res.body.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing_field', field: 'job_title' })]));
    await t.json('POST', `/api/campaigns/${campaign.id}/status`, { status: 'draft' });
    const draft = await personalize({ campaign: campaign.id, email: 'b@x.co', first_name: 'Jane', job_title: 'CEO' });
    expect(draft.body.warnings.map((w: { code: string }) => w.code)).toContain('campaign_not_live');
  });

  it('cleans shouty names from enrichment tools', async () => {
    const res = await personalize({ campaign: campaign.id, email: 'a@x.co', first_name: 'JANE', last_name: 'MCDONALD', company: 'ACME INC' });
    expect(res.body.first_name).toBe('Jane');
    const page = await t.req('GET', new URL(res.body.url).pathname, undefined, publicHeaders());
    expect(await page.text()).toContain('Prepared for Jane at ACME INC'); // company is left exactly as supplied
  });
});

describe('API key auth', () => {
  it('rejects missing, malformed and revoked keys', async () => {
    expect((await t.json('POST', '/api/v1/personalize', { email: 'a@x.co' }, { cookie: '' })).status).toBe(401);
    expect((await personalize({ email: 'a@x.co' }, 'mpl_live_nope')).status).toBe(401);
    const keys = await t.json('GET', '/api/api-keys');
    await t.json('DELETE', `/api/api-keys/${keys.body.keys[0].id}`);
    expect((await personalize({ campaign: campaign.id, email: 'a@x.co' })).status).toBe(401);
  });

  it('never returns the stored key again, only a prefix and last four', async () => {
    const list = await t.json('GET', '/api/api-keys');
    expect(JSON.stringify(list.body)).not.toContain(key);
    expect(list.body.keys[0].prefix).toBe(key.slice(0, 13));
    expect(list.body.keys[0].last4).toBe(key.slice(-4));
  });

  it('does not accept a dashboard session cookie on the machine API', async () => {
    const res = await t.json('POST', '/api/v1/personalize', { campaign: campaign.id, email: 'a@x.co' }); // has the session cookie
    expect(res.status).toBe(401);
  });

  it('restricts a campaign-scoped key to that campaign', async () => {
    const other = await createLiveCampaign(t, { name: 'Other' });
    const scoped = await createApiKey(t, { campaign_id: campaign.id });
    expect((await personalize({ campaign: campaign.id, email: 'a@x.co' }, scoped)).status).toBe(200);
    expect((await personalize({ campaign: other.id, email: 'a@x.co' }, scoped)).status).toBe(403);
    expect((await personalize({ email: 'b@x.co' }, scoped)).body.campaign.id).toBe(campaign.id); // defaults to its campaign
  });

  it('GET /ping tells Clay the connection works and lists campaigns', async () => {
    const res = await t.json('GET', '/api/v1/ping', undefined, bearer(key));
    expect(res.status).toBe(200);
    expect(res.body.campaigns[0]).toMatchObject({ id: campaign.id, status: 'live' });
  });

  it('throttles repeated bad keys', async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await personalize({ email: 'a@x.co' }, 'mpl_live_wrong')).status;
    expect(last).toBe(429);
  });
});

describe('POST /api/v1/personalize/batch', () => {
  it('processes rows independently and reports per-row results', async () => {
    await t.json('PUT', `/api/campaigns/${campaign.id}`, { settings: { required_fields: ['company'] } });
    const res = await t.json('POST', '/api/v1/personalize/batch', { campaign: campaign.id, rows: [{ email: 'a@x.co', company: 'A' }, { email: 'b@x.co' }, { email: 'c@x.co', company: 'C' }] }, bearer(key));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, processed: 3, succeeded: 2, failed: 1 });
    expect(res.body.results[1].error.code).toBe('missing_required_fields');
    expect(res.body.results[0].url).toMatch(/\/p\//);
  });

  it('caps batch size', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ email: `u${i}@x.co` }));
    expect((await t.json('POST', '/api/v1/personalize/batch', { campaign: campaign.id, rows }, bearer(key))).status).toBe(400);
  });
});

describe('engagement lookups', () => {
  it('lets Clay ask whether someone has opened their page', async () => {
    const made = await personalize({ campaign: campaign.id, email: 'jane@acme.com', external_id: 'clay-1', first_name: 'Jane' });
    const before = await t.json('GET', '/api/v1/prospects?external_id=clay-1', undefined, bearer(key));
    expect(before.body.engagement).toMatchObject({ stage: 'new', views: 0 });
    const token = new URL(made.body.url).pathname.split('/').pop()!;
    await t.req('POST', `/t/${token}`, { type: 'view', sid: 'abc123xyz' }, publicHeaders());
    const after = await t.json('GET', '/api/v1/prospects?email=jane@acme.com', undefined, bearer(key));
    expect(after.body.engagement).toMatchObject({ stage: 'opened', views: 1 });
    const list = await t.json('GET', `/api/v1/prospects?stage=opened`, undefined, bearer(key));
    expect(list.body.total).toBe(1);
  });

  it('404s for unknown prospects', async () => {
    expect((await t.json('GET', '/api/v1/prospects?email=ghost@x.co', undefined, bearer(key))).status).toBe(404);
  });
});
