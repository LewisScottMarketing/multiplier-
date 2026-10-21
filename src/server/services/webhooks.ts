import { createHmac } from 'node:crypto';
import type { Campaign } from '@shared/schema';
import type { AppContext } from '../context';
import { parseJson } from '../db/database';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { notFound } from '../lib/errors';
import { newId, randomString } from '../lib/ids';
import { safeRequest } from '../lib/safe-fetch';
import { pageUrl, pdfUrl } from './links';
import { publicProspect, stageOf, type Prospect } from './prospects';

export const EVENT_NAMES = [
  'prospect.created',
  'page.first_viewed',
  'page.viewed',
  'link.clicked',
  'pdf.downloaded',
  'form.submitted',
  'meeting.booked',
] as const;
export type WebhookEvent = (typeof EVENT_NAMES)[number];
export const DEFAULT_EVENTS: WebhookEvent[] = ['page.first_viewed', 'link.clicked', 'pdf.downloaded', 'form.submitted', 'meeting.booked'];

export type WebhookKind = 'clay' | 'slack' | 'generic';

interface WebhookRow {
  id: string;
  name: string;
  kind: WebhookKind;
  url: string;
  secret: string | null;
  auth_header: string | null;
  auth_value: string | null;
  events: string;
  campaign_id: string | null;
  active: number;
  created_at: number;
}

export interface Webhook {
  id: string;
  name: string;
  kind: WebhookKind;
  url: string;
  auth_header: string | null;
  has_auth_value: boolean;
  has_secret: boolean;
  events: string[];
  campaign_id: string | null;
  active: boolean;
  created_at: number;
  stats: { pending: number; delivered: number; failed: number };
}

const SECRET = 'webhook';

function toWebhook(ctx: AppContext, r: WebhookRow): Webhook {
  const counts = ctx.db.all<{ status: string; n: number }>(
    'SELECT status, COUNT(*) AS n FROM webhook_deliveries WHERE webhook_id = ? GROUP BY status',
    r.id,
  );
  const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    url: r.url,
    auth_header: r.auth_header,
    has_auth_value: !!r.auth_value,
    has_secret: !!r.secret,
    events: parseJson<string[]>(r.events, []),
    campaign_id: r.campaign_id,
    active: !!r.active,
    created_at: r.created_at,
    stats: { pending: n('pending'), delivered: n('delivered'), failed: n('failed') },
  };
}

export const listWebhooks = (ctx: AppContext): Webhook[] =>
  ctx.db.all<WebhookRow>('SELECT * FROM webhooks ORDER BY created_at DESC').map((r) => toWebhook(ctx, r));

export interface WebhookInput {
  name: string;
  kind: WebhookKind;
  url: string;
  auth_header?: string | null;
  auth_value?: string | null;
  events?: string[];
  campaign_id?: string | null;
  active?: boolean;
}

