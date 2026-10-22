import { newBlock } from '@shared/blocks';
import { applyPreset, presetById, STYLE_PRESETS, type StylePreset } from '@shared/presets';
import { ICON_NAMES, PageSchema, ThemeSchema, type Block, type Page } from '@shared/schema';
import { normKey } from '@shared/template';
import { fitTo, stripUnknownTokens } from '../services/ai';
import type { Palette } from './raster';

/**
 * "Let Claude design the page": the model looks at every page of the PDF, reads what a machine extracted from it, and
 * answers with a plan built from our blocks. Everything here is the part around that call: the plan's shape, the
 * instructions, and turning a plan into a page we are willing to show someone.
 *
 * The plan is untrusted. It is checked against the document's own text (no figures that aren't in the PDF, wording that
 * stays close to it), every string is cleaned, every block is rebuilt from our own defaults, and anything doubtful makes
 * the whole plan be rejected so the rule-based import is used instead.
 */

// ── The plan ────────────────────────────────────────────────────────────────

export const PLAN_BLOCK_TYPES = [
  'text',
  'split',
  'features',
  'steps',
  'checklist',
  'stats',
  'testimonial',
  'callout',
  'table',
  'image',
  'faq',
  'cta',
] as const;
export type PlanBlockType = (typeof PLAN_BLOCK_TYPES)[number];
export const PLAN_BACKGROUNDS = ['default', 'alt', 'brand', 'dark'] as const;
export const HERO_LAYOUTS = ['split', 'centered', 'spotlight', 'cover', 'minimal'] as const;

/** A picture to use: one embedded in the PDF (by the id we gave it), or a region of a page (a chart, say) on a 0-1000 grid. */
export interface PlanImage {
  ref: string | null;
  page: number | null;
  box: number[] | null;
  alt: string | null;
}

export interface PlanItem {
  title: string | null;
  text: string | null;
  value: string | null;
  label: string | null;
  icon: string | null;
}

export interface PlanBlock {
  type: PlanBlockType;
  heading: string | null;
  eyebrow: string | null;
  /** The body, intro, statement, quote or caption, whichever the block has. */
  text: string | null;
  items: PlanItem[] | null;
  image: PlanImage | null;
  side: 'left' | 'right' | null;
  columns: number | null;
  rows: string[][] | null;
  header_row: boolean | null;
  name: string | null;
  role: string | null;
  company: string | null;
  attribution: string | null;
  button: string | null;
  bg: (typeof PLAN_BACKGROUNDS)[number] | null;
}

export interface DesignPlan {
  style: string;
  hero: {
    headline: string;
    subheadline: string | null;
    eyebrow: string | null;
    layout: string;
    image: PlanImage | null;
    bg: (typeof PLAN_BACKGROUNDS)[number] | null;
  };
  logo_text: string | null;
  seo_title: string | null;
  seo_description: string | null;
  blocks: PlanBlock[];
  notes: string[];
}

// ── The JSON schema the reply must follow (structured outputs: every object closed, every property required) ──

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const str = { type: 'string' };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const oneOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });

const imageSchema = nullable(
  object({
    ref: nullable(str),
    page: nullable({ type: 'integer' }),
    box: nullable({ type: 'array', items: { type: 'integer' } }),
    alt: nullable(str),
  }),
);
const itemSchema = object({ title: nullable(str), text: nullable(str), value: nullable(str), label: nullable(str), icon: nullable(str) });
const blockSchema = object({
  type: oneOf(PLAN_BLOCK_TYPES),
  heading: nullable(str),
  eyebrow: nullable(str),
  text: nullable(str),
  items: nullable({ type: 'array', items: itemSchema }),
  image: imageSchema,
  side: nullable(oneOf(['left', 'right'])),
  columns: nullable({ type: 'integer' }),
  rows: nullable({ type: 'array', items: { type: 'array', items: str } }),
  header_row: nullable({ type: 'boolean' }),
  name: nullable(str),
  role: nullable(str),
  company: nullable(str),
  attribution: nullable(str),
  button: nullable(str),
  bg: nullable(oneOf(PLAN_BACKGROUNDS)),
});

