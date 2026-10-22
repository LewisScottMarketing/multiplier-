import { describe, expect, it } from 'vitest';
import { analyseCss, colorsIn, fontChoiceFor, googleFontFamilies, pickColors, pickFonts, readPage } from '../../src/server/brand/site';

const PAGE = `<!doctype html><html lang="en"><head>
<title>Northwind Traders | Logistics software that just works</title>
<meta name="theme-color" content="#0b5fff">
<meta property="og:site_name" content="Northwind Traders">
<meta name="description" content="Move freight faster, with less paperwork.">
<meta property="og:image" content="/social.jpg">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="/assets/app.css">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { --brand-primary: #0b5fff; --gray: #64748b; }
  body { font-family: 'Inter', sans-serif; color: #0f172a; background: #ffffff; }
  h1, h2 { font-family: "Playfair Display", Georgia, serif; }
  .btn-primary { background: #0b5fff; color: #fff; }
  a { color: #0b5fff; }
  .cta-secondary { background: rgb(255, 107, 53); }
  .site-footer { background: #0b1020; color: #cbd5e1; }
  .site-footer .legal { background: #0b1020; }
</style></head>
<body>
<header><a href="/"><img class="site-logo" src="/img/northwind-logo.png" alt="Northwind" width="140"></a></header>
<h1>Move freight faster</h1><p>We help carriers and shippers talk to each other in plain language.</p>
<h2>Built for dispatchers</h2><script>var x = "ignore me";</script>
</body></html>`;

describe('colours in CSS', () => {
  it('reads hex, rgb and hsl, and skips what is mostly see-through', () => {
    expect(colorsIn('#0B5FFF')).toEqual(['#0b5fff']);
    expect(colorsIn('#fa0')).toEqual(['#ffaa00']);
    expect(colorsIn('rgb(255, 107, 53)')).toEqual(['#ff6b35']);
    expect(colorsIn('rgb(255 107 53 / 80%)')).toEqual(['#ff6b35']);
    expect(colorsIn('hsl(0, 100%, 50%)')).toEqual(['#ff0000']);
    expect(colorsIn('rgba(0,0,0,0.1)')).toEqual([]);
    expect(colorsIn('#0b5fff22')).toEqual([]);
    expect(colorsIn('1px solid #ddd, 0 0 4px rgba(11,95,255,.9)')).toEqual(['#dddddd', '#0b5fff']);
  });
});

describe('reading a page', () => {
  const page = readPage(PAGE, 'https://northwind.test/');

  it('finds the name, the description and the theme colour', () => {
    expect(page.name).toBe('Northwind Traders');
    expect(page.description).toBe('Move freight faster, with less paperwork.');
    expect(page.themeColor).toBe('#0b5fff');
  });

  it('finds the stylesheets and font links, with addresses made absolute', () => {
    expect(page.stylesheets).toEqual(['https://northwind.test/assets/app.css']);
    expect(googleFontFamilies(page.fontLinks)).toEqual(['Playfair Display', 'Inter']);
    expect(page.inlineCss).toHaveLength(1);
  });

  it('ranks the logo in the header first, then the touch icon, and says how many could not be used', () => {
    expect(page.logos.map((l) => [l.kind, l.url])).toEqual([
      ['logo-image', 'https://northwind.test/img/northwind-logo.png'],
      ['touch-icon', 'https://northwind.test/apple-touch-icon.png'],
      ['social-image', 'https://northwind.test/social.jpg'],
    ]);
    expect(page.unusableLogos).toBe(1); // the .ico
  });

  it('keeps the words people read, not the scripts', () => {
    expect(page.headings).toEqual(['Move freight faster', 'Built for dispatchers']);
    expect(page.text).toContain('We help carriers and shippers talk to each other in plain language.');
    expect(page.text).not.toContain('ignore me');
  });

  it('does not use an SVG logo, which cannot be stored safely', () => {
    const svg = readPage('<header><img class="logo" src="/logo.svg" alt="Logo"></header>', 'https://x.test/');
    expect(svg.logos).toEqual([]);
    expect(svg.unusableLogos).toBe(1);
  });

  it('falls back to the title, then the host, for a name', () => {
    expect(readPage('<title>Acme – Anvils for everyone</title>', 'https://acme.test/').name).toBe('Acme');
    expect(readPage('<p>hi</p>', 'https://www.acme.test/').name).toBe('acme.test');
  });
});

describe('picking the brand', () => {
  const css = analyseCss(
    readPage(PAGE, 'https://northwind.test/').inlineCss,
    googleFontFamilies(readPage(PAGE, 'https://northwind.test/').fontLinks),
  );

  it('takes the colour the site puts on its buttons and links as the brand, and a different hue as the accent', () => {
    const colors = pickColors(css, '#0b5fff');
    expect(colors).toMatchObject({ brand: '#0b5fff', accent: '#ff6b35', text: '#0f172a', dark: '#0b1020' });
    expect(colors.bg).toBeUndefined(); // plain white is where pages start from
  });

  it('records a coloured page background', () => {
    const cream = pickColors(analyseCss(['body{background:#fbf8f3;color:#211d18}.btn{background:#c2410c}']));
    expect(cream).toMatchObject({ brand: '#c2410c', bg: '#fbf8f3', text: '#211d18' });
  });

  it('copes with a site that is black and white, and says so', () => {
    const mono = pickColors(analyseCss(['body{color:#111111;background:#ffffff}a{color:#111}.btn{background:#222222;color:#fff}']));
    expect(mono.brand).toBe('#111111');
    expect(mono.notes.join(' ')).toMatch(/mostly black and white/);
  });

  it('gives the CSS variable named primary more say than a colour used once', () => {
    const colors = pickColors(analyseCss([':root{--color-primary:#7c3aed} .x{color:#16a34a}.y{color:#16a34a}.z{border-color:#16a34a}']));
    expect(colors.brand).toBe('#7c3aed');
    expect(colors.accent).toBe('#16a34a');
  });

  it('reads colours written in at-rules and ignores comments', () => {
    const colors = pickColors(analyseCss(['/* #ff0000 */ @media (min-width: 600px) { .btn { background: #0ea5e9 } }']));
    expect(colors.brand).toBe('#0ea5e9');
  });
});

describe('picking typefaces', () => {
  it('names the closest typefaces we can serve, and keeps the site’s own names', () => {
    const css = analyseCss(readPage(PAGE, 'https://northwind.test/').inlineCss);
    const fonts = pickFonts(css);
    expect(fonts).toMatchObject({ heading: 'fraunces', body: 'inter', names: 'Headings: Playfair Display; Body: Inter' });
    expect(fonts.notes[0]).toMatch(/closest ones were picked/);
  });

  it('maps common families', () => {
    expect(fontChoiceFor('Inter', 'body')).toBe('inter');
    expect(fontChoiceFor('Georgia', 'heading')).toBe('fraunces');
    expect(fontChoiceFor('Georgia', 'body')).toBe('serif');
    expect(fontChoiceFor('Montserrat', 'heading')).toBe('manrope');
    expect(fontChoiceFor('JetBrains Mono', 'body')).toBe('mono');
    expect(fontChoiceFor('Söhne', 'heading')).toBe('space-grotesk');
    expect(fontChoiceFor('Some Unheard-of Face', 'body')).toBe('inter');
  });

  it('says so when no typeface can be read', () => {
    expect(pickFonts(analyseCss(['.x{color:red}'])).notes).toEqual(['No typeface could be read from the site.']);
  });
});
