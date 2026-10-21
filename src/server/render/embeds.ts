import { renderUrl, safeUrl, type Ctx } from '@shared/template';

/** Hosts we're willing to frame. Mirrors the page CSP `frame-src` and the HTML sanitiser allowlist. */
export const FRAME_HOSTS = [
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'www.loom.com',
  'fast.wistia.net',
  'calendly.com',
  'cal.com',
  'meetings.hubspot.com',
  'meetings-eu1.hubspot.com',
] as const;

const ID = /^[A-Za-z0-9_-]{3,64}$/;

export interface VideoEmbed {
  provider: 'youtube' | 'vimeo' | 'loom' | 'wistia';
  src: string;
}

export function videoEmbed(rawUrl: string): VideoEmbed | null {
  let u: URL;
  try {
    u = new URL(safeUrl(rawUrl) || 'x:');
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = u.searchParams.get('v') ?? (['embed', 'shorts', 'live'].includes(seg[0]) ? seg[1] : '');
    if (id && ID.test(id)) return { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}?rel=0` };
  }
  if (host === 'youtu.be' && seg[0] && ID.test(seg[0])) {
    return { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${seg[0]}?rel=0` };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = seg.find((s) => /^\d+$/.test(s));
    const hash = seg.find((s) => /^[0-9a-f]{8,}$/i.test(s) && s !== id) ?? u.searchParams.get('h');
    if (id) return { provider: 'vimeo', src: `https://player.vimeo.com/video/${id}${hash && ID.test(hash) ? `?h=${hash}` : ''}` };
  }
  if (host === 'loom.com' && ['share', 'embed'].includes(seg[0]) && seg[1] && ID.test(seg[1])) {
    return { provider: 'loom', src: `https://www.loom.com/embed/${seg[1]}` };
  }
  if (['wistia.com', 'wistia.net'].some((d) => host === d || host.endsWith(`.${d}`))) {
    const i = seg.indexOf('medias');
    const id = i >= 0 ? seg[i + 1] : seg[seg.indexOf('iframe') + 1];
    if (id && ID.test(id)) return { provider: 'wistia', src: `https://fast.wistia.net/embed/iframe/${id}` };
  }
  return null;
}

export interface CalendarEmbed {
  provider: 'calendly' | 'cal' | 'hubspot';
  src: string;
}

/** Embeddable booking URL with the prospect's name and email prefilled where the provider supports it. */
export function calendarEmbed(rawUrl: string, ctx: Ctx, host: string): CalendarEmbed | null {
  const rendered = renderUrl(rawUrl, ctx);
  let u: URL;
  try {
    u = new URL(rendered || 'x:');
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  const name = String(ctx.full_name ?? '');
  const email = String(ctx.email ?? '');
  if (h === 'calendly.com') {
    u.searchParams.set('embed_type', 'Inline');
    u.searchParams.set('embed_domain', host);
    u.searchParams.set('hide_gdpr_banner', '1');
    if (name) u.searchParams.set('name', name);
    if (email) u.searchParams.set('email', email);
    return { provider: 'calendly', src: u.toString() };
  }
  if (h === 'cal.com') {
    u.searchParams.set('embed', 'true');
    if (name) u.searchParams.set('name', name);
    if (email) u.searchParams.set('email', email);
    return { provider: 'cal', src: u.toString() };
  }
  if (h === 'meetings.hubspot.com' || h === 'meetings-eu1.hubspot.com') {
    u.searchParams.set('embed', 'true');
    if (ctx.first_name) u.searchParams.set('firstName', String(ctx.first_name));
    if (ctx.last_name) u.searchParams.set('lastName', String(ctx.last_name));
    if (email) u.searchParams.set('email', email);
    return { provider: 'hubspot', src: u.toString() };
  }
  return null;
}
