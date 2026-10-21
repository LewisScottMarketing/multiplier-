import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app';
import { bearer, createApiKey, createLiveCampaign, publicHeaders } from '../helpers/fixtures';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  await t.login();
});
afterEach(() => t.close());

describe('analytics', () => {
  it('summarises the funnel, trend, top prospects, segments and activity — humans only', async () => {
    const c = await createLiveCampaign(t);
    const key = await createApiKey(t);
    const mk = async (row: Record<string, unknown>) => {
      const r = await t.json('POST', '/api/v1/personalize', { campaign: c.id, ...row }, bearer(key));
      return { ...r.body, token: new URL(r.body.url).pathname.split('/').pop() as string };
    };
    const jane = await mk({ email: 'jane@acme.com', first_name: 'Jane', last_name: 'Doe', company: 'Acme', job_title: 'VP of Marketing' });
    const sam = await mk({ email: 'sam@globex.io', first_name: 'Sam', company: 'Globex', job_title: 'Head of Sales' });
    await mk({ email: 'kim@initech.com', first_name: 'Kim', job_title: 'Marketing Manager' });
    await mk({ email: 'lee@x.com', first_name: 'Lee', job_title: 'Account Executive' });

    const view = (token: string, sid: string, w = 1280) => t.req('POST', `/t/${token}`, { type: 'view', sid, w }, publicHeaders());
    await view(jane.token, 'jane1abc');
    await t.req('GET', `/r/${jane.token}/hero1.primary`, undefined, publicHeaders());
    await t.req(
      'POST',
      `/p/${jane.token}/submit`,
      { _block: 'form1', name: 'Jane', email: 'jane@acme.com' },
      { ...publicHeaders(), accept: 'application/json' },
    );
    await view(sam.token, 'sam1abcd', 390);
    // a scanner "opens" Lee's page; it must not count
    await t.req(
      'POST',
      `/t/${(await mk({ email: 'bot@x.com', first_name: 'Bot' })).token}`,
      { type: 'view', sid: 'bot1abcd' },
      publicHeaders('Mozilla/5.0 (compatible; Proofpoint URL Defense)'),
    );

    const res = await t.json('GET', `/api/campaigns/${c.id}/analytics?days=7`);
    expect(res.status).toBe(200);
    const { totals, funnel, series, top, segments, devices, clicks, activity } = res.body;
    expect(totals).toMatchObject({ prospects: 5, opened: 2, converted: 1, clicks: 1, submissions: 1 });
    expect(funnel.map((f: { n: number }) => f.n)).toEqual([5, 2, 1, 1]);
    expect(series).toHaveLength(7);
    const today = series[series.length - 1];
    expect(today).toMatchObject({ views: 2, clicks: 1, submissions: 1 });
    expect(top[0]).toMatchObject({ name: 'Jane Doe', company: 'Acme' }); // converted + clicked outranks a plain open
    expect(segments.departments.find((d: { key: string }) => d.key === 'marketing')).toMatchObject({
      prospects: 2,
      opened: 1,
      converted: 1,
    });
    expect(segments.departments.find((d: { key: string }) => d.key === 'sales')).toMatchObject({ prospects: 2, opened: 1, converted: 0 });
    expect(devices).toEqual({ mobile: 1, desktop: 1 });
    expect(clicks[0]).toMatchObject({ block: 'hero1', slot: 'primary', label: 'Book a call', n: 1 });
    expect(activity.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['view', 'click', 'submit']));
    expect(activity.every((a: { name: string }) => a.name !== 'Bot')).toBe(true);
  });

  it('gives an overview across campaigns, and zero-fills quiet days', async () => {
    await createLiveCampaign(t, { name: 'A' });
    await createLiveCampaign(t, { name: 'B', publish: false });
    const res = await t.json('GET', '/api/overview');
    expect(res.status).toBe(200);
    expect(res.body.campaigns).toEqual({ live: 1, total: 2 });
    expect(res.body.series).toHaveLength(14);
    expect(res.body.series.every((p: { views: number }) => p.views === 0)).toBe(true);
    expect(res.body.totals.prospects).toBe(0);
  });

  it('is login-protected and 404s for unknown campaigns', async () => {
    expect((await t.json('GET', '/api/overview', undefined, { cookie: '' })).status).toBe(401);
    expect((await t.json('GET', '/api/campaigns/cmp_nope/analytics')).status).toBe(404);
  });
});

