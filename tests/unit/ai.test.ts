import { describe, expect, it } from 'vitest';
import { newBlock } from '../../src/shared/blocks';
import { excludingRule, intersectRule } from '../../src/shared/conditions';
import { canVary, textLeaves, withLeaves } from '../../src/shared/block-text';
import { PERSONAS } from '../../src/shared/personas';
import { PageSchema } from '../../src/shared/schema';
import {
  applyPolish,
  campaignBrief,
  cleanCopy,
  factsFrom,
  fitTo,
  languageName,
  stripUnknownTokens,
  softLimit,
  tidyCopy,
  wordBudget,
} from '../../src/server/services/ai';

describe('cleanCopy', () => {
  it('turns model output into safe plain text', () => {
    expect(cleanCopy('  "Hello <b>there</b>,   see https://evil.test/x for **more**."  ', 200)).toBe('Hello there , see for more.');
    expect(cleanCopy('{{first_name}} is great', 200)).toBe('first_name is great');
    expect(cleanCopy('- a bullet\nacross lines', 200)).toBe('a bullet across lines');
    expect(cleanCopy(42, 20)).toBe('');
    expect(cleanCopy(undefined, 20)).toBe('');
  });

  it('strips control characters', () => {
    expect(cleanCopy('a\u0000b\u0007c', 50)).toBe('a b c');
  });

  it('never exceeds the limit and prefers a clean sentence boundary', () => {
    const long = 'First sentence here. Second sentence goes on for quite a while and keeps going and going.';
    expect(fitTo(long, 40)).toBe('First sentence here.');
    const noStops = 'word '.repeat(40).trim();
    const cut = fitTo(noStops, 30);
    expect(cut.length).toBeLessThanOrEqual(31);
    expect(cut.endsWith('…')).toBe(true);
    expect(fitTo('short', 30)).toBe('short');
  });

  it('ends a long single sentence where its first clause ends, rather than clipping it', () => {
    const run = 'Engineering leaders often end up owning outbound tooling they never planned to run, so getting it right takes a while';
    expect(fitTo(run, 100)).toBe('Engineering leaders often end up owning outbound tooling they never planned to run.');
    expect(fitTo('Leading sales development means keeping volume high — and keeping every message sounding personal', 70)).toBe(
      'Leading sales development means keeping volume high.',
    );
    // a clause too early to be worth keeping falls through to the word boundary
    expect(fitTo('Yes, and then there is a very long tail of words that simply keeps going', 60)).toMatch(/…$/);
    // a short complete first sentence beats a long one that stops in the middle
    expect(
      fitTo(
        'As CTO at NimbusDB, you want tooling engineering can trust. This playbook shows how teams keep cold outreach accurate and fast without adding load to engineering',
        120,
      ),
    ).toBe('As CTO at NimbusDB, you want tooling engineering can trust.');
  });
});

describe('softLimit', () => {
  it('asks the writer for a little less than the real cap', () => {
    expect(softLimit(180)).toBe(144);
    expect(softLimit(100)).toBe(80);
    expect(softLimit(20)).toBe(20);
    for (const n of [20, 60, 220, 1000]) expect(softLimit(n)).toBeLessThanOrEqual(n);
  });
});

describe('wordBudget', () => {
  it('turns a character limit into a number of words that leaves room to spare', () => {
    expect(wordBudget(100)).toBe(11);
    expect(wordBudget(220)).toBe(25);
    expect(wordBudget(20)).toBe(4);
    for (const n of [60, 100, 160, 220, 400, 1000]) expect(wordBudget(n) * 6.2).toBeLessThan(n);
  });
});

describe('factsFrom', () => {
  it('keeps the useful facts and leaves out contact details, links and secrets', () => {
    const facts = factsFrom({
      first_name: 'Jane',
      company: 'Acme',
      email: 'jane@acme.com',
      linkedin_url: 'https://linkedin.com/in/jane',
      page_url: 'https://go.test/p/abc',
      today: '1 Jan',
      api_token: 'sekret',
      ai_opening: 'x',
      industry: 'Fintech',
      employees: 120,
      empty: '',
      tags: ['a', 'b'],
    });
    expect(facts).toEqual({ first_name: 'Jane', company: 'Acme', industry: 'Fintech', employees: '120', tags: 'a, b' });
  });

  it('bounds how much one prospect can put in front of the model', () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) huge[`field_${i}`] = 'x'.repeat(1000);
    const facts = factsFrom(huge);
    expect(Object.keys(facts)).toHaveLength(40);
    expect(Object.values(facts).every((v) => v.length <= 300)).toBe(true);
  });
});

