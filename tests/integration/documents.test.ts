import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractDocument } from '../../src/server/pdf/extract';
import { createTestApp, type TestApp } from '../helpers/app';
import { bearer, createApiKey, publicHeaders } from '../helpers/fixtures';

const fixture = (name: string) => fs.readFileSync(path.resolve('tests/fixtures', name));
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp({ ALLOW_PRIVATE_FETCH: 'true' });
  await t.login();
});
afterEach(() => t.close());

async function upload(name = 'playbook.pdf') {
  const form = new FormData();
  form.set('file', new File([fixture(name)], name, { type: 'application/pdf' }));
  return t.json('POST', '/api/campaigns/import-pdf', form);
}

describe('PDF import through the API', () => {
  it('builds a campaign from an uploaded PDF: page, brand colour, PDF attached, placeholders detected', async () => {
    const res = await upload();
    expect(res.status).toBe(201);
    const { campaign, report } = res.body;
    expect(campaign.name).toBe('The 2026 Outbound Pipeline Playbook');
    expect(campaign.status).toBe('draft');
    expect(campaign.page.theme.brand).toBe('#4f46e5');
    expect(campaign.page.blocks.map((b: { type: string }) => b.type)).toEqual(['hero', 'text', 'stats', 'image', 'checklist', 'testimonial', 'steps', 'cta', 'form']);
    expect(campaign.document.page_count).toBe(3);
    expect(campaign.document.filename).toBe('The 2026 Outbound Pipeline Playbook - {{company_short|for you}}.pdf');
    // the {{first_name}} {{last_name}} placeholder on the cover became a ready-made replace field
    expect(campaign.document.fields).toHaveLength(1);
    expect(campaign.document.fields[0]).toMatchObject({ type: 'text', page: 1, text: 'Attn: {{first_name}} {{last_name}}', color: '#ffffff' });
    expect(campaign.document.fields[0].mask.color).toBe('#4f46e5');
    expect(report.join(' ')).toMatch(/Found \{\{first_name\}\}/);
    // the picture from the PDF was stored and referenced
    const img = campaign.page.blocks.find((b: { type: string }) => b.type === 'image');
    expect(img.image.src).toMatch(/^ast_/);
    const served = await t.req('GET', `/a/${img.image.src}`, undefined, { host: 'go.test' });
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
  });

  it('rejects non-PDFs, oversized files and missing attachments', async () => {
    const bad = new FormData();
    bad.set('file', new File([Buffer.from('MZ not a pdf')], 'evil.pdf', { type: 'application/pdf' }));
    expect((await t.json('POST', '/api/campaigns/import-pdf', bad)).status).toBe(400);
    expect((await t.json('POST', '/api/campaigns/import-pdf', new FormData())).status).toBe(400);
    const small = await createTestApp({ MAX_UPLOAD_MB: '1' });
    await small.login();
    const big = new FormData();
    big.set('file', new File([Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1.5 * 1024 * 1024)])], 'big.pdf'));
    expect((await small.json('POST', '/api/campaigns/import-pdf', big)).status).toBe(400);
    await small.close();
  });

  it('requires a signed-in user', async () => {
    const form = new FormData();
    form.set('file', new File([fixture('playbook.pdf')], 'playbook.pdf'));
    expect((await t.json('POST', '/api/campaigns/import-pdf', form, { cookie: '' })).status).toBe(401);
  });

  it('imports a scanned PDF with a clear explanation instead of failing', async () => {
    const res = await upload('scan.pdf');
    expect(res.status).toBe(201);
    expect(res.body.report[0]).toMatch(/little or no selectable text/);
    expect(res.body.campaign.document.fields).toEqual([]);
  });
});

