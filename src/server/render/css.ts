import { inkFor, isDark, readableOn, shiftHue } from '@shared/color';
import type { Theme } from '@shared/schema';
import { FONTS } from './fonts';

export { inkFor };

// ── Theme → CSS variables ───────────────────────────────────────────────────
// Every value interpolated here has been validated by the schema (hex colours / enums),
// so nothing user-controlled can break out of the declaration.

const RADIUS = { sharp: ['4px', '4px'], soft: ['14px', '10px'], round: ['26px', '999px'] } as const;
const WIDTH = { narrow: '760px', normal: '1080px', wide: '1240px' } as const;
const HEADING_WEIGHT = { medium: 560, semibold: 640, bold: 700, extrabold: 800 } as const;
const DENSITY = { compact: '56px', comfortable: '76px', spacious: '104px' } as const;

export function themeCss(t: Theme): string {
  const [radius, radiusBtn] = RADIUS[t.radius];
  const accent = t.accent ?? t.brand;
  const dark = isDark(t.bg);
  const heading = FONTS[t.heading_font ?? t.font];

  // flat colour, or a soft diagonal blend towards the accent (or a nearby hue when there isn't one)
  const gradientEnd = accent === t.brand ? shiftHue(t.brand, 32) : accent;
  const brandBg = t.gradient ? `linear-gradient(135deg,${t.brand} 0%,${gradientEnd} 100%)` : t.brand;
  const brandInk = inkFor(...(t.gradient ? [t.brand, gradientEnd] : [t.brand]));
  const darkBg = t.gradient
    ? `radial-gradient(900px 440px at 10% -12%,color-mix(in srgb,${t.brand} 44%,transparent),transparent 62%),radial-gradient(720px 400px at 100% 112%,color-mix(in srgb,${accent} 30%,transparent),transparent 60%),${t.dark_bg}`
    : t.dark_bg;

  // cards: fills are chosen here, per page, because they depend on whether the page itself is dark
  const flat = t.cards === 'flat';
  const cardFill = flat ? 'color-mix(in srgb,var(--text) 5%,var(--bg))' : dark ? 'color-mix(in srgb,#ffffff 6%,var(--bg))' : '#ffffff';
  const cardFillAlt = flat
    ? 'color-mix(in srgb,var(--text) 5%,var(--alt))'
    : dark
      ? 'color-mix(in srgb,#ffffff 6%,var(--alt))'
      : 'var(--bg)';
  const cardShadow =
    t.cards === 'raised'
      ? dark
        ? '0 18px 40px -22px rgba(0,0,0,.75)'
        : '0 1px 2px rgba(15,23,42,.06),0 22px 40px -26px rgba(15,23,42,.38)'
      : 'none';

  return `:root{
--brand:${t.brand};--brand-ink:${brandInk};--brand-text:${readableOn(t.brand, [t.bg, t.alt_bg])};--accent:${accent};--accent-ink:${inkFor(accent)};
--bg:${t.bg};--alt:${t.alt_bg};--dark:${t.dark_bg};--text:${t.text};--muted:${t.muted};
--radius:${radius};--radius-btn:${radiusBtn};--maxw:${WIDTH[t.width]};
--font:${FONTS[t.font].stack};--font-head:${heading.stack};--hw:${HEADING_WEIGHT[t.heading_weight]};--track:${heading.track};
--pad:${DENSITY[t.density]};
--brand-bg:${brandBg};--dark-bg:${darkBg};
--line:color-mix(in srgb,var(--text) ${dark ? 16 : 11}%,transparent);--ring:${dark ? 'rgba(255,255,255,.14)' : 'rgba(15,23,42,.06)'};
--card-fill:${cardFill};--card-fill-alt:${cardFillAlt};--card-shadow:${cardShadow};--note-shadow:${t.cards === 'outlined' ? '0 18px 40px -24px rgba(15,23,42,.3)' : cardShadow};${t.cards === 'outlined' ? '' : '--card-line:transparent;'}
color-scheme:${dark ? 'dark' : 'light'};
}`;
}

// ── Base styles ─────────────────────────────────────────────────────────────

