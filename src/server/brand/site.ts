import { toHex, toHsl } from '@shared/color';
import type { FONT_CHOICES } from '@shared/schema';

/**
 * Reading a brand off a website: the colours, typefaces, logo candidates and wording of a page's HTML and CSS. Everything
 * here works on text that has already been fetched, so it can be tried without a network. It is a heuristic (a page's
 * source is not a brand guide) and the result is shown to a person to correct before it is kept.
 */

type FontChoice = (typeof FONT_CHOICES)[number];

// ── Colours ─────────────────────────────────────────────────────────────────

const HEX = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/gi;
const RGB = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)/gi;
const HSL = /hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)/gi;

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const alphaOf = (a: string | undefined): number => (a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a));

/** Every opaque-enough colour written in a CSS value, as #rrggbb. */
export function colorsIn(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(HEX)) {
    let h = m[1].toLowerCase();
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 8 && parseInt(h.slice(6), 16) < 0x80) continue;
    out.push(`#${h.slice(0, 6)}`);
  }
  for (const m of value.matchAll(RGB)) {
    if (alphaOf(m[4]) < 0.5) continue;
    out.push(toHex([hex2(+m[1]), hex2(+m[2]), hex2(+m[3])]));
  }
  for (const m of value.matchAll(HSL)) {
    if (alphaOf(m[4]) < 0.5) continue;
    out.push(fromHslParts(+m[1], +m[2] / 100, +m[3] / 100));
  }
  return out;
}

function fromHslParts(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

interface Tally {
  score: number;
  /** Used as a text colour (`color:`) and as a background, counted separately. */
  text: number;
  bg: number;
}

/** A selector that is likely to be styled in the brand's own colour. */
const BRANDED = /btn|button|cta|primary|brand|accent|\ba\b|\ba:|link|badge|highlight|hero|nav/i;
const HEADING_SEL = /\bh[1-3]\b|heading|title|display|headline/i;
const BODY_SEL = /^\s*(?:html|body|:root|\*|p|main|article)\b|\bbody\b|\bp\b/i;

export interface CssFacts {
  colors: Map<string, Tally>;
  headingFonts: Map<string, number>;
  bodyFonts: Map<string, number>;
  fonts: Map<string, number>;
}

const GENERIC_FONTS = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'inherit',
  'initial',
  'unset',
  'revert',
  '-apple-system',
  'blinkmacsystemfont',
  'emoji',
  'math',
  'fangsong',
]);

const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

function familiesIn(value: string): string[] {
  return value
    .split(',')
    .map((f) =>
      f
        .replace(/!important/i, '')
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .trim(),
    )
    .filter((f) => f && !/^var\(/i.test(f));
}

/** What the CSS of a page says about colour and type, weighted by where it is used. */
export function analyseCss(sheets: string[], extraFonts: string[] = []): CssFacts {
  const facts: CssFacts = { colors: new Map(), headingFonts: new Map(), bodyFonts: new Map(), fonts: new Map() };
  const add = (hex: string, weight: number, role: 'text' | 'bg' | 'other') => {
    const t = facts.colors.get(hex) ?? { score: 0, text: 0, bg: 0 };
    t.score += weight;
    if (role === 'text') t.text += weight;
    if (role === 'bg') t.bg += weight;
    facts.colors.set(hex, t);
  };
  for (const name of extraFonts) bump(facts.fonts, name, 2);

  for (const sheet of sheets) {
    const css = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      const branded = BRANDED.test(selector);
      for (const decl of rule[2].split(';')) {
        const at = decl.indexOf(':');
        if (at < 1) continue;
        const prop = decl.slice(0, at).trim().toLowerCase();
        const value = decl.slice(at + 1);
        if (prop === 'font-family' || (prop.startsWith('--') && /font|family|typeface/.test(prop))) {
          const family = familiesIn(value).find((f) => !GENERIC_FONTS.has(f.toLowerCase()));
          if (!family) continue;
          bump(facts.fonts, family);
          const heading = HEADING_SEL.test(selector) || /heading|display|title/.test(prop);
          const body = BODY_SEL.test(selector) || /body|text|base|sans|primary/.test(prop);
          if (heading) bump(facts.headingFonts, family);
          else if (body) bump(facts.bodyFonts, family);
          continue;
        }
        const colors = colorsIn(value);
        if (!colors.length) continue;
        if (prop.startsWith('--')) {
          const weight = /primary|brand|accent|main|theme|highlight/.test(prop) ? 12 : /secondary|link|cta|button/.test(prop) ? 5 : 1;
          for (const c of colors)
            add(c, weight, /text|ink|foreground|fg/.test(prop) ? 'text' : /bg|background|surface/.test(prop) ? 'bg' : 'other');
        } else if (prop === 'color') for (const c of colors) add(c, branded ? 3 : 1, 'text');
        else if (/^background(-color)?$/.test(prop))
          for (const c of colors) add(c, branded ? 3 : /footer|dark|inverse|night/i.test(selector) ? 2 : 1, 'bg');
        else if (/^(border|outline)(-color)?$|^(fill|stroke)$/.test(prop)) for (const c of colors) add(c, branded ? 2 : 0.5, 'other');
      }
    }
  }
  return facts;
}

