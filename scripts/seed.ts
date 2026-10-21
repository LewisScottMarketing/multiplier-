/**
 * Fills a fresh workspace with a demo campaign, prospects and a believable two weeks of engagement,
 * so every screen has something to show.   npm run seed
 */
import fs from 'node:fs';
import path from 'node:path';
import { createApiKey } from '../src/server/auth/apikeys';
import { countUsers, createUser } from '../src/server/auth/users';
import { loadConfig, loadDotEnv } from '../src/server/config';
import { closeContext, createContext } from '../src/server/context';
import { newBlockId } from '../src/shared/blocks';
import type { PdfField } from '../src/shared/schema';
import { fieldFromRun } from '../src/server/pdf/fields';
import { studioPage } from '../src/server/services/documents';
import { importPdfCampaign } from '../src/server/services/importer';
import { setCampaignStatus, updateCampaign } from '../src/server/services/campaigns';
import { recordEvent } from '../src/server/services/events';
import { upsertProspect } from '../src/server/services/prospects';
import { getWorkspace, saveWorkspace } from '../src/server/services/settings';

const DAY = 86_400_000;
const PEOPLE: Array<[string, string, string, string, string]> = [
  // first, last, title, company, domain
  ['Jane', 'Doe', 'VP of Marketing', 'Northwind Traders, Inc.', 'northwind.com'],
  ['Marcus', 'Okafor', 'Head of Sales Development', 'Globex Corporation', 'globex.io'],
  ['Priya', 'Raman', 'Chief Revenue Officer', 'Initech Ltd', 'initech.com'],
  ['Tom', 'Becker', 'Director of Demand Generation', 'Hooli', 'hooli.xyz'],
  ['Sofia', 'Marchetti', 'Marketing Manager', 'Umbrella Labs', 'umbrellalabs.com'],
  ['Daniel', 'Kowalski', 'Account Executive', 'Stark Systems', 'starksystems.com'],
  ['Aisha', 'Khan', 'Founder & CEO', 'Wayne Analytics', 'wayneanalytics.ai'],
  ['Lukas', 'Meyer', 'Head of Growth', 'Cyberdyne GmbH', 'cyberdyne.de'],
  ['Emma', 'Wilson', 'Senior Product Manager', 'Soylent Co', 'soylent.co'],
  ['Ravi', 'Patel', 'CTO', 'Massive Dynamic', 'massivedynamic.io'],
  ['Chloe', 'Dubois', 'Sales Director', 'Vandelay Industries', 'vandelay.fr'],
  ['Noah', 'Johnson', 'Customer Success Manager', 'Pied Piper', 'piedpiper.com'],
  ['Mia', 'Andersson', 'Chief Marketing Officer', 'Oscorp', 'oscorp.se'],
  ['Oliver', 'Smith', 'SDR Team Lead', 'Acme Corporation', 'acme.com'],
  ['Zoë', 'Nuñez', 'Head of Partnerships', 'Tyrell Corp', 'tyrell.mx'],
  ['Łukasz', 'Nowak', 'VP Engineering', 'Aperture Science', 'aperture.pl'],
  ['Hannah', 'Fischer', 'Content Marketing Lead', 'Gringotts Bank', 'gringotts.de'],
  ['Ethan', 'Brooks', 'Business Development Manager', 'Wonka Industries', 'wonka.com'],
  ['Grace', 'Lee', 'VP of Sales', 'Duff Beer Co', 'duff.com'],
  ['Mateo', 'Rossi', 'Demand Gen Manager', 'Nakatomi Trading', 'nakatomi.it'],
  ['Isabella', 'Costa', 'Director of Marketing', 'Prestige Worldwide', 'prestigeww.com'],
  ['Arjun', 'Mehta', 'Revenue Operations Manager', 'Los Pollos Hermanos', 'lph.in'],
  ['Freya', 'Larsen', 'Chief Operating Officer', 'Dunder Mifflin', 'dundermifflin.dk'],
  ['Jack', 'Murphy', 'Marketing Director', 'Sterling Cooper', 'sterlingcooper.ie'],
  ['Layla', 'Hassan', 'Head of Demand Generation', 'Rekall Inc', 'rekall.ae'],
  ['Ben', 'Carter', 'Account Manager', 'Bluth Company', 'bluth.com'],
  ['Elena', 'Petrova', 'Founder', 'Monsters Inc', 'monstersinc.ru'],
  ['Sam', 'Taylor', 'Growth Marketing Manager', 'Weyland-Yutani', 'weyland.co.uk'],
];

