import { describe, expect, it } from 'vitest';
import { contrast } from '../../src/shared/color';
import { FONT_CHOICES, PageSchema, ThemeSchema, type Theme } from '../../src/shared/schema';
import { FONTS, fontFaceCss, fontFilesDir, fontsUsed, preloadPath } from '../../src/server/render/fonts';
import { BASE_CSS, themeCss } from '../../src/server/render/css';

describe('pages saved before the design system', () => {
  it('still open, with the new settings filled in to match how they always looked', () => {
    const page = PageSchema.parse({
      theme: {
        brand: '#112233',
        bg: '#ffffff',
        alt_bg: '#f5f6fa',
        dark_bg: '#0f1224',
        text: '#0f172a',
        muted: '#475569',
        font: 'serif',
        radius: 'round',
        width: 'wide',
      },
      blocks: [{ type: 'hero', id: 'h1', headline: 'Hi', layout: 'centered', primary: { label: 'Go', action: { type: 'form' } } }],
    });
    expect(page.theme).toMatchObject({ brand: '#112233', font: 'serif', radius: 'round', width: 'wide' });
    expect(page.theme).toMatchObject({ heading_weight: 'bold', cards: 'outlined', density: 'comfortable', gradient: false });
    expect(page.theme.heading_font).toBeUndefined();
    const hero = page.blocks[0]!;
    expect(hero).toMatchObject({ layout: 'centered', media: 'auto' });
  });

  it('read as an empty theme when there is none at all', () => {
    expect(PageSchema.parse({}).theme).toEqual(ThemeSchema.parse({}));
  });
});

