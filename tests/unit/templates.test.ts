import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/shared/derive';
import { lintCampaign } from '../../src/shared/lint';
import { presetById } from '../../src/shared/presets';
import { CampaignSettingsSchema, PageSchema } from '../../src/shared/schema';
import { buildTemplate, templateById, templateInfo, TEMPLATES } from '../../src/shared/templates';
import { renderPage, summariseTokens } from '../../src/server/render/page';

const settings = CampaignSettingsSchema.parse({});

function render(page: ReturnType<typeof PageSchema.parse>, data: Record<string, unknown>) {
  return renderPage({
    campaign: { id: 'cmp_1', name: 'T', slug: 't', page, document: null, settings },
    ctx: buildContext(data),
    mode: 'preview',
    token: null,
    host: 'go.test',
    origin: 'https://go.test',
    urls: { submit: '#' },
  });
}

const jane = {
  first_name: 'Jane',
  last_name: 'Doe',
  company: 'Northwind Traders, Inc.',
  job_title: 'VP of Marketing',
  email: 'jane@northwind.com',
};

describe('starter templates', () => {
  it('have unique ids, and a name, a blurb and a use each', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(2);
      expect(t.blurb.length).toBeGreaterThan(20);
      expect(t.use.length).toBeGreaterThan(10);
      expect(templateById(t.id)).toBe(t);
      expect(presetById(t.preset), `${t.id} preset`).toBeDefined();
      expect(templateInfo(t)).toMatchObject({ id: t.id, name: t.name, preset: t.preset });
    }
    expect(buildTemplate('nope')).toBeNull();
  });

  it('give a different look from each other, so the gallery is a real choice', () => {
    expect(new Set(TEMPLATES.map((t) => t.preset)).size).toBe(TEMPLATES.length);
    expect(
      new Set(TEMPLATES.map((t) => buildTemplate(t.id)!.blocks[0]!.type + (buildTemplate(t.id)!.blocks[0] as { layout?: string }).layout))
        .size,
    ).toBeGreaterThan(3);
  });

  for (const t of TEMPLATES) {
    describe(t.name, () => {
      const page = buildTemplate(t.id)!;

      it('is a valid page in its own style, with the brand colour it advertises', () => {
        expect(PageSchema.safeParse(page).success).toBe(true);
        expect(page.theme.brand).toBe(t.brand);
        const preset = presetById(t.preset)!;
        for (const [k, v] of Object.entries(preset.make(t.brand))) expect((page.theme as Record<string, unknown>)[k]).toBe(v);
        expect(page.blocks.length).toBeGreaterThanOrEqual(4);
        expect(page.blocks[0]!.type).toBe('hero');
      });

      it('is ready to send: no warnings, and every button leads somewhere', () => {
        const issues = lintCampaign({ page, document: null, settings }).filter((i) => i.level === 'warn');
        expect(issues).toEqual([]);
      });

      it('has no PDF dependency', () => {
        const json = JSON.stringify(page);
        expect(json).not.toContain('"type":"document"');
        expect(json).not.toContain('show_document');
      });

      it('renders for a real prospect with their details in it and nothing broken', () => {
        const out = render(page, jane);
        expect(out.html).toContain('Jane');
        expect(out.html).not.toMatch(/\{\{|undefined|\[object|NaN/);
        expect(out.html).not.toContain('<h1></h1>');
        // the legal suffix is not doubled up before a full stop
        expect(out.html).not.toMatch(/Inc\.\./);
      });

      it('reads properly for someone we know nothing about, using its fallbacks', () => {
        const out = render(page, {});
        expect(summariseTokens(out.tokens).missing).toEqual([]);
        expect(out.html).not.toMatch(/\{\{|undefined|\[object|NaN|Hi ,|, ,/);
        expect(out.html).toMatch(/<h1>[^<]+/);
      });
    });
  }

  it('gives every copy fresh block ids, so two campaigns never share them', () => {
    const a = buildTemplate('personal-pitch')!.blocks.map((b) => b.id);
    const b = buildTemplate('personal-pitch')!.blocks.map((b) => b.id);
    expect(a.some((id) => b.includes(id))).toBe(false);
    expect(new Set(a).size).toBe(a.length);
  });
});
