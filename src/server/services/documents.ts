import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Campaign, DocumentConfig } from '@shared/schema';
import { renderTemplate, type Ctx } from '@shared/template';
import type { AppContext } from '../context';
import { notFound, unprocessable } from '../lib/errors';
import { probeImage, withinPixelBudget } from '../lib/image-probe';
import { safeRequest } from '../lib/safe-fetch';
import { renderPdf, resolveInstructions, type ImageLoader, type Instruction } from '../pdf/apply';
import { extractSinglePage, type PageInfo } from '../pdf/extract';
import { renderPageRaster, sampleRunColors } from '../pdf/raster';
import { pdfGate, withTimeout } from '../pdf/runtime';
import { getAsset, type AssetRow } from './assets';

// ── Source PDF ──────────────────────────────────────────────────────────────

const sourceCache = new Map<string, Buffer>();

export async function loadSource(app: AppContext, doc: DocumentConfig): Promise<{ bytes: Buffer; asset: AssetRow }> {
  const asset = getAsset(app, doc.asset_id);
  if (!asset || asset.kind !== 'pdf') throw notFound('Document');
  let bytes = sourceCache.get(asset.id);
  if (!bytes) {
    const data = await app.storage.get(asset.storage_key);
    if (!data) throw notFound('Document file');
    bytes = data;
    if (sourceCache.size >= 4) sourceCache.delete(sourceCache.keys().next().value as string);
    sourceCache.set(asset.id, bytes);
  }
  return { bytes, asset };
}

export function forgetSource(assetId: string) {
  sourceCache.delete(assetId);
}

// ── Images (prospect logos, uploaded pictures) ──────────────────────────────

const MAX_LOGO_PX = 1200;
const imageMemo = new Map<string, { at: number; img: Awaited<ReturnType<ImageLoader>> }>();

/** A decodable PNG/JPEG/GIF/WebP whose declared size is sane. Logo URLs come from prospect data, so nothing is trusted. */
function usableImage(b: Buffer): boolean {
  const probe = probeImage(b);
  return !!probe && withinPixelBudget(probe);
}

export function makeImageLoader(app: AppContext): ImageLoader {
  return async (src) => {
    const hit = imageMemo.get(src);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.img;
    let raw: Buffer | null = null;
    try {
      if (/^ast_[a-z0-9]+$/.test(src)) {
        const asset = getAsset(app, src);
        raw = asset && asset.kind === 'image' ? await app.storage.get(asset.storage_key) : null;
      } else {
        const res = await safeRequest(src, {
          maxBytes: 5 * 1024 * 1024,
          timeoutMs: 6000,
          allowPrivate: app.config.allowPrivateFetch,
          httpsOnly: !app.config.allowPrivateFetch,
          headers: { accept: 'image/png,image/jpeg,image/webp,image/gif' },
        });
        raw = res.status === 200 ? res.body : null;
      }
      if (!raw || !usableImage(raw)) return null;
      const img = await loadImage(raw);
      const scale = Math.min(1, MAX_LOGO_PX / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = createCanvas(w, h);
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const out = { png: new Uint8Array(canvas.toBuffer('image/png')), width: w, height: h };
      if (imageMemo.size > 64) imageMemo.delete(imageMemo.keys().next().value as string);
      imageMemo.set(src, { at: Date.now(), img: out });
      return out;
    } catch (e) {
      app.log.debug('image load failed', { src: src.slice(0, 80), err: (e as Error).message });
      return null;
    }
  };
}

// ── Personalised output ─────────────────────────────────────────────────────

export function documentFilename(doc: DocumentConfig, ctx: Ctx): string {
  const base = renderTemplate(doc.filename || '{{company|Document}}.pdf', ctx)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.pdf$/i, '')
    .slice(0, 120);
  return `${base || 'Document'}.pdf`;
}

const hashOf = (assetSha: string, instructions: Instruction[]) => createHash('sha256').update(assetSha).update(JSON.stringify(instructions)).digest('hex').slice(0, 24);

/** One in-flight build per output, so a burst of identical requests only renders once. */
const inflight = new Map<string, Promise<unknown>>();
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

const anonCache = new Map<string, { bytes: Uint8Array; warnings: string[] }>();

export interface BuiltPdf {
  bytes: Uint8Array;
  filename: string;
  warnings: string[];
  hash: string;
}

/**
 * Build (or fetch from cache) the personalised PDF. Output is content-addressed: the cache key is
 * derived from the source file plus what would actually be drawn, so editing a field or the
 * prospect's data produces a fresh file while unrelated changes reuse the old one.
 *
 * `owner` is the prospect id; anonymous (URL-parameter) renders are only cached in memory.
 */
