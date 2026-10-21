import type { Block, BlockType } from './schema';

export function newBlockId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return 'b_' + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}

export interface BlockMeta {
  type: BlockType;
  label: string;
  description: string;
  /** lucide icon name used in the dashboard */
  icon: string;
  group: 'Hero & intro' | 'Content' | 'Proof' | 'Convert' | 'Advanced';
}

export const BLOCK_TYPES: BlockMeta[] = [
  { type: 'hero', label: 'Hero', description: 'Headline, sub-headline and buttons', icon: 'panel-top', group: 'Hero & intro' },
  { type: 'note', label: 'Personal note', description: 'A short message from you, with your photo', icon: 'message-square-heart', group: 'Hero & intro' },
  { type: 'text', label: 'Text', description: 'A heading and a few paragraphs', icon: 'align-left', group: 'Content' },
  { type: 'features', label: 'Feature grid', description: 'Icons with short descriptions', icon: 'layout-grid', group: 'Content' },
  { type: 'checklist', label: 'Checklist', description: 'Bulleted or numbered list', icon: 'list-checks', group: 'Content' },
  { type: 'steps', label: 'Steps', description: 'A numbered process', icon: 'list-ordered', group: 'Content' },
  { type: 'image', label: 'Image', description: 'A single picture or chart', icon: 'image', group: 'Content' },
  { type: 'video', label: 'Video', description: 'YouTube, Vimeo, Loom or Wistia', icon: 'play-circle', group: 'Content' },
  { type: 'stats', label: 'Stats', description: 'Big numbers with labels', icon: 'bar-chart-3', group: 'Proof' },
  { type: 'testimonial', label: 'Testimonial', description: 'A customer quote', icon: 'quote', group: 'Proof' },
  { type: 'logos', label: 'Logo strip', description: 'Customer or partner logos', icon: 'badge-check', group: 'Proof' },
  { type: 'cta', label: 'Call to action', description: 'A banner with a button', icon: 'mouse-pointer-click', group: 'Convert' },
  { type: 'form', label: 'Lead form', description: 'Capture details or a reply', icon: 'text-cursor-input', group: 'Convert' },
  { type: 'calendar', label: 'Meeting booker', description: 'Embed Calendly, Cal.com or HubSpot', icon: 'calendar-days', group: 'Convert' },
  { type: 'document', label: 'PDF download', description: 'Preview and download their personalised PDF', icon: 'file-down', group: 'Convert' },
  { type: 'faq', label: 'FAQ', description: 'Questions and answers', icon: 'circle-help', group: 'Content' },
  { type: 'html', label: 'Custom HTML', description: 'Safe, sanitised HTML', icon: 'code', group: 'Advanced' },
  { type: 'divider', label: 'Divider', description: 'A thin line between sections', icon: 'minus', group: 'Advanced' },
];

/** A new block with sensible starter copy, so the page never looks empty. */
export function newBlock(type: BlockType, overrides: Partial<Block> = {}): Block {
  const id = newBlockId();
  const base = (() => {
    switch (type) {
      case 'hero':
        return {
          type,
          id,
          layout: 'split' as const,
          badge: 'Prepared for {{first_name|you}} at {{company|your team}}',
          headline: 'A headline that speaks to {{company|your team}}',
          subheadline: 'Say what you do, for whom, and the outcome they get — in one or two sentences.',
          primary: { label: 'Book a call', action: { type: 'form' as const } },
          secondary: { label: 'Download the PDF', action: { type: 'document' as const } },
        };
      case 'note':
        return {
          type,
          id,
          from_name: 'Your name',
          from_role: 'Your role',
          message: 'Hi {{first_name|there}} — I put this together for you after looking at {{company|your business}}. Have a skim and tell me what you think.',
        };
      case 'text':
        return { type, id, heading: 'Section heading', body: 'Write something specific and useful for {{company|your team}}.' };
      case 'features':
        return {
          type,
          id,
          heading: 'Why teams choose us',
          columns: 3 as const,
          items: [
            { icon: 'zap', title: 'Fast to value', text: 'Describe the benefit in one plain sentence.' },
            { icon: 'target', title: 'Built for your role', text: 'Describe the benefit in one plain sentence.' },
            { icon: 'shield', title: 'Safe and compliant', text: 'Describe the benefit in one plain sentence.' },
          ],
        };
      case 'checklist':
        return { type, id, heading: 'What you get', style: 'check' as const, items: ['First benefit', 'Second benefit', 'Third benefit'] };
      case 'steps':
        return {
          type,
          id,
          heading: 'How it works',
          items: [
            { title: 'Connect', text: 'Tell us where your data lives.' },
            { title: 'Personalise', text: 'We tailor everything to each person.' },
            { title: 'Launch', text: 'Go live in a day.' },
          ],
        };
      case 'stats':
        return {
          type,
          id,
          items: [
            { value: '3.4x', label: 'more replies' },
            { value: '47%', label: 'shorter sales cycle' },
            { value: '$1.2M', label: 'pipeline created' },
          ],
        };
      case 'testimonial':
        return { type, id, quote: '“Quote from a happy customer that is relevant to {{company|this audience}}.”', name: 'Customer name', role: 'Title', company: 'Company' };
      case 'logos':
        return { type, id, heading: 'Trusted by teams at', grayscale: true, items: [] };
      case 'image':
        return { type, id, image: { src: '', alt: '' }, width: 'content' as const };
      case 'video':
        return { type, id, heading: 'Watch a short walkthrough', url: '' };
      case 'cta':
        return {
          type,
          id,
          heading: 'Ready to talk, {{first_name|friend}}?',
          text: 'Grab 20 minutes and we’ll walk you through it.',
          button: { label: 'Book a call', action: { type: 'form' as const } },
        };
      case 'form':
        return {
          type,
          id,
          heading: 'Let’s talk',
          intro: 'Leave your details and we’ll reach out.',
          fields: [
            { key: 'name', label: 'Name', type: 'text' as const, required: true, prefill: '{{full_name}}' },
            { key: 'email', label: 'Work email', type: 'email' as const, required: true, prefill: '{{email}}' },
            { key: 'message', label: 'Anything we should know?', type: 'textarea' as const, required: false },
          ],
          button_label: 'Send',
          success_message: 'Thanks — we’ll be in touch shortly.',
        };
      case 'faq':
        return { type, id, heading: 'Questions', items: [{ q: 'How does it work?', a: 'A clear, short answer.' }] };
      case 'calendar':
        return { type, id, heading: 'Pick a time', url: '', height: 700 };
      case 'document':
        return { type, id, heading: 'Your copy', text: 'We prepared a version of this guide for {{company|your team}}.', button_label: 'Download your copy', show_preview: true };
      case 'html':
        return { type, id, html: '<p>Custom HTML goes here.</p>' };
      case 'divider':
        return { type, id };
    }
  })();
  return { ...base, ...overrides } as Block;
}
