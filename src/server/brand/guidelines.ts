import { toHex, toHsl } from '@shared/color';

/**
 * What can be read from a brand-guidelines PDF without AI: the colour codes it prints, the typefaces it names, a
 * passage on tone of voice, and its do/don't lines. Brand books are laid out for people, so this is a best effort; the
 * reader shows the result for correction, and with AI on Claude reads the pages instead.
 */

export interface GuideLine {
  text: string;
  size: number;
  page: number;
}

export type ColorRole = 'primary' | 'accent' | 'bg' | 'text' | 'dark' | 'other';

export interface FoundColor {
  hex: string;
  /** The name printed beside it ("Ocean Blue"), when there is one. */
  label: string;
  role: ColorRole;
  count: number;
}

export interface FoundFont {
  name: string;
  role: 'heading' | 'body' | 'other';
  count: number;
}

export interface Scan {
  name: string;
  colors: FoundColor[];
  fonts: FoundFont[];
  voice: string;
  rules: string;
}

const ROLE_WORDS: Array<[RegExp, ColorRole]> = [
  [/\b(primary|main|core|brand)\b/i, 'primary'],
  [/\b(secondary|accent|highlight|tertiary|supporting)\b/i, 'accent'],
  [/\b(background|paper|canvas|surface)\b/i, 'bg'],
  [/\b(text|body|ink|copy|charcoal)\b/i, 'text'],
  [/\b(dark|night|midnight|navy)\b/i, 'dark'],
];

const hexOfRgb = (r: number, g: number, b: number) => toHex([Math.min(255, r), Math.min(255, g), Math.min(255, b)]);

