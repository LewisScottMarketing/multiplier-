import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { CampaignSettingsSchema, type Campaign } from '@shared/schema';
import { templateById, buildTemplate } from '@shared/templates';
import { getSessionUser, SESSION_COOKIE } from '../auth/sessions';
import { unauthorized, notFound } from '../lib/errors';
import type { Env } from '../http';
import { renderPreview } from '../services/render';

/**
 * Serves builder previews. These live outside /api on purpose: the response carries the public
 * page's own Content-Security-Policy, which an <iframe srcdoc> could not have.
 */
export function previewRoutes() {
  const r = new Hono<Env>();
  r.get('/preview/:id', (c) => {
    const app = c.get('app');
    const user = getSessionUser(app, getCookie(c, SESSION_COOKIE));
    if (!user) throw unauthorized();
    const hit = app.previews.get(c.req.param('id'), user.id);
    if (!hit) throw notFound('Preview');
    return new Response(hit.html, { headers: hit.headers });
  });

  /** A starter template shown as a sample prospect would see it, for the "new campaign" gallery. */
  r.get('/preview/template/:id', (c) => {
    const app = c.get('app');
    if (!getSessionUser(app, getCookie(c, SESSION_COOKIE))) throw unauthorized();
    const id = c.req.param('id');
    const template = templateById(id);
    const page = template && buildTemplate(id);
    if (!template || !page) throw notFound('Template');
    const campaign: Campaign = {
      id: 'cmp_template',
      name: template.name,
      slug: template.id,
      status: 'draft',
      page,
      document: null,
      settings: CampaignSettingsSchema.parse({}),
      source: null,
      version: 1,
      created_at: 0,
      updated_at: 0,
      published_at: null,
    };
    const out = renderPreview(app, campaign, { kind: 'sample', index: 0 }, new URL(app.config.appUrl).host);
    return new Response(out.html, { headers: out.headers });
  });
  return r;
}
