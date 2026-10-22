import sanitizeHtml from 'sanitize-html';
import type { Block, BlockOf, Button, ImageRef, Page } from '@shared/schema';
import { escapeHtml as esc, renderUrl, safeUrl, type Ctx, type TokenResult } from '@shared/template';
import { calendarEmbed, FRAME_HOSTS, videoEmbed } from './embeds';
import { icon, isIconName } from './icons';
import { renderInline, renderPlain, renderRich } from './rich';

export interface RenderEnv {
  ctx: Ctx;
  page: Page;
  mode: 'live' | 'preview';
  /** Present for personalised pages; absent for the generic /c/<slug> page. */
  token: string | null;
  campaignSlug: string;
  host: string;
  urls: { pdf?: string; cover?: string; submit: string };
  hasDocument: boolean;
  /** Anchor id of the first form block, used by "scroll to form" buttons. */
  formAnchor: string | null;
  tokens: Array<TokenResult & { block: string }>;
}

/** Helper bundle handed to every block renderer, bound to one block so token reports know where they came from. */
export interface R {
  env: RenderEnv;
  rich(tpl: string | undefined): string;
  inline(tpl: string | undefined): string;
  /** `report: false` keeps the tokens out of the "empty field" warnings, for places where blank is the right answer. */
  plain(tpl: string | undefined, opts?: { report?: boolean }): string;
  url(tpl: string | undefined): string;
  img(ref: ImageRef | undefined): { src: string; alt: string } | null;
  button(btn: Button | undefined, slot: string, kind?: 'primary' | 'secondary', size?: 'sm'): string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export function blockAnchor(b: Block): string {
  return (b.anchor && slug(b.anchor)) || b.id;
}

export function makeR(env: RenderEnv, blockId: string): R {
  const onToken = (t: TokenResult) => env.tokens.push({ ...t, block: blockId });
  const r: R = {
    env,
    rich: (t) => renderRich(t, env.ctx, { onToken }),
    inline: (t) => renderInline(t, env.ctx, { onToken }),
    plain: (t, o) => renderPlain(t, env.ctx, o?.report === false ? {} : { onToken }),
    url: (t) => (t ? renderUrl(t, env.ctx, { onToken }) : ''),
    img(ref) {
      const raw = ref?.src?.trim();
      if (!raw) return null;
      let src: string;
      if (/^ast_[a-z0-9]+$/.test(raw)) src = `/a/${raw}`;
      else {
        src = renderUrl(raw, env.ctx, { onToken });
        if (!src.startsWith('https://')) return null;
      }
      return { src, alt: r.plain(ref?.alt) };
    },
    button(btn, slot, kind = 'primary', size) {
      if (!btn) return '';
      const label = r.inline(btn.label);
      if (!label) return '';
      const cls = `btn btn-${kind}${size ? ` btn-${size}` : ''}`;
      const a = btn.action;
      let href = '';
      let extra = '';
      if (a.type === 'link') {
        const dest = r.url(a.url);
        if (!dest) return '';
        const external = /^https?:/i.test(dest);
        // With a stored prospect the click goes through our redirect so it can be counted; the
        // destination is looked up server-side from the saved config and never taken from the URL.
        href = env.token && env.mode === 'live' ? `/r/${env.token}/${blockIdOf(slot)}` : dest;
        if (external) extra = ' target="_blank" rel="noopener noreferrer"';
      } else if (a.type === 'form') {
        if (!env.formAnchor) return '';
        href = `#${env.formAnchor}`;
      } else if (a.type === 'document') {
        if (!env.urls.pdf || !env.hasDocument) return '';
        href = env.urls.pdf;
      } else if (a.type === 'anchor') {
        const target = slug(a.anchor);
        if (!target) return '';
        href = `#${target}`;
      }
      return `<a class="${cls}" href="${esc(href)}"${extra}>${label}</a>`;
    },
  };
  // slot ids look like "<blockId>.<slot>" in redirect URLs
  const blockIdOf = (slot: string) => `${blockId}.${slot}`;
  return r;
}

const wrap = (inner: string, narrow = false) => `<div class="wrap">${narrow ? `<div class="col-narrow">${inner}</div>` : inner}</div>`;

const heading = (r: R, text: string | undefined, tag: 'h1' | 'h2' = 'h2') => {
  const t = r.inline(text);
  return t ? `<${tag}>${t}</${tag}>` : '';
};

const sectionHead = (r: R, h: string | undefined, intro?: string | undefined) => {
  const head = heading(r, h);
  const i = r.rich(intro);
  return head || i ? `<div class="section-head">${head}${i ? `<div class="intro">${i}</div>` : ''}</div>` : '';
};

const buttons = (...btns: string[]) => {
  const html = btns.filter(Boolean).join('');
  return html ? `<div class="btn-row">${html}</div>` : '';
};

// ── Individual blocks ───────────────────────────────────────────────────────

function hero(b: BlockOf<'hero'>, r: R): string {
  const layout = b.layout;
  const align = b.align ?? (layout === 'centered' || layout === 'spotlight' ? 'center' : 'left');
  const badge = r.inline(b.badge);
  // a portrait PDF cover makes a poor full-bleed background, so the cover layout always uses the picture the author chose
  const isDoc = !!(b.show_document && layout !== 'cover' && r.env.urls.cover && r.env.hasDocument);
  const img = isDoc ? { src: r.env.urls.cover!, alt: '' } : r.img(b.image);
  // how the picture is dressed: a PDF cover leans like a page on a desk, a window frame suits the glowing layout
  const style = b.media !== 'auto' ? b.media : isDoc ? 'tilt' : layout === 'spotlight' ? 'frame' : 'flat';
  const frameBar = style === 'frame' ? '<div class="fbar" aria-hidden="true"><i></i><i></i><i></i></div>' : '';
  const showMedia = !!img && layout !== 'cover' && layout !== 'minimal';
  const media = showMedia
    ? `<div class="hero-media m-${style}${isDoc ? ' is-cover' : ''}"><div class="mi">${frameBar}<img src="${esc(img.src)}" alt="${esc(img.alt)}" fetchpriority="high"></div></div>`
    : '';
  // the cover layout paints the picture behind everything; without one it falls back to the brand colour
  const backdrop = img && layout === 'cover' && !isDoc ? `<img class="hero-bg" src="${esc(img.src)}" alt="" fetchpriority="high">` : '';
  const text = `<div class="hero-text">
${badge ? `<span class="badge">${badge}</span><br>` : ''}
${b.eyebrow ? `<span class="eyebrow">${r.inline(b.eyebrow)}</span>` : ''}
<h1>${r.inline(b.headline)}</h1>
${b.subheadline ? `<div class="lead">${r.rich(b.subheadline)}</div>` : ''}
${buttons(r.button(b.primary, 'primary', 'primary'), r.button(b.secondary, 'secondary', 'secondary'))}
</div>`;
  const cls = `hero l-${layout}${b.flip ? ' flip' : ''}${backdrop ? ' has-img' : ''}${media ? '' : ' no-media'}`;
  return section(b, cls, `${backdrop}${wrap(`<div class="hero-grid">${text}${media}</div>`)}`, align);
}

function text(b: BlockOf<'text'>, r: R): string {
  return section(b, 'text', wrap(`${heading(r, b.heading)}<div class="prose">${r.rich(b.body)}</div>`, true));
}

function features(b: BlockOf<'features'>, r: R): string {
  const items = b.items
    .map((it) => {
      const ic = it.icon && isIconName(it.icon) ? `<div class="ico">${icon(it.icon, 22)}</div>` : '';
      const body = it.text ? `<p>${r.inline(it.text)}</p>` : '';
      return `<div class="card feature">${ic}<h3>${r.inline(it.title)}</h3>${body}</div>`;
    })
    .join('');
  return section(b, 'features', wrap(`${sectionHead(r, b.heading, b.intro)}<div class="grid cols-${b.columns}">${items}</div>`));
}

function checklist(b: BlockOf<'checklist'>, r: R): string {
  const items = b.items
    .map((t, i) => {
      const mark = b.style === 'check' ? icon('check', 15) : b.style === 'number' ? String(i + 1) : '•';
      return `<li><span class="mark">${mark}</span><span>${r.inline(t)}</span></li>`;
    })
    .join('');
  return section(b, 'checklist', wrap(`${sectionHead(r, b.heading, b.intro)}<ul class="checks">${items}</ul>`, true));
}

function stats(b: BlockOf<'stats'>, r: R): string {
  const items = b.items
    .map((s) => `<div class="stat"><div class="num">${r.inline(s.value)}</div><div class="lbl">${r.inline(s.label)}</div></div>`)
    .join('');
  return section(b, 'stats', wrap(`${sectionHead(r, b.heading)}<div class="stats">${items}</div>`));
}

function steps(b: BlockOf<'steps'>, r: R): string {
  const items = b.items
    .map((s) => `<li><div><h3>${r.inline(s.title)}</h3>${s.text ? `<p>${r.inline(s.text)}</p>` : ''}</div></li>`)
    .join('');
  return section(b, 'steps', wrap(`${sectionHead(r, b.heading, b.intro)}<ol class="steps">${items}</ol>`, true));
}

function testimonial(b: BlockOf<'testimonial'>, r: R): string {
  const av = r.img(b.avatar);
  const logo = r.img(b.logo);
  const who = [b.name, b.role, b.company].some(Boolean)
    ? `<div class="who${av ? '' : ' no-av'}">${av ? `<img class="av" src="${esc(av.src)}" alt="${esc(av.alt)}" loading="lazy">` : ''}<div><b>${r.inline(b.name)}</b><span>${[
        b.role,
        b.company,
      ]
        .filter(Boolean)
        .map((x) => r.inline(x))
        .join(', ')}</span></div></div>`
    : '';
  return section(
    b,
    'testimonial',
    wrap(
      `<figure class="quote" style="margin:0"><blockquote>${r.inline(b.quote)}</blockquote>${who}${logo ? `<img class="logo" src="${esc(logo.src)}" alt="${esc(logo.alt)}" loading="lazy">` : ''}</figure>`,
    ),
  );
}

function logos(b: BlockOf<'logos'>, r: R): string {
  const items = b.items
    .map((i) => r.img(i))
    .filter((i): i is { src: string; alt: string } => !!i)
    .map((i) => `<img src="${esc(i.src)}" alt="${esc(i.alt)}" loading="lazy">`)
    .join('');
  if (!items) return '';
  const head = b.heading ? `<div class="logos-head">${r.inline(b.heading)}</div>` : '';
  return section(b, 'logos', wrap(`${head}<div class="logos${b.grayscale ? ' gray' : ''}">${items}</div>`), undefined, 'sm');
}

function image(b: BlockOf<'image'>, r: R): string {
  const img = r.img(b.image);
  if (!img) return '';
  const cap = b.caption ? `<figcaption>${r.inline(b.caption)}</figcaption>` : '';
  return section(
    b,
    `image w-${b.width}`,
    wrap(`<figure class="figure"><img src="${esc(img.src)}" alt="${esc(img.alt)}" loading="lazy">${cap}</figure>`, b.width === 'content'),
  );
}

function split(b: BlockOf<'split'>, r: R): string {
  const img = r.img(b.image);
  const media = img ? `<div class="split-media"><img src="${esc(img.src)}" alt="${esc(img.alt)}" loading="lazy"></div>` : '';
  const eyebrow = b.eyebrow ? `<span class="eyebrow">${r.inline(b.eyebrow)}</span>` : '';
  const text = `<div class="split-text">${eyebrow}${heading(r, b.heading)}<div class="prose">${r.rich(b.body)}</div>${buttons(r.button(b.button, 'button', 'primary'))}</div>`;
  return section(
    b,
    `split${b.side === 'left' ? ' flip' : ''}${img ? '' : ' no-media'}`,
    wrap(`<div class="split-grid">${text}${media}</div>`),
    'left',
  );
}

function callout(b: BlockOf<'callout'>, r: R): string {
  const text = r.inline(b.text).trim();
  if (!text) return '';
  const eyebrow = b.eyebrow ? `<span class="eyebrow">${r.inline(b.eyebrow)}</span>` : '';
  const by = b.attribution ? `<div class="callout-by">${r.inline(b.attribution)}</div>` : '';
  return section(b, 'callout', wrap(`<div class="callout">${eyebrow}<p class="callout-text">${text}</p>${by}</div>`), 'center');
}

function table(b: BlockOf<'table'>, r: R): string {
  const rows = b.rows.filter((row) => row.some((c) => c.trim()));
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((row) => row.length));
  const cell = (c: string | undefined, tag: 'th' | 'td', scope?: string) =>
    `<${tag}${scope ? ` scope="${scope}"` : ''}>${r.inline(c ?? '')}</${tag}>`;
  const across = (row: string[], tag: (i: number) => 'th' | 'td', scope: (i: number) => string | undefined) =>
    `<tr>${Array.from({ length: cols }, (_, i) => cell(row[i], tag(i), scope(i))).join('')}</tr>`;
  const [first, ...rest] = rows;
  const head =
    b.header && first
      ? `<thead>${across(
          first,
          () => 'th',
          () => 'col',
        )}</thead>`
      : '';
  const body = (b.header ? rest : rows)
    .map((row) =>
      across(
        row,
        (i) => (i === 0 ? 'th' : 'td'),
        (i) => (i === 0 ? 'row' : undefined),
      ),
    )
    .join('');
  const label = esc(r.plain(b.heading) || 'Table');
  const cap = b.caption ? `<p class="table-cap">${r.inline(b.caption)}</p>` : '';
  return section(
    b,
    'table',
    wrap(
      `${sectionHead(r, b.heading, b.intro)}<div class="table-wrap" role="region" aria-label="${label}" tabindex="0"><table>${head}<tbody>${body}</tbody></table></div>${cap}`,
    ),
  );
}

