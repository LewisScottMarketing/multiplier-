import { describe, expect, it } from 'vitest';
import { newBlock } from '../../src/shared/blocks';
import { STYLE_PRESETS } from '../../src/shared/presets';
import { PageSchema } from '../../src/shared/schema';
import { userContent } from '../../src/server/services/ai';
import {
  assemblePage,
  buildDesignPrompt,
  DESIGN_SCHEMA,
  DESIGN_SYSTEM,
  figuresIn,
  PLAN_BLOCK_TYPES,
  PlanRejected,
  readPlan,
  type AssembleOptions,
  type DesignInput,
  type PlanImage,
} from '../../src/server/pdf/design-plan';
import { choosePages, figuresOf, pictureWidth, tokenNames } from '../../src/server/pdf/design-input';
import type { ExtractedDoc } from '../../src/server/pdf/extract';
import { item, planBlock, playbookPlan } from '../helpers/design';

// text the playbook plan's words come from, long enough for the document checks to apply
const SOURCE = {
  text: [
    'The 2026 Outbound Pipeline Playbook. How high-growth B2B teams turn cold outreach into booked meetings, without sounding like everyone else.',
    "Why personalisation wins. Generic outreach is ignored. Buyers receive dozens of near-identical emails a week, so relevance is the only filter that still works. Teams that reference the buyer's company, role and context see dramatically higher reply rates.",
    '3.4x more replies than generic sequences. 47% shorter sales cycles. $1.2M pipeline created per rep.',
    "What the best teams do. Lead with a specific insight about the prospect's business. Match the message to the buyer's seniority and department. Give prospects a page that speaks to them, not a brochure. Follow up based on what they actually looked at.",
    'We stopped sending PDFs and started sending pages that felt written for each buyer. Meetings doubled in a quarter. Jordan Lee, VP Sales, Northwind.',
    'How it works. Capture. Pull accounts and contacts into your enrichment tool. Personalise. Merge name, company and job title into every asset. Send. Drop a unique link into your sequence. Follow up. Trigger the next step when they engage.',
    'Ready to talk? Book a 20-minute walkthrough at hello@acmegrowth.com or visit acmegrowth.com/demo. Attn: {{first_name}} {{last_name}}',
  ].join('\n'),
  tokens: ['first_name', 'last_name'],
};

const options = (over: Partial<AssembleOptions> = {}): AssembleOptions => ({
  source: SOURCE,
  palette: { brand: '#4f46e5', brandCover: false, dark: false },
  imageFor: (pick) => (pick?.ref === 'P2-I1' ? 'ast_chart1' : null),
  fallbackStyle: STYLE_PRESETS[0]!,
  fallbackLogo: 'Acme Growth Labs',
  ...over,
});

describe('the plan the model must return', () => {
  type Schema = Record<string, unknown>;
  const walk = (node: unknown, visit: (n: Schema) => void) => {
    if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
    else if (node && typeof node === 'object') {
      visit(node as Schema);
      Object.values(node).forEach((n) => walk(n, visit));
    }
  };

  it('follows the rules structured outputs imposes: closed objects, every property required, no unsupported keywords', () => {
    let objects = 0;
    walk(DESIGN_SCHEMA, (n) => {
      if (n.type === 'object') {
        objects++;
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required as string[])].sort()).toEqual(Object.keys(n.properties as object).sort());
      }
      for (const banned of [
        'minLength',
        'maxLength',
        'minimum',
        'maximum',
        'multipleOf',
        'minItems',
        'maxItems',
        'pattern',
        '$ref',
        '$defs',
        'oneOf',
      ])
        expect(n, banned).not.toHaveProperty(banned);
    });
    expect(objects).toBeGreaterThan(4);
  });

  it('offers exactly the blocks and styles we can build', () => {
    const props = (DESIGN_SCHEMA.properties.blocks as { items: { properties: { type: { enum: string[] } } } }).items.properties;
    expect(props.type.enum).toEqual([...PLAN_BLOCK_TYPES]);
    expect((DESIGN_SCHEMA.properties.style as { enum: string[] }).enum).toEqual(STYLE_PRESETS.map((p) => p.id));
    for (const type of PLAN_BLOCK_TYPES) expect(DESIGN_SYSTEM, type).toContain(`- ${type}:`);
  });

  it('tells the model the rules that matter: faithful, no invented figures, pictures are the truth', () => {
    expect(DESIGN_SYSTEM).toMatch(/Never invent facts, figures/);
    expect(DESIGN_SYSTEM).toMatch(/Every number on your page must be in the document/);
    expect(DESIGN_SYSTEM).toMatch(/trust the pictures/);
    expect(DESIGN_SYSTEM).toMatch(/Keep merge fields .* exactly/);
  });
});

