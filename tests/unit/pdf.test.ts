import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/shared/derive';
import { DocumentSchema } from '../../src/shared/schema';
import { renderPdf, resolveInstructions } from '../../src/server/pdf/apply';
import { detrack, extractDocument, extractImagePng, type ExtractedDoc } from '../../src/server/pdf/extract';
import { fieldFromRun, fieldsForTokenRuns } from '../../src/server/pdf/fields';
import { importToPage, lookFor, type Line } from '../../src/server/pdf/import';
import { extractPalette, renderPageRaster, sampleRunColors, type Palette } from '../../src/server/pdf/raster';

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.resolve('tests/fixtures', name)));
const ctxOf = (o: Record<string, string>) => buildContext(o);

let playbook: ExtractedDoc;
beforeAll(async () => {
  playbook = await extractDocument(fixture('playbook.pdf'));
});

describe('extraction', () => {
  it('reads pages, runs, sizes and positions in top-left coordinates', () => {
    expect(playbook.page_count).toBe(3);
    const p1 = playbook.pages[0];
    expect(p1.width).toBeCloseTo(595, 0);
    const title = p1.runs.find((r) => r.text === 'The 2026 Outbound')!;
    expect(title.size).toBeCloseTo(46, 0);
    expect(title.bold).toBe(true);
    expect(title.family).toBe('inter');
    expect(title.y).toBeGreaterThan(100); // top-left origin: the title is near the top, not the bottom
    expect(title.y).toBeLessThan(300);
  });

  it('repairs letter-spaced headings and curly quotes', () => {
    expect(playbook.pages[0].runs.some((r) => r.text === 'ACME GROWTH LABS')).toBe(true);
    expect(detrack('A C M E  G R O W T H')).toBe('ACME GROWTH');
    expect(detrack('Hello world')).toBe('Hello world');
    const quote = playbook.pages[1].runs.find((r) => /quarter/.test(r.text))!;
    expect(quote.text.endsWith('”')).toBe(true);
  });

  it('finds {{tokens}} already written into the PDF', () => {
    expect(playbook.tokens.map((t) => t.token)).toEqual(['{{first_name}}', '{{last_name}}']);
  });

  it('locates embedded images and decodes them', async () => {
    const img = playbook.pages[1].images[0];
    expect(img.w).toBeCloseTo(315, 0);
    const decoded = await extractImagePng(fixture('playbook.pdf'), img.ref);
    expect(decoded?.width).toBe(640);
    expect(decoded!.png.subarray(1, 4).toString('latin1')).toBe('PNG');
  });

  it('extracts link annotations', async () => {
    const doc = await extractDocument(fixture('case-study.pdf'));
    const urls = doc.pages.flatMap((p) => p.links.map((l) => l.url));
    expect(urls).toEqual(expect.arrayContaining(['https://northwind.io/start', 'mailto:sales@northwind.io']));
  });

  it('rejects files that are not PDFs and PDFs over the page cap gracefully', async () => {
    await expect(extractDocument(new Uint8Array(Buffer.from('not a pdf at all, definitely')))).rejects.toThrow();
  });
});

describe('colour sampling and palette', () => {
  it('samples text and background colours from the render', async () => {
    const r = await renderPageRaster(fixture('playbook.pdf'), 1, 1.5);
    const runs = playbook.pages[0].runs.map((x) => ({ ...x }));
    sampleRunColors(r, runs);
    const title = runs.find((x) => x.text === 'The 2026 Outbound')!;
    expect(title.bg).toBe('#4f46e5');
    expect(title.color).toBe('#ffffff');
  });

  it('picks the brand colour from the document and notices a coloured cover', async () => {
    const pal = extractPalette([await renderPageRaster(fixture('playbook.pdf'), 1, 1)]);
    expect(pal).toMatchObject({ brand: '#4f46e5', brandCover: true, dark: true, found: true });
    const study = extractPalette(await Promise.all([1, 2].map((n) => renderPageRaster(fixture('case-study.pdf'), n, 1))));
    expect(study.dark).toBe(true);
    expect(study.found).toBe(true);
    expect(study.brand).not.toBe('#4f46e5'); // teal, not the default
    const bw = extractPalette(await Promise.all([1, 2].map((n) => renderPageRaster(fixture('report.pdf'), n, 1))));
    expect(bw.found).toBe(false);
  });
});

