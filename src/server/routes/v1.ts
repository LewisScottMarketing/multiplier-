import { Hono } from 'hono';
import { z } from 'zod';
import { toStr } from '@shared/template';
import { HttpError, notFound, unprocessable } from '../lib/errors';
import { jsonBody, rateLimit, requireApiKey, type Env } from '../http';
import type { AppContext } from '../context';
import type { Campaign } from '@shared/schema';
import { findCampaign, getCampaign, listCampaigns } from '../services/campaigns';
import { renderPlain } from '../render/rich';
import { summariseTokens } from '../render/page';
import { contextFor, getProspect, listProspects, publicProspect, upsertProspect, type Prospect } from '../services/prospects';
import { renderProspectPage } from '../services/render';
import { emitEvent } from '../services/webhooks';
import { generateAiFields } from '../services/ai';

/**
 * Machine API used by Clay's HTTP API column (and anything else that can send JSON).
 *
 * Design rules, all driven by how Clay behaves:
 *  - Flat top-level response keys (`url`, `pdf_url`, …) so "field path to return" is trivial.
 *  - Idempotent: re-running a row returns the same link instead of creating a duplicate.
 *  - Any 2xx is "success" to Clay, so we only return 2xx when a usable link exists.
 *  - Fast: nothing slow runs inline unless the caller opts in (AI copy is time-boxed).
 */

const Body = z.record(z.string(), z.unknown()).refine((o) => Object.keys(o).length <= 300, 'Too many fields');

function resolveCampaign(app: AppContext, key: { campaign_id: string | null }, requested: unknown): Campaign {
  const wanted = typeof requested === 'string' && requested.trim() ? requested.trim() : key.campaign_id;
  if (!wanted) {
    const live = listCampaigns(app).filter((c) => c.status === 'live');
    if (live.length === 1) return getCampaign(app, live[0].id)!;
    throw unprocessable('Say which campaign to use: send "campaign": "<campaign id or slug>" in the body.');
  }
  const campaign = findCampaign(app, wanted);
  if (!campaign)
    throw new HttpError(
      404,
      'campaign_not_found',
      `Campaign “${wanted}” not found. Use the campaign id (cmp_…) or slug shown in Multiplier.`,
    );
  if (key.campaign_id && key.campaign_id !== campaign.id)
    throw new HttpError(403, 'forbidden', 'This API key is restricted to a different campaign.');
  return campaign;
}

interface Warning {
  code: string;
  message: string;
  field?: string;
}

async function personalizeOne(app: AppContext, campaign: Campaign, row: Record<string, unknown>, opts: { ai?: boolean }) {
  const { prospect, status } = upsertProspect(app, campaign, row);
  let current: Prospect = prospect;
  const warnings: Warning[] = [];

  if (opts.ai !== false && campaign.settings.ai_fields.length > 0) {
    const r = await generateAiFields(app, campaign, current);
    current = r.prospect;
    warnings.push(...r.warnings);
  }

  if (status === 'created') emitEvent(app, 'prospect.created', campaign, current);

  // Render once so we can tell the caller what a prospect will actually see.
  const rendered = renderProspectPage(app, campaign, current, new URL(app.config.publicUrl).host);
  const gaps = summariseTokens(rendered.tokens);
  for (const f of gaps.missing)
    warnings.push({
      code: 'missing_field',
      field: f,
      message: `“${f}” is empty for this prospect and has no fallback, so part of the page will be blank.`,
    });
  if (campaign.status !== 'live')
    warnings.push({
      code: 'campaign_not_live',
      message: 'This campaign is not published yet, so the link will not open. Publish it in Multiplier.',
    });

  const ctx = contextFor(app, campaign, current);
  const hero = campaign.page.blocks.find((b) => b.type === 'hero');
  const pub = publicProspect(app, campaign, current);
  return {
    ok: true as const,
    status,
    id: current.id,
    url: pub.url,
    pdf_url: pub.pdf_url,
    cover_url: pub.cover_url,
    headline: hero?.type === 'hero' ? renderPlain(hero.headline, ctx) : '',
    first_name: pub.first_name,
    seniority: pub.seniority,
    department: pub.department,
    campaign: { id: campaign.id, name: campaign.name, slug: campaign.slug, status: campaign.status },
    warnings,
    prospect: pub,
  };
}

