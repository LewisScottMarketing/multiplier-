import { describe, expect, it } from 'vitest';
import { newBlock } from '../../src/shared/blocks';
import { buildContext } from '../../src/shared/derive';
import { CampaignSettingsSchema, PageSchema, type Page } from '../../src/shared/schema';
import { renderPage, summariseTokens } from '../../src/server/render/page';
import { renderInline, renderRich } from '../../src/server/render/rich';

const settings = CampaignSettingsSchema.parse({});

function render(page: Page, data: Record<string, unknown> = {}, opts: { token?: string | null; document?: boolean; mode?: 'live' | 'preview' } = {}) {
  return renderPage({
    campaign: { id: 'cmp_1', name: 'Camp', slug: 'camp', page, document: opts.document ? ({ asset_id: 'ast_x', page_count: 1, filename: 'x.pdf', fields: [] } as never) : null, settings },
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
    const html = renderInline('a 0 b', { first_name: 'X' });
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
      blocks: [newBlock('hero', { headline: '{{company}}', badge: '{{company}}' }), newBlock('features', { items: [{ icon: 'zap', title: '{{company}}', text: '{{company}}' }] }), newBlock('form')],
    });
    const { html } = render(page, { company: evil, first_name: evil, email: evil });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toMatch(/value="[^"]*"><script/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('shows persona-specific blocks only to the matching segment', () => {
    const page = pageWith(
      newBlock('text', { id: 'a', body: 'MARKETING ONLY', rule: { match: 'all', conditions: [{ field: 'department', op: 'equals', value: 'marketing' }] } }),
      newBlock('text', { id: 'b', body: 'SALES ONLY', rule: { match: 'all', conditions: [{ field: 'department', op: 'equals', value: 'sales' }] } }),
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
    const page = pageWith(newBlock('hero', { primary: { label: 'Form', action: { type: 'form' } }, secondary: { label: 'PDF', action: { type: 'document' } } }));
    const html = render(page, {}).html;
    expect(html).not.toContain('>Form<');
    expect(html).not.toContain('>PDF<');
  });

  it('wires "form" and "document" buttons when targets exist', () => {
    const page = pageWith(newBlock('hero', { primary: { label: 'Form', action: { type: 'form' } }, secondary: { label: 'PDF', action: { type: 'document' } } }), newBlock('form', { id: 'f1' }));
    const html = render(page, {}, { document: true }).html;
    expect(html).toContain('href="#f1"');
    expect(html).toContain('href="/p/tok1234567.pdf"');
  });

  it('sanitises custom HTML after merging data', () => {
    const page = pageWith(newBlock('html', { html: '<p onclick="x()">Hi {{name}}</p><script>alert(1)</script><a href="{{site}}">go</a><iframe src="https://evil.com/x"></iframe><iframe src="https://player.vimeo.com/video/1"></iframe>' }));
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
    const cal = render(pageWith(newBlock('calendar', { url: 'https://calendly.com/acme/intro' })), { full_name: 'Jane Doe', email: 'j@acme.com', first_name: 'Jane', last_name: 'Doe' });
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
    const page = PageSchema.parse({ seo: { title: 'Plan for {{company}}', description: 'Prepared for {{first_name}}' }, blocks: [newBlock('text')] });
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