export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;font-family:var(--font);color:var(--text);background:var(--bg);font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
::selection{background:color-mix(in srgb,var(--brand) 28%,transparent)}
img,svg,video,iframe{max-width:100%}
img{display:block;height:auto}
h1,h2,h3,h4{font-family:var(--font-head);line-height:1.14;letter-spacing:var(--track);margin:0 0 .45em;font-weight:var(--hw);text-wrap:balance}
h1{font-size:clamp(2.15rem,5.2vw,3.75rem);letter-spacing:calc(var(--track) * 1.35)}
h2{font-size:clamp(1.65rem,3.4vw,2.45rem)}
h3{font-size:1.15rem;letter-spacing:calc(var(--track) * .45)}
p{margin:0 0 1.05em}
ul,ol{margin:0 0 1.1em;padding-left:1.25em}
li{margin:.3em 0}
a{color:var(--brand-text)}
strong{font-weight:650}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px}
.col-narrow{max-width:760px}
.align-center .col-narrow{margin-left:auto;margin-right:auto}
.ic{flex:none}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* sections */
.blk{--sec:var(--bg);--card:var(--card-fill);--border:var(--line);--soft:color-mix(in srgb,var(--brand) 9%,var(--bg));padding:var(--pad) 0;position:relative;scroll-margin-top:72px}
.blk.pad-sm{padding:calc(var(--pad) * .52) 0}.blk.pad-lg{padding:calc(var(--pad) * 1.45) 0}
.blk.join{padding-top:0}
.bg-alt{--sec:var(--alt);background:var(--alt);--card:var(--card-fill-alt);--soft:color-mix(in srgb,var(--brand) 9%,var(--alt))}
.bg-brand{background:var(--brand-bg);--text:var(--brand-ink);--muted:color-mix(in srgb,var(--brand-ink) 82%,transparent);--card:color-mix(in srgb,var(--brand-ink) 12%,transparent);--border:color-mix(in srgb,var(--brand-ink) 28%,transparent);--soft:color-mix(in srgb,var(--brand-ink) 14%,transparent);color:var(--text)}
.bg-dark{background:var(--dark-bg);--text:#eef0fb;--muted:#a8aed0;--card:rgba(255,255,255,.06);--border:rgba(255,255,255,.14);--soft:rgba(255,255,255,.08);color:var(--text)}
.bg-brand a:not(.btn),.bg-dark a:not(.btn){color:inherit}
.bg-brand,.bg-dark{--ring:rgba(255,255,255,.3)}
.align-center{text-align:center}
.align-center .lead,.align-center .intro{margin-left:auto;margin-right:auto}
.lead{font-size:clamp(1.08rem,1.6vw,1.3rem);color:var(--muted);max-width:44rem}
.intro{color:var(--muted);max-width:42rem;margin-bottom:2rem}
.eyebrow{display:inline-block;font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;font-weight:650;color:var(--brand-text);margin-bottom:1rem}
.bg-brand .eyebrow,.bg-dark .eyebrow{color:var(--muted)}
.section-head{margin-bottom:2.2rem}
.section-head h2{margin-bottom:.3em}

/* header */
.site-header{background:var(--bg);border-bottom:1px solid var(--line)}
.site-header.sticky{position:sticky;top:0;z-index:30;backdrop-filter:saturate(1.4) blur(10px);background:color-mix(in srgb,var(--bg) 88%,transparent)}
.site-header .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:68px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.1rem;color:var(--text);text-decoration:none;letter-spacing:-.01em}
.brand img{max-height:34px;width:auto}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:.82em 1.45em;border-radius:var(--radius-btn);font:inherit;font-weight:620;font-size:1rem;line-height:1.2;text-decoration:none;cursor:pointer;border:1.5px solid transparent;transition:transform .12s,box-shadow .12s,background .12s;white-space:nowrap}
.btn:hover{transform:translateY(-1px)}
.btn:focus-visible{outline:3px solid color-mix(in srgb,var(--brand) 40%,transparent);outline-offset:2px}
.btn-primary{background:var(--brand-bg);color:var(--brand-ink);box-shadow:0 1px 0 rgba(255,255,255,.18) inset,0 8px 20px -8px color-mix(in srgb,var(--brand) 70%,transparent)}
.btn-secondary{background:transparent;color:var(--text);border-color:color-mix(in srgb,var(--text) 22%,transparent)}
.btn-secondary:hover{background:color-mix(in srgb,var(--text) 6%,transparent)}
.bg-brand .btn-primary{background:var(--brand-ink);color:var(--brand);box-shadow:none}
.bg-brand .btn-secondary{color:var(--brand-ink);border-color:color-mix(in srgb,var(--brand-ink) 45%,transparent)}
.bg-dark .btn-primary{background:var(--brand-bg);color:var(--brand-ink)}
.btn-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:1.6rem}
.align-center .btn-row{justify-content:center}
.btn-sm{padding:.55em 1.1em;font-size:.92rem}

