import { icons } from 'lucide';
import { ICON_NAMES, type IconName } from '@shared/schema';

type IconNode = Array<[string, Record<string, string | number>]>;

// Our schema uses friendly short names; map the few that differ from lucide's.
const LUCIDE_NAME: Record<string, string> = {
  check: 'Check',
  zap: 'Zap',
  target: 'Target',
  users: 'Users',
  clock: 'Clock',
  shield: 'Shield',
  star: 'Star',
  rocket: 'Rocket',
  chart: 'ChartColumn',
  'trending-up': 'TrendingUp',
  mail: 'Mail',
  phone: 'Phone',
  globe: 'Globe',
  lock: 'Lock',
  sparkles: 'Sparkles',
  calendar: 'Calendar',
  'file-text': 'FileText',
  heart: 'Heart',
  lightbulb: 'Lightbulb',
  layers: 'Layers',
  handshake: 'Handshake',
  search: 'Search',
  settings: 'Settings',
  puzzle: 'Puzzle',
  award: 'Award',
  banknote: 'Banknote',
  briefcase: 'Briefcase',
  compass: 'Compass',
  // used by the renderer itself
  'arrow-right': 'ArrowRight',
  download: 'Download',
  play: 'Play',
  quote: 'Quote',
  plus: 'Plus',
};

const cache = new Map<string, string>();

const attr = (v: string | number) => String(v).replace(/[^\w.\-+ ,]/g, '');

/** Inline SVG for a lucide icon, or '' when the name is unknown. Names come from a fixed allowlist. */
export function icon(name: string | undefined, size = 22): string {
  if (!name) return '';
  const key = `${name}:${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const node = (icons as unknown as Record<string, IconNode>)[LUCIDE_NAME[name] ?? ''];
  let svg = '';
  if (node) {
    const inner = node
      .map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${attr(v)}"`).join(' ')}/>`)
      .join('');
    svg = `<svg class="ic" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }
  cache.set(key, svg);
  return svg;
}

export const isIconName = (n: string): n is IconName => (ICON_NAMES as readonly string[]).includes(n);
