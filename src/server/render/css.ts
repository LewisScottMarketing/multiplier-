import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Theme } from '@shared/schema';

// ── Theme → CSS variables ───────────────────────────────────────────────────
// Every value interpolated here has been validated by the schema (hex colours / enums),
// so nothing user-controlled can break out of the declaration.

const FONT_STACKS: Record<string, string> = {
  inter: '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

const RADIUS = { sharp: ['4px', '4px'], soft: ['14px', '10px'], round: ['26px', '999px'] } as const;
const WIDTH = { narrow: '760px', normal: '1080px', wide: '1240px' } as const;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Readable text colour for a given background. */
export const inkFor = (bg: string): string => (luminance(bg) > 0.42 ? '#0b1020' : '#ffffff');

export function themeCss(t: Theme): string {
  const [radius, radiusBtn] = RADIUS[t.radius];
  const accent = t.accent ?? t.brand;
  return `:root{
--brand:${t.brand};--brand-ink:${inkFor(t.brand)};--accent:${accent};--accent-ink:${inkFor(accent)};
--bg:${t.bg};--alt:${t.alt_bg};--dark:${t.dark_bg};--text:${t.text};--muted:${t.muted};
--radius:${radius};--radius-btn:${radiusBtn};--maxw:${WIDTH[t.width]};
--font:${FONT_STACKS[t.font]};--font-head:${FONT_STACKS[t.heading_font ?? t.font]};
}`;
}

// ── Self-hosted Inter (no third-party font requests from prospects' browsers) ─

let interCss: string | null = null;
export function interFontFaceCss(): string {
  if (interCss !== null) return interCss;
  try {
    const pkg = createRequire(import.meta.url).resolve('@fontsource-variable/inter/package.json');
    const css = fs.readFileSync(path.join(path.dirname(pkg), 'wght.css'), 'utf8');
    interCss = css.replace(/url\(\.\/files\//g, 'url(/f/inter/files/');
  } catch {
    interCss = '';
  }
  return interCss;
}

export function interFontDir(): string | null {
  try {
    const pkg = createRequire(import.meta.url).resolve('@fontsource-variable/inter/package.json');
    return path.join(path.dirname(pkg), 'files');
  } catch {
    return null;
  }
}

// ── Base styles ─────────────────────────────────────────────────────────────

export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;font-family:var(--font);color:var(--text);background:var(--bg);font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img,svg,video,iframe{max-width:100%}
img{display:block;height:auto}
h1,h2,h3,h4{font-family:var(--font-head);line-height:1.14;letter-spacing:-.022em;margin:0 0 .45em;font-weight:700;text-wrap:balance}
h1{font-size:clamp(2.15rem,5.2vw,3.75rem);letter-spacing:-.03em}
h2{font-size:clamp(1.65rem,3.4vw,2.45rem)}
h3{font-size:1.15rem;letter-spacing:-.01em}
p{margin:0 0 1.05em}
ul,ol{margin:0 0 1.1em;padding-left:1.25em}
li{margin:.3em 0}
a{color:var(--brand)}
strong{font-weight:650}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px}
.narrow{max-width:760px}
.ic{flex:none}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* sections */
.blk{--card:#fff;--border:color-mix(in srgb,var(--text) 11%,transparent);--soft:color-mix(in srgb,var(--brand) 9%,var(--bg));padding:76px 0;position:relative}
.blk.pad-sm{padding:40px 0}.blk.pad-lg{padding:112px 0}
.bg-alt{background:var(--alt);--card:var(--bg)}
.bg-brand{background:var(--brand);--text:var(--brand-ink);--muted:color-mix(in srgb,var(--brand-ink) 82%,transparent);--card:color-mix(in srgb,var(--brand-ink) 12%,transparent);--border:color-mix(in srgb,var(--brand-ink) 28%,transparent);--soft:color-mix(in srgb,var(--brand-ink) 14%,transparent);color:var(--text)}
.bg-dark{background:var(--dark);--text:#eef0fb;--muted:#a8aed0;--card:rgba(255,255,255,.06);--border:rgba(255,255,255,.14);--soft:rgba(255,255,255,.08);color:var(--text)}
.bg-brand a:not(.btn),.bg-dark a:not(.btn){color:inherit}
.align-center{text-align:center}
.align-center .lead,.align-center .intro{margin-left:auto;margin-right:auto}
.lead{font-size:clamp(1.08rem,1.6vw,1.3rem);color:var(--muted);max-width:44rem}
.intro{color:var(--muted);max-width:42rem;margin-bottom:2rem}
.eyebrow{display:inline-block;font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;font-weight:650;color:var(--brand);margin-bottom:1rem}
.bg-brand .eyebrow,.bg-dark .eyebrow{color:var(--muted)}
.section-head{margin-bottom:2.2rem}
.section-head h2{margin-bottom:.3em}

/* header */
.site-header{background:var(--bg);border-bottom:1px solid color-mix(in srgb,var(--text) 9%,transparent)}
.site-header.sticky{position:sticky;top:0;z-index:30;backdrop-filter:saturate(1.4) blur(10px);background:color-mix(in srgb,var(--bg) 88%,transparent)}
.site-header .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:68px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.1rem;color:var(--text);text-decoration:none;letter-spacing:-.01em}
.brand img{max-height:34px;width:auto}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:.82em 1.45em;border-radius:var(--radius-btn);font:inherit;font-weight:620;font-size:1rem;line-height:1.2;text-decoration:none;cursor:pointer;border:1.5px solid transparent;transition:transform .12s,box-shadow .12s,background .12s;white-space:nowrap}
.btn:hover{transform:translateY(-1px)}
.btn:focus-visible{outline:3px solid color-mix(in srgb,var(--brand) 40%,transparent);outline-offset:2px}
.btn-primary{background:var(--brand);color:var(--brand-ink);box-shadow:0 1px 0 rgba(255,255,255,.18) inset,0 8px 20px -8px color-mix(in srgb,var(--brand) 70%,transparent)}
.btn-secondary{background:transparent;color:var(--text);border-color:color-mix(in srgb,var(--text) 22%,transparent)}
.btn-secondary:hover{background:color-mix(in srgb,var(--text) 6%,transparent)}
.bg-brand .btn-primary{background:var(--brand-ink);color:var(--brand);box-shadow:none}
.bg-brand .btn-secondary{color:var(--brand-ink);border-color:color-mix(in srgb,var(--brand-ink) 45%,transparent)}
.bg-dark .btn-primary{background:var(--brand);color:var(--brand-ink)}
.btn-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:1.6rem}
.align-center .btn-row{justify-content:center}
.btn-sm{padding:.55em 1.1em;font-size:.92rem}

/* hero */
.hero .badge{display:inline-flex;align-items:center;gap:8px;background:var(--soft);color:var(--brand);border-radius:999px;padding:.38em .95em;font-size:.88rem;font-weight:600;margin-bottom:1.4rem}
.bg-brand .hero .badge,.bg-dark .hero .badge{color:var(--text)}
.hero-grid{display:grid;grid-template-columns:1.08fr .92fr;gap:56px;align-items:center}
.hero.align-center .hero-grid{grid-template-columns:1fr;text-align:center}
.hero-media img{width:100%;border-radius:var(--radius);box-shadow:0 30px 60px -20px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06)}
.hero-media.doc img{max-height:560px;width:auto;margin:0 auto;border-radius:6px;transform:rotate(1.2deg)}
.hero.align-center .hero-media{margin-top:2.5rem}
.hero.align-center .hero-media img{margin:0 auto;max-width:880px}