function video(b: BlockOf<'video'>, r: R): string {
  const e = videoEmbed(r.url(b.url));
  if (!e) return '';
  const title = r.plain(b.heading) || 'Video';
  const cap = b.caption ? `<p class="intro" style="margin:1rem auto 0;text-align:center">${r.inline(b.caption)}</p>` : '';
  return section(
    b,
    'video',
    wrap(
      `${heading(r, b.heading)}<div class="video"><iframe src="${esc(e.src)}" title="${esc(title)}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture; clipboard-write" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>${cap}`,
      true,
    ),
  );
}

function cta(b: BlockOf<'cta'>, r: R): string {
  const inner = `<div class="cta-box"><h2>${r.inline(b.heading)}</h2>${b.text ? `<div class="lead">${r.rich(b.text)}</div>` : ''}${buttons(r.button(b.button, 'button', 'primary'), r.button(b.secondary, 'secondary', 'secondary'))}</div>`;
  return section(b, 'cta', wrap(inner), 'center');
}

function form(b: BlockOf<'form'>, r: R): string {
  const fields = b.fields
    .map((f) => {
      const id = esc(`f-${b.id}-${f.key}`);
      const label = r.inline(f.label);
      const req = f.required ? ' required' : '';
      const ph = f.placeholder ? ` placeholder="${esc(r.plain(f.placeholder))}"` : '';
      // a form box with nothing to prefill it with is simply empty, which is not a problem worth warning about
      const pre = f.prefill ? r.plain(f.prefill, { report: false }) : '';
      const val = pre ? ` value="${esc(pre)}"` : '';
      const name = `name="${esc(f.key)}"`;
      if (f.type === 'checkbox') {
        return `<div class="field check"><input type="checkbox" id="${id}" ${name} value="yes"${req}><label for="${id}">${label}</label></div>`;
      }
      let control: string;
      if (f.type === 'textarea') control = `<textarea id="${id}" ${name}${req}${ph}>${esc(pre)}</textarea>`;
      else if (f.type === 'select') {
        control = `<select id="${id}" ${name}${req}><option value="">Select…</option>${(f.options ?? []).map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
      } else
        control = `<input type="${f.type}" id="${id}" ${name}${req}${ph}${val} autocomplete="${f.type === 'email' ? 'email' : f.key === 'name' ? 'name' : 'off'}">`;
      return `<div class="field"><label for="${id}">${label}${f.required ? '' : ' <span style="font-weight:400;opacity:.6">(optional)</span>'}</label>${control}</div>`;
    })
    .join('');
  const inner = `<div class="form-card card">
${heading(r, b.heading)}${b.intro ? `<div class="intro" style="margin-bottom:1.4rem">${r.rich(b.intro)}</div>` : ''}
<form class="form" method="post" action="${esc(r.env.urls.submit)}" data-redirect="${b.redirect_url ? '1' : ''}">
<div class="fields"><input type="hidden" name="_block" value="${esc(b.id)}">
<div class="hp" aria-hidden="true"><label>Leave this empty<input name="_hp" tabindex="-1" autocomplete="off"></label></div>
${fields}
<p class="form-error" role="alert"></p>
<button class="btn btn-primary" type="submit">${r.inline(b.button_label)}</button></div>
<p class="form-msg ok" role="status">${r.inline(b.success_message)}</p>
</form></div>`;
  return section(b, 'form', wrap(inner), 'center');
}

function faq(b: BlockOf<'faq'>, r: R): string {
  const items = b.items
    .map((i) => `<details><summary>${r.inline(i.q)}${icon('plus', 20)}</summary><div class="ans">${r.rich(i.a)}</div></details>`)
    .join('');
  return section(b, 'faq', wrap(`${sectionHead(r, b.heading)}<div class="faq">${items}</div>`));
}

function calendar(b: BlockOf<'calendar'>, r: R): string {
  const raw = r.url(b.url);
  const e = calendarEmbed(b.url, r.env.ctx, r.env.host);
  const head = sectionHead(r, b.heading, b.intro);
  if (!e) {
    const link = safeUrl(raw);
    return link
      ? section(
          b,
          'calendar',
          wrap(`${head}<p><a class="btn btn-primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Book a time</a></p>`),
          'center',
        )
      : '';
  }
  return section(
    b,
    'calendar',
    wrap(
      `${head}<div class="embed"><iframe src="${esc(e.src)}" height="${b.height}" title="Book a meeting" loading="lazy"></iframe></div>`,
    ),
  );
}

function note(b: BlockOf<'note'>, r: R): string {
  const av = r.img(b.avatar);
  const name = r.inline(b.from_name);
  const initial = (r.plain(b.from_name).trim()[0] ?? '·').toUpperCase();
  const avatar = av
    ? `<img src="${esc(av.src)}" alt="${esc(av.alt || r.plain(b.from_name))}" loading="lazy">`
    : `<div class="av-fallback" aria-hidden="true">${esc(initial)}</div>`;
  return section(
    b,
    'note',
    wrap(
      `<div class="note"><div class="msg">${r.rich(b.message)}</div><div class="from">${avatar}<div><b>${name}</b>${b.from_role ? `<span>${r.inline(b.from_role)}</span>` : ''}</div></div></div>`,
    ),
  );
}

function documentBlock(b: BlockOf<'document'>, r: R): string {
  if (!r.env.hasDocument || !r.env.urls.pdf) return '';
  const preview = b.show_preview && r.env.urls.cover;
  const btn = `<a class="btn btn-primary" href="${esc(r.env.urls.pdf)}">${icon('download', 18)}${r.inline(b.button_label)}</a>`;
  const text = `<div>${heading(r, b.heading)}${b.text ? `<div class="lead">${r.rich(b.text)}</div>` : ''}${buttons(btn)}</div>`;
  const cover = preview ? `<div class="doc-cover"><img src="${esc(r.env.urls.cover!)}" alt="" loading="lazy"></div>` : '';
  return section(b, 'document', wrap(`<div class="doc${preview ? '' : ' no-preview'}">${cover}${text}</div>`));
}

const SANITIZE = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'img',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'span',
    'div',
    'small',
    'code',
    'pre',
    'figure',
    'figcaption',
    'iframe',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    iframe: ['src', 'width', 'height', 'title', 'allow', 'allowfullscreen', 'loading'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['https', 'http', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['https'], iframe: ['https'] },
  allowProtocolRelative: false,
  allowedIframeHostnames: [...FRAME_HOSTS],
  transformTags: {
    a: (_tag: string, attribs: Record<string, string>) => ({
      tagName: 'a',
      attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
    }),
  },
} as sanitizeHtml.IOptions;

function htmlBlock(b: BlockOf<'html'>, r: R): string {
  // Substitute (escaped) data FIRST, then sanitise the final markup, so a token can never smuggle a
  // javascript: URL or a tag past the allowlist.
  const merged = b.html.replace(/\{\{([\s\S]*?)\}\}/g, (m) => esc(r.plain(m)));
  const clean = sanitizeHtml(merged, SANITIZE);
  return clean.trim() ? section(b, 'custom-html', wrap(`<div class="custom-html">${clean}</div>`)) : '';
}

function divider(b: BlockOf<'divider'>): string {
  return `<div class="wrap" data-b="${esc(b.id)}"><hr class="divider"></div>`;
}

// ── Section wrapper ─────────────────────────────────────────────────────────

function section(b: Block, cls: string, inner: string, forceAlign?: 'left' | 'center', forcePad?: 'sm'): string {
  const align = b.align ?? forceAlign ?? 'left';
  const bg = b.bg && b.bg !== 'default' ? ` bg-${b.bg}` : '';
  const pad = b.pad ?? forcePad;
  // The section only carries `blk-<type>` plus modifiers. A bare `stats`, `steps`, `note`, `faq`… class would also match the
  // rules for the elements inside it and style the whole section as if it were one of them (hero is the exception: its
  // CSS hangs off `.hero` itself).
  const [type, ...mods] = cls.split(' ');
  const extra = type === 'hero' ? cls : mods.join(' ');
  return `<section class="blk blk-${type}${extra ? ` ${extra}` : ''}${bg}${pad ? ` pad-${pad}` : ''} align-${align}" id="${esc(blockAnchor(b))}" data-b="${esc(b.id)}">${inner}</section>`;
}

/** Sections that read as one run of content when they share a background, so the gap between them should not double up. */
const FLOWING = new Set<Block['type']>([
  'text',
  'split',
  'table',
  'features',
  'checklist',
  'steps',
  'stats',
  'faq',
  'logos',
  'image',
  'video',
  'html',
]);

/** True when `b` follows `prev` on the same background, with nobody having asked for particular spacing. */
export const joinsPrevious = (b: Block, prev: Block | undefined): boolean =>
  !!prev && FLOWING.has(b.type) && FLOWING.has(prev.type) && (b.bg ?? 'default') === (prev.bg ?? 'default') && !b.pad && !prev.pad;

const SECTION_OPEN = '<section class="blk ';

export function renderBlock(b: Block, r: R, opts: { join?: boolean } = {}): string {
  const html = renderBlockHtml(b, r);
  // every block is wrapped by section(), so the opening tag is always where we expect it
  return opts.join && html.startsWith(SECTION_OPEN) ? `${SECTION_OPEN}join ${html.slice(SECTION_OPEN.length)}` : html;
}

function renderBlockHtml(b: Block, r: R): string {
  switch (b.type) {
    case 'hero':
      return hero(b, r);
    case 'text':
      return text(b, r);
    case 'features':
      return features(b, r);
    case 'checklist':
      return checklist(b, r);
    case 'stats':
      return stats(b, r);
    case 'steps':
      return steps(b, r);
    case 'testimonial':
      return testimonial(b, r);
    case 'logos':
      return logos(b, r);
    case 'image':
      return image(b, r);
    case 'split':
      return split(b, r);
    case 'callout':
      return callout(b, r);
    case 'table':
      return table(b, r);
    case 'video':
      return video(b, r);
    case 'cta':
      return cta(b, r);
    case 'form':
      return form(b, r);
    case 'faq':
      return faq(b, r);
    case 'calendar':
      return calendar(b, r);
    case 'note':
      return note(b, r);
    case 'document':
      return documentBlock(b, r);
    case 'html':
      return htmlBlock(b, r);
    case 'divider':
      return divider(b);
  }
}