// deterministic pseudo-random so every seed run produces the same demo
let seedState = 42;
const rnd = () => ((seedState = (seedState * 1664525 + 1013904223) % 4294967296) / 4294967296);

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const ctx = createContext(config);
  if (countUsers(ctx) === 0) {
    await createUser(ctx, { email: 'demo@multiplier.local', name: 'Demo Owner', password: 'multiplier-demo', role: 'owner' });
    console.log('Created owner demo@multiplier.local / multiplier-demo');
  }
  saveWorkspace(ctx, { ...getWorkspace(ctx), name: 'Acme Growth Labs', sender: { name: 'Alex Morgan', role: 'Founder, Acme Growth Labs', avatar: '' } });

  const pdf = fs.readFileSync(path.resolve('assets/demo/outbound-playbook.pdf'));
  const { campaign, report } = await importPdfCampaign(ctx, { data: pdf, filename: 'outbound-playbook.pdf', name: 'Outbound Playbook — Q4' });
  console.log(report.map((r) => `  • ${r}`).join('\n'));

  // a persona-specific block so the demo shows targeting
  const page = structuredClone(campaign.page);
  // one AI-written line right under the hero (shows its fallback until AI is switched on and a prospect is sent through)
  const heroAt = page.blocks.findIndex((b) => b.type === 'hero') + 1;
  page.blocks.splice(heroAt, 0, { id: 'b_ai_opening', type: 'text', body: '{{ai_opening|Here is the playbook we put together for teams like yours.}}', align: 'center', pad: 'sm' } as never);
  const at = page.blocks.findIndex((b) => b.type === 'stats') + 1 || 2;
  page.blocks.splice(
    at,
    0,
    {
      id: 'b_persona_mkt', type: 'text', heading: 'For marketing leaders at {{company_short|your company}}',
      body: 'Your pipeline is only as good as your message-market fit. A page that speaks to {{company_short|your team}} by name, and to {{department_label|your function}} in particular, turns a skim into a reply.',
      rule: { match: 'all', conditions: [{ field: 'department', op: 'equals', value: 'marketing' }] }, bg: 'alt',
    },
    {
      id: 'b_persona_sales', type: 'text', heading: 'For sales leaders at {{company_short|your company}}',
      body: 'Reps don’t have time to write one-off follow-ups. Send {{company_short|each prospect}} a page built around *their* world, then follow up the moment they open it.',
      rule: { match: 'all', conditions: [{ field: 'department', op: 'in', value: 'sales, executive' }] }, bg: 'alt',
    },
  );

  // the PDF: the cover says "Prepared for [Company Name]", so swap that for the prospect's company and
  // add a QR code that leads back to their page
  const document = structuredClone(campaign.document!);
  const cover = (await studioPage(ctx, document, 1)).page;
  const prepared = cover.runs.find((r) => /Prepared for/.test(r.text));
  const extra: PdfField[] = [];
  if (prepared) extra.push(fieldFromRun(cover, prepared, { template: 'Prepared for {{company_short|your team}}' }));
  extra.push({ id: `f_${newBlockId()}`, type: 'qr', page: 1, rect: { x: cover.width - 118, y: cover.height - 124, w: 72, h: 72 }, url: '{{page_url}}', color: '#0f172a', background: '#ffffff', label: 'QR to their page' });
  document.fields.push(...extra);

  updateCampaign(ctx, campaign.id, {
    page,
    document,
    settings: {
      ...campaign.settings,
      required_fields: ['first_name', 'company'],
      allow_url_params: true,
      clean_names: true,
      ai_fields: [{ key: 'opening', label: 'Opening line', prompt: 'Write one warm sentence that opens the page for this person, referring to their role or company in a believable way.', max_chars: 160, fallback: 'Here is the playbook we put together for teams like yours.' }],
    },
  });
  const live = setCampaignStatus(ctx, campaign.id, 'live');

  const now = Date.now();
  let opened = 0;
  PEOPLE.forEach(([first, last, title, company, domain], i) => {
    const { prospect } = upsertProspect(ctx, live, {
      external_id: `clay_${1000 + i}`, first_name: first, last_name: last, email: `${first}.${last}@${domain}`.toLowerCase().replace(/[^a-z0-9.@-]/g, ''),
      company, job_title: title, website: `https://${domain}`, linkedin_url: `https://linkedin.com/in/${first}-${last}`.toLowerCase(),
      industry: ['SaaS', 'Fintech', 'Healthtech', 'Logistics', 'Retail'][i % 5], employees: [24, 80, 150, 400, 1200][i % 5],
    });
    const sentAt = now - Math.floor(rnd() * 12) * DAY - Math.floor(rnd() * 20) * 3600_000 - 2 * 3600_000;
    // engagement tilts toward marketers and executives so the segment chart has a story
    const warm = /market|growth|demand|chief|vp|head|director|founder/i.test(title) ? 0.78 : 0.42;
    if (rnd() > warm) return;
    opened++;
    let t = sentAt + Math.floor(rnd() * 20 + 1) * 3600_000;
    const sid = `seed${i}a`;
    recordEvent(ctx, { campaignId: live.id, prospectId: prospect.id, type: 'view', sessionId: sid, props: { w: rnd() > 0.35 ? 1280 : 390 }, ip: `10.0.${i}.1`, ua: 'Mozilla/5.0 (Macintosh) Chrome/126', at: t });
    recordEvent(ctx, { campaignId: live.id, prospectId: prospect.id, type: 'engaged', sessionId: sid, props: { s: Math.floor(20 + rnd() * 150), scroll: Math.floor(30 + rnd() * 70), i: 1 }, at: t + 60_000 });
    if (rnd() > 0.5) { t += 90_000; recordEvent(ctx, { campaignId: live.id, prospectId: prospect.id, type: 'download', props: {}, at: t }); }
    if (rnd() > 0.55) { t += 120_000; recordEvent(ctx, { campaignId: live.id, prospectId: prospect.id, type: 'click', props: { block: live.page.blocks[0]?.id, slot: 'primary', label: 'Book a call', host: 'cal.com' }, at: t }); }
    if (rnd() > 0.78) { t += 200_000; recordEvent(ctx, { campaignId: live.id, prospectId: prospect.id, type: 'submit', props: { fields: { name: `${first} ${last}`, message: 'Can we talk next week?' } }, at: t }); }
    if (rnd() > 0.7) recordEvent(ctx, { campaignId: live.id, prospectId: prospect.id, type: 'view', sessionId: `seed${i}b`, props: { w: 1280 }, at: t + Math.floor(1 + rnd() * 3) * DAY });
  });

  const { key } = createApiKey(ctx, { name: 'Clay (demo)' });
  console.log(`\nSeeded ${PEOPLE.length} prospects (${opened} opened) in “${live.name}”.`);
  console.log(`Demo API key (shown once): ${key}`);
  closeContext(ctx);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
