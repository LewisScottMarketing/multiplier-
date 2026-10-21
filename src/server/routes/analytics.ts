import { Hono } from 'hono';
import { requireUser, type Env } from '../http';
import { campaignAnalytics, overview } from '../services/analytics';
import { requireCampaign } from '../services/campaigns';

export function analyticsRoutes() {
  const r = new Hono<Env>();
  r.use('*', requireUser);
  const days = (raw: string | undefined, fallback: number) => Math.min(Math.max(Number(raw) || fallback, 7), 180);

  r.get('/overview', (c) => c.json(overview(c.get('app'), days(c.req.query('days'), 14))));

  r.get('/campaigns/:id/analytics', (c) => {
    const app = c.get('app');
    requireCampaign(app, c.req.param('id'));
    return c.json(campaignAnalytics(app, c.req.param('id'), days(c.req.query('days'), 30)));
  });
  return r;
}
