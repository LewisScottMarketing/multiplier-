import { newBlock, newBlockId } from '@shared/blocks';
import { applyPreset, presetById, type StylePreset } from '@shared/presets';
import { PageSchema, ThemeSchema, type Block, type Page } from '@shared/schema';
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
  /** Text set in aligned columns, found by `gatherTables`. `text` holds the same cells, one row per line. */
  table?: { rows: string[][]; header: boolean };
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
    const sorted = pg.runs
      .filter((r) => !isFootnoteMark(r, pg.runs))
      .sort((a, b) => (Math.abs(a.baseline - b.baseline) < Math.max(a.size, b.size) * 0.3 ? a.x - b.x : a.baseline - b.baseline));
    const groups: Run[][] = [];
    for (const r of sorted) {
      const g = groups.find((grp) => {
        const last = grp[grp.length - 1];
        return (
          Math.abs(last.baseline - r.baseline) < Math.max(last.size, r.size) * 0.3 &&
          r.x - (last.x + last.w) < Math.max(last.size, r.size) * 1.2 &&
          r.x >= last.x - 2
        );
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
          boldLeadText: mixed
            ? body
                .filter((r, i) => r.bold && body.slice(0, i).every((p) => p.bold))
                .map((r) => r.text)
                .join(' ')
            : '',
          runs,
          idx: 0,
        },
      };
    });
    for (const line of readingOrder(joinBadges(gatherTables(built.map((b) => b.line))), pg.width)) {
      line.idx = lines.length;
      lines.push(line);
    }
  }
  return lines;
}

/** A small raised number or symbol right after a word ("loses.¹"): a reference mark, which would split the line if kept. */
function isFootnoteMark(r: Run, runs: Run[]): boolean {
  if (!/^[\d*†‡§]{1,3}$/.test(r.text.trim())) return false;
  return runs.some((p) => {
    if (p === r || p.size < r.size * 1.1) return false;
    const raised = p.baseline - r.baseline;
    return raised > p.size * 0.15 && raised < p.size * 0.6 && r.x - (p.x + p.w) > -2 && r.x - (p.x + p.w) < p.size * 0.35;
  });
}

// ── Tables and number badges ────────────────────────────────────────────────

interface Row {
  lines: Line[];
  baseline: number;
  size: number;
}

/** Lines that share a baseline, left to right. */
function rowsOf(lines: Line[]): Row[] {
  const rows: Row[] = [];
  for (const l of [...lines].sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.baseline - l.baseline) < Math.min(row.size, l.size) * 0.35) {
      row.lines.push(l);
      row.size = Math.max(row.size, l.size);
    } else rows.push({ lines: [l], baseline: l.baseline, size: l.size });
  }
  for (const r of rows) r.lines.sort((a, b) => a.x - b.x);
  return rows;
}

const NUMERIC_CELL = /^[\d$£€%.,+\-\s]+[kKmMbB%x×]?$/;

/**
 * Text set in aligned columns reads as nonsense when taken line by line (a column at a time, or a row's cells run
 * together), so find it first: three or more rows whose cells line up become one line that carries the table.
 */
export function gatherTables(lines: Line[]): Line[] {
  const rows = rowsOf(lines);
  const taken = new Set<Line>();
  const made: Line[] = [];
  const multi = (r: Row) => r.lines.length >= 2;
  for (let i = 0; i < rows.length; i++) {
    if (!multi(rows[i]) || rows[i].lines.some((l) => taken.has(l))) continue;
    let j = i;
    while (
      j + 1 < rows.length &&
      (multi(rows[j + 1]) || rows[j + 1].lines.length === 1) &&
      rows[j + 1].baseline - rows[j].baseline < rows[j].size * 4.5
    )
      j++;
    const found = tableFrom(rows.slice(i, j + 1));
    if (!found) continue;
    made.push(found.line);
    found.used.forEach((l) => taken.add(l));
    i += found.rows - 1;
  }
  return made.length ? [...lines.filter((l) => !taken.has(l)), ...made] : lines;
}