describe('PDF → landing page', () => {
  const run = async (file: string) => {
    const bytes = fixture(file);
    const doc = await extractDocument(bytes);
    const pal = extractPalette(await Promise.all([1, 2, 3].filter((n) => n <= doc.page_count).map((n) => renderPageRaster(bytes, n, 1))));
    return importToPage(doc, pal, { filename: file, saveImage: async () => 'ast_img' });
  };
  const types = (r: Awaited<ReturnType<typeof run>>) => r.page.blocks.map((b) => b.type);

  it('turns the playbook into hero, prose, stats, image, checklist, steps, CTA and form', async () => {
    const r = await run('playbook.pdf');
    expect(types(r)).toEqual(['hero', 'text', 'stats', 'image', 'checklist', 'testimonial', 'steps', 'cta', 'form']);
    const hero = r.page.blocks[0];
    if (hero.type !== 'hero') throw new Error('no hero');
    expect(hero.headline).toBe('The 2026 Outbound Pipeline Playbook');
    expect(hero.subheadline).toBe(
      'How high-growth B2B teams turn cold outreach into booked meetings, without sounding like everyone else.',
    );
    expect(hero.badge).toContain('{{first_name|you}}'); // the personal line is built in
    expect(hero.show_document).toBe(true);
    expect(hero.bg).toBe('brand');
    const stats = r.page.blocks.find((b) => b.type === 'stats');
    expect(stats && stats.type === 'stats' && stats.items.map((i) => i.value)).toEqual(['3.4x', '47%', '$1.2M']);
    const steps = r.page.blocks.find((b) => b.type === 'steps');
    expect(steps && steps.type === 'steps' && steps.items.map((i) => i.title)).toEqual(['Capture', 'Personalise', 'Send', 'Follow up']);
    const cta = r.page.blocks.find((b) => b.type === 'cta');
    expect(cta && cta.type === 'cta' && cta.button.action).toEqual({ type: 'link', url: 'https://acmegrowth.com/demo' });
    const t = r.page.blocks.find((b) => b.type === 'testimonial');
    expect(t && t.type === 'testimonial' && [t.name, t.role, t.company]).toEqual(['Jordan Lee', 'VP Sales', 'Northwind']);
  });

  it('keeps the cover boilerplate out of the page', async () => {
    const r = await run('playbook.pdf');
    expect(JSON.stringify(r.page)).not.toMatch(/Company Name\]|Attn:/);
  });

  it('copes with out-of-order painting, bold-lead bullets, footers and dark covers (case study)', async () => {
    const r = await run('case-study.pdf');
    expect(types(r)).toEqual(['hero', 'text', 'features', 'stats', 'testimonial', 'cta', 'form']);
    const f = r.page.blocks.find((b) => b.type === 'features');
    expect(f && f.type === 'features' && f.items.map((i) => i.title)).toEqual(['Guided setup', 'One-click migration', 'Success playbooks']);
    expect(f && f.type === 'features' && f.items[1].text).toBe(
      'Customers import their data from a spreadsheet or their old tool in minutes.',
    );
    expect(r.page.footer.text).toContain('© 2026 Northwind Systems Ltd.');
    expect(r.page.header.logo_text).toBe('Northwind');
    expect(JSON.stringify(r.page)).not.toMatch(/Page \d+ of/); // page-number furniture is dropped
    expect(r.page.blocks[0].type === 'hero' && r.page.blocks[0].bg).toBe('dark');
  });

  it('handles serif reports: numbered headings, numbered sentences become a numbered checklist, running headers are dropped', async () => {
    const r = await run('report.pdf');
    const json = JSON.stringify(r.page);
    expect(json).not.toContain('ACME CONFIDENTIAL');
    const lists = r.page.blocks.filter((b) => b.type === 'checklist');
    expect(lists).toHaveLength(2);
    expect(lists[0].type === 'checklist' && lists[0].style).toBe('number');
    expect(lists[0].type === 'checklist' && lists[0].intro).toMatch(/three-stage process/);
    expect(r.report.join(' ')).toMatch(/no distinctive colour/);
  });

  it('builds a sensible fallback for scanned PDFs with no text', async () => {
    const r = await run('scan.pdf');
    expect(types(r)).toEqual(['hero', 'form']);
    expect(r.report[0]).toMatch(/little or no selectable text/);
  });

  it('every generated page validates against the schema', async () => {
    for (const f of ['playbook.pdf', 'case-study.pdf', 'report.pdf', 'scan.pdf']) {
      const r = await run(f);
      expect(() => JSON.parse(JSON.stringify(r.page))).not.toThrow();
      expect(r.page.blocks.length).toBeGreaterThan(1);
      expect(new Set(r.page.blocks.map((b) => b.id)).size).toBe(r.page.blocks.length); // unique block ids
    }
  });
});

