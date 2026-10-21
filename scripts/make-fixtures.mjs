// Builds the PDF fixtures used by the tests and the demo seed. Uses Chromium (playwright-core) so the
// files look like real-world exports (embedded subset fonts, vector bullets, header/footer templates).
//   node scripts/make-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { chromium } from 'playwright-core';

const out = path.resolve('tests/fixtures');
fs.mkdirSync(out, { recursive: true });

const chart = (() => {
  const c = createCanvas(640, 360);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 640, 360);
  grad.addColorStop(0, '#6366f1');
  grad.addColorStop(1, '#06b6d4');
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 360);
  g.fillStyle = 'rgba(255,255,255,.85)';
  [60, 120, 90, 180, 240, 300].forEach((h, i) => g.fillRect(40 + i * 95, 340 - h, 60, h));
  return c.toBuffer('image/png').toString('base64');
})();

const BASE = `@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:#0f172a}.page{width:210mm;height:297mm;page-break-after:always;position:relative;overflow:hidden}.inner{padding:22mm 22mm 26mm}`;

// ── 1. Playbook: indigo cover, stats row, vector bullets, quote, numbered steps, CTA box ─────────────
const playbook = `<style>${BASE}
.cover{background:#4f46e5;color:#fff;padding:28mm 22mm}.cover small{letter-spacing:.2em;text-transform:uppercase;opacity:.85;font-size:11pt}
.cover h1{font-size:46pt;line-height:1.05;margin:14mm 0 6mm;font-weight:800}.cover p.sub{font-size:15pt;max-width:130mm;color:#fff;opacity:.92}
.cover .prep{position:absolute;bottom:28mm;left:22mm;font-size:13pt}
h2{font-size:24pt;margin:0 0 4mm;color:#312e81}p{font-size:11.5pt;line-height:1.55;color:#334155}ul{font-size:11.5pt;line-height:1.7;color:#334155;padding-left:6mm}
.stats{display:flex;gap:10mm;margin:8mm 0}.stat b{display:block;font-size:34pt;color:#4f46e5}.stat span{font-size:10.5pt;color:#64748b}
blockquote{border-left:3px solid #4f46e5;margin:8mm 0;padding:2mm 6mm;font-size:14pt;font-style:italic;color:#1e293b}
.cta{background:#eef2ff;border-radius:6mm;padding:10mm;margin-top:10mm}</style>
<div class="page cover"><small>Acme Growth Labs</small><h1>The 2026 Outbound Pipeline Playbook</h1><p class="sub">How high-growth B2B teams turn cold outreach into booked meetings, without sounding like everyone else.</p>
<div class="prep">Prepared for [Company Name]<br>Attn: {{first_name}} {{last_name}}</div></div>
<div class="page inner"><h2>Why personalisation wins</h2><p>Generic outreach is ignored. Buyers receive dozens of near-identical emails a week, so relevance is the only filter that still works. Teams that reference the buyer's company, role and context see dramatically higher reply rates.</p>
<div class="stats"><div class="stat"><b>3.4x</b><span>more replies than generic sequences</span></div><div class="stat"><b>47%</b><span>shorter sales cycles</span></div><div class="stat"><b>$1.2M</b><span>pipeline created per rep</span></div></div>
<img src="data:image/png;base64,${chart}" width="420" style="border-radius:8px"><h2 style="margin-top:10mm">What the best teams do</h2>
<ul><li>Lead with a specific insight about the prospect's business</li><li>Match the message to the buyer's seniority and department</li><li>Give prospects a page that speaks to them, not a brochure</li><li>Follow up based on what they actually looked at</li></ul>
<blockquote>“We stopped sending PDFs and started sending pages that felt written for each buyer. Meetings doubled in a quarter.”<br><small>— Jordan Lee, VP Sales, Northwind</small></blockquote></div>
<div class="page inner"><h2>How it works</h2><p><b>1. Capture.</b> Pull accounts and contacts into your enrichment tool.</p><p><b>2. Personalise.</b> Merge name, company and job title into every asset.</p><p><b>3. Send.</b> Drop a unique link into your sequence.</p><p><b>4. Follow up.</b> Trigger the next step when they engage.</p>
<div class="cta"><h2 style="margin:0">Ready to talk?</h2><p>Book a 20-minute walkthrough at <a href="mailto:hello@acmegrowth.com">hello@acmegrowth.com</a> or visit <a href="https://acmegrowth.com/demo">acmegrowth.com/demo</a></p></div></div>`;