describe('reading the reply', () => {
  it('turns a good reply into a plan', () => {
    const plan = readPlan(JSON.parse(JSON.stringify(playbookPlan())));
    expect(plan?.hero.headline).toBe('The 2026 Outbound Pipeline Playbook');
    expect(plan?.blocks.map((b) => b.type)).toEqual(['callout', 'stats', 'split', 'testimonial', 'steps', 'cta']);
  });

  it('refuses what is not a plan, and ignores what it cannot use', () => {
    expect(readPlan(null)).toBeNull();
    expect(readPlan('hello')).toBeNull();
    expect(readPlan({ blocks: [] })).toBeNull();
    expect(readPlan({ hero: { headline: 'x' } })).toBeNull();
    const plan = readPlan({
      hero: { headline: 'Hi', layout: 'wibble', image: { ref: 3, box: [1, 2, 3], page: 'one' } },
      style: 7,
      blocks: [
        null,
        'x',
        { type: 'carousel', heading: 'Nope' },
        {
          type: 'text',
          heading: 12,
          text: 'Fine',
          items: [null, { title: 'A', text: 5 }],
          rows: 'no',
          side: 'up',
          bg: 'neon',
          image: { box: [0, 0, 100, 100] },
        },
      ],
      notes: ['one', 2, '  '],
    })!;
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]).toMatchObject({ type: 'text', heading: null, text: 'Fine', side: null, bg: null, rows: null });
    expect(plan.blocks[0]!.items).toEqual([{ title: 'A', text: null, value: null, label: null, icon: null }]);
    expect(plan.blocks[0]!.image?.box).toEqual([0, 0, 100, 100]);
    expect(plan.hero.image).toMatchObject({ ref: null, box: null, page: null });
    expect(plan.style).toBe('clean');
    expect(plan.notes).toEqual(['one']);
  });
});