export function createWebhook(ctx: AppContext, input: WebhookInput): { webhook: Webhook; secret: string | null } {
  const id = newId('whk');
  // generic hooks are signed; the secret is shown once, like an API key
  const secret = input.kind === 'generic' ? `whsec_${randomString(32, 'abcdefghijklmnopqrstuvwxyz0123456789')}` : null;
  ctx.db.run(
    `INSERT INTO webhooks (id, name, kind, url, secret, auth_header, auth_value, events, campaign_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.name.trim(),
    input.kind,
    input.url.trim(),
    secret ? encryptSecret(ctx.config.secret, SECRET, secret) : null,
    input.auth_header?.trim() || null,
    input.auth_value ? encryptSecret(ctx.config.secret, SECRET, input.auth_value) : null,
    JSON.stringify(input.events?.length ? input.events : DEFAULT_EVENTS),
    input.campaign_id ?? null,
    input.active === false ? 0 : 1,
    Date.now(),
  );
  return { webhook: toWebhook(ctx, ctx.db.get<WebhookRow>('SELECT * FROM webhooks WHERE id = ?', id)!), secret };
}

export function updateWebhook(ctx: AppContext, id: string, patch: Partial<WebhookInput>): Webhook {
  const row = ctx.db.get<WebhookRow>('SELECT * FROM webhooks WHERE id = ?', id);
  if (!row) throw notFound('Webhook');
  ctx.db.run(
    `UPDATE webhooks SET name = ?, url = ?, auth_header = ?, auth_value = ?, events = ?, campaign_id = ?, active = ? WHERE id = ?`,
    patch.name?.trim() ?? row.name,
    patch.url?.trim() ?? row.url,
    patch.auth_header === undefined ? row.auth_header : patch.auth_header?.trim() || null,
    patch.auth_value === undefined ? row.auth_value : patch.auth_value ? encryptSecret(ctx.config.secret, SECRET, patch.auth_value) : null,
    patch.events ? JSON.stringify(patch.events) : row.events,
    patch.campaign_id === undefined ? row.campaign_id : patch.campaign_id,
    patch.active === undefined ? row.active : patch.active ? 1 : 0,
    id,
  );
  return toWebhook(ctx, ctx.db.get<WebhookRow>('SELECT * FROM webhooks WHERE id = ?', id)!);
}

export function deleteWebhook(ctx: AppContext, id: string): void {
  if (ctx.db.run('DELETE FROM webhooks WHERE id = ?', id).changes === 0) throw notFound('Webhook');
}

export function recentDeliveries(ctx: AppContext, webhookId: string, limit = 25) {
  return ctx.db.all<{
    id: string;
    event: string;
    status: string;
    attempts: number;
    last_status: number | null;
    last_error: string | null;
    created_at: number;
    delivered_at: number | null;
  }>(
    'SELECT id, event, status, attempts, last_status, last_error, created_at, delivered_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?',
    webhookId,
    limit,
  );
}

// ── Payloads ────────────────────────────────────────────────────────────────

function flatPayload(ctx: AppContext, event: string, campaign: Campaign, p: Prospect, props: Record<string, unknown>) {
  const pub = publicProspect(ctx, campaign, p);
  const out: Record<string, unknown> = {
    event,
    occurred_at: new Date().toISOString(),
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    prospect_id: p.id,
    external_id: p.external_id,
    email: p.email,
    first_name: p.first_name,
    last_name: p.last_name,
    company: p.company,
    job_title: p.job_title,
    page_url: pageUrl(ctx, campaign, p.token),
    pdf_url: campaign.document ? pdfUrl(ctx, campaign, p.token) : null,
    stage: stageOf(p),
    views: p.views,
    clicks: p.clicks,
    downloads: p.downloads,
    submissions: p.submissions,
    engaged_seconds: p.engaged_seconds,
    score: p.score,
    seniority: pub.seniority,
    department: pub.department,
  };
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (k === 'fields' && typeof v === 'object') {
      for (const [fk, fv] of Object.entries(v as Record<string, unknown>)) out[`form_${fk}`] = fv;
    } else if (typeof v !== 'object') out[k] = v;
  }
  return out;
}

const SLACK_TEXT: Record<string, (who: string, c: Campaign, props: Record<string, unknown>) => string> = {
  'prospect.created': (w, c) => `🆕 Link created for ${w} in “${c.name}”`,
  'page.first_viewed': (w, c) => `👀 ${w} just opened your page “${c.name}”`,
  'page.viewed': (w, c) => `👀 ${w} viewed “${c.name}” again`,
  'link.clicked': (w, c, p) => `🖱️ ${w} clicked ${p.label ? `“${String(p.label)}”` : 'a button'} on “${c.name}”`,
  'pdf.downloaded': (w, c) => `📄 ${w} downloaded the PDF from “${c.name}”`,
  'form.submitted': (w, c) => `📬 ${w} submitted the form on “${c.name}”`,
  'meeting.booked': (w, c) => `📅 ${w} booked a meeting from “${c.name}”`,
};

/** Slack reads <…> as links and mentions (<!channel>), so text that came from a prospect's profile must not carry any. */
export const slackSafe = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function buildPayload(
  ctx: AppContext,
  kind: WebhookKind,
  event: string,
  campaign: Campaign,
  p: Prospect,
  props: Record<string, unknown>,
  deliveryId: string,
) {
  if (kind === 'clay') return flatPayload(ctx, event, campaign, p, props);
  if (kind === 'slack') {
    const who = slackSafe([p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'A prospect');
    const at = p.company ? ` (${slackSafe(p.company)})` : '';
    const text = (SLACK_TEXT[event] ?? ((w: string) => `${event}: ${w}`))(
      who + at,
      { ...campaign, name: slackSafe(campaign.name) },
      { ...props, label: props.label ? slackSafe(props.label) : undefined },
    );
    return { text: `${text}\n<${pageUrl(ctx, campaign, p.token)}|Open their page>` };
  }
  return {
    id: deliveryId,
    event,
    created_at: new Date().toISOString(),
    campaign: { id: campaign.id, name: campaign.name, slug: campaign.slug },
    prospect: publicProspect(ctx, campaign, p),
    data: props,
  };
}

// ── Emit (enqueue) ──────────────────────────────────────────────────────────

/** Queue a delivery for every active webhook subscribed to this event. Never throws into request handling. */
export function emitEvent(
  ctx: AppContext,
  event: string,
  campaign: Campaign,
  prospect: Prospect,
  props: Record<string, unknown> = {},
): number {
  try {
    const hooks = ctx.db.all<WebhookRow>(
      'SELECT * FROM webhooks WHERE active = 1 AND (campaign_id IS NULL OR campaign_id = ?)',
      campaign.id,
    );
    let queued = 0;
    for (const h of hooks) {
      const events = parseJson<string[]>(h.events, []);
      if (!events.includes('*') && !events.includes(event)) continue;
      const id = newId('dlv');
      const payload = buildPayload(ctx, h.kind, event, campaign, prospect, props, id);
      ctx.db.run(
        'INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, attempts, next_attempt_at, created_at, prospect_id, campaign_id) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
        id,
        h.id,
        event,
        JSON.stringify(payload),
        'pending',
        Date.now(),
        Date.now(),
        prospect.id,
        campaign.id,
      );
      queued++;
    }
    return queued;
  } catch (err) {
    ctx.log.error('failed to queue webhook', { err, event });
    return 0;
  }
}

// ── Deliver ─────────────────────────────────────────────────────────────────

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  attempts: number;
}

async function send(
  ctx: AppContext,
  hook: WebhookRow,
  d: DeliveryRow,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const body = d.payload;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-multiplier-event': d.event,
    'x-multiplier-delivery': d.id,
  };
  if (hook.auth_header && hook.auth_value) {
    const v = decryptSecret(ctx.config.secret, SECRET, hook.auth_value);
    if (v) headers[hook.auth_header.toLowerCase()] = v;
  }
  if (hook.secret) {
    const secret = decryptSecret(ctx.config.secret, SECRET, hook.secret);
    if (secret) {
      const ts = String(Math.floor(Date.now() / 1000));
      headers['x-multiplier-timestamp'] = ts;
      headers['x-multiplier-signature'] = `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
    }
  }
  try {
    const res = await safeRequest(hook.url, {
      method: 'POST',
      headers,
      body,
      timeoutMs: 10_000,
      maxBytes: 64 * 1024,
      allowPrivate: ctx.config.allowPrivateFetch,
      httpsOnly: ctx.config.env === 'production' && !ctx.config.allowPrivateFetch,
    });
    return res.status >= 200 && res.status < 300
      ? { ok: true, status: res.status, error: null }
      : { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: null, error: (e as Error).message.slice(0, 300) };
  }
}

