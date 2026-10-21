// End-to-end smoke test against a RUNNING server (use it on the production build):
//
//   node scripts/smoke.mjs [baseUrl]            default http://localhost:3000
//
// It signs up the first user, imports a PDF, publishes it, asks for a personalised link the way Clay
// does, then checks the page, the personalised PDF, the cover image and view tracking. It only talks
// HTTP, so it works the same against a local build, a container or a deployed instance (pass a fresh
// instance: the first-run setup must still be open).
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const PDF = path.resolve(process.env.SMOKE_PDF ?? 'tests/fixtures/playbook.pdf');
let cookie = '';
let failed = 0;

const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    console.log(`  ok  ${name} (${Date.now() - t}ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
};
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const api = async (method, url, body, headers = {}) => {
  const init = { method, headers: { ...(cookie ? { cookie } : {}), ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(BASE + url, init);
  const text = await res.clone().text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { res, json, text };
};

console.log(`Smoke test against ${BASE}`);

await step('server is up', async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no healthy response from /api/health after 30s');
});

await step('dashboard is served', async () => {
  const r = await fetch(BASE + '/');
  must(r.ok && (await r.text()).includes('<div id="root">'), 'dashboard shell missing (was the web app built?)');
});

let campaign;
await step('first-run setup creates the owner and signs in', async () => {
  const r = await api('POST', '/api/auth/setup', { email: 'smoke@example.com', name: 'Smoke', password: 'smoke-test-password-1' });
  must(r.res.status === 201, `setup returned ${r.res.status}: ${r.text.slice(0, 200)}`);
  cookie = (r.res.headers.get('set-cookie') ?? '').split(';')[0];
  must(cookie.includes('='), 'no session cookie');
});

await step('importing a PDF builds a campaign', async () => {
  const form = new FormData();
  form.set('file', new File([readFileSync(PDF)], 'playbook.pdf', { type: 'application/pdf' }));
  form.set('ai', '0');
  const r = await api('POST', '/api/campaigns/import-pdf', form);
  must(r.res.status === 201, `import returned ${r.res.status}: ${r.text.slice(0, 300)}`);
  campaign = r.json.campaign;
  must(campaign.page.blocks.length >= 5, `only ${campaign.page.blocks.length} blocks`);
  must(campaign.document?.page_count >= 1, 'PDF not attached');
});

await step('publishing makes it live', async () => {
  const r = await api('POST', `/api/campaigns/${campaign.id}/status`, { status: 'live' });
  must(r.res.ok && r.json.campaign.status === 'live', `status ${r.res.status}`);
});

let key;
await step('an API key can be created', async () => {
  const r = await api('POST', '/api/api-keys', { name: 'Smoke' });
  must(r.res.status === 201 && /^mpl_live_/.test(r.json.key), 'no key');
  key = r.json.key;
});

let link;
await step('POST /api/v1/personalize returns links (what Clay calls)', async () => {
  const r = await api('POST', '/api/v1/personalize', { campaign: campaign.id, first_name: 'Jane', last_name: 'Doe', email: 'jane@northwind.example', company: 'Northwind Traders', job_title: 'VP of Marketing' }, { authorization: `Bearer ${key}` });
  must(r.res.status === 200, `personalize returned ${r.res.status}: ${r.text.slice(0, 300)}`);
  link = r.json;
  must(/\/p\/[A-Za-z0-9]{12}$/.test(link.url), `odd url ${link.url}`);
  must(link.pdf_url?.endsWith('.pdf') && link.cover_url?.endsWith('/cover.png'), 'missing pdf/cover links');
  must(link.department === 'marketing' && link.seniority === 'vp', 'job title not understood');
  const again = await api('POST', '/api/v1/personalize', { campaign: campaign.id, email: 'jane@northwind.example' }, { authorization: `Bearer ${key}` });
  must(again.json.url === link.url, 'second call did not return the same link');
});

const local = (u) => BASE + new URL(u).pathname;
await step('the personalised page renders, escaped and with a strict CSP', async () => {
  const r = await fetch(local(link.url), { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } });
  const html = await r.text();
  must(r.status === 200, `page returned ${r.status}`);
  must(html.includes('Northwind Traders') && html.includes('Jane'), 'page isn’t personalised');
  const csp = r.headers.get('content-security-policy') ?? '';
  must(/script-src 'nonce-/.test(csp) && !/unsafe-inline/.test(csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? ''), `weak CSP: ${csp}`);
  must(r.headers.get('x-robots-tag')?.includes('noindex') || html.includes('noindex'), 'page is indexable');
});

await step('the personalised PDF is a real PDF', async () => {
  const r = await fetch(local(link.pdf_url));
  const bytes = Buffer.from(await r.arrayBuffer());
  must(r.status === 200 && r.headers.get('content-type') === 'application/pdf', `pdf returned ${r.status}`);
  must(bytes.subarray(0, 5).toString() === '%PDF-' && bytes.length > 5000, `bad pdf (${bytes.length} bytes)`);
  const other = await api('POST', '/api/v1/personalize', { campaign: campaign.id, first_name: 'Sam', email: 'sam@other.example', company: 'Other Co' }, { authorization: `Bearer ${key}` });
  const b = Buffer.from(await (await fetch(local(other.json.pdf_url))).arrayBuffer());
  must(!b.equals(bytes), 'two prospects received identical PDFs');
});

await step('the cover image is a PNG', async () => {
  const r = await fetch(local(link.cover_url));
  const bytes = Buffer.from(await r.arrayBuffer());
  must(r.status === 200 && bytes.subarray(1, 4).toString() === 'PNG', `cover returned ${r.status}`);
});

await step('a real visit is tracked, a link scanner is not', async () => {
  const token = new URL(link.url).pathname.split('/').pop();
  const beacon = (ua, wd) => fetch(`${BASE}/t/${token}`, { method: 'POST', headers: { 'user-agent': ua, 'content-type': 'text/plain' }, body: JSON.stringify({ type: 'view', sid: `smoke${ua.length}`, w: 1280, wd }) });
  await beacon('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', 0);
  await beacon('Mozilla/5.0 (compatible; Proofpoint URL Defense)', 0);
  const p = await api('GET', `/api/prospects/${link.id}`);
  must(p.json.prospect.engagement.views === 1, `expected 1 human view, saw ${p.json.prospect.engagement.views}`);
});

await step('analytics, audience export and cleanup work', async () => {
  const a = await api('GET', `/api/campaigns/${campaign.id}/analytics`);
  must(a.res.ok && a.json.totals.prospects === 2 && a.json.totals.opened === 1, `analytics off: ${a.text.slice(0, 200)}`);
  const csv = await api('GET', `/api/campaigns/${campaign.id}/prospects/export.csv`);
  must(csv.text.includes('jane@northwind.example') && csv.text.includes(new URL(link.url).pathname), 'export is missing the link');
  const del = await api('DELETE', `/api/campaigns/${campaign.id}`);
  must(del.res.ok, `delete returned ${del.res.status}`);
  const gone = await fetch(local(link.url));
  must(gone.status === 404 || gone.status === 410, `deleted campaign's link still answers ${gone.status}`);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
