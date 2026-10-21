import { Hono } from 'hono';
import { z } from 'zod';
import { toStr } from '@shared/template';
import { badRequest, tooLarge } from '../lib/errors';
import { jsonBody, requireUser, type Env } from '../http';
import { requireCampaign } from '../services/campaigns';
import { MAX_IMPORT_ROWS, parseCsv, toCsv } from '../services/csv';
import { prospectTimeline } from '../services/events';
import { pageUrl, pdfUrl } from '../services/links';
import {
  contextFor,
  customFieldNames,
  deleteProspect,
  listProspects,
  publicProspect,
  requireProspect,
  stageOf,
  upsertProspect,
} from '../services/prospects';
import { parseJson } from '../db/database';

const ListQuery = z.object({
  q: z.string().max(100).optional(),
  sort: z.enum(['created', 'last_seen', 'score', 'views', 'company']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  stage: z.enum(['all', 'new', 'opened', 'engaged', 'converted']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function prospectRoutes() {
  const r = new Hono<Env>();
  r.use('*', requireUser);

  r.get('/campaigns/:id/prospects', (c) => {
    const app = c.get('app');
    const campaign = requireCampaign(app, c.req.param('id'));
    const q = ListQuery.parse(c.req.query());
    const { rows, total } = listProspects(app, campaign.id, q);
    return c.json({
      total,
      prospects: rows.map((p) => ({ ...publicProspect(app, campaign, p), stage: stageOf(p), data: p.data })),
      custom_fields: customFieldNames(app, campaign.id),
    });
  });

  r.post('/campaigns/:id/prospects', async (c) => {
    const app = c.get('app');
    const campaign = requireCampaign(app, c.req.param('id'));
    const body = await jsonBody(c, z.record(z.string(), z.unknown()));
    const { prospect, status } = upsertProspect(app, campaign, body);
    return c.json({ status, prospect: publicProspect(app, campaign, prospect) }, status === 'created' ? 201 : 200);
  });

  /** Step 1 of CSV import: parse and suggest a column mapping. Nothing is stored. */
  r.post('/campaigns/:id/prospects/import/preview', async (c) => {
    const app = c.get('app');
    requireCampaign(app, c.req.param('id'));
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw badRequest('Attach a CSV file as "file".');
    if (file.size > 10 * 1024 * 1024) throw tooLarge('CSV files can be up to 10 MB.');
    const parsed = parseCsv(Buffer.from(await file.arrayBuffer()));
    return c.json({ headers: parsed.headers, suggested_mapping: parsed.suggested_mapping, total: parsed.rows.length, rows: parsed.rows });
  });

  /** Step 2: the dashboard sends the mapped rows. Each row is validated independently. */
  r.post('/campaigns/:id/prospects/import', async (c) => {
    const app = c.get('app');
    const campaign = requireCampaign(app, c.req.param('id'));
    const body = await jsonBody(c, z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_IMPORT_ROWS) }));
    const result = { created: 0, updated: 0, unchanged: 0, failed: 0, errors: [] as Array<{ row: number; message: string }> };
    body.rows.forEach((row, i) => {
      try {
        const { status } = upsertProspect(app, campaign, row);
        result[status]++;
      } catch (e) {
        result.failed++;
        if (result.errors.length < 50) result.errors.push({ row: i + 1, message: (e as Error).message });
      }
    });
    return c.json(result);
  });

  r.get('/campaigns/:id/prospects/export.csv', (c) => {
    const app = c.get('app');
    const campaign = requireCampaign(app, c.req.param('id'));
    const { rows } = listProspects(app, campaign.id, { limit: 500, sort: 'created', order: 'asc' });
    const all = [...rows];
    for (let offset = 500; offset < 50_000 && all.length === offset; offset += 500)
      all.push(...listProspects(app, campaign.id, { limit: 500, offset, sort: 'created', order: 'asc' }).rows);
    const custom = customFieldNames(app, campaign.id);
    const headers = [
      'first_name',
      'last_name',
      'email',
      'company',
      'job_title',
      'linkedin_url',
      ...custom,
      'multiplier_url',
      'multiplier_pdf_url',
      'stage',
      'views',
      'clicks',
      'downloads',
      'submissions',
      'last_seen_at',
    ];
    const data = all.map((p) => ({
      first_name: p.first_name,
      last_name: p.last_name,
      email: p.email,
      company: p.company,
      job_title: p.job_title,
      linkedin_url: p.linkedin_url,
      ...Object.fromEntries(custom.map((k) => [k, Array.isArray(p.data[k]) ? (p.data[k] as unknown[]).join(', ') : p.data[k]])),
      multiplier_url: pageUrl(app, campaign, p.token),
      multiplier_pdf_url: campaign.document ? pdfUrl(app, campaign, p.token) : '',
      stage: stageOf(p),
      views: p.views,
      clicks: p.clicks,
      downloads: p.downloads,
      submissions: p.submissions,
      last_seen_at: p.last_seen_at ? new Date(p.last_seen_at).toISOString() : '',
    }));
    return new Response(toCsv(headers, data), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${campaign.slug}-prospects.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  });

  r.get('/prospects/:id', (c) => {
    const app = c.get('app');
    const p = requireProspect(app, c.req.param('id'));
    const campaign = requireCampaign(app, p.campaign_id);
    const submissions = app.db
      .all<{ id: string; data: string; created_at: number }>(
        'SELECT id, data, created_at FROM submissions WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 20',
        p.id,
      )
      .map((s) => ({ id: s.id, created_at: s.created_at, data: parseJson<Record<string, unknown>>(s.data, {}) }));
    const context = contextFor(app, campaign, p);
    return c.json({
      prospect: { ...publicProspect(app, campaign, p), stage: stageOf(p), data: p.data },
      campaign: { id: campaign.id, name: campaign.name, slug: campaign.slug, status: campaign.status },
      timeline: prospectTimeline(app, p.id),
      submissions,
      context: Object.fromEntries(Object.entries(context).filter(([, v]) => typeof v === 'string' && toStr(v))),
    });
  });

  r.delete('/prospects/:id', (c) => {
    deleteProspect(c.get('app'), c.req.param('id'));
    return c.json({ ok: true });
  });

  return r;
}
