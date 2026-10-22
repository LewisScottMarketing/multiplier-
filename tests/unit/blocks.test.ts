import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, newBlock } from '../../src/shared/blocks';
import { canVary, textLeaves, withLeaves } from '../../src/shared/block-text';
import { lintCampaign } from '../../src/shared/lint';
import { BlockSchema, CampaignSettingsSchema, PageSchema } from '../../src/shared/schema';
import { tableToText, textToTable } from '../../src/shared/table-text';
import { renderPage } from '../../src/server/render/page';
import { buildContext } from '../../src/shared/derive';

const render = (blocks: ReturnType<typeof newBlock>[], data: Record<string, unknown> = {}) =>
  renderPage({
    campaign: {
      id: 'cmp_1',
      name: 'T',
      slug: 't',
      page: PageSchema.parse({ blocks, header: { enabled: false } }),
      document: null,
      settings: CampaignSettingsSchema.parse({}),
    },
    ctx: buildContext(data),
    mode: 'preview',
    token: null,
    host: 'go.test',
    origin: 'https://go.test',
    urls: { submit: '#' },
  }).html.replace(/<style[\s\S]*?<\/style>/g, '');

const section = (html: string, id: string) => html.match(new RegExp(`<section[^>]*data-b="${id}"[\\s\\S]*?</section>`))?.[0] ?? '';

