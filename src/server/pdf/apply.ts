import { PDFArray, PDFDocument, PDFName, PDFString, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { evalRule } from '@shared/conditions';
import type { DocumentConfig, PdfField, Rect } from '@shared/schema';
import { renderTemplate, renderUrl, safeUrl, type Ctx } from '@shared/template';
import { FontBook, measure, segment, type Face, type FontStyle } from './fonts';
import { hexToRgb } from './runtime';

/**
 * Applying personalisation to an existing PDF, in two steps:
 *
 *   resolveInstructions()  pure: fields + prospect data → a flat list of "draw this here"
 *                          (also the cache key, so a PDF is only rebuilt when its content changes)
 *   renderPdf()            pdf-lib: paints the instructions onto the original pages
 *
 * Geometry is in points with the origin at the TOP-left of the displayed page (as in the editor).
 */

type FontFam = FontStyle['family'];

export interface MaskInst {
  color: string;
  rect: Rect;
}

export type Instruction =
  | {
      kind: 'text';
      page: number;
      rect: Rect;
      text: string;
      style: FontStyle;
      size: number;
      color: string;
      align: 'left' | 'center' | 'right';
      valign: 'top' | 'middle' | 'bottom';
      fit: 'shrink' | 'wrap' | 'none';
      lineHeight: number;
      mask: MaskInst | null;
    }
  | { kind: 'image'; page: number; rect: Rect; src: string; fit: 'contain' | 'cover'; mask: MaskInst | null }
  | { kind: 'qr'; page: number; rect: Rect; text: string; color: string; background: string | null }
  | { kind: 'link'; page: number; rect: Rect; url: string };

const padded = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 });

function maskOf(field: Extract<PdfField, { type: 'text' | 'image' }>): MaskInst | null {
  return field.mask ? { color: field.mask.color, rect: padded(field.mask.rect ?? field.rect, field.mask.pad) } : null;
}

export function resolveInstructions(doc: DocumentConfig, ctx: Ctx): Instruction[] {
  const out: Instruction[] = [];
  for (const f of doc.fields) {
    if (!evalRule(f.rule, ctx)) continue;
    switch (f.type) {
      case 'text': {
        const text = renderTemplate(f.text, ctx)
          .split(/\r?\n/)
          .map((l) => l.replace(/[ \t]+/g, ' ').trim())
          .join('\n')
          .trim();
        const mask = maskOf(f);
        if (!text && !mask) break;
        out.push({
          kind: 'text',
          page: f.page,
          rect: f.rect,
          text,
          style: { family: (f.font.family === 'auto' ? 'inter' : f.font.family) as FontFam, bold: f.font.bold, italic: f.font.italic },
          size: f.size,
          color: f.color,
          align: f.align,
          valign: f.valign,
          fit: f.fit,
          lineHeight: f.line_height,
          mask,
        });
        break;
      }
      case 'image': {
        const raw = f.src.trim();
        const src = /^ast_[a-z0-9]+$/.test(raw) ? raw : renderUrl(raw, ctx);
        const mask = maskOf(f);
        if (!src && !mask) break;
        out.push({ kind: 'image', page: f.page, rect: f.rect, src, fit: f.fit, mask });
        break;
      }
      case 'qr': {
        const text = renderUrl(f.url, ctx);
        if (text) out.push({ kind: 'qr', page: f.page, rect: f.rect, text, color: f.color, background: f.background });
        break;
      }
      case 'link': {
        const url = renderUrl(f.url, ctx);
        if (url) out.push({ kind: 'link', page: f.page, rect: f.rect, url });
        break;
      }
    }
  }
  return out;
}

// ── Rendering ───────────────────────────────────────────────────────────────

export interface LoadedImage {
  png: Uint8Array;
  width: number;
  height: number;
}
export type ImageLoader = (src: string) => Promise<LoadedImage | null>;

export interface RenderResult {
  bytes: Uint8Array;
  warnings: string[];
}

const ASCENT = 0.86;

const color = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  return rgb(r / 255, g / 255, b / 255);
};

/** Cut `text` down until it fits `maxW`, ending in an ellipsis. With `force`, the ellipsis is added even when it already fits. */
function ellipsize(text: string, chain: Face[], size: number, maxW: number, book: FontBook, force = false): string {
  const fits = (t: string) => measure(segment(t, chain, book), size) <= maxW;
  if (!force && fits(text)) return text;
  const chars = Array.from(text.trimEnd());
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(chars.slice(0, mid).join('').trimEnd() + '…')) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? chars.slice(0, lo).join('').trimEnd() + '…' : '…';
}

