import { buildContext } from '@shared/derive';
import type { AiField, Campaign } from '@shared/schema';
import { normKey, toStr, type Ctx } from '@shared/template';
import type { AppContext } from '../context';
import { likeEscape, parseJson } from '../db/database';
import { HttpError, notFound, unprocessable } from '../lib/errors';
import { newId, newToken } from '../lib/ids';
import { coverUrl, pageUrl, pdfUrl } from './links';

export interface ProspectRow {
  id: string;
  campaign_id: string;
  token: string;
  external_id: string | null;
  email: string | null;
  linkedin_url: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  data: string;
  ai: string;
  created_at: number;
  updated_at: number;
  first_seen_at: number | null;
  last_seen_at: number | null;
  views: number;
  clicks: number;
  downloads: number;
  submissions: number;
  engaged_seconds: number;
  score: number;
}

export interface Prospect extends Omit<ProspectRow, 'data' | 'ai'> {
  data: Record<string, string | number | boolean | Array<string | number | boolean>>;
  ai: Record<string, string>;
}

export const toProspect = (r: ProspectRow): Prospect => ({ ...r, data: parseJson(r.data, {}), ai: parseJson(r.ai, {}) });

// ── Input normalisation ─────────────────────────────────────────────────────

const COLUMN_FIELDS = ['email', 'first_name', 'last_name', 'company', 'job_title', 'linkedin_url'] as const;
/** Keys that belong to the request envelope, not to the prospect's data. */
const RESERVED = new Set(['campaign', 'campaign_id', 'campaign_slug', 'external_id', 'id', 'token']);
const MAX_KEYS = 100;
const MAX_VALUE = 2000;

type Scalar = string | number | boolean;

export interface NormalizedInput {
  external_id: string | null;
  columns: Partial<Record<(typeof COLUMN_FIELDS)[number], string>>;
  data: Record<string, Scalar | Scalar[]>;
}

function scalar(v: unknown): Scalar | Scalar[] | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const s = v.replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE);
    return s === '' ? undefined : s;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const items = v
      .map(scalar)
      .filter((x): x is Scalar => x !== undefined && !Array.isArray(x))
      .slice(0, 50);
    return items.length ? items : undefined;
  }
  return undefined;
}

/** Flatten one level of nesting ({company:{industry:"x"}} → company_industry). Deeper values are dropped. */
function flatten(obj: Record<string, unknown>, prefix = '', depth = 0, out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = normKey(prefix ? `${prefix}_${k}` : k);
    if (!key) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (depth < 2) flatten(v as Record<string, unknown>, key, depth + 1, out);
    } else out[key] = v;
  }
  return out;
}

/**
 * Accepts Clay's flat body (any unknown top-level key becomes a custom field) as well as an
 * explicit `data` object. Keys are normalised to snake_case so "Company Industry" == company_industry.
 */
export function normalizeInput(raw: Record<string, unknown>): NormalizedInput {
  // `data` is an optional explicit bag of custom fields; `options` is the request envelope.
  const { data: dataObj, options: _options, ...rest } = raw;
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const flat = { ...flatten(isObj(dataObj) ? dataObj : {}), ...flatten(rest) };
  const columns: NormalizedInput['columns'] = {};
  const data: NormalizedInput['data'] = {};
  for (const [key, value] of Object.entries(flat)) {
    if (RESERVED.has(key)) continue;
    const v = scalar(value);
    if (v === undefined) continue;
    if ((COLUMN_FIELDS as readonly string[]).includes(key) && typeof v !== 'object') {
      columns[key as (typeof COLUMN_FIELDS)[number]] = String(v);
    } else if (Object.keys(data).length < MAX_KEYS) data[key] = v;
  }
  if (columns.email) columns.email = columns.email.toLowerCase();
  const ext = scalar(raw.external_id);
  return { external_id: ext === undefined || Array.isArray(ext) ? null : String(ext).slice(0, 200), columns, data };
}

const normLinkedin = (u: string) =>
  u
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');

// ── Context for rendering ───────────────────────────────────────────────────

export function aiFieldValue(f: AiField, p: Prospect | null): string {
  return (p?.ai[f.key] ?? '').trim() || f.fallback;
}

