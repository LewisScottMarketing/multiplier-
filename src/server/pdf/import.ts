import { newBlock, newBlockId } from '@shared/blocks';
import { PageSchema, type Block, type Page } from '@shared/schema';
import type { ExtractedDoc, PageImage, PageInfo, Run } from './extract';
import type { Palette } from './raster';

/**
 * PDF → landing page, using structure rather than raw text: font sizes decide what is a headline,
 * a heading or body copy; geometry decides what is a list, a stat row or a numbered process.
 * It is deliberately conservative: a wrong guess becomes a plain text block the author can edit,
 * never a broken page.
 */

export interface Line {
  page: number;
  text: string;
  x: number;
  /** Where the text starts once a leading bullet/number glyph is skipped (continuation lines align here). */
  textX: number;
  x2: number;
  y: number;
  h: number;
  baseline: number;
  size: number;
  bold: boolean;
  italic: boolean;
  /** First run was bold (a "bold lead-in" like "Capture. Pull accounts…"). */
  boldLead: boolean;
  boldLeadText: string;
  runs: Run[];
  idx: number;
}

export interface ImportOptions {
  filename: string;
  /** Called for the images chosen to appear on the page; returns an asset id (or null to skip). */
  saveImage?: (img: PageImage) => Promise<string | null>;
}

export interface ImportResult {
  page: Page;
  report: string[];
}

// ── Lines ───────────────────────────────────────────────────────────────────

export function buildLines(doc: ExtractedDoc): Line[] {
  const lines: Line[] = [];
  for (const pg of doc.pages) {
    // PDFs don't paint in reading order (Chromium draws list bullets after the list text), so cluster
    // runs by baseline and horizontal proximity, then restore reading order from the stream position.
    const sorted = [...pg.runs].sort((a, b) => (Math.abs(a.baseline - b.baseline) < Math.max(a.size, b.size) * 0.3 ? a.x - b.x : a.baseline - b.baseline));
    const groups: Run[][] = [];
    for (const r of sorted) {
      const g = groups.find((grp) => {
        const last = grp[grp.length - 1];
        return Math.abs(last.baseline - r.baseline) < Math.max(last.size, r.size) * 0.3 && r.x - (last.x + last.w) < Math.max(last.size, r.size) * 1.2 && r.x >= last.x - 2;
      });
      if (g) g.push(r);
      else groups.push([r]);
    }
    const built = groups.map((runs): { line: Line } => {
      runs.sort((a, b) => a.x - b.x);
      let text = runs[0].text;
      for (let i = 1; i < runs.length; i++) {
        const gap = runs[i].x - (runs[i - 1].x + runs[i - 1].w);
        text += (gap > 0.08 * runs[i].size ? ' ' : '') + runs[i].text;
      }
      const glyph = runs.length > 1 && GLYPH_RE.test(runs[0].text.trim());
      const body = glyph ? runs.slice(1) : runs;
      const mixed = body.length > 1 && body[0].bold && !body.every((r) => r.bold);
      return {
        line: {
          page: pg.page,
          text,
          x: runs[0].x,
          textX: body[0].x,
          x2: Math.max(...runs.map((r) => r.x + r.w)),
          y: Math.min(...runs.map((r) => r.y)),
          h: Math.max(...runs.map((r) => r.h)),
          baseline: runs[0].baseline,
          size: Math.max(...runs.map((r) => r.size)),
          bold: runs.every((r) => r.bold),
          italic: runs.every((r) => r.italic),
          boldLead: mixed,
          boldLeadText: mixed ? body.filter((r, i) => r.bold && body.slice(0, i).every((p) => p.bold)).map((r) => r.text).join(' ') : '',
          runs,
          idx: 0,
        },
      };
    });
    for (const line of readingOrder(built.map((b) => b.line), pg.width)) {
      line.idx = lines.length;
      lines.push(line);
    }
  }
  return lines;
}

/**
 * Reading order from geometry, not paint order (PDF producers paint in arbitrary order). Top to bottom,
 * except on two-column pages, where a full-width line closes the current band and each band reads
 * left column then right column.
 */
