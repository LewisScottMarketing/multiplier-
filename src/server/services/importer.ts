import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import type { Campaign, DocumentConfig, Page } from '@shared/schema';
import type { AppContext } from '../context';
import { badRequest, tooLarge } from '../lib/errors';
import { newId } from '../lib/ids';
import { extractDocument, extractImagePng, type ExtractedDoc } from '../pdf/extract';
import { fieldsForTokenRuns } from '../pdf/fields';
import { importToPage } from '../pdf/import';
import { extractPalette, renderPageRaster, sampleRunColors, type Raster } from '../pdf/raster';
import { isPdf, pdfGate, withTimeout } from '../pdf/runtime';
import { getAsset, storeImage, type AssetRow } from './assets';
import { createCampaign, requireCampaign, updateCampaign } from './campaigns';
import { aiEnabled, polishImport } from './ai';
import { forgetSource } from './documents';

export interface StoredPdf {
  asset: AssetRow;
  extracted: ExtractedDoc;
  rasters: Raster[];
  editable: boolean;
}

/** Validate, store and analyse an uploaded PDF. */
export async function storePdf(app: AppContext, input: { data: Buffer; filename: string; campaignId?: string | null }): Promise<StoredPdf> {
  if (input.data.length > app.config.maxUploadBytes) throw tooLarge(`PDFs can be up to ${Math.round(app.config.maxUploadBytes / 1024 / 1024)} MB.`);
  if (!isPdf(input.data)) throw badRequest('That file doesn’t look like a PDF.');

  const { extracted, rasters } = await pdfGate.run(() =>
    withTimeout(
      (async () => {
        const extracted = await extractDocument(input.data);
        // the first pages give us the brand palette, and colours for any {{token}} placeholders
        const wanted = new Set<number>([1, 2, 3].filter((n) => n <= extracted.page_count));
        for (const t of extracted.tokens) wanted.add(t.page);
        const rasters: Raster[] = [];
        for (const n of [...wanted].sort((a, b) => a - b)) rasters.push(Object.assign(await renderPageRaster(input.data, n, 1.5), { page: n }));
        return { extracted, rasters };
      })(),
      90_000,
      'Reading the PDF',
    ),
  );

  // pdf-lib must be able to open it for us to edit it later
  let editable = true;
  try {
    await PDFDocument.load(input.data, { updateMetadata: false });
  } catch {
    editable = false;
  }

  const id = newId('ast');
  const key = `assets/${id}.pdf`;
  await app.storage.put(key, input.data);
  app.db.run(
    'INSERT INTO assets (id, kind, filename, mime, size, sha256, storage_key, meta, campaign_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    'pdf',
    input.filename.slice(0, 200),
    'application/pdf',
    input.data.length,
    createHash('sha256').update(input.data).digest('hex'),
    key,
    JSON.stringify({
      pages: extracted.pages.map((p) => ({ w: p.width, h: p.height })),
      title: extracted.meta.title ?? null,
      tokens: [...new Set(extracted.tokens.map((t) => t.token))],
      editable,
    }),
    input.campaignId ?? null,
    Date.now(),
  );
  return { asset: getAsset(app, id)!, extracted, rasters: rasters as Raster[], editable };
}

/** Token placeholders found in the PDF become ready-made replace fields, with colours sampled from the render. */
function tokenFields(extracted: ExtractedDoc, rasters: Array<Raster & { page?: number }>) {
  for (const r of rasters) {
    const pg = extracted.pages[(r.page ?? 1) - 1];
    if (pg) sampleRunColors(r, pg.runs.filter((run) => /\{\{[^{}]{1,80}\}\}/.test(run.text)));
  }
  return fieldsForTokenRuns(extracted.pages);
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

export interface ImportOutcome {
  campaign: Campaign;
  report: string[];
}

/** Upload a PDF → a campaign with a landing page built from it and the PDF ready to personalise. */
export async function importPdfCampaign(app: AppContext, input: { data: Buffer; filename: string; name?: string; ai?: boolean }): Promise<ImportOutcome> {
  const stored = await storePdf(app, input);
  const { extracted, asset } = stored;
  const first = stored.rasters.slice(0, 3);
  const palette = extractPalette(first);

  const result = await importToPage(extracted, palette, {
    filename: input.filename,
    saveImage: async (img) => {
      const out = await pdfGate.run(() => withTimeout(extractImagePng(input.data, img.ref), 15_000, 'Reading an image'));
      if (!out) return null;
      const saved = await storeImage(app, { data: out.png, filename: `${input.filename}-${img.ref}.png` });
      return saved.id;
    },
  });
  const report = [...result.report];
  let importedPage = result.page as Page;
  // optional: let Claude tidy weak copy (never overrides text that already reads well; skipped silently without a key)
  if (input.ai !== false && aiEnabled(app)) {
    const polished = await polishImport(app, { page: importedPage, filename: input.filename });
    importedPage = polished.page;
    report.push(...polished.notes);
  }

  const headline = importedPage.blocks.find((b) => b.type === 'hero');
  const title = headline?.type === 'hero' && headline.headline ? headline.headline : input.filename.replace(/\.pdf$/i, '');
  if (!stored.editable) report.push('This PDF can’t be edited (it may use unusual encryption or structure), so each prospect gets the original file. The landing page is unaffected.');

  const fields = stored.editable ? tokenFields(extracted, stored.rasters) : [];
  const document: DocumentConfig = {
    asset_id: asset.id,
    page_count: extracted.page_count,
    filename: `${safeName(title) || 'Document'} - {{company_short|for you}}.pdf`,
    fields,
  };

  const campaign = createCampaign(app, {
    name: (input.name?.trim() || title).slice(0, 120),
    page: importedPage,
    document,
    source: { type: 'pdf', asset_id: asset.id, filename: input.filename, imported_at: Date.now(), report },
  });
  app.db.run('UPDATE assets SET campaign_id = ? WHERE id = ?', campaign.id, asset.id);
  return { campaign, report };
}

/** Attach (or replace) the PDF of an existing campaign. Existing fields are dropped: page geometry may differ. */
export async function attachPdf(app: AppContext, campaignId: string, input: { data: Buffer; filename: string }): Promise<{ campaign: Campaign; detected: number }> {
  const current = requireCampaign(app, campaignId);
  const stored = await storePdf(app, { ...input, campaignId });
  const fields = stored.editable ? tokenFields(stored.extracted, stored.rasters) : [];
  const campaign = updateCampaign(app, campaignId, {
    document: {
      asset_id: stored.asset.id,
      page_count: stored.extracted.page_count,
      filename: current.document?.filename ?? '{{company_short|Document}}.pdf',
      fields,
    },
  });
  if (current.document) await removeAsset(app, current.document.asset_id);
  return { campaign, detected: fields.length };
}

export async function removeAsset(app: AppContext, assetId: string): Promise<void> {
  const a = getAsset(app, assetId);
  if (!a) return;
  forgetSource(a.id);
  app.db.run('DELETE FROM assets WHERE id = ?', a.id);
  await app.storage.delete(a.storage_key);
  await app.storage.deletePrefix(`doc/${a.sha256.slice(0, 16)}`);
}
