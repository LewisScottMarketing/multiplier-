/**
 * Merge-token engine.
 *
 *   {{first_name}}                    value, or empty when unknown
 *   {{first_name|there}}              fallback when empty
 *   {{company|upper}}                 filter (applied only when there is a value)
 *   {{first_name|title|"there"}}      filters and fallbacks chain left to right
 *   {{ Company Name }}                keys are normalised: "company_name"
 *
 * A pipe segment that names a known filter is a filter; anything else is a fallback literal.
 * Quote a fallback ("title") to force it to be a literal.
 *
 * Output is plain text. Callers choose how to escape it, so prospect data can never turn
 * into markup — see `escape` below and `render/rich.ts` on the server.
 */

export type Ctx = Record<string, unknown>;

export type Pipe = { kind: 'filter'; name: string; args: string[] } | { kind: 'fallback'; value: string };

export type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'token'; raw: string; field: string; pipes: Pipe[] };

export const normKey = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '_')
    .replace(/^_+|_+$/g, '');

// ── Filters ─────────────────────────────────────────────────────────────────

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via']);

/** "head of GROWTH" → "Head of Growth". Small words stay lowercase except at the start. */
export function titleCase(s: string): string {
  let first = true;
  return s.toLowerCase().replace(/\p{L}[\p{L}\p{M}'’]*/gu, (w) => {
    const small = !first && SMALL_WORDS.has(w);
    first = false;
    return small ? w : w.charAt(0).toUpperCase() + w.slice(1);
  });
}