export const DESIGN_SCHEMA = object({
  style: oneOf(STYLE_PRESETS.map((p) => p.id)),
  hero: object({
    headline: str,
    subheadline: nullable(str),
    eyebrow: nullable(str),
    layout: oneOf(HERO_LAYOUTS),
    image: imageSchema,
    bg: nullable(oneOf(PLAN_BACKGROUNDS)),
  }),
  logo_text: nullable(str),
  seo_title: nullable(str),
  seo_description: nullable(str),
  blocks: { type: 'array', items: blockSchema },
  notes: { type: 'array', items: str },
});

// ── The instructions ────────────────────────────────────────────────────────

export const DESIGN_SYSTEM = `You are a senior web designer and conversion copywriter. You turn a PDF (a case study, one-pager, report, proposal, deck or whitepaper) into the landing page a salesperson sends to one prospect. The page is assembled from a fixed set of blocks, and a short personal line and the PDF download are added around it for you.

You receive:
- Pictures of the PDF's pages, in order. They are the truth about what the document says and how it is laid out.
- <text>: what a machine extracted, page by page, with the font size of each line ([28b] is 28 pt bold). Use it for exact wording and spelling. It can be in the wrong order where there are columns, scrambled inside tables and sidebars, split by hyphens, and missing wherever text is drawn as graphics. When it disagrees with the pictures, trust the pictures.
- <figures>: pictures embedded in the PDF, with where each sits on its page.

How to work:
1. Read the whole document first. Decide what it is for and what the reader should do after reading it.
2. Build the structure a good landing page would have from the document's own material. Reorder, merge and drop as needed. A page is not a transcript: lead with the promise, then proof, then how it works, then the call to action.
3. Pick the block that fits each piece of content:
   - text: prose with a heading. Never two text blocks in a row: merge them or change one.
   - split: a heading and short text beside a picture from the document (use side to alternate). Needs an image.
   - features: two to four parallel points, each a short title and one or two sentences. Give each an icon.
   - steps: an ordered process, method or timeline.
   - checklist: short points: what is included, requirements, takeaways.
   - stats: two to four headline numbers with a short label each. Copy the figure exactly as written.
   - testimonial: a customer quote (text) with name, role and company.
   - callout: one key statement set large: a pull quote, or a slide that is a single sentence.
   - table: a table from the document, cell for cell. At most 8 columns. The first row is the header.
   - image: a chart or diagram shown on its own, with a caption in text.
   - faq: questions and answers, in title and text.
   - cta: the closing call to action: a heading, one sentence of text and a button label. End with exactly one.
4. Fit the style to the document's tone, from: ${STYLE_PRESETS.map((p) => `${p.id} (${p.blurb})`).join('; ')}.
5. Choose a hero layout: split (picture beside the headline, the default), centered, spotlight (a soft glow, the picture in a window), cover (a full-width picture behind the headline, needs a hero image) or minimal (big type only). Leave the hero image empty to use the PDF's cover page.

Rules:
- Stay faithful. Use the document's own wording, shortened where a passage is long. Never invent facts, figures, names, quotes, customers, dates or claims. Every number on your page must be in the document.
- Leave out running headers and footers, page numbers, contents pages, copyright lines, "Prepared for ..." and confidentiality lines, and the contact details of a closing slide unless the cta needs them.
- Repair what extraction broke: hyphens at line ends, words split across columns, stray bullet characters, repeated lines.
- Keep merge fields such as {{first_name}} exactly as they appear in the document, and add none of your own.
- Aim for six to twelve blocks before the cta, with variety. Headings are short, specific and in sentence case. Headlines are at most 90 characters, sub-headlines at most 220.
- In text and split, text may use paragraphs separated by a blank line, "- " bullet lines and **bold**. Everywhere else it is plain text. No HTML, no markdown headings.
- Leave bg empty unless one section should stand out; use brand or dark for at most two blocks.
- For a picture, name an embedded figure by its id in ref, or give the page and a box (left, top, right, bottom on a 0-1000 grid of that page's picture) for something that is drawn rather than embedded, such as a chart or screenshot. Use pictures that add information, at most four, and never crop text.
- Icons come from: ${ICON_NAMES.join(', ')}.
- Write in the document's language.
- notes: up to four short, plain sentences for the author about choices you made, or things you could not read.`;

