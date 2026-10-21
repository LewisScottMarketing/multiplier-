import { openPdf, pdfjs, type PdfDoc } from './runtime';

/**
 * Text, image and link extraction. All coordinates are PDF points with the origin at the TOP-left
 * of the page *as displayed* (pdf.js's viewport already accounts for page rotation and crop boxes).
 */

export type FontFamily = 'inter' | 'helvetica' | 'serif' | 'mono';

export interface Run {
  id: string;
  page: number;
  text: string;
  /** Left edge. */
  x: number;
  /** Top of the text box (baseline − ascent). */
  y: number;
  w: number;
  h: number;
  size: number;
  /** y of the baseline. */
  baseline: number;
  font: string;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  /** Filled in by sampling the rendered page (see raster.ts). */
  color?: string;
  bg?: string;
}

export interface PageImage {
  /** `${page}:${ordinal}` — pass to `extractImagePng`. */
  ref: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageLink {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageInfo {
  page: number;
  width: number;
  height: number;
  runs: Run[];
  images: PageImage[];
  links: PageLink[];
}

export interface DetectedToken {
  token: string;
  page: number;
  run: string;
}

export interface ExtractedDoc {
  page_count: number;
  pages: PageInfo[];
  tokens: DetectedToken[];
  meta: { title?: string; author?: string };
}

const ASCENT = 0.86;
const BOX = 1.18;

export function familyOf(fontName: string): FontFamily {
  const n = fontName.replace(/^[A-Z]{6}\+/, '').toLowerCase();
  if (/courier|mono|consolas|menlo|monaco|code|typewriter/.test(n)) return 'mono';
  if (/helvetica|arial|liberation ?sans|arimo|nimbus ?sans|swiss/.test(n)) return 'helvetica';
  if (/times|georgia|garamond|palatino|cambria|book ?antiqua|minion|baskerville|didot|caslon|bodoni|merriweather|playfair|lora|serif(?!.*sans)|tinos|liberation ?serif|charter/.test(n) && !/sans/.test(n)) return 'serif';
  return 'inter';
}

const isBold = (n: string) => /bold|black|heavy|extrabold|semibold|demi|ultra/i.test(n.replace(/^[A-Z]{6}\+/, ''));
const isItalic = (n: string) => /italic|oblique|slanted/i.test(n.replace(/^[A-Z]{6}\+/, ''));

/** "A C M E" → "ACME" (letter-spaced headings come out of PDFs with a space between every glyph). */
export function detrack(text: string): string {
  const words = text.split(/ {2,}/);
  const tracked = words.every((w) => w.length <= 1 || /^(?:\S )+\S$/u.test(w)) && words.some((w) => w.length >= 5);
  return tracked ? words.map((w) => w.replace(/ /g, '')).join(' ') : text;
}

interface RawItem {
  str: string;
  x: number;
  baseline: number;
  w: number;
  size: number;
  font: string;
  fontName: string;
}

/** Merge neighbouring items of the same font on the same baseline into runs. */
function buildRuns(items: RawItem[], page: number): Run[] {
  const runs: Array<RawItem & { str: string }> = [];
  let cur: (RawItem & { str: string }) | null = null;
  for (const it of items) {
    if (!it.str.trim()) {
      // a lone space between two items on one line
      if (cur && Math.abs(it.baseline - cur.baseline) < cur.size * 0.3 && !cur.str.endsWith(' ')) cur.str += ' ';
      continue;
    }
    const text = detrackItem(it.str);
    if (cur) {
      const gap = it.x - (cur.x + cur.w);
      const sameLine = Math.abs(it.baseline - cur.baseline) < cur.size * 0.3;
      const sameStyle = it.fontName === cur.fontName && Math.abs(it.size - cur.size) < 0.6;
      if (sameLine && sameStyle && gap > -cur.size * 0.4 && gap < cur.size * 1.6) {
        const sep = cur.str.endsWith(' ') || text.startsWith(' ') ? '' : gap < cur.size * 0.12 ? '' : gap < cur.size * 0.55 ? ' ' : '  ';
        cur.str += sep + text;
        cur.w = it.x + it.w - cur.x;
        continue;
      }
    }
    cur = { ...it, str: text };
    runs.push(cur);
  }
  return runs
    .map((r, i): Run | null => {
      const text = detrack(r.str).replace(/\s+/g, ' ').trim();
      if (!text) return null;
      const n = r.fontName;
      return {
        id: `r${page}_${i}`,
        page,
        text,
        x: r.x,
        y: r.baseline - ASCENT * r.size,
        w: Math.max(r.w, 1),
        h: BOX * r.size,
        size: r.size,
        baseline: r.baseline,
        font: n.replace(/^[A-Z]{6}\+/, ''),
        family: familyOf(n),
        bold: isBold(n),
        italic: isItalic(n),
      };
    })
    .filter((r): r is Run => r !== null)
    .map((r, i) => ({ ...r, id: `r${page}_${i}` }));
}

/**
 * pdf.js (like several other extractors) sometimes reports typographic quotes as the look-alike
 * modifier letters U+02BC / U+02EE when a font maps several code points to one glyph.
 */
const fixChars = (s: string): string => s.replace(/\u02bc/g, '\u2019').replace(/\u02ee/g, '\u201d').replace(/\u02bb/g, '\u2018');

function detrackItem(s: string): string {
  const t = fixChars(s);
  return /^(?:\S ){3,}\S$/u.test(t) ? t.replace(/ /g, '') : t;
}

const TOKEN_RE = /\{\{[^{}]{1,80}\}\}/g;

type RawText = { items: Array<{ str?: string; transform?: number[]; width?: number; fontName?: string }>; styles: Record<string, unknown> };

async function extractPage(doc: PdfDoc, pageNo: number): Promise<{ info: PageInfo; fontNames: Map<string, string> }> {
  const js = await pdfjs();
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale: 1 });
  const text = (await page.getTextContent()) as unknown as RawText;