export function readingOrder(lines: Line[], pageWidth: number): Line[] {
  const byY = [...lines].sort((a, b) => (Math.abs(a.baseline - b.baseline) < Math.max(a.size, b.size) * 0.3 ? a.x - b.x : a.baseline - b.baseline));
  if (lines.length < 8) return byY;
  let gutter: number | null = null;
  for (let g = pageWidth * 0.3; g <= pageWidth * 0.7; g += 4) {
    const crossing = lines.filter((l) => l.x < g - 2 && l.x2 > g + 2 && l.x2 - l.x < pageWidth * 0.6).length;
    const left = lines.filter((l) => l.x2 <= g + 2).length;
    const right = lines.filter((l) => l.x >= g - 2).length;
    if (crossing === 0 && left >= lines.length * 0.25 && right >= lines.length * 0.25) {
      gutter = g;
      break;
    }
  }
  if (gutter === null) return byY;
  const out: Line[] = [];
  let left: Line[] = [];
  let right: Line[] = [];
  for (const l of byY) {
    if (l.x < gutter - 2 && l.x2 > gutter + 2) {
      out.push(...left, ...right, l);
      left = [];
      right = [];
    } else (l.x >= gutter - 2 ? right : left).push(l);
  }
  return [...out, ...left, ...right];
}

function modeSize(lines: Line[]): number {
  const w = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    w.set(k, (w.get(k) ?? 0) + l.text.length);
  }
  return [...w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
}

const norm = (s: string) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

/**
 * Running headers/footers and page numbers: text near the top or bottom edge that is a page number,
 * legal boilerplate, or repeated on several pages. The legal line is kept as the page footer.
 */
function dropFurniture(lines: Line[], pages: PageInfo[]): { kept: Line[]; footer: string } {
  const edge = (l: Line) => {
    const pg = pages[l.page - 1];
    return l.y < pg.height * 0.075 || l.y + l.h > pg.height * 0.925;
  };
  const byKey = new Map<string, Set<number>>();
  for (const l of lines) {
    if (!edge(l)) continue;
    const key = `${norm(l.text)}@${l.y < pages[l.page - 1].height / 2 ? 'top' : 'bottom'}`;
    byKey.set(key, (byKey.get(key) ?? new Set()).add(l.page));
  }
  const drop = new Set<Line>();
  let footer = '';
  for (const l of lines) {
    if (!edge(l)) continue;
    const t = l.text.trim();
    const pageNumber = /^(page\s*)?\d{1,3}(\s*(of|\/)\s*\d{1,3})?$/i.test(t) || /\bpage\s+\d+\s+of\s+\d+\b/i.test(t);
    const legal = /©|copyright|all rights reserved|registered (in|office)/i.test(t);
    const repeated = pages.length >= 2 && (byKey.get(`${norm(t)}@${l.y < pages[l.page - 1].height / 2 ? 'top' : 'bottom'}`)?.size ?? 0) >= Math.min(pages.length, Math.max(2, Math.ceil(pages.length * 0.5)));
    if (pageNumber || legal || repeated) {
      drop.add(l);
      if (legal && !footer) footer = cleanText(t);
    }
  }
  return { kept: lines.filter((l) => !drop.has(l)), footer };
}

// ── Paragraphs, lists ───────────────────────────────────────────────────────

const GLYPH_RE = /^(?:[•●▪■◦○·‣⁃▸►✓✔➤→*–—-]|\d{1,2}[.)])$/;
const QUOTE_OPEN = /^[“"‘'«]/;
const ATTRIB = /^[—–-]\s*(.+)$/;
const BULLET_RE = /^\s*(?:[•●▪■◦○·‣⁃▸►✓✔➤→]|[-–—*])\s+/;
const NUMBER_RE = /^\s*(\d{1,2})[.)]\s+/;

export interface Para {
  kind: 'para' | 'bullet' | 'number';
  text: string;
  lead?: string;
  size: number;
  italic: boolean;
  bold: boolean;
  x: number;
  y: number;
  page: number;
  lines: Line[];
  num?: number;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/(\w)- (\w)/g, (m, a: string, b: string) => (/[a-z]/.test(a) && /[a-z]/.test(b) ? `${a}${b}` : m)).trim();
}

