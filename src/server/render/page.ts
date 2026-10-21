import { randomBytes } from 'node:crypto';
import { evalRule } from '@shared/conditions';
import type { Block, CampaignSettings, DocumentConfig, Page } from '@shared/schema';
import { escapeHtml as esc, safeUrl, type Ctx, type TokenResult } from '@shared/template';
import { blockAnchor, joinsPrevious, makeR, renderBlock, type RenderEnv } from './blocks';
import { BASE_CSS, themeCss } from './css';
import { fontFaceCss, fontsUsed, preloadPath } from './fonts';
import { FRAME_HOSTS } from './embeds';

export interface PageInput {
  campaign: { id: string; name: string; slug: string; page: Page; document: DocumentConfig | null; settings: CampaignSettings };
  ctx: Ctx;
  mode: 'live' | 'preview';
  /** Prospect token for personalised pages, null for the generic page. */
  token: string | null;
  /** Host the page is being served from (used as the Calendly embed domain). */
  host: string;
  /** Origin used for absolute URLs in social tags. */
  origin: string;
  urls: { pdf?: string; cover?: string; submit: string; beacon?: string };
  scripts?: { head: string; body_end: string };
}

export interface PageOutput {
  html: string;
  headers: Record<string, string>;
  tokens: RenderEnv['tokens'];
  blocks: string[];
}

/** Pure function: same input, same HTML. No I/O. */
export function renderPage(input: PageInput): PageOutput {
  const { campaign, ctx, mode } = input;
  const page = campaign.page;
  const nonce = randomBytes(16).toString('base64');

  const visible: Block[] = page.blocks.filter((b) => !b.hidden && evalRule(b.rule, ctx));
  const firstForm = visible.find((b) => b.type === 'form');

  const env: RenderEnv = {
    ctx,
    page,
    mode,
    token: input.token,
    campaignSlug: campaign.slug,
    host: input.host,
    urls: input.urls,
    hasDocument: !!campaign.document,
    formAnchor: firstForm ? blockAnchor(firstForm) : null,
    tokens: [],
  };

  const body = visible.map((b, i) => renderBlock(b, makeR(env, b.id), { join: joinsPrevious(b, visible[i - 1]) })).join('\n');
  const header = renderHeader(env, page);
  const footer = renderFooter(env, page);

  // ── <head> metadata ───────────────────────────────────────────────────────
  const meta = makeR(env, 'seo');
  const hero = visible.find((b) => b.type === 'hero');
  const title = meta.plain(page.seo.title) || (hero?.type === 'hero' ? meta.plain(hero.headline) : '') || campaign.name;
  const description = meta.plain(page.seo.description) || (hero?.type === 'hero' ? meta.plain(hero.subheadline) : '');
  const ogImage = meta.img(page.seo.og_image)?.src ?? (campaign.document && input.urls.cover ? input.urls.cover : '');
  const abs = (u: string) => (u.startsWith('/') ? input.origin + u : u);

  const headScripts = input.scripts?.head ?? '';
  const bodyScripts = input.scripts?.body_end ?? '';
  const hasCustomScripts = !!(headScripts.trim() || bodyScripts.trim());

  const fonts = fontsUsed(page.theme);
  const css = [
    ...fonts.map(fontFaceCss),
    themeCss(page.theme),
    BASE_CSS,
    mode === 'preview' ? PREVIEW_CSS : '',
    page.custom_css ? page.custom_css.replace(/<\/style/gi, '<\\/style') : '',
  ].join('\n');

  const favicon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${page.theme.brand}"/></svg>`)}`;

  const html = `<!doctype html>
<html lang="${esc(page.seo.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${page.seo.noindex || mode === 'preview' ? '<meta name="robots" content="noindex,nofollow,noarchive">' : ''}
<meta name="theme-color" content="${page.theme.brand}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
${description ? `<meta property="og:description" content="${esc(description)}">` : ''}
${ogImage ? `<meta property="og:image" content="${esc(abs(ogImage))}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="icon" href="${esc(favicon)}">
${fonts
  .map(preloadPath)
  .filter(Boolean)
  .map((href) => `<link rel="preload" href="${esc(href!)}" as="font" type="font/woff2" crossorigin>`)
  .join('\n')}
<style nonce="${nonce}">${css}</style>
${withNonce(headScripts, nonce)}
</head>
<body${input.urls.beacon && mode === 'live' ? ` data-t="${esc(input.urls.beacon)}"` : ''}>
${header}
<main>
${body}
</main>
${footer}
<script nonce="${nonce}">${PAGE_JS}${mode === 'preview' ? PREVIEW_JS : ''}</script>
${withNonce(bodyScripts, nonce)}
</body>
</html>`;

  const frames = FRAME_HOSTS.map((h) => `https://${h}`).join(' ');
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    'media-src https:',
    `frame-src ${frames}`,
    hasCustomScripts ? "connect-src 'self' https:" : "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    mode === 'preview' ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
  ].join('; ');

  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': csp,
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (page.seo.noindex || mode === 'preview') headers['X-Robots-Tag'] = 'noindex, nofollow, noarchive';

  return { html, headers, tokens: env.tokens, blocks: visible.map((b) => b.id) };
}

function renderHeader(env: RenderEnv, page: Page): string {
  if (!page.header.enabled) return '';
  const r = makeR(env, 'header');
  const logo = r.img(page.header.logo);
  const text = page.header.logo_text ? r.inline(page.header.logo_text) : '';
  if (!logo && !text && !page.header.button) return '';
  const brand = `<span class="brand">${logo ? `<img src="${esc(logo.src)}" alt="${esc(logo.alt || r.plain(page.header.logo_text))}">` : ''}${text && !logo ? text : ''}</span>`;
  return `<header class="site-header${page.header.sticky ? ' sticky' : ''}"><div class="wrap">${brand}${r.button(page.header.button, 'header', 'primary', 'sm')}</div></header>`;
}

