import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/shared/schema';
import { extractDocument } from '../../src/server/pdf/extract';
import { importToPage } from '../../src/server/pdf/import';
import type { Palette } from '../../src/server/pdf/raster';
import { filler, makePdf, para, type Put, type Sheet } from '../helpers/pdfs';

/** Layouts the importer used to read wrongly, built from text placed exactly where each case needs it. */

const palette: Palette = { brand: '#1d3557', dominant: '#ffffff', dark: false, brandCover: false, found: true };

async function importOf(pages: Sheet[]) {
  const doc = await extractDocument(await makePdf(pages));
  const out = await importToPage(doc, palette, { filename: 'case.pdf' });
  const blocks = out.page.blocks.filter((b) => b.type !== 'hero' && b.type !== 'form' && b.anchor !== 'contact');
  return { doc, blocks, all: out.page.blocks, report: out.report };
}
const ofType = <T extends Block['type']>(blocks: Block[], type: T) =>
  blocks.filter((b): b is Extract<Block, { type: T }> => b.type === type);

/** A cover page, so the pages after it are read as the body of a document. */
const cover: Sheet = {
  items: [
    { text: 'The Outbound Playbook', x: 50, y: 120, size: 40, bold: true },
    { text: 'How teams turn outreach into meetings', x: 50, y: 190, size: 16 },
  ],
};

describe('contents pages', () => {
  it('leaves out a table of contents, dot leaders and all', async () => {
    const dots = '. '.repeat(30);
    const { blocks } = await importOf([
      cover,
      {
        items: [
          { text: 'Contents', x: 50, y: 60, size: 20, bold: true },
          ...para(
            ['Why outreach fails ' + dots + '3', 'Three levers that work ' + dots + '5', 'What the numbers say ' + dots + '7'],
            50,
            100,
            12,
          ),
        ],
      },
      { items: [{ text: 'Why outreach fails', x: 50, y: 60, size: 20, bold: true }, ...filler(50, 100, 6)] },
    ]);
    const text = JSON.stringify(blocks);
    expect(text).not.toMatch(/Contents/);
    expect(text).not.toMatch(/\. \. \./);
    expect(text).toContain('Why outreach fails');
  });
});

describe('letter-spaced headings', () => {
  it('joins a short tracked word to the longer ones beside it ("Q 4")', async () => {
    const { doc } = await importOf([
      {
        items: [{ text: 'Q 4', x: 50, y: 40, size: 13 }, { text: 'R E V E N U E', x: 82, y: 40, size: 13 }, ...cover.items],
      },
    ]);
    expect(doc.pages[0].runs.some((r) => r.text === 'Q4 REVENUE')).toBe(true);
  });
});

