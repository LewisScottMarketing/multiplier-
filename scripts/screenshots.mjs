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

await shot('login', async () => { await page.goto(`${BASE}/`); await page.waitForSelector('form'); });
await page.fill('input[type=email]', EMAIL);
await page.fill('input[type=password]', PASSWORD);
await page.click('button[type=submit]');
await page.waitForSelector('.sidebar');

const campaignId = (await (await ctx.request.get(`${BASE}/api/campaigns`)).json()).campaigns[0]?.id;
await shot('overview', async () => { await page.goto(`${BASE}/`); await page.waitForSelector('.kpis'); await page.waitForTimeout(600); });
await shot('campaigns', async () => { await page.goto(`${BASE}/campaigns`); await page.waitForSelector('.camp'); });
await shot('builder', async () => { await page.goto(`${BASE}/campaigns/${campaignId}/page`); await page.waitForSelector('.pv-frame iframe'); await page.waitForTimeout(2200); });
await shot('builder-block', async () => { await page.click('.bl-row:nth-child(2)'); await page.waitForTimeout(1500); });
await shot('builder-design', async () => { await page.click('text=Design'); await page.waitForTimeout(600); });
await shot('builder-mobile', async () => { await page.click('text=Blocks'); await page.click('[title="Phone"]'); await page.waitForTimeout(1800); });
await shot('pdf', async () => { await page.goto(`${BASE}/campaigns/${campaignId}/pdf`); await page.waitForTimeout(2500); });
await shot('audience', async () => { await page.goto(`${BASE}/campaigns/${campaignId}/audience`); await page.waitForSelector('table'); });
await shot('analytics', async () => { await page.goto(`${BASE}/campaigns/${campaignId}/analytics`); await page.waitForSelector('.viz-card'); await page.waitForTimeout(800); });
await shot('campaign-settings', async () => { await page.goto(`${BASE}/campaigns/${campaignId}/settings`); await page.waitForTimeout(800); });
await shot('integrations', async () => { await page.goto(`${BASE}/integrations`); await page.waitForTimeout(1000); });
await shot('settings', async () => { await page.goto(`${BASE}/settings`); await page.waitForTimeout(800); });
await browser.close();
