import { buildContext, DEPARTMENT_LABELS, SENIORITY_LABELS, type Department, type Seniority } from '@shared/derive';
import type { AppContext } from '../context';
import { parseJson } from '../db/database';

/**
 * Aggregations behind the dashboard. Everything counts HUMAN activity only (is_bot = 0): link
 * scanners and unfurlers would otherwise make every campaign look wildly successful.
 */

const DAY = 86_400_000;

export interface DayPoint {
  date: string;
  views: number;
  clicks: number;
  downloads: number;
  submissions: number;
}

function series(app: AppContext, where: string, params: Array<string | number>, days: number): DayPoint[] {
  const since = Date.now() - (days - 1) * DAY;
  const start = new Date(since);
  start.setUTCHours(0, 0, 0, 0);
  const rows = app.db.all<{ d: string; type: string; n: number }>(
    `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS d, type, COUNT(*) AS n
       FROM events WHERE ${where} AND is_bot = 0 AND created_at >= ? AND type IN ('view', 'click', 'download', 'submit', 'booked')
      GROUP BY d, type`,
    ...params,
    start.getTime(),
  );
  const byDay = new Map<string, DayPoint>();
  for (let i = 0; i < days; i++) {
    const date = new Date(start.getTime() + i * DAY).toISOString().slice(0, 10);
    byDay.set(date, { date, views: 0, clicks: 0, downloads: 0, submissions: 0 });
  }
  for (const r of rows) {
    const p = byDay.get(r.d);
    if (!p) continue;
    if (r.type === 'view') p.views += r.n;
    else if (r.type === 'click') p.clicks += r.n;
    else if (r.type === 'download') p.downloads += r.n;
    else p.submissions += r.n; // submit + booked
  }
  return [...byDay.values()];
}

export interface Totals {
  prospects: number;
  opened: number;
  engaged: number;
  converted: number;
  clicks: number;
  downloads: number;
  submissions: number;
  avg_engaged_seconds: number;
}

function totalsFor(app: AppContext, where: string, params: Array<string | number>): Totals {
  const r = app.db.get<Totals>(
    `SELECT COUNT(*) AS prospects,
            COALESCE(SUM(views > 0), 0) AS opened,
            COALESCE(SUM(submissions = 0 AND (clicks > 0 OR downloads > 0 OR score >= 25)), 0) + COALESCE(SUM(submissions > 0), 0) AS engaged,
            COALESCE(SUM(submissions > 0), 0) AS converted,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(downloads), 0) AS downloads,
            COALESCE(SUM(submissions), 0) AS submissions,
            COALESCE(AVG(CASE WHEN views > 0 THEN engaged_seconds END), 0) AS avg_engaged_seconds
       FROM prospects WHERE ${where}`,
    ...params,
  )!;
  return { ...r, avg_engaged_seconds: Math.round(r.avg_engaged_seconds) };
}

export interface SegmentRow {
  key: string;
  label: string;
  prospects: number;
  opened: number;
  converted: number;
}

/** Who responds? Group prospects by department and seniority, derived from their job titles. */
function segments(app: AppContext, campaignId: string): { departments: SegmentRow[]; seniority: SegmentRow[] } {
  const rows = app.db.all<{ job_title: string | null; views: number; submissions: number; data: string }>(
    'SELECT job_title, views, submissions, data FROM prospects WHERE campaign_id = ? LIMIT 20000',
    campaignId,
  );
  const dept = new Map<string, SegmentRow>();
  const sen = new Map<string, SegmentRow>();
  const bump = (m: Map<string, SegmentRow>, key: string, label: string, p: { views: number; submissions: number }) => {
    const e = m.get(key) ?? { key, label, prospects: 0, opened: 0, converted: 0 };
    e.prospects++;
    if (p.views > 0) e.opened++;
    if (p.submissions > 0) e.converted++;
    m.set(key, e);
  };
  for (const r of rows) {
    const extra = parseJson<Record<string, unknown>>(r.data, {});
    const ctx = buildContext({ ...extra, job_title: r.job_title });
    const d = String(ctx.department ?? 'unknown');
    const s = String(ctx.seniority ?? 'unknown');
    bump(dept, d, DEPARTMENT_LABELS[d as Department] ?? 'Unknown title', r);
    bump(sen, s, SENIORITY_LABELS[s as Seniority] ?? 'Unknown title', r);
  }
  const sort = (m: Map<string, SegmentRow>) =>
    [...m.values()]
      .filter((x) => x.key !== 'unknown')
      .sort((a, b) => b.prospects - a.prospects)
      .slice(0, 8);
  return { departments: sort(dept), seniority: sort(sen) };
}

