import { describe, expect, it } from 'vitest';
import { newBlock } from '../../src/shared/blocks';
import { buildContext } from '../../src/shared/derive';
import { CampaignSettingsSchema, PageSchema, type Page } from '../../src/shared/schema';
import { renderPage, summariseTokens } from '../../src/server/render/page';
import { renderInline, renderRich } from '../../src/server/render/rich';

const settings = CampaignSettingsSchema.parse({});

function render(
  page: Page,
  data: Record<string, unknown> = {},
  opts: { token?: string | null; document?: boolean; mode?: 'live' | 'preview' } = {},
) {
  return renderPage({
    campaign: {
      id: 'cmp_1',
      name: 'Camp',
      slug: 'camp',
      page,
      document: opts.document ? ({ asset_id: 'ast_x', page_count: 1, filename: 'x.pdf', fields: [] } as never) : null,
      settings,
    },
    ctx: buildContext(data),
    mode: opts.mode ?? 'live',
    token: opts.token === undefined ? 'tok1234567' : opts.token,
    host: 'go.test',
    origin: 'https://go.test',
    urls: { pdf: '/p/tok1234567.pdf', cover: '/p/tok1234567/cover.png', submit: '/p/tok1234567/submit', beacon: '/t/tok1234567' },
  });
}

const pageWith = (...blocks: ReturnType<typeof newBlock>[]) => PageSchema.parse({ blocks, header: { enabled: false } });

describe('rich text', () => {
  it('renders paragraphs, bold, italic, lists and links', () => {
    const html = renderRich('Hello **bold** and *it*.\n\n- one\n- two\n\n[Site](https://acme.com)', {});
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<a href="https://acme.com" rel="noopener noreferrer" target="_blank">Site</a>');
  });

  it('treats prospect data as text, never as markup or markdown', () => {
    const html = renderRich('Welcome, {{name}}!', { name: '**<img src=x onerror=alert(1)>** [x](javascript:alert(1))' });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<a ');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('lets a token sit inside markdown emphasis', () => {
    expect(renderRich('**{{company}}** rocks', { company: 'Acme' })).toContain('<strong>Acme</strong>');
  });

  it('does not double the full stop after a company name that ends in one', () => {
    const data = { company: 'Northwind Traders, Inc.' };
    expect(renderRich('I looked at {{company}}. Have a skim.', data)).toBe('<p>I looked at Northwind Traders, Inc. Have a skim.</p>');
    expect(renderInline('Prepared for {{company}}.', data)).toBe('Prepared for Northwind Traders, Inc.');
    expect(renderRich('{{company}}...', data)).toBe('<p>Northwind Traders, Inc....</p>');
  });

  it('drops links whose destination is unsafe, keeping the label', () => {
    const html = renderRich('[click](javascript:alert(1))', {});
    expect(html).not.toContain('href');
    expect(html).toContain('click');
  });

  it('encodes tokens placed inside a link URL', () => {
    const html = renderRich('[Book](https://cal.com/x?name={{n}})', { n: 'Jane & Co' });
    expect(html).toContain('href="https://cal.com/x?name=Jane%20%26%20Co"');
  });

  it('cannot be fooled by forged placeholder characters in the template', () => {
    const html = renderInline(`a ${String.fromCharCode(0xe000)}0${String.fromCharCode(0xe001)} b`, { first_name: 'X' });
    expect(html).not.toContain('X');
  });
});