function tableFrom(candidate: Row[]): { line: Line; used: Line[]; rows: number } | null {
  const sizes = candidate.flatMap((r) => r.lines.map((l) => l.size)).sort((a, b) => a - b);
  const size = sizes[Math.floor(sizes.length / 2)] ?? 11;
  // columns: stretches of the page that some cell covers; a gap nothing crosses is a gutter
  const spans = candidate
    .filter((r) => r.lines.length >= 2)
    .flatMap((r) => r.lines.map((l) => [l.x, l.x2] as const))
    .sort((a, b) => a[0] - b[0]);
  const cols: Array<[number, number]> = [];
  for (const [a, b] of spans) {
    const last = cols[cols.length - 1];
    if (last && a < last[1] + 1) last[1] = Math.max(last[1], b);
    else cols.push([a, b]);
  }
  if (cols.length < 2 || cols.length > 8) return null;
  const colOf = (l: Line) => {
    const mid = (l.x + l.x2) / 2;
    const k = cols.findIndex(([a, b]) => mid >= a && mid <= b);
    return k >= 0 ? k : cols.findIndex(([a, b]) => l.x <= b && l.x2 >= a);
  };

  const grid: string[][] = [];
  const used: Line[] = [];
  let lastBottom = 0;
  let taken = 0;
  for (const r of candidate) {
    const cells = new Array<string>(cols.length).fill('');
    if (r.lines.length >= 2) {
      for (const l of r.lines) {
        const k = colOf(l);
        if (k < 0) return null;
        cells[k] = cells[k] ? `${cells[k]} ${l.text}` : l.text;
      }
      grid.push(cells);
    } else {
      // a wrapped cell: the next line down in the same column, tucked under the row before
      const l = r.lines[0];
      const k = colOf(l);
      const prev = grid[grid.length - 1];
      if (k < 0 || !prev || !prev[k] || l.y - lastBottom > l.size * 0.8) break;
      prev[k] = `${prev[k]} ${l.text}`;
    }
    used.push(...r.lines);
    lastBottom = Math.max(...r.lines.map((l) => l.y + l.h));
    taken++;
  }
  const body = grid.map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim()));
  if (body.length < 3 || body.some((r) => r.filter(Boolean).length < 2)) return null;

  const filled = body.flat().filter(Boolean);
  const cellsTotal = body.length * cols.length;
  const longest = Math.max(...filled.map((c) => c.length));
  const average = filled.reduce((n, c) => n + c.length, 0) / filled.length;
  if (filled.length < cellsTotal * 0.6 || average > 42 || longest > 110) return null;
  // Columns of running text have rows too, but each line carries on from the one above it
  for (let k = 0; k < cols.length; k++) {
    let pairs = 0;
    let carried = 0;
    for (let r = 0; r + 1 < body.length; r++) {
      const [above, below] = [body[r][k], body[r + 1][k]];
      if (!above || !below) continue;
      pairs++;
      if (!/[.!?:;]["”’)]?$/.test(above) && /^\p{Ll}/u.test(below)) carried++;
    }
    if (pairs >= 2 && carried / pairs >= 0.5) return null;
  }
  if (filled.filter((c) => BULLET_RE.test(c)).length >= filled.length * 0.5) return null;
  // a number beside each step of a process is a list, not a table
  const first = body.map((r) => r[0]);
  if (cols.length === 2 && first.every((c, k) => c === String(k + 1) || c === String(k))) return null;
  // a row of big figures with their captions is a set of stats
  const top = candidate[0];
  if (body.length <= 3 && top.lines.every((l) => STAT_RE.test(l.text.trim()) && l.size >= size * 1.4)) return null;

  const firstRow = body[0];
  const numberIn = (r: string[]) => r.some((c) => NUMERIC_CELL.test(c));
  const boldRow = (r: Row) => r.lines.every((l) => l.bold);
  const header =
    firstRow.every(Boolean) &&
    (boldRow(candidate[0]) ? !candidate.slice(1).every(boldRow) : !numberIn(firstRow) && body.slice(1).some(numberIn));

  const x = Math.min(...used.map((l) => l.x));
  const y = Math.min(...used.map((l) => l.y));
  const line: Line = {
    page: used[0].page,
    text: body.map((r) => r.join(' | ')).join('\n'),
    x,
    textX: x,
    x2: Math.max(...used.map((l) => l.x2)),
    y,
    h: Math.max(...used.map((l) => l.y + l.h)) - y,
    baseline: candidate[0].baseline,
    size,
    bold: false,
    italic: false,
    boldLead: false,
    boldLeadText: '',
    runs: [],
    idx: 0,
    table: { rows: body, header },
  };
  return { line, used, rows: taken };
}

const BADGE_RE = /^\d{1,2}$/;

/**
 * A number in a circle beside its text (a numbered step) is painted as a line of its own, level with the middle of the
 * text. Put it back in front of the first line, so "1" and "Mapped the journey." read as "1. Mapped the journey."
 */
export function joinBadges(lines: Line[]): Line[] {
  const gone = new Set<Line>();
  for (const b of lines) {
    if (b.table || !BADGE_RE.test(b.text.trim())) continue;
    const mid = b.y + b.h / 2;
    const beside = lines.filter(
      (t) =>
        t !== b &&
        !t.table &&
        !gone.has(t) &&
        !BADGE_RE.test(t.text.trim()) &&
        t.text.trim().length > 3 &&
        t.x >= b.x2 + 2 &&
        t.x - b.x2 <= Math.max(60, b.size * 5) &&
        t.size <= b.size * 1.3 + 2 &&
        Math.abs(t.y + t.h / 2 - mid) <= Math.max(t.h, b.h) * 1.3,
    );
    if (!beside.length) continue;
    const first = beside.reduce((a, c) => (c.y < a.y ? c : a));
    first.text = `${b.text.trim()}. ${first.text}`;
    gone.add(b);
  }
  return gone.size ? lines.filter((l) => !gone.has(l)) : lines;
}

/**
 * Reading order from geometry, not paint order (PDF producers paint in arbitrary order). Top to bottom,
 * except on two-column pages, where a full-width line closes the current band and each band reads
 * left column then right column.
 */
export function readingOrder(lines: Line[], pageWidth: number): Line[] {
  const byY = [...lines].sort((a, b) =>
    Math.abs(a.baseline - b.baseline) < Math.max(a.size, b.size) * 0.3 ? a.x - b.x : a.baseline - b.baseline,
  );
  if (lines.length < 6) return byY;
  const typical = modeSize(lines);
  const gutters = findGutters(lines, pageWidth, typical);
  if (!gutters.length) return byY;
  const crosses = (l: Line) => gutters.some((g) => l.x < g - 2 && l.x2 > g + 2);
  const columnOf = (l: Line) => gutters.filter((g) => (l.x + l.x2) / 2 > g).length;
  // how far down each column goes before the next line across the page
  const reach = new Map<Line, number[]>();
  let band: number[] = gutters.map(() => 0).concat([0]);
  for (const l of byY) {
    if (crosses(l)) band = band.map(() => 0);
    else {
      band[columnOf(l)] = Math.max(band[columnOf(l)], l.y + l.h);
      reach.set(l, band);
    }
  }
  const out: Line[] = [];
  let cols: Line[][] = Array.from({ length: gutters.length + 1 }, () => []);
  const flush = () => {
    for (const c of cols) out.push(...c);
    cols = cols.map(() => []);
  };
  for (const l of byY) {
    // a line across the gutters closes the band above it
    if (crosses(l)) {
      flush();
      out.push(l);
      continue;
    }
    const k = columnOf(l);
    // so does a heading that sits below the end of every other column
    const others = cols.filter((_, j) => j !== k).flat();
    const ends = reach.get(l)!;
    if ((l.bold || l.size > typical * 1.1) && others.length >= 2 && ends.every((end, j) => j === k || end <= l.y + 1)) flush();
    cols[k].push(l);
  }
  flush();
  return out;
}

/**
 * Where the columns of a page split: gaps in the page that no line of body text crosses, with text on both sides.
 * Headings are left out, since one that runs a little past its column would otherwise hide the gap.
 */
function findGutters(lines: Line[], pageWidth: number, typical: number): number[] {
  const narrow = lines.filter((l) => Math.abs(l.size - typical) <= typical * 0.15 && l.x2 - l.x < pageWidth * 0.6);
  if (narrow.length < 4) return [];
  const covered: Array<[number, number]> = [];
  for (const [a, b] of narrow.map((l) => [l.x, l.x2] as const).sort((p, q) => p[0] - q[0])) {
    const last = covered[covered.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else covered.push([a, b]);
  }
  const minGap = Math.max(10, pageWidth * 0.02);
  const found: number[] = [];
  for (let k = 0; k + 1 < covered.length; k++) {
    if (covered[k + 1][0] - covered[k][1] < minGap) continue;
    const g = (covered[k][1] + covered[k + 1][0]) / 2;
    const left = narrow.filter((l) => l.x2 <= g).length;
    const right = narrow.filter((l) => l.x >= g).length;
    if (left >= 2 && right >= 2 && left >= narrow.length * 0.15 && right >= narrow.length * 0.15) found.push(g);
  }
  return found;
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
export function dropFurniture(lines: Line[], pages: PageInfo[]): { kept: Line[]; footer: string } {
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
    const repeated =
      pages.length >= 2 &&
      (byKey.get(`${norm(t)}@${l.y < pages[l.page - 1].height / 2 ? 'top' : 'bottom'}`)?.size ?? 0) >=
        Math.min(pages.length, Math.max(2, Math.ceil(pages.length * 0.5)));
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
  return s
    .replace(/\s+/g, ' ')
    .replace(/(?:\s?\.){4,}(?:\s*\d{1,3})?\s*$/, '')
    .replace(/(\w)- (\w)/g, (m, a: string, b: string) => (/[a-z]/.test(a) && /[a-z]/.test(b) ? `${a}${b}` : m))
    .trim();
}

/** Set in from the body text by a list's indent: more than a nudge, and less than a column of its own. */
const isIndent = (x: number, bodyX: number, body: number) => x >= bodyX + body * 0.8 && x <= bodyX + body * 6;

/** Group lines into paragraphs and list items. */
export function buildParas(lines: Line[], body: number, bodyX: number, colRight: number): Para[] {
  const paras: Para[] = [];
  let cur: Para | null = null;
  let prev: Line | null = null;
  // Where a line "reaches the edge" depends on its column: lines of a column on the right end well short of the page's widest
  const reach = new Map<number, { right: number; n: number }>();
  for (const l of lines) {
    const e = reach.get(Math.round(l.x / 3)) ?? { right: 0, n: 0 };
    reach.set(Math.round(l.x / 3), { right: Math.max(e.right, l.x2), n: e.n + 1 });
  }
  const rightOf = (l: Line) => {
    if (l.x < bodyX + (colRight - bodyX) * 0.4) return colRight;
    const e = reach.get(Math.round(l.x / 3));
    return e && e.n >= 2 ? e.right : colRight;
  };
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
    const indentedNoBullet =
      isIndent(l.x, bodyX, body) &&
      Math.abs(l.size - body) < body * 0.25 &&
      !!prev &&
      l.page === prev.page &&
      !!cur &&
      cur.lines.length === 1;
    let startsNew = !cur || !prev;
    if (cur && prev) {
      const gap = l.y - (prev.y + prev.h);
      const samePage = l.page === prev.page;
      const prevWrapped = prev.x2 >= rightOf(prev) * 0.9;
      const endsSentence = /[.!?:”")]$/.test(prev.text.trim());
      const startsUpper = /^[A-Z“"(0-9]/.test(l.text.trim());
      const indentChange = Math.abs(l.x - prev.x) > body * 0.7 && Math.abs(l.x - prev.textX) > body * 0.7;
      // a sentence that runs over a page or into the next column carries on in lower case, in the same type
      const across =
        (!samePage || gap < -body) &&
        !endsSentence &&
        !bullet &&
        !numbered &&
        /^\p{Ll}/u.test(l.text.trim()) &&
        Math.abs(l.size - prev.size) <= 0.8;
      startsNew =
        !across &&
        (!samePage ||
          bullet ||
          !!numbered ||
          gap > body * 0.55 ||
          Math.abs(l.size - prev.size) > 0.8 ||
          (l.bold !== prev.bold && !l.boldLead && !prev.boldLead) ||
          indentChange ||
          (indentedNoBullet && !prevWrapped) ||
          (!prevWrapped && endsSentence && startsUpper));
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
    const indented = (p: Para) =>
      p.kind === 'para' && isIndent(p.x, bodyX, body) && p.lines.length <= 2 && !p.italic && !QUOTE_OPEN.test(p.text);
    if (!indented(paras[i])) {
      i++;
      continue;
    }
    let j = i;
    while (
      j + 1 < paras.length &&
      indented(paras[j + 1]) &&
      Math.abs(paras[j + 1].x - paras[i].x) < 3 &&
      paras[j + 1].page === paras[i].page
    )
      j++;
    if (j - i + 1 >= 3) for (let k = i; k <= j; k++) paras[k].kind = 'bullet';
    i = j + 1;
  }
}

// ── Section analysis ────────────────────────────────────────────────────────

/** Line `at` closes a quotation: it ends in a quotation mark, and a few compact lines up one opens it. */
function endsQuotation(lines: Line[], at: number): boolean {
  const last = lines[at];
  if (!last || !/[”"’']\s*$/.test(last.text.trim())) return false;
  for (let j = at, n = 0; j >= 0 && n < 6; j--, n++) {
    if (lines[j].page !== last.page) return false;
    if (QUOTE_OPEN.test(lines[j].text.trim())) return true;
    const above = lines[j - 1];
    if (!above || lines[j].y - (above.y + above.h) > lines[j].size * 0.9) return false;
  }
  return false;
}

const bottomOf = (p: Para) => Math.max(...p.lines.map((l) => l.y + l.h));
/** `b` follows `a` closely enough to belong with it. */
const tight = (a: Para, b: Para, within = 1.6) => b.page === a.page && b.y - bottomOf(a) < Math.max(a.size, b.size) * within;
const NAME_RE = /^\p{Lu}[\p{L}'’.-]*(?:\s+(?:\p{Lu}[\p{L}'’.-]*|de|van|von|da|di|la|le|del|der|bin|al|el))*$/u;
/** "Dana Whitfield": one to four capitalised words and no punctuation to end a sentence. */
function looksLikeName(p: Para): boolean {
  const t = p.text.trim();
  return p.kind === 'para' && t.length >= 3 && t.length <= 40 && t.split(/\s+/).length <= 4 && !/\d/.test(t) && NAME_RE.test(t);
}
/** "VP Operations, Globex": a short line that isn't a sentence, a contact detail or a list item. */
function looksLikeRole(p: Para): boolean {
  const t = p.text.trim();
  return p.kind === 'para' && t.length >= 2 && t.length <= 90 && !/[.!?]$/.test(t) && !/[@|]|https?:|www\./i.test(t) && /^\p{L}/u.test(t);
}

interface Section {
  heading: string;
  page: number;
  lines: Line[];
  /** Big type that says one thing and nothing else (a slide that is a single sentence). */
  statement?: boolean;
  /** Size of the heading's type. */
  size?: number;
  /** Several short sections side by side, each a title and a sentence or two: a row of cards. */
  cards?: Array<{ heading: string; text: string }>;
}

const STAT_RE =
  /^[$£€]?\s?\d[\d,.]*\s?(?:%|x|X|×|[kKmMbB]\b|\+|bn|million|billion|hrs?|hours?|days?|wks?|weeks?|mos?|months?|yrs?|years?|mins?|minutes?|secs?|seconds?|pts?|\/\w+)*\+?$/;

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
    // label: the nearest smaller line just below, roughly aligned, and any lines that carry it on
    const first = lines.find(
      (c) =>
        c.page === l.page &&
        c.y > l.y &&
        c.y - (l.y + l.h) < l.size * 1.2 &&
        Math.abs(c.x - l.x) < Math.max(20, l.size) &&
        c.size < l.size * 0.7 &&
        !STAT_RE.test(c.text.trim()),
    );
    if (!first) continue;
    const label = [first];
    for (const c of lines) {
      const last = label[label.length - 1];
      if (
        label.length < 3 &&
        c.page === last.page &&
        c.y > last.y &&
        c.y - (last.y + last.h) < last.size * 0.6 &&
        Math.abs(c.x - last.x) < 6 &&
        Math.abs(c.size - last.size) < 0.6 &&
        !STAT_RE.test(c.text.trim())
      )
        label.push(c);
    }
    stats.push({ value: l.text.trim(), label: cleanText(label.map((x) => x.text).join(' ')), x: l.x, used: [l, ...label] });
  }
  // one figure on its own is a statistic only when it is clearly the point of the page
  const lone = stats.length === 1 && stats[0].used[0].size >= body * 2.2;
  return stats.length >= 2 || lone ? stats.sort((a, b) => a.x - b.x).slice(0, 6) : [];
}

/**
 * Big type with nothing smaller under it is a statement, not a heading: a slide that just says "Generic outreach is
 * ignored." Returns each statement's lines, keyed by its first line.
 */
function findStatements(lines: Line[], body: number, skip: Set<Line>): Map<Line, Line[]> {
  const out = new Map<Line, Line[]>();
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i];
    if (skip.has(first) || first.table || first.size < Math.max(body * 2.2, 26)) continue;
    const group = [first];
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      const last = group[group.length - 1];
      if (
        next.page !== first.page ||
        next.table ||
        skip.has(next) ||
        Math.abs(next.size - first.size) > first.size * 0.08 ||
        next.y - (last.y + last.h) > first.size * 0.9
      )
        break;
      group.push(next);
      i++;
    }
    const last = group[group.length - 1];
    const after = lines[i + 1];
    const text = cleanText(group.map((l) => l.text).join(' '));
    const textBelow =
      !!after &&
      after.page === first.page &&
      !skip.has(after) &&
      after.size < first.size * 0.75 &&
      after.y - (last.y + last.h) < first.size * 1.6;
    if (!textBelow && text.length >= 12 && text.length <= 240 && text.split(/\s+/).length >= 3 && !STAT_RE.test(text))
      out.set(first, group);
  }
  return out;
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

const CONTENTS_HEADING = /^(?:table of )?contents$|^in this (?:guide|report|paper|ebook|document|issue)$|^what(?:’|')?s inside$|^inside$/i;
const CTA_HEADING = /ready|get started|contact|next step|talk to|talk with|book|let.?s|speak|reach out|demo|questions\??$/i;
const CTA_TEXT = /contact|book|schedule|call|demo|talk|reach|get in touch|email us|visit|learn more|sign up/i;
const URL_RE =
  /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|co|ai|net|org|app|dev|uk|de|fr|nl|ca|au|us|eu|co\.uk)(?:\/[^\s)]*)?/i;
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