describe('tables', () => {
  const grid = (rows: string[][], xs: number[], y: number, boldFirst = true): Put[] =>
    rows.flatMap((row, r) => row.map((text, c) => ({ text, x: xs[c], y: y + r * 22, size: 11, bold: boldFirst && r === 0 })));

  it('reads columns that line up as a table, header row included', async () => {
    const { blocks } = await importOf([
      cover,
      {
        items: [
          { text: 'What the numbers say', x: 50, y: 60, size: 20, bold: true },
          ...grid(
            [
              ['Approach', 'Reply rate', 'Meetings per 100'],
              ['Generic', '1.2%', '0.4'],
              ['By title', '2.1%', '0.9'],
              ['Personalised', '4.1%', '2.2'],
            ],
            [50, 200, 340],
            110,
          ),
          ...filler(50, 260, 5),
        ],
      },
    ]);
    const [table] = ofType(blocks, 'table');
    expect(table.heading).toBe('What the numbers say');
    expect(table.header).toBe(true);
    expect(table.rows).toEqual([
      ['Approach', 'Reply rate', 'Meetings per 100'],
      ['Generic', '1.2%', '0.4'],
      ['By title', '2.1%', '0.9'],
      ['Personalised', '4.1%', '2.2'],
    ]);
    // the copy below it is still copy, not table
    expect(ofType(blocks, 'text').some((b) => /Outbound teams rarely fail/.test(b.body))).toBe(true);
  });

  it('keeps a table in order when one column holds right-aligned figures and cells wrap', async () => {
    const { blocks } = await importOf([
      cover,
      {
        items: [
          { text: 'Pricing', x: 50, y: 60, size: 20, bold: true },
          ...grid(
            [
              ['Plan', 'Prospects', 'Price'],
              ['Starter', '500', '$99'],
              ['Growth', '5,000', '$399'],
              ['Scale', '50,000', '$1,490'],
            ],
            [50, 220, 380],
            110,
          ),
          ...filler(50, 260, 4),
        ],
      },
    ]);
    expect(ofType(blocks, 'table')[0].rows[3]).toEqual(['Scale', '50,000', '$1,490']);
  });

  it('does not take two columns of running text for a table', async () => {
    const left = [
      'Outbound teams rarely fail because',
      'of effort. They fail because the',
      'message that reaches the buyer was',
      'written for nobody in particular,',
      'and buyers can tell within a',
    ];
    const right = [
      'sentence. The first lever is the',
      'targeting: concentrate on the',
      'accounts that feel the problem',
      'most, and be willing to say no',
      'to the rest of the list.',
    ];
    const { blocks } = await importOf([cover, { items: [...para(left, 50, 100), ...para(right, 320, 100)] }]);
    expect(ofType(blocks, 'table')).toHaveLength(0);
    const copy = ofType(blocks, 'text')
      .map((b) => b.body)
      .join(' ');
    // read a column at a time, so each sentence runs on
    expect(copy).toContain('and buyers can tell within a');
    expect(copy.indexOf('written for nobody')).toBeLessThan(copy.indexOf('sentence. The first lever'));
  });

  it('does not take a row of figures and their captions for a table', async () => {
    const { blocks } = await importOf([
      cover,
      {
        items: [
          { text: 'Results', x: 50, y: 60, size: 20, bold: true },
          { text: '63%', x: 50, y: 110, size: 34, bold: true },
          { text: '3.4x', x: 220, y: 110, size: 34, bold: true },
          { text: '9 wks', x: 380, y: 110, size: 34, bold: true },
          { text: 'faster onboarding', x: 50, y: 160, size: 10 },
          { text: 'more replies', x: 220, y: 160, size: 10 },
          { text: 'to full rollout', x: 380, y: 160, size: 10 },
          ...filler(50, 260, 5),
        ],
      },
    ]);
    expect(ofType(blocks, 'table')).toHaveLength(0);
    expect(ofType(blocks, 'stats')[0].items.map((i) => i.value)).toEqual(['63%', '3.4x', '9 wks']);
  });
});

describe('fact boxes', () => {
  it('turns bold labels with their values into a two-column table', async () => {
    const { blocks } = await importOf([
      cover,
      {
        items: [
          { text: 'At a glance', x: 50, y: 60, size: 20, bold: true },
          { text: 'Industry', x: 50, y: 110, size: 10, bold: true },
          { text: 'Logistics', x: 50, y: 124, size: 10 },
          { text: 'Team size', x: 50, y: 148, size: 10, bold: true },
          { text: '1,200 people', x: 50, y: 162, size: 10 },
          ...filler(50, 260, 5),
        ],
      },
    ]);
    const [facts] = ofType(blocks, 'table');
    expect(facts.header).toBe(false);
    expect(facts.rows).toEqual([
      ['Industry', 'Logistics'],
      ['Team size', '1,200 people'],
    ]);
  });
});

describe('numbered steps', () => {
  it('puts a number drawn beside its text back in front of it', async () => {
    const step = (n: number, y: number, title: string, rest: string): Put[] => [
      { text: `${title} ${rest}`, x: 90, y, size: 11 },
      { text: 'and what it means for the buyer.', x: 90, y: y + 16, size: 11 },
      { text: String(n), x: 56, y: y + 6, size: 13, bold: true },
    ];
    const { blocks } = await importOf([
      cover,
      {
        items: [
          { text: 'How it works', x: 50, y: 60, size: 20, bold: true },
          ...step(1, 110, 'Capture.', 'Pull accounts into your tool'),
          ...step(2, 170, 'Personalise.', 'Merge name and company into every asset'),
          ...step(3, 230, 'Send.', 'Drop a unique link into the sequence'),
          ...filler(50, 330, 4),
        ],
      },
    ]);
    const [steps] = ofType(blocks, 'steps');
    expect(steps.items.map((i) => i.title)).toEqual(['Capture', 'Personalise', 'Send']);
    expect(JSON.stringify(steps)).not.toMatch(/"(?:title|text)":"\d+"/);
  });

  it('uses the line under a numbered title as its description', async () => {
    const { blocks } = await importOf([
      cover,
      {
        items: [
          { text: 'How it works', x: 50, y: 60, size: 20, bold: true },
          { text: '1. Capture', x: 50, y: 110, size: 12, bold: true },
          { text: 'Pull accounts into your tool', x: 50, y: 126, size: 11 },
          { text: '2. Personalise', x: 50, y: 160, size: 12, bold: true },
          { text: 'Merge name and company into every asset', x: 50, y: 176, size: 11 },
          { text: '3. Send', x: 50, y: 210, size: 12, bold: true },
          { text: 'Drop a unique link into the sequence', x: 50, y: 226, size: 11 },
          ...filler(50, 320, 4),
        ],
      },
    ]);
    const [steps] = ofType(blocks, 'steps');
    expect(steps.items).toMatchObject([
      { title: 'Capture', text: 'Pull accounts into your tool' },
      { title: 'Personalise', text: 'Merge name and company into every asset' },
      { title: 'Send', text: 'Drop a unique link into the sequence' },
    ]);
  });
});

