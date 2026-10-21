import {
  CampaignSettingsSchema,
  DocumentSchema,
  PageSchema,
  type Campaign,
  type CampaignSettings,
  type CampaignSource,
  type CampaignStatus,
  type CampaignUpdate,
  type DocumentConfig,
  type Page,
} from '@shared/schema';
import { newBlock } from '@shared/blocks';
import type { AppContext } from '../context';
import { parseJson } from '../db/database';
import { conflict, notFound } from '../lib/errors';
import { newId } from '../lib/ids';

interface CampaignRow {
  id: string;
  name: string;
  slug: string;
  status: CampaignStatus;
  page: string;
  document: string | null;
  settings: string;
  source: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  published_at: number | null;
}

export function rowToCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    page: PageSchema.parse(parseJson(row.page, {})),
    document: row.document ? DocumentSchema.parse(parseJson(row.document, null)) : null,
    settings: CampaignSettingsSchema.parse(parseJson(row.settings, {})),
    source: parseJson<CampaignSource | null>(row.source, null),
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    published_at: row.published_at,
  };
}

/** A starter page that demonstrates personalisation straight away. */
export function starterPage(): Page {
  return PageSchema.parse({
    header: { enabled: true, logo_text: 'Your Company', button: { label: 'Book a call', action: { type: 'form' } } },
    footer: { text: '© Your Company. This page was prepared for {{first_name|you}}.' },
    blocks: [
      newBlock('hero'),
      newBlock('features'),
      newBlock('stats', { bg: 'alt' }),
      newBlock('testimonial'),
      newBlock('cta', { bg: 'default' }),
      newBlock('form', { bg: 'alt' }),
    ],
  });
}

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'campaign';

function uniqueSlug(ctx: AppContext, base: string, exceptId?: string): string {
  let slug = slugify(base);
  for (let i = 2; ctx.db.get('SELECT 1 FROM campaigns WHERE slug = ? AND id <> ?', slug, exceptId ?? ''); i++) {
    slug = `${slugify(base)}-${i}`;
  }
  return slug;
}

export interface CreateCampaignInput {
  name: string;
  page?: Page;
  document?: DocumentConfig | null;
  settings?: Partial<CampaignSettings>;
  source?: CampaignSource | null;
}

export function createCampaign(ctx: AppContext, input: CreateCampaignInput): Campaign {
  const id = newId('cmp');
  const now = Date.now();
  const settings = CampaignSettingsSchema.parse(input.settings ?? {});
  ctx.db.run(
    `INSERT INTO campaigns (id, name, slug, status, page, document, settings, source, version, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, 1, ?, ?)`,
    id,
    input.name.trim(),
    uniqueSlug(ctx, input.name),
    JSON.stringify(input.page ?? starterPage()),
    input.document ? JSON.stringify(input.document) : null,
    JSON.stringify(settings),
    input.source ? JSON.stringify(input.source) : null,
    now,
    now,
  );
  return getCampaign(ctx, id)!;
}

export function getCampaign(ctx: AppContext, id: string): Campaign | null {
  const row = ctx.db.get<CampaignRow>('SELECT * FROM campaigns WHERE id = ?', id);
  return row ? rowToCampaign(row) : null;
}

export function requireCampaign(ctx: AppContext, id: string): Campaign {
  const c = getCampaign(ctx, id);
  if (!c) throw notFound('Campaign');
  return c;
}

export function getCampaignBySlug(ctx: AppContext, slug: string): Campaign | null {
  const row = ctx.db.get<CampaignRow>('SELECT * FROM campaigns WHERE slug = ?', slug);
  return row ? rowToCampaign(row) : null;
}

/** Accepts either the campaign id (cmp_…) or its slug — Clay users tend to paste whichever they see. */
export function findCampaign(ctx: AppContext, idOrSlug: string): Campaign | null {
  return idOrSlug.startsWith('cmp_') ? getCampaign(ctx, idOrSlug) : getCampaignBySlug(ctx, idOrSlug);
}

export interface CampaignSummary {
  id: string;
  name: string;
  slug: string;
  status: CampaignStatus;
  updated_at: number;
  created_at: number;
  has_document: boolean;
  source_type: string | null;
  headline: string;
  brand: string;
  prospects: number;
  viewed: number;
  submissions: number;
}

