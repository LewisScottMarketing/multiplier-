import { Hono } from 'hono';
import { z } from 'zod';
import { AiFieldSchema, BlockSchema } from '@shared/schema';
import { canVary } from '@shared/block-text';
import { HttpError, unprocessable } from '../lib/errors';
import { jsonBody, rateLimit, requireUser, type Env } from '../http';
import { aiEnabled, previewAiField, suggestVariant } from '../services/ai';
import { requireCampaign } from '../services/campaigns';
import { customFieldNames } from '../services/prospects';
import { parsePreviewSource, previewContext, previewSourceString, PreviewSourceSchema } from '../services/render';

const unavailable = () => new HttpError(503, 'ai_unavailable', 'AI isn’t switched on for this server. Set ANTHROPIC_API_KEY and restart to use it.');

/** Dashboard helpers that call Claude on the author's behalf. Nothing here is saved; the editor decides. */
export function aiRoutes() {
  const r = new Hono<Env>();
  r.use('*', requireUser);
  const limit = rateLimit('ai', 90, 3600_000, (c) => c.get('user').id);

  /** "Try it" for an AI field: write it once for whoever is being previewed. */
  r.post('/:id/ai/field-preview', limit, async (c) => {
    const app = c.get('app');
    const campaign = requireCampaign(app, c.req.param('id'));
    const body = await jsonBody(c, z.object({ field: AiFieldSchema, source: PreviewSourceSchema.default({ kind: 'sample', index: 0 }) }));
    if (!aiEnabled(app)) throw unavailable();
    const { ctx } = previewContext(app, campaign, parsePreviewSource(previewSourceString(body.source)));
    return c.json(await previewAiField(app, campaign, body.field, ctx));
  });

  /** A persona-specific rewrite of one block (sent as it currently looks in the editor, unsaved edits included). */
  r.post('/:id/ai/variant', limit, async (c) => {
    const app = c.get('app');
    const campaign = requireCampaign(app, c.req.param('id'));
    const body = await jsonBody(c, z.object({ block: BlockSchema, persona: z.object({ label: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(400) }) }));
    if (!aiEnabled(app)) throw unavailable();
    if (!canVary(body.block)) throw unprocessable('This kind of block can’t be rewritten automatically.');
    const out = await suggestVariant(app, campaign, body.block, body.persona, customFieldNames(app, campaign.id));
    if (!out.ok) {
      if (out.reason === 'refused') throw unprocessable('The AI declined to write this one. Try different wording in the block, or write it by hand.');
      if (out.reason === 'bad_output' || out.reason === 'config') throw unprocessable(out.message);
      throw new HttpError(502, 'ai_failed', out.message);
    }
    return c.json(out.result);
  });

  return r;
}
