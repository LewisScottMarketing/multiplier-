import type { Campaign } from '@shared/schema';
import type { AppContext } from '../context';
import { getWorkspace } from './settings';

/** Origin used for a campaign's links: its custom domain if that domain is allowed, else PUBLIC_URL. */
export function publicOrigin(ctx: AppContext, campaign: Pick<Campaign, 'settings'>): string {
  const domain = campaign.settings.domain?.trim().toLowerCase();
  if (domain && getWorkspace(ctx).domains.includes(domain)) {
    const base = new URL(ctx.config.publicUrl);
    return `${base.protocol}//${domain}${base.port && base.hostname === 'localhost' ? `:${base.port}` : ''}`;
  }
  return ctx.config.publicUrl;
}

export const pageUrl = (ctx: AppContext, c: Pick<Campaign, 'settings'>, token: string) => `${publicOrigin(ctx, c)}/p/${token}`;
export const pdfUrl = (ctx: AppContext, c: Pick<Campaign, 'settings'>, token: string) => `${publicOrigin(ctx, c)}/p/${token}.pdf`;
export const coverUrl = (ctx: AppContext, c: Pick<Campaign, 'settings'>, token: string) => `${publicOrigin(ctx, c)}/p/${token}/cover.png`;
