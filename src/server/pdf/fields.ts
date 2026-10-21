import { newBlockId } from '@shared/blocks';
import type { PdfField } from '@shared/schema';
import type { PageInfo, Run } from './extract';

type TextField = Extract<PdfField, { type: 'text' }>;

const MARGIN = 24;

/**
 * Turn a piece of existing PDF text into a "replace this with {{…}}" field.
 *
 * Two boxes are involved: the MASK covers exactly the original text; the field's layout box may be
 * wider, because the replacement ("Globex International") is often longer than the placeholder
 * ("[Company]"). How much wider depends on what sits next to it on the same line.
 */
export function fieldFromRun(page: Pick<PageInfo, 'width' | 'runs' | 'page'>, run: Run, opts: { template?: string } = {}): TextField {
  const neighbours = page.runs.filter((r) => r !== run && Math.abs(r.baseline - run.baseline) < run.size * 0.6);
  const rightNeighbour = neighbours.filter((r) => r.x > run.x + run.w * 0.5).sort((a, b) => a.x - b.x)[0];
  const leftNeighbour = neighbours.filter((r) => r.x + r.w < run.x + 1).sort((a, b) => b.x + b.w - (a.x + a.w))[0];

  const centre = run.x + run.w / 2;
  const centred = Math.abs(centre - page.width / 2) < Math.max(6, page.width * 0.012) && run.w < page.width * 0.85;
  const rightAligned = !centred && run.x > page.width * 0.4 && Math.abs(run.x + run.w - (page.width - MARGIN)) < Math.max(10, page.width * 0.02);

  const grow = Math.max(60, run.size * 12);
  let x = run.x;
  let w = run.w;
  let align: TextField['align'] = 'left';
  if (centred) {
    const half = Math.min(run.w / 2 + grow / 2, Math.min(centre - MARGIN, page.width - MARGIN - centre));
    x = centre - half;
    w = half * 2;
    align = 'center';
  } else if (rightAligned) {
    const room = leftNeighbour ? run.x - (leftNeighbour.x + leftNeighbour.w) - 8 - run.w : MARGIN + 1e9;
    const extra = Math.max(0, Math.min(grow, run.x - MARGIN, room));
    x = run.x - extra;
    w = run.w + extra;
    align = 'right';
  } else {
    const room = rightNeighbour ? rightNeighbour.x - 8 - run.x : page.width - MARGIN - run.x;
    w = Math.max(run.w, Math.min(run.w + grow, room));
  }

  return {
    id: `f_${newBlockId()}`,
    type: 'text',
    page: page.page,
    rect: { x, y: run.y, w, h: run.h },
    text: opts.template ?? run.text,
    font: { family: run.family, bold: run.bold, italic: run.italic },
    size: Math.round(run.size * 100) / 100,
    color: run.color ?? '#111827',
    align,
    valign: 'top',
    fit: 'shrink',
    line_height: 1.25,
    mask: { color: run.bg ?? '#ffffff', pad: 1, rect: { x: run.x, y: run.y, w: run.w, h: run.h } },
    source_text: run.text.slice(0, 200),
    label: run.text.length > 40 ? `${run.text.slice(0, 37)}…` : run.text,
  };
}

/** One field per run that already contains {{tokens}}, i.e. text the author wrote as a placeholder. */
export function fieldsForTokenRuns(pages: Array<Pick<PageInfo, 'width' | 'runs' | 'page'>>): TextField[] {
  const out: TextField[] = [];
  for (const pg of pages) for (const r of pg.runs) if (/\{\{[^{}]{1,80}\}\}/.test(r.text)) out.push(fieldFromRun(pg, r));
  return out;
}

/** A discreet "Prepared for …" line near the bottom of page 1, coloured to contrast with what is under it. */
export function stampField(page: Pick<PageInfo, 'width' | 'height' | 'runs' | 'page'>, bgHex: string): TextField {
  const dark = parseInt(bgHex.slice(1, 3), 16) * 0.299 + parseInt(bgHex.slice(3, 5), 16) * 0.587 + parseInt(bgHex.slice(5, 7), 16) * 0.114 < 140;
  const size = 10;
  return {
    id: `f_${newBlockId()}`,
    type: 'text',
    page: page.page,
    rect: { x: 40, y: page.height - 44, w: page.width - 80, h: 16 },
    text: 'Prepared for {{full_name|you}} · {{company|your team}}',
    font: { family: 'inter', bold: false, italic: false },
    size,
    color: dark ? '#ffffff' : '#334155',
    align: 'left',
    valign: 'top',
    fit: 'shrink',
    line_height: 1.25,
    mask: null,
    label: 'Prepared for stamp',
  };
}
