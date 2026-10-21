/**
 * Reads an image's format and pixel size from its header, without decoding it.
 *
 * Decoding is where image bombs bite: a few kilobytes of PNG can declare 60,000 × 60,000 pixels and
 * make the decoder ask for 14 GB. Callers probe first and refuse anything over MAX_IMAGE_PIXELS.
 */

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp';

export interface ImageProbe {
  format: ImageFormat;
  width: number;
  height: number;
}

/** About a 6000 × 6700 photo. Anything bigger is refused before it reaches the decoder. */
export const MAX_IMAGE_PIXELS = 40_000_000;

const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1');

function probePng(b: Buffer): ImageProbe | null {
  if (b.length < 24 || ascii(b, 12, 16) !== 'IHDR') return null;
  return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function probeJpeg(b: Buffer): ImageProbe | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i] === 0xff && i < b.length) i++; // fill bytes
    const marker = b[i++];
    // markers that carry no length: TEM, RSTn, SOI, EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (i + 2 > b.length) return null;
    const len = b.readUInt16BE(i);
    // start-of-frame markers hold the size (C4, C8 and CC share the range but are not frames)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 > b.length) return null;
      return { format: 'jpeg', height: b.readUInt16BE(i + 3), width: b.readUInt16BE(i + 5) };
    }
    if (marker === 0xda || len < 2) return null; // image data reached without a frame header
    i += len;
  }
  return null;
}

function probeGif(b: Buffer): ImageProbe | null {
  if (b.length < 10) return null;
  return { format: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function probeWebp(b: Buffer): ImageProbe | null {
  if (b.length < 30) return null;
  const kind = ascii(b, 12, 16);
  if (kind === 'VP8X') return { format: 'webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { format: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/** The format and size declared by the header, or null when it isn't a PNG, JPEG, GIF or WebP we can read. */
export function probeImage(b: Buffer): ImageProbe | null {
  let probe: ImageProbe | null = null;
  try {
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) probe = probePng(b);
    else if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) probe = probeJpeg(b);
    else if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) probe = probeGif(b);
    else if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') probe = probeWebp(b);
  } catch {
    return null;
  }
  return probe && probe.width > 0 && probe.height > 0 ? probe : null;
}

/** True when the image is safe to hand to the decoder. */
export const withinPixelBudget = (p: ImageProbe): boolean => p.width * p.height <= MAX_IMAGE_PIXELS;