/* hero */
.hero{overflow:hidden}
.hero .badge{display:inline-flex;align-items:center;gap:8px;background:var(--soft);color:var(--brand-text);border-radius:999px;padding:.38em .95em;font-size:.88rem;font-weight:600;margin-bottom:1.4rem}
.bg-brand .badge,.bg-dark .badge{color:var(--text)}
.hero-grid{display:grid;grid-template-columns:1.08fr .92fr;gap:56px;align-items:center}
.hero.flip .hero-media{order:-1}
.hero.align-center .hero-grid,.hero.l-centered .hero-grid,.hero.l-spotlight .hero-grid,.hero.l-minimal .hero-grid,.hero.l-cover .hero-grid{grid-template-columns:1fr}
.hero.no-media .hero-grid{grid-template-columns:minmax(0,54rem)}
.hero.no-media.align-center .hero-grid{margin:0 auto;grid-template-columns:minmax(0,56rem)}
.hero.align-center .hero-grid{text-align:center}
.hero.align-center .hero-media,.hero.l-spotlight .hero-media{margin-top:2.5rem}

/* the picture beside or under the headline */
.hero-media .mi{display:block;position:relative}
.hero-media img{width:100%;border-radius:var(--radius);box-shadow:0 30px 60px -20px rgba(15,23,42,.35),0 0 0 1px var(--ring)}
.bg-brand .hero-media img,.bg-dark .hero-media img{box-shadow:0 36px 70px -24px rgba(0,0,0,.6),0 0 0 1px var(--ring)}
.hero-media.is-cover .mi{width:fit-content;max-width:100%;margin:0 auto}
.hero-media.is-cover img{max-height:560px;width:auto;border-radius:6px}
.hero.align-center .hero-media .mi,.hero.l-spotlight .hero-media .mi{max-width:880px;margin-left:auto;margin-right:auto}
.hero.align-center .hero-media.is-cover .mi,.hero.l-spotlight .hero-media.is-cover .mi{width:fit-content}
.m-tilt .mi{transform:rotate(1.2deg)}
.m-bare img{box-shadow:none;border-radius:0;background:none}
.m-stack .mi::before,.m-stack .mi::after{content:"";position:absolute;inset:0;border-radius:6px;background:#fff;box-shadow:0 18px 40px -20px rgba(15,23,42,.4),0 0 0 1px var(--ring)}
.m-stack .mi::before{transform:rotate(-4.5deg) translate(-16px,6px)}
.m-stack .mi::after{transform:rotate(3.5deg) translate(14px,4px)}
.m-stack img{position:relative;z-index:1}
.m-frame .mi{border-radius:calc(var(--radius) * .85);overflow:hidden;background:var(--card-fill);border:1px solid var(--line);box-shadow:0 36px 70px -30px rgba(15,23,42,.45)}
.m-frame img{border-radius:0;box-shadow:none}
.m-frame.is-cover img{margin:0 auto}
.fbar{display:flex;gap:7px;padding:12px 14px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--text) 4%,var(--bg))}
.fbar i{width:10px;height:10px;border-radius:50%;background:color-mix(in srgb,var(--text) 24%,transparent)}