// ── What the model is shown ─────────────────────────────────────────────────

export interface PageText {
  page: number;
  width: number;
  height: number;
  lines: Array<{ size: number; bold: boolean; text: string }>;
}

export interface Figure {
  id: string;
  page: number;
  /** Position and size as a percentage of the page. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DesignInput {
  filename: string;
  pageCount: number;
  /** Pages sent as pictures. Other pages go as text only. */
  imagePages: number[];
  pages: PageText[];
  figures: Figure[];
  palette: Pick<Palette, 'brand' | 'brandCover' | 'dark' | 'found'>;
  tokens: string[];
}

const MAX_LINES_PER_PAGE = 90;
const MAX_TEXT_CHARS = 60_000;

const spans = (nums: number[]): string => {
  const out: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (nums[j + 1] === nums[j]! + 1) j++;
    out.push(j > i ? `${nums[i]}-${nums[j]}` : String(nums[i]));
    i = j;
  }
  return out.join(', ');
};

export function buildDesignPrompt(i: DesignInput): string {
  let budget = MAX_TEXT_CHARS;
  const pages = i.pages
    .map((p) => {
      const shown = p.lines.slice(0, MAX_LINES_PER_PAGE);
      let body = shown.map((l) => `[${Math.round(l.size)}${l.bold ? 'b' : ''}] ${l.text}`).join('\n');
      if (body.length > budget) body = `${body.slice(0, Math.max(0, budget))}\n…`;
      budget -= body.length;
      const more = p.lines.length - shown.length;
      const shape = p.width > p.height ? 'landscape' : 'portrait';
      return `=== Page ${p.page} of ${i.pageCount} (${shape}) ===\n${body || '(no text found: read it from the picture)'}${more > 0 ? `\n(… ${more} more lines not shown)` : ''}`;
    })
    .join('\n\n');
  const figures = i.figures.length
    ? i.figures
        .map(
          (f) => `${f.id}: page ${f.page}, at ${f.left}% from the left and ${f.top}% from the top, ${f.width}% wide and ${f.height}% tall`,
        )
        .join('\n')
    : '(none)';
  const sent =
    i.imagePages.length === i.pageCount
      ? 'every page is attached as a picture'
      : `pictures of pages ${spans(i.imagePages)} are attached; the other pages are text only`;
  return `<document>
File: ${i.filename}
Pages: ${i.pageCount} (${sent})
Brand colour found in the PDF: ${i.palette.brand}${i.palette.found ? '' : ' (a default: the PDF has no distinctive colour)'}${i.palette.brandCover ? '; the cover is that colour' : ''}${i.palette.dark ? '; the document itself is dark' : ''}
Merge fields found in the PDF: ${i.tokens.length ? i.tokens.map((t) => `{{${t}}}`).join(', ') : 'none'}
</document>

<text>
${pages}
</text>

<figures>
${figures}
</figures>

Design the page now.`;
}

// ── Reading the reply ───────────────────────────────────────────────────────

const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const asInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const oneIn = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

function readImage(v: unknown): PlanImage | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const box = Array.isArray(o.box) ? o.box.map(asInt) : null;
  return {
    ref: asString(o.ref),
    page: asInt(o.page),
    box: box && box.length === 4 && box.every((n) => n !== null) ? (box as number[]) : null,
    alt: asString(o.alt),
  };
}