function wrapText(text: string, chain: Face[], size: number, maxW: number, book: FontBook): string[] {
  const lines: string[] = [];
  const width = (s: string) => measure(segment(s, chain, book), size);
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ').filter(Boolean)) {
      const attempt = line ? `${line} ${word}` : word;
      if (width(attempt) <= maxW || !line) {
        if (!line && width(word) > maxW) {
          // a single word wider than the box: break it by characters
          let chunk = '';
          for (const ch of Array.from(word)) {
            if (width(chunk + ch) > maxW && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = attempt;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderPdf(input: { bytes: Uint8Array; instructions: Instruction[]; loadImage: ImageLoader; title?: string }): Promise<RenderResult> {
  const warnings: string[] = [];
  const pdf = await PDFDocument.load(input.bytes, { updateMetadata: false });
  const book = new FontBook(pdf);
  const pages = pdf.getPages();
  const imageCache = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>> | null>();

  const byPage = new Map<number, Instruction[]>();
  for (const i of input.instructions) {
    if (!byPage.has(i.page)) byPage.set(i.page, []);
    byPage.get(i.page)!.push(i);
  }

  for (const [pageNo, list] of byPage) {
    const page = pages[pageNo - 1];
    if (!page) {
      warnings.push(`Page ${pageNo} no longer exists in the PDF, so ${list.length} field(s) were skipped.`);
      continue;
    }
    if (page.getRotation().angle % 360 !== 0) {
      warnings.push(`Page ${pageNo} is rotated; personalisation on rotated pages isn’t supported yet.`);
      continue;
    }
    const box = page.getCropBox();
    const toPdf = (r: Rect) => ({ x: box.x + r.x, y: box.y + box.height - r.y - r.h, w: r.w, h: r.h });

    // 1) masks first, so nothing we draw is ever painted over by a neighbour's cover-up
    for (const inst of list) {
      if ((inst.kind === 'text' || inst.kind === 'image') && inst.mask) {
        const m = toPdf(inst.mask.rect);
        page.drawRectangle({ x: m.x, y: m.y, width: m.w, height: m.h, color: color(inst.mask.color), borderWidth: 0 });
      }
    }

    // 2) content
    for (const inst of list) {
      try {
        if (inst.kind === 'text') await drawText(page, book, inst, box);
        else if (inst.kind === 'image') await drawImage(pdf, page, inst, box, input.loadImage, imageCache, warnings);
        else if (inst.kind === 'qr') drawQr(page, inst, box, warnings);
        else addLink(pdf, page, inst, box);
      } catch (e) {
        warnings.push(`Could not draw a ${inst.kind} on page ${pageNo}: ${(e as Error).message}`);
      }
    }
  }

  if (book.missingGlyphs.length) warnings.push(`These characters aren’t available in the font and were replaced with “?”: ${book.missingGlyphs.join(' ')}`);
  if (input.title) pdf.setTitle(input.title);
  pdf.setProducer('Multiplier');
  pdf.setModificationDate(new Date());
  return { bytes: await pdf.save({ useObjectStreams: true }), warnings };
}

type Box = { x: number; y: number; width: number; height: number };

async function drawText(page: PDFPage, book: FontBook, inst: Extract<Instruction, { kind: 'text' }>, box: Box) {
  if (!inst.text) return;
  const chain = await book.chain(inst.style);
  const { rect } = inst;
  const base = inst.size;
  let size = base;
  let lines: string[];

  if (inst.fit === 'wrap') {
    lines = [];
    for (let k = 0; k <= 8; k++) {
      size = base * (1 - 0.05 * k);
      lines = wrapText(inst.text, chain, size, rect.w, book);
      if (size + (lines.length - 1) * size * inst.lineHeight <= rect.h || k === 8) break;
    }
    const max = Math.max(1, Math.floor((rect.h - size) / (size * inst.lineHeight)) + 1);
    if (lines.length > max) {
      lines = lines.slice(0, max);
      lines[max - 1] = ellipsize(lines[max - 1], chain, size, rect.w, book, true);
    }
  } else {
    let line = inst.text.replace(/\n+/g, ' ');
    if (inst.fit === 'shrink' && rect.w > 0) {
      const w = measure(segment(line, chain, book), base);
      if (w > rect.w) {
        size = Math.max(base * 0.55, (base * rect.w) / w);
        line = ellipsize(line, chain, size, rect.w, book);
      }
    }
    lines = [line];
  }

  const blockH = size + (lines.length - 1) * size * inst.lineHeight;
  let firstBaseline: number;
  if (lines.length === 1 && inst.valign === 'top') firstBaseline = rect.y + ASCENT * base; // stay on the original baseline when shrinking
  else if (inst.valign === 'top') firstBaseline = rect.y + ASCENT * size;
  else if (inst.valign === 'middle') firstBaseline = rect.y + (rect.h - blockH) / 2 + ASCENT * size;
  else firstBaseline = rect.y + rect.h - blockH + ASCENT * size - 0.1 * size;

  const fill = color(inst.color);
  lines.forEach((line, i) => {
    const segs = segment(line, chain, book);
    const w = measure(segs, size);
    let x = rect.x;
    if (inst.align === 'center') x = rect.x + (rect.w - w) / 2;
    else if (inst.align === 'right') x = rect.x + rect.w - w;
    const y = box.y + box.height - (firstBaseline + i * size * inst.lineHeight);
    let cx = box.x + x;
    for (const s of segs) {
      page.drawText(s.text, { x: cx, y, size, font: s.face.font, color: fill });
      cx += s.face.font.widthOfTextAtSize(s.text, size);
    }
  });
}

async function drawImage(
  pdf: PDFDocument,
  page: PDFPage,
  inst: Extract<Instruction, { kind: 'image' }>,
  box: Box,
  load: ImageLoader,
  cache: Map<string, Awaited<ReturnType<PDFDocument['embedPng']>> | null>,
  warnings: string[],
) {
  if (!inst.src) return;
  let img = cache.get(inst.src);
  if (img === undefined) {
    const loaded = await load(inst.src);
    img = loaded ? await pdf.embedPng(loaded.png) : null;
    cache.set(inst.src, img);
    if (!loaded) warnings.push('An image could not be loaded and was left out.');
  }
  if (!img) return;
  const { rect } = inst;
  const scale = inst.fit === 'cover' ? Math.max(rect.w / img.width, rect.h / img.height) : Math.min(rect.w / img.width, rect.h / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = box.x + rect.x + (rect.w - w) / 2;
  const y = box.y + box.height - rect.y - rect.h + (rect.h - h) / 2;
  if (inst.fit === 'cover') {
    page.pushOperators(pushGraphicsState(), rectangle(box.x + rect.x, box.y + box.height - rect.y - rect.h, rect.w, rect.h), clip(), endPath());
    page.drawImage(img, { x, y, width: w, height: h });
    page.pushOperators(popGraphicsState());
  } else page.drawImage(img, { x, y, width: w, height: h });
}

function drawQr(page: PDFPage, inst: Extract<Instruction, { kind: 'qr' }>, box: Box, warnings: string[]) {
  if (inst.text.length > 900) {
    warnings.push('A QR code was skipped because its link is too long.');
    return;
  }
  const qr = QRCode.create(inst.text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2;
  const side = Math.min(inst.rect.w, inst.rect.h);
  const cell = side / (n + quiet * 2);
  const left = box.x + inst.rect.x + (inst.rect.w - side) / 2;
  const top = box.y + box.height - inst.rect.y - (inst.rect.h - side) / 2; // PDF y of the square's top edge
  if (inst.background) page.drawRectangle({ x: left, y: top - side, width: side, height: side, color: color(inst.background), borderWidth: 0 });
  const fill = color(inst.color);
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!qr.modules.get(row, col)) {
        col++;
        continue;
      }
      let end = col;
      while (end < n && qr.modules.get(row, end)) end++;
      page.drawRectangle({ x: left + (col + quiet) * cell, y: top - (row + quiet + 1) * cell, width: (end - col) * cell + 0.2, height: cell + 0.2, color: fill, borderWidth: 0 });
      col = end;
    }
  }
}

function addLink(pdf: PDFDocument, page: PDFPage, inst: Extract<Instruction, { kind: 'link' }>, box: Box) {
  const url = safeUrl(inst.url);
  if (!url || !/^(https?:|mailto:|tel:)/i.test(url)) return;
  const x1 = box.x + inst.rect.x;
  const y2 = box.y + box.height - inst.rect.y;
  const annot = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x1, y2 - inst.rect.h, x1 + inst.rect.w, y2],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(asciiUrl(url)) },
  });
  const ref = pdf.context.register(annot);
  const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (existing) existing.push(ref);
  else page.node.set(PDFName.of('Annots'), pdf.context.obj([ref]));
}

/** PDF URI strings must be 7-bit ASCII: percent-encode anything else. */
function asciiUrl(u: string): string {
  try {
    return encodeURI(decodeURI(u));
  } catch {
    return u.replace(/[^\x21-\x7e]/g, '');
  }
}
