import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Hash, ListChecks, Plus, Send, Table2, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { fmtDateTime } from '../../lib/format';
import type { CampaignSummary, WebhookInfo } from '../../types';
import { Alert, Badge, Button, CenterSpinner, CodeBlock, CopyBox, Field, Input, Menu, Modal, Switch, useConfirm, useToast } from '../../ui';

type Kind = WebhookInfo['kind'];

const EVENT_INFO: Record<string, { label: string; hint: string }> = {
  'prospect.created': { label: 'Link created', hint: 'A row was sent through the API or imported.' },
  'page.first_viewed': { label: 'First open', hint: 'They opened their page for the first time.' },
  'page.viewed': { label: 'Every open', hint: 'Each later visit. Can be chatty.' },
  'link.clicked': { label: 'Button clicked', hint: 'They clicked a button or link on the page.' },
  'pdf.downloaded': { label: 'PDF downloaded', hint: 'They downloaded their personalised PDF.' },
  'form.submitted': { label: 'Form submitted', hint: 'They filled in the form on the page.' },
  'meeting.booked': { label: 'Meeting booked', hint: 'They booked time through the calendar block.' },
};
const DEFAULT_EVENTS = ['page.first_viewed', 'link.clicked', 'pdf.downloaded', 'form.submitted', 'meeting.booked'];

const KIND: Record<Kind, { label: string; icon: React.ReactNode; blurb: string; placeholder: string }> = {
  clay: { label: 'Clay table', icon: <Table2 size={17} />, blurb: 'Each event becomes a new row in a Clay table, so Clay can score, enrich and trigger follow-ups.', placeholder: 'https://api.clay.com/v3/sources/webhook/…' },
  slack: { label: 'Slack', icon: <Hash size={17} />, blurb: 'Post a friendly message to a channel when someone opens, clicks or replies.', placeholder: 'https://hooks.slack.com/services/…' },
  generic: { label: 'Your own endpoint', icon: <WebhookIcon size={17} />, blurb: 'A signed JSON POST for your own systems, n8n, Zapier or Make.', placeholder: 'https://example.com/hooks/multiplier' },
};

