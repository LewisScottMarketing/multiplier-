import { Hono } from 'hono';
import { z } from 'zod';
import { DocumentSchema, type Campaign } from '@shared/schema';
import { badRequest, notFound } from '../lib/errors';
import { jsonBody, rateLimit, requireUser, type C, type Env } from '../http';
import { fieldFromRun, stampField } from '../pdf/fields';
import { requireCampaign, updateCampaign } from '../services/campaigns';
import { buildPdf, previewPage, studioPage } from '../services/documents';
import { attachPdf, importPdfCampaign, redesignCampaign, removeAsset } from '../services/importer';
import { getAsset } from '../services/assets';
import { parsePreviewSource, previewContext, previewSourceString, PreviewSourceSchema, type PreviewSource } from '../services/render';

async function readPdfUpload(c: C): Promise<{ data: Buffer; filename: string; name?: string; ai?: boolean; brandId?: string }> {
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw badRequest('Attach a PDF as "file".');
  const max = c.get('app').config.maxUploadBytes;
  if (file.size > max) throw badRequest(`PDFs can be up to ${Math.round(max / 1024 / 1024)} MB.`);
  return {
    data: Buffer.from(await file.arrayBuffer()),
    filename: file.name || 'document.pdf',
    name: typeof form.name === 'string' ? form.name : undefined,
    ai: form.ai === '0' ? false : undefined,
    brandId: typeof form.brand_id === 'string' && form.brand_id.trim() ? form.brand_id.trim().slice(0, 40) : undefined,
  };
}

const png = (bytes: Uint8Array | Buffer, extra: Record<string, string> = {}) =>
  new Response(Buffer.from(bytes), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff', ...extra },
  });