/* hero layouts */
.hero.l-minimal{padding:calc(var(--pad) * 1.5) 0}
.hero.l-minimal h1{font-size:clamp(2.6rem,7.2vw,5.2rem);line-height:1.03;letter-spacing:calc(var(--track) * 1.6)}
.hero.l-minimal .lead{font-size:clamp(1.15rem,2vw,1.5rem);max-width:40rem}
.hero.l-minimal .hero-media{display:none}
.hero.l-spotlight{padding-top:calc(var(--pad) * 1.2)}
.hero.l-spotlight::before{content:"";position:absolute;left:50%;top:-26%;width:min(1240px,160%);height:86%;transform:translateX(-50%);background:radial-gradient(closest-side,color-mix(in srgb,var(--brand) 52%,transparent),transparent);opacity:.62;pointer-events:none}
.hero.l-spotlight .wrap{position:relative}
.hero.l-cover{min-height:min(76vh,700px);display:flex;align-items:center;padding:calc(var(--pad) * 1.5) 0;background:var(--brand-bg);--text:var(--brand-ink);--muted:color-mix(in srgb,var(--brand-ink) 82%,transparent);--soft:color-mix(in srgb,var(--brand-ink) 14%,transparent);--border:color-mix(in srgb,var(--brand-ink) 28%,transparent);color:var(--text)}
.hero.l-cover .hero-bg{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;z-index:0}
.hero.l-cover.has-img::after{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(90deg,rgba(6,10,26,.8) 0%,rgba(6,10,26,.5) 55%,rgba(6,10,26,.25) 100%)}
.hero.l-cover.align-center.has-img::after{background:rgba(6,10,26,.58)}
.hero.l-cover .wrap{position:relative;z-index:2;width:100%}
.hero.l-cover .hero-grid{grid-template-columns:minmax(0,680px)}
.hero.l-cover.align-center .hero-grid{margin:0 auto}
.hero.l-cover .badge{background:var(--soft);color:var(--text)}
.hero.l-cover .eyebrow{color:var(--muted)}
.hero.l-cover .btn-primary{background:var(--brand-ink);color:var(--brand);box-shadow:none}
.hero.l-cover .btn-secondary{color:var(--brand-ink);border-color:color-mix(in srgb,var(--brand-ink) 45%,transparent)}
/* over a picture the type is always white, on a dark wash */
.hero.l-cover.has-img{--text:#fff;--muted:rgba(255,255,255,.86);--soft:rgba(255,255,255,.16);--border:rgba(255,255,255,.3)}
.hero.l-cover.has-img .badge{background:rgba(255,255,255,.16);color:#fff;backdrop-filter:blur(6px)}
.hero.l-cover.has-img .eyebrow{color:rgba(255,255,255,.8)}
.hero.l-cover.has-img .btn-primary{background:#fff;color:#0b1020}
.hero.l-cover.has-img .btn-secondary{color:#fff;border-color:rgba(255,255,255,.55)}
.hero.l-cover.has-img .btn-secondary:hover{background:rgba(255,255,255,.12)}
.hero.l-cover .hero-media{display:none}

/* cards & grids */
.grid{display:grid;gap:22px}
.cols-2{grid-template-columns:repeat(2,1fr)}.cols-3{grid-template-columns:repeat(3,1fr)}.cols-4{grid-template-columns:repeat(4,1fr)}
.card{background:var(--card);border:1px solid var(--card-line,var(--border));box-shadow:var(--card-shadow);border-radius:var(--radius);padding:26px}
.bg-brand .card,.bg-dark .card{box-shadow:none}
.feature .ico{width:46px;height:46px;border-radius:calc(var(--radius) * .75);background:var(--soft);color:var(--brand-text);display:grid;place-items:center;margin-bottom:16px}
.bg-brand .feature .ico,.bg-dark .feature .ico{color:var(--text)}
.feature h3{margin-bottom:.35em}
.feature p{margin:0;color:var(--muted);font-size:.98rem}

/* lists */
.checks{list-style:none;padding:0;display:grid;gap:12px;max-width:44rem}
.align-center .checks{margin-left:auto;margin-right:auto;text-align:left}
.checks li{display:flex;gap:12px;align-items:flex-start;margin:0}
.checks .mark{flex:none;width:26px;height:26px;border-radius:50%;background:var(--soft);color:var(--brand-text);display:grid;place-items:center;font-size:.8rem;font-weight:700;margin-top:.1em}
.bg-brand .checks .mark,.bg-dark .checks .mark{color:var(--text)}

/* stats */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:28px}
.stat .num{font-family:var(--font-head);font-size:clamp(2.4rem,5vw,3.6rem);font-weight:calc(var(--hw) + 60);letter-spacing:-.035em;line-height:1;color:var(--brand-text)}
.bg-brand .stat .num,.bg-dark .stat .num{color:var(--text)}
.stat .lbl{color:var(--muted);margin-top:.5rem;font-size:.98rem}

/* steps */
.steps{list-style:none;padding:0;margin:0;display:grid;gap:26px;counter-reset:s}
.steps li{display:grid;grid-template-columns:52px 1fr;gap:18px;margin:0;counter-increment:s}
.steps li::before{content:counter(s);width:44px;height:44px;border-radius:50%;background:var(--brand-bg);color:var(--brand-ink);display:grid;place-items:center;font-weight:700;font-family:var(--font-head)}
.bg-brand .steps li::before{background:var(--brand-ink);color:var(--brand)}
.steps h3{margin:.15em 0 .2em}.steps p{margin:0;color:var(--muted)}

/* testimonial */
.quote{max-width:50rem;margin:0 auto;text-align:center}
.quote blockquote{margin:0 0 1.6rem;font-family:var(--font-head);font-size:clamp(1.3rem,2.6vw,1.85rem);line-height:1.38;letter-spacing:calc(var(--track) * .7);font-weight:calc(var(--hw) - 140)}
.quote .who{display:inline-flex;align-items:center;gap:14px;text-align:left}
.quote .who img.av{width:52px;height:52px;border-radius:50%;object-fit:cover}
.quote .who.no-av{text-align:center}
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
.cta-box{background:var(--brand-bg);color:var(--brand-ink);border-radius:calc(var(--radius) * 1.6);padding:clamp(34px,6vw,64px);text-align:center;--text:var(--brand-ink);--muted:color-mix(in srgb,var(--brand-ink) 82%,transparent)}
.cta-box .lead{margin-left:auto;margin-right:auto;color:var(--muted)}
.cta-box .btn-primary{background:var(--brand-ink);color:var(--brand);box-shadow:none}
.cta-box .btn-secondary{color:var(--brand-ink);border-color:color-mix(in srgb,var(--brand-ink) 45%,transparent)}
.cta-box .btn-row{justify-content:center}
.bg-brand .cta-box{background:none;border-radius:0;padding:0}

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
.faq{max-width:50rem}
.align-center .faq{margin:0 auto}
.faq details{border-bottom:1px solid var(--border);padding:4px 0}
.faq summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:16px;font-weight:620;padding:16px 0;font-size:1.05rem}
.faq summary::-webkit-details-marker{display:none}
.faq summary .ic{transition:transform .18s;color:var(--muted)}
.faq details[open] summary .ic{transform:rotate(45deg)}
.faq .ans{color:var(--muted);padding:0 0 18px}

/* note */
.note{max-width:680px;margin:0 auto;background:var(--card);border:1px solid var(--card-line,var(--border));border-radius:calc(var(--radius) * 1.3);padding:clamp(24px,4vw,40px);box-shadow:var(--note-shadow)}
.note .msg{font-size:1.1rem}
.note .from{display:flex;align-items:center;gap:14px;margin-top:1.4rem;padding-top:1.3rem;border-top:1px solid var(--border)}
.note .from img{width:54px;height:54px;border-radius:50%;object-fit:cover}
.note .from b{display:block}.note .from span{color:var(--muted);font-size:.93rem}
.note .av-fallback{width:54px;height:54px;border-radius:50%;background:var(--soft);color:var(--brand-text);display:grid;place-items:center;font-weight:700;font-size:1.2rem}

/* document */
.doc{display:grid;grid-template-columns:.8fr 1.2fr;gap:56px;align-items:center}
.doc.no-preview{grid-template-columns:1fr;text-align:center}
.doc-cover img{width:100%;max-width:360px;margin:0 auto;border-radius:6px;box-shadow:0 30px 60px -22px rgba(15,23,42,.45),0 0 0 1px var(--ring);transform:rotate(-1.5deg)}

.divider{border:0;border-top:1px solid var(--line);margin:0}
.custom-html img{border-radius:var(--radius)}
.custom-html table{border-collapse:collapse;width:100%}.custom-html td,.custom-html th{border:1px solid var(--border);padding:.6em .8em;text-align:left}

/* footer */
.site-footer{padding:44px 0;border-top:1px solid var(--line);color:var(--muted);font-size:.9rem}
.site-footer .wrap{display:flex;flex-wrap:wrap;gap:12px 28px;justify-content:space-between;align-items:center}
.site-footer a{color:inherit}.site-footer nav{display:flex;gap:20px;flex-wrap:wrap}
.site-footer p{margin:0}

@media (max-width:860px){
  body{font-size:16.5px}
  .blk{padding:calc(var(--pad) * .74) 0}.blk.pad-lg{padding:calc(var(--pad) * .95) 0}.blk.pad-sm{padding:calc(var(--pad) * .42) 0}
  .hero-grid,.doc{grid-template-columns:1fr;gap:36px}
  .hero.flip .hero-media{order:0}
  .cols-3,.cols-4{grid-template-columns:repeat(2,1fr)}
  .m-tilt .mi{transform:none}
  .m-stack .mi::before{transform:rotate(-3deg) translate(-8px,4px)}.m-stack .mi::after{transform:rotate(2.5deg) translate(8px,3px)}
  .hero.l-cover{min-height:0}
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
