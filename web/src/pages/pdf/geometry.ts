import type { Rect } from '@shared/schema';

export type { Rect };
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const roundRect = (r: Rect): Rect => ({ x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) });

export function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Keep a box on the page and no smaller than `min` points. */
export function clampRect(r: Rect, W: number, H: number, min = 6): Rect {
  const w = clamp(r.w, min, W);
  const h = clamp(r.h, min, H);
  return { x: clamp(r.x, 0, W - w), y: clamp(r.y, 0, H - h), w, h };
}

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Drag one handle of a box by (dx, dy), keeping the opposite edges fixed. */
export function resizeRect(orig: Rect, handle: Handle, dx: number, dy: number, min = 6): Rect {
  let { x, y, w, h } = orig;
  if (handle.includes('e')) w = orig.w + dx;
  if (handle.includes('s')) h = orig.h + dy;
  if (handle.includes('w')) {
    x = orig.x + dx;
    w = orig.w - dx;
  }
  if (handle.includes('n')) {
    y = orig.y + dy;
    h = orig.h - dy;
  }
  if (w < min) {
    if (handle.includes('w')) x = orig.x + orig.w - min;
    w = min;
  }
  if (h < min) {
    if (handle.includes('n')) y = orig.y + orig.h - min;
    h = min;
  }
  return { x, y, w, h };
}

/** QR codes stay square: grow to the larger side, anchored at the corner opposite the handle. */
export function squareUp(r: Rect, handle: Handle, orig: Rect): Rect {
  const size = Math.max(r.w, r.h);
  return {
    x: handle.includes('w') ? orig.x + orig.w - size : r.x,
    y: handle.includes('n') ? orig.y + orig.h - size : r.y,
    w: size,
    h: size,
  };
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/**
 * Best guess at the page colour around a box: look at a ring of pixels just outside it and take
 * the most common colour. Used to pre-fill the "cover the original" colour.
 */
export async function sampleBackground(imageUrl: string, rect: Rect, pageWidthPt: number): Promise<string> {
  try {
    const img = new Image();
    img.src = imageUrl;
    await img.decode();
    const k = img.naturalWidth / pageWidthPt;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '#ffffff';
    ctx.drawImage(img, 0, 0);
    const pad = 3;
    const x0 = Math.max(0, Math.floor((rect.x - pad) * k));
    const y0 = Math.max(0, Math.floor((rect.y - pad) * k));
    const x1 = Math.min(canvas.width - 1, Math.ceil((rect.x + rect.w + pad) * k));
    const y1 = Math.min(canvas.height - 1, Math.ceil((rect.y + rect.h + pad) * k));
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    const take = (x: number, y: number) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      const key = ((d[0]! >> 4) << 8) | ((d[1]! >> 4) << 4) | (d[2]! >> 4);
      const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++;
      e.r += d[0]!;
      e.g += d[1]!;
      e.b += d[2]!;
      buckets.set(key, e);
    };
    const step = Math.max(1, Math.floor(Math.max(x1 - x0, y1 - y0) / 80));
    for (let x = x0; x <= x1; x += step) {
      take(x, y0);
      take(x, y1);
    }
    for (let y = y0; y <= y1; y += step) {
      take(x0, y);
      take(x1, y);
    }
    const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    return best
      ? `#${hex2(Math.round(best.r / best.n))}${hex2(Math.round(best.g / best.n))}${hex2(Math.round(best.b / best.n))}`
      : '#ffffff';
  } catch {
    return '#ffffff';
  }
}