describe('quotations', () => {
  it('reads a name and a role under a quotation as who said it, not as a heading', async () => {
    const { blocks } = await importOf([
      cover,
      {
        items: [
          ...filler(50, 60, 4),
          { text: '"We stopped talking about the problem and started shipping', x: 50, y: 200, size: 12 },
          { text: 'the fix."', x: 50, y: 216, size: 12 },
          { text: 'Dana Whitfield', x: 50, y: 244, size: 11, bold: true },
          { text: 'VP Operations, Globex', x: 50, y: 259, size: 11 },
          ...filler(50, 330, 4),
        ],
      },
    ]);
    const [quote] = ofType(blocks, 'testimonial');
    expect(quote).toMatchObject({ name: 'Dana Whitfield', role: 'VP Operations', company: 'Globex' });
    expect(quote.quote).toContain('started shipping the fix');
    expect(blocks.some((b) => 'heading' in b && b.heading === 'Dana Whitfield')).toBe(false);
  });
});

describe('slides', () => {
  const slide = (items: Put[]): Sheet => ({ width: 960, height: 540, items });

  it('makes a slide that is one big sentence into a callout', async () => {
    const { blocks } = await importOf([
      slide([
        { text: 'The Outbound Playbook', x: 60, y: 160, size: 48, bold: true },
        { text: 'How teams turn outreach into meetings', x: 60, y: 240, size: 18 },
      ]),
      slide([
        { text: 'Why it matters', x: 60, y: 50, size: 30, bold: true },
        ...para(['Outbound teams rarely fail because of effort.', 'They fail because the message was written for nobody.'], 60, 120, 16),
      ]),
      slide([
        { text: 'Generic outreach is ignored.', x: 60, y: 160, size: 54, bold: true },
        { text: 'Relevance is the only filter that', x: 60, y: 230, size: 54, bold: true },
        { text: 'still works.', x: 60, y: 300, size: 54, bold: true },
      ]),
    ]);
    const [callout] = ofType(blocks, 'callout');
    expect(callout.text).toBe('Generic outreach is ignored. Relevance is the only filter that still works.');
  });

  it('reads a row of cards column by column and builds a features block', async () => {
    const card = (x: number, title: string, lines: string[]): Put[] => [
      { text: title, x, y: 150, size: 19, bold: true },
      ...para(lines, x, 185, 14),
    ];
    const { blocks } = await importOf([
      slide([
        { text: 'The Outbound Playbook', x: 60, y: 160, size: 48, bold: true },
        { text: 'How teams turn outreach into meetings', x: 60, y: 240, size: 18 },
      ]),
      slide([
        { text: 'Three changes that matter', x: 60, y: 50, size: 30, bold: true },
        ...card(60, 'Sharper targeting', ['Focus on the teams that feel', 'the problem most, not everyone', 'with the right title.']),
        ...card(360, 'Faster follow-up', ['Reply within the hour,', 'automatically, while they are', 'still thinking about you.']),
        ...card(660, 'Clear measurement', ['Every change is tied to', 'meetings booked and pipeline', 'created.']),
      ]),
    ]);
    const [features] = ofType(blocks, 'features');
    expect(features.heading).toBe('Three changes that matter');
    expect(features.items.map((i) => i.title)).toEqual(['Sharper targeting', 'Faster follow-up', 'Clear measurement']);
    expect(features.items[0].text).toBe('Focus on the teams that feel the problem most, not everyone with the right title.');
  });
});

