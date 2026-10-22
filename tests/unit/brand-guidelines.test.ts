import { describe, expect, it } from 'vitest';
import { colorsToKit, scanGuidelines, type GuideLine } from '../../src/server/brand/guidelines';

const lines = (page: number, texts: string[], size = 11): GuideLine[] => texts.map((text) => ({ text, size, page }));

const GUIDE: GuideLine[] = [
  { text: 'Acme Brand Guidelines', size: 40, page: 1 },
  { text: 'Version 3', size: 12, page: 1 },
  ...lines(2, [
    'Colour',
    'Primary colour',
    'Ocean Blue',
    'HEX #0B5FFF',
    'RGB 11 95 255',
    'CMYK 96 63 0 0',
    'Accent colour',
    'Sunset Orange',
    'HEX #FF6B35',
    'RGB 255 107 53',
    'Dark background',
    'Midnight',
    'HEX 0B1020',
    'Text',
    'Ink',
    'R: 15 G: 23 B: 42',
  ]),
  ...lines(3, [
    'Typography',
    'Headings are set in Playfair Display.',
    'Body text is set in Inter Regular.',
    'Helvetica Neue is used in print only.',
    'Helvetica Neue',
  ]),
  ...lines(4, [
    'Tone of voice',
    'We sound like a helpful colleague, not a salesperson.',
    'Short sentences. Plain words. We say what we mean.',
    'Do keep it human and specific.',
    "Don't use jargon like synergy or leverage.",
    'Never promise results we cannot show.',
  ]),
];

describe('scanning brand guidelines without AI', () => {
  const scan = scanGuidelines(GUIDE);

  it('finds the brand’s name on the cover', () => {
    expect(scan.name).toBe('Acme');
  });

  it('reads the codes the swatches print, in any notation, with the name and role beside each', () => {
    const by = (hex: string) => scan.colors.find((c) => c.hex === hex);
    expect(by('#0b5fff')).toMatchObject({ role: 'primary', label: 'Ocean Blue', count: 2 }); // hex and rgb of one swatch
    expect(by('#ff6b35')).toMatchObject({ role: 'accent', label: 'Sunset Orange' });
    expect(by('#0b1020')).toMatchObject({ role: 'dark', label: 'Midnight' });
    expect(by('#0f172a')).toMatchObject({ role: 'text', label: 'Ink' });
  });

  it('finds the typefaces it names, and which is for what', () => {
    const names = scan.fonts.map((f) => f.name);
    expect(names).toContain('Playfair Display');
    expect(names).toContain('Inter');
    expect(names).toContain('Helvetica Neue');
    expect(names).not.toContain('Helvetica'); // part of Helvetica Neue
    expect(scan.fonts.find((f) => f.name === 'Playfair Display')?.role).toBe('heading');
    expect(scan.fonts.find((f) => f.name === 'Inter')?.role).toBe('body');
  });

  it('copies the passage on tone of voice, and the do and don’t lines', () => {
    expect(scan.voice).toMatch(/^We sound like a helpful colleague, not a salesperson\. Short sentences\./);
    expect(scan.rules).toContain("Don't use jargon like synergy or leverage.");
    expect(scan.rules).toContain('Never promise results we cannot show.');
    expect(scan.rules).toContain('Do keep it human and specific.');
  });

  it('says nothing it cannot find', () => {
    const empty = scanGuidelines(lines(1, ['Just a page', 'with some words']));
    expect(empty).toMatchObject({ colors: [], fonts: [], voice: '', rules: '' });
  });
});

describe('what the colours become', () => {
  it('names the brand colour, accent, text, background and dark', () => {
    expect(
      colorsToKit([
        { hex: '#0b5fff', role: 'primary' },
        { hex: '#ff6b35', role: 'accent' },
        { hex: '#0f172a', role: 'text' },
        { hex: '#fbf8f3', role: 'bg' },
        { hex: '#0b1020', role: 'dark' },
      ]),
    ).toEqual({ brand: '#0b5fff', accent: '#ff6b35', text: '#0f172a', bg: '#fbf8f3', dark: '#0b1020' });
  });

  it('takes the first vivid colour when nothing is called primary, and ignores roles that make no sense', () => {
    const kit = colorsToKit([
      { hex: '#f5f5f5', role: 'other' },
      { hex: '#7c3aed', role: 'other' },
      { hex: '#ffffff', role: 'bg' }, // plain white is where pages start from
      { hex: '#fde68a', role: 'text' }, // pale yellow is not a text colour
      { hex: '#fde68a', role: 'dark' },
    ]);
    expect(kit).toEqual({ brand: '#7c3aed', accent: undefined, text: undefined, bg: undefined, dark: undefined });
  });
});