/** The model's reply as a plan, or null when it isn't one. Nothing here is trusted yet: see `assemblePage`. */
export function readPlan(raw: unknown): DesignPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const hero = o.hero && typeof o.hero === 'object' ? (o.hero as Record<string, unknown>) : null;
  if (!hero || !Array.isArray(o.blocks)) return null;
  const blocks: PlanBlock[] = [];
  for (const b of o.blocks) {
    if (!b || typeof b !== 'object') continue;
    const x = b as Record<string, unknown>;
    const type = oneIn(x.type, PLAN_BLOCK_TYPES);
    if (!type) continue;
    blocks.push({
      type,
      heading: asString(x.heading),
      eyebrow: asString(x.eyebrow),
      text: asString(x.text),
      items: Array.isArray(x.items)
        ? x.items
            .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
            .map((it) => ({
              title: asString(it.title),
              text: asString(it.text),
              value: asString(it.value),
              label: asString(it.label),
              icon: asString(it.icon),
            }))
        : null,
      image: readImage(x.image),
      side: oneIn(x.side, ['left', 'right'] as const),
      columns: asInt(x.columns),
      rows: Array.isArray(x.rows)
        ? x.rows.filter(Array.isArray).map((r) => (r as unknown[]).map((c) => (typeof c === 'string' ? c : '')))
        : null,
      header_row: typeof x.header_row === 'boolean' ? x.header_row : null,
      name: asString(x.name),
      role: asString(x.role),
      company: asString(x.company),
      attribution: asString(x.attribution),
      button: asString(x.button),
      bg: oneIn(x.bg, PLAN_BACKGROUNDS),
    });
  }
  return {
    style: asString(o.style) ?? 'clean',
    hero: {
      headline: asString(hero.headline) ?? '',
      subheadline: asString(hero.subheadline),
      eyebrow: asString(hero.eyebrow),
      layout: asString(hero.layout) ?? 'split',
      image: readImage(hero.image),
      bg: oneIn(hero.bg, PLAN_BACKGROUNDS),
    },
    logo_text: asString(o.logo_text),
    seo_title: asString(o.seo_title),
    seo_description: asString(o.seo_description),
    blocks,
    notes: Array.isArray(o.notes) ? o.notes.filter((n): n is string => typeof n === 'string' && !!n.trim()) : [],
  };
}

// ── Checking against the document ───────────────────────────────────────────

/** "$1.2M" → "12m": letters and digits only, so "$1.2 million" and "$1.2M" agree on their first characters. */
const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const NUMBER = /(?:[$€£]\s?)?\d[\d.,]*(?:\s?(?:%|x|×|k|m|bn|b|million|billion)\b|\s?%)?/giu;

/** The figures in a text worth checking: two or more digits, or a unit. A lone "1" in a list is not a claim. */
export function figuresIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map(compact).filter((k) => k.replace(/\D/g, '').length >= 2 || (/\d/.test(k) && /\p{L}/u.test(k)));
}

const wordsOf = (text: string): string[] => (text.toLowerCase().match(/\p{L}{5,}/gu) ?? []).filter(Boolean);

export interface Source {
  /** All the text extracted from the PDF. */
  text: string;
  /** Merge fields found in the PDF (normalised names). */
  tokens: string[];
}

export class PlanRejected extends Error {}

// ── Making a page ───────────────────────────────────────────────────────────

export interface AssembleOptions {
  source: Source;
  palette: Pick<Palette, 'brand' | 'brandCover' | 'dark'>;
  /** The asset id for a picture the plan asked for, or null when it couldn't be made. */
  imageFor(pick: PlanImage | null): string | null;
  /** What a plain rule-based reading of the PDF would have chosen, for when the plan doesn't say. */
  fallbackLogo?: string;
  fallbackStyle: StylePreset;
}

export interface Assembled {
  page: Page;
  /** What the page was built from, for the author. */
  notes: string[];
  /** Blocks left out, and why. */
  dropped: string[];
}

const MAX_CONTENT_BLOCKS = 12;
/** Icons for features the plan didn't give one to: a few that suit almost anything. */
const FALLBACK_ICONS = ['zap', 'target', 'sparkles', 'shield', 'rocket', 'layers'];
const HERO_BADGE = 'Prepared for {{first_name|you}} at {{company|your team}}';

