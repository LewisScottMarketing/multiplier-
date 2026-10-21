import { createRequire } from 'node:module';
import path from 'node:path';
import { badRequest, HttpError } from '../lib/errors';

/**
 * pdf.js loader + guard rails. PDFs arrive from the internet, so every operation is
 * concurrency-limited, time-boxed and page-capped.
 */

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let lib: Promise<PdfJs> | null = null;

export function pdfjs(): Promise<PdfJs> {
  lib ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return lib;
}

const root = () => path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

export const MAX_PAGES = 100;
/** Largest embedded image (in pixels) that is decoded; also the cap for rendered pages. */
export const MAX_PDF_IMAGE_PIXELS = 40_000_000;
/** PDF's own upper limit for a page edge is 14,400 points (200 inches). */
export const MAX_PAGE_POINTS = 14_400;

export class Semaphore {
  private waiting: Array<() => void> = [];
  private active = 0;
  /** `maxQueue` bounds how many callers may wait; beyond it they are turned away instead of piling up. */
  constructor(
    private max: number,
    private maxQueue = Infinity,
  ) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.maxQueue) throw new HttpError(503, 'busy', 'The server is busy building documents. Try again in a moment.');
      // a finishing job hands its slot straight to the next waiter, so `active` never dips and a
      // newcomer can't jump the queue between the two
      await new Promise<void>((r) => this.waiting.push(r));
    } else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
  get pending() {
    return this.waiting.length;
  }
}

/** One heavy PDF job at a time per CPU-ish slot keeps the event loop responsive for page views. */
export const pdfGate = new Semaphore(2, 40);

export function withTimeout<T>(p: Promise<T>, ms: number, what: string, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(new HttpError(504, 'pdf_timeout', `${what} took too long`));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export type PdfDoc = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

export async function openPdf(bytes: Uint8Array): Promise<{ doc: PdfDoc; close: () => Promise<void> }> {
  const js = await pdfjs();
  const dir = root();
  const task = js.getDocument({
    // pdf.js transfers the buffer to its worker; hand it a copy so callers keep theirs
    data: new Uint8Array(bytes),
    standardFontDataUrl: path.join(dir, 'standard_fonts') + '/',
    cMapUrl: path.join(dir, 'cmaps') + '/',
    cMapPacked: true,
    fontExtraProperties: true,
    useSystemFonts: false,
    // skip embedded images that declare an absurd size instead of allocating for them
    maxImageSize: MAX_PDF_IMAGE_PIXELS,
    verbosity: 0,
  });
  let doc: PdfDoc;
  try {
    doc = await withTimeout(task.promise, 20_000, 'Opening the PDF', () => void task.destroy());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') throw badRequest('That PDF is password-protected. Remove the password and upload it again.');
    throw badRequest('That file could not be read as a PDF. It may be damaged.');
  }
  if (doc.numPages > MAX_PAGES) {
    await task.destroy();
    throw badRequest(`PDFs can have up to ${MAX_PAGES} pages (this one has ${doc.numPages}).`);
  }
  return { doc, close: async () => void (await task.destroy()) };
}

export const isPdf = (b: Uint8Array): boolean => b.length > 8 && Buffer.from(b.subarray(0, 1024)).includes('%PDF-');

/** Parse "#rrggbb" into 0-255 channels. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
