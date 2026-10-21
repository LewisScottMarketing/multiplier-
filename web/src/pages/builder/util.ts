import type { Block } from '@shared/schema';

export const blockAnchor = (b: Block): string => (b.anchor && b.anchor.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')) || b.id;
