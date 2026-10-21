import { Hono } from 'hono';
import { z } from 'zod';
import { STANDARD_FIELDS } from '@shared/fields';
import { lintCampaign } from '@shared/lint';
import { CAMPAIGN_STATUSES, CampaignUpdateSchema, CampaignSettingsSchema, DocumentSchema, PageSchema } from '@shared/schema';
import { randomToken } from '../lib/crypto';
import { jsonBody, requireUser, type Env } from '../http';
import {
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  listCampaigns,
  requireCampaign,
  setCampaignStatus,
  starterPage,
  updateCampaign,
} from '../services/campaigns';
import { summariseTokens } from '../render/page';
import { customFieldNames } from '../services/prospects';
import { parsePreviewSource, previewSourceString, PreviewSourceSchema, renderPreview } from '../services/render';
import { pageUrl } from '../services/links';
import { aiEnabled } from '../services/ai';

export function campaignRoutes() {
  const r = new Hono<Env>();
  r.use('*', requireUser);

  r.get('/', (c) => c.json({ campaigns: listCampaigns(c.get('app')) }));

  r.post('/', async (c) => {
    const app = c.get('app');
    const body = await jsonBody(c, z.object({ name: z.string().trim().min(1).max(120) }));
    const campaign = createCampaign(app, { name: body.name, page: starterPage(), source: { type: 'scratch' } });
    return c.json({ campaign }, 201);
  });

  r.get('/:id', (c) => {
    const app = c.get('app');
    const campaign = requireCampaign(app, c.req.param('id'));
    const custom = customFieldNames(app, campaign.id);
    return c.json({
      campaign,
      custom_fields: custom,
      standard_fields: STANDARD_FIELDS,
      issues: lintCampaign(campaign, custom),
      ai_available: aiEnabled(app),
      public_url: pageUrl(app, campaign, '').replace(/\/p\/$/, ''),
    });
  });

  r.put('/:id', async (c) => {
    const app = c.get('app');
    const patch = await jsonBody(c, CampaignUpdateSchema);
    const campaign = updateCampaign(app, c.req.param('id'), patch);
    return c.json({ campaign, issues: lintCampaign(campaign, customFieldNames(app, campaign.id)) });
  });

  r.delete('/:id', async (c) => {
    await deleteCampaign(c.get('app'), c.req.param('id'));
    return c.json({ ok: true });
  });

  r.post('/:id/duplicate', async (c) => c.json({ campaign: await duplicateCampaign(c.get('app'), c.req.param('id')) }, 201));

  r.post('/:id/status', async (c) => {
    const { status } = await jsonBody(c, z.object({ status: z.enum(CAMPAIGN_STATUSES) }));
    return c.json({ campaign: setCampaignStatus(c.get('app'), c.req.param('id'), status) });
  });

  /**
   * Render an UNSAVED draft as a given person and stash the HTML so the builder can show it in a
   * real iframe (which gets the public-page CSP rather than inheriting the dashboard's).
   */
  r.post('/:id/preview', async (c) => {
    const app = c.get('app');
    const body = await jsonBody(
      c,
      z.object({
        page: PageSchema.optional(),
        document: DocumentSchema.nullable().optional(),
        settings: CampaignSettingsSchema.optional(),
        source: PreviewSourceSchema.default({ kind: 'sample', index: 0 }),
      }),
    );
    const saved = requireCampaign(app, c.req.param('id'));
    const draft = { ...saved, page: body.page ?? saved.page, document: body.document === undefined ? saved.document : body.document, settings: body.settings ?? saved.settings };
    const src = parsePreviewSource(previewSourceString(body.source));
    const out = renderPreview(app, draft, src, new URL(app.config.appUrl).host);
    const id = randomToken(12);
    app.previews.put(id, c.get('user').id, out.html, out.headers);
    return c.json({
      url: `/preview/${id}`,
      blocks: out.blocks,
      tokens: summariseTokens(out.tokens),
      context: out.context,
    });
  });

  return r;
}