export interface BrandColors {
  brand: string;
  accent?: string;
  text?: string;
  bg?: string;
  dark?: string;
  notes: string[];
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** The brand colour and its companions out of what a site's CSS and metadata used. */
export function pickColors(facts: CssFacts, themeColor?: string): BrandColors {
  const notes: string[] = [];
  const entries = [...facts.colors.entries()].map(([hex, t]) => ({ hex, ...t, hsl: toHsl(hex) }));
  if (themeColor) {
    const hit = entries.find((e) => e.hex === themeColor);
    if (hit) hit.score += 6;
    else entries.push({ hex: themeColor, score: 6, text: 0, bg: 0, hsl: toHsl(themeColor) });
  }
  const vivid = entries
    .filter((e) => e.hsl[1] >= 0.25 && e.hsl[2] >= 0.12 && e.hsl[2] <= 0.9)
    .map((e) => ({ ...e, rank: e.score * (1 + 0.4 * e.hsl[1]) }))
    .sort((a, b) => b.rank - a.rank);

  let brand = vivid[0]?.hex;
  if (!brand) {
    const dark = entries.filter((e) => e.hsl[2] < 0.3).sort((a, b) => b.score - a.score)[0];
    brand = dark?.hex ?? '#111827';
    notes.push(
      'The site is mostly black and white, so its darkest text colour stands in as the brand colour. Change it if that’s not right.',
    );
  }
  const brandHue = toHsl(brand)[0];
  const second = vivid.find(
    (e) => e.hex !== brand && hueGap(e.hsl[0], brandHue) >= 35 && e.rank >= Math.max(2.5, (vivid[0]?.rank ?? 0) * 0.05),
  );

  // body text is dark; slate and navy inks are tinted, so saturation alone doesn't rule a colour out
  const ink = entries.filter((e) => e.hsl[2] < 0.25 && e.hsl[1] < 0.65 && e.text > 0).sort((a, b) => b.text - a.text)[0];
  const paper = entries.filter((e) => e.hsl[2] > 0.92 && e.bg > 0).sort((a, b) => b.bg - a.bg)[0];
  const night = entries.filter((e) => e.hsl[2] < 0.18 && e.bg >= 2).sort((a, b) => b.bg - a.bg)[0];
  return {
    brand,
    accent: second?.hex,
    text: ink?.hex,
    // plain white is what pages start from, so it isn't worth recording
    bg: paper && paper.hex !== '#ffffff' ? paper.hex : undefined,
    dark: night?.hex,
    notes,
  };
}

// ── Typefaces ───────────────────────────────────────────────────────────────

const TABLE: Array<[RegExp, FontChoice, FontChoice]> = [
  // [matches, as a heading, as body text]
  [/^inter\b/, 'inter', 'inter'],
  [/^manrope\b/, 'manrope', 'manrope'],
  [/^space grotesk\b/, 'space-grotesk', 'space-grotesk'],
  [/^fraunces\b/, 'fraunces', 'fraunces'],
  [/mono|courier|consolas|menlo|monaco|jetbrains|fira code|source code|plex mono|dm mono|roboto mono|sf mono/, 'mono', 'mono'],
  [
    /georgia|times|garamond|playfair|lora\b|merriweather|cormorant|baskerville|caslon|canela|tiempos|freight|source serif|pt serif|crimson|noto serif|dm serif|bodoni|didot|libre|spectral|newsreader|gt sectra|serif$/,
    'fraunces',
    'serif',
  ],
  [/grotesk|grotesque|neue machina|clash|general sans|söhne|sohne|suisse|neue haas|helvetica neue/, 'space-grotesk', 'inter'],
  [
    /poppins|montserrat|nunito|quicksand|dm sans|jakarta|urbanist|outfit|lexend|sora|figtree|gotham|proxima|avenir|circular|gilroy|brandon|futura|raleway|mulish|work sans|rubik|karla|cabin/,
    'manrope',
    'manrope',
  ],
  [/segoe|sf pro|system|apple/, 'system', 'system'],
];

/** The typeface we can serve that comes closest to one a brand uses. */
export function fontChoiceFor(family: string, role: 'heading' | 'body'): FontChoice {
  const f = family.toLowerCase().trim();
  const hit = TABLE.find(([re]) => re.test(f));
  return hit ? (role === 'heading' ? hit[1] : hit[2]) : 'inter';
}

const top = (m: Map<string, number>): string | undefined => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

export interface FontPick {
  heading?: FontChoice;
  body?: FontChoice;
  /** The names the site uses, for the kit's reference field. */
  names: string;
  notes: string[];
}

export function pickFonts(facts: CssFacts): FontPick {
  const headingName = top(facts.headingFonts) ?? top(facts.fonts);
  const bodyName = top(facts.bodyFonts) ?? top(facts.fonts);
  const heading = headingName ? fontChoiceFor(headingName, 'heading') : undefined;
  const body = bodyName ? fontChoiceFor(bodyName, 'body') : undefined;
  const names = [headingName && `Headings: ${headingName}`, bodyName && bodyName !== headingName ? `Body: ${bodyName}` : undefined]
    .filter(Boolean)
    .join('; ');
  const notes: string[] = [];
  if (headingName || bodyName) {
    const exact = (name: string | undefined, c: FontChoice | undefined) => !name || !c || name.toLowerCase().replace(/\s+/g, '-') === c;
    notes.push(
      exact(headingName, heading) && exact(bodyName, body)
        ? `Typefaces: ${names}.`
        : `Typefaces: ${names}. We can only serve our own typefaces, so the closest ones were picked (${[heading && `headings ${heading}`, body && `body ${body}`].filter(Boolean).join(', ')}).`,
    );
  } else notes.push('No typeface could be read from the site.');
  return { heading, body, names, notes };
}

/** Family names a Google Fonts link asks for. */
export function googleFontFamilies(urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    if (!/fonts\.googleapis\.com/i.test(u)) continue;
    for (const m of u.matchAll(/[?&]family=([^&:]+)/g)) out.push(decodeURIComponent(m[1].replace(/\+/g, ' ')));
  }
  return out;
}