// ── 2. Case study: dark cover, bold-lead feature bullets with real "•" text, link, footer with © and page numbers ──
const caseStudy = `<style>${BASE}
.cover{background:#0b1220;color:#e2e8f0;padding:30mm 22mm}.cover .logo{font-weight:800;letter-spacing:.3em;font-size:12pt;color:#2dd4bf}
.cover h1{font-size:40pt;line-height:1.1;margin:40mm 0 8mm;font-weight:800;color:#fff}.cover p{font-size:16pt;color:#94a3b8;max-width:120mm}
.cover .tag{position:absolute;bottom:26mm;left:22mm;font-size:11pt;color:#64748b}
h2{font-size:20pt;margin:9mm 0 3mm;color:#0f766e}p{font-size:11pt;line-height:1.6;color:#334155}
.feat{list-style:none;padding:0;margin:0}.feat li{font-size:11pt;line-height:1.55;color:#334155;padding-left:6mm;position:relative;margin:2.5mm 0}.feat li::before{content:'•';position:absolute;left:0;color:#0f766e;font-weight:700}
.res{display:flex;gap:14mm;margin:6mm 0}.res div b{display:block;font-size:30pt;color:#0f766e}.res div span{font-size:10pt;color:#64748b}
blockquote{margin:8mm 0;padding:0;font-size:13pt;font-style:italic;color:#0f172a}blockquote cite{display:block;font-size:10.5pt;margin-top:2mm;color:#64748b;font-style:normal}
a{color:#0f766e}</style>
<div class="page cover"><div class="logo">NORTHWIND</div><h1>How Globex cut onboarding time by 63%</h1><p>A customer story from Northwind Systems</p><div class="tag">Customer story · 2026</div></div>
<div class="page inner"><h2>The challenge</h2><p>Globex was onboarding 400 new customers a quarter with a team of six. Every account needed a custom setup call, a data migration and a week of hand-holding, and the backlog kept growing.</p>
<h2>The solution</h2><ul class="feat"><li><b>Guided setup.</b> A self-serve wizard replaced the first two calls for 80% of accounts.</li><li><b>One-click migration.</b> Customers import their data from a spreadsheet or their old tool in minutes.</li><li><b>Success playbooks.</b> Automated check-ins nudge the accounts that stall before they churn.</li></ul>
<h2>The results</h2><div class="res"><div><b>63%</b><span>faster onboarding</span></div><div><b>2.1x</b><span>accounts per CSM</span></div><div><b>94%</b><span>satisfaction score</span></div></div>
<blockquote>“We went from drowning in setup calls to onboarding customers while we sleep.”<cite>— Priya Raman, VP Customer Success, Globex</cite></blockquote>
<h2>Get started</h2><p>See it with your own data. Visit <a href="https://northwind.io/start">northwind.io/start</a> or email <a href="mailto:sales@northwind.io">sales@northwind.io</a>.</p></div>`;

