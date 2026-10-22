import { dropFurniture, buildLines } from './import';
import type { ExtractedDoc } from './extract';
import type { Figure, PageText, Source } from './design-plan';

/** Pages sent to the model as pictures. A long document gets its opening and its close; the rest goes as text only. */
export const MAX_PICTURE_PAGES = 14;
const HEAD_PAGES = 11;

export function choosePages(pageCount: number): number[] {
  const all = Array.from({ length: pageCount }, (_, i) => i + 1);
  if (pageCount <= MAX_PICTURE_PAGES) return all;
  return [...all.slice(0, HEAD_PAGES), ...all.slice(pageCount - (MAX_PICTURE_PAGES - HEAD_PAGES))];
}

/** How wide a page is drawn for the model, in pixels: enough to read body text, small enough to be cheap to look at. */
export const pictureWidth = (pageWidth: number, pageHeight: number): number => (pageWidth > pageHeight ? 1000 : 900);

/** The text of each page as the rule-based reader sees it, minus running headers, footers and page numbers. */
export function pageTexts(doc: ExtractedDoc): PageText[] {
  const { kept } = dropFurniture(buildLines(doc), doc.pages);
  return doc.pages.map((pg) => ({
    page: pg.page,
    width: pg.width,
    height: pg.height,
    lines: kept.filter((l) => l.page === pg.page).map((l) => ({ size: l.size, bold: l.bold, text: l.text })),
  }));
}

export interface FigureRef extends Figure {
  /** The id `extractImagePng` understands. */
  ref: string;
}

/** Pictures embedded in the PDF that are worth offering: not specks, and not a full-page background. */
export function figuresOf(doc: ExtractedDoc): FigureRef[] {
  const out: FigureRef[] = [];
  for (const pg of doc.pages) {
    const area = pg.width * pg.height;
    pg.images.forEach((img, i) => {
      const share = (img.w * img.h) / area;
      if (share < 0.03 || share > 0.85) return;
      const pct = (n: number, of: number) => Math.round((n / of) * 100);
      out.push({
        id: `P${pg.page}-I${i + 1}`,
        ref: img.ref,
        page: pg.page,
        left: pct(img.x, pg.width),
        top: pct(img.y, pg.height),
        width: pct(img.w, pg.width),
        height: pct(img.h, pg.height),
      });
    });
  }
  return out.slice(0, 30);
}

/** Merge fields found in the PDF, by name: "{{first_name|you}}" → "first_name". */
export const tokenNames = (doc: ExtractedDoc): string[] => [
  ...new Set(doc.tokens.map((t) => (t.token.replace(/^\{\{\s*|\s*\}\}$/g, '').split('|')[0] ?? '').trim()).filter(Boolean)),
];

/** Everything the PDF says, for checking a plan against: all lines, furniture included. */
export const sourceOf = (doc: ExtractedDoc): Source => ({
  text: buildLines(doc)
    .map((l) => l.text)
    .join('\n'),
  tokens: tokenNames(doc),
});