describe('what a theme may say', () => {
  it('refuses anything outside the lists, and anything that is not a six-digit colour', () => {
    for (const bad of [
      { font: 'comic-sans' },
      { heading_font: 'papyrus' },
      { radius: 'pill' },
      { width: 'huge' },
      { heading_weight: 'black' },
      { cards: 'glass' },
      { density: 'tight' },
      { gradient: 'yes' },
      { brand: 'red' },
      { brand: '#fff' },
      { accent: 'url(javascript:alert(1))' },
      { bg: '#ffffff;}</style><script>' },
    ]) {
      expect(ThemeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('the CSS made from a theme', () => {
  const widths = ['narrow', 'normal', 'wide'] as const;
  const radii = ['sharp', 'soft', 'round'] as const;
  const weights = ['medium', 'semibold', 'bold', 'extrabold'] as const;
  const cards = ['outlined', 'flat', 'raised'] as const;
  const densities = ['compact', 'comfortable', 'spacious'] as const;

  it('is nothing but plain declarations for every combination of settings', () => {
    let seen = 0;
    for (const font of FONT_CHOICES) {
      for (const heading_font of [undefined, ...FONT_CHOICES]) {
        for (const radius of radii) {
          for (const width of widths) {
            for (const heading_weight of weights) {
              for (const card of cards) {
                for (const density of densities) {
                  for (const gradient of [false, true]) {
                    const theme = ThemeSchema.parse({ font, heading_font, radius, width, heading_weight, cards: card, density, gradient });
                    const css = themeCss(theme);
                    expect(css).toMatch(/^:root\{[^<>]*\}$/);
                    expect(css).not.toMatch(/@import|expression\(|javascript:|<\/?style|;\s*\}\s*\w/i);
                    expect(css.match(/\{/g)?.length).toBe(1);
                    seen++;
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(seen).toBe(FONT_CHOICES.length * (FONT_CHOICES.length + 1) * 3 * 3 * 4 * 3 * 3 * 2);
  });

  it('only ever contains colours the schema let through', () => {
    const css = themeCss(ThemeSchema.parse({ brand: '#12ab34', accent: '#ab12cd', gradient: true }));
    for (const colour of css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) expect(colour).toMatch(/^#[0-9a-fA-F]{6}$|^#(?:fff|000)(?:fff)?$/i);
    expect(css).toContain('--brand:#12ab34');
    expect(css).toContain('--accent:#ab12cd');
  });

  it('uses light button text on deep colours and dark text on bright ones', () => {
    expect(themeCss(ThemeSchema.parse({ brand: '#4f46e5' }))).toContain('--brand-ink:#ffffff');
    expect(themeCss(ThemeSchema.parse({ brand: '#f97316' }))).toContain('--brand-ink:#0b1020');
    // a gradient is judged on both of its ends
    expect(themeCss(ThemeSchema.parse({ brand: '#4f46e5', accent: '#facc15', gradient: true }))).toContain('--brand-ink:#0b1020');
  });

  it('gives links and labels a colour that reads on the page, even when the brand colour would not', () => {
    const dark = themeCss(ThemeSchema.parse({ brand: '#4f46e5', bg: '#0a0e1d', alt_bg: '#10162b', text: '#eceffa', muted: '#a0a8c7' }));
    const text = dark.match(/--brand-text:(#[0-9a-f]{6})/)![1]!;
    expect(text).not.toBe('#4f46e5');
    expect(contrast(text, '#0a0e1d')).toBeGreaterThanOrEqual(4.5);
    expect(themeCss(ThemeSchema.parse({ brand: '#4f46e5' }))).toContain('--brand-text:#4f46e5');
  });

  it('adapts cards to a dark page', () => {
    const light = themeCss(ThemeSchema.parse({ cards: 'raised' }));
    const dark = themeCss(ThemeSchema.parse({ cards: 'raised', bg: '#0a0e1d', text: '#eceffa' }));
    expect(light).toContain('--card-fill:#ffffff');
    expect(dark).toContain('--card-fill:color-mix(in srgb,#ffffff 6%');
    expect(dark).toContain('color-scheme:dark');
    expect(light).toContain('color-scheme:light');
  });

  it('keeps the glow behind a spotlight headline gentler on a light page, where the brand colour would read as a pink streak', () => {
    const glow = (css: string) => Number(css.match(/--glow:([\d.]+)/)![1]);
    const light = glow(themeCss(ThemeSchema.parse({ brand: '#d6336c' })));
    const dark = glow(themeCss(ThemeSchema.parse({ brand: '#d6336c', bg: '#0a0e1d', text: '#eceffa' })));
    expect(light).toBeLessThan(dark);
    expect(light).toBeLessThanOrEqual(0.5);
  });

  it('fades the spotlight glow in from the top of the hero, so it never ends in a hard line under the header', () => {
    const rule = BASE_CSS.split('\n').find((l) => l.startsWith('.hero.l-spotlight::before'))!;
    expect(rule).toContain('opacity:var(--glow)');
    // the glow starts above the hero (top:-26% of a box 86% tall), so its first 30% is out of sight and the mask has to be clear until there
    expect(rule).toMatch(/mask-image:linear-gradient\(180deg,transparent 30%,#000 \d+%\)/);
  });
});

describe('fonts', () => {
  it('have a stack and heading tracking for every choice', () => {
    for (const f of FONT_CHOICES) {
      expect(FONTS[f].stack.length).toBeGreaterThan(10);
      expect(FONTS[f].track).toMatch(/^-?\.\d+em$/);
    }
  });

  it('are self-hosted: a web font’s CSS points at our own /f/ route and nothing else', () => {
    for (const f of FONT_CHOICES) {
      const info = FONTS[f];
      const css = fontFaceCss(f);
      if (!info.pkg) {
        expect(css).toBe('');
        expect(preloadPath(f)).toBeNull();
        continue;
      }
      expect(css).toContain('@font-face');
      expect(css).toContain(`url(/f/${info.pkg}/files/`);
      expect(css).not.toMatch(/url\((?!\/f\/)/);
      expect(css).not.toMatch(/https?:/);
      expect(preloadPath(f)).toBe(`/f/${info.pkg}/files/${info.pkg}-latin-wght-normal.woff2`);
      expect(fontFilesDir(info.pkg!)).toBeTruthy();
    }
    expect(fontFilesDir('../etc')).toBeNull();
    expect(fontFilesDir('not-a-font')).toBeNull();
  });

  it('are only listed for a theme once each, body first, and not at all for system type', () => {
    const t = (o: Partial<Theme>) => ({ font: 'inter' as const, heading_font: undefined, ...o });
    expect(fontsUsed(t({}))).toEqual(['inter']);
    expect(fontsUsed(t({ font: 'manrope', heading_font: 'manrope' }))).toEqual(['manrope']);
    expect(fontsUsed(t({ font: 'manrope', heading_font: 'fraunces' }))).toEqual(['manrope', 'fraunces']);
    expect(fontsUsed(t({ font: 'system', heading_font: 'serif' }))).toEqual([]);
    expect(fontsUsed(t({ font: 'system', heading_font: 'fraunces' }))).toEqual(['fraunces']);
  });
});
