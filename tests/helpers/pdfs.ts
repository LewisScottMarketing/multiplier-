import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** One piece of text on a page, placed by its top-left corner (y counts down from the top, like a screen). */
export interface Put {
  text: string;
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
  italic?: boolean;
}

export interface Sheet {
  width?: number;
  height?: number;
  items: Put[];
}

/** A small PDF with text exactly where the test says, so layout rules can be tried without a browser. */
export async function makePdf(pages: Sheet[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  for (const sheet of pages) {
    const h = sheet.height ?? 842;
    const page = doc.addPage([sheet.width ?? 595, h]);
    for (const it of sheet.items) {
      const size = it.size ?? 11;
      page.drawText(it.text, {
        x: it.x,
        y: h - it.y - size * 0.8,
        size,
        font: it.bold ? fonts.bold : it.italic ? fonts.italic : fonts.regular,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
  }
  return doc.save();
}

/** Lines of body text going down from `y`, one `Put` per string. */
export const para = (lines: string[], x: number, y: number, size = 11, gap = size * 1.45): Put[] =>
  lines.map((text, i) => ({ text, x, y: y + i * gap, size }));

/** The body copy of a normal document page: long enough that 11pt is clearly the body size. */
export const filler = (x: number, y: number, n = 6): Put[] =>
  para(
    Array.from({ length: n }, (_, i) => `Outbound teams rarely fail because of effort, line ${'abcdefghijklmnop'[i]} of the copy.`),
    x,
    y,
  );
