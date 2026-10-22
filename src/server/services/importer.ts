import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { applyBrand } from '@shared/brand';
import type { Brand, Campaign, DocumentConfig, Page } from '@shared/schema';
import type { AppContext } from '../context';
import { badRequest, notFound, tooLarge } from '../lib/errors';
import { newId } from '../lib/ids';
import { extractDocument, extractImagePng, type ExtractedDoc } from '../pdf/extract';
import { fieldsForTokenRuns } from '../pdf/fields';
import { importToPage } from '../pdf/import';
import { extractPalette, renderPageRaster, sampleRunColors, type Raster } from '../pdf/raster';
import { isPdf, pdfGate, withTimeout } from '../pdf/runtime';
import { cloneAsset, getAsset, storeImage, type AssetRow } from './assets';
import { createCampaign, requireCampaign, updateCampaign } from './campaigns';
import { chooseBrand, NO_BRAND } from './brands';
import { aiEnabled, polishImport } from './ai';
import { designPageFromPdf } from './designer';
import { forgetSource } from './documents';

export interface StoredPdf {
  asset: AssetRow;
  extracted: ExtractedDoc;
  rasters: Raster[];
  editable: boolean;
}

/** Read a PDF's text and draw the pages we need colours from (the first three, and any with a {{token}} on them). */
async function analysePdf(data: Buffer): Promise<{ extracted: ExtractedDoc; rasters: Raster[] }> {
  return pdfGate.run(() =>
    withTimeout(
      (async () => {
        const extracted = await extractDocument(data);
        const wanted = new Set<number>([1, 2, 3].filter((n) => n <= extracted.page_count));
        for (const t of extracted.tokens) wanted.add(t.page);
        const rasters: Raster[] = [];
        for (const n of [...wanted].sort((a, b) => a - b)) rasters.push(Object.assign(await renderPageRaster(data, n, 1.5), { page: n }));
        return { extracted, rasters };
      })(),
      90_000,
      'Reading the PDF',
    ),
  );
}

/** Validate, store and analyse an uploaded PDF. */
export async function storePdf(app: AppContext, input: { data: Buffer; filename: string; campaignId?: string | null }): Promise<StoredPdf> {
  if (input.data.length > app.config.maxUploadBytes)
    throw tooLarge(`PDFs can be up to ${Math.round(app.config.maxUploadBytes / 1024 / 1024)} MB.`);
  if (!isPdf(input.data)) throw badRequest('That file doesn’t look like a PDF.');

  const { extracted, rasters } = await analysePdf(input.data);

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
    if (pg)
      sampleRunColors(
        r,
        pg.runs.filter((run) => /\{\{[^{}]{1,80}\}\}/.test(run.text)),
      );
  }
  return fieldsForTokenRuns(extracted.pages);
}

const safeName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

export interface ImportOutcome {
  campaign: Campaign;
  report: string[];
}

/**
 * The landing page for a PDF: designed by Claude when AI is on (falling back to the standard import when it can't), with
 * the brand's colours, typefaces and logo on it when there is one. Returns the page and what to tell the person.
 */
async function buildPage(
  app: AppContext,
  input: { data: Buffer; filename: string; extracted: ExtractedDoc; rasters: Raster[]; ai?: boolean; brand: Brand | null },
): Promise<{ page: Page; report: string[] }> {
  const { extracted, brand } = input;
  const palette = extractPalette(input.rasters.slice(0, 3));

  const embedded = async (ref: string): Promise<string | null> => {
    const out = await pdfGate.run(() => withTimeout(extractImagePng(input.data, ref), 15_000, 'Reading an image'));
    if (!out) return null;
    return (await storeImage(app, { data: out.png, filename: `${input.filename}-${ref}.png` })).id;
  };

  const wantAi = input.ai !== false && aiEnabled(app);
  let page: Page | null = null;
  let report: string[] = [];

  // First choice, when AI is on: Claude looks at every page and designs the page. Whatever goes wrong, the rule-based
  // import below still produces a page.
  if (wantAi) {
    const designed = await designPageFromPdf(app, {
      data: input.data,
      filename: input.filename,
      extracted,
      palette,
      saveEmbedded: embedded,
      brand,
      savePicture: async (png, name) => (await storeImage(app, { data: png, filename: name })).id,
    }).catch((e): { ok: false; reason: string } => {
      app.log.warn('pdf design failed', { err: e });
      return { ok: false, reason: 'something went wrong' };
    });
    if (designed.ok) {
      page = designed.page;
      report = designed.report;
    } else {
      report.push(`Claude couldn’t design this page (${designed.reason}), so the standard import was used.`);
    }
  }

  if (!page) {
    const result = await importToPage(extracted, palette, { filename: input.filename, saveImage: (img) => embedded(img.ref) });
    report.push(...result.report);
    page = result.page as Page;
    // optional: let Claude tidy weak copy (never overrides text that already reads well)
    if (wantAi) {
      const polished = await polishImport(app, { page, filename: input.filename });
      page = polished.page;
      report.push(...polished.notes);
    }
  }

  if (brand) {
    page = applyBrand(page, brand);
    report.push(`Followed your brand “${brand.name}”: its colours${brand.logo?.src ? ', logo' : ''} and typefaces are on the page.`);
  }
  return { page, report };
}