export function v1Routes() {
  const r = new Hono<Env>();
  r.use('*', requireApiKey);
  r.use(
    '*',
    rateLimit('v1', 600, 60_000, (c) => c.get('apiKey').id),
  );

  /** "Test connection" for Clay: proves the key works and lists campaigns it can use. */
  r.get('/ping', (c) => {
    const app = c.get('app');
    const key = c.get('apiKey');
    return c.json({
      ok: true,
      key: { id: key.id, name: key.name, campaign_id: key.campaign_id },
      campaigns: listCampaigns(app)
        .filter((x) => !key.campaign_id || x.id === key.campaign_id)
        .map((x) => ({ id: x.id, name: x.name, slug: x.slug, status: x.status })),
    });
  });

  r.get('/campaigns', (c) => {
    const key = c.get('apiKey');
    return c.json({
      campaigns: listCampaigns(c.get('app'))
        .filter((x) => !key.campaign_id || x.id === key.campaign_id)
        .map((x) => ({ id: x.id, name: x.name, slug: x.slug, status: x.status, has_pdf: x.has_document })),
    });
  });

  r.post('/personalize', async (c) => {
    const app = c.get('app');
    const body = await jsonBody(c, Body);
    const campaign = resolveCampaign(app, c.get('apiKey'), body.campaign ?? body.campaign_id ?? body.campaign_slug);
    const options = (typeof body.options === 'object' && body.options ? body.options : {}) as { ai?: boolean };
    return c.json(await personalizeOne(app, campaign, body, options));
  });

  r.post('/personalize/batch', async (c) => {
    const app = c.get('app');
    const body = await jsonBody(
      c,
      z.object({
        campaign: z.string().optional(),
        rows: z.array(Body).min(1).max(500),
        options: z.object({ ai: z.boolean().optional() }).optional(),
      }),
    );
    const campaign = resolveCampaign(app, c.get('apiKey'), body.campaign);
    // AI copy takes about a second per row, so rows run a few at a time, and once the request has used
    // its time budget the remaining rows are still given links, just with the fallback text.
    const deadline = Date.now() + 60_000;
    type RowResult =
      | Omit<Awaited<ReturnType<typeof personalizeOne>>, 'prospect'>
      | { ok: false; error: { code: string; message: string; details?: unknown } };
    const results: RowResult[] = new Array(body.rows.length);
    const run = async (i: number) => {
      try {
        const late = Date.now() > deadline && body.options?.ai !== false && campaign.settings.ai_fields.length > 0;
        const {
          prospect: _p,
          warnings,
          ...rest
        } = await personalizeOne(app, campaign, body.rows[i]!, { ...(body.options ?? {}), ...(late ? { ai: false } : {}) });
        if (late)
          warnings.push({
            code: 'ai_skipped',
            message:
              'This request ran out of time for AI copy, so the fallback text is used. Send fewer rows per request, or run the rest again.',
          });
        results[i] = { ...rest, warnings };
      } catch (e) {
        if (!(e instanceof HttpError)) app.log.error('batch row failed', { err: e, row: i });
        const err = e instanceof HttpError ? e : new HttpError(500, 'internal_error', 'Could not process this row');
        results[i] = { ok: false as const, error: { code: err.code, message: err.message, details: err.details } };
      }
    };
    const width = campaign.settings.ai_fields.length > 0 && body.options?.ai !== false ? 6 : 1;
    for (let i = 0; i < body.rows.length; i += width) {
      await Promise.all(Array.from({ length: Math.min(width, body.rows.length - i) }, (_, k) => run(i + k)));
      // rows without AI finish synchronously; give page views and other requests a turn between them
      await new Promise<void>((r) => setImmediate(r));
    }
    const ok = results.filter((x) => x.ok).length;
    return c.json({ ok: ok === results.length, processed: results.length, succeeded: ok, failed: results.length - ok, results });
  });

  /** Look prospects up (e.g. "has this person opened their page?") — handy for Clay follow-up columns. */
  r.get('/prospects', (c) => {
    const app = c.get('app');
    const q = c.req.query();
    const campaign = resolveCampaign(app, c.get('apiKey'), q.campaign);
    const external = toStr(q.external_id);
    const email = toStr(q.email).toLowerCase();
    if (external || email) {
      const row = external
        ? app.db.get<{ id: string }>('SELECT id FROM prospects WHERE campaign_id = ? AND external_id = ?', campaign.id, external)
        : app.db.get<{ id: string }>('SELECT id FROM prospects WHERE campaign_id = ? AND lower(email) = ?', campaign.id, email);
      const found = row ? getProspect(app, row.id) : null;
      if (!found) throw notFound('Prospect');
      return c.json(publicProspect(app, campaign, found));
    }
    const { rows, total } = listProspects(app, campaign.id, {
      q: q.q,
      stage: (['new', 'opened', 'engaged', 'converted'] as const).find((s) => s === q.stage),
      limit: Math.min(Number(q.limit) || 50, 500),
      offset: Number(q.offset) || 0,
      sort: 'last_seen',
    });
    return c.json({ total, prospects: rows.map((p) => publicProspect(app, campaign, p)) });
  });

  r.get('/prospects/:id', (c) => {
    const app = c.get('app');
    const found = getProspect(app, c.req.param('id'));
    if (!found) throw notFound('Prospect');
    const campaign = resolveCampaign(app, c.get('apiKey'), found.campaign_id);
    return c.json(publicProspect(app, campaign, found));
  });

  return r;
}