/** Group lines into paragraphs and list items. */
export function buildParas(lines: Line[], body: number, bodyX: number, colRight: number): Para[] {
  const paras: Para[] = [];
  let cur: Para | null = null;
  let prev: Line | null = null;
  const finish = () => {
    if (cur) {
      cur.text = cleanText(cur.text);
      if (cur.text) paras.push(cur);
    }
    cur = null;
  };
  for (const l of lines) {
    const bullet = BULLET_RE.test(l.text);
    const numbered = NUMBER_RE.exec(l.text);
    const indentedNoBullet = l.x >= bodyX + body * 0.8 && Math.abs(l.size - body) < body * 0.25 && !!prev && l.page === prev.page && !!cur && cur.lines.length === 1;
    let startsNew = !cur || !prev;
    if (cur && prev) {
      const gap = l.y - (prev.y + prev.h);
      const samePage = l.page === prev.page;
      const prevWrapped = prev.x2 >= colRight * 0.9;
      const endsSentence = /[.!?:”")]$/.test(prev.text.trim());
      const startsUpper = /^[A-Z“"(0-9]/.test(l.text.trim());
      const indentChange = Math.abs(l.x - prev.x) > body * 0.7 && Math.abs(l.x - prev.textX) > body * 0.7;
      startsNew =
        !samePage ||
        bullet ||
        !!numbered ||
        gap > body * 0.55 ||
        Math.abs(l.size - prev.size) > 0.8 ||
        l.bold !== prev.bold && !l.boldLead && !prev.boldLead ||
        indentChange ||
        (indentedNoBullet && !prevWrapped) ||
        (!prevWrapped && endsSentence && startsUpper);
    }
    if (startsNew) {
      finish();
      cur = {
        kind: bullet ? 'bullet' : numbered ? 'number' : 'para',
        text: l.text.replace(BULLET_RE, '').replace(numbered ? NUMBER_RE : /^$/, ''),
        lead: l.boldLead ? l.boldLeadText.replace(BULLET_RE, '').replace(NUMBER_RE, '') : undefined,
        size: l.size,
        italic: l.italic,
        bold: l.bold,
        x: l.x,
        y: l.y,
        page: l.page,
        lines: [l],
        num: numbered ? Number(numbered[1]) : undefined,
      };
    } else if (cur) {
      cur.text += ' ' + l.text;
      cur.lines.push(l);
    }
    prev = l;
  }
  finish();
  markIndentedLists(paras, body, bodyX);
  return paras;
}

/**
 * Lists drawn with vector bullets (Word, Chrome, Google Docs) have no bullet character, only an
 * indent. A run of 3+ short items sharing one indent is a list; a single indented paragraph is just
 * a boxed call-out and stays prose.
 */
function markIndentedLists(paras: Para[], body: number, bodyX: number) {
  let i = 0;
  while (i < paras.length) {
    const indented = (p: Para) => p.kind === 'para' && p.x >= bodyX + body * 0.8 && p.lines.length <= 2 && !p.italic && !QUOTE_OPEN.test(p.text);
    if (!indented(paras[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < paras.length && indented(paras[j + 1]) && Math.abs(paras[j + 1].x - paras[i].x) < 3 && paras[j + 1].page === paras[i].page) j++;
    if (j - i + 1 >= 3) for (let k = i; k <= j; k++) paras[k].kind = 'bullet';
    i = j + 1;
  }
}

// ── Section analysis ────────────────────────────────────────────────────────

interface Section {
  heading: string;
  page: number;
  lines: Line[];
}

const STAT_RE = /^[$£€]?\s?\d[\d,.]*\s?(?:%|x|X|×|[kKmMbB]\b|\+|bn|million|billion|hrs?|days?|mins?|pts?|\/\w+)*\+?$/;

interface Stat {
  value: string;
  label: string;
  x: number;
  used: Line[];
}

function findStats(lines: Line[], body: number): Stat[] {
  const stats: Stat[] = [];
  for (const l of lines) {
    if (l.size < body * 1.4 || !STAT_RE.test(l.text.trim())) continue;
    // label: the nearest smaller line just below, roughly aligned
    const label = lines.find((c) => c.page === l.page && c.y > l.y && c.y - (l.y + l.h) < l.size * 1.2 && Math.abs(c.x - l.x) < Math.max(20, l.size) && c.size < l.size * 0.7 && !STAT_RE.test(c.text.trim()));
    if (label) stats.push({ value: l.text.trim(), label: cleanText(label.text), x: l.x, used: [l, label] });
  }
  return stats.length >= 2 ? stats.sort((a, b) => a.x - b.x).slice(0, 6) : [];
}


const ICON_HINTS: Array<[RegExp, string]> = [
  [/grow|revenue|increase|lift|scale|pipeline|sales|roi/i, 'trending-up'],
  [/secur|compliance|privacy|trust|safe|risk/i, 'shield'],
  [/team|people|customer|buyer|audience|collaborat|partner/i, 'users'],
  [/time|fast|speed|quick|save|hour|minute|week/i, 'clock'],
  [/target|focus|segment|persona|relevan|personal|specific/i, 'target'],
  [/data|insight|analy|report|measure|track/i, 'chart'],
  [/email|message|outreach|communicat/i, 'mail'],
  [/automat|integrat|workflow|connect/i, 'zap'],
  [/idea|strategy|plan|creative/i, 'lightbulb'],
  [/launch|start|begin|ship/i, 'rocket'],
];
const FALLBACK_ICONS = ['zap', 'target', 'sparkles', 'shield', 'rocket', 'layers', 'compass', 'puzzle'];

function iconFor(text: string, i: number): string {
  return ICON_HINTS.find(([re]) => re.test(text))?.[1] ?? FALLBACK_ICONS[i % FALLBACK_ICONS.length];
}

const CTA_HEADING = /ready|get started|contact|next step|talk to|talk with|book|let.?s|speak|reach out|demo|questions\??$/i;
const CTA_TEXT = /contact|book|schedule|call|demo|talk|reach|get in touch|email us|visit|learn more|sign up/i;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|co|ai|net|org|app|dev|uk|de|fr|nl|ca|au|us|eu|co\.uk)(?:\/[^\s)]*)?/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function titleize(s: string): string {
  const t = s.replace(/[.:]+$/, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function splitLead(text: string): [string, string] {
  const m = text.match(/^(.{3,80}?)(?:\.\s+|:\s+|\s[–—-]\s+)(.+)$/);
  return m ? [m[1], m[2]] : [text, ''];
}

const truncate = (s: string, max: number) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
};

function blocksFromSection(sec: Section, body: number, bodyX: number, colRight: number, urls: string[], notes: { shortened: number }): Block[] {
  const blocks: Block[] = [];
  const heading = cleanText(sec.heading);
  let lines = sec.lines;

  // stats
  const stats = findStats(lines, body);
  if (stats.length) {
    const used = new Set(stats.flatMap((s) => s.used));
    lines = lines.filter((l) => !used.has(l));
  }

  const paras = buildParas(lines, body, bodyX, colRight);

  // testimonial
  const qi = paras.findIndex((p) => QUOTE_OPEN.test(p.text) && /[”"’']\s*$/.test(p.text.replace(/\s*[—–-].*$/, '')) || (QUOTE_OPEN.test(p.text) && p.italic));
  let testimonial: Block | null = null;
  if (qi >= 0) {
    const q = paras[qi];
    const attribInline = q.text.match(/^([\s\S]+?[”"’'])\s*[—–-]\s*(.+)$/);
    let quote = q.text;
    let who = '';
    if (attribInline) {
      quote = attribInline[1];
      who = attribInline[2];
    } else {
      const next = paras[qi + 1];
      const looksLikeAttribution = !!next && next.page === q.page && (ATTRIB.test(next.text) || next.italic || (next.text.length <= 100 && next.size <= q.size + 0.5 && /^[^,]+,[^,]+(,[^,]+)?$/.test(next.text.trim()) && !/[.!?]$/.test(next.text.trim())));
      if (next && looksLikeAttribution) {
        who = next.text.replace(ATTRIB, '$1').replace(/^[^\p{L}\p{N}]+/u, '').trim();
        paras.splice(qi + 1, 1);
      }
    }
    const [name, role, company] = who.split(',').map((x) => x.trim());
    const clean = quote.replace(/^[“"‘']+|[”"’']+$/g, '').trim();
    testimonial = newBlock('testimonial', { quote: `“${clean}”`, name: name || undefined, role: role || undefined, company: company || undefined } as Partial<Block>);
    paras.splice(qi, 1);
  }

  const rest = paras.filter((p) => p.text.length > 0);
  const numbered = rest.filter((p) => p.kind === 'number');
  const bullets = rest.filter((p) => p.kind === 'bullet');
  const plain = rest.filter((p) => p.kind === 'para');


  // contact / call to action
  const joined = rest.map((p) => p.text).join(' ');
  const email = joined.match(EMAIL_RE)?.[0];
  const url = (joined.replace(EMAIL_RE, '').match(URL_RE)?.[0] ?? '').replace(/[.,;)]+$/, '');
  const isCta = !!heading && CTA_HEADING.test(heading) && rest.length <= 4 && (CTA_TEXT.test(joined) || !!email || !!url || rest.length <= 2);
  if (isCta) {
    const dest = url ? (/^https?:/i.test(url) ? url : `https://${url}`) : urls[0] ?? '';
    const about = plain.filter((p) => CTA_TEXT.test(p.text) || EMAIL_RE.test(p.text) || URL_RE.test(p.text));
    const text = cleanText((about.length ? about : plain).map((p) => p.text).join(' '));
    blocks.push(
      newBlock('cta', {
        heading,
        text: truncate(text, 240) || undefined,
        button: dest
          ? { label: /demo|book|schedule|call/i.test(joined) ? 'Book a call' : 'Get in touch', action: { type: 'link', url: dest } }
          : email
            ? { label: 'Email us', action: { type: 'link', url: `mailto:${email}` } }
            : { label: 'Get in touch', action: { type: 'form' } },
      } as Partial<Block>),
    );
    return blocks;
  }

  let statsHandled = false;
  if (stats.length) {
    const statsY = Math.min(...stats.map((st) => Math.min(...st.used.map((u) => u.y))));
    const statsPage = stats[0].used[0].page;
    const above = plain.filter((p) => p.page < statsPage || (p.page === statsPage && p.y < statsY));
    if (above.length) blocks.push(textBlock(heading || undefined, above, notes));
    blocks.push(newBlock('stats', { heading: above.length ? undefined : heading || undefined, items: stats.map((st) => ({ value: st.value, label: st.label })) } as Partial<Block>));
    // whatever remains is "below the figures" prose
    for (const p of above) plain.splice(plain.indexOf(p), 1);
    for (const p of above) rest.splice(rest.indexOf(p), 1);
    statsHandled = true;
  }

  // lists and processes. Prose above the first list item becomes the block's intro; prose below stays prose.
  const listItems = [...numbered, ...bullets].sort((x, y) => x.page - y.page || x.y - y.y);
  const first = listItems[0];
  const intro = first ? plain.filter((pp) => pp.page < first.page || (pp.page === first.page && pp.y < first.y)) : [];
  const after = plain.filter((pp) => !intro.includes(pp));
  const introText = intro.length ? truncate(intro.map((pp) => pp.text).join(' '), 240) : undefined;
  const headText = statsHandled ? undefined : heading || undefined;

  const isProcess = numbered.length >= 3 || (numbered.length >= 2 && numbered.length >= rest.length - 1 && numbered.every((n, i) => n.num === i + 1));
  if (isProcess) {
    const items = numbered.slice(0, 8).map((n) => {
      const [title, text] = n.lead ? [n.lead, n.text.slice(n.lead.length).trim().replace(/^[.:–—-]\s*/, '')] : splitLead(n.text);
      return { title: titleize(title), text: text || undefined, hasLead: !!n.lead || !!text };
    });
    if (items.filter((i) => i.hasLead).length >= Math.ceil(items.length * 0.6)) {
      blocks.push(newBlock('steps', { heading: headText, intro: introText, items: items.map(({ title, text }) => ({ title, text })) } as Partial<Block>));
    } else {
      // sentences, not titled steps: a numbered checklist reads better
      blocks.push(newBlock('checklist', { heading: headText, intro: introText, style: 'number', items: numbered.slice(0, 14).map((n) => truncate(n.text, 200)) } as Partial<Block>));
    }
    if (after.length) blocks.push(textBlock(undefined, after, notes));
  } else if (bullets.length >= 3 || (bullets.length >= 2 && bullets.length >= rest.length - 1)) {
    const leads = bullets.filter((b) => b.lead || /^[^.]{3,60}(?::|\s[–—-]\s|\.\s)/.test(b.text)).length;
    if (leads >= Math.ceil(bullets.length * 0.6) && bullets.length <= 8) {
      const items = bullets.slice(0, 8).map((b, i) => {
        const [t, x] = b.lead ? [b.lead, b.text.slice(b.lead.length).replace(/^[.:–—\s-]+/, '')] : splitLead(b.text);
        return { icon: iconFor(`${t} ${x}`, i), title: titleize(t), text: x || '' };
      });
      blocks.push(newBlock('features', { heading: headText, intro: introText, columns: items.length === 4 ? 2 : 3, items } as Partial<Block>));
    } else {
      blocks.push(newBlock('checklist', { heading: headText, intro: introText, style: 'check', items: bullets.slice(0, 14).map((b) => truncate(b.text, 160)) } as Partial<Block>));
    }
    if (after.length) blocks.push(textBlock(undefined, after, notes));
  } else if (rest.length || (heading && !stats.length && !testimonial)) {
    const startsWithBody = rest.length ? textBlock(statsHandled ? undefined : heading, rest, notes) : null;
    if (startsWithBody) blocks.push(startsWithBody);
  }

  if (testimonial) blocks.push(testimonial);
  return blocks;
}

function textBlock(heading: string | undefined, paras: Para[], notes: { shortened: number }): Block {
  let total = 0;
  const out: string[] = [];
  for (const p of paras) {
    if (total > 900) {
      notes.shortened++;
      break;
    }
    const t = p.kind === 'bullet' ? `- ${p.text}` : p.kind === 'number' ? `${p.num ?? 1}. ${p.text}` : p.text;
    out.push(total + t.length > 1100 ? truncate(t, Math.max(120, 1100 - total)) : t);
    total += t.length;
  }
  // consecutive list items belong together; everything else is its own paragraph
  const body = out.reduce((acc, t, i) => (i > 0 && /^(- |\d+\. )/.test(t) && /^(- |\d+\. )/.test(out[i - 1]) ? `${acc}\n${t}` : i === 0 ? t : `${acc}\n\n${t}`), '');
  return newBlock('text', { heading: heading || undefined, body } as Partial<Block>);
}

// ── The importer ────────────────────────────────────────────────────────────

export async function importToPage(doc: ExtractedDoc, palette: Palette, opts: ImportOptions): Promise<ImportResult> {
  const report: string[] = [];
  const allLines = buildLines(doc);
  const { kept, footer } = dropFurniture(allLines, doc.pages);
  const lines = kept;

  const theme = { brand: palette.brand, font: 'inter' as const, radius: 'soft' as const };
  const base = (blocks: Block[], extra: Partial<Page> = {}): Page =>
    PageSchema.parse({ theme, blocks, header: { enabled: true, button: { label: 'Download PDF', action: { type: 'document' } } }, ...extra });

  if (lines.length < 3) {
    report.push('This PDF has little or no selectable text (it may be scanned), so no copy could be extracted. We built a simple page around the PDF itself — add your own headline and sections.');
    const title = opts.filename.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim() || 'Your document';
    return {
      page: base([
        newBlock('hero', { headline: title, subheadline: undefined, show_document: true, badge: 'Prepared for {{first_name|you}} at {{company|your team}}', primary: { label: 'Download the PDF', action: { type: 'document' } }, secondary: undefined } as Partial<Block>),
        newBlock('form', { bg: 'alt' }),
      ]),
      report,
    };
  }

  const body = modeSize(lines);
  const bodyLines = lines.filter((l) => Math.abs(l.size - body) < 0.6);
  const xs = new Map<number, number>();
  for (const l of bodyLines) xs.set(Math.round(l.x), (xs.get(Math.round(l.x)) ?? 0) + 1);
  const bodyX = [...xs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 40;
  const colRight = Math.max(...bodyLines.map((l) => l.x2), 200);

  // ── title block on the first page that has text ───────────────────────────
  const firstPage = lines[0].page;
  const p1 = lines.filter((l) => l.page === firstPage);
  const biggest = Math.max(...p1.map((l) => l.size));
  let title = '';
  let titleLines: Line[] = [];
  if (biggest >= Math.max(body * 1.5, 18)) {
    titleLines = p1.filter((l) => Math.abs(l.size - biggest) < biggest * 0.06);
    // keep only the first contiguous group (stream order)
    const first = titleLines[0].idx;
    titleLines = titleLines.filter((l, i) => l.idx - first <= i + 3);
    title = cleanText(titleLines.map((l) => l.text).join(' '));
  } else if (doc.meta.title) title = doc.meta.title;
  else title = cleanText(p1[0].text);
  if (!title) title = opts.filename.replace(/\.pdf$/i, '');

  const consumed = new Set<Line>(titleLines);
  // A sparse, large-type first page is a cover: whatever is left on it besides the headline block
  // (tag lines, dates, "Prepared for …") is cover chrome, not content.
  const totalChars = lines.reduce((n, l) => n + l.text.length, 0);
  const isCover = lines.some((l) => l.page > firstPage) && p1.length <= 10 && p1.reduce((n, l) => n + l.text.length, 0) < totalChars * 0.25 && biggest >= body * 1.8;
  const titleIdx = titleLines.length ? Math.max(...titleLines.map((l) => l.idx)) : -1;

  // eyebrow: a short, small, mostly-caps line near the top, before or just above the title
  let eyebrow = '';
  const eyebrowLine = p1.find((l) => !consumed.has(l) && l.size <= body * 1.3 && l.text.length <= 60 && (titleLines.length === 0 || l.y < titleLines[0].y) && (/^[^a-z]*$/.test(l.text) || l.text === l.text.toUpperCase()));
  if (eyebrowLine) {
    eyebrow = cleanText(eyebrowLine.text);
    consumed.add(eyebrowLine);
  }

  // cover boilerplate ("Prepared for …", "Confidential", unfilled placeholders) is replaced by our own
  // personalised badge, so it must be dropped before we look for the sub-headline
  const BOILER = /prepared (for|by)|attn:|attention:|confidential|\{\{|\[[^\]]*(name|company)[^\]]*\]?|company name\]/i;
  const boiler = new Set(p1.filter((l) => l.idx > titleIdx && l.size <= body * 1.4 && BOILER.test(l.text)));
  boiler.forEach((l) => consumed.add(l));
  const coverBoiler = isCover ? p1.filter((l) => l.idx > titleIdx && !consumed.has(l) && l.size <= body * 1.4) : [];

  // subtitle: larger-than-body lines directly after the title
  const sub: Line[] = [];
  for (const l of lines) {
    if (l.idx <= titleIdx || l.page !== firstPage || consumed.has(l)) continue;
    const prev = sub[sub.length - 1];
    const tight = !prev || l.y - (prev.y + prev.h) < prev.size * 1.2;
    if (sub.length < 4 && tight && l.size >= body * 1.0 && l.size < biggest * 0.8 && !BULLET_RE.test(l.text) && (!prev || l.idx === prev.idx + 1)) sub.push(l);
    else if (sub.length || l.size >= body * 1.15) break;
  }
  const subtitle = cleanText(sub.map((l) => l.text).join(' '));
  sub.forEach((l) => consumed.add(l));
  coverBoiler.forEach((l) => consumed.add(l));

  // ── sections ──────────────────────────────────────────────────────────────
  const sections: Section[] = [];
  let current: Section = { heading: '', page: firstPage, lines: [] };
  const isHeading = (l: Line, i: number): boolean => {
    const t = l.text.trim();
    if (!/\p{L}{2,}/u.test(t) || QUOTE_OPEN.test(t) || (l.italic && !l.bold) || /[.,;]$/.test(t)) return false;
    if (l.size >= body * 1.2 && t.length <= 110) return true;
    const next = lines[i + 1];
    return l.bold && !l.boldLead && l.size >= body * 0.98 && l.text.length <= 70 && !/[.,;]$/.test(l.text) && !!next && !BULLET_RE.test(l.text) && !NUMBER_RE.test(l.text) && next.size <= l.size + 0.5;
  };
  lines.forEach((l, i) => {
    if (consumed.has(l)) return;
    // stat figures are big but not headings
    if (l.size >= body * 1.4 && STAT_RE.test(l.text.trim())) {
      current.lines.push(l);
      return;
    }
    if (isHeading(l, i)) {
      // a wrapped heading continues the previous heading line
      if (current.heading && current.lines.length === 0 && Math.abs(l.size - (lines[i - 1]?.size ?? 0)) < 0.6 && l.page === current.page) {
        current.heading += ' ' + l.text;
        return;
      }
      if (current.heading || current.lines.length) sections.push(current);
      current = { heading: l.text, page: l.page, lines: [] };
      return;
    }
    current.lines.push(l);
  });
  if (current.heading || current.lines.length) sections.push(current);

  // ── blocks ────────────────────────────────────────────────────────────────
  const urls = [...new Set(doc.pages.flatMap((p) => p.links.map((l) => l.url)))].filter((u) => /^https?:/i.test(u));
  const notes = { shortened: 0 };
  const sectionBlocks: Array<{ section: Section; blocks: Block[] }> = sections.map((s) => ({ section: s, blocks: blocksFromSection(s, body, bodyX, colRight, urls, notes) })).filter((x) => x.blocks.length > 0);

  // images, placed after the section whose text sits just above them
  const imgs = doc.pages
    .flatMap((p) => p.images.map((im) => ({ im, pg: p })))
    .filter(({ im, pg }) => im.w >= 140 && im.h >= 90 && im.w * im.h < pg.width * pg.height * 0.8)
    .sort((a, b) => b.im.w * b.im.h - a.im.w * a.im.h)
    .slice(0, 3);
  let imagesPlaced = 0;
  if (opts.saveImage) {
    for (const { im } of imgs) {
      const assetId = await opts.saveImage(im).catch(() => null);
      if (!assetId) continue;
      const above = sectionBlocks.filter((s) => s.section.lines.some((l) => l.page === im.page && l.y + l.h <= im.y + 6) || s.section.page < im.page);
      const target = above[above.length - 1] ?? sectionBlocks[0];
      if (target) {
        target.blocks.push(newBlock('image', { image: { src: assetId, alt: '' }, width: 'content' } as Partial<Block>));
        imagesPlaced++;
      }
    }
  }

  const content: Block[] = sectionBlocks.flatMap((s) => s.blocks);
  const MAX = 11;
  if (content.length > MAX) {
    report.push(`The PDF has more sections than fit a landing page, so the last ${content.length - MAX} were left out. The full PDF is still available to download.`);
    content.length = MAX;
  }

  // alternate backgrounds for rhythm (never touch ones already set)
  let flip = false;
  for (const b of content) {
    if (b.type === 'cta' || b.type === 'testimonial') continue;
    if (flip && !b.bg) b.bg = 'alt';
    flip = !flip;
  }

  const hasCta = content.some((b) => b.type === 'cta');
  const hero = newBlock('hero', {
    badge: 'Prepared for {{first_name|you}} at {{company|your team}}',
    eyebrow: undefined,
    headline: title,
    subheadline: subtitle ? truncate(subtitle, 300) : undefined,
    primary: { label: 'Download the PDF', action: { type: 'document' } },
    secondary: { label: 'Talk to us', action: hasCta || content.some((b) => b.type === 'form') ? { type: 'anchor', anchor: 'contact' } : { type: 'form' } },
    show_document: true,
    layout: 'split',
    bg: palette.brandCover ? 'brand' : palette.dark ? 'dark' : undefined,
  } as Partial<Block>);

  const blocks: Block[] = [hero, ...content];
  if (!hasCta) blocks.push(newBlock('cta', { id: newBlockId(), heading: 'Ready to talk, {{first_name|friend}}?', text: 'Book a short call and we’ll walk you through it.', button: { label: 'Get in touch', action: { type: 'form' } } } as Partial<Block>));
  const cta = blocks.find((b) => b.type === 'cta');
  if (cta) cta.anchor = 'contact';
  blocks.push(newBlock('form', { bg: 'alt' }));

  const logoText = eyebrow ? (eyebrow === eyebrow.toUpperCase() ? eyebrow.replace(/\w\S*/g, (w) => w.charAt(0) + w.slice(1).toLowerCase()) : eyebrow) : doc.meta.author ?? '';
  const page = base(blocks, {
    header: { enabled: true, logo_text: logoText || undefined, button: { label: 'Download PDF', action: { type: 'document' } }, sticky: false, logo: undefined } as Page['header'],
    footer: { text: footer || '', links: [] },
    seo: { title: `${title} — prepared for {{company|you}}`, description: subtitle ? truncate(subtitle, 200) : '', noindex: true, lang: 'en' } as Page['seo'],
  });

  report.push(`Read ${doc.page_count} page${doc.page_count === 1 ? '' : 's'}: found ${sections.length} section${sections.length === 1 ? '' : 's'} and built ${content.length} content block${content.length === 1 ? '' : 's'}.`);
  report.push(`Headline: “${truncate(title, 80)}”${subtitle ? ' with a sub-headline' : ''}.`);
  report.push(palette.found ? `Brand colour ${palette.brand} was picked from the PDF${palette.brandCover ? ', and the hero uses it as its background' : ''}.` : 'The PDF has no distinctive colour, so a default brand colour was used. Change it in Design.');
  if (imagesPlaced) report.push(`${imagesPlaced} image${imagesPlaced === 1 ? '' : 's'} from the PDF ${imagesPlaced === 1 ? 'was' : 'were'} added to the page.`);
  if (notes.shortened) report.push(`${notes.shortened} long section${notes.shortened === 1 ? ' was' : 's were'} shortened — the PDF has the full text.`);
  if (doc.tokens.length) report.push(`Found ${[...new Set(doc.tokens.map((t) => t.token))].join(', ')} in the PDF and set them up to be replaced for each prospect.`);
  return { page, report };
}