/** The brand a new campaign records: the one it follows, "none" when that was chosen, nothing otherwise. */
const brandSetting = (brand: Brand | null, asked: string | undefined): { brand_id?: string } =>
  brand ? { brand_id: brand.id } : asked === NO_BRAND ? { brand_id: NO_BRAND } : {};

/** Upload a PDF → a campaign with a landing page built from it and the PDF ready to personalise. */
export async function importPdfCampaign(
  app: AppContext,
  input: { data: Buffer; filename: string; name?: string; ai?: boolean; brandId?: string },
): Promise<ImportOutcome> {
  const stored = await storePdf(app, input);
  /** The brand to follow: the one asked for, the default, or none (then the page keeps the PDF's own look). */
  const brand = chooseBrand(app, input.brandId);
  const { extracted, asset } = stored;
  const { page, report } = await buildPage(app, {
    data: input.data,
    filename: input.filename,
    extracted,
    rasters: stored.rasters,
    ai: input.ai,
    brand,
  });

  const headline = page.blocks.find((b) => b.type === 'hero');
  const title = headline?.type === 'hero' && headline.headline ? headline.headline : input.filename.replace(/\.pdf$/i, '');
  if (!stored.editable)
    report.push(
      'This PDF can’t be edited (it may use unusual encryption or structure), so each prospect gets the original file. The landing page is unaffected.',
    );

  const fields = stored.editable ? tokenFields(extracted, stored.rasters) : [];
  const document: DocumentConfig = {
    asset_id: asset.id,
    page_count: extracted.page_count,
    filename: `${safeName(title) || 'Document'} - {{company_short|for you}}.pdf`,
    fields,
  };

  const campaign = createCampaign(app, {
    name: (input.name?.trim() || title).slice(0, 120),
    page,
    document,
    settings: brandSetting(brand, input.brandId),
    source: { type: 'pdf', asset_id: asset.id, filename: input.filename, imported_at: Date.now(), report },
  });
  app.db.run('UPDATE assets SET campaign_id = ? WHERE id = ?', campaign.id, asset.id);
  return { campaign, report };
}

/**
 * Build the page again from a campaign's own PDF, with a brand (or none) and with or without Claude, as a copy. The
 * original keeps its page, its personalisation fields and its prospects; the copy has the same PDF fields on a fresh page.
 */
export async function redesignCampaign(
  app: AppContext,
  id: string,
  opts: { brandId?: string; ai?: boolean; name?: string },
): Promise<ImportOutcome> {
  const src = requireCampaign(app, id);
  if (!src.document) throw badRequest('This campaign has no PDF to build a new page from.');
  const asset = getAsset(app, src.document.asset_id);
  const data = asset ? await app.storage.get(asset.storage_key) : null;
  if (!asset || !data) throw notFound('The PDF');

  const filename = src.source?.filename ?? asset.filename;
  const { extracted, rasters } = await analysePdf(data);
  const brand = chooseBrand(app, opts.brandId);
  const { page, report } = await buildPage(app, { data, filename, extracted, rasters, ai: opts.ai, brand });

  const copy = createCampaign(app, {
    name: (opts.name?.trim() || `${src.name} (redesign)`).slice(0, 120),
    page,
    document: null,
    settings: { ...src.settings, brand_id: undefined, ...brandSetting(brand, opts.brandId) },
    source: { type: 'pdf', filename, imported_at: Date.now(), report },
  });
  const cloned = await cloneAsset(app, asset.id, copy.id);
  app.db.run('UPDATE campaigns SET source = ? WHERE id = ?', JSON.stringify({ ...copy.source, asset_id: cloned.id }), copy.id);
  const campaign = updateCampaign(app, copy.id, { document: { ...src.document, asset_id: cloned.id } });
  return { campaign, report };
}

/** Attach (or replace) the PDF of an existing campaign. Existing fields are dropped: page geometry may differ. */
export async function attachPdf(
  app: AppContext,
  campaignId: string,
  input: { data: Buffer; filename: string },
): Promise<{ campaign: Campaign; detected: number }> {
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