describe('stripUnknownTokens', () => {
  const known = new Set(['first_name', 'company']);
  it('keeps known tokens untouched and drops unknown ones, keeping their fallback text', () => {
    const r = stripUnknownTokens('Hi {{first_name|there}}, {{nickname|friend}} at {{company}} and {{mystery}}.', known);
    expect(r.text).toBe('Hi {{first_name|there}}, friend at {{company}} and .');
    expect(r.removed).toEqual(['nickname', 'mystery']);
  });
});

describe('campaignBrief', () => {
  it('describes the page without leaking merge tokens', () => {
    const page = PageSchema.parse({
      blocks: [
        newBlock('hero', { headline: 'Plan for {{company|your team}}', subheadline: 'Hi {{first_name|there}}, read on.' }),
        newBlock('text', { heading: 'Why it works', body: 'x' }),
      ],
    });
    const brief = campaignBrief({ name: 'Q4', page });
    expect(brief).toContain('Headline: Plan for your team');
    expect(brief).toContain('Sub-headline: Hi there, read on.');
    expect(brief).toContain('Sections: Why it works');
    expect(brief).not.toContain('{{');
  });

  it('says in words which language the page is in, so copy is not written in the prospect’s', () => {
    const brief = (lang?: string) => campaignBrief({ name: 'Q4', page: PageSchema.parse({ seo: lang ? { lang } : {}, blocks: [] }) });
    expect(brief()).toContain('Page language: English');
    expect(brief('de')).toContain('Page language: German');
    expect(brief('pt-BR')).toContain('Page language: Brazilian Portuguese');
    expect(languageName('')).toBe('English');
    expect(languageName('zz-not-a-tag!!')).toBe('zz-not-a-tag!!');
  });
});

describe('block text leaves', () => {
  it('addresses the prose of a block and nothing else', () => {
    const b = newBlock('features', {
      heading: 'Why us',
      intro: 'Short intro',
      items: [
        { icon: 'zap', title: 'Fast', text: 'Quick to set up' },
        { title: 'Safe', text: '' },
      ],
    });
    const leaves = textLeaves(b);
    expect(leaves.map((l) => l.path)).toEqual(['heading', 'intro', 'items.0.title', 'items.0.text', 'items.1.title']);
    const next = withLeaves(b, {
      heading: 'Why marketers pick us',
      'items.0.title': 'Fast setup',
      'items.9.title': 'ignored',
      icon: 'hacked',
      id: 'evil',
    });
    expect(next.type === 'features' && next.heading).toBe('Why marketers pick us');
    expect(next.type === 'features' && next.items[0]!.title).toBe('Fast setup');
    expect(next.type === 'features' && next.items[0]!.icon).toBe('zap');
    expect(next.id).toBe(b.id); // structure and identity are never writable
    expect(b.type === 'features' && b.heading).toBe('Why us'); // the original is untouched
  });

  it('only offers blocks that are copy, not evidence or functionality', () => {
    expect(canVary(newBlock('text'))).toBe(true);
    expect(canVary(newBlock('hero'))).toBe(true);
    expect(canVary(newBlock('testimonial'))).toBe(false);
    expect(canVary(newBlock('form'))).toBe(false);
    expect(canVary(newBlock('stats'))).toBe(false);
  });
});