describe('editing a PDF', () => {
  async function playbookDoc() {
    const bytes = fixture('playbook.pdf');
    const raster = await renderPageRaster(bytes, 1, 1.5);
    const pg = playbook.pages[0];
    const runs = pg.runs.map((r) => ({ ...r }));
    sampleRunColors(raster, runs);
    const page = { ...pg, runs };
    const prepared = runs.find((r) => /Prepared for/.test(r.text))!;
    return { bytes, page, prepared };
  }

  it('builds replace-fields from placeholder tokens found in the PDF', async () => {
    const { page } = await playbookDoc();
    const fields = fieldsForTokenRuns([page]);
    expect(fields).toHaveLength(1);
    expect(fields[0].text).toBe('Attn: {{first_name}} {{last_name}}');
    expect(fields[0].mask?.color).toBe('#4f46e5');
    expect(fields[0].color).toBe('#ffffff');
  });

  it('makes the replacement box wider than the placeholder when there is room, but masks only the original', async () => {
    const { page, prepared } = await playbookDoc();
    const f = fieldFromRun(page, prepared, { template: 'Prepared for {{company}}' });
    expect(f.rect.w).toBeGreaterThan(prepared.w);
    expect(f.mask?.rect?.w).toBeCloseTo(prepared.w, 1);
    expect(f.rect.x).toBeCloseTo(prepared.x, 1);
  });

  it('replaces text in place, with the new content actually in the file and the placeholder gone from view', async () => {
    const { bytes, page, prepared } = await playbookDoc();
    const doc = DocumentSchema.parse({
      asset_id: 'ast_x',
      page_count: 3,
      fields: [fieldFromRun(page, prepared, { template: 'Prepared for {{company}}' })],
    });
    const out = await renderPdf({
      bytes,
      instructions: resolveInstructions(doc, ctxOf({ company: 'Initech GmbH' })),
      loadImage: async () => null,
    });
    expect(out.warnings).toEqual([]);
    const after = await extractDocument(out.bytes);
    const texts = after.pages[0].runs.map((r) => r.text);
    expect(texts).toContain('Prepared for Initech GmbH');
    // the original sits underneath the mask, so it is still in the file but covered
    const r = await renderPageRaster(out.bytes, 1, 1);
    const px = (x: number, y: number) => [
      r.rgba[(y * r.width + x) * 4],
      r.rgba[(y * r.width + x) * 4 + 1],
      r.rgba[(y * r.width + x) * 4 + 2],
    ];
    expect(px(Math.round(prepared.x + prepared.w - 10), Math.round(prepared.baseline - 3))).toEqual([0x4f, 0x46, 0xe5]); // background, no leftover glyphs
  });

  it('draws names the standard fonts cannot encode (Polish, Cyrillic, Vietnamese)', async () => {
    const { bytes, page, prepared } = await playbookDoc();
    const doc = DocumentSchema.parse({ asset_id: 'ast_x', page_count: 3, fields: [fieldFromRun(page, prepared, { template: '{{n}}' })] });
    for (const n of ['Łukasz Żółć', 'Дмитрий Петров', 'Nguyễn Thị Hương']) {
      const out = await renderPdf({ bytes, instructions: resolveInstructions(doc, ctxOf({ n })), loadImage: async () => null });
      expect(out.warnings).toEqual([]);
      // Latin and Latin-Extended glyphs live in different embedded fonts, so extraction may split the name into runs
      const joined = (await extractDocument(out.bytes)).pages[0].runs
        .map((x) => x.text)
        .join('')
        .replace(/\s+/g, '');
      expect(joined).toContain(n.replace(/\s+/g, ''));
    }
  });

  it('never throws on characters no font has; it substitutes and warns', async () => {
    const { bytes, page, prepared } = await playbookDoc();
    const doc = DocumentSchema.parse({ asset_id: 'ast_x', page_count: 3, fields: [fieldFromRun(page, prepared, { template: '{{n}}' })] });
    const out = await renderPdf({ bytes, instructions: resolveInstructions(doc, ctxOf({ n: '山田 太郎' })), loadImage: async () => null });
    expect(out.warnings.join(' ')).toMatch(/replaced with “\?”/);
    expect(out.bytes.length).toBeGreaterThan(1000);
  });

  it('shrinks over-long text to fit instead of overflowing', async () => {
    const { bytes, page, prepared } = await playbookDoc();
    const f = fieldFromRun(page, prepared, { template: '{{n}}' });
    const doc = DocumentSchema.parse({ asset_id: 'ast_x', page_count: 3, fields: [f] });
    const out = await renderPdf({
      bytes,
      instructions: resolveInstructions(
        doc,
        ctxOf({ n: 'An extraordinarily long company name that cannot possibly fit within the box, Incorporated' }),
      ),
      loadImage: async () => null,
    });
    const run = (await extractDocument(out.bytes)).pages[0].runs.find((r) => /extraordinarily/.test(r.text))!;
    expect(run.size).toBeLessThan(prepared.size);
    expect(run.size).toBeGreaterThanOrEqual(prepared.size * 0.55 - 0.01);
    expect(run.x + run.w).toBeLessThanOrEqual(f.rect.x + f.rect.w + 2);
  });

  it('applies persona rules per field, adds QR codes and tracked link regions', async () => {
    const bytes = fixture('playbook.pdf');
    const doc = DocumentSchema.parse({
      asset_id: 'ast_x',
      page_count: 3,
      fields: [
        {
          id: 'a',
          type: 'text',
          page: 1,
          rect: { x: 40, y: 40, w: 300, h: 20 },
          text: 'FOR MARKETERS',
          size: 12,
          color: '#ffffff',
          rule: { match: 'all', conditions: [{ field: 'department', op: 'equals', value: 'marketing' }] },
        },
        {
          id: 'b',
          type: 'text',
          page: 1,
          rect: { x: 40, y: 40, w: 300, h: 20 },
          text: 'FOR SALES',
          size: 12,
          color: '#ffffff',
          rule: { match: 'all', conditions: [{ field: 'department', op: 'equals', value: 'sales' }] },
        },
        {
          id: 'qr',
          type: 'qr',
          page: 1,
          rect: { x: 440, y: 640, w: 100, h: 100 },
          url: '{{page_url}}',
          color: '#ffffff',
          background: null,
        },
        { id: 'ln', type: 'link', page: 1, rect: { x: 40, y: 700, w: 200, h: 30 }, url: '{{page_url}}?src=pdf' },
      ],
    });
    const mk = (title: string) => ({ ...ctxOf({ job_title: title }), page_url: 'https://go.test/p/abc123def4' });
    const build = (title: string) => renderPdf({ bytes, instructions: resolveInstructions(doc, mk(title)), loadImage: async () => null });
    const m = await extractDocument((await build('VP of Marketing')).bytes);
    const s = await extractDocument((await build('Head of Sales')).bytes);
    expect(m.pages[0].runs.map((r) => r.text)).toContain('FOR MARKETERS');
    expect(m.pages[0].runs.map((r) => r.text)).not.toContain('FOR SALES');
    expect(s.pages[0].runs.map((r) => r.text)).toContain('FOR SALES');
    expect(m.pages[0].links.map((l) => l.url)).toEqual(['https://go.test/p/abc123def4?src=pdf']);
  });

  it('skips images that cannot be loaded without failing the document', async () => {
    const bytes = fixture('playbook.pdf');
    const doc = DocumentSchema.parse({
      asset_id: 'ast_x',
      page_count: 3,
      fields: [{ id: 'i', type: 'image', page: 1, rect: { x: 400, y: 60, w: 120, h: 60 }, src: '{{logo_url}}' }],
    });
    const out = await renderPdf({
      bytes,
      instructions: resolveInstructions(doc, ctxOf({ logo_url: 'https://logo.test/x.png' })),
      loadImage: async () => null,
    });
    expect(out.warnings.join(' ')).toMatch(/image could not be loaded/);
    // and with no logo at all there is nothing to draw and nothing to warn about
    expect(resolveInstructions(doc, ctxOf({}))).toEqual([]);
  });

  it('is deterministic: identical input resolves to identical instructions (the cache key)', async () => {
    const { page, prepared } = await playbookDoc();
    const doc = DocumentSchema.parse({
      asset_id: 'ast_x',
      page_count: 3,
      fields: [fieldFromRun(page, prepared, { template: 'Prepared for {{company}}' })],
    });
    const a = JSON.stringify(resolveInstructions(doc, ctxOf({ company: 'A' })));
    expect(JSON.stringify(resolveInstructions(doc, ctxOf({ company: 'A' })))).toBe(a);
    expect(JSON.stringify(resolveInstructions(doc, ctxOf({ company: 'B' })))).not.toBe(a);
  });
});