describe('building a page from a plan', () => {
  it('makes a valid page: hero first, the call to action and the form last, in the chosen style', () => {
    const { page, notes, dropped } = assemblePage(playbookPlan({ style: 'editorial' }), options());
    expect(PageSchema.safeParse(page).success).toBe(true);
    expect(page.blocks.map((b) => b.type)).toEqual(['hero', 'callout', 'stats', 'split', 'testimonial', 'steps', 'cta', 'form']);
    expect(page.theme).toMatchObject({ brand: '#4f46e5', heading_font: 'fraunces', bg: '#fbf8f3' });
    expect(page.header.logo_text).toBe('Acme Growth Labs');
    expect(notes).toEqual(['The reply-rate chart is kept beside the list of what the best teams do.']);
    expect(dropped).toEqual([]);
  });

  it('gives the hero the personal line, the PDF download and a way to the form, and the PDF cover as its picture', () => {
    const hero = assemblePage(playbookPlan(), options()).page.blocks[0]!;
    expect(hero).toMatchObject({
      type: 'hero',
      badge: 'Prepared for {{first_name|you}} at {{company|your team}}',
      headline: 'The 2026 Outbound Pipeline Playbook',
      eyebrow: 'Playbook',
      show_document: true,
      layout: 'split',
      primary: { label: 'Download the PDF', action: { type: 'document' } },
      secondary: { action: { type: 'anchor', anchor: 'contact' } },
    });
  });

  it('uses the plan’s picture for the hero when it chose one, and falls back from a cover layout with no picture', () => {
    const pick: PlanImage = { ref: 'P2-I1', page: null, box: null, alt: 'x' };
    const withPicture = assemblePage(playbookPlan({ hero: { ...playbookPlan().hero, layout: 'cover', image: pick } }), options()).page
      .blocks[0]!;
    expect(withPicture).toMatchObject({ layout: 'cover', show_document: false, image: { src: 'ast_chart1' } });
    const without = assemblePage(playbookPlan({ hero: { ...playbookPlan().hero, layout: 'cover' } }), options()).page.blocks[0]!;
    expect(without).toMatchObject({ layout: 'split', show_document: true });
  });

  it('takes the hero background from the plan, or else from the cover, and honours “plain”', () => {
    const heroBg = (bg: 'default' | 'alt' | 'brand' | 'dark' | null, brandCover = false) =>
      (
        assemblePage(
          playbookPlan({ hero: { ...playbookPlan().hero, bg } }),
          options({ palette: { brand: '#4f46e5', brandCover, dark: false } }),
        ).page.blocks[0] as { bg?: string }
      ).bg;
    expect(heroBg(null, true)).toBe('brand');
    expect(heroBg(null, false)).toBeUndefined();
    expect(heroBg('default', true)).toBeUndefined();
    expect(heroBg('dark')).toBe('dark');
  });

  it('builds each kind of block from the plan, in our own defaults', () => {
    const blocks = assemblePage(playbookPlan(), options()).page.blocks;
    const by = (t: string) => blocks.find((b) => b.type === t) as unknown as Record<string, any>;
    expect(by('stats').items).toEqual([
      { value: '3.4x', label: 'more replies than generic sequences' },
      { value: '47%', label: 'shorter sales cycles' },
      { value: '$1.2M', label: 'pipeline created per rep' },
    ]);
    expect(by('split')).toMatchObject({ side: 'right', image: { src: 'ast_chart1', alt: 'A chart of reply rates' } });
    expect(by('split').body).toContain('- Lead with a specific insight');
    expect(by('testimonial')).toMatchObject({ name: 'Jordan Lee', role: 'VP Sales', company: 'Northwind' });
    expect(by('steps').items).toHaveLength(4);
    expect(by('cta')).toMatchObject({
      anchor: 'contact',
      heading: 'Ready to talk?',
      button: { label: 'Book a walkthrough', action: { type: 'form' } },
    });
  });

  it('alternates soft backgrounds for rhythm and leaves the plan’s own choices alone', () => {
    const plan = playbookPlan();
    plan.blocks[1] = { ...plan.blocks[1]!, bg: 'dark' };
    const blocks = assemblePage(plan, options()).page.blocks;
    expect(blocks.find((b) => b.type === 'stats')?.bg).toBe('dark');
    const bgs = blocks.slice(1, -2).map((b) => b.bg ?? 'default');
    expect(new Set(bgs).size).toBeGreaterThan(1);
  });

  it('turns blocks that cannot stand on their own into plain text, or drops them', () => {
    const plan = playbookPlan();
    plan.blocks = [
      planBlock({ type: 'split', heading: 'What the best teams do', text: "Lead with a specific insight about the prospect's business." }),
      planBlock({
        type: 'features',
        heading: 'How it works',
        items: [item({ title: 'Capture', text: 'Pull accounts and contacts into your enrichment tool.' })],
      }),
      planBlock({ type: 'steps', items: [item({ title: 'Capture' })] }),
      planBlock({ type: 'table', rows: [['Personalise']] }),
      planBlock({ type: 'image', image: { ref: 'P9-I9', page: null, box: null, alt: null } }),
      ...['Why personalisation wins', 'What the best teams do', 'How it works', 'Ready to talk'].map((h) =>
        planBlock({
          type: 'text',
          heading: h,
          text: 'Buyers receive dozens of near-identical emails a week, so relevance is the only filter that still works.',
        }),
      ),
    ];
    const { page, dropped } = assemblePage(plan, options());
    expect(page.blocks.map((b) => b.type)).toEqual(['hero', 'text', 'text', 'text', 'text', 'text', 'text', 'cta', 'form']);
    expect(page.blocks[1]).toMatchObject({ heading: 'What the best teams do' });
    expect(page.blocks[2]).toMatchObject({ heading: 'How it works', body: 'Pull accounts and contacts into your enrichment tool.' });
    expect(dropped).toHaveLength(3);
  });

  it('never lets a figure through that is not in the document', () => {
    const plan = playbookPlan();
    plan.blocks[1] = planBlock({
      type: 'stats',
      items: [
        item({ value: '3.4x', label: 'more replies' }),
        item({ value: '47%', label: 'shorter cycles' }),
        item({ value: '312%', label: 'growth in pipeline' }),
      ],
    });
    const stats = assemblePage(plan, options()).page.blocks.find((b) => b.type === 'stats') as { items: Array<{ value: string }> };
    expect(stats.items.map((i) => i.value)).toEqual(['3.4x', '47%']);

    plan.blocks[0] = planBlock({ type: 'callout', text: 'Customers see a 78% lift in replies.' });
    const { page, dropped } = assemblePage(plan, options());
    expect(page.blocks.map((b) => b.type)).not.toContain('callout');
    expect(dropped.join()).toMatch(/not in the PDF/);
  });

  it('rejects a plan that had to lose too much, or that wandered away from the document’s wording', () => {
    const made = playbookPlan();
    made.blocks = ['41%', '52%', '63%', '74%'].map((n) =>
      planBlock({ type: 'text', heading: 'Claim', text: `Results improved by ${n} overall.` }),
    );
    expect(() => assemblePage(made, options())).toThrow(PlanRejected);

    const stray = playbookPlan();
    stray.blocks = [
      planBlock({
        type: 'text',
        heading: 'Unrelated',
        text: 'Quantum chromodynamics describes hadronic interactions between gluons, producing confinement phenomena across subatomic scales.',
      }),
      planBlock({
        type: 'text',
        heading: 'More',
        text: 'Mitochondrial respiration generates adenosine triphosphate through oxidative phosphorylation within eukaryotic organelles, consistently.',
      }),
    ];
    expect(() => assemblePage(stray, options())).toThrow(/wording strayed/);
    expect(() => assemblePage(playbookPlan({ blocks: [planBlock({ type: 'cta', heading: 'Hi' })] }), options())).toThrow(/too little/);
    expect(() => assemblePage(playbookPlan({ hero: { ...playbookPlan().hero, headline: '  ' } }), options())).toThrow(/no headline/);
  });

  it('skips the document checks when there is hardly any text to check against (a scan, say)', () => {
    const plan = playbookPlan();
    plan.blocks[1] = planBlock({
      type: 'stats',
      items: [item({ value: '312%', label: 'read from the picture' }), item({ value: '98%', label: 'read from the picture too' })],
    });
    const { page } = assemblePage(plan, options({ source: { text: 'tiny', tokens: [] } }));
    expect(JSON.stringify(page)).toContain('312%');
  });

  it('cleans everything it is given: markup, control characters, stray heading marks and merge fields the PDF never had', () => {
    const plan = playbookPlan();
    plan.blocks[0] = planBlock({
      type: 'text',
      heading: '## <b>Why</b> it works',
      text: '<script>alert(1)</script>Buyers receive dozens of emails.\n\n\n\n• Hello {{first_name|you}}, {{nickname|pal}}\u0007',
    });
    const text = assemblePage(plan, options()).page.blocks.find((b) => b.type === 'text') as unknown as { heading: string; body: string };
    expect(text.heading).toBe('Why it works');
    expect(text.body).not.toMatch(/<|alert|\u0007|\n\n\n/);
    expect(text.body).toContain('{{first_name|you}}');
    expect(text.body).not.toContain('nickname');
    expect(text.body).toContain('pal');
    expect(text.body).toContain('- Hello');
  });

  it('keeps within what a page should hold: twelve blocks, four pictures, valid icons', () => {
    const many = playbookPlan();
    many.blocks = [
      ...Array.from({ length: 15 }, (_, i) =>
        planBlock({
          type: 'text',
          heading: `Section ${String.fromCharCode(97 + i)}`,
          // letters, not digits: a two-digit number would have to be in the PDF
          text: `Buyers receive dozens of near-identical emails a week, point ${String.fromCharCode(97 + i)}.`,
        }),
      ),
      planBlock({ type: 'cta', heading: 'Ready to talk?' }),
    ];
    expect(assemblePage(many, options()).page.blocks.filter((b) => b.type === 'text')).toHaveLength(12);

    const pics = playbookPlan();
    pics.blocks = Array.from({ length: 6 }, (_, i) =>
      planBlock({ type: 'image', text: `Figure ${i}`, image: { ref: 'P2-I1', page: null, box: null, alt: null } }),
    );
    pics.blocks.push(
      planBlock({ type: 'text', heading: 'Words', text: 'Buyers receive dozens of near-identical emails a week.' }),
      planBlock({ type: 'text', heading: 'More', text: 'Generic outreach is ignored.' }),
    );
    expect(assemblePage(pics, options()).page.blocks.filter((b) => b.type === 'image')).toHaveLength(4);

    const icons = playbookPlan();
    icons.blocks[0] = planBlock({
      type: 'features',
      items: [item({ title: 'Targeting', icon: 'zap' }), item({ title: 'Speed', icon: 'not-an-icon' }), item({ title: 'Proof' })],
    });
    const f = assemblePage(icons, options()).page.blocks.find((b) => b.type === 'features') as unknown as {
      items: Array<{ icon: string }>;
      columns: number;
    };
    expect(f.items.map((i) => i.icon)).toEqual(['zap', 'target', 'sparkles']);
    expect(f.columns).toBe(3);
  });

  it('falls back to the rule-based choice of style and logo when the plan gives none', () => {
    const plan = playbookPlan({ style: 'nonsense', logo_text: null });
    const { page } = assemblePage(plan, options({ fallbackStyle: STYLE_PRESETS.find((p) => p.id === 'bold')! }));
    expect(page.theme.font).toBe('space-grotesk');
    expect(page.header.logo_text).toBe('Acme Growth Labs');
  });
});