export function listCampaigns(ctx: AppContext): CampaignSummary[] {
  const rows = ctx.db.all<CampaignRow & { prospects: number; viewed: number; submissions: number }>(
    `SELECT c.*,
       (SELECT COUNT(*) FROM prospects p WHERE p.campaign_id = c.id) AS prospects,
       (SELECT COUNT(*) FROM prospects p WHERE p.campaign_id = c.id AND p.views > 0) AS viewed,
       (SELECT COALESCE(SUM(p.submissions), 0) FROM prospects p WHERE p.campaign_id = c.id) AS submissions
     FROM campaigns c WHERE c.status <> 'archived' ORDER BY c.updated_at DESC`,
  );
  return rows.map((r) => {
    const c = rowToCampaign(r);
    const hero = c.page.blocks.find((b) => b.type === 'hero');
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      status: c.status,
      updated_at: c.updated_at,
      created_at: c.created_at,
      has_document: !!c.document,
      source_type: c.source?.type ?? null,
      headline: hero?.type === 'hero' ? hero.headline : '',
      brand: c.page.theme.brand,
      prospects: r.prospects,
      viewed: r.viewed,
      submissions: r.submissions,
    };
  });
}

export function updateCampaign(ctx: AppContext, id: string, patch: CampaignUpdate): Campaign {
  const current = requireCampaign(ctx, id);
  if (patch.base_version !== undefined && patch.base_version !== current.version) {
    throw conflict('This campaign was changed somewhere else. Reload to see the latest version.', { current_version: current.version });
  }
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  const set = (col: string, val: string | number | null) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };
  if (patch.name !== undefined) set('name', patch.name.trim());
  if (patch.slug !== undefined && patch.slug !== current.slug) {
    if (ctx.db.get('SELECT 1 FROM campaigns WHERE slug = ? AND id <> ?', patch.slug, id)) throw conflict('That URL name is already taken');
    set('slug', patch.slug);
  }
  if (patch.page !== undefined) set('page', JSON.stringify(patch.page));
  if (patch.document !== undefined) set('document', patch.document ? JSON.stringify(patch.document) : null);
  if (patch.settings !== undefined) set('settings', JSON.stringify(patch.settings));
  if (sets.length === 0) return current;
  set('version', current.version + 1);
  set('updated_at', Date.now());
  ctx.db.run(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  return requireCampaign(ctx, id);
}

export function setCampaignStatus(ctx: AppContext, id: string, status: CampaignStatus): Campaign {
  requireCampaign(ctx, id);
  const now = Date.now();
  ctx.db.run(
    `UPDATE campaigns SET status = ?, updated_at = ?, published_at = CASE WHEN ? = 'live' THEN COALESCE(published_at, ?) ELSE published_at END WHERE id = ?`,
    status,
    now,
    status,
    now,
    id,
  );
  return requireCampaign(ctx, id);
}

export function duplicateCampaign(ctx: AppContext, id: string): Campaign {
  const src = requireCampaign(ctx, id);
  // fresh block ids are not needed: ids only have to be unique within one page
  return createCampaign(ctx, {
    name: `${src.name} (copy)`,
    page: src.page,
    document: src.document,
    settings: src.settings,
    source: src.source,
  });
}

export async function deleteCampaign(ctx: AppContext, id: string): Promise<void> {
  requireCampaign(ctx, id);
  const assets = ctx.db.all<{ id: string; storage_key: string }>('SELECT id, storage_key FROM assets WHERE campaign_id = ?', id);
  ctx.db.transaction(() => {
    ctx.db.run('DELETE FROM events WHERE campaign_id = ?', id);
    ctx.db.run('DELETE FROM submissions WHERE campaign_id = ?', id);
    ctx.db.run('DELETE FROM webhooks WHERE campaign_id = ?', id);
    ctx.db.run('DELETE FROM assets WHERE campaign_id = ?', id);
    ctx.db.run('UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE campaign_id = ?', Date.now(), id);
    ctx.db.run('DELETE FROM campaigns WHERE id = ?', id); // prospects cascade
  });
  await Promise.allSettled(assets.map((a) => ctx.storage.delete(a.storage_key)));
  await ctx.storage.deletePrefix(`campaigns/${id}`);
}