/**
 * A label in bold with its value under it, a few times over ("Industry" / "Logistics", "Team size" / "1,200 people"):
 * a fact box. Takes the pairs out of `paras` and returns them as rows.
 */
function takeFacts(paras: Para[]): string[][] {
  const rows: string[][] = [];
  const isLabel = (p: Para) => p.kind === 'para' && p.bold && p.lines.length === 1 && p.text.length <= 40 && !/[.!?:]$/.test(p.text.trim());
  const isValue = (a: Para, b: Para) =>
    b.kind === 'para' && !b.bold && b.lines.length === 1 && b.text.length <= 70 && tight(a, b, 1.2) && !EMAIL_RE.test(b.text);
  for (let i = 0; i + 1 < paras.length;) {
    let n = 0;
    while (i + 2 * n + 1 < paras.length && isLabel(paras[i + 2 * n]) && isValue(paras[i + 2 * n], paras[i + 2 * n + 1])) n++;
    if (n >= 2) {
      for (const [a, b] of paras
        .slice(i, i + 2 * n)
        .reduce<Para[][]>((acc, p, k) => (k % 2 ? (acc[acc.length - 1].push(p), acc) : [...acc, [p]]), []))
        rows.push([a.text.trim(), b.text.trim()]);
      paras.splice(i, 2 * n);
    } else i++;
  }
  return rows;
}

