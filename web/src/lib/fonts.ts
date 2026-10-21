import type { Theme } from '@shared/schema';

/** The page typefaces as the dashboard shows them. (The server keeps its own table, which also serves the font files.) */
export const FONT_OPTIONS: Array<{ value: Theme['font']; label: string; css: string }> = [
  { value: 'inter', label: 'Inter', css: '"Inter Variable", Inter, system-ui, sans-serif' },
  { value: 'manrope', label: 'Manrope', css: '"Manrope Variable", Manrope, system-ui, sans-serif' },
  { value: 'space-grotesk', label: 'Space Grotesk', css: '"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif' },
  { value: 'fraunces', label: 'Fraunces (serif)', css: '"Fraunces Variable", Fraunces, Georgia, serif' },
  { value: 'system', label: 'System default', css: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { value: 'serif', label: 'Classic serif', css: 'Georgia, Cambria, "Times New Roman", serif' },
  { value: 'mono', label: 'Monospace', css: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
];

export const fontCss = (f: Theme['font']): string => FONT_OPTIONS.find((o) => o.value === f)?.css ?? FONT_OPTIONS[0]!.css;

export const HEADING_WEIGHTS: Record<Theme['heading_weight'], number> = { medium: 560, semibold: 640, bold: 700, extrabold: 800 };