const cleanLine = (v: unknown, max: number): string =>
  fitTo(
    (typeof v === 'string' ? v : '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^#+\s+/, '')
      .trim(),
    max,
  );

/** Paragraphs, "- " bullets and **bold** survive; markup, headings marks and runs of blank lines don't. */
const cleanRich = (v: unknown, max: number): string => {
  const s = (typeof v === 'string' ? v : '')
    .replace(/\r\n?/g, '\n')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/^ +| +$/gm, '')
    .replace(/^#+\s+/gm, '')
    .replace(/^[•●▪■◦○·‣⁃▸►]\s*/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length <= max) return s;
  // cut between paragraphs where possible, so a list isn't left ending in the middle of an item
  const cut = s.slice(0, max);
  const para = cut.lastIndexOf('\n\n');
  return para > max * 0.5 ? cut.slice(0, para).trim() : fitTo(cut, max);
};

/** The words of a block, for checking against the document: not its icon names or other settings. */
const SETTINGS = new Set(['icon', 'style', 'width', 'layout', 'media']);
const allStrings = (b: Block): string[] => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!SETTINGS.has(k)) walk(x);
  };
  const {
    id: _id,
    type: _t,
    anchor: _a,
    bg: _b,
    pad: _p,
    align: _al,
    image: _i,
    side: _s,
    columns: _c,
    ...rest
  } = b as Block & Record<string, unknown>;
  walk(rest);
  return out;
};