/** Everything a template can reference for this prospect: own fields, derived fields, links, AI copy. */
export function contextFor(ctx: AppContext, campaign: Campaign, p: Prospect): Ctx {
  const base: Record<string, unknown> = {
    ...p.data,
    first_name: p.first_name,
    last_name: p.last_name,
    company: p.company,
    job_title: p.job_title,
    email: p.email,
    linkedin_url: p.linkedin_url,
  };
  const c = buildContext(base, { cleanNames: campaign.settings.clean_names });
  for (const f of campaign.settings.ai_fields) {
    const key = `ai_${f.key}`;
    const v = aiFieldValue(f, p);
    if (v && c[key] === undefined) c[key] = v; // copy supplied by Clay wins over generated copy
  }
  c.page_url = pageUrl(ctx, campaign, p.token);
  if (campaign.document) {
    c.pdf_url = pdfUrl(ctx, campaign, p.token);
    c.cover_url = coverUrl(ctx, campaign, p.token);
  }
  c.today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  c.prospect_id = p.id;
  return c;
}

/** Context for the generic page: only what the URL parameters supplied (when allowed). */
export function anonymousContext(campaign: Campaign, params: Record<string, string>): Ctx {
  const base: Record<string, unknown> = {};
  if (campaign.settings.allow_url_params) {
    for (const [k, v] of Object.entries(params)) {
      const key = normKey(k);
      const s = toStr(v).slice(0, 200);
      if (key && s && !RESERVED.has(key)) base[key] = s;
    }
  }
  const c = buildContext(base, { cleanNames: campaign.settings.clean_names });
  for (const f of campaign.settings.ai_fields) if (f.fallback) c[`ai_${f.key}`] = f.fallback;
  c.today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return c;
}

// ── Upsert ──────────────────────────────────────────────────────────────────

export type UpsertStatus = 'created' | 'updated' | 'unchanged';

export interface UpsertResult {
  prospect: Prospect;
  status: UpsertStatus;
  /** Required fields that were absent (only populated when `enforceRequired` is off). */
  missing: string[];
}

function findExisting(ctx: AppContext, campaignId: string, n: NormalizedInput): ProspectRow | undefined {
  if (n.external_id) {
    const r = ctx.db.get<ProspectRow>('SELECT * FROM prospects WHERE campaign_id = ? AND external_id = ?', campaignId, n.external_id);
    if (r) return r;
  }
  if (n.columns.email) {
    const r = ctx.db.get<ProspectRow>('SELECT * FROM prospects WHERE campaign_id = ? AND lower(email) = ?', campaignId, n.columns.email);
    if (r) return r;
  }
  if (n.columns.linkedin_url) {
    const want = normLinkedin(n.columns.linkedin_url);
    const rows = ctx.db.all<ProspectRow>(
      "SELECT * FROM prospects WHERE campaign_id = ? AND linkedin_url IS NOT NULL AND lower(linkedin_url) LIKE ? ESCAPE '\\'",
      campaignId,
      `%${likeEscape(want)}%`,
    );
    const r = rows.find((x) => normLinkedin(x.linkedin_url ?? '') === want);
    if (r) return r;
  }
  return undefined;
}