describe('renderPage', () => {
  it('personalises text with fallbacks', () => {
    const page = pageWith(newBlock('hero', { headline: 'Hello {{first_name|friend}} from {{company|nowhere}}', badge: undefined }));
    expect(render(page, { first_name: 'Jane', company: 'Acme' }).html).toContain('Hello Jane from Acme');
    expect(render(page, {}).html).toContain('Hello friend from nowhere');
  });

  it('escapes hostile data everywhere it can land', () => {
    const evil = '"><script>alert(1)</script>';
    const page = PageSchema.parse({
      seo: { title: 'Page for {{company}}', description: 'About {{company}}' },
      footer: { text: 'For {{company}}' },
      blocks: [
        newBlock('hero', { headline: '{{company}}', badge: '{{company}}' }),
        newBlock('features', { items: [{ icon: 'zap', title: '{{company}}', text: '{{company}}' }] }),
        newBlock('form'),
      ],
    });
    const { html } = render(page, { company: evil, first_name: evil, email: evil });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toMatch(/value="[^"]*"><script/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('shows persona-specific blocks only to the matching segment', () => {
    const page = pageWith(
      newBlock('text', {
        id: 'a',
        body: 'MARKETING ONLY',
        rule: { match: 'all', conditions: [{ field: 'department', op: 'equals', value: 'marketing' }] },
      }),
      newBlock('text', {
        id: 'b',
        body: 'SALES ONLY',
        rule: { match: 'all', conditions: [{ field: 'department', op: 'equals', value: 'sales' }] },
      }),
      newBlock('text', { id: 'c', body: 'EVERYONE' }),
    );
    const m = render(page, { job_title: 'VP of Marketing' });
    expect(m.html).toContain('MARKETING ONLY');
    expect(m.html).not.toContain('SALES ONLY');
    expect(m.html).toContain('EVERYONE');
    expect(m.blocks).toEqual(['a', 'c']);
    expect(render(page, { job_title: 'Account Executive' }).blocks).toEqual(['b', 'c']);
    expect(render(page, {}).blocks).toEqual(['c']);
  });

  it('does not count an unfilled form box as an empty field', () => {
    const out = render(pageWith(newBlock('form')), {});
    expect(summariseTokens(out.tokens).missing).toEqual([]);
    expect(out.html).toContain('name="email"');
  });

  it('skips hidden blocks', () => {
    const page = pageWith(newBlock('text', { id: 'h', body: 'SECRET', hidden: true }), newBlock('text', { id: 'v', body: 'VISIBLE' }));
    const { html } = render(page);
    expect(html).not.toContain('SECRET');
    expect(html).toContain('VISIBLE');
  });

  it('routes link buttons through the tracked redirect for stored prospects, and direct otherwise', () => {
    const page = pageWith(newBlock('cta', { id: 'cta1', button: { label: 'Go', action: { type: 'link', url: 'https://cal.com/me' } } }));
    expect(render(page, {}, { token: 'tok1234567' }).html).toContain('href="/r/tok1234567/cta1.button"');
    expect(render(page, {}, { token: null }).html).toContain('href="https://cal.com/me"');
    expect(render(page, {}, { token: 'tok1234567', mode: 'preview' }).html).toContain('href="https://cal.com/me"');
  });

  it('never emits a javascript: link, even from a token', () => {
    const page = pageWith(newBlock('cta', { id: 'c', button: { label: 'Go', action: { type: 'link', url: '{{website}}' } } }));
    const { html } = render(page, { website: 'javascript:alert(1)' });
    expect(html).not.toContain('javascript:');
  });

  it('omits buttons that would go nowhere', () => {
    const page = pageWith(
      newBlock('hero', { primary: { label: 'Form', action: { type: 'form' } }, secondary: { label: 'PDF', action: { type: 'document' } } }),
    );
    const html = render(page, {}).html;
    expect(html).not.toContain('>Form<');
    expect(html).not.toContain('>PDF<');
  });

  it('wires "form" and "document" buttons when targets exist', () => {
    const page = pageWith(
      newBlock('hero', { primary: { label: 'Form', action: { type: 'form' } }, secondary: { label: 'PDF', action: { type: 'document' } } }),
      newBlock('form', { id: 'f1' }),
    );
    const html = render(page, {}, { document: true }).html;
    expect(html).toContain('href="#f1"');
    expect(html).toContain('href="/p/tok1234567.pdf"');
  });

  it('sanitises custom HTML after merging data', () => {
    const page = pageWith(
      newBlock('html', {
        html: '<p onclick="x()">Hi {{name}}</p><script>alert(1)</script><a href="{{site}}">go</a><iframe src="https://evil.com/x"></iframe><iframe src="https://player.vimeo.com/video/1"></iframe>',
      }),
    );
    const { html } = render(page, { name: '<img src=x onerror=alert(1)>', site: 'javascript:alert(1)' });
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toMatch(/<img[^>]*onerror/i); // the text survives only as escaped content
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('evil.com');
    expect(html).toContain('player.vimeo.com/video/1');
  });

  it('only embeds allowlisted video and calendar providers', () => {
    const ok = render(pageWith(newBlock('video', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })));
    expect(ok.html).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    const bad = render(pageWith(newBlock('video', { url: 'https://evil.com/video.mp4' })));
    expect(bad.html).not.toContain('evil.com');
    const cal = render(pageWith(newBlock('calendar', { url: 'https://calendly.com/acme/intro' })), {
      full_name: 'Jane Doe',
      email: 'j@acme.com',
      first_name: 'Jane',
      last_name: 'Doe',
    });
    expect(cal.html).toContain('calendly.com/acme/intro?');
    expect(cal.html).toContain('name=Jane+Doe');
  });

  it('sets a strict CSP with a per-response nonce, and noindex by default', () => {
    const a = render(pageWith(newBlock('text')));
    const b = render(pageWith(newBlock('text')));
    const csp = a.headers['Content-Security-Policy'];
    expect(csp).toMatch(/script-src 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
    expect(directive('script-src')).not.toContain('unsafe-inline');
    expect(directive('style-src')).not.toContain('unsafe-inline');
    expect(a.headers['X-Robots-Tag']).toContain('noindex');
    expect(a.html).toContain('<meta name="robots"');
    const nonce = (h: string) => h.match(/nonce-([^']+)'/)![1];
    expect(nonce(a.headers['Content-Security-Policy'])).not.toBe(nonce(b.headers['Content-Security-Policy']));
    expect(a.html).toContain(`nonce="${nonce(csp)}"`);
  });

  it('adds the tracking beacon only for live prospect pages', () => {
    const page = pageWith(newBlock('text'));
    expect(render(page, {}, { token: 'tok1234567' }).html).toContain('data-t="/t/tok1234567"');
    expect(render(page, {}, { mode: 'preview' }).html).not.toContain('data-t=');
  });

  it('reports which fields were missing with no fallback', () => {
    const page = pageWith(newBlock('text', { body: 'Hi {{first_name}} at {{company|your team}} ({{job_title}})' }));
    const out = render(page, { first_name: 'Jane' });
    expect(summariseTokens(out.tokens)).toEqual({ missing: ['job_title'], fallbacks: ['company'] });
  });

  it('puts personalised values in the page title and social tags', () => {
    const page = PageSchema.parse({
      seo: { title: 'Plan for {{company}}', description: 'Prepared for {{first_name}}' },
      blocks: [newBlock('text')],
    });
    const { html } = render(page, { company: 'Acme', first_name: 'Jane' });
    expect(html).toContain('<title>Plan for Acme</title>');
    expect(html).toContain('og:title" content="Plan for Acme"');
    expect(html).toContain('content="Prepared for Jane"');
  });

  it('keeps theme values inside CSS declarations (no breakout via colours)', () => {
    expect(() => PageSchema.parse({ theme: { brand: 'red;}</style><script>alert(1)</script>' } })).toThrow();
    expect(() => PageSchema.parse({ theme: { brand: '#12345' } })).toThrow();
    expect(PageSchema.parse({ theme: { brand: '#112233' } }).theme.brand).toBe('#112233');
  });

  it('escapes </style> in custom CSS so it cannot close the style element', () => {
    const page = PageSchema.parse({ blocks: [newBlock('text')], custom_css: 'a{color:red}</style><script>alert(1)</script>' });
    expect(render(page).html).not.toContain('</style><script>alert(1)');
  });
});

describe('how sections sit together', () => {
  const classes = (html: string, id: string) => html.match(new RegExp(`<section class="([^"]*)" id="[^"]*" data-b="${id}"`))?.[1] ?? '';

  it('runs content sections together when they share a background, so the gap does not double up', () => {
    const html = render(
      pageWith(
        newBlock('hero', { id: 'h' }),
        newBlock('text', { id: 'a' }),
        newBlock('text', { id: 'b' }),
        newBlock('text', { id: 'c', bg: 'alt' }),
        newBlock('features', { id: 'd', bg: 'alt' }),
        newBlock('cta', { id: 'e', bg: 'alt' }),
        newBlock('text', { id: 'f', bg: 'alt' }),
        newBlock('text', { id: 'g', bg: 'alt', pad: 'lg' }),
      ),
    ).html;
    const joined = (id: string) => classes(html, id).split(' ').includes('join');
    expect(joined('h')).toBe(false); // nothing before it
    expect(joined('a')).toBe(false); // follows a hero
    expect(joined('b')).toBe(true); // same background as the text above
    expect(joined('c')).toBe(false); // the background changes
    expect(joined('d')).toBe(true);
    expect(joined('e')).toBe(false); // a banner is its own thing
    expect(joined('f')).toBe(false); // follows one
    expect(joined('g')).toBe(false); // asked for particular spacing
  });

  it('only counts the blocks a prospect can actually see', () => {
    const hidden = newBlock('text', {
      id: 'mid',
      bg: 'alt',
      rule: { match: 'all', conditions: [{ field: 'department', op: 'equals', value: 'sales' }] },
    });
    const html = render(pageWith(newBlock('text', { id: 'x' }), hidden, newBlock('text', { id: 'y' })), {
      job_title: 'Marketing Manager',
    }).html;
    expect(html).not.toContain('data-b="mid"');
    expect(classes(html, 'y').split(' ')).toContain('join');
  });

  it('keeps each section’s own class only, so one block’s styles never leak onto another', () => {
    const html = render(pageWith(newBlock('stats', { id: 's' }), newBlock('steps', { id: 'p' }), newBlock('note', { id: 'n' }))).html;
    expect(classes(html, 's')).toMatch(/^blk blk-stats\b/);
    expect(classes(html, 's').split(' ')).not.toContain('stats');
    expect(classes(html, 'p').split(' ')).not.toContain('steps');
    expect(classes(html, 'n').split(' ')).not.toContain('note');
  });

  it('centres a testimonial’s attribution only when there is no photo beside it', () => {
    const bare = render(pageWith(newBlock('testimonial', { id: 't' }))).html;
    expect(bare).toContain('class="who no-av"');
    const withPhoto = render(pageWith(newBlock('testimonial', { id: 't', avatar: { src: 'ast_abc123', alt: '' } }))).html;
    expect(withPhoto).toContain('class="who"');
  });
});

describe('the first screen', () => {
  // the stylesheet names every class too, so look at the page's markup only
  const heroHtml = (hero: Record<string, unknown>, opts: Parameters<typeof render>[2] = {}) =>
    render(pageWith(newBlock('hero', { id: 'h', ...hero } as never)), {}, opts).html.replace(/<style[\s\S]*?<\/style>/g, '');

  it('has a layout for each kind of hero, and says when there is no picture', () => {
    for (const layout of ['split', 'centered', 'cover', 'minimal', 'spotlight']) {
      expect(heroHtml({ layout })).toContain(`l-${layout}`);
    }
    expect(heroHtml({ layout: 'split' })).toContain('no-media');
    expect(heroHtml({ layout: 'split', image: { src: 'ast_abc123', alt: 'x' } })).not.toContain('no-media');
  });

  it('dresses the picture as asked, or sensibly when left on automatic', () => {
    const img = { image: { src: 'ast_abc123', alt: 'x' } };
    expect(heroHtml({ layout: 'split', ...img })).toContain('m-flat');
    expect(heroHtml({ layout: 'spotlight', ...img })).toContain('m-frame');
    expect(heroHtml({ layout: 'spotlight', ...img })).toContain('class="fbar"');
    expect(heroHtml({ layout: 'split', media: 'stack', ...img })).toContain('m-stack');
    expect(heroHtml({ layout: 'split', media: 'bare', ...img })).toContain('m-bare');
    // a PDF cover leans like a page on a desk
    expect(heroHtml({ layout: 'split', show_document: true }, { document: true })).toContain('m-tilt');
  });

  it('paints a cover picture behind the text, and uses the author’s picture rather than the PDF for it', () => {
    const html = heroHtml({ layout: 'cover', show_document: true, image: { src: 'ast_abc123', alt: '' } }, { document: true });
    expect(html).toContain('class="hero-bg"');
    expect(html).toContain('has-img');
    expect(html).toContain('/a/ast_abc123');
    expect(html).not.toContain('class="hero-media');
    // with no picture it falls back to the brand colour rather than leaving a hole
    expect(heroHtml({ layout: 'cover' })).not.toContain('hero-bg');
  });

  it('flips a split hero when asked, and ignores that for the other layouts', () => {
    expect(heroHtml({ layout: 'split', flip: true })).toContain(' flip');
    expect(heroHtml({ layout: 'split' })).not.toContain(' flip');
  });

  it('keeps a picture that is not on our server or an https address out of the page', () => {
    expect(heroHtml({ layout: 'split', image: { src: 'http://evil.test/x.png', alt: '' } })).not.toContain('evil.test');
    expect(heroHtml({ layout: 'split', image: { src: 'javascript:alert(1)', alt: '' } })).not.toContain('javascript:');
  });
});
