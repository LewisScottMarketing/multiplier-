import { createHash } from 'node:crypto';
import type { AppContext } from '../context';
import { parseJson } from '../db/database';
import { emitEvent } from './webhooks';
import { getCampaign } from './campaigns';
import { getProspect } from './prospects';

export type EventType = 'hit' | 'view' | 'engaged' | 'click' | 'download' | 'submit' | 'booked';

/** Link scanners, unfurlers and headless browsers. They must never count as a prospect "opening" a page. */
const BOT_RE =
  /bot|crawl|spider|slurp|preview|fetch|monitor|scan|check|headless|phantom|puppeteer|playwright|lighthouse|python-requests|python-urllib|curl|wget|httpclient|go-http|java\/|okhttp|axios|node-fetch|undici|libwww|proofpoint|mimecast|barracuda|forcepoint|symantec|trend ?micro|sophos|fireeye|safelinks|office365|outlook-web|microsoft office|skypeuripreview|slack|linkedinbot|facebookexternalhit|whatsapp|telegram|discord|twitterbot|embedly|quora|pinterest|google-?read-?aloud|google-?inspectiontool|bingpreview|yandex|baidu|duckduck|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|perplexity/i;

export const isBotUa = (ua: string | undefined | null): boolean => !ua || ua.length < 10 || BOT_RE.test(ua);

export function hashIp(ctx: AppContext, ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash('sha256').update(`${day}:${ip}:`).update(ctx.config.secret).digest('hex').slice(0, 16);
}

export interface EventInput {
  campaignId: string;
  prospectId: string | null;
  type: EventType;
  props?: Record<string, unknown>;
  isBot?: boolean;
  sessionId?: string | null;
  ip?: string;
  ua?: string;
  /** Override the timestamp (seeding and imports only). */
  at?: number;
}

const score = (p: { views: number; clicks: number; downloads: number; submissions: number; engaged_seconds: number }) =>
  Math.min(
    100,
    (p.views > 0 ? 10 : 0) +
      Math.min(Math.max(p.views - 1, 0), 4) * 3 +
      p.clicks * 15 +
      p.downloads * 20 +
      p.submissions * 40 +
      Math.min(Math.floor(p.engaged_seconds / 20), 6) * 5,
  );