describe('personalised PDFs for prospects', () => {
  async function liveCampaign() {
    const imported = await upload();
    const c = imported.body.campaign;
    await t.json('POST', `/api/campaigns/${c.id}/status`, { status: 'live' });
    const key = await createApiKey(t);
    return { id: c.id as string, key, campaign: c };
  }
  const personalize = (key: string, id: string, row: Record<string, unknown>) => t.json('POST', '/api/v1/personalize', { campaign: id, ...row }, bearer(key));

  it('serves each prospect their own PDF, edited in place, and records the download', async () => {
    const { id, key } = await liveCampaign();
    const a = await personalize(key, id, { email: 'jane@acme.com', first_name: 'Jane', last_name: 'Doe', company: 'Acme, Inc.' });
    expect(a.body.pdf_url).toMatch(/\/p\/[A-Za-z0-9]{12}\.pdf$/);
    expect(a.body.cover_url).toMatch(/\/p\/[A-Za-z0-9]{12}\/cover\.png$/);
    const token = new URL(a.body.url).pathname.split('/').pop()!;

    const res = await t.req('GET', `/p/${token}.pdf`, undefined, publicHeaders());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('The 2026 Outbound Pipeline Playbook - Acme.pdf');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    const doc = await extractDocument(bytes);
    expect(doc.pages[0].runs.map((r) => r.text)).toContain('Attn: Jane Doe');

    const one = await t.json('GET', `/api/prospects/${a.body.id}`);
    expect(one.body.prospect.engagement.downloads).toBe(1);
    expect(one.body.timeline[0].type).toBe('download');
  });

  it('gives different people different files, and caches by content', async () => {
    const { id, key } = await liveCampaign();
    const jane = await personalize(key, id, { email: 'jane@acme.com', first_name: 'Jane', last_name: 'Doe' });
    const lukasz = await personalize(key, id, { email: 'l@initech.pl', first_name: 'ŁUKASZ', last_name: 'NOWAK', company: 'Initech GmbH' });
    const get = async (url: string) => new Uint8Array(await (await t.req('GET', new URL(url).pathname, undefined, publicHeaders())).arrayBuffer());
    const a = await get(jane.body.pdf_url);
    const b = await get(lukasz.body.pdf_url);
    expect((await extractDocument(b)).pages[0].runs.map((r) => r.text).join('').replace(/\s/g, '')).toContain('Attn:ŁukaszNowak'); // names are tidied
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).not.toBe(0);
    // second request is served from the content-addressed cache: byte-identical (the PDF carries a timestamp, so a rebuild would differ)
    const again = await get(jane.body.pdf_url);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(again))).toBe(0);
    const files = await t.ctx.storage.list(`campaigns/${id}/generated/${jane.body.id}`);
    expect(files).toHaveLength(1);
  });

  it('rebuilds when the prospect changes, keeping only the latest file', async () => {
    const { id, key } = await liveCampaign();
    const p = await personalize(key, id, { email: 'jane@acme.com', first_name: 'Jane', last_name: 'Doe' });
    const url = new URL(p.body.pdf_url).pathname;
    const first = new Uint8Array(await (await t.req('GET', url, undefined, publicHeaders())).arrayBuffer());
    await personalize(key, id, { email: 'jane@acme.com', last_name: 'Smith' });
    const second = new Uint8Array(await (await t.req('GET', url, undefined, publicHeaders())).arrayBuffer());
    expect((await extractDocument(first)).pages[0].runs.map((r) => r.text)).toContain('Attn: Jane Doe');
    expect((await extractDocument(second)).pages[0].runs.map((r) => r.text)).toContain('Attn: Jane Smith');
    expect(await t.ctx.storage.list(`campaigns/${id}/generated/${p.body.id}`)).toHaveLength(1);
  });

  it('serves a PNG cover of the personalised first page and uses it on the landing page', async () => {
    const { id, key } = await liveCampaign();
    const p = await personalize(key, id, { email: 'jane@acme.com', first_name: 'Jane', last_name: 'Doe' });
    const token = new URL(p.body.url).pathname.split('/').pop()!;
    const cover = await t.req('GET', `/p/${token}/cover.png`, undefined, publicHeaders());
    expect(cover.status).toBe(200);
    expect(cover.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await cover.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG');
    const html = await (await t.req('GET', `/p/${token}`, undefined, publicHeaders())).text();
    expect(html).toContain(`src="/p/${token}/cover.png"`);
    expect(html).toContain(`href="/p/${token}.pdf"`);
  });

  it('404s for campaigns without a PDF', async () => {
    const created = await t.json('POST', '/api/campaigns', { name: 'No PDF' });
    await t.json('POST', `/api/campaigns/${created.body.campaign.id}/status`, { status: 'live' });
    const key = await createApiKey(t);
    const p = await personalize(key, created.body.campaign.id, { email: 'a@b.co', first_name: 'A' });
    expect(p.body.pdf_url).toBeNull();
    const token = new URL(p.body.url).pathname.split('/').pop()!;
    expect((await t.req('GET', `/p/${token}.pdf`, undefined, publicHeaders())).status).toBe(404);
  });

  it('draws the prospect’s logo from their URL into the PDF, and skips it if the fetch fails', async () => {
    const png = (() => {
      const c = createCanvas(80, 40);
      const g = c.getContext('2d');
      g.fillStyle = '#ff0000';
      g.fillRect(0, 0, 80, 40);
      return c.toBuffer('image/png');
    })();
    const server = http.createServer((req, res) => {
      if (req.url === '/logo.png') {
        res.setHeader('content-type', 'image/png');
        res.end(png);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const { id, key, campaign } = await liveCampaign();
    await t.json('PUT', `/api/campaigns/${id}`, {
      document: { ...campaign.document, fields: [...campaign.document.fields, { id: 'logo', type: 'image', page: 1, rect: { x: 440, y: 60, w: 100, h: 50 }, src: '{{logo_url}}', fit: 'contain' }] },
    });
    const ok = await personalize(key, id, { email: 'a@b.co', first_name: 'A', last_name: 'B', logo_url: `http://127.0.0.1:${port}/logo.png` });
    const missing = await personalize(key, id, { email: 'c@d.co', first_name: 'C', last_name: 'D', logo_url: `http://127.0.0.1:${port}/nope.png` });
    const withLogo = await t.req('GET', new URL(ok.body.pdf_url).pathname, undefined, publicHeaders());
    const without = await t.req('GET', new URL(missing.body.pdf_url).pathname, undefined, publicHeaders());
    expect(withLogo.status).toBe(200);
    expect(without.status).toBe(200); // a dead logo link never breaks the document
    const a = (await withLogo.arrayBuffer()).byteLength;
    const b = (await without.arrayBuffer()).byteLength;
    expect(a).toBeGreaterThan(b); // the image is in the first file only
    server.close();
  });

  it('does not fetch logos from private networks when SSRF protection is on', async () => {
    const strict = await createTestApp();
    await strict.login();
    const form = new FormData();
    form.set('file', new File([fixture('playbook.pdf')], 'p.pdf'));
    const imp = await strict.json('POST', '/api/campaigns/import-pdf', form);
    const c = imp.body.campaign;
    await strict.json('PUT', `/api/campaigns/${c.id}`, { document: { ...c.document, fields: [{ id: 'logo', type: 'image', page: 1, rect: { x: 440, y: 60, w: 100, h: 50 }, src: '{{logo_url}}' }] } });
    await strict.json('POST', `/api/campaigns/${c.id}/status`, { status: 'live' });
    const key = await createApiKey(strict);
    const p = await strict.json('POST', '/api/v1/personalize', { campaign: c.id, email: 'a@b.co', first_name: 'A', logo_url: 'http://169.254.169.254/latest/meta-data/' }, bearer(key));
    const res = await strict.req('GET', new URL(p.body.pdf_url).pathname, undefined, publicHeaders());
    expect(res.status).toBe(200); // PDF still builds
    await strict.close();
  });
});

describe('studio endpoints', () => {
  it('serves page data with sampled colours, the page image, and ready-made fields', async () => {
    const { campaign } = (await upload()).body;
    const page = await t.json('GET', `/api/campaigns/${campaign.id}/document/page/1`);
    expect(page.status).toBe(200);
    expect(page.body.page.width).toBeCloseTo(595, 0);
    const prepared = page.body.page.runs.find((r: { text: string }) => /Prepared for/.test(r.text));
    expect(prepared).toMatchObject({ bg: '#4f46e5', color: '#ffffff' });
    const img = await t.req('GET', page.body.image_url);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');

    const f = await t.json('POST', `/api/campaigns/${campaign.id}/document/field-from-run`, { page: 1, run_id: prepared.id, template: 'Prepared for {{company}}' });
    expect(f.body.field).toMatchObject({ type: 'text', text: 'Prepared for {{company}}', page: 1 });
    expect(f.body.field.rect.w).toBeGreaterThan(prepared.w);
    expect((await t.json('POST', `/api/campaigns/${campaign.id}/document/field-from-run`, { page: 1, run_id: 'nope' })).status).toBe(404);
    expect((await t.json('GET', `/api/campaigns/${campaign.id}/document/page/99`)).status).toBe(422);
  });

  it('previews an unsaved draft as a sample prospect', async () => {
    const { campaign } = (await upload()).body;
    const page = (await t.json('GET', `/api/campaigns/${campaign.id}/document/page/1`)).body.page;
    const prepared = page.runs.find((r: { text: string }) => /Prepared for/.test(r.text));
    const field = (await t.json('POST', `/api/campaigns/${campaign.id}/document/field-from-run`, { page: 1, run_id: prepared.id, template: 'Prepared for {{company_short}}' })).body.field;
    const res = await t.req('POST', `/api/campaigns/${campaign.id}/document/preview`, { document: { ...campaign.document, fields: [field] }, source: { kind: 'sample', index: 0 }, page: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).length).toBeGreaterThan(5000);
  });

  it('the builder preview can fetch the personalised PDF and cover for a sample', async () => {
    const { campaign } = (await upload()).body;
    const pdf = await t.req('GET', `/api/campaigns/${campaign.id}/document/preview.pdf?as=sample:0`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const png = await t.req('GET', `/api/campaigns/${campaign.id}/document/preview/1.png?as=sample:1`);
    expect(png.status).toBe(200);
  });

  it('is login-protected', async () => {
    const { campaign } = (await upload()).body;
    expect((await t.json('GET', `/api/campaigns/${campaign.id}/document/page/1`, undefined, { cookie: '' })).status).toBe(401);
    expect((await t.req('GET', `/api/campaigns/${campaign.id}/document/page/1.png`, undefined, { cookie: '' })).status).toBe(401);
  });
});

describe('document lifecycle', () => {
  it('duplicating a campaign gives the copy its own PDF, so deleting one leaves the other working', async () => {
    const { campaign } = (await upload()).body;
    const dup = (await t.json('POST', `/api/campaigns/${campaign.id}/duplicate`)).body.campaign;
    expect(dup.document.asset_id).not.toBe(campaign.document.asset_id);
    await t.json('DELETE', `/api/campaigns/${campaign.id}`);
    const page = await t.json('GET', `/api/campaigns/${dup.id}/document/page/1`);
    expect(page.status).toBe(200);
  });

  it('deleting a campaign removes its files and its prospects’ generated PDFs', async () => {
    const { campaign } = (await upload()).body;
    await t.json('POST', `/api/campaigns/${campaign.id}/status`, { status: 'live' });
    const key = await createApiKey(t);
    const p = await t.json('POST', '/api/v1/personalize', { campaign: campaign.id, email: 'a@b.co', first_name: 'A', last_name: 'B' }, bearer(key));
    await t.req('GET', new URL(p.body.pdf_url).pathname, undefined, publicHeaders());
    expect((await t.ctx.storage.list(`campaigns/${campaign.id}/generated`)).length).toBeGreaterThan(0);
    const asset = t.ctx.db.get<{ storage_key: string }>("SELECT storage_key FROM assets WHERE kind = 'pdf'")!;
    await t.json('DELETE', `/api/campaigns/${campaign.id}`);
    expect(await t.ctx.storage.exists(asset.storage_key)).toBe(false);
    expect(await t.ctx.storage.list(`campaigns/${campaign.id}/generated`)).toEqual([]);
    expect(t.ctx.db.get('SELECT 1 FROM prospects WHERE campaign_id = ?', campaign.id)).toBeUndefined();
  });

  it('replacing the PDF resets fields for the new geometry and re-detects placeholders', async () => {
    const { campaign } = (await upload('playbook.pdf')).body;
    const form = new FormData();
    form.set('file', new File([fixture('case-study.pdf')], 'case-study.pdf', { type: 'application/pdf' }));
    const res = await t.json('POST', `/api/campaigns/${campaign.id}/document/upload`, form);
    expect(res.status).toBe(200);
    expect(res.body.campaign.document.page_count).toBe(2);
    expect(res.body.campaign.document.fields).toEqual([]);
    expect(res.body.detected).toBe(0);
    expect(t.ctx.db.all("SELECT id FROM assets WHERE kind = 'pdf'")).toHaveLength(1); // the old file is gone
  });

  it('removing the PDF detaches it', async () => {
    const { campaign } = (await upload()).body;
    const res = await t.json('DELETE', `/api/campaigns/${campaign.id}/document`);
    expect(res.body.campaign.document).toBeNull();
    expect(t.ctx.db.all("SELECT id FROM assets WHERE kind = 'pdf'")).toHaveLength(0);
  });
});
