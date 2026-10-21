import type { Run } from './extract';
import { hexToRgb, openPdf, rgbToHex } from './runtime';

export interface Raster {
  png: Buffer;
  width: number;
  height: number;
  scale: number;
  rgba: Uint8ClampedArray;
}

interface CanvasFactory {
  create(w: number, h: number): { canvas: { toBuffer(mime: string): Buffer }; context: { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } };
}

/** Render a page to PNG (plus raw pixels for colour sampling). */
export async function renderPageRaster(bytes: Uint8Array, pageNo: number, scale: number): Promise<Raster> {
  const { doc, close } = await openPdf(bytes);
  try {
    if (pageNo < 1 || pageNo > doc.numPages) throw new RangeError('No such page');
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale });
    const factory = (doc as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
    const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await (page.render as unknown as (o: unknown) => { promise: Promise<void> })({ canvasContext: context, viewport, canvas }).promise;
    const rgba = context.getImageData(0, 0, Math.ceil(viewport.width), Math.ceil(viewport.height)).data;
    const png = canvas.toBuffer('image/png');
    page.cleanup();
    return { png, width: Math.ceil(viewport.width), height: Math.ceil(viewport.height), scale, rgba };
  } finally {
    await close();
  }
}

// ── Colour sampling ─────────────────────────────────────────────────────────

type RGB = [number, number, number];

const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luma = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function px(r: Raster, x: number, y: number): RGB | null {
  if (x < 0 || y < 0 || x >= r.width || y >= r.height) return null;
  const i = (y * r.width + x) * 4;
  return [r.rgba[i], r.rgba[i + 1], r.rgba[i + 2]];
}

function modeColour(samples: RGB[]): RGB {
  if (!samples.length) return [255, 255, 255];
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const [r, g, b] of samples) {
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(k, e);
  }
  const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  return [best.r / best.n, best.g / best.n, best.b / best.n];
}

/**
 * Estimate each run's text colour and the background behind it by looking at the rendered page.
 * Background = the most common colour in a thin ring around the run; text = the pixels furthest
 * from that background. Good for solid text on solid or lightly-textured backgrounds.
 */
export function sampleRunColors(r: Raster, runs: Run[]): void {
  const s = r.scale;
  for (const run of runs) {
    const left = Math.floor(run.x * s);
    const right = Math.ceil((run.x + run.w) * s);
    const top = Math.floor(run.y * s);
    const bottom = Math.ceil((run.y + run.h) * s);
    const ring: RGB[] = [];
    const pad = 3;
    for (let x = left; x <= right; x += 2) {
      for (const y of [top - pad, bottom + pad]) {
        const c = px(r, x, y);
        if (c) ring.push(c);
      }
    }
    for (let y = top; y <= bottom; y += 2) {
      for (const x of [left - pad, right + pad]) {
        const c = px(r, x, y);
        if (c) ring.push(c);
      }
    }
    const bg = modeColour(ring);

    // glyph body only (skip the extremes of the box where there is mostly background)
    const bodyTop = Math.floor((run.baseline - run.size * 0.7) * s);
    const bodyBottom = Math.ceil((run.baseline + run.size * 0.05) * s);
    const far: Array<{ d: number; c: RGB }> = [];
    for (let y = bodyTop; y <= bodyBottom; y++) {
      for (let x = left; x <= right; x++) {
        const c = px(r, x, y);
        if (!c) continue;
        const d = dist(c, bg);
        if (d > 48) far.push({ d, c });
      }
    }
    let text: RGB;
    if (far.length < 6) text = luma(bg) > 140 ? [17, 24, 39] : [255, 255, 255];
    else {
      far.sort((a, b) => b.d - a.d);
      const top = far.slice(0, Math.max(6, Math.floor(far.length * 0.25)));
      text = [top.reduce((a, b) => a + b.c[0], 0) / top.length, top.reduce((a, b) => a + b.c[1], 0) / top.length, top.reduce((a, b) => a + b.c[2], 0) / top.length];
    }
    run.bg = rgbToHex(...bg);
    run.color = rgbToHex(...text);
  }
}

// ── Palette ─────────────────────────────────────────────────────────────────

export interface Palette {
  /** The most prominent saturated colour: used as the page's brand colour. */
  brand: string;
  /** The most common colour overall (usually the page background). */
  dominant: string;
  /** Does the page background look dark? */
  dark: boolean;
  /** Is the dominant colour essentially the brand colour (a coloured cover)? */
  brandCover: boolean;
  /** False when the document has no vivid colour and `brand` is just a default. */
  found: boolean;
}

function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  const d = mx - mn;
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  let h = 0;
  if (d) h = mx === rr ? ((gg - bb) / d) % 6 : mx === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}

/**
 * `rasters` are the first few pages. The dominant colour comes from the first page (usually the cover);
 * the brand colour is the most vivid colour found anywhere, counted in absolute pixels so thin
 * accent text and small logos still register.
 */
export function extractPalette(rasters: Raster | Raster[]): Palette {
  const list = Array.isArray(rasters) ? rasters : [rasters];
  const first = list[0];
  const sat = new Map<number, { score: number; r: number; g: number; b: number; n: number }>();
  for (const r of list) {
    const step = r.width * r.height > 900_000 ? 2 : 1;
    for (let y = 0; y < r.height; y += step) {
      for (let x = 0; x < r.width; x += step) {
        const c = px(r, x, y)!;
        const [h, s, v] = rgbToHsv(c);
        if (s < 0.3 || v < 0.25) continue; // ignore greys, near-black and washed-out tints
        const key = Math.floor(h / 12) * 100 + Math.floor(s * 3) * 10 + Math.floor(v * 3);
        const e = sat.get(key) ?? { score: 0, r: 0, g: 0, b: 0, n: 0 };
        e.score += 0.5 + s; // prefer vivid colours over muddy ones
        e.r += c[0];
        e.g += c[1];
        e.b += c[2];
        e.n++;
        sat.set(key, e);
      }
    }
  }
  const all: RGB[] = [];
  const stride = Math.max(1, Math.floor(Math.sqrt((first.width * first.height) / 60_000)));
  for (let y = 0; y < first.height; y += stride) for (let x = 0; x < first.width; x += stride) all.push(px(first, x, y)!);
  const dominant = modeColour(all);
  const best = [...sat.values()].filter((e) => e.n >= 40).sort((a, b) => b.score - a.score)[0];
  const brandRgb: RGB = best ? [best.r / best.n, best.g / best.n, best.b / best.n] : hexToRgb('#4f46e5');
  return {
    brand: rgbToHex(...brandRgb),
    dominant: rgbToHex(...dominant),
    dark: luma(dominant) < 90,
    brandCover: !!best && dist(dominant, brandRgb) < 60,
    found: !!best,
  };
}
