import { z } from 'zod';
import { buildContext } from '@shared/derive';
import { SAMPLE_PROSPECTS } from '@shared/fields';
import type { Campaign } from '@shared/schema';
import type { Ctx } from '@shared/template';
import type { AppContext } from '../context';
import { notFound } from '../lib/errors';
import { renderPage, type PageOutput } from '../render/page';
import { anonymousContext, contextFor, getProspect, type Prospect } from './prospects';
import { getWorkspace } from './settings';

const originOf = (ctx: AppContext) => ctx.config.publicUrl;

/** The live, personalised page for one stored prospect. */
export function renderProspectPage(ctx: AppContext, campaign: Campaign, prospect: Prospect, host: string): PageOutput {
  return renderPage({
    campaign,
    ctx: contextFor(ctx, campaign, prospect),
    mode: 'live',
    token: prospect.token,
    host,
    origin: `https://${host}`,
    urls: {
      pdf: `/p/${prospect.token}.pdf`,
      cover: `/p/${prospect.token}/cover.png`,
      submit: `/p/${prospect.token}/submit`,
      beacon: `/t/${prospect.token}`,
    },
    scripts: getWorkspace(ctx).scripts,
  });
}

/** The generic page at /c/<slug>: fallbacks everywhere, or URL-parameter personalisation if enabled. */
export function renderGenericPage(ctx: AppContext, campaign: Campaign, params: Record<string, string>, host: string): PageOutput {
  return renderPage({
    campaign,
    ctx: anonymousContext(campaign, params),
    mode: 'live',
    token: null,
    host,
    origin: `https://${host}`,
    urls: {
      pdf: `/c/${campaign.slug}.pdf${qs(params)}`,
      cover: `/c/${campaign.slug}/cover.png${qs(params)}`,
      submit: `/c/${campaign.slug}/submit`,
      beacon: `/tc/${campaign.id}`,
    },
    scripts: getWorkspace(ctx).scripts,
  });
}

const qs = (params: Record<string, string>) => {
  const s = new URLSearchParams(params).toString();
  return s ? `?${s}` : '';
};

// ── Preview ("see this page as …") ──────────────────────────────────────────

/** The dashboard's "preview as…" choice, as sent in request bodies. */
export const PreviewSourceSchema = z.union([
  z.object({ kind: z.literal('sample'), index: z.number().int().min(0).max(10) }),
  z.object({ kind: z.literal('prospect'), id: z.string().max(40) }),
  z.object({ kind: z.literal('empty') }),
]);

export type PreviewSource =
  | { kind: 'sample'; index: number }
  | { kind: 'prospect'; id: string }
  | { kind: 'empty' };

/** `sample:1`, `prospect:prs_x`, `empty` — the compact form used in query strings. */
export function parsePreviewSource(raw: string | undefined | null): PreviewSource {
  if (!raw || raw === 'empty') return { kind: 'empty' };
  const [kind, value] = raw.split(':');
  if (kind === 'prospect' && value) return { kind: 'prospect', id: value };
  if (kind === 'sample') return { kind: 'sample', index: Math.max(0, Math.min(SAMPLE_PROSPECTS.length - 1, Number(value) || 0)) };
  return { kind: 'empty' };
}

export interface PreviewContext {
  ctx: Ctx;
  prospect: Prospect | null;
}

export function previewContext(app: AppContext, campaign: Campaign, src: PreviewSource): PreviewContext {
  let ctx: Ctx;
  let prospect: Prospect | null = null;
  if (src.kind === 'prospect') {
    prospect = getProspect(app, src.id);
    if (!prospect || prospect.campaign_id !== campaign.id) throw notFound('Prospect');
    ctx = contextFor(app, campaign, prospect);
  } else if (src.kind === 'sample') {
    const s = SAMPLE_PROSPECTS[src.index] ?? SAMPLE_PROSPECTS[0];
    ctx = buildContext(s, { cleanNames: campaign.settings.clean_names });
    ctx.page_url = `${originOf(app)}/p/SAMPLEtoken`;
    ctx.pdf_url = `${originOf(app)}/p/SAMPLEtoken.pdf`;
    ctx.today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    for (const f of campaign.settings.ai_fields) if (f.fallback) ctx[`ai_${f.key}`] = f.fallback;
  } else {
    ctx = anonymousContext(campaign, {});
  }
  return { ctx, prospect };
}

export const previewSourceString = (src: PreviewSource): string => (src.kind === 'empty' ? 'empty' : src.kind === 'sample' ? `sample:${src.index}` : `prospect:${src.id}`);

export function renderPreview(app: AppContext, campaign: Campaign, src: PreviewSource, host: string): PageOutput & { context: Ctx } {
  const { ctx } = previewContext(app, campaign, src);
  const q = encodeURIComponent(previewSourceString(src));
  const out = renderPage({
    campaign,
    ctx,
    mode: 'preview',
    token: null,
    host,
    origin: `https://${host}`,
    urls: {
      pdf: `/api/campaigns/${campaign.id}/document/preview.pdf?as=${q}`,
      cover: `/api/campaigns/${campaign.id}/document/preview/1.png?as=${q}`,
      submit: '#',
    },
    scripts: { head: '', body_end: '' },
  });
  return { ...out, context: ctx };
}