describe('excludingRule', () => {
  const marketing = PERSONAS.find((p) => p.id === 'marketing')!.rule;
  it('turns a persona into "everyone except them"', () => {
    expect(excludingRule(undefined, marketing)).toEqual({
      match: 'all',
      conditions: [{ field: 'department', op: 'not_equals', value: 'marketing' }],
    });
  });
  it('adds to an existing rule when that stays unambiguous', () => {
    const existing = { match: 'all' as const, conditions: [{ field: 'seniority_group', op: 'equals' as const, value: 'leader' }] };
    expect(excludingRule(existing, marketing)!.conditions).toHaveLength(2);
    expect(
      excludingRule({ match: 'any', conditions: [existing.conditions[0]!, { field: 'x', op: 'exists', value: '' }] }, marketing),
    ).toBeNull();
  });
  it('refuses personas that cannot be inverted', () => {
    expect(excludingRule(undefined, { match: 'all', conditions: [{ field: 'a', op: 'matches', value: 'x' }] })).toBeNull();
    expect(excludingRule(undefined, { match: 'all', conditions: [] })).toBeNull();
  });
});

describe('intersectRule', () => {
  const sales = PERSONAS.find((p) => p.id === 'sales')!.rule;
  it('keeps the original audience and adds the persona', () => {
    expect(intersectRule(undefined, sales)).toEqual(sales);
    const leaders = { match: 'all' as const, conditions: [{ field: 'seniority_group', op: 'equals' as const, value: 'leader' }] };
    expect(intersectRule(leaders, sales).conditions.map((c) => c.field)).toEqual(['seniority_group', 'department']);
    const either = { match: 'any' as const, conditions: [leaders.conditions[0]!, { field: 'x', op: 'exists' as const, value: '' }] };
    expect(intersectRule(either, sales)).toEqual(sales);
  });
});

describe('applyPolish', () => {
  const none = { headline: '', subheadline: '', cta_heading: '', cta_text: '', cta_button: '', seo_title: '', seo_description: '' };
  const page = () =>
    PageSchema.parse({
      blocks: [
        newBlock('hero', { headline: 'Report.pdf', subheadline: 'x'.repeat(400) }),
        newBlock('cta', { heading: 'Ready to talk?', text: '', button: { label: 'Learn more', action: { type: 'form' } } }),
      ],
    });

  it('fixes weak copy and fills gaps', () => {
    const r = applyPolish(page(), {
      ...none,
      headline: 'A better headline',
      subheadline: 'A tight sub-headline.',
      cta_heading: 'Get your copy',
      cta_text: 'Free download.',
      cta_button: 'Download',
      seo_title: 'Title',
      seo_description: 'Description',
    });
    const hero = r.page.blocks[0]!;
    const cta = r.page.blocks[1]!;
    expect(hero.type === 'hero' && hero.headline).toBe('A better headline');
    expect(hero.type === 'hero' && hero.subheadline).toBe('A tight sub-headline.');
    expect(cta.type === 'cta' && cta.heading).toBe('Get your copy');
    expect(cta.type === 'cta' && cta.button.label).toBe('Download');
    expect(r.page.seo.title).toBe('Title');
    expect(r.notes.length).toBe(4);
  });

  it('keeps a call to action the PDF wrote itself, even a generic-sounding one', () => {
    const own = PageSchema.parse({
      blocks: [
        newBlock('cta', {
          heading: 'Ready to talk?',
          text: 'Book a 20-minute walkthrough.',
          button: { label: 'Learn more', action: { type: 'form' } },
        }),
      ],
    });
    expect(applyPolish(own, { ...none, cta_heading: 'Get your copy', cta_text: 'x', cta_button: 'Download' }).page).toEqual(own);
  });

  it('leaves copy that already reads well alone', () => {
    const good = PageSchema.parse({
      seo: { title: 'Mine', description: 'Mine too' },
      blocks: [
        newBlock('hero', { headline: 'Our own headline', subheadline: 'Short and fine.' }),
        newBlock('cta', { heading: 'Book a walkthrough', button: { label: 'Book', action: { type: 'form' } } }),
      ],
    });
    const r = applyPolish(good, {
      headline: 'X',
      subheadline: 'Y',
      cta_heading: 'Z',
      cta_text: 'T',
      cta_button: 'B',
      seo_title: 'S',
      seo_description: 'D',
    });
    expect(r.page).toEqual(good);
    expect(r.notes).toEqual([]);
  });
});