export function upsertProspect(
  ctx: AppContext,
  campaign: Campaign,
  raw: Record<string, unknown>,
  opts: { enforceRequired?: boolean } = {},
): UpsertResult {
  const n = normalizeInput(raw);
  const hasIdentity =
    n.external_id || n.columns.email || n.columns.linkedin_url || n.columns.first_name || n.columns.last_name || n.data.full_name;
  if (!hasIdentity) {
    throw unprocessable(
      'Send at least one of: email, linkedin_url, external_id, first_name, last_name or full_name so we can recognise this prospect.',
    );
  }

  return ctx.db.transaction(() => {
    const existing = findExisting(ctx, campaign.id, n);
    const now = Date.now();

    // Merge: new non-empty values win, omitted fields are kept.
    const merged = {
      email: n.columns.email ?? existing?.email ?? null,
      first_name: n.columns.first_name ?? existing?.first_name ?? null,
      last_name: n.columns.last_name ?? existing?.last_name ?? null,
      company: n.columns.company ?? existing?.company ?? null,
      job_title: n.columns.job_title ?? existing?.job_title ?? null,
      linkedin_url: n.columns.linkedin_url ?? existing?.linkedin_url ?? null,
      external_id: n.external_id ?? existing?.external_id ?? null,
      data: { ...parseJson<Prospect['data']>(existing?.data, {}), ...n.data },
    };

    // Required-field check runs on the merged, derived context (so `full_name` satisfies first_name).
    const probe = buildContext({ ...merged.data, ...merged, data: undefined }, { cleanNames: campaign.settings.clean_names });
    const missing = campaign.settings.required_fields.map(normKey).filter((f) => !toStr(probe[f]));
    if (missing.length && opts.enforceRequired !== false) {
      throw new HttpError(422, 'missing_required_fields', `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`, {
        missing,
      });
    }

    if (existing) {
      const dataJson = JSON.stringify(merged.data);
      const unchanged =
        merged.email === existing.email &&
        merged.first_name === existing.first_name &&
        merged.last_name === existing.last_name &&
        merged.company === existing.company &&
        merged.job_title === existing.job_title &&
        merged.linkedin_url === existing.linkedin_url &&
        merged.external_id === existing.external_id &&
        dataJson === existing.data;
      if (!unchanged) {
        ctx.db.run(
          `UPDATE prospects SET email = ?, first_name = ?, last_name = ?, company = ?, job_title = ?, linkedin_url = ?, external_id = ?, data = ?, updated_at = ? WHERE id = ?`,
          merged.email,
          merged.first_name,
          merged.last_name,
          merged.company,
          merged.job_title,
          merged.linkedin_url,
          merged.external_id,
          dataJson,
          now,
          existing.id,
        );
      }
      return { prospect: getProspect(ctx, existing.id)!, status: (unchanged ? 'unchanged' : 'updated') as UpsertStatus, missing };
    }

    const id = newId('prs');
    for (let attempt = 0; ; attempt++) {
      try {
        ctx.db.run(
          `INSERT INTO prospects (id, campaign_id, token, external_id, email, linkedin_url, first_name, last_name, company, job_title, data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          campaign.id,
          newToken(),
          merged.external_id,
          merged.email,
          merged.linkedin_url,
          merged.first_name,
          merged.last_name,
          merged.company,
          merged.job_title,
          JSON.stringify(merged.data),
          now,
          now,
        );
        break;
      } catch (e) {
        // token collision (astronomically unlikely) → retry; anything else is a real error
        if (attempt < 4 && /UNIQUE.*token/i.test(String((e as Error).message))) continue;
        throw e;
      }
    }
    return { prospect: getProspect(ctx, id)!, status: 'created' as UpsertStatus, missing };
  });
}

// ── Reads ───────────────────────────────────────────────────────────────────

export function getProspect(ctx: AppContext, id: string): Prospect | null {
  const r = ctx.db.get<ProspectRow>('SELECT * FROM prospects WHERE id = ?', id);
  return r ? toProspect(r) : null;
}

export function requireProspect(ctx: AppContext, id: string): Prospect {
  const p = getProspect(ctx, id);
  if (!p) throw notFound('Prospect');
  return p;
}

export function getProspectByToken(ctx: AppContext, token: string): Prospect | null {
  if (!/^[A-Za-z0-9]{6,32}$/.test(token)) return null;
  const r = ctx.db.get<ProspectRow>('SELECT * FROM prospects WHERE token = ?', token);
  return r ? toProspect(r) : null;
}

export interface ListQuery {
  q?: string;
  sort?: 'created' | 'last_seen' | 'score' | 'views' | 'company';
  order?: 'asc' | 'desc';
  stage?: 'all' | 'new' | 'opened' | 'engaged' | 'converted';
  limit?: number;
  offset?: number;
}

export const stageOf = (
  p: Pick<Prospect, 'views' | 'score' | 'submissions' | 'clicks' | 'downloads'>,
): 'new' | 'opened' | 'engaged' | 'converted' =>
  p.submissions > 0 ? 'converted' : p.clicks > 0 || p.downloads > 0 || p.score >= 25 ? 'engaged' : p.views > 0 ? 'opened' : 'new';

export function listProspects(ctx: AppContext, campaignId: string, q: ListQuery = {}): { rows: Prospect[]; total: number } {
  const where: string[] = ['campaign_id = ?'];
  const params: Array<string | number> = [campaignId];
  if (q.q?.trim()) {
    const like = `%${likeEscape(q.q.trim().toLowerCase())}%`;
    where.push(
      `(lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) LIKE ? ESCAPE '\\' OR lower(coalesce(email,'')) LIKE ? ESCAPE '\\' OR lower(coalesce(company,'')) LIKE ? ESCAPE '\\' OR lower(coalesce(job_title,'')) LIKE ? ESCAPE '\\')`,
    );
    params.push(like, like, like, like);
  }
  switch (q.stage) {
    case 'new':
      where.push('views = 0');
      break;
    case 'opened':
      where.push('views > 0 AND submissions = 0 AND clicks = 0 AND downloads = 0 AND score < 25');
      break;
    case 'engaged':
      where.push('submissions = 0 AND (clicks > 0 OR downloads > 0 OR score >= 25)');
      break;
    case 'converted':
      where.push('submissions > 0');
      break;
  }
  const sortCol = {
    created: 'created_at',
    last_seen: 'COALESCE(last_seen_at, 0)',
    score: 'score',
    views: 'views',
    company: "lower(coalesce(company, ''))",
  }[q.sort ?? 'created'];
  const dir = q.order === 'asc' ? 'ASC' : 'DESC';
  const total = ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM prospects WHERE ${where.join(' AND ')}`, ...params)!.n;
  const rows = ctx.db.all<ProspectRow>(
    `SELECT * FROM prospects WHERE ${where.join(' AND ')} ORDER BY ${sortCol} ${dir}, id LIMIT ? OFFSET ?`,
    ...params,
    Math.min(Math.max(q.limit ?? 50, 1), 500),
    Math.max(q.offset ?? 0, 0),
  );
  return { rows: rows.map(toProspect), total };
}

/** All custom field names seen in a campaign's prospects — feeds the token picker. */
export function customFieldNames(ctx: AppContext, campaignId: string): string[] {
  const rows = ctx.db.all<{ data: string }>(
    'SELECT data FROM prospects WHERE campaign_id = ? ORDER BY updated_at DESC LIMIT 200',
    campaignId,
  );
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(parseJson<Record<string, unknown>>(r.data, {}))) seen.add(k);
  return [...seen].sort();
}

export function deleteProspect(ctx: AppContext, id: string): void {
  const p = requireProspect(ctx, id);
  ctx.db.transaction(() => {
    ctx.db.run('DELETE FROM events WHERE prospect_id = ?', id);
    ctx.db.run('DELETE FROM submissions WHERE prospect_id = ?', id);
    ctx.db.run('DELETE FROM webhook_deliveries WHERE prospect_id = ?', id); // copies of their data sent to Clay, Slack, …
    ctx.db.run('DELETE FROM prospects WHERE id = ?', id);
  });
  void ctx.storage.deletePrefix(`campaigns/${p.campaign_id}/generated/${id}`).catch(() => undefined);
}

export function setAiValues(ctx: AppContext, id: string, values: Record<string, string>): void {
  ctx.db.run('UPDATE prospects SET ai = ?, updated_at = ? WHERE id = ?', JSON.stringify(values), Date.now(), id);
}

/** What the API tells callers about a prospect. */
export function publicProspect(ctx: AppContext, campaign: Campaign, p: Prospect) {
  const c = contextFor(ctx, campaign, p);
  return {
    id: p.id,
    campaign_id: campaign.id,
    external_id: p.external_id,
    first_name: toStr(c.first_name) || null,
    last_name: toStr(c.last_name) || null,
    email: p.email,
    company: p.company,
    job_title: p.job_title,
    seniority: toStr(c.seniority) || null,
    department: toStr(c.department) || null,
    url: pageUrl(ctx, campaign, p.token),
    pdf_url: campaign.document ? pdfUrl(ctx, campaign, p.token) : null,
    cover_url: campaign.document ? coverUrl(ctx, campaign, p.token) : null,
    engagement: {
      stage: stageOf(p),
      views: p.views,
      clicks: p.clicks,
      downloads: p.downloads,
      submissions: p.submissions,
      engaged_seconds: p.engaged_seconds,
      score: p.score,
      first_seen_at: p.first_seen_at ? new Date(p.first_seen_at).toISOString() : null,
      last_seen_at: p.last_seen_at ? new Date(p.last_seen_at).toISOString() : null,
    },
    created_at: new Date(p.created_at).toISOString(),
  };
}