const FILTERS: Record<string, (v: string, args: string[]) => string> = {
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  title: (v) => titleCase(v),
  capitalize: (v) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v),
  trim: (v) => v.trim(),
  first_word: (v) => v.trim().split(/\s+/)[0] ?? '',
  last_word: (v) => {
    const parts = v.trim().split(/\s+/);
    return parts[parts.length - 1] ?? '';
  },
  initials: (v) =>
    v
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase())
      .join(''),
  possessive: (v) => (!v ? v : /s$/i.test(v) ? `${v}’` : `${v}’s`),
  truncate: (v, args) => {
    const n = Math.max(1, Math.min(500, parseInt(args[0] ?? '40', 10) || 40));
    return v.length > n ? `${v.slice(0, n - 1).trimEnd()}…` : v;
  },
  domain: (v) => {
    const m = v.trim().toLowerCase().match(/^(?:[a-z]+:\/\/)?(?:[^@/]*@)?(?:www\.)?([^/:?#\s]+)/);
    return m?.[1] ?? v;
  },
};

export const FILTER_NAMES = Object.keys(FILTERS);

// ── Parsing ─────────────────────────────────────────────────────────────────

const TOKEN_RE = /\{\{([\s\S]*?)\}\}/g;

function splitPipes(body: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === '\'') {
      quote = ch;
      cur += ch;
    } else if (ch === '|') {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function parsePipe(seg: string): Pipe | null {
  const s = seg.trim();
  if (!s) return null;
  const q = s.match(/^(["'])([\s\S]*)\1$/);
  if (q) return { kind: 'fallback', value: q[2] };
  const [name, ...rest] = s.split(':');
  const fname = name.trim().toLowerCase();
  if (FILTERS[fname]) return { kind: 'filter', name: fname, args: rest.join(':').split(',').map((a) => a.trim()).filter(Boolean) };
  return { kind: 'fallback', value: s };
}

const parseCache = new Map<string, Segment[]>();

export function parseTemplate(tpl: string): Segment[] {
  const hit = parseCache.get(tpl);
  if (hit) return hit;
  const out: Segment[] = [];
  let last = 0;
  for (const m of tpl.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: 'text', value: tpl.slice(last, idx) });
    const [fieldPart, ...pipeParts] = splitPipes(m[1]);
    const field = normKey(fieldPart);
    if (field) {
      out.push({
        kind: 'token',
        raw: m[0],
        field,
        pipes: pipeParts.map(parsePipe).filter((p): p is Pipe => p !== null),
      });
    } else {
      out.push({ kind: 'text', value: m[0] });
    }
    last = idx + m[0].length;
  }
  if (last < tpl.length) out.push({ kind: 'text', value: tpl.slice(last) });
  if (parseCache.size > 2000) parseCache.clear();
  parseCache.set(tpl, out);
  return out;
}

export function hasTokens(tpl: string | undefined | null): boolean {
  return !!tpl && tpl.includes('{{') && parseTemplate(tpl).some((s) => s.kind === 'token');
}

// ── Evaluation ──────────────────────────────────────────────────────────────

/** Coerce anything a CRM might hand us into a trimmed display string. */
export function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim();
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (Array.isArray(v)) return v.map(toStr).filter(Boolean).join(', ');
  return '';
}

export function lookup(ctx: Ctx, key: string): string {
  if (key in ctx) return toStr(ctx[key]);
  if (key.includes('.')) {
    let cur: unknown = ctx;
    for (const part of key.split('.')) {
      if (cur && typeof cur === 'object' && part in (cur as Ctx)) cur = (cur as Ctx)[part];
      else return '';
    }
    return toStr(cur);
  }
  return '';
}

export interface TokenResult {
  field: string;
  value: string;
  /** The field had no value in the context. */
  missing: boolean;
  /** A fallback literal supplied the final value. */
  usedFallback: boolean;
  hasFallback: boolean;
}

export function evalToken(tok: Extract<Segment, { kind: 'token' }>, ctx: Ctx): TokenResult {
  const original = lookup(ctx, tok.field);
  let value = original;
  let usedFallback = false;
  for (const p of tok.pipes) {
    if (p.kind === 'filter') {
      if (value) value = FILTERS[p.name](value, p.args);
    } else if (!value) {
      value = p.value;
      usedFallback = true;
    }
  }
  return {
    field: tok.field,
    value,
    missing: original === '',
    usedFallback,
    hasFallback: tok.pipes.some((p) => p.kind === 'fallback'),
  };
}

export interface RenderOptions {
  /** Applied to every substituted value (not to the template's own text). */
  escape?: (s: string) => string;
  /** Collects results for each token so callers can report missing data. */
  onToken?: (r: TokenResult) => void;
}

/** Substitute tokens, returning a plain string. Template text is left exactly as written. */
export function renderTemplate(tpl: string, ctx: Ctx, opts: RenderOptions = {}): string {
  if (!tpl) return '';
  const esc = opts.escape ?? ((s: string) => s);
  let out = '';
  for (const seg of parseTemplate(tpl)) {
    if (seg.kind === 'text') out += seg.value;
    else {
      const r = evalToken(seg, ctx);
      opts.onToken?.(r);
      out += esc(r.value);
    }
  }
  return out;
}

/** Every token used in a template, with whether it has a fallback. */
export function extractTokens(tpl: string | undefined | null): Array<{ field: string; hasFallback: boolean }> {
  if (!tpl || !tpl.includes('{{')) return [];
  return parseTemplate(tpl)
    .filter((s): s is Extract<Segment, { kind: 'token' }> => s.kind === 'token')
    .map((s) => ({ field: s.field, hasFallback: s.pipes.some((p) => p.kind === 'fallback') }));
}

// ── Escaping & URLs ─────────────────────────────────────────────────────────

const HTML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESC[c]);

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Returns the URL when it is safe to put in an href/src, otherwise ''. */
export function safeUrl(url: string, opts: { allowRelative?: boolean; schemes?: Set<string> } = {}): string {
  const u = url.trim();
  if (!u) return '';
  // strip control characters browsers ignore inside schemes ("java\tscript:")
  const compact = u.replace(/[\u0000-\u001f\u007f\s]+/g, '');
  const m = compact.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)/);
  if (m) return (opts.schemes ?? SAFE_SCHEMES).has(m[1].toLowerCase()) ? u : '';
  if (compact.startsWith('//')) return '';
  if (compact.startsWith('#') || compact.startsWith('/') || compact.startsWith('?')) return opts.allowRelative === false ? '' : u;
  // bare domain such as "acme.com/demo"
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]|$)/i.test(compact) ? `https://${u}` : '';
}

/**
 * Render a URL template.
 *  - A template that is exactly one token is a whole URL (`{{website}}`).
 *  - A token at the very START that resolves to an absolute URL is inserted as-is, so
 *    `{{page_url}}?src=pdf` works. It is still scheme-checked afterwards.
 *  - Every other substituted value is percent-encoded so it can sit safely in a path or query
 *    (`https://cal.com/me?name={{full_name}}`, `https://{{domain}}/x`).
 */
export function renderUrl(tpl: string, ctx: Ctx, opts: RenderOptions = {}): string {
  const trimmed = tpl.trim();
  const segs = parseTemplate(trimmed);
  let out = '';
  segs.forEach((seg, i) => {
    if (seg.kind === 'text') {
      out += seg.value;
      return;
    }
    const r = evalToken(seg, ctx);
    opts.onToken?.(r);
    const asWhole = (segs.length === 1 || i === 0) && /^(https?:\/\/|mailto:|tel:)/i.test(r.value);
    out += asWhole ? r.value : encodeURIComponent(r.value);
  });
  return safeUrl(out);
}