async function deliverOne(ctx: AppContext, d: DeliveryRow): Promise<void> {
  const hook = ctx.db.get<WebhookRow>('SELECT * FROM webhooks WHERE id = ?', d.webhook_id);
  if (!hook) return;
  const r = await send(ctx, hook, d);
  const attempts = d.attempts + 1;
  if (r.ok) {
    ctx.db.run(
      `UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, last_status = ?, last_error = NULL, delivered_at = ? WHERE id = ?`,
      attempts,
      r.status,
      Date.now(),
      d.id,
    );
  } else if (attempts > BACKOFF_MS.length) {
    ctx.db.run(
      `UPDATE webhook_deliveries SET status = 'failed', attempts = ?, last_status = ?, last_error = ? WHERE id = ?`,
      attempts,
      r.status,
      r.error,
      d.id,
    );
  } else {
    ctx.db.run(
      `UPDATE webhook_deliveries SET attempts = ?, last_status = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`,
      attempts,
      r.status,
      r.error,
      Date.now() + BACKOFF_MS[attempts - 1],
      d.id,
    );
  }
}

/** Send everything that is due. Safe to call concurrently; each row is claimed before sending. */
export async function processDeliveries(ctx: AppContext, limit = 25): Promise<number> {
  const due = ctx.db.all<DeliveryRow>(
    `SELECT id, webhook_id, event, payload, attempts FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?`,
    Date.now(),
    limit,
  );
  const claimed = due.filter(
    (d) =>
      ctx.db.run(
        `UPDATE webhook_deliveries SET next_attempt_at = ? WHERE id = ? AND next_attempt_at <= ?`,
        Date.now() + 120_000,
        d.id,
        Date.now(),
      ).changes > 0,
  );
  for (let i = 0; i < claimed.length; i += 4) await Promise.all(claimed.slice(i, i + 4).map((d) => deliverOne(ctx, d)));
  return claimed.length;
}

/** "Send test event" button: builds a sample payload and delivers it immediately. */
export async function sendTest(
  ctx: AppContext,
  webhookId: string,
  campaign: Campaign,
  prospect: Prospect,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const hook = ctx.db.get<WebhookRow>('SELECT * FROM webhooks WHERE id = ?', webhookId);
  if (!hook) throw notFound('Webhook');
  const id = newId('dlv');
  const payload = buildPayload(ctx, hook.kind, 'page.first_viewed', campaign, prospect, { test: true }, id);
  return send(ctx, hook, { id, webhook_id: hook.id, event: 'page.first_viewed', payload: JSON.stringify(payload), attempts: 0 });
}

/**
 * Delivery rows hold a copy of what was sent, which includes personal data. Keep them long enough to debug
 * a destination (two weeks if delivered, a month if they never got through) and no longer.
 */
export function pruneDeliveries(ctx: AppContext, now = Date.now()): number {
  const day = 86_400_000;
  return ctx.db.run(
    `DELETE FROM webhook_deliveries WHERE (status = 'delivered' AND created_at < ?) OR (status = 'failed' AND created_at < ?)`,
    now - 14 * day,
    now - 30 * day,
  ).changes;
}

export function startWebhookWorker(ctx: AppContext, everyMs = 5000): () => void {
  let running = false;
  let lastPrune = 0;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    if (Date.now() - lastPrune > 3600_000) {
      lastPrune = Date.now();
      try {
        pruneDeliveries(ctx);
      } catch (err) {
        ctx.log.error('could not prune webhook deliveries', { err });
      }
    }
    processDeliveries(ctx)
      .catch((err) => ctx.log.error('webhook worker failed', { err }))
      .finally(() => (running = false));
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