/** Stores the event and keeps the prospect's counters in step. Returns true if it was newly recorded. */
export function recordEvent(ctx: AppContext, e: EventInput): boolean {
  const now = e.at ?? Date.now();
  const bot = e.isBot ? 1 : 0;
  const ua = e.ua?.slice(0, 250) ?? null;
  const ipHash = e.ip ? hashIp(ctx, e.ip) : null;

  // `engaged` is a running total per browser session: update the row instead of appending.
  if (e.type === 'engaged' && e.sessionId && e.prospectId) {
    const prev = ctx.db.get<{ id: number; props: string }>(
      `SELECT id, props FROM events WHERE prospect_id = ? AND type = 'engaged' AND session_id = ?`,
      e.prospectId,
      e.sessionId,
    );
    if (prev) {
      const old = parseJson<{ s?: number; scroll?: number; i?: number }>(prev.props, {});
      const next = {
        s: Math.max(old.s ?? 0, Number(e.props?.s ?? 0)),
        scroll: Math.max(old.scroll ?? 0, Number(e.props?.scroll ?? 0)),
        i: Math.max(old.i ?? 0, Number(e.props?.i ?? 0)),
      };
      ctx.db.run('UPDATE events SET props = ?, created_at = ? WHERE id = ?', JSON.stringify(next), now, prev.id);
      refreshEngagement(ctx, e.prospectId, now, bot === 0);
      return false;
    }
  }

  // one `view` per browser session (the beacon can be retried)
  if (e.type === 'view' && e.sessionId && e.prospectId) {
    if (ctx.db.get(`SELECT 1 FROM events WHERE prospect_id = ? AND type = 'view' AND session_id = ?`, e.prospectId, e.sessionId))
      return false;
  }

  ctx.db.run(
    `INSERT INTO events (campaign_id, prospect_id, type, props, is_bot, session_id, ip_hash, ua, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.campaignId,
    e.prospectId,
    e.type,
    JSON.stringify(e.props ?? {}),
    bot,
    e.sessionId ?? null,
    ipHash,
    ua,
    now,
  );

  if (!e.prospectId || bot) return true;

  const before = ctx.db.get<{ views: number }>('SELECT views FROM prospects WHERE id = ?', e.prospectId);
  switch (e.type) {
    case 'view':
      ctx.db.run(
        'UPDATE prospects SET views = views + 1, first_seen_at = COALESCE(first_seen_at, ?), last_seen_at = ? WHERE id = ?',
        now,
        now,
        e.prospectId,
      );
      break;
    case 'click':
      ctx.db.run('UPDATE prospects SET clicks = clicks + 1, last_seen_at = ? WHERE id = ?', now, e.prospectId);
      break;
    case 'download':
      ctx.db.run('UPDATE prospects SET downloads = downloads + 1, last_seen_at = ? WHERE id = ?', now, e.prospectId);
      break;
    case 'submit':
    case 'booked':
      ctx.db.run('UPDATE prospects SET submissions = submissions + 1, last_seen_at = ? WHERE id = ?', now, e.prospectId);
      break;
    case 'engaged':
      refreshEngagement(ctx, e.prospectId, now, true);
      return true;
    default:
      return true;
  }
  const p = ctx.db.get<{ views: number; clicks: number; downloads: number; submissions: number; engaged_seconds: number }>(
    'SELECT views, clicks, downloads, submissions, engaged_seconds FROM prospects WHERE id = ?',
    e.prospectId,
  )!;
  ctx.db.run('UPDATE prospects SET score = ? WHERE id = ?', score(p), e.prospectId);

  // tell the outside world (Clay, Slack, …)
  const name = (
    {
      view: before && before.views === 0 ? 'page.first_viewed' : 'page.viewed',
      click: 'link.clicked',
      download: 'pdf.downloaded',
      submit: 'form.submitted',
      booked: 'meeting.booked',
    } as Record<string, string>
  )[e.type];
  if (name) {
    const campaign = getCampaign(ctx, e.campaignId);
    const prospect = getProspect(ctx, e.prospectId);
    if (campaign && prospect) emitEvent(ctx, name, campaign, prospect, e.props ?? {});
  }
  return true;
}

function refreshEngagement(ctx: AppContext, prospectId: string, now: number, human: boolean) {
  if (!human) return;
  const row = ctx.db.get<{ total: number | null }>(
    `SELECT SUM(CAST(json_extract(props, '$.s') AS INTEGER)) AS total FROM events WHERE prospect_id = ? AND type = 'engaged' AND is_bot = 0`,
    prospectId,
  );
  ctx.db.run('UPDATE prospects SET engaged_seconds = ?, last_seen_at = ? WHERE id = ?', row?.total ?? 0, now, prospectId);
  const p = ctx.db.get<{ views: number; clicks: number; downloads: number; submissions: number; engaged_seconds: number }>(
    'SELECT views, clicks, downloads, submissions, engaged_seconds FROM prospects WHERE id = ?',
    prospectId,
  )!;
  ctx.db.run('UPDATE prospects SET score = ? WHERE id = ?', score(p), prospectId);
}

export interface TimelineEvent {
  id: number;
  type: EventType;
  props: Record<string, unknown>;
  is_bot: boolean;
  created_at: number;
}

export function prospectTimeline(ctx: AppContext, prospectId: string, limit = 100): TimelineEvent[] {
  return ctx.db
    .all<{ id: number; type: EventType; props: string; is_bot: number; created_at: number }>(
      'SELECT id, type, props, is_bot, created_at FROM events WHERE prospect_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      prospectId,
      limit,
    )
    .map((r) => ({ id: r.id, type: r.type, props: parseJson(r.props, {}), is_bot: !!r.is_bot, created_at: r.created_at }));
}