describe('figures', () => {
  it('are the numbers worth checking: two digits or more, or with a unit', () => {
    expect(figuresIn('Up 3.4x, 47% and $1.2M, from 120 campaigns in 2026')).toEqual(['34x', '47', '12m', '120', '2026']);
    expect(figuresIn('Step 1, then 2 and 3. Page 4')).toEqual([]);
    expect(figuresIn('5x faster, 10 million users')).toEqual(['5x', '10million']);
  });
});

describe('what the model is shown', () => {
  const input = (over: Partial<DesignInput> = {}): DesignInput => ({
    filename: 'playbook.pdf',
    pageCount: 3,
    imagePages: [1, 2, 3],
    pages: [
      {
        page: 1,
        width: 595,
        height: 842,
        lines: [
          { size: 46, bold: true, text: 'The 2026 Outbound' },
          { size: 15, bold: false, text: 'How high-growth teams win' },
        ],
      },
      { page: 2, width: 960, height: 540, lines: [] },
    ],
    figures: [{ id: 'P2-I1', page: 2, left: 10, top: 31, width: 53, height: 21 }],
    palette: { brand: '#4f46e5', brandCover: true, dark: false, found: true },
    tokens: ['first_name'],
    ...over,
  });

  it('is the text page by page with sizes, the figures with where they sit, and what was found in the PDF', () => {
    const p = buildDesignPrompt(input());
    expect(p).toContain('=== Page 1 of 3 (portrait) ===\n[46b] The 2026 Outbound\n[15] How high-growth teams win');
    expect(p).toContain('=== Page 2 of 3 (landscape) ===\n(no text found: read it from the picture)');
    expect(p).toContain('P2-I1: page 2, at 10% from the left and 31% from the top, 53% wide and 21% tall');
    expect(p).toContain('Brand colour found in the PDF: #4f46e5; the cover is that colour');
    expect(p).toContain('Merge fields found in the PDF: {{first_name}}');
    expect(p).toContain('every page is attached as a picture');
  });

  it('says which pages are pictures when only some are, and caps very long pages and documents', () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({ size: 11, bold: false, text: `line ${i}` }));
    const p = buildDesignPrompt(
      input({ pageCount: 40, imagePages: [1, 2, 3, 4, 38, 39, 40], pages: [{ page: 1, width: 595, height: 842, lines }] }),
    );
    expect(p).toContain('pictures of pages 1-4, 38-40 are attached; the other pages are text only');
    expect(p).toContain('(… 30 more lines not shown)');
    expect(p).not.toContain('line 95');
    const huge = Array.from({ length: 90 }, (_, i) => ({ size: 11, bold: false, text: 'x'.repeat(700) + i }));
    const big = buildDesignPrompt(
      input({ pages: Array.from({ length: 5 }, (_, i) => ({ page: i + 1, width: 595, height: 842, lines: huge })) }),
    );
    expect(big.length).toBeLessThan(75_000);
  });
});

