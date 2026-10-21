import { newBlock } from '../../src/shared/blocks';
import { PageSchema, type Page } from '../../src/shared/schema';
import type { TestApp } from './app';

/** A small page that exercises personalisation: tokens with fallbacks, a persona-specific block, and a form. */
export function demoPage(overrides: Partial<Page> = {}): Page {
  return PageSchema.parse({
    header: { enabled: true, logo_text: 'Acme Co', button: { label: 'Book a call', action: { type: 'link', url: 'https://cal.com/acme/intro?name={{full_name}}' } } },
    footer: { text: 'Prepared for {{first_name|you}}', links: [{ label: 'Privacy', url: 'https://acme.com/privacy' }] },
    blocks: [
      newBlock('hero', {
        id: 'hero1',
        badge: 'Prepared for {{first_name|you}} at {{company|your team}}',
        headline: 'Pipeline plan for {{company|your team}}',
        subheadline: 'Hi {{first_name|there}} — here is **what we would do**.',
        primary: { label: 'Book a call', action: { type: 'link', url: 'https://cal.com/acme/intro' } },
        secondary: { label: 'Get the PDF', action: { type: 'document' } },
      }),
      newBlock('text', { id: 'mkt', heading: 'For marketing leaders', body: 'Marketing-specific copy for {{company_short}}.', rule: { match: 'all', conditions: [{ field: 'department', op: 'equals', value: 'marketing' }] } }),
      newBlock('text', { id: 'sales', heading: 'For sales leaders', body: 'Sales-specific copy.', rule: { match: 'all', conditions: [{ field: 'department', op: 'equals', value: 'sales' }] } }),
      newBlock('form', { id: 'form1' }),
    ],
    ...overrides,
  });
}

export async function createLiveCampaign(t: TestApp, opts: { name?: string; page?: Page; settings?: Record<string, unknown>; publish?: boolean } = {}) {
  const created = await t.json('POST', '/api/campaigns', { name: opts.name ?? 'Test Campaign' });
  const id = created.body.campaign.id as string;
  await t.json('PUT', `/api/campaigns/${id}`, { page: opts.page ?? demoPage(), ...(opts.settings ? { settings: opts.settings } : {}) });
  if (opts.publish !== false) await t.json('POST', `/api/campaigns/${id}/status`, { status: 'live' });
  const got = await t.json('GET', `/api/campaigns/${id}`);
  return got.body.campaign as { id: string; slug: string; version: number };
}

export async function createApiKey(t: TestApp, opts: { campaign_id?: string } = {}): Promise<string> {
  const res = await t.json('POST', '/api/api-keys', { name: 'Clay', ...opts });
  return res.body.key as string;
}

export const bearer = (key: string) => ({ authorization: `Bearer ${key}`, cookie: '' });
export const publicHeaders = (ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36') => ({ host: 'go.test', 'user-agent': ua, cookie: '' });