const cardText = (sec: Section) =>
  cleanText(
    sec.lines
      .filter((l) => !l.table)
      .map((l) => l.text)
      .join(' '),
  );

function isCard(sec: Section): boolean {
  if (!sec.heading || sec.statement || sec.cards || !sec.lines.length) return false;
  if (sec.lines.some((l) => l.table || BULLET_RE.test(l.text) || NUMBER_RE.test(l.text))) return false;
  const text = cardText(sec);
  return cleanText(sec.heading).length <= 60 && text.length >= 15 && text.length <= 220 && sec.lines.length <= 6;
}

/**
 * Three or more neighbouring sections that are each a short title and a sentence or two are a row of cards (the
 * "three changes that matter" slide). A title with nothing under it just before them is the row's heading.
 */
function gatherCards(sections: Section[]): Section[] {
  const out: Section[] = [];
  for (let i = 0; i < sections.length; i++) {
    let j = i;
    while (
      j < sections.length &&
      isCard(sections[j]) &&
      sections[j].page === sections[i].page &&
      Math.abs((sections[j].size ?? 0) - (sections[i].size ?? 0)) < 1
    )
      j++;
    if (j - i >= 3 && j - i <= 8) {
      const lead = out[out.length - 1];
      let heading = '';
      if (lead && lead.page === sections[i].page && lead.heading && !lead.lines.length && !lead.cards) {
        heading = lead.heading;
        out.pop();
      }
      out.push({
        heading,
        page: sections[i].page,
        lines: [],
        cards: sections.slice(i, j).map((c) => ({ heading: cleanText(c.heading), text: cardText(c) })),
      });
      i = j - 1;
    } else out.push(sections[i]);
  }
  return out;
}