const TYPEFACES = [
  'Inter',
  'Helvetica Neue',
  'Helvetica',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Garamond',
  'Playfair Display',
  'Lora',
  'Merriweather',
  'Montserrat',
  'Poppins',
  'Roboto',
  'Open Sans',
  'Lato',
  'Source Sans',
  'Source Serif',
  'Nunito',
  'Raleway',
  'Work Sans',
  'DM Sans',
  'DM Serif Display',
  'Space Grotesk',
  'Manrope',
  'Fraunces',
  'Avenir',
  'Futura',
  'Gotham',
  'Proxima Nova',
  'Circular',
  'Gilroy',
  'Canela',
  'Tiempos',
  'Graphik',
  'Söhne',
  'Suisse',
  'IBM Plex Sans',
  'IBM Plex Serif',
  'IBM Plex Mono',
  'JetBrains Mono',
  'Fira Sans',
  'Cabin',
  'Rubik',
  'Karla',
  'Mulish',
  'Urbanist',
  'Outfit',
  'Lexend',
  'Sora',
  'Figtree',
  'Plus Jakarta Sans',
  'Libre Baskerville',
  'Cormorant',
  'Bodoni',
  'Didot',
  'Caslon',
  'Minion',
  'Palatino',
  'Calibri',
  'Cambria',
  'Verdana',
  'Tahoma',
  'Trebuchet',
  'Segoe UI',
  'SF Pro',
  'Courier',
  'Consolas',
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A line that reads like a heading for a section about voice. */
const VOICE_HEADING =
  /^(our |the |brand )?(tone of voice|voice and tone|voice & tone|brand voice|voice|tone|writing style|how we (write|sound|speak))$/i;

export function scanGuidelines(lines: GuideLine[]): Scan {
  const texts = lines.map((l) => l.text.trim());
  const whole = texts.join('\n');

  // ── colours ──
  const found = new Map<string, FoundColor>();
  const note = (hex: string, at: number) => {
    const lower = hex.toLowerCase();
    // the role and name come from the lines around the code: a swatch is a name, a role, then its codes
    const context = texts.slice(Math.max(0, at - 3), at + 1);
    // the nearest line that names a role wins, so a swatch isn't given the role of the one above it
    let role: ColorRole = 'other';
    for (let k = at; k >= Math.max(0, at - 3) && role === 'other'; k--) role = ROLE_WORDS.find(([re]) => re.test(texts[k]))?.[1] ?? 'other';
    const label =
      [...context].reverse().find((t) => t && t.length <= 32 && !/#|\bhex\b|\brgb\b|\bcmyk\b|\bpantone\b|\d{3}|\b[RGB]:?\s*\d/i.test(t)) ??
      '';
    const prior = found.get(lower);
    if (prior) prior.count++;
    else found.set(lower, { hex: lower, label, role, count: 1 });
  };
  texts.forEach((line, i) => {
    for (const m of line.matchAll(/#([0-9a-f]{6})\b/gi)) note(`#${m[1]}`, i);
    for (const m of line.matchAll(/\bhex\b[^0-9a-f#\n]{0,6}([0-9a-f]{6})\b/gi)) note(`#${m[1]}`, i);
    for (const m of line.matchAll(/\bR[:\s]*(\d{1,3})\D{1,4}G[:\s]*(\d{1,3})\D{1,4}B[:\s]*(\d{1,3})\b/g))
      note(hexOfRgb(+m[1], +m[2], +m[3]), i);
    for (const m of line.matchAll(/\brgb\b[:\s(]*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})/gi)) note(hexOfRgb(+m[1], +m[2], +m[3]), i);
  });
  const colors = [...found.values()].sort((a, b) => b.count - a.count);

  // ── typefaces ──
  const fonts: FoundFont[] = [];
  for (const name of TYPEFACES) {
    const count = [...whole.matchAll(new RegExp(`\\b${escapeRe(name)}\\b`, 'gi'))].length;
    if (!count) continue;
    const at = texts.findIndex((t) => new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(t));
    // the line that names it says what it is for; failing that, the lines just above
    let role: FoundFont['role'] = 'other';
    for (let k = at; k >= Math.max(0, at - 2) && role === 'other'; k--)
      role = /head|title|display/i.test(texts[k]) ? 'heading' : /body|text|paragraph|copy/i.test(texts[k]) ? 'body' : 'other';
    fonts.push({ name, count, role });
  }
  // "Helvetica Neue" also contains "Helvetica": keep the longer name when both are counted from the same place
  const kept = fonts.filter((f) => !fonts.some((g) => g !== f && g.name.includes(f.name) && g.count >= f.count));
  kept.sort((a, b) => b.count - a.count);

  // ── voice and rules ──
  let voice = '';
  const vi = texts.findIndex((t) => VOICE_HEADING.test(t));
  if (vi >= 0)
    voice = texts
      .slice(vi + 1, vi + 13)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 800);
  const rules = texts
    .filter((t) => /^(do|don['’]t|do not|never|always|avoid)\b[\s:,-]/i.test(t) && t.length > 8 && t.length < 200)
    .join('; ')
    .slice(0, 1500);

  // ── the brand's name: the biggest line on the first page, without "Brand Guidelines" after it ──
  const first = lines.filter((l) => l.page === lines[0]?.page);
  const biggest = first.sort((a, b) => b.size - a.size)[0]?.text.trim() ?? '';
  const name = biggest
    .replace(/\b(brand|style|identity|visual|design)?\s*(guidelines?|guide|book|manual|standards)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { name: name.slice(0, 80), colors, fonts: kept, voice, rules };
}

/** The roles a set of colours plays in a kit: the brand colour, an accent, text, background and dark. */
export function colorsToKit(colors: Array<{ hex: string; role: ColorRole }>): {
  brand?: string;
  accent?: string;
  text?: string;
  bg?: string;
  dark?: string;
} {
  const vivid = (hex: string) => {
    const [, s, l] = toHsl(hex);
    return s >= 0.25 && l >= 0.12 && l <= 0.9;
  };
  const byRole = (role: ColorRole) => colors.find((c) => c.role === role)?.hex;
  const brand = byRole('primary') ?? colors.find((c) => vivid(c.hex))?.hex;
  // a colour the guide gave another job (text, a background) isn't also the accent
  const accent = byRole('accent') ?? colors.find((c) => c.role === 'other' && c.hex !== brand && vivid(c.hex))?.hex;
  const text = byRole('text');
  const bg = byRole('bg');
  const dark = byRole('dark');
  return {
    brand,
    accent: accent && accent !== brand ? accent : undefined,
    text: text && toHsl(text)[2] < 0.35 ? text : undefined,
    bg: bg && toHsl(bg)[2] > 0.8 && bg.toLowerCase() !== '#ffffff' ? bg : undefined,
    dark: dark && toHsl(dark)[2] < 0.3 ? dark : undefined,
  };
}
