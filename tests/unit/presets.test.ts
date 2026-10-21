import { describe, expect, it } from 'vitest';
import { contrast, isDark } from '../../src/shared/color';
import { applyPreset, presetById, STYLE_PRESETS, withPreset } from '../../src/shared/presets';
import { PageSchema, ThemeSchema } from '../../src/shared/schema';

const BRANDS = ['#4f46e5', '#f97316', '#16a34a', '#0ea5e9', '#e11d48', '#111827', '#facc15', '#7c3aed'];

describe('style presets', () => {
  it('have unique ids and a name and blurb each', () => {
    expect(new Set(STYLE_PRESETS.map((p) => p.id)).size).toBe(STYLE_PRESETS.length);
    for (const p of STYLE_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(10);
      expect(presetById(p.id)).toBe(p);
    }
    expect(presetById('nope')).toBeUndefined();
  });

  it('always produce a valid theme, whatever the brand colour', () => {
    for (const p of STYLE_PRESETS) {
      for (const brand of BRANDS) {
        const out = ThemeSchema.safeParse({ brand, ...p.make(brand) });
        expect(out.success, `${p.id} on ${brand}`).toBe(true);
      }
    }
  });

  it('keep body and muted text readable on the page background', () => {
    for (const p of STYLE_PRESETS) {
      for (const brand of BRANDS) {
        const t = p.make(brand);
        expect(contrast(t.text, t.bg), `${p.id}/${brand} text`).toBeGreaterThanOrEqual(7);
        expect(contrast(t.muted, t.bg), `${p.id}/${brand} muted`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.muted, t.alt_bg), `${p.id}/${brand} muted on tint`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keep dark sections dark and light pages light', () => {
    for (const p of STYLE_PRESETS) {
      for (const brand of BRANDS) {
        const t = p.make(brand);
        expect(isDark(t.dark_bg), `${p.id}/${brand}`).toBe(true);
        expect(isDark(t.bg)).toBe(p.id === 'midnight');
      }
    }
  });

  it('keep the brand colour and any accent the page already had', () => {
    const theme = ThemeSchema.parse({ brand: '#e11d48', accent: '#facc15', font: 'mono' });
    for (const p of STYLE_PRESETS) {
      const out = applyPreset(theme, p);
      expect(out.brand).toBe('#e11d48');
      expect(out.accent).toBe('#facc15');
    }
  });

  it('replace the previous look completely, so one preset never leaves traces of another', () => {
    const page = PageSchema.parse({});
    const editorial = withPreset(page, presetById('editorial')!);
    expect(editorial.theme.heading_font).toBe('fraunces');
    const clean = withPreset(editorial, presetById('clean')!);
    expect(clean.theme.heading_font).toBeUndefined();
    expect(clean.theme.density).toBe('comfortable');
    expect(clean.theme.cards).toBe('outlined');
    expect(clean.blocks).toEqual(page.blocks);
  });
});
