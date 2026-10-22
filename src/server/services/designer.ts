import type { Page } from '@shared/schema';
import { STYLE_PRESETS } from '@shared/presets';
import type { AppContext } from '../context';
import { choosePages, figuresOf, pageTexts, pictureWidth, sourceOf, tokenNames } from '../pdf/design-input';
import {
  assemblePage,
  buildDesignPrompt,
  DESIGN_SCHEMA,
  DESIGN_SYSTEM,
  PlanRejected,
  readPlan,
  type DesignPlan,
  type PlanImage,
} from '../pdf/design-plan';
import type { ExtractedDoc } from '../pdf/extract';
import { lookFor } from '../pdf/import';
import { cropRaster, renderPageRaster, rasterToJpeg, type Palette } from '../pdf/raster';
import { pdfGate, withTimeout } from '../pdf/runtime';
import { aiEnabled, callAi, type AiImage } from './ai';

/**
 * Design a landing page from a PDF with Claude: it looks at every page and reads the extracted text, and answers with a
 * plan (see pdf/design-plan.ts), which is checked against the document before anything is built from it. When any step
 * fails the caller uses the rule-based import, so this never leaves someone without a page.
 */

export interface DesignRequest {
  data: Buffer;
  filename: string;
  extracted: ExtractedDoc;
  palette: Palette;
  /** Stores a picture embedded in the PDF (by its ref) and returns its asset id. */
  saveEmbedded(ref: string): Promise<string | null>;
  /** Stores a PNG made from the PDF (a region of a page) and returns its asset id. */
  savePicture(png: Buffer, name: string): Promise<string | null>;
}

export type DesignOutcome = { ok: true; page: Page; report: string[] } | { ok: false; reason: string };

const fail = (reason: string): DesignOutcome => ({ ok: false, reason });

/** Long enough for a big document and a thoughtful answer; short enough that someone waiting isn't left wondering. */
const DESIGN_TIMEOUT_MS = 150_000;

async function pagePictures(req: DesignRequest, pages: number[]): Promise<Array<{ page: number; image: AiImage }>> {
  const out: Array<{ page: number; image: AiImage }> = [];
  for (const n of pages) {
    const info = req.extracted.pages[n - 1];
    if (!info) continue;
    const scale = pictureWidth(info.width, info.height) / info.width;
    try {
      const raster = await renderPageRaster(req.data, n, scale);
      out.push({
        page: n,
        image: { media_type: 'image/jpeg', data: (await rasterToJpeg(raster)).toString('base64'), label: `Page ${n}:` },
      });
    } catch {
      // a page that won't draw is simply not shown; its text is still sent
    }
  }
  return out;
}

/** Makes the pictures the plan asked for, at most four, once each. Keyed by the pick itself. */
async function makePictures(plan: DesignPlan, req: DesignRequest, figures: Map<string, string>): Promise<Map<PlanImage, string>> {
  const picks = [plan.hero.image, ...plan.blocks.map((b) => b.image)].filter((p): p is PlanImage => !!p);
  const made = new Map<PlanImage, string>();
  const byKey = new Map<string, string | null>();
  for (const pick of picks) {
    if (byKey.size >= 4 && !byKey.has(keyOf(pick))) continue;
    const key = keyOf(pick);
    if (!byKey.has(key)) {
      let id: string | null = null;
      try {
        if (pick.ref && figures.has(pick.ref)) id = await req.saveEmbedded(figures.get(pick.ref)!);
        else if (pick.page && pick.box && req.extracted.pages[pick.page - 1]) {
          id = await pdfGate.run(() =>
            withTimeout(
              (async () => {
                const raster = await renderPageRaster(req.data, pick.page!, 2);
                const png = await cropRaster(raster, pick.box!);
                return png ? req.savePicture(png, `${req.filename}-p${pick.page}-crop.png`) : null;
              })(),
              20_000,
              'Cutting out a picture',
            ),
          );
        }
      } catch {
        id = null;
      }
      byKey.set(key, id);
    }
    const id = byKey.get(key);
    if (id) made.set(pick, id);
  }
  return made;
}

const keyOf = (p: PlanImage) => (p.ref ? `ref:${p.ref}` : `box:${p.page}:${p.box?.join(',')}`);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function designPageFromPdf(app: AppContext, req: DesignRequest): Promise<DesignOutcome> {
  if (!aiEnabled(app)) return fail('AI isn’t switched on');
  const { extracted, palette } = req;

  const pages = choosePages(extracted.page_count);
  const shown = await pdfGate.run(() => withTimeout(pagePictures(req, pages), 90_000, 'Drawing the pages'));
  if (!shown.length) return fail('the pages could not be drawn');
  const images = shown.map((p) => p.image);

  const figureRefs = figuresOf(extracted);
  const prompt = buildDesignPrompt({
    filename: req.filename,
    pageCount: extracted.page_count,
    imagePages: shown.map((p) => p.page),
    pages: pageTexts(extracted),
    figures: figureRefs,
    palette,
    tokens: tokenNames(extracted),
  });

  const res = await callAi(app, {
    tier: 'smart',
    label: 'pdf-design',
    system: DESIGN_SYSTEM,
    user: prompt,
    images,
    schema: DESIGN_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 16_000,
    effort: 'medium',
    timeoutMs: Math.max(app.config.aiTimeoutMs, DESIGN_TIMEOUT_MS),
    interactive: true,
  });
  if (!res.ok) return fail(res.message.replace(/\.$/, ''));

  const plan = readPlan(res.data);
  if (!plan) return fail('its reply wasn’t a page plan');

  const figures = new Map(figureRefs.map((f) => [f.id, f.ref]));
  const made = await makePictures(plan, req, figures);
  try {
    const out = assemblePage(plan, {
      source: sourceOf(extracted),
      palette,
      imageFor: (pick) => (pick ? (made.get(pick) ?? null) : null),
      fallbackStyle: lookFor([], palette),
      fallbackLogo: extracted.meta.author,
    });
    const kinds = [...new Set(out.page.blocks.map((b) => b.type))].filter((t) => !['hero', 'form'].includes(t));
    const report = [
      `Claude read ${plural(images.length, 'page')}${images.length < extracted.page_count ? ` of ${extracted.page_count}` : ''} and designed the page: ${plural(out.page.blocks.length - 2, 'block')} (${kinds.join(', ')}).`,
      `Styled “${STYLE_PRESETS.find((p) => p.id === plan.style)?.name ?? 'Clean'}”. Try the other styles in Design.`,
      ...out.notes.map((n) => `Claude: ${n}`),
    ];
    if (out.dropped.length) report.push(`Left out ${out.dropped.join('; ')}.`);
    return { ok: true, page: out.page, report };
  } catch (e) {
    if (e instanceof PlanRejected) return fail(e.message);
    throw e;
  }
}