function renderFooter(env: RenderEnv, page: Page): string {
  const r = makeR(env, 'footer');
  const text = r.rich(page.footer.text);
  const links = page.footer.links
    .map((l) => ({ label: r.inline(l.label), url: safeUrl(r.url(l.url)) }))
    .filter((l) => l.label && l.url)
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${l.label}</a>`)
    .join('');
  if (!text && !links) return '';
  return `<footer class="site-footer"><div class="wrap">${text ? `<div>${text}</div>` : '<span></span>'}${links ? `<nav>${links}</nav>` : ''}</div></footer>`;
}

/** Adds the page nonce to owner-supplied <script> tags so they run under our CSP. */
function withNonce(snippet: string, nonce: string): string {
  return snippet ? snippet.replace(/<script(?![^>]*\snonce=)/gi, `<script nonce="${nonce}"`) : '';
}

export interface TokenSummary {
  /** Fields that were empty and had no fallback — visible gaps in the page. */
  missing: string[];
  /** Fields that were empty but covered by a fallback. */
  fallbacks: string[];
}

export function summariseTokens(tokens: Array<TokenResult>): TokenSummary {
  const missing = new Set<string>();
  const fallbacks = new Set<string>();
  for (const t of tokens) {
    if (!t.missing) continue;
    if (t.usedFallback) fallbacks.add(t.field);
    else if (!t.hasFallback) missing.add(t.field);
  }
  return { missing: [...missing], fallbacks: [...fallbacks] };
}

// ── Client scripts ──────────────────────────────────────────────────────────

const PAGE_JS = `(function(){
var b=document.body,ep=b.getAttribute('data-t'),sid=Math.random().toString(36).slice(2,12);
function post(o){if(!ep)return;o.sid=sid;var s=JSON.stringify(o);
try{if(navigator.sendBeacon&&navigator.sendBeacon(ep,new Blob([s],{type:'application/json'})))return}catch(e){}
try{fetch(ep,{method:'POST',headers:{'content-type':'application/json'},body:s,keepalive:true})}catch(e){}}
var shown=0,last=document.visibilityState==='visible'?Date.now():0,maxScroll=0,inter=0,dirty=0,ref='';
try{ref=document.referrer?new URL(document.referrer).hostname:''}catch(e){}
function tick(){if(last){var n=Date.now();shown+=n-last;last=n}}
function pct(){var d=document.documentElement,h=d.scrollHeight-innerHeight;return h>0?Math.min(100,Math.round(scrollY/h*100)):100}
if(ep)post({type:'view',w:innerWidth,wd:navigator.webdriver?1:0,ref:ref});
['pointerdown','keydown','touchstart','wheel'].forEach(function(e){addEventListener(e,function(){inter=1},{passive:true,once:true})});
addEventListener('scroll',function(){inter=1;var p=pct();if(p>maxScroll){maxScroll=p;dirty=1}},{passive:true});
function flush(){tick();post({type:'engaged',s:Math.round(shown/1000),scroll:maxScroll,i:inter});dirty=0}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'){flush();last=0}else last=Date.now()});
addEventListener('pagehide',flush);
setInterval(function(){if(document.visibilityState==='visible'&&(dirty||inter))flush()},15000);
addEventListener('message',function(e){if(e.origin==='https://calendly.com'&&e.data&&e.data.event==='calendly.event_scheduled')post({type:'booked',p:'calendly'})});
document.querySelectorAll('form.form').forEach(function(f){
f.addEventListener('submit',function(e){
e.preventDefault();var err=f.querySelector('.form-error'),btn=f.querySelector('button[type=submit]'),d={};
new FormData(f).forEach(function(v,k){d[k]=v});
err.style.display='none';btn.disabled=true;
fetch(f.action,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(d)})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
.then(function(x){if(x.ok){f.classList.add('done');if(x.j&&x.j.redirect)location.href=x.j.redirect}
else{err.textContent=(x.j&&x.j.error&&x.j.error.message)||'Something went wrong. Please try again.';err.style.display='block'}})
.catch(function(){err.textContent='Network error. Please try again.';err.style.display='block'})
.then(function(){btn.disabled=false});
})});
})();`;

const PREVIEW_CSS = `[data-b]{cursor:pointer}[data-b]:hover{outline:2px solid rgba(99,102,241,.7);outline-offset:-2px}[data-b].mpl-sel{outline:3px solid #6366f1;outline-offset:-3px}`;

const PREVIEW_JS = `(function(){
function blk(t){return t&&t.closest?t.closest('[data-b]'):null}
document.addEventListener('click',function(e){var el=blk(e.target);if(e.target.closest&&e.target.closest('a,button,summary,iframe'))e.preventDefault();if(el)parent.postMessage({type:'mpl-select',id:el.getAttribute('data-b')},location.origin)},true);
document.addEventListener('submit',function(e){e.preventDefault();e.stopPropagation()},true);
addEventListener('message',function(e){if(e.origin!==location.origin)return;var d=e.data||{};
if(d.type==='mpl-highlight'){document.querySelectorAll('.mpl-sel').forEach(function(n){n.classList.remove('mpl-sel')});
var el=document.querySelector('[data-b="'+String(d.id).replace(/[^\\w-]/g,'')+'"]');if(el){el.classList.add('mpl-sel');if(d.scroll!==false){var r=el.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight)el.scrollIntoView({block:'center',behavior:'smooth'})}}}});
parent.postMessage({type:'mpl-ready'},location.origin);
})();`;