/* cards & grids */
.grid{display:grid;gap:22px}
.cols-2{grid-template-columns:repeat(2,1fr)}.cols-3{grid-template-columns:repeat(3,1fr)}.cols-4{grid-template-columns:repeat(4,1fr)}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:26px}
.feature .ico{width:46px;height:46px;border-radius:calc(var(--radius) * .75);background:var(--soft);color:var(--brand);display:grid;place-items:center;margin-bottom:16px}
.bg-brand .feature .ico,.bg-dark .feature .ico{color:var(--text)}
.feature h3{margin-bottom:.35em}
.feature p{margin:0;color:var(--muted);font-size:.98rem}

/* lists */
.checks{list-style:none;padding:0;display:grid;gap:12px;max-width:44rem}
.align-center .checks{margin-left:auto;margin-right:auto;text-align:left}
.checks li{display:flex;gap:12px;align-items:flex-start;margin:0}
.checks .mark{flex:none;width:26px;height:26px;border-radius:50%;background:var(--soft);color:var(--brand);display:grid;place-items:center;font-size:.8rem;font-weight:700;margin-top:.1em}
.bg-brand .checks .mark,.bg-dark .checks .mark{color:var(--text)}

/* stats */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:28px}
.stat .num{font-family:var(--font-head);font-size:clamp(2.4rem,5vw,3.6rem);font-weight:760;letter-spacing:-.035em;line-height:1;color:var(--brand)}
.bg-brand .stat .num,.bg-dark .stat .num{color:var(--text)}
.stat .lbl{color:var(--muted);margin-top:.5rem;font-size:.98rem}