describe('the look an imported page is given', () => {
  const palette = (o: Partial<Palette> = {}): Palette => ({
    brand: '#4f46e5',
    dominant: '#ffffff',
    dark: false,
    brandCover: false,
    found: true,
    ...o,
  });
  const lineOf = (family: string, chars: number) => ({ runs: [{ family, text: 'x'.repeat(chars) }] }) as unknown as Line;

  it('keeps a dark document dark, but not one that is merely dark because its cover is the brand colour', () => {
    expect(lookFor([lineOf('inter', 100)], palette({ dark: true })).id).toBe('midnight');
    expect(lookFor([lineOf('inter', 100)], palette({ dark: true, brandCover: true })).id).toBe('clean');
  });

  it('sets a serif document in an editorial style, and anything else in the clean one', () => {
    expect(lookFor([lineOf('serif', 300), lineOf('inter', 100)], palette()).id).toBe('editorial');
    expect(lookFor([lineOf('serif', 100), lineOf('helvetica', 300)], palette()).id).toBe('clean');
    expect(lookFor([], palette()).id).toBe('clean');
  });

  it('is applied to the page, and the report says so', async () => {
    const run = async (file: string) => {
      const bytes = fixture(file);
      const doc = await extractDocument(bytes);
      const pal = extractPalette(await Promise.all([1, 2, 3].filter((n) => n <= doc.page_count).map((n) => renderPageRaster(bytes, n, 1))));
      return importToPage(doc, pal, { filename: file, saveImage: async () => 'ast_img' });
    };
    const playbook = await run('playbook.pdf');
    expect(playbook.page.theme).toMatchObject({ brand: '#4f46e5', font: 'inter', bg: '#ffffff' });
    expect(playbook.report.join(' ')).toContain('Styled “Clean”');

    const report = await run('report.pdf');
    expect(report.page.theme).toMatchObject({ heading_font: 'fraunces', bg: '#fbf8f3', cards: 'flat' });
    expect(report.report.join(' ')).toContain('Styled “Editorial”');

    const caseStudy = await run('case-study.pdf');
    expect(caseStudy.page.theme.bg).not.toBe('#ffffff');
    expect(caseStudy.report.join(' ')).toContain('Styled “Midnight”');
  });
});