export function documentRoutes() {
  const r = new Hono<Env>();
  r.use('*', requireUser);

  /** The headline feature: upload a PDF, get a campaign with a landing page built from it. */
  r.post(
    '/import-pdf',
    rateLimit('import-pdf', 20, 3600_000, (c) => c.get('user').id),
    async (c) => {
      const app = c.get('app');
      const upload = await readPdfUpload(c);
      const { campaign, report } = await importPdfCampaign(app, upload);
      return c.json({ campaign, report }, 201);
    },
  );

  /** Build the page again from this campaign's own PDF, as a copy: with a brand (or none), with or without Claude. */
  r.post(
    '/:id/redesign',
    rateLimit('import-pdf', 20, 3600_000, (c) => c.get('user').id),
    async (c) => {
      const body = await jsonBody(
        c,
        z.object({ brand_id: z.string().max(40).optional(), ai: z.boolean().optional(), name: z.string().trim().max(120).optional() }),
      );
      const { campaign, report } = await redesignCampaign(c.get('app'), c.req.param('id'), {
        brandId: body.brand_id,
        ai: body.ai,
        name: body.name,
      });
      return c.json({ campaign, report }, 201);
    },
  );

  const withDocument = (c: C): { campaign: Campaign; doc: NonNullable<Campaign['document']> } => {
    const campaign = requireCampaign(c.get('app'), c.req.param('id') ?? '');
    if (!campaign.document) throw notFound('Document');
    return { campaign, doc: campaign.document };
  };

  r.get('/:id/document', (c) => {
    const app = c.get('app');
    const campaign = requireCampaign(app, c.req.param('id'));
    if (!campaign.document) return c.json({ document: null });
    const asset = getAsset(app, campaign.document.asset_id);
    const meta = asset
      ? (JSON.parse(asset.meta) as { pages?: Array<{ w: number; h: number }>; tokens?: string[]; editable?: boolean })
      : {};
    return c.json({
      document: campaign.document,
      file: asset
        ? {
            filename: asset.filename,
            size: asset.size,
            pages: meta.pages ?? [],
            tokens: meta.tokens ?? [],
            editable: meta.editable !== false,
          }
        : null,
    });
  });

  r.post(
    '/:id/document/upload',
    rateLimit('import-pdf', 20, 3600_000, (c) => c.get('user').id),
    async (c) => {
      const app = c.get('app');
      requireCampaign(app, c.req.param('id'));
      const upload = await readPdfUpload(c);
      return c.json(await attachPdf(app, c.req.param('id'), upload));
    },
  );

  r.delete('/:id/document', async (c) => {
    const app = c.get('app');
    const { doc } = withDocument(c);
    const campaign = updateCampaign(app, c.req.param('id'), { document: null });
    await removeAsset(app, doc.asset_id);
    return c.json({ campaign });
  });

  // ── Studio ────────────────────────────────────────────────────────────────
  r.get('/:id/document/page/:n{[0-9]+}', async (c) => {
    const { doc } = withDocument(c);
    const n = Number(c.req.param('n'));
    if (!Number.isInteger(n)) throw badRequest('Bad page number');
    const { page } = await studioPage(c.get('app'), doc, n);
    return c.json({ page, image_url: `/api/campaigns/${c.req.param('id')}/document/page/${n}.png` });
  });

  r.get('/:id/document/page/:n{[0-9]+\\.png}', async (c) => {
    const { doc } = withDocument(c);
    const { png: bytes } = await studioPage(c.get('app'), doc, Number(c.req.param('n').replace('.png', '')));
    return png(bytes, { 'Cache-Control': 'private, max-age=3600' });
  });

  r.post('/:id/document/field-from-run', async (c) => {
    const { doc } = withDocument(c);
    const body = await jsonBody(
      c,
      z.object({ page: z.number().int().min(1), run_id: z.string().max(40), template: z.string().max(1500).optional() }),
    );
    const { page } = await studioPage(c.get('app'), doc, body.page);
    const run = page.runs.find((x) => x.id === body.run_id);
    if (!run) throw notFound('Text');
    return c.json({ field: fieldFromRun(page, run, { template: body.template }) });
  });

  r.post('/:id/document/stamp', async (c) => {
    const { doc } = withDocument(c);
    const body = await jsonBody(
      c,
      z.object({
        page: z.number().int().min(1).default(1),
        bg: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default('#ffffff'),
      }),
    );
    const { page } = await studioPage(c.get('app'), doc, body.page);
    return c.json({ field: stampField(page, body.bg) });
  });

  /** Render one page of a DRAFT document as a given person, so edits can be checked before saving. */
  r.post('/:id/document/preview', async (c) => {
    const app = c.get('app');
    const { campaign } = withDocument(c);
    const body = await jsonBody(
      c,
      z.object({
        document: DocumentSchema,
        source: PreviewSourceSchema.default({ kind: 'sample', index: 0 }),
        page: z.number().int().min(1).max(500).default(1),
      }),
    );
    const src = parsePreviewSource(previewSourceString(body.source));
    const { ctx } = previewContext(app, campaign, src);
    const { png: bytes, warnings } = await previewPage(app, campaign, body.document, ctx, body.page, 2);
    return png(bytes, { 'Cache-Control': 'no-store', 'X-Preview-Warnings': Buffer.from(JSON.stringify(warnings)).toString('base64') });
  });

  // Used by the page builder's preview ("Download PDF" button and the PDF cover image).
  const previewSource = (c: C): PreviewSource => parsePreviewSource(c.req.query('as'));

  r.get('/:id/document/preview.pdf', async (c) => {
    const app = c.get('app');
    const { campaign } = withDocument(c);
    const { ctx } = previewContext(app, campaign, previewSource(c));
    const built = await buildPdf(app, campaign, ctx, null);
    return new Response(Buffer.from(built.bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${built.filename.replace(/[^\w.\- ()]+/g, '_')}"`,
        'Cache-Control': 'no-store',
      },
    });
  });

  r.get('/:id/document/preview/:n{[0-9]+\\.png}', async (c) => {
    const app = c.get('app');
    const { campaign, doc } = withDocument(c);
    const { ctx } = previewContext(app, campaign, previewSource(c));
    const { png: bytes } = await previewPage(app, campaign, doc, ctx, Number(c.req.param('n').replace('.png', '')), 1.4);
    return png(bytes, { 'Cache-Control': 'no-store' });
  });

  return r;
}