export function assemblePage(plan: DesignPlan, opts: AssembleOptions): Assembled {
  const headline = cleanLine(plan.hero.headline, 240);
  if (!headline) throw new PlanRejected('the plan has no headline');

  const known = new Set(opts.source.tokens.map(normKey));
  const sourceCompact = compact(opts.source.text);
  const sourceWords = new Set(wordsOf(opts.source.text));
  const hasSource = sourceWords.size >= 60;
  const dropped: string[] = [];

  /** A string for the page: cleaned, with any merge field the PDF didn't have taken out. */
  const line = (v: unknown, max: number): string => stripUnknownTokens(cleanLine(v, max), known).text.trim();
  const rich = (v: unknown, max: number): string => stripUnknownTokens(cleanRich(v, max), known).text.trim();
  const opt = (s: string): string | undefined => s || undefined;

  const built: Block[] = [];
  let pictures = 0;
  const picture = (pick: PlanImage | null, fallbackAlt: string) => {
    if (!pick || pictures >= 4) return null;
    const src = opts.imageFor(pick);
    if (!src) return null;
    pictures++;
    return { src, alt: line(pick.alt ?? fallbackAlt, 200) };
  };

  for (const pb of plan.blocks) {
    if (built.length >= MAX_CONTENT_BLOCKS) {
      dropped.push('some blocks beyond the first twelve');
      break;
    }
    const heading = line(pb.heading, 240);
    const eyebrow = line(pb.eyebrow, 120);
    const bg = pb.bg && pb.bg !== 'default' ? pb.bg : undefined;
    const items = pb.items ?? [];
    let block: Block | null = null;

    switch (pb.type) {
      case 'text': {
        const body = rich(pb.text, 6000);
        if (body) block = newBlock('text', { heading: opt(heading), body, bg } as Partial<Block>);
        break;
      }
      case 'split': {
        const body = rich(pb.text, 3000);
        if (!body && !heading) break;
        const img = picture(pb.image, heading);
        if (!img) block = newBlock('text', { heading: opt(heading), body: body || heading, bg } as Partial<Block>);
        else
          block = newBlock('split', {
            eyebrow: opt(eyebrow),
            heading: opt(heading),
            body,
            image: img,
            side: pb.side ?? 'right',
            bg,
          } as Partial<Block>);
        break;
      }
      case 'features': {
        const rows = items
          .map((it) => ({
            title: line(it.title, 160),
            text: line(it.text, 600),
            icon: it.icon && (ICON_NAMES as readonly string[]).includes(it.icon) ? it.icon : undefined,
          }))
          .filter((it) => it.title);
        if (rows.length < 2) {
          // one point on its own reads better as prose
          const lone = rows[0];
          if (lone) block = newBlock('text', { heading: opt(heading) ?? lone.title, body: lone.text || lone.title, bg } as Partial<Block>);
          break;
        }
        const list = rows
          .slice(0, 6)
          .map((it, i) => ({ icon: it.icon ?? FALLBACK_ICONS[i % FALLBACK_ICONS.length]!, title: it.title, text: it.text }));
        const columns = list.length === 2 ? 2 : list.length === 4 ? 4 : 3;
        block = newBlock('features', { heading: opt(heading), intro: opt(line(pb.text, 600)), columns, items: list, bg } as Partial<Block>);
        break;
      }
      case 'steps': {
        const rows = items.map((it) => ({ title: line(it.title, 160), text: opt(line(it.text, 500)) })).filter((it) => it.title);
        if (rows.length >= 2)
          block = newBlock('steps', {
            heading: opt(heading),
            intro: opt(line(pb.text, 600)),
            items: rows.slice(0, 8),
            bg,
          } as Partial<Block>);
        break;
      }
      case 'checklist': {
        const rows = items.map((it) => line(it.title ?? it.text, 400)).filter(Boolean);
        if (rows.length >= 2)
          block = newBlock('checklist', {
            heading: opt(heading),
            intro: opt(line(pb.text, 600)),
            style: 'check',
            items: rows.slice(0, 14),
            bg,
          } as Partial<Block>);
        break;
      }
      case 'stats': {
        const rows = items
          .map((it) => ({ value: line(it.value, 24), label: line(it.label ?? it.title, 160) }))
          .filter((it) => it.value && it.label);
        if (rows.length >= 2) block = newBlock('stats', { heading: opt(heading), items: rows.slice(0, 4), bg } as Partial<Block>);
        break;
      }
      case 'testimonial': {
        const quote = line(pb.text, 800);
        if (quote)
          block = newBlock('testimonial', {
            quote,
            name: opt(line(pb.name, 120)),
            role: opt(line(pb.role, 120)),
            company: opt(line(pb.company, 120)),
            bg,
          } as Partial<Block>);
        break;
      }
      case 'callout': {
        const text = line(pb.text ?? pb.heading, 600);
        if (text)
          block = newBlock('callout', { eyebrow: opt(eyebrow), text, attribution: opt(line(pb.attribution, 160)), bg } as Partial<Block>);
        break;
      }
      case 'table': {
        const rows = (pb.rows ?? [])
          .map((r) => r.slice(0, 8).map((c) => line(c, 200)))
          .filter((r) => r.some(Boolean))
          .slice(0, 40);
        if (rows.length >= 2 && Math.max(...rows.map((r) => r.length)) >= 2)
          block = newBlock('table', {
            heading: opt(heading),
            intro: undefined,
            rows,
            header: pb.header_row ?? true,
            caption: opt(line(pb.text, 300)),
            bg,
          } as Partial<Block>);
        break;
      }
      case 'image': {
        const img = picture(pb.image, heading || pb.text || 'Figure');
        if (img)
          block = newBlock('image', { image: img, caption: opt(line(pb.text ?? pb.heading, 300)), width: 'content', bg } as Partial<Block>);
        break;
      }
      case 'faq': {
        const rows = items.map((it) => ({ q: line(it.title, 300), a: rich(it.text, 2000) })).filter((it) => it.q && it.a);
        if (rows.length >= 1) block = newBlock('faq', { heading: opt(heading), items: rows.slice(0, 15), bg } as Partial<Block>);
        break;
      }
      case 'cta':
        break; // the closing call to action is built below, once
    }
    if (!block) {
      if (pb.type !== 'cta') dropped.push(`an empty or unusable ${pb.type} block`);
      continue;
    }

    // a figure the document doesn't contain is the one mistake that would embarrass someone in front of a prospect
    const claimed = figuresIn(allStrings(block).join(' '));
    const invented = hasSource ? claimed.filter((k) => !sourceCompact.includes(k)) : [];
    if (invented.length) {
      if (block.type === 'stats') {
        const keep = block.items.filter((it) => figuresIn(`${it.value} ${it.label}`).every((k) => sourceCompact.includes(k)));
        if (keep.length >= 2) {
          block.items = keep;
          dropped.push('a figure that is not in the PDF');
          built.push(block);
          continue;
        }
      }
      dropped.push(`a ${pb.type} block with figures that are not in the PDF`);
      continue;
    }
    built.push(block);
  }

  const lostShare = plan.blocks.length ? dropped.length / plan.blocks.length : 0;
  if (built.length < 2) throw new PlanRejected('too little of the plan could be used');
  if (lostShare > 0.35) throw new PlanRejected('too many blocks had to be dropped');

  // wording must stay close to the document: a page made of words that aren't in the PDF is a made-up page
  if (hasSource) {
    const mine = new Set(wordsOf(built.flatMap(allStrings).join(' ')));
    if (mine.size >= 20) {
      let found = 0;
      for (const w of mine) if (sourceWords.has(w)) found++;
      if (found / mine.size < 0.6) throw new PlanRejected('its wording strayed too far from the document');
    }
  }

  // ── the hero, the closing call to action and the form, which every imported page has ──
  const heroImage = picture(plan.hero.image, headline);
  const layoutAsked = oneIn(plan.hero.layout, HERO_LAYOUTS) ?? 'split';
  const layout = layoutAsked === 'cover' && !heroImage ? 'split' : layoutAsked;
  // the plan's choice if it made one (even "plain"), otherwise what the cover suggests
  const heroBg =
    plan.hero.bg === null
      ? opts.palette.brandCover
        ? 'brand'
        : opts.palette.dark
          ? 'dark'
          : undefined
      : plan.hero.bg === 'default'
        ? undefined
        : plan.hero.bg;
  const hero = newBlock('hero', {
    badge: HERO_BADGE,
    eyebrow: opt(line(plan.hero.eyebrow, 120)),
    headline,
    subheadline: opt(line(plan.hero.subheadline, 400)),
    primary: { label: 'Download the PDF', action: { type: 'document' } },
    secondary: { label: 'Talk to us', action: { type: 'anchor', anchor: 'contact' } },
    ...(heroImage ? { image: heroImage, show_document: false } : { show_document: true }),
    layout,
    bg: heroBg,
  } as Partial<Block>);

  const asked = plan.blocks.find((b) => b.type === 'cta');
  const cta = newBlock('cta', {
    anchor: 'contact',
    heading: opt(line(asked?.heading, 240)) ?? 'Ready to talk, {{first_name|friend}}?',
    text: opt(line(asked?.text, 600)) ?? 'Book a short call and we’ll walk you through it.',
    button: { label: opt(line(asked?.button, 80)) ?? 'Get in touch', action: { type: 'form' } },
    bg: asked?.bg && asked.bg !== 'default' ? asked.bg : 'default',
  } as Partial<Block>);

  // alternate soft backgrounds for rhythm, leaving anything the plan chose alone
  let flip = false;
  for (const b of built) {
    if (b.type === 'testimonial') continue;
    if (flip && !b.bg) b.bg = 'alt';
    flip = !flip;
  }

  const preset = presetById(plan.style) ?? opts.fallbackStyle;
  const theme = applyPreset(ThemeSchema.parse({ brand: opts.palette.brand }), preset);
  const headlinePlain = headline.replace(/\{\{[^}]*\}\}/g, '').trim() || headline;
  const page = PageSchema.parse({
    theme,
    blocks: [hero, ...built, cta, newBlock('form', { bg: 'alt' })],
    header: {
      enabled: true,
      logo_text: opt(line(plan.logo_text, 60)) ?? opts.fallbackLogo,
      button: { label: 'Download PDF', action: { type: 'document' } },
      sticky: false,
    },
    footer: { text: '', links: [] },
    seo: {
      title: line(plan.seo_title, 160) || `${headlinePlain} — prepared for {{company|you}}`,
      description: line(plan.seo_description, 200),
      noindex: true,
      lang: 'en',
    },
  });
  const notes = plan.notes
    .slice(0, 4)
    .map((n) => cleanLine(n, 200))
    .filter(Boolean);
  return { page, notes, dropped: [...new Set(dropped)] };
}