  // loadedName → real font name needs the font objects, which load with the operator list
  const ops = await page.getOperatorList();
  const fontNames = new Map<string, string>();
  const commonObjs = page.commonObjs as unknown as { has(id: string): boolean; get(id: string): { name?: string } | null };
  for (const it of text.items) {
    const id = it.fontName;
    if (!id || fontNames.has(id)) continue;
    try {
      fontNames.set(id, (commonObjs.has(id) && commonObjs.get(id)?.name) || id);
    } catch {
      fontNames.set(id, id);
    }
  }

  const raw: RawItem[] = [];
  for (const it of text.items) {
    if (typeof it.str !== 'string' || !it.transform) continue;
    const t = js.Util.transform(viewport.transform, it.transform) as number[];
    const size = Math.hypot(t[0], t[1]);
    if (size < 1 || Math.abs(t[1]) > size * 0.035 || t[0] < 0) continue; // rotated or mirrored text isn't editable
    raw.push({
      str: it.str,
      x: t[4],
      baseline: t[5],
      w: (it.width ?? 0) * viewport.scale,
      size,
      font: it.fontName ?? '',
      fontName: fontNames.get(it.fontName ?? '') ?? it.fontName ?? '',
    });
  }

  // images with placement (CTM tracking over the operator list)
  const images: PageImage[] = [];
  const { OPS } = js;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const mul = (m: number[], n: number[]) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  let ordinal = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(args as number[], ctm);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const t = js.Util.transform(viewport.transform, ctm) as number[];
      const w = Math.hypot(t[0], t[1]);
      const h = Math.hypot(t[2], t[3]);
      // unit square → placed rectangle: top-left is (e, f + d) for upright images
      const x = Math.min(t[4], t[4] + t[0] + t[2]);
      const y = Math.min(t[5], t[5] + t[1] + t[3]);
      images.push({ ref: `${pageNo}:${ordinal++}`, page: pageNo, x, y, w, h, });
    }
  }

  const links: PageLink[] = [];
  try {
    for (const a of (await page.getAnnotations()) as Array<{ subtype?: string; url?: string; unsafeUrl?: string; rect?: number[] }>) {
      const url = a.url ?? a.unsafeUrl;
      if (a.subtype === 'Link' && url && a.rect && /^(https?:|mailto:)/i.test(url)) {
        const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]);
        const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]);
        links.push({ url, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
      }
    }
  } catch {
    /* annotations are best-effort */
  }

  page.cleanup();
  return {
    info: { page: pageNo, width: viewport.width, height: viewport.height, runs: buildRuns(raw, pageNo), images, links },
    fontNames,
  };
}

