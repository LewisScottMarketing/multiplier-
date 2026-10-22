import { contrast, inkFor, mix } from './color';
import { applyPreset, presetById, STYLE_PRESETS, type StylePreset } from './presets';
import type { BrandKit, Page, Theme } from './schema';

/**
 * Following a brand: its colours, typefaces and logo go onto a page's theme, and its voice goes to the AI.
 * Pure functions, shared by the server (imports, starter pages) and the dashboard (the Design panel).
 */

/** The preset a theme is currently set to, when it hasn't been customised away from one. */
export function presetOf(theme: Theme): StylePreset | undefined {
  return STYLE_PRESETS.find((p) => {
    const made = p.make(theme.brand) as Record<string, unknown>;
    return Object.keys(made).every((k) => (theme as Record<string, unknown>)[k] === made[k]);
  });
}

/** A secondary text colour that still reads on the background. */
function mutedFor(text: string, bg: string): string {
  for (const t of [0.38, 0.3, 0.2, 0.1]) {
    const m = mix(text, bg, t);
    if (contrast(m, bg) >= 4.5) return m;
  }
  return text;
}

/**
 * The page with this brand's colours, typefaces and logo. The look stays the page's own unless the brand names a style;
 * either way the tints and shades are worked out again from the brand colour so they sit well with it.
 */
export function applyBrand(page: Page, kit: BrandKit): Page {
  const wasPreset = presetOf(page.theme);
  let theme: Theme = { ...page.theme, brand: kit.brand, accent: kit.accent };
  const preset = (kit.style ? presetById(kit.style) : undefined) ?? wasPreset;
  if (preset) theme = { ...applyPreset(theme, preset), brand: kit.brand, accent: kit.accent };

  if (kit.bg) theme.bg = kit.bg;
  if (kit.dark) theme.dark_bg = kit.dark;
  if (kit.text) theme.text = contrast(kit.text, theme.bg) >= 4.5 ? kit.text : inkFor(theme.bg);
  // a colour the brand sets changes what the others sit on, so the in-between ones follow
  if (kit.bg) theme.alt_bg = mix(theme.bg, kit.brand, 0.05);
  if (kit.bg || kit.text) theme.muted = mutedFor(theme.text, theme.bg);
  if (kit.body_font) theme.font = kit.body_font;
  if (kit.heading_font) theme.heading_font = kit.heading_font;

  const header = kit.logo?.src ? { ...page.header, logo: kit.logo } : page.header;
  return { ...page, theme, header };
}

/** Strip anything that could close a prompt's delimiters, and tidy the whitespace. */
const plain = (s: string, max: number) => s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The brand as notes for a writer (the AI): voice, words to use and avoid, other rules. Empty when the kit says nothing
 * about how the brand sounds. The caller puts it inside delimiters and says it can't override its own instructions.
 */
export function brandNotes(kit: BrandKit): string {
  const lines: string[] = [];
  if (kit.voice.trim()) lines.push(`Voice: ${plain(kit.voice, 800)}`);
  const use = kit.use.map((w) => plain(w, 60)).filter(Boolean);
  const avoid = kit.avoid.map((w) => plain(w, 60)).filter(Boolean);
  if (use.length) lines.push(`Words and phrases to use: ${use.join('; ')}`);
  if (avoid.length) lines.push(`Never use: ${avoid.join('; ')}`);
  if (kit.rules.trim()) lines.push(`Other rules: ${plain(kit.rules, 2000)}`);
  return lines.length ? `Brand: ${plain(kit.name, 80)}\n${lines.join('\n')}` : '';
}

/** The brand's look, for the designer: colours and typefaces as facts (the page's own colours are set separately). */
export function brandLook(kit: BrandKit): string {
  const bits = [`Brand colour ${kit.brand}`];
  if (kit.accent) bits.push(`accent ${kit.accent}`);
  if (kit.bg) bits.push(`background ${kit.bg}`);
  if (kit.text) bits.push(`text ${kit.text}`);
  const fonts = [kit.heading_font && `headings in ${kit.heading_font}`, kit.body_font && `body in ${kit.body_font}`].filter(Boolean);
  if (fonts.length) bits.push(fonts.join(', '));
  if (kit.font_names.trim()) bits.push(`its own typefaces are ${plain(kit.font_names, 160)}`);
  if (kit.style) bits.push(`preferred style: ${kit.style}`);
  return bits.join('; ');
}