function WebhookModal({ hook, campaigns, onClose, onSaved }: { hook?: WebhookInfo; campaigns: CampaignSummary[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>(hook?.kind ?? 'clay');
  const [name, setName] = useState(hook?.name ?? '');
  const [url, setUrl] = useState(hook?.url ?? '');
  const [authHeader, setAuthHeader] = useState(hook?.auth_header ?? 'x-clay-webhook-auth');
  const [authValue, setAuthValue] = useState('');
  const [events, setEvents] = useState<string[]>(hook?.events ?? DEFAULT_EVENTS);
  const [campaign, setCampaign] = useState(hook?.campaign_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const withAuth = kind !== 'slack';
      const body = {
        name: name.trim() || KIND[kind].label,
        kind,
        url: url.trim(),
        events: events.length ? events : DEFAULT_EVENTS,
        campaign_id: campaign || null,
        auth_header: withAuth && authHeader.trim() ? authHeader.trim() : null,
        ...(withAuth && authValue ? { auth_value: authValue } : kind === 'slack' ? { auth_value: null } : {}),
      };
      if (hook) {
        await api.put(`/webhooks/${hook.id}`, body);
        toast.ok('Saved');
        onSaved();
        onClose();
      } else {
        const r = await api.post<{ webhook: WebhookInfo; secret: string | null }>('/webhooks', body);
        onSaved();
        if (r.secret) setSecret(r.secret);
        else {
          toast.ok('Destination added');
          onClose();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  if (secret) {
    return (
      <Modal title="Signing secret" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <div className="col" style={{ gap: 12 }}>
          <Alert tone="warn">Copy this secret now; it won’t be shown again.</Alert>
          <CopyBox text={secret} />
          <p className="muted small">Every request carries <code>x-multiplier-signature: sha256=…</code>, an HMAC-SHA256 of <code>{'{timestamp}.{body}'}</code> using this secret, plus <code>x-multiplier-timestamp</code>. Verify it and reject old timestamps.</p>
        </div>
      </Modal>
    );
  }

  const toggle = (e: string) => setEvents((s) => (s.includes(e) ? s.filter((x) => x !== e) : [...s, e]));

  return (
    <Modal
      title={hook ? `Edit “${hook.name}”` : 'Add a destination'}
      size="wide"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!url.trim()} onClick={save}>{hook ? 'Save changes' : 'Add destination'}</Button></>}
    >
      <div className="col" style={{ gap: 14 }}>
        {error ? <Alert tone="bad">{error}</Alert> : null}
        {!hook ? (
          <div className="option-cards" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 0 }}>
            {(Object.keys(KIND) as Kind[]).map((k) => (
              <button key={k} type="button" className={`option-card ${kind === k ? 'on' : ''}`} onClick={() => { setKind(k); setAuthHeader(k === 'clay' ? 'x-clay-webhook-auth' : ''); }}>
                <b>{KIND[k].icon} {KIND[k].label}</b>
                <span>{KIND[k].blurb}</span>
              </button>
            ))}
          </div>
        ) : null}
        {kind === 'clay' ? (
          <Alert>In Clay, create a table with a <b>Webhook</b> source (<i>Import → Webhook</i>) and paste its URL below. If Clay shows an auth token for it, add the header name and token below. Then send a test event so Clay learns the columns.</Alert>
        ) : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={KIND[kind].label} /></Field>
          <Field label="Webhook URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={KIND[kind].placeholder} spellCheck={false} autoFocus /></Field>
        </div>
        {kind !== 'slack' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <Field label="Auth header" hint={kind === 'clay' ? 'The name your Clay webhook shows.' : 'Optional.'}><Input value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} placeholder="x-clay-webhook-auth" style={{ fontFamily: 'var(--mono)' }} /></Field>
            <Field label="Auth value" hint={hook?.has_auth_value ? 'Leave empty to keep the saved value.' : 'Stored encrypted.'}>
              <Input type="password" value={authValue} onChange={(e) => setAuthValue(e.target.value)} placeholder={hook?.has_auth_value ? '••••••••' : ''} autoComplete="off" />
            </Field>
          </div>
        ) : null}
        <div>
          <div className="label" style={{ marginBottom: 8 }}>Send when</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {Object.entries(EVENT_INFO).map(([k, v]) => (
              <label key={k} className="check" style={{ padding: '8px 10px', border: `1px solid ${events.includes(k) ? 'var(--brand)' : 'var(--line)'}`, background: events.includes(k) ? 'var(--brand-50)' : 'var(--panel)', borderRadius: 9 }}>
                <input type="checkbox" checked={events.includes(k)} onChange={() => toggle(k)} />
                <span><b style={{ fontWeight: 600 }}>{v.label}</b><br /><span className="muted tiny">{v.hint}</span></span>
              </label>
            ))}
          </div>
        </div>
        <Field label="Campaigns">
          <select className="select" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

interface Delivery { id: string; event: string; status: string; attempts: number; last_status: number | null; last_error: string | null; created_at: number; delivered_at: number | null }

function DeliveryLog({ hook, onClose }: { hook: WebhookInfo; onClose: () => void }) {
  const q = useQuery({ queryKey: ['webhook-deliveries', hook.id], queryFn: () => api.get<{ deliveries: Delivery[] }>(`/webhooks/${hook.id}/deliveries`), refetchInterval: 5000 });
  return (
    <Modal title={`Recent deliveries · ${hook.name}`} size="wide" onClose={onClose}>
      {q.isLoading ? <CenterSpinner /> : !q.data?.deliveries.length ? (
        <div className="viz-empty">Nothing has been sent to this destination yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Event</th><th>Status</th><th className="num">Tries</th><th>Result</th></tr></thead>
            <tbody>
              {q.data.deliveries.map((d) => (
                <tr key={d.id}>
                  <td className="nowrap muted">{fmtDateTime(d.created_at)}</td>
                  <td>{EVENT_INFO[d.event]?.label ?? d.event}</td>
                  <td><Badge tone={d.status === 'delivered' ? 'ok' : d.status === 'failed' ? 'bad' : 'warn'}>{d.status === 'pending' ? 'Retrying' : d.status}</Badge></td>
                  <td className="num">{d.attempts}</td>
                  <td className="small muted">{d.last_error ?? (d.last_status ? `HTTP ${d.last_status}` : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>Failed deliveries are retried a few times over several hours before we give up.</p>
    </Modal>
  );
}

export function Webhooks({ campaigns }: { campaigns: CampaignSummary[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<WebhookInfo | 'new' | null>(null);
  const [log, setLog] = useState<WebhookInfo | null>(null);
  const q = useQuery({ queryKey: ['webhooks'], queryFn: () => api.get<{ webhooks: WebhookInfo[] }>('/webhooks') });
  const hooks = q.data?.webhooks ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['webhooks'] });

  const test = async (h: WebhookInfo, campaignId: string) => {
    try {
      const r = await api.post<{ ok: boolean; status: number | null; error: string | null }>(`/webhooks/${h.id}/test`, { campaign_id: campaignId });
      if (r.ok) toast.ok(`Test delivered (HTTP ${r.status})`);
      else toast.error(`The destination rejected it: ${r.error ?? `HTTP ${r.status}`}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Test failed');
    }
  };

  const remove = async (h: WebhookInfo) => {
    if (!(await confirm({ title: `Remove “${h.name}”?`, body: 'We stop sending events there. Past deliveries are forgotten.', confirm: 'Remove', danger: true }))) return;
    await api.del(`/webhooks/${h.id}`);
    refresh();
  };

  const setActive = async (h: WebhookInfo, active: boolean) => {
    try {
      await api.put(`/webhooks/${h.id}`, { active });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update');
    }
  };

  return (
    <section className="card">
      <div className="card-head" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h2>2 · Send engagement back</h2>
          <p className="muted small" style={{ marginTop: 3, maxWidth: 640 }}>
            When a prospect opens their page, clicks, downloads the PDF or replies, tell Clay (or Slack, or your own tools) straight away, so follow-ups can start while they’re still interested.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setEditing('new')}><Plus size={14} /> Add destination</Button>
      </div>

      {q.isLoading ? <CenterSpinner /> : !hooks.length ? (
        <div className="viz-empty" style={{ padding: '30px 8px' }}>
          <Bell size={22} style={{ color: 'var(--ink-4)' }} />
          <div style={{ marginTop: 8 }}>Nothing is connected yet. Add a Clay table to see engagement next to each row, or Slack for a live feed.</div>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
          {hooks.map((h, i) => (
            <div key={h.id} className="row" style={{ padding: '12px 14px', borderTop: i ? '1px solid var(--line)' : 0, alignItems: 'flex-start', opacity: h.active ? 1 : 0.65 }}>
              <span className="bl-ico" style={{ marginTop: 2 }}>{KIND[h.kind].icon}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b>{h.name}</b>
                  <Badge>{KIND[h.kind].label}</Badge>
                  {h.campaign_id ? <Badge tone="brand">{campaigns.find((c) => c.id === h.campaign_id)?.name ?? 'One campaign'}</Badge> : null}
                </div>
                <div className="muted tiny truncate mono" title={h.url}>{h.url.replace(/^https?:\/\//, '').slice(0, 70)}</div>
                <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                  {h.events.map((e) => <span key={e} className="chip">{EVENT_INFO[e]?.label ?? e}</span>)}
                </div>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  {h.stats.delivered} delivered{h.stats.pending ? ` · ${h.stats.pending} retrying` : ''}{h.stats.failed ? <> · <span style={{ color: 'var(--bad)' }}>{h.stats.failed} failed</span></> : null}
                </div>
              </div>
              <div className="row" style={{ gap: 4 }}>
                {h.campaign_id || campaigns.length === 1 ? (
                  <Button size="sm" onClick={() => test(h, h.campaign_id ?? campaigns[0]!.id)}><Send size={13} /> Test</Button>
                ) : (
                  <Menu trigger={(_o, t) => <Button size="sm" onClick={t} disabled={!campaigns.length}><Send size={13} /> Test</Button>}>
                    {(close) => (
                      <>
                        <div className="tiny muted" style={{ padding: '6px 10px' }}>Use a real prospect from…</div>
                        {campaigns.map((c) => <button key={c.id} onClick={() => { close(); void test(h, c.id); }}>{c.name}</button>)}
                      </>
                    )}
                  </Menu>
                )}
                <Button size="sm" variant="ghost" icon title="Recent deliveries" aria-label="Recent deliveries" onClick={() => setLog(h)}><ListChecks size={15} /></Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(h)}>Edit</Button>
                <Switch checked={h.active} onChange={(v) => setActive(h, v)} label={`Send events to ${h.name}`} />
                <Button size="sm" variant="ghost" icon aria-label="Remove" onClick={() => remove(h)}><Trash2 size={14} /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <details style={{ marginTop: 16 }}>
        <summary className="small muted" style={{ cursor: 'pointer' }}>What a Clay row looks like</summary>
        <div style={{ marginTop: 10 }}>
          <CodeBlock text={JSON.stringify({ event: 'page.first_viewed', occurred_at: '2026-10-21T09:14:03.000Z', email: 'jane@northwind.com', first_name: 'Jane', company: 'Northwind Traders', job_title: 'VP of Marketing', page_url: 'https://go.example.com/p/k3x9Qm2aWd', stage: 'opened', views: 1, clicks: 0, downloads: 0, score: 10, seniority: 'vp', department: 'marketing' }, null, 2)} />
          <p className="hint" style={{ marginTop: 6 }}>Flat keys, so every one maps straight to a Clay column.</p>
        </div>
      </details>

      {editing ? <WebhookModal hook={editing === 'new' ? undefined : editing} campaigns={campaigns} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {log ? <DeliveryLog hook={log} onClose={() => setLog(null)} /> : null}
    </section>
  );
}