// ── The page ────────────────────────────────────────────────────────────────

const unescapeHtml = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(+n, 0x10ffff)));

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g))
    out[m[1].toLowerCase()] = unescapeHtml(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

const tagsOf = (html: string, name: string): string[] => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];

function absolute(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface LogoCandidate {
  url: string;
  kind: 'logo-image' | 'touch-icon' | 'icon' | 'social-image';
  score: number;
}

export interface PageFacts {
  name: string;
  description: string;
  themeColor?: string;
  stylesheets: string[];
  inlineCss: string[];
  fontLinks: string[];
  logos: LogoCandidate[];
  /** Logos that can't be used (SVG, ICO), so the reader can say so. */
  unusableLogos: number;
  headings: string[];
  /** The visible words of the page, for describing how it sounds. */
  text: string;
}

const visible = (html: string) =>
  unescapeHtml(
    html
      .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

const USABLE_IMAGE = /\.(png|jpe?g|webp|gif)(?:[?#].*)?$/i;

export function readPage(html: string, pageUrl: string): PageFacts {
  const metas = tagsOf(html, 'meta').map(attrsOf);
  const meta = (key: string) => metas.find((m) => (m.property ?? m.name ?? '').toLowerCase() === key)?.content?.trim();
  const links = tagsOf(html, 'link').map(attrsOf);

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = titleTag ? unescapeHtml(titleTag).replace(/\s+/g, ' ').trim() : '';
  let host = '';
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    /* leave it empty */
  }
  const name =
    meta('og:site_name') ||
    meta('application-name') ||
    title
      .split(/\s[|–—·•-]\s|\s[|–—]\s/)
      .map((p) => p.trim())
      .filter(Boolean)
      .sort((a, b) => a.length - b.length)[0] ||
    host;

  const themeColorRaw = meta('theme-color') ?? meta('msapplication-tilecolor');
  const themeColor = themeColorRaw ? colorsIn(themeColorRaw)[0] : undefined;

  const stylesheets = links
    .filter((l) => (l.rel ?? '').toLowerCase().split(/\s+/).includes('stylesheet'))
    .map((l) => absolute(l.href, pageUrl))
    .filter((u): u is string => !!u && !/fonts\.googleapis\.com/i.test(u));
  const fontLinks = links.map((l) => absolute(l.href, pageUrl)).filter((u): u is string => !!u && /fonts\.googleapis\.com/i.test(u));
  const inlineCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).slice(0, 12);
  // styles written straight onto elements count as one more rule
  const styleAttrs = [...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).slice(0, 400);
  if (styleAttrs.length) inlineCss.push(`.inline{${styleAttrs.join(';')}}`);
  for (const m of html.matchAll(/@import\s+(?:url\()?['"]?([^'")\s]+)/gi)) {
    const u = absolute(m[1], pageUrl);
    if (u && /fonts\.googleapis\.com/i.test(u)) fontLinks.push(u);
  }

  const logos: LogoCandidate[] = [];
  let unusable = 0;
  const consider = (url: string | null, kind: LogoCandidate['kind'], score: number) => {
    if (!url) return;
    if (!USABLE_IMAGE.test(new URL(url).pathname + new URL(url).search) && !/^data:/.test(url)) {
      unusable++;
      return;
    }
    logos.push({ url, kind, score });
  };
  const headerEnd = Math.max(8000, html.search(/<\/header>/i) + 9);
  [...html.matchAll(/<img\b[^>]*>/gi)].slice(0, 80).forEach((m) => {
    const a = attrsOf(m[0]);
    const label = `${a.src ?? ''} ${a.alt ?? ''} ${a.class ?? ''} ${a.id ?? ''} ${a['data-src'] ?? ''}`;
    if (!/logo|brand|wordmark/i.test(label)) return;
    const size = Math.max(+(a.width ?? 0), +(a.height ?? 0));
    if (size > 0 && size < 12) return;
    consider(absolute(a.src || a['data-src'], pageUrl), 'logo-image', 10 + (m.index! < headerEnd ? 4 : 0));
  });
  for (const l of links) {
    const rel = (l.rel ?? '').toLowerCase();
    const size = parseInt((l.sizes ?? '').split('x')[0] ?? '0', 10) || 0;
    if (rel.includes('apple-touch-icon')) consider(absolute(l.href, pageUrl), 'touch-icon', 6 + Math.min(size, 200) / 100);
    else if (rel.split(/\s+/).includes('icon') || rel.includes('shortcut'))
      consider(absolute(l.href, pageUrl), 'icon', 2 + Math.min(size, 200) / 100);
  }
  const og = meta('og:image');
  if (og) consider(absolute(og, pageUrl), 'social-image', 1);
  logos.sort((a, b) => b.score - a.score);

  const headings = [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => visible(m[1]))
    .filter((h) => h.length > 2 && h.length < 160)
    .slice(0, 14);

  return {
    name: name.slice(0, 80),
    description: (meta('og:description') ?? meta('description') ?? '').slice(0, 400),
    themeColor,
    stylesheets: [...new Set(stylesheets)].slice(0, 8),
    inlineCss,
    fontLinks: [...new Set(fontLinks)],
    logos,
    unusableLogos: unusable,
    headings,
    text: visible(html).slice(0, 3500),
  };
}