/** Fast pass over every page: text runs, image placements, links. No rasterisation. */
export async function extractDocument(bytes: Uint8Array): Promise<ExtractedDoc> {
  const { doc, close } = await openPdf(bytes);
  try {
    const pages: PageInfo[] = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push((await extractPage(doc, p)).info);
    const tokens: DetectedToken[] = [];
    for (const pg of pages) for (const r of pg.runs) for (const m of r.text.matchAll(TOKEN_RE)) tokens.push({ token: m[0], page: pg.page, run: r.id });
    const meta = (await doc.getMetadata().catch(() => null)) as { info?: { Title?: string; Author?: string } } | null;
    return {
      page_count: doc.numPages,
      pages,
      tokens,
      meta: { title: meta?.info?.Title?.trim() || undefined, author: meta?.info?.Author?.trim() || undefined },
    };
  } finally {
    await close();
  }
}

export async function extractSinglePage(bytes: Uint8Array, pageNo: number): Promise<PageInfo> {
  const { doc, close } = await openPdf(bytes);
  try {
    if (pageNo < 1 || pageNo > doc.numPages) throw new RangeError('No such page');
    return (await extractPage(doc, pageNo)).info;
  } finally {
    await close();
  }
}

/** Decode one embedded image to PNG (RGBA), as found by `extractDocument`. */
export async function extractImagePng(bytes: Uint8Array, ref: string): Promise<{ png: Buffer; width: number; height: number } | null> {
  const [pageStr, ordStr] = ref.split(':');
  const pageNo = Number(pageStr);
  const target = Number(ordStr);
  const js = await pdfjs();
  const { createCanvas, ImageData } = await import('@napi-rs/canvas');
  const { doc, close } = await openPdf(bytes);
  try {
    const page = await doc.getPage(pageNo);
    const ops = await page.getOperatorList();
    let ordinal = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn !== js.OPS.paintImageXObject && fn !== js.OPS.paintInlineImageXObject) continue;
      if (ordinal++ !== target) continue;
      const args = ops.argsArray[i] as unknown[];
      type Img = { width: number; height: number; data?: Uint8Array | Uint8ClampedArray; kind?: number } | null;
      const img: Img =
        fn === js.OPS.paintImageXObject
          ? await new Promise<Img>((res) => (page.objs as unknown as { get(id: string, cb: (v: Img) => void): void }).get(args[0] as string, res))
          : (args[0] as Img);
      if (!img?.data || !img.width || !img.height) return null;
      const rgba = new Uint8ClampedArray(img.width * img.height * 4);
      const kind = img.kind ?? 2;
      if (kind === 3) rgba.set(img.data); // RGBA_32BPP
      else if (kind === 2) for (let p = 0, q = 0; p < img.data.length; p += 3, q += 4) { rgba[q] = img.data[p]; rgba[q + 1] = img.data[p + 1]; rgba[q + 2] = img.data[p + 2]; rgba[q + 3] = 255; }
      else if (kind === 1) for (let p = 0, q = 0; p < img.width * img.height; p++, q += 4) { const on = (img.data[p >> 3] >> (7 - (p & 7))) & 1 ? 255 : 0; rgba[q] = rgba[q + 1] = rgba[q + 2] = on; rgba[q + 3] = 255; }
      else return null;
      const canvas = createCanvas(img.width, img.height);
      canvas.getContext('2d').putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
      return { png: canvas.toBuffer('image/png'), width: img.width, height: img.height };
    }
    return null;
  } finally {
    await close();
  }
}
