import { Hono } from 'hono';
import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors';
import { isBlockedAddress } from '../lib/safe-fetch';
import { jsonBody, requireUser, type C, type Env } from '../http';
import { createApiKey, listApiKeys, revokeApiKey } from '../auth/apikeys';
import { aiEnabled } from '../services/ai';
import { requireCampaign } from '../services/campaigns';
import { getAsset, listAssets, MAX_IMAGE_BYTES, storeImage } from '../services/assets';
import { getWorkspace, saveWorkspace } from '../services/settings';
import { listProspects } from '../services/prospects';
import {
  createWebhook,
  deleteWebhook,
  EVENT_NAMES,
  listWebhooks,
  recentDeliveries,
  sendTest,
  updateWebhook,
} from '../services/webhooks';
import net from 'node:net';

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, 'Enter a domain like go.yourbrand.com');

const WebhookBody = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['clay', 'slack', 'generic']),
  url: z.string().trim().url().max(2000),
  auth_header: z.string().trim().max(80).regex(/^[A-Za-z0-9-]*$/, 'Header names can only contain letters, numbers and dashes').nullish(),
  auth_value: z.string().max(500).nullish(),
  events: z.array(z.enum([...EVENT_NAMES, '*'])).max(10).optional(),
  campaign_id: z.string().max(40).nullish(),
  active: z.boolean().optional(),
});

/** Reject obviously unusable webhook targets up front; the real SSRF defence runs at send time. */
function checkWebhookUrl(c: C, url: string) {
  const app = c.get('app');
  const u = new URL(url);
  if (app.config.allowPrivateFetch) return;
  if (u.protocol !== 'https:') throw badRequest('Webhook URLs must use https.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || (net.isIP(host) && isBlockedAddress(host))) {
    throw badRequest('That address isn’t reachable from the internet.');
  }
}

export function settingsRoutes() {
  const r = new Hono<Env>();
  r.use('*', requireUser);

  r.get('/settings', (c) => {
    const app = c.get('app');
    return c.json({
      workspace: getWorkspace(app),
      ai: { available: aiEnabled(app), models: { smart: app.config.aiModelSmart, fast: app.config.aiModelFast } },
      urls: { app: app.config.appUrl, public: app.config.publicUrl },
      user: c.get('user'),
      limits: { max_upload_mb: Math.round(app.config.maxUploadBytes / 1024 / 1024) },
    });
  });

  r.put('/settings/workspace', async (c) => {
    const app = c.get('app');
    const body = await jsonBody(
      c,
      z.object({
        name: z.string().trim().min(1).max(80),
        domains: z.array(hostname).max(10),
        sender: z.object({ name: z.string().max(120), role: z.string().max(160), avatar: z.string().max(60) }),
        scripts: z.object({ head: z.string().max(10_000), body_end: z.string().max(10_000) }),
      }),
    );
    saveWorkspace(app, body);
    return c.json({ workspace: getWorkspace(app) });
  });

  // ── API keys ──────────────────────────────────────────────────────────────
  r.get('/api-keys', (c) => c.json({ keys: listApiKeys(c.get('app')) }));

  r.post('/api-keys', async (c) => {
    const app = c.get('app');
    const body = await jsonBody(c, z.object({ name: z.string().trim().min(1).max(80), campaign_id: z.string().max(40).nullish() }));
    if (body.campaign_id) requireCampaign(app, body.campaign_id);
    const { key, info } = createApiKey(app, { name: body.name, campaignId: body.campaign_id });
    // The plaintext key is returned exactly once.
    return c.json({ key, info }, 201);
  });

  r.delete('/api-keys/:id', (c) => {
    if (!revokeApiKey(c.get('app'), c.req.param('id'))) throw notFound('API key');
    return c.json({ ok: true });
  });

  // ── Webhooks ──────────────────────────────────────────────────────────────
  r.get('/webhooks', (c) => c.json({ webhooks: listWebhooks(c.get('app')), events: EVENT_NAMES }));

  r.post('/webhooks', async (c) => {
    const app = c.get('app');
    const body = await jsonBody(c, WebhookBody);
    checkWebhookUrl(c, body.url);
    if (body.campaign_id) requireCampaign(app, body.campaign_id);
    return c.json(createWebhook(app, body), 201);
  });

  r.put('/webhooks/:id', async (c) => {
    const app = c.get('app');
    const body = await jsonBody(c, WebhookBody.partial());
    if (body.url) checkWebhookUrl(c, body.url);
    return c.json({ webhook: updateWebhook(app, c.req.param('id'), body) });
  });

  r.delete('/webhooks/:id', (c) => {
    deleteWebhook(c.get('app'), c.req.param('id'));
    return c.json({ ok: true });
  });

  r.get('/webhooks/:id/deliveries', (c) => c.json({ deliveries: recentDeliveries(c.get('app'), c.req.param('id')) }));

  r.post('/webhooks/:id/test', async (c) => {
    const app = c.get('app');
    const body = await jsonBody(c, z.object({ campaign_id: z.string().max(40) }));
    const campaign = requireCampaign(app, body.campaign_id);
    const prospect = listProspects(app, campaign.id, { limit: 1 }).rows[0];
    if (!prospect) throw badRequest('Add a prospect to this campaign first, so the test event has real-looking data.');
    return c.json(await sendTest(app, c.req.param('id'), campaign, prospect));
  });

  // ── Image library ─────────────────────────────────────────────────────────
  r.get('/assets', (c) => {
    const app = c.get('app');
    const rows = listAssets(app, 'image', c.req.query('campaign') || undefined);
    return c.json({ assets: rows.map((a) => ({ id: a.id, filename: a.filename, url: `/a/${a.id}`, meta: JSON.parse(a.meta), created_at: a.created_at })) });
  });

  r.post('/assets', async (c) => {
    const app = c.get('app');
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw badRequest('Attach an image as "file".');
    if (file.size > MAX_IMAGE_BYTES) throw badRequest('Images can be up to 8 MB.');
    const campaignId = typeof form.campaign_id === 'string' && form.campaign_id ? form.campaign_id : null;
    if (campaignId) requireCampaign(app, campaignId);
    const asset = await storeImage(app, { data: Buffer.from(await file.arrayBuffer()), filename: file.name || 'image', campaignId });
    return c.json({ asset: { id: asset.id, filename: asset.filename, url: `/a/${asset.id}`, meta: JSON.parse(asset.meta) } }, 201);
  });

  r.delete('/assets/:id', async (c) => {
    const app = c.get('app');
    const a = getAsset(app, c.req.param('id'));
    if (!a || a.kind !== 'image') throw notFound('Asset');
    app.db.run('DELETE FROM assets WHERE id = ?', a.id);
    await app.storage.delete(a.storage_key);
    return c.json({ ok: true });
  });

  return r;
}
