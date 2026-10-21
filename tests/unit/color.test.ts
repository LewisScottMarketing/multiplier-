import { describe, expect, it } from 'vitest';
import { contrast, inkFor, isDark, luminance, mix, readableOn, shade, shiftHue, tint, toHsl, withLightness } from '../../src/shared/color';

describe('colour maths', () => {
  it('mixes, tints and shades', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(tint('#000000', 1)).toBe('#ffffff');
    expect(shade('#ffffff', 1)).toBe('#000000');
    expect(mix('#336699', '#336699', 0.7)).toBe('#336699');
  });

  it('measures contrast the WCAG way', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThan(4.5);
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.6);
  });

  it('tells dark backgrounds from light ones', () => {
    expect(isDark('#0a0e1d')).toBe(true);
    expect(isDark('#ffffff')).toBe(false);
    expect(isDark('#fbf8f3')).toBe(false);
    expect(luminance('#000000')).toBe(0);
  });

  it('rotates hue and keeps greys grey', () => {
    const [h] = toHsl('#4f46e5');
    const [h2] = toHsl(shiftHue('#4f46e5', 32));
    expect(h2 - h).toBeCloseTo(32, -1);
    expect(shiftHue('#888888', 40)).toBe('#888888');
    expect(shiftHue('#ff0000', 360)).toBe('#ff0000');
  });

  it('changes lightness without changing hue', () => {
    const [h] = toHsl('#4f46e5');
    const [h2, , l2] = toHsl(withLightness('#4f46e5', 0.8));
    expect(h2).toBeCloseTo(h, -1);
    expect(l2).toBeCloseTo(0.8, 1);
  });
});

describe('inkFor', () => {
  const white = '#ffffff';
  const dark = '#0b1020';

  it('keeps white on deep colours', () => {
    for (const c of ['#4f46e5', '#1d4ed8', '#7c3aed', '#be123c', '#0f172a']) expect(inkFor(c)).toBe(white);
  });

  it('switches to dark text on bright colours, so buttons stay legible', () => {
    for (const c of ['#f97316', '#facc15', '#16a34a', '#22d3ee', '#a3e635', '#ffffff']) expect(inkFor(c)).toBe(dark);
  });

  it('always gives text that reads at least as well as the alternative', () => {
    for (let i = 0; i < 360; i += 15) {
      const bg = shiftHue('#e11d48', i);
      const chosen = inkFor(bg);
      const other = chosen === white ? dark : white;
      expect(contrast(bg, chosen)).toBeGreaterThanOrEqual(contrast(bg, other));
    }
  });

  it('considers every colour of a gradient', () => {
    expect(inkFor('#4f46e5', '#7c3aed')).toBe(white);
    // a yellow end can't carry white text, even if the other end could
    expect(inkFor('#4f46e5', '#facc15')).toBe(dark);
  });
});

describe('readableOn', () => {
  it('leaves a colour that already reads', () => {
    expect(readableOn('#4f46e5', ['#ffffff', '#f5f6fa'])).toBe('#4f46e5');
  });

  it('lightens a deep colour for a dark page', () => {
    const c = readableOn('#4f46e5', ['#0a0e1d']);
    expect(c).not.toBe('#4f46e5');
    expect(contrast(c, '#0a0e1d')).toBeGreaterThanOrEqual(4.5);
  });

  it('darkens a pale colour for a light page', () => {
    const c = readableOn('#facc15', ['#ffffff']);
    expect(contrast(c, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(c)).toBeLessThan(luminance('#facc15'));
  });

  it('works for every hue on both kinds of page', () => {
    for (let i = 0; i < 360; i += 20) {
      const brand = shiftHue('#4f46e5', i);
      for (const bg of ['#ffffff', '#fbf8f3', '#0a0e1d']) expect(contrast(readableOn(brand, [bg]), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