// ── 3. Report: serif body, numbered headings, running header, page numbers, real bullet glyphs ──
const report = `<style>${BASE}body{font-family:'Times New Roman',Georgia,serif;color:#111}
.title{padding:60mm 25mm}.title small{letter-spacing:.25em;font-size:11pt;color:#555;font-family:Arial,sans-serif}.title h1{font-size:34pt;margin:10mm 0 6mm;font-weight:700}.title p{font-size:14pt;color:#444}
.inner{padding:30mm 25mm}h2{font-family:Arial,sans-serif;font-size:17pt;margin:8mm 0 3mm}p{font-size:11.5pt;line-height:1.5;text-align:justify;margin:0 0 3mm}
ol.n{font-size:11.5pt;line-height:1.5;padding-left:7mm}ul.b{list-style:none;padding:0;font-size:11.5pt;line-height:1.5}ul.b li{padding-left:6mm;position:relative}ul.b li::before{content:'•';position:absolute;left:0}</style>
<div class="page title"><small>ANNUAL REPORT 2026</small><h1>Customer Retention in B2B SaaS</h1><p>A study of 240 subscription businesses by the Acme Research Group</p></div>
<div class="page inner"><h2>1. Introduction</h2><p>Retention is the quiet driver of growth in subscription businesses. This report examines how 240 companies structure customer success, pricing and onboarding, and which of those choices correlate with net revenue retention above 110 percent. The data were collected between January and June 2026 through structured interviews and billing exports.</p>
<h2>2. Methodology</h2><p>We followed a three-stage process to ensure that the findings are comparable across companies of different sizes and maturity.</p>
<ol class="n"><li>Select companies with at least twelve months of billing history.</li><li>Normalise revenue data to constant currency.</li><li>Interview the head of customer success at each company.</li></ol>
<h2>3. Key findings</h2><ul class="b"><li>Companies with a named onboarding owner retained 9 points more revenue.</li><li>Annual contracts reduced logo churn but hid dissatisfaction until renewal.</li><li>Usage-based pricing correlated with faster expansion in mid-market accounts.</li></ul></div>
<div class="page inner"><h2>4. Conclusions</h2><p>Retention is determined less by any single tactic than by whether a company treats the first ninety days as a product in its own right. We recommend that leaders measure time-to-value explicitly and assign a single accountable owner.</p>
<p>For more information, contact the research team at research@acme.org or visit www.acme.org/research.</p></div>`;

// ── 4. Scan: image only, no text layer ──
const scan = (() => {
  const c = createCanvas(1240, 1754);
  const g = c.getContext('2d');
  g.fillStyle = '#f5f1e6';
  g.fillRect(0, 0, 1240, 1754);
  g.fillStyle = '#222';
  g.font = 'bold 64px serif';
  g.fillText('Scanned Brochure', 120, 220);
  g.font = '34px serif';
  for (let i = 0; i < 14; i++) g.fillText('Lorem ipsum dolor sit amet, consectetur adipiscing elit.', 120, 340 + i * 54);
  return `<style>${BASE}</style><div class="page"><img src="data:image/png;base64,${c.toBuffer('image/png').toString('base64')}" style="width:210mm;height:297mm"></div>`;
})();

const hf = (left, right) => ({
  displayHeaderFooter: true,
  headerTemplate: `<div style="font:8px Arial;width:100%;padding:0 25mm;color:#666;display:flex;justify-content:space-between"><span>${left}</span></div>`,
  footerTemplate: `<div style="font:8px Arial;width:100%;padding:0 25mm;color:#666;display:flex;justify-content:space-between"><span>${right}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  margin: { top: '12mm', bottom: '14mm' },
});

const browser = await chromium.launch();
const render = async (name, html, extra = {}) => {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8">${html}`, { waitUntil: 'load' });
  await page.pdf({ path: path.join(out, name), preferCSSPageSize: true, printBackground: true, ...extra });
  await page.close();
  console.log(name, fs.statSync(path.join(out, name)).size, 'bytes');
};
await render('playbook.pdf', playbook);
await render('case-study.pdf', caseStudy, hf('', '© 2026 Northwind Systems Ltd. All rights reserved.'));
await render('report.pdf', report, hf('ACME CONFIDENTIAL', 'Acme Research Group'));
await render('scan.pdf', scan);
await browser.close();
