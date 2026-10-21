import { Hono } from 'hono';
import { z } from 'zod';
import { evalRule } from '@shared/conditions';
import { renderUrl, safeUrl } from '@shared/template';
import type { Campaign } from '@shared/schema';
import type { AppContext } from '../context';
import { badRequest, HttpError, notFound } from '../lib/errors';
import { safeJoin, sendFile } from '../lib/static';
import { rateLimit, type C, type Env } from '../http';
import { interFontDir } from '../render/css';
import { getCampaign, getCampaignBySlug } from '../services/campaigns';
import { personalizedCover, personalizedPdf } from '../services/documents';
import { isBotUa, recordEvent } from '../services/events';
import { handleSubmission } from '../services/forms';
import { anonymousContext, contextFor, getProspectByToken, type Prospect } from '../services/prospects';
import { renderGenericPage, renderProspectPage } from '../services/render';
import { getWorkspace } from '../services/settings';

const hostOf = (c: C) => (c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost').split(',')[0].trim();

/** A deliberately bland 404: it must not reveal whether a token ever existed. */
function gone(c: C) {
  return c.html(
    `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not available</title><style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#334155;background:#f8fafc}main{text-align:center;padding:24px}h1{font-size:1.4rem;margin:0 0 .4rem;color:#0f172a}</style><main><h1>This page isn’t available</h1><p>The link may have expired or been mistyped.</p></main>`,
    404,
    { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  );
}

/** Resolve token → live prospect+campaign, counting failed lookups so tokens can't be brute-forced. */
function lookup(c: C, app: AppContext, token: string): { prospect: Prospect; campaign: Campaign } | null {
  const prospect = getProspectByToken(app, token);
  const campaign = prospect ? getCampaign(app, prospect.campaign_id) : null;
  if (!prospect || !campaign || campaign.status !== 'live') {
    const r = app.limiter.hit(`miss:${c.get('ip')}`, 40, 60_000);
    if (!r.ok) throw new HttpError(429, 'rate_limited', 'Too many requests');
    return null;
  }
  return { prospect, campaign };
}

const BeaconSchema = z.object({
  type: z.enum(['view', 'engaged', 'booked']),
  sid: z.string().min(4).max(24).regex(/^[a-z0-9]+$/),
  w: z.number().optional(),
  wd: z.number().optional(),
  ref: z.string().max(120).optional(),
  s: z.number().min(0).max(86_400).optional(),
  scroll: z.number().min(0).max(100).optional(),
  i: z.number().min(0).max(1).optional(),
  p: z.string().max(20).optional(),
});

async function readBeacon(c: C) {
  const text = await c.req.text();
  if (text.length > 2048) throw badRequest('Too large');
  try {
    return BeaconSchema.parse(JSON.parse(text));
  } catch {
    throw badRequest('Bad beacon');
  }
}

async function readForm(c: C): Promise<Record<string, unknown>> {
  const type = c.req.header('content-type') ?? '';
  if (type.includes('application/json')) {
    const text = await c.req.text();
    if (text.length > 20_000) throw badRequest('Too large');
    try {
      const v = JSON.parse(text);
      return v && typeof v === 'object' ? v : {};
    } catch {
      throw badRequest('Invalid JSON');
    }
  }
  return (await c.req.parseBody()) as Record<string, unknown>;
}

const wantsJson = (c: C) => (c.req.header('accept') ?? '').includes('application/json') || (c.req.header('content-type') ?? '').includes('application/json');

export function publicRoutes() {
  const r = new Hono<Env>();

  // ── Personalised page + PDF ───────────────────────────────────────────────
  r.get('/p/:file', async (c) => {
    const app = c.get('app');
    const file = c.req.param('file');
    const isPdf = file.endsWith('.pdf');
    const found = lookup(c, app, isPdf ? file.slice(0, -4) : file);
    if (!found) return gone(c);
    const { prospect, campaign } = found;
    const ua = c.req.header('user-agent') ?? '';

    if (isPdf) {
      if (!campaign.document) return gone(c);
      const { bytes, filename } = await personalizedPdf(app, campaign, contextFor(app, campaign, prospect), prospect.id);
      if (c.req.method !== 'HEAD') {
        recordEvent(app, { campaignId: campaign.id, prospectId: prospect.id, type: 'download', props: { disposition: c.req.query('dl') ? 'attachment' : 'inline' }, isBot: isBotUa(ua), ip: c.get('ip'), ua });
      }
      const safeName = filename.replace(/[^\w.\- ()]+/g, '_');
      return new Response(Buffer.from(bytes), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${c.req.query('dl') ? 'attachment' : 'inline'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'Cache-Control': 'private, no-store',
          'X-Robots-Tag': 'noindex, nofollow',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const out = renderProspectPage(app, campaign, prospect, hostOf(c));
    if (c.req.method !== 'HEAD') {
      recordEvent(app, { campaignId: campaign.id, prospectId: prospect.id, type: 'hit', props: { ref: c.req.header('referer') ? new URL(c.req.header('referer')!, 'http://x').hostname : undefined }, isBot: isBotUa(ua), ip: c.get('ip'), ua });
    }
    return new Response(out.html, { headers: out.headers });
  });

  r.get('/p/:token/cover.png', async (c) => {
    const app = c.get('app');
    const found = lookup(c, app, c.req.param('token'));
    if (!found || !found.campaign.document) return gone(c);
    const png = await personalizedCover(app, found.campaign, contextFor(app, found.campaign, found.prospect), found.prospect.id);
    return new Response(Buffer.from(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
  });

  // ── Tracking beacon (sendBeacon from the page) ────────────────────────────
  r.post('/t/:token', rateLimit('beacon', 240, 60_000, (c) => `${c.req.param('token')}:${c.get('ip')}`), async (c) => {
    const app = c.get('app');
    const prospect = getProspectByToken(app, c.req.param('token'));
    if (!prospect) return c.body(null, 204);
    const b = await readBeacon(c);
    const ua = c.req.header('user-agent') ?? '';
    recordEvent(app, {
      campaignId: prospect.campaign_id,
      prospectId: prospect.id,
      type: b.type,
      sessionId: b.sid,
      props: b.type === 'view' ? { w: b.w, ref: b.ref } : b.type === 'engaged' ? { s: b.s, scroll: b.scroll, i: b.i } : { provider: b.p },
      // headless browsers announce themselves via navigator.webdriver
      isBot: isBotUa(ua) || b.wd === 1,
      ip: c.get('ip'),
      ua,
    });
    return c.body(null, 204);
  });

  r.post('/tc/:campaignId', rateLimit('beacon-anon', 120, 60_000), async (c) => {
    const app = c.get('app');
    const campaign = getCampaign(app, c.req.param('campaignId'));
    if (!campaign || campaign.status !== 'live') return c.body(null, 204);
    const b = await readBeacon(c);
    const ua = c.req.header('user-agent') ?? '';
    recordEvent(app, { campaignId: campaign.id, prospectId: null, type: b.type, sessionId: b.sid, props: b.type === 'engaged' ? { s: b.s, scroll: b.scroll } : { ref: b.ref }, isBot: isBotUa(ua) || b.wd === 1, ip: c.get('ip'), ua });
    return c.body(null, 204);
  });

  // ── Tracked button redirect. The destination is looked up from the saved config — never from the URL. ──
  r.get('/r/:token/:link', (c) => {
    const app = c.get('app');
    const found = lookup(c, app, c.req.param('token'));
    if (!found) return gone(c);
    const { prospect, campaign } = found;
    const [blockId, slot] = c.req.param('link').split('.');
    let button: { label: string; action: { type: string; url?: string } } | undefined;
    if (blockId === 'header') button = campaign.page.header.button;
    else {
      const b = campaign.page.blocks.find((x) => x.id === blockId);
      if (b?.type === 'hero') button = slot === 'secondary' ? b.secondary : b.primary;
      else if (b?.type === 'cta') button = slot === 'secondary' ? b.secondary : b.button;
      if (b && !evalRule(b.rule, contextFor(app, campaign, prospect))) button = undefined;
    }
    if (!button || button.action.type !== 'link') return gone(c);
    const dest = safeUrl(renderUrl(button.action.url ?? '', contextFor(app, campaign, prospect)));
    if (!dest) return gone(c);
    const ua = c.req.header('user-agent') ?? '';
    recordEvent(app, { campaignId: campaign.id, prospectId: prospect.id, type: 'click', props: { block: blockId, slot, label: button.label, host: safeHost(dest) }, isBot: isBotUa(ua), ip: c.get('ip'), ua });
    return c.redirect(dest, 302);
  });

  // ── Forms ─────────────────────────────────────────────────────────────────
  r.post('/p/:token/submit', rateLimit('submit', 20, 10 * 60_000, (c) => `${c.req.param('token')}:${c.get('ip')}`), async (c) => {
    const app = c.get('app');
    const found = lookup(c, app, c.req.param('token'));
    if (!found) return gone(c);
    const { prospect, campaign } = found;
    const ua = c.req.header('user-agent') ?? '';
    const ctx = contextFor(app, campaign, prospect);
    const result = handleSubmission(app, campaign, prospect, ctx, await readForm(c), { ip: c.get('ip'), ua, isBot: isBotUa(ua) });
    if (wantsJson(c)) return c.json(result);
    return c.redirect(result.redirect ?? `/p/${prospect.token}?sent=1`, 303);
  });

  // ── Generic (non-personalised) campaign page ──────────────────────────────
  const genericCampaign = (c: C, slug: string) => {
    const campaign = getCampaignBySlug(c.get('app'), slug);
    return campaign && campaign.status === 'live' ? campaign : null;
  };

  r.get('/c/:file', async (c) => {
    const app = c.get('app');
    const file = c.req.param('file');
    const isPdf = file.endsWith('.pdf');
    const campaign = genericCampaign(c, isPdf ? file.slice(0, -4) : file);
    if (!campaign) return gone(c);
    const params = Object.fromEntries(Object.entries(c.req.query()).slice(0, 30)) as Record<string, string>;
    if (isPdf) {
      if (!campaign.document) return gone(c);
      const { bytes, filename } = await personalizedPdf(app, campaign, anonymousContext(campaign, params), null);
      return new Response(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${c.req.query('dl') ? 'attachment' : 'inline'}; filename="${filename.replace(/[^\w.\- ()]+/g, '_')}"`, 'Cache-Control': 'public, max-age=300' } });
    }
    const out = renderGenericPage(app, campaign, params, hostOf(c));
    return new Response(out.html, { headers: out.headers });
  });

  r.get('/c/:slug/cover.png', async (c) => {
    const campaign = genericCampaign(c, c.req.param('slug'));
    if (!campaign?.document) return gone(c);
    const params = Object.fromEntries(Object.entries(c.req.query()).slice(0, 30)) as Record<string, string>;
    const png = await personalizedCover(c.get('app'), campaign, anonymousContext(campaign, params), null);
    return new Response(Buffer.from(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' } });
  });

  r.post('/c/:slug/submit', rateLimit('submit-anon', 10, 10 * 60_000), async (c) => {
    const app = c.get('app');
    const campaign = genericCampaign(c, c.req.param('slug'));
    if (!campaign) return gone(c);
    const ua = c.req.header('user-agent') ?? '';
    const result = handleSubmission(app, campaign, null, anonymousContext(campaign, {}), await readForm(c), { ip: c.get('ip'), ua, isBot: isBotUa(ua) });
    if (wantsJson(c)) return c.json(result);
    return c.redirect(result.redirect ?? `/c/${campaign.slug}?sent=1`, 303);
  });

  // ── Images uploaded in the dashboard (logos, avatars, PDF figures) ─────────
  r.get('/a/:id', async (c) => {
    const app = c.get('app');
    const row = app.db.get<{ storage_key: string; mime: string; kind: string }>('SELECT storage_key, mime, kind FROM assets WHERE id = ?', c.req.param('id'));
    if (!row || row.kind !== 'image') throw notFound('Image');
    const data = await app.storage.get(row.storage_key);
    if (!data) throw notFound('Image');
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': row.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  });

  // ── Self-hosted fonts ─────────────────────────────────────────────────────
  r.get('/f/inter/files/:file', async (c) => {
    const dir = interFontDir();
    const file = c.req.param('file');
    if (!dir || !/^inter-[a-z-]+-wght-normal\.woff2$/.test(file)) throw notFound('Font');
    const full = safeJoin(dir, file);
    const res = full ? await sendFile(c, full, { immutable: true }) : null;
    if (!res) throw notFound('Font');
    return res;
  });

  /** For Caddy's on-demand TLS `ask` hook: only issue certificates for domains this workspace owns. */
  r.get('/internal/tls-check', rateLimit('tls', 60, 60_000), (c) => {
    const app = c.get('app');
    const domain = (c.req.query('domain') ?? '').toLowerCase();
    const known = new Set([...getWorkspace(app).domains, new URL(app.config.appUrl).hostname, new URL(app.config.publicUrl).hostname]);
    return known.has(domain) ? c.text('ok') : c.text('unknown domain', 404);
  });

  return r;
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}