/* steps */
.steps{list-style:none;padding:0;margin:0;display:grid;gap:26px;counter-reset:s}
.steps li{display:grid;grid-template-columns:52px 1fr;gap:18px;margin:0;counter-increment:s}
.steps li::before{content:counter(s);width:44px;height:44px;border-radius:50%;background:var(--brand);color:var(--brand-ink);display:grid;place-items:center;font-weight:700;font-family:var(--font-head)}
.bg-brand .steps li::before{background:var(--brand-ink);color:var(--brand)}
.steps h3{margin:.15em 0 .2em}.steps p{margin:0;color:var(--muted)}

/* testimonial */
.quote{max-width:50rem;margin:0 auto;text-align:center}
.quote blockquote{margin:0 0 1.6rem;font-family:var(--font-head);font-size:clamp(1.3rem,2.6vw,1.85rem);line-height:1.38;letter-spacing:-.015em;font-weight:560}
.quote .who{display:inline-flex;align-items:center;gap:14px;text-align:left}
.quote .who img.av{width:52px;height:52px;border-radius:50%;object-fit:cover}
.quote .who b{display:block}.quote .who span{color:var(--muted);font-size:.94rem}
.quote img.logo{max-height:30px;width:auto;margin:1.4rem auto 0;opacity:.85}

/* logos */
.logos{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:26px 46px}
.logos img{max-height:34px;width:auto;max-width:150px;object-fit:contain}
.logos.gray img{filter:grayscale(1);opacity:.6}
.logos-head{text-align:center;color:var(--muted);font-size:.92rem;margin-bottom:1.6rem;letter-spacing:.02em}

