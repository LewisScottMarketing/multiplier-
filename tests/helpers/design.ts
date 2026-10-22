import type { DesignPlan, PlanBlock } from '../../src/server/pdf/design-plan';

/** A plan block with every field present (the model's reply always has all of them, null when unused). */
export const planBlock = (b: Partial<PlanBlock> & Pick<PlanBlock, 'type'>): PlanBlock => ({
  heading: null,
  eyebrow: null,
  text: null,
  items: null,
  image: null,
  side: null,
  columns: null,
  rows: null,
  header_row: null,
  name: null,
  role: null,
  company: null,
  attribution: null,
  button: null,
  bg: null,
  ...b,
});

export const item = (i: Partial<NonNullable<PlanBlock['items']>[number]>) => ({
  title: null,
  text: null,
  value: null,
  label: null,
  icon: null,
  ...i,
});

/** A good plan for tests/fixtures/playbook.pdf: everything in it comes from the document. */
export function playbookPlan(over: Partial<DesignPlan> = {}): DesignPlan {
  return {
    style: 'clean',
    hero: {
      headline: 'The 2026 Outbound Pipeline Playbook',
      subheadline: 'How high-growth B2B teams turn cold outreach into booked meetings, without sounding like everyone else.',
      eyebrow: 'Playbook',
      layout: 'split',
      image: null,
      bg: null,
    },
    logo_text: 'Acme Growth Labs',
    seo_title: null,
    seo_description: 'How high-growth B2B teams turn cold outreach into booked meetings.',
    blocks: [
      planBlock({ type: 'callout', text: 'Generic outreach is ignored. Relevance is the only filter that still works.' }),
      planBlock({
        type: 'stats',
        heading: 'Why personalisation wins',
        items: [
          item({ value: '3.4x', label: 'more replies than generic sequences' }),
          item({ value: '47%', label: 'shorter sales cycles' }),
          item({ value: '$1.2M', label: 'pipeline created per rep' }),
        ],
      }),
      planBlock({
        type: 'split',
        heading: 'What the best teams do',
        text: "- Lead with a specific insight about the prospect's business\n- Match the message to the buyer's seniority and department\n- Follow up based on what they actually looked at",
        image: { ref: 'P2-I1', page: null, box: null, alt: 'A chart of reply rates' },
        side: 'right',
      }),
      planBlock({
        type: 'testimonial',
        text: 'We stopped sending PDFs and started sending pages that felt written for each buyer. Meetings doubled in a quarter.',
        name: 'Jordan Lee',
        role: 'VP Sales',
        company: 'Northwind',
      }),
      planBlock({
        type: 'steps',
        heading: 'How it works',
        items: [
          item({ title: 'Capture', text: 'Pull accounts and contacts into your enrichment tool.' }),
          item({ title: 'Personalise', text: 'Merge name, company and job title into every asset.' }),
          item({ title: 'Send', text: 'Drop a unique link into your sequence.' }),
          item({ title: 'Follow up', text: 'Trigger the next step when they engage.' }),
        ],
      }),
      planBlock({
        type: 'cta',
        heading: 'Ready to talk?',
        text: 'Book a 20-minute walkthrough at hello@acmegrowth.com.',
        button: 'Book a walkthrough',
      }),
    ],
    notes: ['The reply-rate chart is kept beside the list of what the best teams do.'],
    ...over,
  };
}