describe('footnote marks', () => {
  it('does not let a raised reference number split a line', async () => {
    const { blocks } = await importOf([
      cover,
      {
        items: [
          { text: 'Why it works', x: 50, y: 60, size: 20, bold: true },
          { text: 'An automatic reply within the hour recovers most of what a manual one', x: 50, y: 110, size: 11 },
          { text: 'loses.', x: 50, y: 126, size: 11 },
          { text: '1', x: 82, y: 122, size: 8 },
          { text: 'The follow-up has to arrive while the buyer is still thinking about you.', x: 50, y: 142, size: 11 },
          ...filler(50, 200, 4),
        ],
      },
    ]);
    const copy = ofType(blocks, 'text')
      .map((b) => b.body)
      .join('\n');
    expect(copy).toContain('manual one loses.');
    expect(copy).not.toMatch(/loses\.\s*1\b/);
  });
});

describe('text that runs on', () => {
  it('reads a sentence that runs over a page break as one paragraph', async () => {
    const { blocks } = await importOf([
      cover,
      {
        items: [
          { text: 'Why it works', x: 50, y: 90, size: 20, bold: true },
          ...filler(50, 140, 4),
          { text: 'Interest decays quickly, so the follow-up has to arrive while the', x: 50, y: 300, size: 11 },
        ],
      },
      { items: [{ text: 'buyer is still thinking about you. An automatic reply recovers most of it.', x: 50, y: 90, size: 11 }] },
    ]);
    const copy = ofType(blocks, 'text')
      .map((b) => b.body)
      .join('\n\n');
    expect(copy).toContain('while the buyer is still thinking about you.');
  });
});

describe('a column beside the main text', () => {
  it('keeps the facts and figures in a side column out of the main list of paragraphs', async () => {
    const { blocks } = await importOf([
      cover,
      {
        items: [
          { text: 'The challenge', x: 50, y: 60, size: 20, bold: true },
          ...para(
            [
              'Every new hire took three months to reach full speed.',
              'Knowledge lived in heads, tools did not talk to each other,',
              'and managers spent a day a week answering questions.',
              'It was slow, and it was costing the business money.',
            ],
            50,
            100,
            11,
          ),
          { text: 'Industry', x: 400, y: 100, size: 10, bold: true },
          { text: 'Logistics', x: 400, y: 114, size: 10 },
          { text: 'Team size', x: 400, y: 138, size: 10, bold: true },
          { text: '1,200 people', x: 400, y: 152, size: 10 },
          { text: 'Region', x: 400, y: 176, size: 10, bold: true },
          { text: 'North America', x: 400, y: 190, size: 10 },
        ],
      },
    ]);
    const [facts] = ofType(blocks, 'table');
    expect(facts.rows).toEqual([
      ['Industry', 'Logistics'],
      ['Team size', '1,200 people'],
      ['Region', 'North America'],
    ]);
    expect(ofType(blocks, 'checklist')).toHaveLength(0);
    expect(ofType(blocks, 'text')[0].body).toContain('costing the business money.');
  });
});

describe('charts', () => {
  it('leaves out the labels of a chart, and reads a lone big figure as a statistic', async () => {
    const { blocks, report } = await importOf([
      cover,
      {
        width: 960,
        height: 540,
        items: [
          { text: 'Reply rate by approach', x: 60, y: 50, size: 30, bold: true },
          { text: 'Generic', x: 100, y: 430, size: 12 },
          { text: 'By title', x: 200, y: 430, size: 12 },
          { text: 'By account', x: 300, y: 430, size: 12 },
          { text: 'Personalised', x: 400, y: 430, size: 12 },
          { text: '3.4x', x: 600, y: 150, size: 45, bold: true },
          { text: 'more replies when the page and the PDF', x: 600, y: 215, size: 16 },
          { text: 'both use the prospect’s own details.', x: 600, y: 239, size: 16 },
          ...para(['Reply rates were measured across every campaign we ran during the year.'], 60, 100, 16),
        ],
      },
    ]);
    const [stat] = ofType(blocks, 'stats');
    expect(stat.items).toEqual([{ value: '3.4x', label: 'more replies when the page and the PDF both use the prospect’s own details.' }]);
    expect(JSON.stringify(blocks)).not.toMatch(/By account|Personalised/);
    expect(report.join(' ')).toMatch(/labels that looked like part of a chart/);
  });
});