/** A table the PDF set in columns, as a table block. */
function tableBlock(l: Line, heading: string | undefined): Block {
  const rows = (l.table?.rows ?? []).slice(0, 40).map((r) => r.slice(0, 8).map((c) => truncate(cleanText(c), 200)));
  return newBlock('table', { heading: heading || undefined, rows, header: l.table?.header ?? true } as Partial<Block>);
}

/** Blocks for one section. Tables inside it become their own blocks, in order, with the text around them split off. */
function blocksFromSection(
  sec: Section,
  body: number,
  bodyX: number,
  colRight: number,
  urls: string[],
  notes: { shortened: number; labels?: number },
): Block[] {
  if (sec.cards)
    return [
      newBlock('features', {
        heading: cleanText(sec.heading) || undefined,
        columns: sec.cards.length === 4 ? 2 : 3,
        items: sec.cards.map((c, i) => ({
          icon: iconFor(`${c.heading} ${c.text}`, i),
          title: titleize(c.heading),
          text: truncate(c.text, 200),
        })),
      } as Partial<Block>),
    ];
  if (!sec.lines.some((l) => l.table)) return textBlocksFromSection(sec, body, bodyX, colRight, urls, notes);
  const out: Block[] = [];
  let heading = sec.heading;
  let run: Line[] = [];
  const flush = () => {
    if (!run.length) return;
    out.push(...textBlocksFromSection({ ...sec, heading, lines: run }, body, bodyX, colRight, urls, notes));
    heading = '';
    run = [];
  };
  for (const l of sec.lines) {
    if (!l.table) run.push(l);
    else {
      flush();
      out.push(tableBlock(l, cleanText(heading) || undefined));
      heading = '';
    }
  }
  flush();
  return out;
}

