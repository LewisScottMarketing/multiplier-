import type { Block } from './schema';

/**
 * The prose inside a block, addressed by path ("headline", "items.2.title"), so a rewrite (a persona
 * variant, say) can be requested and applied without the writer ever touching layout, links,
 * images, ids or targeting rules. Quotes, statistics and form fields are deliberately absent:
 * those are evidence or functionality, not copy to be re-angled.
 */
export interface TextLeaf {
  path: string;
  text: string;
  /** The schema's limit for this field. */
  max: number;
  label: string;
}

export const VARIANT_BLOCK_TYPES = ['hero', 'text', 'split', 'callout', 'features', 'checklist', 'steps', 'cta', 'note'] as const;
export const canVary = (b: Block): boolean => (VARIANT_BLOCK_TYPES as readonly string[]).includes(b.type);

export function textLeaves(b: Block): TextLeaf[] {
  const out: TextLeaf[] = [];
  const add = (path: string, text: unknown, max: number, label: string) => {
    if (typeof text === 'string' && text.trim()) out.push({ path, text, max, label });
  };
  switch (b.type) {
    case 'hero':
      add('eyebrow', b.eyebrow, 120, 'Eyebrow');
      add('headline', b.headline, 240, 'Headline');
      add('subheadline', b.subheadline, 700, 'Sub-headline');
      break;
    case 'text':
      add('heading', b.heading, 240, 'Heading');
      add('body', b.body, 6000, 'Text');
      break;
    case 'split':
      add('eyebrow', b.eyebrow, 120, 'Eyebrow');
      add('heading', b.heading, 240, 'Heading');
      add('body', b.body, 3000, 'Text');
      break;
    case 'callout':
      add('eyebrow', b.eyebrow, 120, 'Eyebrow');
      add('text', b.text, 600, 'Statement');
      break;
    case 'features':
      add('heading', b.heading, 240, 'Heading');
      add('intro', b.intro, 600, 'Intro');
      b.items.forEach((it, i) => {
        add(`items.${i}.title`, it.title, 160, `Item ${i + 1} title`);
        add(`items.${i}.text`, it.text, 600, `Item ${i + 1} text`);
      });
      break;
    case 'checklist':
      add('heading', b.heading, 240, 'Heading');
      add('intro', b.intro, 600, 'Intro');
      b.items.forEach((it, i) => add(`items.${i}`, it, 400, `Point ${i + 1}`));
      break;
    case 'steps':
      add('heading', b.heading, 240, 'Heading');
      add('intro', b.intro, 600, 'Intro');
      b.items.forEach((it, i) => {
        add(`items.${i}.title`, it.title, 160, `Step ${i + 1} title`);
        add(`items.${i}.text`, it.text, 500, `Step ${i + 1} text`);
      });
      break;
    case 'cta':
      add('heading', b.heading, 240, 'Heading');
      add('text', b.text, 600, 'Text');
      break;
    case 'note':
      add('message', b.message, 3000, 'Message');
      break;
  }
  return out;
}

/** A copy of the block with the given leaves replaced. Unknown paths are ignored. */
export function withLeaves<T extends Block>(b: T, values: Record<string, string>): T {
  const copy = structuredClone(b) as unknown as Record<string, unknown>;
  const allowed = new Set(textLeaves(b).map((l) => l.path));
  for (const [path, value] of Object.entries(values)) {
    if (!allowed.has(path)) continue;
    const parts = path.split('.');
    let cur: unknown = copy;
    for (let i = 0; i < parts.length - 1; i++) cur = (cur as Record<string, unknown>)[parts[i]!];
    if (cur && typeof cur === 'object') (cur as Record<string, unknown>)[parts[parts.length - 1]!] = value;
  }
  return copy as unknown as T;
}
