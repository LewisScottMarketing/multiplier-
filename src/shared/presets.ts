import { mix, shade, tint } from './color';
import type { Page, Theme } from './schema';

/**
 * One-click looks. A preset sets typefaces, weights, corners, cards, spacing and the neutral colours, and
 * leaves the brand colour (and accent) alone, so applying one to a page built from your PDF keeps your colour.
 * Each preset is a function of the brand colour so its tints and shades harmonise with it.
 */

export interface StylePreset {
  id: string;
  name: string;
  /** One line on the feel of it. */
  blurb: string;
  make(brand: string): Omit<Theme, 'brand' | 'accent'>;
}

const base: Omit<Theme, 'brand' | 'accent'> = {
  bg: '#ffffff',
  alt_bg: '#f5f6fa',
  dark_bg: '#0f1224',
  text: '#0f172a',
  muted: '#475569',
  font: 'inter',
  heading_font: undefined,
  radius: 'soft',
  width: 'normal',
  heading_weight: 'bold',
  cards: 'outlined',
  density: 'comfortable',
  gradient: false,
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'clean',
    name: 'Clean',
    blurb: 'Bright and neutral. Safe for any audience.',
    make: (brand) => ({
      ...base,
      alt_bg: mix('#f5f6fa', brand, 0.04),
      dark_bg: mix('#0b1020', brand, 0.16),
    }),
  },
  {
    id: 'editorial',
    name: 'Editorial',
    blurb: 'A serif headline on warm paper. Reads like a magazine.',
    make: (brand) => ({
      ...base,
      bg: '#fbf8f3',
      alt_bg: mix('#f1eadf', brand, 0.025),
      dark_bg: mix('#1c1814', brand, 0.14),
      text: '#211d18',
      muted: '#6a6157',
      heading_font: 'fraunces',
      radius: 'sharp',
      heading_weight: 'medium',
      cards: 'flat',
      density: 'spacious',
    }),
  },
  {
    id: 'bold',
    name: 'Bold',
    blurb: 'Heavy type, hard corners, lots of contrast.',
    make: (brand) => ({
      ...base,
      alt_bg: '#f3f3f5',
      dark_bg: mix('#09090d', brand, 0.1),
      text: '#09090d',
      muted: '#52525b',
      font: 'space-grotesk',
      radius: 'sharp',
      heading_weight: 'extrabold',
    }),
  },
  {
    id: 'soft',
    name: 'Soft',
    blurb: 'Friendly and rounded, with a gentle tint of your colour.',
    make: (brand) => ({
      ...base,
      bg: mix('#ffffff', brand, 0.015),
      alt_bg: tint(brand, 0.92),
      dark_bg: shade(mix('#0b1020', brand, 0.3), 0.1),
      text: '#1d2433',
      muted: '#5a6478',
      font: 'manrope',
      radius: 'round',
      cards: 'raised',
      density: 'spacious',
    }),
  },
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'A dark page with a glow of your colour.',
    make: (brand) => ({
      ...base,
      bg: mix('#0a0e1d', brand, 0.07),
      alt_bg: mix('#10162b', brand, 0.14),
      dark_bg: mix('#060914', brand, 0.1),
      text: '#eceffa',
      muted: '#a0a8c7',
      font: 'manrope',
      cards: 'raised',
      gradient: true,
    }),
  },
  {
    id: 'gradient',
    name: 'Gradient',
    blurb: 'Modern SaaS: bright, rounded, colour that flows.',
    make: (brand) => ({
      ...base,
      alt_bg: tint(brand, 0.93),
      dark_bg: shade(mix('#0b1020', brand, 0.28), 0.12),
      text: '#101828',
      muted: '#475467',
      font: 'manrope',
      radius: 'round',
      heading_weight: 'extrabold',
      cards: 'raised',
      gradient: true,
    }),
  },
  {
    id: 'corporate',
    name: 'Corporate',
    blurb: 'Restrained and compact. For conservative buyers.',
    make: (brand) => ({
      ...base,
      alt_bg: '#f3f5f8',
      dark_bg: mix('#0e1a2c', brand, 0.08),
      text: '#111827',
      muted: '#4b5563',
      radius: 'sharp',
      heading_weight: 'semibold',
      density: 'compact',
    }),
  },
];

export const presetById = (id: string): StylePreset | undefined => STYLE_PRESETS.find((p) => p.id === id);

/** The theme with a preset's look applied. The brand colour and accent are kept. */
export function applyPreset(theme: Theme, preset: StylePreset): Theme {
  return { ...theme, ...preset.make(theme.brand) };
}

/** The same, for a whole page. */
export const withPreset = (page: Page, preset: StylePreset): Page => ({ ...page, theme: applyPreset(page.theme, preset) });
