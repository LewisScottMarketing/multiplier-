/**
 * Small colour helpers shared by the page renderer and the style presets, so both agree on what
 * "tinted", "dark" and "readable on" mean. Colours are always "#rrggbb".
 */

export type Rgb = [number, number, number];

export function toRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** `t` of 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export const tint = (hex: string, t: number): string => mix(hex, '#ffffff', t);
export const shade = (hex: string, t: number): string => mix(hex, '#000000', t);

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** True for backgrounds that need light text. */
export const isDark = (hex: string): boolean => luminance(hex) < 0.18;

const WHITE = '#ffffff';
const NEAR_BLACK = '#0b1020';

/**
 * Text colour for a button or section painted in `backgrounds` (more than one when it is a gradient): white when that
 * reads comfortably (WCAG 4.5:1) on all of them, otherwise near-black. Bright oranges, greens and yellows get dark
 * text, which is what keeps a "Book a call" button legible; deep blues and violets keep white.
 */
export function inkFor(...backgrounds: string[]): string {
  const worst = (ink: string) => Math.min(...backgrounds.map((bg) => contrast(bg, ink)));
  if (worst(WHITE) >= 4.5) return WHITE;
  return worst(NEAR_BLACK) >= worst(WHITE) ? NEAR_BLACK : WHITE;
}

// ── Hue / lightness ─────────────────────────────────────────────────────────

export function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function fromHsl(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return toHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const x = (t + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return toHex([channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255]);
}

/** Rotate the hue, e.g. indigo → violet. Greys stay grey. */
export function shiftHue(hex: string, degrees: number): string {
  const [h, s, l] = toHsl(hex);
  return fromHsl(h + degrees, s, l);
}

/** Same hue and saturation at a different lightness (0 to 1). */
export function withLightness(hex: string, lightness: number): string {
  const [h, s] = toHsl(hex);
  return fromHsl(h, s, lightness);
}

// ── Contrast ────────────────────────────────────────────────────────────────

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The brand colour, nudged lighter (on dark backgrounds) or darker (on light ones) only as far as needed for it to
 * be read as text on every given background. A deep indigo is fine on white but disappears on navy; a pale yellow is
 * the other way round. Colours that already pass are returned unchanged.
 */
export function readableOn(brand: string, backgrounds: string[], min = 4.5): string {
  const ok = (c: string) => backgrounds.every((bg) => contrast(c, bg) >= min);
  if (ok(brand)) return brand;
  const towardWhite = backgrounds.every((bg) => luminance(bg) < 0.3);
  const target = towardWhite ? '#ffffff' : '#000000';
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(brand, target, t);
    if (ok(c)) return c;
  }
  return target;
}