describe('choosing what to show', () => {
  it('shows every page of a short document, and the opening and the close of a long one', () => {
    expect(choosePages(3)).toEqual([1, 2, 3]);
    expect(choosePages(14)).toHaveLength(14);
    const long = choosePages(60);
    expect(long).toHaveLength(14);
    expect(long.slice(0, 11)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(long.slice(11)).toEqual([58, 59, 60]);
  });

  it('draws slides wider than portrait pages', () => {
    expect(pictureWidth(960, 540)).toBe(1000);
    expect(pictureWidth(595, 842)).toBe(900);
  });

  it('offers embedded pictures that are neither specks nor full-page backgrounds, with ids the model can quote', () => {
    const doc = {
      page_count: 2,
      tokens: [
        { token: '{{first_name|you}}', page: 1, run: 'a' },
        { token: '{{ Last Name }}', page: 1, run: 'b' },
      ],
      meta: {},
      pages: [
        {
          page: 1,
          width: 600,
          height: 800,
          runs: [],
          links: [],
          images: [
            { ref: '1:0', page: 1, x: 0, y: 0, w: 600, h: 800 },
            { ref: '1:1', page: 1, x: 10, y: 10, w: 20, h: 20 },
          ],
        },
        { page: 2, width: 600, height: 800, runs: [], links: [], images: [{ ref: '2:0', page: 2, x: 60, y: 400, w: 300, h: 200 }] },
      ],
    } as unknown as ExtractedDoc;
    expect(figuresOf(doc)).toEqual([{ id: 'P2-I1', ref: '2:0', page: 2, left: 10, top: 50, width: 50, height: 25 }]);
    expect(tokenNames(doc)).toEqual(['first_name', 'Last Name']);
  });
});

describe('pictures in a request', () => {
  it('are sent ahead of the text, each after a line saying what it is', () => {
    expect(userContent({ user: 'hello' })).toBe('hello');
    expect(userContent({ user: 'hello', images: [] })).toBe('hello');
    expect(
      userContent({
        user: 'Design it.',
        images: [
          { media_type: 'image/jpeg', data: 'AAAA', label: 'Page 1:' },
          { media_type: 'image/png', data: 'BBBB' },
        ],
      }),
    ).toEqual([
      { type: 'text', text: 'Page 1:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } },
      { type: 'text', text: 'Design it.' },
    ]);
  });

  it('leave newBlock alone: the helper builds on the same defaults the editor uses', () => {
    expect(newBlock('callout').type).toBe('callout');
  });
});
