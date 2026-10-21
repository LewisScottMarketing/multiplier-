// Captures screenshots of the running app for the docs:   node scripts/screenshots.mjs [baseUrl] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const OUT = path.resolve(process.argv[3] ?? 'docs/screenshots');
const EMAIL = process.env.SHOT_EMAIL ?? 'demo@multiplier.local';
const PASSWORD = process.env.SHOT_PASSWORD ?? 'multiplier-demo';
const only = process.env.SHOT_ONLY?.split(',');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text().slice(0, 200)));

const shot = async (name, fn) => {
  if (only && !only.includes(name)) return;
  try {
    await fn();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('✓', name);
  } catch (e) {
    console.log('✗', name, e.message.split('\n')[0]);
    await page.screenshot({ path: path.join(OUT, `${name}.FAILED.png`) }).catch(() => undefined);
  }
};

await page.goto(`${BASE}/`);
await page.waitForSelector('form');
await shot('login', async () => undefined);
await page.fill('input[type=email]', EMAIL);
await page.fill('input[type=password]', PASSWORD);
await page.click('button[type=submit]');
await page.waitForSelector('.sidebar');

const campaignId = (await (await ctx.request.get(`${BASE}/api/campaigns`)).json()).campaigns[0]?.id;
await shot('overview', async () => {
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.kpis');
  await page.waitForTimeout(600);
});
await shot('campaigns', async () => {
  await page.goto(`${BASE}/campaigns`);
  await page.waitForSelector('.camp');
});
await shot('builder', async () => {
  await page.goto(`${BASE}/campaigns/${campaignId}/page`);
  await page.waitForSelector('.pv-frame iframe');
  await page.waitForTimeout(2200);
});
await shot('builder-block', async () => {
  await page.click('.bl-row:nth-child(2)');
  await page.waitForTimeout(1500);
});
await shot('builder-design', async () => {
  await page.click('text=Design');
  await page.waitForTimeout(600);
});
await shot('builder-mobile', async () => {
  await page.click('text=Blocks');
  await page.click('[title="Phone"]');
  await page.waitForTimeout(1800);
});
await shot('templates', async () => {
  await page.goto(`${BASE}/campaigns`);
  await page.waitForSelector('.camp');
  await page.locator('button', { hasText: 'New campaign' }).first().click();
  await page.locator('.option-card', { hasText: 'From a template' }).click();
  await page.waitForSelector('.tpl');
  await page.waitForTimeout(4000); // the live thumbnails load their own fonts
});
// a throwaway campaign, so trying looks never touches the demo one
let stylesId = '';
await shot('styles', async () => {
  const made = await (await ctx.request.post(`${BASE}/api/campaigns`, { data: { name: 'Styles', template: 'case-study' } })).json();
  stylesId = made.campaign.id;
  await page.goto(`${BASE}/campaigns/${stylesId}/page`);
  await page.waitForSelector('.pv-frame iframe');
  await page.click('text=Design');
  await page.waitForTimeout(2500);
});
if (stylesId) await ctx.request.delete(`${BASE}/api/campaigns/${stylesId}`).catch(() => undefined);
await shot('pdf', async () => {
  await page.goto(`${BASE}/campaigns/${campaignId}/pdf`);
  await page.waitForSelector('.pdf-page');
  await page.waitForTimeout(1800);
});
await shot('pdf-field', async () => {
  await page.goto(`${BASE}/campaigns/${campaignId}/pdf`);
  await page.waitForSelector('.pdf-field');
  await page.waitForTimeout(800);
  await page.locator('.pdf-field.t-text').first().click();
  await page.waitForTimeout(700);
});
await shot('pdf-preview', async () => {
  await page.goto(`${BASE}/campaigns/${campaignId}/pdf`);
  await page.waitForSelector('.pdf-page');
  await page.locator('.st-bar button', { hasText: 'Preview' }).first().click();
  await page.waitForSelector('.pdf-preview', { timeout: 20000 });
  await page.waitForTimeout(1500);
});
await shot('audience', async () => {
  await page.goto(`${BASE}/campaigns/${campaignId}/audience`);
  await page.waitForSelector('table');
});
await shot('audience-drawer', async () => {
  await page.goto(`${BASE}/campaigns/${campaignId}/audience`);
  await page.waitForSelector('tbody tr.click');
  await page.locator('tbody tr.click').nth(5).click();
  await page.waitForSelector('.drawer');
  await page.waitForTimeout(900);
});
await shot('audience-import', async () => {
  await page.goto(`${BASE}/campaigns/${campaignId}/audience`);
  await page.waitForSelector('table');
  await page.locator('button', { hasText: 'Import CSV' }).click();
  await page.waitForSelector('.modal');
});
await shot('analytics', async () => {
  await page.goto(`${BASE}/campaigns/${campaignId}/analytics`);
  await page.waitForSelector('.viz-card');
  await page.waitForTimeout(800);
});
await shot('campaign-settings', async () => {
  await page.goto(`${BASE}/campaigns/${campaignId}/settings`);
  await page.waitForTimeout(800);
});
await shot('integrations', async () => {
  await page.goto(`${BASE}/integrations`);
  await page.waitForTimeout(1000);
});
await shot('integrations-webhooks', async () => {
  await page.goto(`${BASE}/integrations`);
  await page.waitForTimeout(800);
  await page.locator('text=Send engagement back').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('.main').scrollBy(0, 560));
});
await shot('ai-try-it', async () => {
  await page.goto(`${BASE}/campaigns/${campaignId}/settings`);
  await page.waitForSelector('text=AI-written fields');
  await page.locator('button', { hasText: 'Try it' }).first().click();
  await page.waitForSelector('.badge.ok >> text=AI-written', { timeout: 15000 });
  await page.locator('.badge.ok >> text=AI-written').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200)).catch(() => undefined);
});
await shot('ai-variant', async () => {
  await page.goto(`${BASE}/campaigns/${campaignId}/page`);
  await page.waitForSelector('.bl-row');
  const rows = page.locator('.bl-row');
  for (let i = 0; i < (await rows.count()); i++)
    if (/Why personalisation wins/i.test(await rows.nth(i).innerText())) {
      await rows.nth(i).click();
      break;
    }
  await page.locator('button', { hasText: 'Write a version for' }).click();
  await page.locator('.option-card', { hasText: 'Marketing' }).click();
  await page.waitForSelector('text=Shown only to people whose job title matches', { timeout: 20000 });
});
await shot('settings', async () => {
  await page.goto(`${BASE}/settings`);
  await page.waitForTimeout(800);
});
// the personalised landing page a prospect sees, on a laptop and on a phone
const prospects = (await (await ctx.request.get(`${BASE}/api/campaigns/${campaignId}/prospects?limit=60`)).json()).prospects;
const target = prospects.find((p) => /marketing/i.test(p.job_title ?? '')) ?? prospects[0];
await shot('landing', async () => {
  await page.goto(target.url.replace(/^https?:\/\/[^/]+/, BASE));
  await page.waitForSelector('main');
  await page.waitForTimeout(800);
});
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
const mp = await phone.newPage();
if (!only || only.includes('landing-mobile')) {
  await mp.goto(target.url.replace(/^https?:\/\/[^/]+/, BASE));
  await mp.waitForSelector('main');
  await mp.waitForTimeout(900);
  await mp.screenshot({ path: path.join(OUT, 'landing-mobile.png') });
  console.log('✓ landing-mobile');
}
await browser.close();