export interface TopProspect {
  id: string;
  campaign_id: string;
  name: string;
  company: string | null;
  job_title: string | null;
  score: number;
  views: number;
  clicks: number;
  downloads: number;
  submissions: number;
  last_seen_at: number | null;
}

function top(app: AppContext, where: string, params: Array<string | number>, limit = 8): TopProspect[] {
  return app.db
    .all<Omit<TopProspect, 'name'> & { first_name: string | null; last_name: string | null; email: string | null }>(
      `SELECT id, campaign_id, first_name, last_name, email, company, job_title, score, views, clicks, downloads, submissions, last_seen_at
         FROM prospects WHERE ${where} AND views > 0 ORDER BY score DESC, last_seen_at DESC LIMIT ?`,
      ...params,
      limit,
    )
    .map(({ first_name, last_name, email, ...rest }) => ({
      ...rest,
      name: [first_name, last_name].filter(Boolean).join(' ') || email || 'Unknown',
    }));
}

export interface ActivityItem {
  id: number;
  type: string;
  created_at: number;
  prospect_id: string | null;
  campaign_id: string;
  campaign_name: string;
  name: string;
  company: string | null;
  detail: string;
}

function activity(app: AppContext, where: string, params: Array<string | number>, limit = 15): ActivityItem[] {
  const rows = app.db.all<{
    id: number;
    type: string;
    props: string;
    created_at: number;
    prospect_id: string | null;
    campaign_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    company: string | null;
    campaign_name: string;
  }>(
    `SELECT e.id, e.type, e.props, e.created_at, e.prospect_id, e.campaign_id, p.first_name, p.last_name, p.email, p.company, c.name AS campaign_name
       FROM events e LEFT JOIN prospects p ON p.id = e.prospect_id JOIN campaigns c ON c.id = e.campaign_id
      WHERE ${where} AND e.is_bot = 0 AND e.type IN ('view', 'click', 'download', 'submit', 'booked')
      ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
    ...params,
    limit,
  );
  return rows.map((r) => {
    const props = parseJson<Record<string, unknown>>(r.props, {});
    return {
      id: r.id,
      type: r.type,
      created_at: r.created_at,
      prospect_id: r.prospect_id,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || 'A visitor',
      company: r.company,
      detail: r.type === 'click' ? String(props.label ?? '') : '',
    };
  });
}

export function campaignAnalytics(app: AppContext, campaignId: string, days = 30) {
  const totals = totalsFor(app, 'campaign_id = ?', [campaignId]);
  const clicks = app.db.all<{ block: string; slot: string; label: string; n: number }>(
    `SELECT json_extract(props, '$.block') AS block, json_extract(props, '$.slot') AS slot, json_extract(props, '$.label') AS label, COUNT(*) AS n
       FROM events WHERE campaign_id = ? AND type = 'click' AND is_bot = 0 GROUP BY block, slot, label ORDER BY n DESC LIMIT 10`,
    campaignId,
  );
  const devices = app.db.get<{ mobile: number; desktop: number }>(
    `SELECT COALESCE(SUM(CAST(json_extract(props, '$.w') AS INTEGER) < 700), 0) AS mobile, COALESCE(SUM(CAST(json_extract(props, '$.w') AS INTEGER) >= 700), 0) AS desktop
       FROM events WHERE campaign_id = ? AND type = 'view' AND is_bot = 0`,
    campaignId,
  )!;
  const anonymous = app.db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM events WHERE campaign_id = ? AND prospect_id IS NULL AND type = 'view' AND is_bot = 0`,
    campaignId,
  )!.n;
  return {
    totals,
    funnel: [
      { key: 'created', label: 'Links created', n: totals.prospects },
      { key: 'opened', label: 'Opened', n: totals.opened },
      { key: 'engaged', label: 'Engaged', n: totals.engaged },
      { key: 'converted', label: 'Converted', n: totals.converted },
    ],
    series: series(app, 'campaign_id = ?', [campaignId], days),
    top: top(app, 'campaign_id = ?', [campaignId]),
    activity: activity(app, 'e.campaign_id = ?', [campaignId]),
    segments: segments(app, campaignId),
    clicks,
    devices,
    anonymous_views: anonymous,
  };
}

export function overview(app: AppContext, days = 14) {
  const campaigns = app.db.get<{ live: number; total: number }>(
    `SELECT COALESCE(SUM(status = 'live'), 0) AS live, COUNT(*) AS total FROM campaigns WHERE status <> 'archived'`,
  )!;
  return {
    campaigns,
    totals: totalsFor(app, '1 = 1', []),
    series: series(app, '1 = 1', [], days),
    top: top(app, '1 = 1', []),
    activity: activity(app, '1 = 1', []),
  };
}
