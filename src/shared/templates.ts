import { newBlock } from './blocks';
import { presetById, withPreset } from './presets';
import { PageSchema, type Block, type Page } from './schema';

/**
 * Starter pages for "from scratch". Each one is a complete, personalised page with realistic copy, a look that suits
 * it and no dependency on a PDF, so it can be sent as soon as the placeholders are swapped for your own words.
 */

export interface Template {
  id: string;
  name: string;
  /** What it is, in a line. */
  blurb: string;
  /** When to reach for it. */
  use: string;
  /** Id of the style preset it is dressed in (see presets.ts). */
  preset: string;
  brand: string;
  /** Layout and look of the first screen, for the gallery. */
  tags: string[];
  blocks(): Block[];
}

const header = { enabled: true, logo_text: 'Your Company', button: { label: 'Book a call', action: { type: 'form' } } } as const;
const footer = '© Your Company. This page was prepared for {{first_name|you}}.';
const toForm = { type: 'form' } as const;
const note = (message: string, extra: Partial<Block> = {}) =>
  newBlock('note', { from_name: 'Your name', from_role: 'Your role, Your Company', message, ...extra } as Partial<Block>);

export const TEMPLATES: Template[] = [
  {
    id: 'personal-pitch',
    name: 'Personal pitch',
    blurb: 'A short page that shows you did your homework, with a plan and one clear next step.',
    use: 'First touch to a named account. Pairs with a plain-text email.',
    preset: 'clean',
    brand: '#4f46e5',
    tags: ['Spotlight hero', 'Plan', 'Form'],
    blocks: () => [
      newBlock('hero', {
        layout: 'spotlight',
        badge: 'Prepared for {{first_name|you}} at {{company_short|your team}}',
        headline: 'A faster route to pipeline for {{company_short|your team}}',
        subheadline: 'Three things we would change in your outbound this quarter, and what each is worth. Two minutes to read.',
        primary: { label: 'See the plan', action: { type: 'anchor', anchor: 'plan' } },
        secondary: { label: 'Book 20 minutes', action: toForm },
      }),
      note(
        'Hi {{first_name|there}}, I spent twenty minutes looking at how {{company_short|your team}} reaches new customers and wrote down what I would try first. It is short. Tell me where I am wrong.',
      ),
      newBlock('features', {
        heading: 'Where we would start',
        items: [
          {
            icon: 'target',
            title: 'Sharper targeting',
            text: 'Focus on the teams that feel the problem most, not everyone with the right job title.',
          },
          {
            icon: 'zap',
            title: 'Faster follow-up',
            text: 'Reply to interest within the hour, automatically, while the person is still thinking about you.',
          },
          {
            icon: 'chart',
            title: 'Numbers you can defend',
            text: 'Every change is tied to meetings booked and pipeline created, so the story tells itself.',
          },
        ],
      }),
      newBlock('steps', {
        anchor: 'plan',
        bg: 'alt',
        heading: 'How we would work with {{company_short|you}}',
        items: [
          { title: 'Week 1: audit', text: 'We read the last 90 days of your outreach and replies, and find what is already working.' },
          { title: 'Week 2: rebuild', text: 'New messaging and targeting, tested on a small segment of your list.' },
          { title: 'Week 3 onwards: scale', text: 'What works goes to the full list, with a short report every Friday.' },
        ],
      }),
      newBlock('testimonial', {
        quote: '“They found in a fortnight what we had missed for a year. Meetings doubled the next month.”',
        name: 'Customer name',
        role: 'VP Sales',
        company: 'Customer Co',
      }),
      newBlock('cta', {
        bg: 'default',
        heading: 'Worth twenty minutes, {{first_name|friend}}?',
        text: 'Pick a time and I will walk you through it with {{company_short|your team}}’s numbers on screen.',
        button: { label: 'Book a call', action: toForm },
      }),
      newBlock('form', { bg: 'alt', heading: 'Let’s find a time', intro: 'Leave your details and I will send a calendar invite.' }),
    ],
  },
  {
    id: 'meeting-request',
    name: 'Meeting request',
    blurb: 'Big type, one idea, one button. For people who skim.',
    use: 'Senior buyers and follow-ups after a quiet first email.',
    preset: 'bold',
    brand: '#f97316',
    tags: ['Statement hero', 'Short', 'Form'],
    blocks: () => [
      newBlock('hero', {
        layout: 'minimal',
        badge: undefined,
        headline: '{{first_name|Hello}}, can we have 20 minutes?',
        subheadline:
          'I have a specific idea for how {{company_short|your team}} could book more qualified meetings without adding headcount. Pick a time below, or just reply and tell me what suits.',
        primary: { label: 'Pick a time', action: toForm },
        secondary: undefined,
      }),
      newBlock('checklist', {
        bg: 'alt',
        heading: 'What we would cover',
        items: [
          'What is working in your outbound today, and what is not',
          'The one change I would make first, and why',
          'What it would take, how long, and what it would cost',
        ],
      }),
      note('I will keep it to twenty minutes. If it is not useful, tell me and I will stop there.'),
      newBlock('form', {
        bg: 'alt',
        heading: 'Pick a time that suits you',
        intro: 'Tell us when you are free and we will send an invite.',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true, prefill: '{{full_name}}' },
          { key: 'email', label: 'Work email', type: 'email', required: true, prefill: '{{email}}' },
          { key: 'times', label: 'Days and times that work', type: 'text', required: false, placeholder: 'Tuesday or Wednesday afternoon' },
        ],
        button_label: 'Request a time',
        success_message: 'Thank you. An invite will be with you shortly.',
      }),
    ],
  },
  {
    id: 'case-study',
    name: 'Customer story',
    blurb: 'A results-led story told like a magazine piece: serif headings, warm paper, real numbers.',
    use: 'When you have a strong reference customer in the same space as your prospect.',
    preset: 'editorial',
    brand: '#0f766e',
    tags: ['Centred hero', 'Stats', 'Quote'],
    blocks: () => [
      newBlock('hero', {
        layout: 'centered',
        badge: 'A story for {{company_short|your team}}',
        headline: 'How a team like {{company_short|yours}} cut onboarding time in half',
        subheadline: 'A two-minute read on what changed, what it took and what it was worth.',
        primary: { label: 'Talk to us about it', action: toForm },
        secondary: { label: 'Read the story', action: { type: 'anchor', anchor: 'story' } },
      }),
      newBlock('stats', {
        bg: 'alt',
        items: [
          { value: '52%', label: 'faster onboarding' },
          { value: '$480k', label: 'saved in the first year' },
          { value: '9 weeks', label: 'from kickoff to full rollout' },
        ],
      }),
      newBlock('text', {
        anchor: 'story',
        heading: 'The challenge',
        body: 'Every new hire took three months to reach full speed. Knowledge lived in people’s heads, the tools did not talk to each other, and managers spent a day a week answering the same questions.\n\nSound familiar, {{first_name|friend}}? It is the most common thing we hear from teams the size of {{company_short|yours}}.',
      }),
      newBlock('text', {
        heading: 'What changed',
        body: 'We started small, with one team and one workflow, and measured everything.\n\n- A single source of truth for how the work gets done\n- Training that happens inside the tools people already use\n- A weekly review of what was slowing people down',
      }),
      newBlock('testimonial', {
        bg: 'alt',
        quote:
          '“We stopped talking about the problem and started shipping the fix. Within a quarter the whole team was working differently.”',
        name: 'Customer name',
        role: 'VP Operations',
        company: 'Customer Co',
      }),
      newBlock('cta', {
        bg: 'default',
        heading: 'Could this look like {{company_short|your team}}?',
        text: 'Tell us where you are today and we will show you what a similar plan would look like.',
        button: { label: 'Start the conversation', action: toForm },
      }),
      newBlock('form', {
        bg: 'alt',
        heading: 'Start the conversation',
        intro: 'A few details and we will come back within a working day.',
      }),
    ],
  },
  {
    id: 'event-invite',
    name: 'Event invitation',
    blurb: 'A dark, confident invite with the agenda, a host and a one-step registration.',
    use: 'Webinars, roundtables and dinners where you want a yes, not a meeting.',
    preset: 'midnight',
    brand: '#7c3aed',
    tags: ['Dark', 'Agenda', 'Register'],
    blocks: () => [
      newBlock('hero', {
        layout: 'spotlight',
        badge: 'You are invited, {{first_name|friend}}',
        headline: 'Outbound that works in 2027: a live working session',
        subheadline:
          'Thursday 12 November, 11:00 ET. Forty-five minutes, three tactics you can use the same day, and time for your questions.',
        primary: { label: 'Save my seat', action: toForm },
        secondary: { label: 'See the agenda', action: { type: 'anchor', anchor: 'agenda' } },
      }),
      newBlock('checklist', {
        anchor: 'agenda',
        heading: 'What we will cover',
        items: [
          'The three messages that earn replies from senior buyers',
          'How to follow up without sounding like a robot',
          'A live teardown of a real sequence (bring one of yours)',
          'What to measure, and what to stop measuring',
        ],
      }),
      note(
        'I will be running this one myself. If there is something about {{company_short|your team}} you would like covered, reply to my email and I will work it in.',
        { bg: 'alt', from_role: 'Host, Your Company' },
      ),
      newBlock('testimonial', {
        quote: '“The most practical hour I spent last quarter. I used two of the ideas that afternoon.”',
        name: 'Past attendee',
        role: 'Head of Growth',
        company: 'Customer Co',
      }),
      newBlock('form', {
        bg: 'alt',
        heading: 'Save your seat',
        intro: 'It is free. A calendar invite lands in your inbox straight away.',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true, prefill: '{{full_name}}' },
          { key: 'email', label: 'Work email', type: 'email', required: true, prefill: '{{email}}' },
          { key: 'question', label: 'Anything you would like covered?', type: 'textarea', required: false },
        ],
        button_label: 'Save my seat',
        success_message: 'You are in. A calendar invite is on its way.',
      }),
      newBlock('faq', {
        heading: 'Good to know',
        items: [
          { q: 'Will there be a recording?', a: 'Yes. Everyone who registers gets it the next day, whether or not they can join live.' },
          { q: 'Is it really free?', a: 'Yes. No card and no sales call afterwards unless you ask for one.' },
        ],
      }),
    ],
  },
  {
    id: 'proposal',
    name: 'Proposal and next steps',
    blurb: 'A calm, structured plan with a timeline, what is included and the answers to the usual questions.',
    use: 'After a good first call, when the buyer needs something to forward internally.',
    preset: 'corporate',
    brand: '#1e40af',
    tags: ['Brand hero', 'Timeline', 'FAQ'],
    blocks: () => [
      newBlock('hero', {
        layout: 'cover',
        badge: 'Proposal for {{company|your company}}',
        headline: 'A plan to cut {{company_short|your}} cost per meeting by a third',
        subheadline: 'What we would do, in what order, and what you can expect to see at 30, 60 and 90 days.',
        primary: { label: 'Accept and get started', action: toForm },
        secondary: { label: 'See the plan', action: { type: 'anchor', anchor: 'plan' } },
      }),
      newBlock('checklist', {
        bg: 'alt',
        heading: 'What is included',
        items: [
          'Messaging and targeting for three segments',
          'Weekly reporting on replies, meetings and pipeline',
          'A named lead and a shared channel for questions',
          'A quarterly review with your leadership team',
        ],
      }),
      newBlock('steps', {
        anchor: 'plan',
        heading: 'The plan',
        items: [
          { title: 'Kickoff', text: 'One working session to agree goals, segments and how success will be measured.' },
          { title: 'Build', text: 'We write, set up and test everything. You approve before anything goes out.' },
          { title: 'Launch', text: 'A first wave to a small segment, reviewed after one week.' },
          { title: 'Scale', text: 'What works goes wider. What does not is dropped quickly.' },
        ],
      }),
      newBlock('stats', {
        bg: 'alt',
        heading: 'What to expect',
        items: [
          { value: '30 days', label: 'first meetings on the calendar' },
          { value: '60 days', label: 'messaging proven on your best segment' },
          { value: '90 days', label: 'the programme running at full volume' },
        ],
      }),
      newBlock('faq', {
        heading: 'Questions we usually get',
        items: [
          {
            q: 'What do you need from us?',
            a: 'A list of target accounts, read access to your CRM for reporting, and an hour with someone who knows your customers well.',
          },
          { q: 'How is it priced?', a: 'A single monthly fee with no long-term contract. The figure is in the proposal we sent.' },
          { q: 'Can we pause?', a: 'Yes, at any time with thirty days’ notice.' },
        ],
      }),
      newBlock('cta', {
        bg: 'dark',
        heading: 'Ready when you are, {{first_name|friend}}',
        text: 'Confirm below and we will send the kickoff invite today.',
        button: { label: 'Accept and get started', action: toForm },
      }),
      newBlock('form', {
        bg: 'alt',
        heading: 'Confirm and get started',
        intro: 'We will reply within one working day.',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true, prefill: '{{full_name}}' },
          { key: 'email', label: 'Work email', type: 'email', required: true, prefill: '{{email}}' },
          { key: 'start', label: 'Preferred start date', type: 'text', required: false },
        ],
        button_label: 'Confirm',
        success_message: 'Thank you. We will be in touch today with a kickoff invite.',
      }),
    ],
  },
  {
    id: 'free-audit',
    name: 'Free audit',
    blurb: 'Lead with what you noticed. Findings first, offer second, in a bright gradient look.',
    use: 'Cold outreach where you have genuinely looked at their site, ads or funnel.',
    preset: 'gradient',
    brand: '#2563eb',
    tags: ['Gradient', 'Findings', 'Form'],
    blocks: () => [
      newBlock('hero', {
        layout: 'spotlight',
        badge: 'A free audit for {{company_short|your team}}',
        headline: 'We looked at {{company_short|possessive|your company’s}} outbound. Three things stood out.',
        subheadline: 'No pitch in this page. Just what we noticed, why it matters and what we would try.',
        primary: { label: 'See what we found', action: { type: 'anchor', anchor: 'findings' } },
        secondary: { label: 'Get the full report', action: toForm },
      }),
      newBlock('features', {
        anchor: 'findings',
        heading: 'What we found',
        items: [
          {
            icon: 'search',
            title: 'Your best segment is under-served',
            text: 'Most of your outreach goes to the widest group, not the one that converts.',
          },
          {
            icon: 'clock',
            title: 'Replies go cold after day three',
            text: 'Follow-up stops just as interest is peaking. A short sequence recovers most of it.',
          },
          {
            icon: 'target',
            title: 'Your pages do not speak to the buyer',
            text: 'Every visitor lands on the same page, whoever they are and why they came.',
          },
        ],
      }),
      newBlock('stats', {
        bg: 'alt',
        heading: 'What fixing it is usually worth',
        items: [
          { value: '2-3x', label: 'more replies from the same list' },
          { value: '40%', label: 'less time spent on follow-up' },
          { value: '3 weeks', label: 'to see the first difference' },
        ],
      }),
      note(
        'I did this on my own time because {{company_short|your team}} looked like a good fit. The full report is yours whether or not we ever speak.',
      ),
      newBlock('cta', {
        bg: 'brand',
        heading: 'Want the full report, {{first_name|friend}}?',
        text: 'Twelve pages, specific to {{company_short|your business}}. It takes one minute to request.',
        button: { label: 'Send me the report', action: toForm },
      }),
      newBlock('form', {
        bg: 'alt',
        heading: 'Get the full audit',
        intro: 'Tell us where to send it.',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true, prefill: '{{full_name}}' },
          { key: 'email', label: 'Work email', type: 'email', required: true, prefill: '{{email}}' },
          {
            key: 'priority',
            label: 'Which matters most to you?',
            type: 'select',
            required: false,
            options: ['More replies', 'Faster follow-up', 'Better targeting', 'Not sure yet'],
          },
        ],
        button_label: 'Send me the report',
        success_message: 'Thank you. The report is on its way to your inbox.',
      }),
    ],
  },
];

export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);

/** A fresh copy of a template as a page: new block ids each time, dressed in its style preset. */
export function buildTemplate(id: string): Page | null {
  const t = templateById(id);
  if (!t) return null;
  const page = PageSchema.parse({ theme: { brand: t.brand }, header, footer: { text: footer }, blocks: t.blocks() });
  const preset = presetById(t.preset);
  return preset ? withPreset(page, preset) : page;
}

/** What the gallery needs to list a template. */
export type TemplateInfo = Pick<Template, 'id' | 'name' | 'blurb' | 'use' | 'brand' | 'tags'> & { preset: string };
export const templateInfo = (t: Template): TemplateInfo => ({
  id: t.id,
  name: t.name,
  blurb: t.blurb,
  use: t.use,
  brand: t.brand,
  tags: t.tags,
  preset: t.preset,
});
