import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Theme } from '@shared/schema';

/**
 * The typefaces a page can use. The web fonts are self-hosted (served from this server under /f/…), so a
 * prospect's browser never contacts a third party just to read the page; the rest are system stacks.
 */

export type FontKey = Theme['font'];

interface FontInfo {
  /** The `font-family` value, with fallbacks that sit close in feel while the file loads. */
  stack: string;
  /** Name of the @fontsource-variable package, which is also the URL segment and file prefix. */
  pkg?: string;
  /** Heading letter-spacing that suits the face: tight for grotesques, loose for serifs. */
  track: string;
}

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const FONTS: Record<FontKey, FontInfo> = {
  inter: { pkg: 'inter', stack: `"Inter Variable", Inter, ${SANS}`, track: '-.022em' },
  manrope: { pkg: 'manrope', stack: `"Manrope Variable", Manrope, ${SANS}`, track: '-.02em' },
  fraunces: {
    pkg: 'fraunces',
    stack: '"Fraunces Variable", Fraunces, ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    track: '-.012em',
  },
  'space-grotesk': { pkg: 'space-grotesk', stack: `"Space Grotesk Variable", "Space Grotesk", ${SANS}`, track: '-.03em' },
  system: { stack: SANS, track: '-.022em' },
  serif: { stack: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif', track: '-.012em' },
  mono: { stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace', track: '-.03em' },
};

const require_ = createRequire(import.meta.url);
const dirs = new Map<string, string | null>();
const packageDir = (pkg: string): string | null => {
  if (!dirs.has(pkg)) {
    try {
      dirs.set(pkg, path.dirname(require_.resolve(`@fontsource-variable/${pkg}/package.json`)));
    } catch {
      dirs.set(pkg, null);
    }
  }
  return dirs.get(pkg) ?? null;
};

const faceCache = new Map<string, string>();

/** The @font-face rules for one font, pointing at our own /f/ route. Empty for system fonts. */
export function fontFaceCss(font: FontKey): string {
  const pkg = FONTS[font].pkg;
  if (!pkg) return '';
  const hit = faceCache.get(pkg);
  if (hit !== undefined) return hit;
  let css = '';
  const dir = packageDir(pkg);
  if (dir) {
    try {
      css = fs.readFileSync(path.join(dir, 'wght.css'), 'utf8').replace(/url\(\.\/files\//g, `url(/f/${pkg}/files/`);
    } catch {
      css = '';
    }
  }
  faceCache.set(pkg, css);
  return css;
}

/** Where a font's files live on disk, for the /f/<family>/files/<file> route. */
export function fontFilesDir(family: string): string | null {
  const known = Object.values(FONTS).some((f) => f.pkg === family);
  const dir = known ? packageDir(family) : null;
  return dir ? path.join(dir, 'files') : null;
}

/**
 * The file for the Latin subset, which almost every page needs, so it can be fetched early. None when the font's files
 * aren't installed (the page then simply uses its fallback type, rather than asking for a file that isn't there).
 */
export const preloadPath = (font: FontKey): string | null => {
  const pkg = FONTS[font].pkg;
  return pkg && packageDir(pkg) ? `/f/${pkg}/files/${pkg}-latin-wght-normal.woff2` : null;
};

/** The distinct web fonts a theme uses (body first), without duplicates. */
export function fontsUsed(t: Pick<Theme, 'font' | 'heading_font'>): FontKey[] {
  return [...new Set<FontKey>([t.font, t.heading_font ?? t.font])].filter((f) => FONTS[f].pkg);
}