describe('audience', () => {
  it('imports a CSV in two steps, auto-mapping columns, and exports it with links and spreadsheet-safe cells', async () => {
    const c = await createLiveCampaign(t);
    const csv = [
      'First Name,Last Name,Work Email,Company Name,Title,Industry',
      'Jane,Doe,jane@acme.com,Acme,VP of Marketing,Fintech',
      '=HYPERLINK("http://evil"),X,x@y.co,"Bad, Co",CEO,SaaS',
      ',,,,,',
    ].join('\n');
    const form = new FormData();
    form.set('file', new File([csv], 'leads.csv', { type: 'text/csv' }));
    const preview = await t.json('POST', `/api/campaigns/${c.id}/prospects/import/preview`, form);
    expect(preview.status).toBe(200);
    expect(preview.body.suggested_mapping).toMatchObject({
      'First Name': 'first_name',
      'Last Name': 'last_name',
      'Work Email': 'email',
      'Company Name': 'company',
      Title: 'job_title',
      Industry: 'industry',
    });
    expect(preview.body.total).toBe(2); // blank lines skipped

    // the dashboard applies the mapping and sends rows
    const map = preview.body.suggested_mapping as Record<string, string>;
    const rows = preview.body.rows.map((r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [map[k], v])));
    const done = await t.json('POST', `/api/campaigns/${c.id}/prospects/import`, { rows });
    expect(done.body).toMatchObject({ created: 2, failed: 0 });
    const again = await t.json('POST', `/api/campaigns/${c.id}/prospects/import`, { rows });
    expect(again.body).toMatchObject({ created: 0, unchanged: 2 }); // re-importing is harmless

    const exp = await t.req('GET', `/api/campaigns/${c.id}/prospects/export.csv`);
    expect(exp.headers.get('content-type')).toContain('text/csv');
    const text = await exp.text();
    expect(text).toContain('multiplier_url');
    expect(text).toContain('http://go.test/p/');
    expect(text).toContain(`'=HYPERLINK`); // formula neutralised
    expect(text).not.toMatch(/^=HYPERLINK/m);
    expect(text).toContain('industry');
  });

  it('reports per-row import errors without aborting the batch', async () => {
    const c = await createLiveCampaign(t, { settings: { required_fields: ['company'] } });
    const res = await t.json('POST', `/api/campaigns/${c.id}/prospects/import`, {
      rows: [{ email: 'a@b.co', company: 'A' }, { email: 'c@d.co' }, { company: 'No identity' }],
    });
    expect(res.body).toMatchObject({ created: 1, failed: 2 });
    expect(res.body.errors).toHaveLength(2);
    expect(res.body.errors[0].row).toBe(2);
  });

  it('searches, filters by stage and sorts', async () => {
    const c = await createLiveCampaign(t);
    const key = await createApiKey(t);
    const mk = (row: Record<string, unknown>) => t.json('POST', '/api/v1/personalize', { campaign: c.id, ...row }, bearer(key));
    const a = await mk({ email: 'a@acme.com', first_name: 'Alice', company: 'Acme' });
    await mk({ email: 'b@globex.com', first_name: 'Bob', company: 'Globex' });
    await t.req('POST', `/t/${new URL(a.body.url).pathname.split('/').pop()}`, { type: 'view', sid: 'abcd1234' }, publicHeaders());
    const q = await t.json('GET', `/api/campaigns/${c.id}/prospects?q=glob`);
    expect(q.body.prospects.map((p: { first_name: string }) => p.first_name)).toEqual(['Bob']);
    const opened = await t.json('GET', `/api/campaigns/${c.id}/prospects?stage=opened`);
    expect(opened.body.prospects.map((p: { first_name: string }) => p.first_name)).toEqual(['Alice']);
    const fresh = await t.json('GET', `/api/campaigns/${c.id}/prospects?stage=new`);
    expect(fresh.body.total).toBe(1);
    // LIKE wildcards in the search are treated literally
    expect((await t.json('GET', `/api/campaigns/${c.id}/prospects?q=%25`)).body.total).toBe(0);
  });

  it('deleting a prospect removes their events and submissions', async () => {
    const c = await createLiveCampaign(t);
    const key = await createApiKey(t);
    const p = await t.json('POST', '/api/v1/personalize', { campaign: c.id, email: 'a@b.co', first_name: 'A' }, bearer(key));
    const token = new URL(p.body.url).pathname.split('/').pop();
    await t.req('POST', `/t/${token}`, { type: 'view', sid: 'abcd1234' }, publicHeaders());
    await t.json('DELETE', `/api/prospects/${p.body.id}`);
    expect(t.ctx.db.get('SELECT 1 FROM events WHERE prospect_id = ?', p.body.id)).toBeUndefined();
    expect((await t.req('GET', `/p/${token}`, undefined, publicHeaders())).status).toBe(404);
  });
});