/* media */
.figure{margin:0}.figure img{width:100%;border-radius:var(--radius)}
.figure figcaption{color:var(--muted);font-size:.92rem;margin-top:.8rem;text-align:center}
.w-wide .wrap{max-width:1240px}.w-full .wrap{max-width:none;padding:0}.w-full .figure img{border-radius:0}
.video{position:relative;aspect-ratio:16/9;border-radius:var(--radius);overflow:hidden;background:#000;box-shadow:0 24px 50px -24px rgba(0,0,0,.5)}
.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.embed{border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:#fff}
.embed iframe{width:100%;border:0;display:block}

/* CTA */
.cta-box{background:var(--brand);color:var(--brand-ink);border-radius:calc(var(--radius) * 1.6);padding:clamp(34px,6vw,64px);text-align:center;--text:var(--brand-ink);--muted:color-mix(in srgb,var(--brand-ink) 82%,transparent)}
.cta-box .lead{margin-left:auto;margin-right:auto;color:var(--muted)}
.cta-box .btn-primary{background:var(--brand-ink);color:var(--brand);box-shadow:none}
.cta-box .btn-secondary{color:var(--brand-ink);border-color:color-mix(in srgb,var(--brand-ink) 45%,transparent)}
.cta-box .btn-row{justify-content:center}

/* form */
.form-card{max-width:620px;margin:0 auto}
.align-left .form-card{margin-left:0}
.field{margin-bottom:16px}
.field label{display:block;font-weight:600;font-size:.93rem;margin-bottom:6px}
.field input,.field textarea,.field select{width:100%;font:inherit;color:var(--text);background:var(--bg);border:1.5px solid color-mix(in srgb,var(--text) 18%,transparent);border-radius:calc(var(--radius) * .7);padding:.78em .95em}
.bg-dark .field input,.bg-dark .field textarea,.bg-dark .field select{background:rgba(255,255,255,.07)}
.field textarea{min-height:110px;resize:vertical}
.field input:focus,.field textarea:focus,.field select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 4px color-mix(in srgb,var(--brand) 20%,transparent)}
.field.check{display:flex;gap:10px;align-items:flex-start}.field.check input{width:auto;margin-top:.35em}.field.check label{margin:0;font-weight:500}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.form-msg{display:none;padding:16px 18px;border-radius:calc(var(--radius) * .7);background:var(--soft);font-weight:550}
.form-msg.err{background:#fee2e2;color:#7f1d1d}
.form.done .fields{display:none}.form.done .form-msg.ok{display:block}
.form-error{color:#b91c1c;font-size:.9rem;margin:-6px 0 12px;display:none}

/* faq */
.faq{max-width:50rem;margin:0 auto}
.faq details{border-bottom:1px solid var(--border);padding:4px 0}
.faq summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:16px;font-weight:620;padding:16px 0;font-size:1.05rem}
.faq summary::-webkit-details-marker{display:none}
.faq summary .ic{transition:transform .18s;color:var(--muted)}
.faq details[open] summary .ic{transform:rotate(45deg)}
.faq .ans{color:var(--muted);padding:0 0 18px}

/* note */
.note{max-width:680px;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius) * 1.3);padding:clamp(24px,4vw,40px);box-shadow:0 18px 40px -24px rgba(15,23,42,.3)}
.note .msg{font-size:1.1rem}
.note .from{display:flex;align-items:center;gap:14px;margin-top:1.4rem;padding-top:1.3rem;border-top:1px solid var(--border)}
.note .from img{width:54px;height:54px;border-radius:50%;object-fit:cover}
.note .from b{display:block}.note .from span{color:var(--muted);font-size:.93rem}
.note .av-fallback{width:54px;height:54px;border-radius:50%;background:var(--soft);color:var(--brand);display:grid;place-items:center;font-weight:700;font-size:1.2rem}

/* document */
.doc{display:grid;grid-template-columns:.8fr 1.2fr;gap:56px;align-items:center}
.doc.no-preview{grid-template-columns:1fr;text-align:center}
.doc-cover img{width:100%;max-width:360px;margin:0 auto;border-radius:6px;box-shadow:0 30px 60px -22px rgba(15,23,42,.45),0 0 0 1px rgba(15,23,42,.08);transform:rotate(-1.5deg)}

.divider{border:0;border-top:1px solid color-mix(in srgb,var(--text) 12%,transparent);margin:0}
.custom-html img{border-radius:var(--radius)}
.custom-html table{border-collapse:collapse;width:100%}.custom-html td,.custom-html th{border:1px solid var(--border);padding:.6em .8em;text-align:left}

/* footer */
.site-footer{padding:44px 0;border-top:1px solid color-mix(in srgb,var(--text) 9%,transparent);color:var(--muted);font-size:.9rem}
.site-footer .wrap{display:flex;flex-wrap:wrap;gap:12px 28px;justify-content:space-between;align-items:center}
.site-footer a{color:inherit}.site-footer nav{display:flex;gap:20px;flex-wrap:wrap}
.site-footer p{margin:0}

@media (max-width:860px){
  body{font-size:16.5px}
  .blk{padding:56px 0}.blk.pad-lg{padding:72px 0}
  .hero-grid,.doc{grid-template-columns:1fr;gap:36px}
  .cols-3,.cols-4{grid-template-columns:repeat(2,1fr)}
  .hero-media.doc img{transform:none}
}
@media (max-width:560px){
  .wrap{padding:0 18px}
  .cols-2,.cols-3,.cols-4{grid-template-columns:1fr}
  .btn{width:100%}.btn-row{flex-direction:column}.site-header .btn{width:auto}
  .steps li{grid-template-columns:44px 1fr;gap:14px}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.btn,.faq summary .ic{transition:none}}
@media print{.site-header .btn,.btn-row,.form,.embed,.video{display:none!important}.blk{padding:28px 0;break-inside:avoid}}
`;
