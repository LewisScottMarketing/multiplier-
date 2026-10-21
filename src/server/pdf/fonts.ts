import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import type { FontFamily } from './extract';

/**
 * Fonts for text we add to a PDF.
 *
 * Constraints learned the hard way:
 *  - Standard fonts (Helvetica/Times/Courier) only encode WinAnsi, so "Łukasz" would throw.
 *  - fontkit crashes the process when subsetting WOFF2, so only WOFF v1 / TTF are ever embedded.
 *
 * Strategy: each style is a CHAIN of faces. Text is split into runs at the first face that has
 * each glyph, so Latin, Latin-Extended, Cyrillic, Greek and Vietnamese names all just work.
 */

export interface FontStyle {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
}

export interface Face {
  font: PDFFont;
  has(codePoint: number): boolean;
}

const INTER_SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'greek', 'vietnamese'] as const;

let interDir: string | null | undefined;
function interFilesDir(): string | null {
  if (interDir !== undefined) return interDir;
  try {
    interDir = path.join(path.dirname(createRequire(import.meta.url).resolve('@fontsource/inter/package.json')), 'files');
  } catch {
    interDir = null;
  }
  return interDir;
}

const fileCache = new Map<string, Buffer>();
function readFont(file: string): Buffer | null {
  let b = fileCache.get(file);
  if (!b) {
    try {
      b = fs.readFileSync(file);
    } catch {
      return null;
    }
    fileCache.set(file, b);
  }
  return b;
}

const STD: Record<Exclude<FontFamily, 'inter'>, [string, string, string, string]> = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

export class FontBook {
  private chains = new Map<string, Promise<Face[]>>();
  private unsupported = new Set<string>();

  constructor(private doc: PDFDocument) {
    doc.registerFontkit(fontkit);
  }

  chain(style: FontStyle): Promise<Face[]> {
    const key = `${style.family}:${style.bold ? 'b' : ''}${style.italic ? 'i' : ''}`;
    let c = this.chains.get(key);
    if (!c) {
      c = this.build(style);
      this.chains.set(key, c);
    }
    return c;
  }

  private async build(style: FontStyle): Promise<Face[]> {
    const faces: Face[] = [];
    if (style.family !== 'inter') {
      const idx = (style.bold ? 1 : 0) + (style.italic ? 2 : 0);
      const font = await this.doc.embedFont(STD[style.family][idx]);
      const set = new Set(font.getCharacterSet());
      faces.push({ font, has: (cp) => set.has(cp) });
    }
    const dir = interFilesDir();
    if (dir) {
      for (const subset of INTER_SUBSETS) {
        const file = path.join(dir, `inter-${subset}-${style.bold ? 700 : 400}-${style.italic ? 'italic' : 'normal'}.woff`);
        const bytes = readFont(file);
        if (!bytes) continue;
        try {
          const font = await this.doc.embedFont(bytes, { subset: true });
          const set = new Set(font.getCharacterSet());
          faces.push({ font, has: (cp) => set.has(cp) });
        } catch {
          /* a broken subset must not take the whole PDF down */
        }
      }
    }
    if (faces.length === 0) {
      // last resort so we can always draw something
      const font = await this.doc.embedFont(StandardFonts.Helvetica);
      const set = new Set(font.getCharacterSet());
      faces.push({ font, has: (cp) => set.has(cp) });
    }
    return faces;
  }

  /** Characters no face could draw (reported back to the caller as a warning). */
  noteUnsupported(ch: string) {
    this.unsupported.add(ch);
  }
  get missingGlyphs(): string[] {
    return [...this.unsupported];
  }
}

export interface Segment {
  face: Face;
  text: string;
}

// zero-width / bidi marks, line separators and the BOM are built from code points so no invisible character lives in this file
const INVISIBLE = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0xfeff].map((c) => String.fromCharCode(c)).join('');
const CONTROL = new RegExp(`[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f${INVISIBLE}]`, 'g');

/** Split text into runs, each drawable by one face. Unknown glyphs become "?" (and are recorded). */
export function segment(text: string, chain: Face[], book?: FontBook): Segment[] {
  const out: Segment[] = [];
  const clean = text.replace(CONTROL, '').replaceAll(String.fromCharCode(0xa0), ' ').replace(/\t/g, ' ');
  for (const ch of clean) {
    const cp = ch.codePointAt(0)!;
    let face = chain.find((f) => f.has(cp));
    let c = ch;
    if (!face) {
      book?.noteUnsupported(ch);
      c = '?';
      face = chain.find((f) => f.has(63)) ?? chain[0];
    }
    const last = out[out.length - 1];
    if (last && last.face === face) last.text += c;
    else out.push({ face, text: c });
  }
  return out;
}

export const measure = (segs: Segment[], size: number): number => segs.reduce((w, s) => w + s.face.font.widthOfTextAtSize(s.text, size), 0);
