import { ArrowUpRight } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { CampaignSummary, SettingsResponse } from '../../types';
import { Alert, Badge, CodeBlock, CopyBox, Select } from '../../ui';
import { ApiKeys } from './ApiKeys';

function Step({ n, title, children, done }: { n: number; title: string; children: ReactNode; done?: boolean }) {
  return (
    <div className="step">
      <div><span className={`step-num ${done ? 'done' : ''}`}>{n}</span></div>
      <div className="col" style={{ gap: 12, minWidth: 0, paddingBottom: 18 }}>
        <h3 style={{ fontSize: 15, fontWeight: 650, paddingTop: 3 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const RETURNS: Array<{ path: string; what: string; when?: string }> = [
  { path: 'url', what: 'The prospect’s personalised landing page link. This is the one you put in your email.' },
  { path: 'pdf_url', what: 'A link to their personalised PDF (name and company filled in).', when: 'Campaigns with a PDF' },
  { path: 'cover_url', what: 'A PNG preview of page 1 of their PDF. Embed it in the email and link it to the page.', when: 'Campaigns with a PDF' },
  { path: 'headline', what: 'The headline they’ll see, handy for a subject line or opener.' },
  { path: 'warnings', what: 'Anything to double-check, such as a field that was empty for this row.' },
];

export function ClayGuide({ campaigns, settings, newKey, onNewKey }: { campaigns: CampaignSummary[]; settings: SettingsResponse | undefined; newKey: string; onNewKey: (k: string) => void }) {
  const live = campaigns.find((c) => c.status === 'live') ?? campaigns[0];
  const [pick, setPick] = useState(live?.id ?? '');
  const campaign = campaigns.find((c) => c.id === pick) ?? live;
  const base = settings?.urls.app ?? window.location.origin;
  const endpoint = `${base}/api/v1/personalize`;
  const key = newKey || 'mpl_live_…your key…';

  const body = useMemo(
    () =>
      JSON.stringify(
        {
          campaign: campaign?.slug ?? 'your-campaign-slug',
          first_name: '/First Name',
          last_name: '/Last Name',
          email: '/Work Email',
          company: '/Company Name',
          job_title: '/Job Title',
          linkedin_url: '/LinkedIn Profile',
        },
        null,
        2,
      ),
    [campaign?.slug],
  );
  const curl = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"campaign":"${campaign?.slug ?? 'your-campaign-slug'}","first_name":"Jane","company":"Northwind Traders","job_title":"VP of Marketing"}'`;

  return (
    <section className="card">
      <div className="card-head" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h2>1 · Send prospects from Clay</h2>
          <p className="muted small" style={{ marginTop: 3, maxWidth: 640 }}>
            Add one HTTP API column to your Clay table. For every row it asks Multiplier for that person’s personalised page (and PDF) and gets the link back, ready for your sequence.
          </p>
        </div>
        <a className="btn sm" href="https://university.clay.com/docs/http-api-integration-overview" target="_blank" rel="noreferrer noopener">Clay’s HTTP API guide <ArrowUpRight size={13} /></a>
      </div>

      <div style={{ marginTop: 8 }}>
        <Step n={1} title="Create an API key">
          <ApiKeys campaigns={campaigns} onNewKey={onNewKey} />
        </Step>

        <Step n={2} title="Add an HTTP API column in Clay">
          <p className="muted small">In your Clay table click <b>Add enrichment</b>, choose <b>HTTP API</b>, open the <b>Configure</b> tab and fill it in like this.</p>
          {campaigns.length === 0 ? (
            <Alert tone="warn">Create a campaign first. Clay needs one to point at.</Alert>
          ) : (
            <div className="row wrap">
              <span className="label">Campaign</span>
              <Select small style={{ width: 280 }} value={campaign?.id ?? ''} onChange={(e) => setPick(e.target.value)} aria-label="Which campaign is this for?">
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              {campaign?.status === 'live' ? <Badge tone="ok" dot>Live</Badge> : <Badge tone="warn" dot>Draft: publish it before sending</Badge>}
            </div>
          )}
          <dl className="kv" style={{ gridTemplateColumns: '150px 1fr', alignItems: 'center', rowGap: 10 }}>
            <dt>HTTP method</dt>
            <dd><b>POST</b></dd>
            <dt>Endpoint URL</dt>
            <dd><CopyBox text={endpoint} /></dd>
            <dt>Header account</dt>
            <dd>
              <div className="col" style={{ gap: 6 }}>
                <span className="small">Click <b>Select header account → + Add account</b> and add one header under <b>API Request Headers</b>:</span>
                <CopyBox text={`Authorization: Bearer ${key}`} />
                <span className="hint">Saving it as an account keeps the key out of the column itself. Clay sets <code>Content-Type</code> for you.</span>
              </div>
            </dd>
          </dl>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Body</div>
            <CodeBlock text={body} />
            <p className="hint" style={{ marginTop: 6 }}>
              Inside each pair of quotes type <b>/</b> and pick the Clay column; keep the quotes around it. Anything extra you send (<code>industry</code>, <code>pain_point</code>, a recent news item…) becomes a merge field like <code>{'{{industry}}'}</code>.
            </p>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Put these in “Field paths to return”</div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
              {RETURNS.filter((r) => !r.when || campaign?.has_document || r.path === 'url').map((r, i) => (
                <div key={r.path} className="row" style={{ padding: '9px 12px', borderTop: i ? '1px solid var(--line)' : 0, alignItems: 'flex-start' }}>
                  <code style={{ background: 'var(--bg)', padding: '2px 7px', borderRadius: 6, flex: 'none' }}>{r.path}</code>
                  <span className="small grow">{r.what}</span>
                </div>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 6 }}>Return <code>url</code> from the column, then add more columns for the others if you need them. Under <b>Rate limiting</b>, 10 requests per 1000 ms is a good start (a key allows 600 a minute), and use <b>Test</b> on a single row first.</p>
          </div>
        </Step>

        <Step n={3} title="Use the link in your outreach">
          <p className="muted small">
            Insert the <b>url</b> column into your email or LinkedIn step wherever the link goes. Running the column again for the same row returns the same link, so re-running never creates duplicates.
            {campaign?.has_document ? <> Embed <b>cover_url</b> as an image linked to <b>url</b> to show a preview of their personalised PDF right in the email.</> : null}
          </p>
          <Alert>Rows missing a required field get a clear error in the Clay cell instead of a link. Set which fields are required in <b>Campaign → Settings</b>.</Alert>
        </Step>

        <Step n={4} title="Check it works (optional)">
          <p className="muted small">Run this from a terminal to see exactly what Clay gets back.</p>
          <CodeBlock text={curl} />
        </Step>
      </div>
    </section>
  );
}