export async function buildPdf(app: AppContext, campaign: Pick<Campaign, 'id' | 'document'>, ctx: Ctx, owner: string | null, docOverride?: DocumentConfig): Promise<BuiltPdf> {
  const doc = docOverride ?? campaign.document;
  if (!doc) throw notFound('Document');
  const { bytes: source, asset } = await loadSource(app, doc);
  const instructions = resolveInstructions(doc, ctx);
  const hash = hashOf(asset.sha256, instructions);
  const filename = documentFilename(doc, ctx);
  const key = owner ? `campaigns/${campaign.id}/generated/${owner}/${hash}.pdf` : null;

  if (key) {
    const cached = await app.storage.get(key);
    if (cached) return { bytes: cached, filename, warnings: [], hash };
  } else if (anonCache.has(hash)) return { ...anonCache.get(hash)!, filename, hash };

  return once(`pdf:${hash}`, async () => {
    const built = await pdfGate.run(() =>
      withTimeout(
        renderPdf({ bytes: source, instructions, loadImage: makeImageLoader(app), title: filename.replace(/\.pdf$/i, '') }),
        30_000,
        'Building the PDF',
      ),
    );
    if (key) {
      await app.storage.put(key, built.bytes);
      // keep one version per prospect
      const dir = `campaigns/${campaign.id}/generated/${owner}`;
      for (const f of await app.storage.list(dir)) if (!f.startsWith(hash)) await app.storage.delete(`${dir}/${f}`);
    } else {
      if (anonCache.size >= 20) anonCache.delete(anonCache.keys().next().value as string);
      anonCache.set(hash, built);
    }
    return { bytes: built.bytes, filename, warnings: built.warnings, hash };
  });
}

export async function personalizedPdf(app: AppContext, campaign: Campaign, ctx: Ctx, owner: string | null): Promise<{ bytes: Uint8Array; filename: string }> {
  const { bytes, filename } = await buildPdf(app, campaign, ctx, owner);
  return { bytes, filename };
}

const COVER_SCALE = 1.4;
/** Anonymous (URL-parameter) covers are kept in memory only, like anonymous PDFs. */
const anonCovers = new Map<string, Uint8Array>();

export async function personalizedCover(app: AppContext, campaign: Campaign, ctx: Ctx, owner: string | null): Promise<Uint8Array> {
  const built = await buildPdf(app, campaign, ctx, owner);
  const key = owner ? `campaigns/${campaign.id}/generated/${owner}/${built.hash}.cover.png` : null;
  if (key) {
    const cached = await app.storage.get(key);
    if (cached) return cached;
  } else {
    const cached = anonCovers.get(built.hash);
    if (cached) return cached;
  }
  return once(`cover:${built.hash}`, async () => {
    const r = await pdfGate.run(() => withTimeout(renderPageRaster(built.bytes, 1, COVER_SCALE), 20_000, 'Rendering the cover'));
    if (key) await app.storage.put(key, r.png);
    else {
      if (anonCovers.size >= 20) anonCovers.delete(anonCovers.keys().next().value as string);
      anonCovers.set(built.hash, r.png);
    }
    return r.png;
  });
}

/** A rendered page of the personalised PDF, for the studio's "preview as" view. */
export async function previewPage(app: AppContext, campaign: Campaign, doc: DocumentConfig, ctx: Ctx, pageNo: number, scale = 2): Promise<{ png: Buffer; warnings: string[] }> {
  if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > doc.page_count) throw unprocessable('That page doesn’t exist.');
  const built = await buildPdf(app, { id: campaign.id, document: doc }, ctx, null, doc);
  const r = await pdfGate.run(() => withTimeout(renderPageRaster(built.bytes, pageNo, scale), 20_000, 'Rendering the preview'));
  return { png: r.png, warnings: built.warnings };
}

// ── Studio: the original pages, their text runs, and sampled colours ─────────

export interface StudioPage extends PageInfo {
  scale: number;
}

export async function studioPage(app: AppContext, doc: DocumentConfig, pageNo: number): Promise<{ page: StudioPage; png: Buffer }> {
  if (pageNo < 1 || pageNo > doc.page_count) throw unprocessable('That page doesn’t exist.');
  const { bytes, asset } = await loadSource(app, doc);
  const dir = `doc/${asset.sha256.slice(0, 16)}`;
  const jsonKey = `${dir}/p${pageNo}.json`;
  const pngKey = `${dir}/p${pageNo}.png`;
  const [j, png] = await Promise.all([app.storage.get(jsonKey), app.storage.get(pngKey)]);
  if (j && png) return { page: JSON.parse(j.toString('utf8')) as StudioPage, png };

  return once(`studio:${asset.id}:${pageNo}`, async () => {
    const scale = 2;
    const [info, raster] = await pdfGate.run(() =>
      withTimeout(Promise.all([extractSinglePage(bytes, pageNo), renderPageRaster(bytes, pageNo, scale)]), 30_000, 'Reading the page'),
    );
    sampleRunColors(raster, info.runs);
    // very large pages are rendered at a smaller scale; the studio positions everything by this number
    const page: StudioPage = { ...info, scale: raster.scale };
    await Promise.all([app.storage.put(jsonKey, JSON.stringify(page)), app.storage.put(pngKey, raster.png)]);
    return { page, png: raster.png };
  });
}
