import {
  escapeHtml,
  evalToken,
  parseTemplate,
  safeUrl,
  type Ctx,
  type Segment,
  type TokenResult,
} from '@shared/template';

/**
 * "Markdown-lite" + merge tokens → safe HTML.
 *
 * Supported: paragraphs, line breaks, **bold**, *italic*, [links](url), "- " bullets, "1. " lists.
 *
 * The order matters for safety: markup is parsed from the TEMPLATE first, with tokens swapped
 * for opaque placeholders. Prospect data is substituted afterwards, into text leaves only, and
 * always HTML-escaped. So a company called "**<script>**" renders as literal text, never markup.
 */

export interface RichOptions {
  onToken?: (r: TokenResult) => void;
}

const OPEN = '';
const CLOSE = '';
const PLACEHOLDER_RE = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g');

interface Protected {
  text: string;
  tokens: Array<Extract<Segment, { kind: 'token' }>>;
}

function protect(tpl: string): Protected {
  const tokens: Protected['tokens'] = [];
  let text = '';
  // strip our own sentinels from author input so they can't be forged
  for (const seg of parseTemplate(tpl.replaceAll(OPEN, '').replaceAll(CLOSE, ''))) {
    if (seg.kind === 'text') text += seg.value;
    else {
      text += `${OPEN}${tokens.length}${CLOSE}`;
      tokens.push(seg);
    }
  }
  return { text, tokens };
}

function makeExpanders(p: Protected, ctx: Ctx, opts: RichOptions) {
  const value = (idx: number): string => {
    const tok = p.tokens[Number(idx)];
    if (!tok) return '';
    const r = evalToken(tok, ctx);
    opts.onToken?.(r);
    return r.value;
  };
  /** Text leaf → escaped HTML with tokens substituted. */
  const leaf = (s: string): string => {
    let out = '';
    let last = 0;
    for (const m of s.matchAll(PLACEHOLDER_RE)) {
      out += escapeHtml(s.slice(last, m.index));
      out += escapeHtml(value(Number(m[1])));
      last = (m.index ?? 0) + m[0].length;
    }
    return out + escapeHtml(s.slice(last));
  };
  /** URL part of a link: a lone token is a whole URL, otherwise values are percent-encoded. */
  const url = (s: string): string => {
    const only = s.match(new RegExp(`^${OPEN}(\\d+)${CLOSE}$`));
    const resolved = only
      ? value(Number(only[1]))
      : s.replace(PLACEHOLDER_RE, (_m, i: string) => encodeURIComponent(value(Number(i))));
    return safeUrl(resolved);
  };
  return { leaf, url };
}

const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/;
const BOLD_RE = /\*\*([^\n]+?)\*\*/;
const ITALIC_STAR_RE = /(?<![\w*])\*(?![\s*])([^\n*]+?)(?<![\s*])\*(?![\w*])/;
const ITALIC_UNDER_RE = /(?<![\w_])_(?![\s_])([^\n_]+?)(?<![\s_])_(?![\w_])/;

function inline(s: string, x: ReturnType<typeof makeExpanders>): string {
  const candidates: Array<{ m: RegExpExecArray; kind: 'link' | 'bold' | 'em' }> = [];
  const push = (re: RegExp, kind: 'link' | 'bold' | 'em') => {
    const m = re.exec(s);
    if (m) candidates.push({ m, kind });
  };
  push(LINK_RE, 'link');
  push(BOLD_RE, 'bold');
  push(ITALIC_STAR_RE, 'em');
  push(ITALIC_UNDER_RE, 'em');
  if (candidates.length === 0) return x.leaf(s);
  candidates.sort((a, b) => a.m.index - b.m.index);
  const { m, kind } = candidates[0];
  const before = x.leaf(s.slice(0, m.index));
  const after = inline(s.slice(m.index + m[0].length), x);
  if (kind === 'link') {
    const href = x.url(m[2]);
    const label = inline(m[1], x);
    return href
      ? `${before}<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${label}</a>${after}`
      : `${before}${label}${after}`;
  }
  const tag = kind === 'bold' ? 'strong' : 'em';
  return `${before}<${tag}>${inline(m[1], x)}</${tag}>${after}`;
}

/** Block-level rendering: paragraphs, lists, line breaks. */
export function renderRich(tpl: string | undefined, ctx: Ctx, opts: RichOptions = {}): string {
  if (!tpl || !tpl.trim()) return '';
  const p = protect(tpl.replace(/\r\n?/g, '\n'));
  const x = makeExpanders(p, ctx, opts);
  const blocks = p.text
    .trim()
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''), x)}</li>`).join('')}</ul>`;
      }
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''), x)}</li>`).join('')}</ol>`;
      }
      return `<p>${lines.map((l) => inline(l, x)).join('<br>')}</p>`;
    })
    .join('');
}

/** Single-line variant for headings, buttons, labels: no paragraph wrapper, same safety. */
export function renderInline(tpl: string | undefined, ctx: Ctx, opts: RichOptions = {}): string {
  if (!tpl) return '';
  const p = protect(tpl.replace(/\s*\n\s*/g, ' '));
  return inline(p.text, makeExpanders(p, ctx, opts));
}

/** Plain text (for <title>, alt text, attributes). Escaped for attribute/text contexts. */
export function renderPlain(tpl: string | undefined, ctx: Ctx, opts: RichOptions = {}): string {
  if (!tpl) return '';
  let out = '';
  for (const seg of parseTemplate(tpl)) {
    if (seg.kind === 'text') out += seg.value;
    else {
      const r = evalToken(seg, ctx);
      opts.onToken?.(r);
      out += r.value;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}