function textBlocksFromSection(
  sec: Section,
  body: number,
  bodyX: number,
  colRight: number,
  urls: string[],
  notes: { shortened: number; labels?: number },
): Block[] {
  const blocks: Block[] = [];
  const heading = cleanText(sec.heading);
  let lines = sec.lines;
  if (sec.statement) return [newBlock('callout', { text: cleanText(lines.map((l) => l.text).join(' ')) } as Partial<Block>)];

  // stats
  const stats = findStats(lines, body);
  if (stats.length) {
    const used = new Set(stats.flatMap((s) => s.used));
    lines = lines.filter((l) => !used.has(l));
  }

  const paras = buildParas(lines, body, bodyX, colRight);
  const facts = takeFacts(paras);
  dropChartLabels(paras, body, notes);

  // testimonial
  const qi = paras.findIndex(
    (p) => (QUOTE_OPEN.test(p.text) && /[”"’']\s*$/.test(p.text.replace(/\s*[—–-].*$/, ''))) || (QUOTE_OPEN.test(p.text) && p.italic),
  );
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
      const after = paras[qi + 2];
      const looksLikeAttribution =
        !!next &&
        next.page === q.page &&
        (ATTRIB.test(next.text) ||
          next.italic ||
          (looksLikeName(next) && tight(q, next, 8) && (next.bold || (!!after && looksLikeRole(after) && tight(next, after)))) ||
          (next.text.length <= 100 &&
            next.size <= q.size + 0.5 &&
            /^[^,]+,[^,]+(,[^,]+)?$/.test(next.text.trim()) &&
            !/[.!?]$/.test(next.text.trim())));
      if (next && looksLikeAttribution) {
        who = next.text
          .replace(ATTRIB, '$1')
          .replace(/^[^\p{L}\p{N}]+/u, '')
          .trim();
        paras.splice(qi + 1, 1);
        // a name on one line and "Role, Company" on the next
        const role = paras[qi + 1];
        if (!who.includes(',') && role && role.kind === 'para' && tight(next, role) && looksLikeRole(role)) {
          who += `, ${role.text.trim()}`;
          paras.splice(qi + 1, 1);
        }
      }
    }
    const [name, role, company] = who.split(',').map((x) => x.trim());
    const clean = quote.replace(/^[“"‘']+|[”"’']+$/g, '').trim();
    testimonial = newBlock('testimonial', {
      quote: `“${clean}”`,
      name: name || undefined,
      role: role || undefined,
      company: company || undefined,
    } as Partial<Block>);
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
  const isCta =
    !!heading && CTA_HEADING.test(heading) && rest.length <= 4 && (CTA_TEXT.test(joined) || !!email || !!url || rest.length <= 2);
  if (isCta) {
    const dest = url ? (/^https?:/i.test(url) ? url : `https://${url}`) : (urls[0] ?? '');
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
    blocks.push(
      newBlock('stats', {
        heading: above.length ? undefined : heading || undefined,
        items: stats.map((st) => ({ value: st.value, label: st.label })),
      } as Partial<Block>),
    );
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

  const isProcess =
    numbered.length >= 3 || (numbered.length >= 2 && numbered.length >= rest.length - 1 && numbered.every((n, i) => n.num === i + 1));
  if (isProcess) {
    // "1. Capture" with its description on the line below
    const described = new Set<Para>();
    const describe = (n: Para): string | undefined => {
      const next = rest[rest.indexOf(n) + 1];
      if (n.lead || !next || next.kind !== 'para' || !tight(n, next, 1.3) || n.text.length > 70 || /[.!?]$/.test(n.text.trim()))
        return undefined;
      described.add(next);
      return next.text;
    };
    const items = numbered.slice(0, 8).map((n) => {
      const detail = describe(n);
      const [title, text] = detail
        ? [n.text, detail]
        : n.lead
          ? [
              n.lead,
              n.text
                .slice(n.lead.length)
                .trim()
                .replace(/^[.:–—-]\s*/, ''),
            ]
          : splitLead(n.text);
      return { title: titleize(title), text: text || undefined, hasLead: !!n.lead || !!text };
    });
    if (items.filter((i) => i.hasLead).length >= Math.ceil(items.length * 0.6)) {
      blocks.push(
        newBlock('steps', {
          heading: headText,
          intro: introText,
          items: items.map(({ title, text }) => ({ title, text })),
        } as Partial<Block>),
      );
    } else {
      // sentences, not titled steps: a numbered checklist reads better
      blocks.push(
        newBlock('checklist', {
          heading: headText,
          intro: introText,
          style: 'number',
          items: numbered.slice(0, 14).map((n) => truncate(n.text, 200)),
        } as Partial<Block>),
      );
    }
    const remaining = after.filter((a) => !described.has(a));
    if (remaining.length) blocks.push(textBlock(undefined, remaining, notes));
  } else if (bullets.length >= 3 || (bullets.length >= 2 && bullets.length >= rest.length - 1)) {
    const leads = bullets.filter((b) => b.lead || /^[^.]{3,60}(?::|\s[–—-]\s|\.\s)/.test(b.text)).length;
    if (leads >= Math.ceil(bullets.length * 0.6) && bullets.length <= 8) {
      const items = bullets.slice(0, 8).map((b, i) => {
        const [t, x] = b.lead ? [b.lead, b.text.slice(b.lead.length).replace(/^[.:–—\s-]+/, '')] : splitLead(b.text);
        return { icon: iconFor(`${t} ${x}`, i), title: titleize(t), text: x || '' };
      });
      blocks.push(
        newBlock('features', { heading: headText, intro: introText, columns: items.length === 4 ? 2 : 3, items } as Partial<Block>),
      );
    } else {
      blocks.push(
        newBlock('checklist', {
          heading: headText,
          intro: introText,
          style: 'check',
          items: bullets.slice(0, 14).map((b) => truncate(b.text, 160)),
        } as Partial<Block>),
      );
    }
    if (after.length) blocks.push(textBlock(undefined, after, notes));
  } else if (rest.length || (heading && !stats.length && !testimonial)) {
    const startsWithBody = rest.length ? textBlock(statsHandled ? undefined : heading, rest, notes) : null;
    if (startsWithBody) blocks.push(startsWithBody);
  }

  if (facts.length)
    blocks.push(
      newBlock('table', { heading: blocks.length ? undefined : heading || undefined, rows: facts, header: false } as Partial<Block>),
    );
  if (testimonial) blocks.push(testimonial);
  return blocks;
}

/**
 * Three or more small, unpunctuated scraps in a row ("Generic", "By title", "By account"...) are the labels of a chart,
 * which mean nothing without the chart. Takes them out of `paras` and counts them.
 */
function dropChartLabels(paras: Para[], body: number, notes: { labels?: number }) {
  const scrap = (p: Para) =>
    p.kind === 'para' && p.lines.length === 1 && p.text.length <= 24 && p.size <= body * 0.95 && !/[.!?:;,]$/.test(p.text.trim());
  for (let i = 0; i < paras.length;) {
    let n = 0;
    while (i + n < paras.length && scrap(paras[i + n])) n++;
    if (n >= 3) {
      paras.splice(i, n);
      notes.labels = (notes.labels ?? 0) + n;
    } else i += Math.max(n, 1);
  }
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
  const body = out.reduce(
    (acc, t, i) => (i > 0 && /^(- |\d+\. )/.test(t) && /^(- |\d+\. )/.test(out[i - 1]) ? `${acc}\n${t}` : i === 0 ? t : `${acc}\n\n${t}`),
    '',
  );
  return newBlock('text', { heading: heading || undefined, body } as Partial<Block>);
}

// ── The importer ────────────────────────────────────────────────────────────

/**
 * The look that suits the document: a dark document stays dark, serif type reads as editorial, anything else is clean.
 * (A page that is dark only because its cover is the brand colour is not a dark document.)
 */
export function lookFor(bodyLines: Line[], palette: Palette): StylePreset {
  let id = 'clean';
  if (palette.dark && !palette.brandCover) id = 'midnight';
  else {
    let serif = 0;
    let other = 0;
    for (const l of bodyLines) {
      for (const r of l.runs) {
        if (r.family === 'serif') serif += r.text.length;
        else other += r.text.length;
      }
    }
    if (serif > other) id = 'editorial';
  }
  return presetById(id)!;
}

export async function importToPage(doc: ExtractedDoc, palette: Palette, opts: ImportOptions): Promise<ImportResult> {
  const report: string[] = [];
  const allLines = buildLines(doc);
  const { kept, footer } = dropFurniture(allLines, doc.pages);
  const lines = kept;
  /** The lines that are prose and headings: tables are handled where their section is built. */
  const flow = lines.filter((l) => !l.table);

  let theme = ThemeSchema.parse({ brand: palette.brand });
  const base = (blocks: Block[], extra: Partial<Page> = {}): Page =>
    PageSchema.parse({
      theme,
      blocks,
      header: { enabled: true, button: { label: 'Download PDF', action: { type: 'document' } } },
      ...extra,
    });

  if (lines.reduce((n, l) => n + (l.table ? l.table.rows.length : 1), 0) < 3) {
    report.push(
      'This PDF has little or no selectable text (it may be scanned), so no copy could be extracted. We built a simple page around the PDF itself — add your own headline and sections.',
    );
    const title =
      opts.filename
        .replace(/\.pdf$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim() || 'Your document';
    return {
      page: base([
        newBlock('hero', {
          headline: title,
          subheadline: undefined,
          show_document: true,
          badge: 'Prepared for {{first_name|you}} at {{company|your team}}',
          primary: { label: 'Download the PDF', action: { type: 'document' } },
          secondary: undefined,
        } as Partial<Block>),
        newBlock('form', { bg: 'alt' }),
      ]),
      report,
    };
  }

  const body = modeSize(flow);
  const bodyLines = flow.filter((l) => Math.abs(l.size - body) < 0.6);
  const look = lookFor(bodyLines, palette);
  theme = applyPreset(theme, look);
  const xs = new Map<number, number>();
  for (const l of bodyLines) xs.set(Math.round(l.x), (xs.get(Math.round(l.x)) ?? 0) + 1);
  const bodyX = [...xs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 40;
  const colRight = Math.max(...bodyLines.map((l) => l.x2), 200);

  // ── title block on the first page that has text ───────────────────────────
  const firstPage = (flow[0] ?? lines[0]).page;
  const p1 = flow.filter((l) => l.page === firstPage);
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
  const totalChars = flow.reduce((n, l) => n + l.text.length, 0);
  const isCover =
    flow.some((l) => l.page > firstPage) &&
    p1.length <= 10 &&
    p1.reduce((n, l) => n + l.text.length, 0) < totalChars * 0.25 &&
    biggest >= body * 1.8;
  const titleIdx = titleLines.length ? Math.max(...titleLines.map((l) => l.idx)) : -1;

  // eyebrow: a short, small, mostly-caps line near the top, before or just above the title
  let eyebrow = '';
  const eyebrowLine = p1.find(
    (l) =>
      !consumed.has(l) &&
      l.size <= body * 1.3 &&
      l.text.length <= 60 &&
      (titleLines.length === 0 || l.y < titleLines[0].y) &&
      (/^[^a-z]*$/.test(l.text) || l.text === l.text.toUpperCase()),
  );
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
  for (const l of flow) {
    if (l.idx <= titleIdx || l.page !== firstPage || consumed.has(l)) continue;
    const prev = sub[sub.length - 1];
    const tight = !prev || l.y - (prev.y + prev.h) < prev.size * 1.2;
    if (
      sub.length < 4 &&
      tight &&
      l.size >= body * 1.0 &&
      l.size < biggest * 0.8 &&
      !BULLET_RE.test(l.text) &&
      (!prev || l.idx === prev.idx + 1)
    )
      sub.push(l);
    else if (sub.length || l.size >= body * 1.15) break;
  }
  const subtitle = cleanText(sub.map((l) => l.text).join(' '));
  sub.forEach((l) => consumed.add(l));
  coverBoiler.forEach((l) => consumed.add(l));

  // ── sections ──────────────────────────────────────────────────────────────
  const sections: Section[] = [];
  let current: Section = { heading: '', page: firstPage, lines: [] };
  const isHeading = (l: Line, i: number): boolean => {
    if (l.table) return false;
    const t = l.text.trim();
    if (!/\p{L}{2,}/u.test(t) || QUOTE_OPEN.test(t) || (l.italic && !l.bold) || /[.,;]$/.test(t)) return false;
    // right under the end of a quotation is who said it
    if (endsQuotation(lines, i - 1) && l.y - (lines[i - 1].y + lines[i - 1].h) < Math.max(l.size, lines[i - 1].size) * 8) return false;
    if (l.size >= body * 1.2 && t.length <= 110) return true;
    const next = lines[i + 1];
    return (
      l.bold &&
      !l.boldLead &&
      l.size >= body * 0.98 &&
      l.text.length <= 70 &&
      !/[.,;]$/.test(l.text) &&
      !!next &&
      !BULLET_RE.test(l.text) &&
      !NUMBER_RE.test(l.text) &&
      next.size <= l.size + 0.5
    );
  };
  const statements = findStatements(lines, body, consumed);
  lines.forEach((l, i) => {
    if (consumed.has(l)) return;
    const statement = statements.get(l);
    if (statement) {
      if (current.heading || current.lines.length) sections.push(current);
      sections.push({ heading: '', page: l.page, lines: statement, statement: true });
      statement.forEach((x) => consumed.add(x));
      current = { heading: '', page: l.page, lines: [] };
      return;
    }
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
      current = { heading: l.text, page: l.page, lines: [], size: l.size };
      return;
    }
    current.lines.push(l);
  });
  if (current.heading || current.lines.length) sections.push(current);
  // a table of contents says where things are in the PDF, which means nothing on a page
  for (let i = sections.length - 1; i >= 0; i--)
    if (CONTENTS_HEADING.test(cleanText(sections[i].heading).replace(/[:.]+$/, ''))) sections.splice(i, 1);
  sections.splice(0, sections.length, ...gatherCards(sections));

  // ── blocks ────────────────────────────────────────────────────────────────
  const urls = [...new Set(doc.pages.flatMap((p) => p.links.map((l) => l.url)))].filter((u) => /^https?:/i.test(u));
  const notes: { shortened: number; labels?: number } = { shortened: 0 };
  const sectionBlocks: Array<{ section: Section; blocks: Block[] }> = sections
    .map((s) => ({ section: s, blocks: blocksFromSection(s, body, bodyX, colRight, urls, notes) }))
    .filter((x) => x.blocks.length > 0);

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
      const above = sectionBlocks.filter(
        (s) => s.section.lines.some((l) => l.page === im.page && l.y + l.h <= im.y + 6) || s.section.page < im.page,
      );
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
    report.push(
      `The PDF has more sections than fit a landing page, so the last ${content.length - MAX} were left out. The full PDF is still available to download.`,
    );
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
    secondary: {
      label: 'Talk to us',
      action: hasCta || content.some((b) => b.type === 'form') ? { type: 'anchor', anchor: 'contact' } : { type: 'form' },
    },
    show_document: true,
    layout: 'split',
    bg: palette.brandCover ? 'brand' : palette.dark ? 'dark' : undefined,
  } as Partial<Block>);

  const blocks: Block[] = [hero, ...content];
  if (!hasCta)
    blocks.push(
      newBlock('cta', {
        id: newBlockId(),
        heading: 'Ready to talk, {{first_name|friend}}?',
        text: 'Book a short call and we’ll walk you through it.',
        button: { label: 'Get in touch', action: { type: 'form' } },
      } as Partial<Block>),
    );
  const cta = blocks.find((b) => b.type === 'cta');
  if (cta) cta.anchor = 'contact';
  blocks.push(newBlock('form', { bg: 'alt' }));

  const logoText = eyebrow
    ? eyebrow === eyebrow.toUpperCase()
      ? eyebrow.replace(/\w\S*/g, (w) => w.charAt(0) + w.slice(1).toLowerCase())
      : eyebrow
    : (doc.meta.author ?? '');
  const page = base(blocks, {
    header: {
      enabled: true,
      logo_text: logoText || undefined,
      button: { label: 'Download PDF', action: { type: 'document' } },
      sticky: false,
      logo: undefined,
    } as Page['header'],
    footer: { text: footer || '', links: [] },
    seo: {
      title: `${title} — prepared for {{company|you}}`,
      description: subtitle ? truncate(subtitle, 200) : '',
      noindex: true,
      lang: 'en',
    } as Page['seo'],
  });

  report.push(
    `Read ${doc.page_count} page${doc.page_count === 1 ? '' : 's'}: found ${sections.length} section${sections.length === 1 ? '' : 's'} and built ${content.length} content block${content.length === 1 ? '' : 's'}.`,
  );
  report.push(`Headline: “${truncate(title, 80)}”${subtitle ? ' with a sub-headline' : ''}.`);
  report.push(
    palette.found
      ? `Brand colour ${palette.brand} was picked from the PDF${palette.brandCover ? ', and the hero uses it as its background' : ''}.`
      : 'The PDF has no distinctive colour, so a default brand colour was used. Change it in Design.',
  );
  report.push(`Styled “${look.name}”: ${look.blurb.charAt(0).toLowerCase()}${look.blurb.slice(1)} Try the other styles in Design.`);
  if (imagesPlaced)
    report.push(
      `${imagesPlaced} image${imagesPlaced === 1 ? '' : 's'} from the PDF ${imagesPlaced === 1 ? 'was' : 'were'} added to the page.`,
    );
  if (notes.shortened)
    report.push(`${notes.shortened} long section${notes.shortened === 1 ? ' was' : 's were'} shortened — the PDF has the full text.`);
  if (notes.labels)
    report.push('Left out some short labels that looked like part of a chart or diagram. Add them back as text if they matter.');
  if (doc.tokens.length)
    report.push(
      `Found ${[...new Set(doc.tokens.map((t) => t.token))].join(', ')} in the PDF and set them up to be replaced for each prospect.`,
    );
  return { page, report };
}