describe('every kind of block', () => {
  it('has a label, a starter that validates, and a place in the page', () => {
    const quiet = new Set(['logos', 'image', 'video', 'calendar', 'document']); // render nothing until they have something to show
    expect(BLOCK_TYPES.length).toBe(new Set(BLOCK_TYPES.map((b) => b.type)).size);
    for (const meta of BLOCK_TYPES) {
      expect(meta.label.length, meta.type).toBeGreaterThan(2);
      expect(meta.description.length, meta.type).toBeGreaterThan(10);
      const block = newBlock(meta.type, { id: 'blk1' });
      expect(BlockSchema.safeParse(block).success, meta.type).toBe(true);
      expect(block.type).toBe(meta.type);
      const html = render([block]);
      if (!quiet.has(meta.type)) expect(html, meta.type).toContain('data-b="blk1"');
      expect(html, meta.type).not.toMatch(/\{\{|undefined|\[object/);
    }
  });

  it('is covered by the schema: every type in the union has an entry in the list', () => {
    const inSchema = BlockSchema.options.map((o) => o.shape.type.value).sort();
    expect(BLOCK_TYPES.map((b) => b.type).sort()).toEqual(inSchema);
  });

  it('starts out free of warnings in a campaign of its own', () => {
    for (const meta of BLOCK_TYPES.filter((m) => !['hero', 'cta', 'document'].includes(m.type))) {
      const page = PageSchema.parse({ blocks: [newBlock(meta.type)] });
      const issues = lintCampaign({ page, document: null, settings: CampaignSettingsSchema.parse({}) }).filter((i) => i.level === 'warn');
      expect(issues, meta.type).toEqual([]);
    }
  });
});

describe('picture and text', () => {
  const img = { src: 'ast_abc123', alt: 'A dashboard' };

  it('puts the text and the picture side by side, picture on the right unless told otherwise', () => {
    const html = section(render([newBlock('split', { id: 's', heading: 'See it', body: 'Plain words.', image: img })]), 's');
    expect(html).toContain('blk-split');
    expect(html).not.toContain(' flip');
    expect(html).toContain('<h2>See it</h2>');
    expect(html).toContain('<img src="/a/ast_abc123" alt="A dashboard"');
    expect(html.indexOf('split-text')).toBeLessThan(html.indexOf('split-media'));
  });

  it('can put the picture on the left, and copes with having no picture', () => {
    expect(section(render([newBlock('split', { id: 's', side: 'left', image: img })]), 's')).toContain(' flip');
    const bare = section(render([newBlock('split', { id: 's', image: { src: '', alt: '' } })]), 's');
    expect(bare).toContain('no-media');
    expect(bare).not.toContain('split-media');
  });

  it('renders the text as the author wrote it, with bold and bullets, and merges data safely', () => {
    const html = render(
      [
        newBlock('split', {
          id: 's',
          heading: 'For {{company|you}}',
          body: '**Two** things:\n\n- One\n- Two',
          button: { label: 'Go', action: { type: 'form' } },
        }),
      ],
      { company: '<img src=x onerror=alert(1)>' },
    );
    expect(html).toContain('<strong>Two</strong>');
    expect(html).toContain('<li>One</li>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('only accepts pictures from our own server or https, like every other picture', () => {
    expect(render([newBlock('split', { id: 's', image: { src: 'http://evil.test/x.png', alt: '' } })])).not.toContain('evil.test');
  });

  it('can be rewritten for another audience, heading and text only', () => {
    const b = newBlock('split', { heading: 'H', body: 'B', eyebrow: 'E', image: img });
    expect(canVary(b)).toBe(true);
    expect(textLeaves(b).map((l) => l.path)).toEqual(['eyebrow', 'heading', 'body']);
    const v = withLeaves(b, { heading: 'New', image: 'x' } as never);
    expect(v).toMatchObject({ heading: 'New', body: 'B', image: img });
  });
});

describe('highlight', () => {
  it('sets one statement large, with where it came from', () => {
    const html = section(
      render([
        newBlock('callout', { id: 'c', eyebrow: 'The point', text: 'Relevance is the only filter.', attribution: 'The 2026 playbook' }),
      ]),
      'c',
    );
    expect(html).toContain('class="callout-text">Relevance is the only filter.</p>');
    expect(html).toContain('callout-by');
    expect(html).toContain('The point');
    expect(html).toContain('align-center');
  });

  it('shows nothing when there is nothing to say', () => {
    expect(render([newBlock('callout', { id: 'c', text: '  ' })])).not.toContain('data-b="c"');
  });

  it('can be rewritten for another audience', () => {
    const b = newBlock('callout', { text: 'Say it.', attribution: 'Someone' });
    expect(canVary(b)).toBe(true);
    // who said it is evidence, not copy to be re-angled
    expect(textLeaves(b).map((l) => l.path)).toEqual(['text']);
  });
});

describe('table', () => {
  const rows = [
    ['Plan', 'Starter', 'Growth'],
    ['Price', '$99', '$399'],
    ['Prospects', '500', '5,000'],
  ];

  it('makes the first row a header and the first column a row header', () => {
    const html = section(render([newBlock('table', { id: 't', heading: 'Prices', rows })]), 't');
    expect(html).toContain('<thead><tr><th scope="col">Plan</th><th scope="col">Starter</th><th scope="col">Growth</th></tr></thead>');
    expect(html).toContain('<tr><th scope="row">Price</th><td>$99</td><td>$399</td></tr>');
    expect(html).toContain('role="region" aria-label="Prices" tabindex="0"');
    expect(html.match(/<tr>/g)).toHaveLength(3);
  });

  it('treats every row as data when there is no header', () => {
    const html = section(render([newBlock('table', { id: 't', rows, header: false })]), 't');
    expect(html).not.toContain('<thead>');
    expect(html.match(/<tr>/g)).toHaveLength(3);
  });

  it('pads short rows, skips empty ones, and shows nothing for a table with no cells', () => {
    const html = section(render([newBlock('table', { id: 't', rows: [['A', 'B', 'C'], ['only'], ['', '', ''], ['x', 'y']] })]), 't');
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(html).toContain('<th scope="row">only</th><td></td><td></td>');
    expect(render([newBlock('table', { id: 't', rows: [['', ''], []] })])).not.toContain('data-b="t"');
  });

  it('merges data into cells as text, never as markup', () => {
    const html = render(
      [
        newBlock('table', {
          id: 't',
          rows: [
            ['Name', 'Company'],
            ['Jane', '{{company}}'],
          ],
        }),
      ],
      { company: '<b>x</b>' },
    );
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('is limited to a size a page can hold', () => {
    expect(BlockSchema.safeParse(newBlock('table', { rows: Array.from({ length: 41 }, () => ['a']) })).success).toBe(false);
    expect(BlockSchema.safeParse(newBlock('table', { rows: [Array.from({ length: 9 }, () => 'a')] })).success).toBe(false);
    expect(BlockSchema.safeParse(newBlock('table', { rows: [['x'.repeat(201)]] })).success).toBe(false);
  });

  it('is not offered for rewriting: its cells are data', () => {
    expect(canVary(newBlock('table'))).toBe(false);
  });
});

describe('a table as text', () => {
  it('reads one row a line with the cells split by a bar or a tab', () => {
    expect(textToTable('A | B | C\n1 | 2 | 3')).toEqual([
      ['A', 'B', 'C'],
      ['1', '2', '3'],
    ]);
    expect(textToTable('A\tB\r\n1\t2')).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
    expect(textToTable('  A|B  \n\n   \n|\n1|2')).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('keeps within what a table may hold, and round-trips what it wrote', () => {
    expect(textToTable(Array.from({ length: 50 }, (_, i) => `row ${i}`).join('\n'))).toHaveLength(40);
    expect(textToTable('a|b|c|d|e|f|g|h|i|j')[0]).toHaveLength(8);
    const rows = [
      ['Plan', 'Starter'],
      ['Price', '$99'],
    ];
    expect(textToTable(tableToText(rows))).toEqual(rows);
  });
});

describe('spacing between sections', () => {
  it('runs a picture-and-text section into the content above it, but not a highlight', () => {
    const html = render([
      newBlock('text', { id: 'a' }),
      newBlock('split', { id: 'b' }),
      newBlock('callout', { id: 'c' }),
      newBlock('table', { id: 'd' }),
    ]);
    expect(section(html, 'b')).toContain('join');
    expect(section(html, 'c')).not.toContain('join');
    expect(section(html, 'd')).not.toContain('join');
  });
});
