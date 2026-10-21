import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, Sparkles, Trash2, Upload, UserRound, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { SettingsResponse, User, WorkspaceSettings } from '../types';
import { Alert, Badge, Button, CenterSpinner, Field, Input, Textarea, useToast } from '../ui';

function Section({ title, desc, children, actions }: { title: string; desc?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
        <div className="grow">
          <h2>{title}</h2>
          {desc ? (
            <p className="muted small" style={{ marginTop: 3, maxWidth: 640 }}>
              {desc}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function WorkspaceForm({ initial, publicHost }: { initial: WorkspaceSettings; publicHost: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [w, setW] = useState<WorkspaceSettings>(initial);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(w) !== JSON.stringify(initial);

  const addDomain = () => {
    const d = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (!HOST_RE.test(d)) return toast.error('Enter a domain like go.yourbrand.com');
    if (w.domains.includes(d)) return setDomain('');
    setW((s) => ({ ...s, domains: [...s.domains, d] }));
    setDomain('');
  };

  const uploadAvatar = async (f: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', f);
      const r = await api.upload<{ asset: { id: string } }>('/assets', form);
      setW((s) => ({ ...s, sender: { ...s.sender, avatar: r.asset.id } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/settings/workspace', w);
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast.ok('Settings saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const avatar = /^ast_/.test(w.sender.avatar) ? `/a/${w.sender.avatar}` : '';

  return (
    <>
      <Section title="Workspace">
        <Field label="Workspace name" hint="Shown in the dashboard only.">
          <Input value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} maxLength={80} style={{ maxWidth: 360 }} />
        </Field>
      </Section>

      <Section
        title="Your sender identity"
        desc="Used to fill in new “Personal note” blocks, so your message and photo are already there when you add one."
      >
        <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
          <button
            type="button"
            onClick={() => file.current?.click()}
            aria-label="Upload a photo"
            style={{
              width: 84,
              height: 84,
              borderRadius: '50%',
              border: '1px dashed var(--line-2)',
              background: avatar ? `url(${avatar}) center/cover` : 'var(--bg)',
              color: 'var(--ink-4)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              flex: 'none',
            }}
          >
            {!avatar ? uploading ? '…' : <Upload size={20} /> : null}
          </button>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadAvatar(f);
              e.target.value = '';
            }}
          />
          <div className="col grow" style={{ gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Your name">
                <Input
                  value={w.sender.name}
                  onChange={(e) => setW({ ...w, sender: { ...w.sender, name: e.target.value } })}
                  placeholder="Alex Morgan"
                />
              </Field>
              <Field label="Your role">
                <Input
                  value={w.sender.role}
                  onChange={(e) => setW({ ...w, sender: { ...w.sender, role: e.target.value } })}
                  placeholder="Founder, Acme"
                />
              </Field>
            </div>
            {avatar ? (
              <div>
                <Button size="xs" variant="ghost" onClick={() => setW({ ...w, sender: { ...w.sender, avatar: '' } })}>
                  <Trash2 size={12} /> Remove photo
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </Section>

      <Section
        title="Your own domains"
        desc={
          <>
            Send personalised links from <code>go.yourbrand.com</code> instead of this server’s address. They look more trustworthy and
            survive spam filters better.
          </>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          <div className="row wrap">
            <Badge dot tone="ok">
              {publicHost}
            </Badge>
            <span className="muted small">default</span>
            {w.domains.map((d) => (
              <span key={d} className="chip" style={{ height: 24 }}>
                <Globe size={12} /> {d}
                <button
                  type="button"
                  aria-label={`Remove ${d}`}
                  onClick={() => setW((s) => ({ ...s, domains: s.domains.filter((x) => x !== d) }))}
                  style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'grid', color: 'var(--ink-3)' }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="row" style={{ maxWidth: 480 }}>
            <Input
              small
              placeholder="go.yourbrand.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDomain())}
              spellCheck={false}
            />
            <Button size="sm" onClick={addDomain}>
              <Plus size={14} /> Add
            </Button>
          </div>
          <Alert>
            Point the domain at this server first (a CNAME to <code>{publicHost}</code> or an A record), then add it here. Pick it per
            campaign under <b>Campaign → Settings</b>. The bundled Caddy config issues HTTPS certificates automatically, but only for
            domains listed here.
          </Alert>
        </div>
      </Section>

      <Section
        title="Tracking and custom code"
        desc="Snippets added here run on every personalised page, for example Google Analytics, LinkedIn Insight or a chat widget. Only paste code you trust."
      >
        <div className="col" style={{ gap: 14 }}>
          <Field label="In the <head>">
            <Textarea
              rows={4}
              value={w.scripts.head}
              onChange={(e) => setW({ ...w, scripts: { ...w.scripts, head: e.target.value } })}
              spellCheck={false}
              style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}
              placeholder="<script async src=…></script>"
            />
          </Field>
          <Field label="At the end of the <body>">
            <Textarea
              rows={4}
              value={w.scripts.body_end}
              onChange={(e) => setW({ ...w, scripts: { ...w.scripts, body_end: e.target.value } })}
              spellCheck={false}
              style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}
            />
          </Field>
        </div>
      </Section>

      <div
        className="row"
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'linear-gradient(to top, var(--bg) 70%, transparent)',
          padding: '14px 0 4px',
          justifyContent: 'flex-end',
        }}
      >
        {dirty ? <span className="muted small">Unsaved changes</span> : null}
        <Button variant="primary" disabled={!dirty} loading={busy} onClick={save}>
          Save settings
        </Button>
      </div>
    </>
  );
}

function Account({ user }: { user: User }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const change = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/password', { current, next });
      setCurrent('');
      setNext('');
      toast.ok('Password changed. Other devices were signed out.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Your account"
      desc={
        <>
          <UserRound size={13} style={{ verticalAlign: '-2px' }} /> {user.email}
        </>
      }
    >
      <form
        className="col"
        style={{ gap: 12, maxWidth: 380 }}
        onSubmit={(e) => {
          e.preventDefault();
          void change();
        }}
      >
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 10 characters.">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <div>
          <Button type="submit" loading={busy} disabled={!current || next.length < 10}>
            Change password
          </Button>
        </div>
      </form>
    </Section>
  );
}

export function SettingsPage({ user }: { user: User }) {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsResponse>('/settings') });
  if (q.isLoading || !q.data) return <CenterSpinner />;
  const s = q.data;
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div className="grow">
          <h1>Settings</h1>
          <p>Workspace-wide options. Campaign options live inside each campaign.</p>
        </div>
      </div>
      <div className="stack">
        {/* keyed by a snapshot so the form re-initialises after a save */}
        <WorkspaceForm key={JSON.stringify(s.workspace)} initial={s.workspace} publicHost={new URL(s.urls.public).host} />
        <Section
          title="AI writing"
          desc="Claude can write a personal line for each prospect, draft a version of a block for a particular audience, and tidy weak copy when you import a PDF. Entirely optional."
        >
          <div className="col" style={{ gap: 12 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Sparkles size={18} style={{ color: s.ai.available ? 'var(--brand)' : 'var(--ink-4)', marginTop: 2, flex: 'none' }} />
              {!s.ai.available ? (
                <span className="muted small">
                  <Badge>Off</Badge> Add <code>ANTHROPIC_API_KEY=…</code> to your <code>.env</code> file (or the server’s environment) and
                  restart to turn it on. Everything else works without it.
                </span>
              ) : s.ai.status === 'degraded' ? (
                <span className="small">
                  <Badge tone="warn" dot>
                    Paused
                  </Badge>{' '}
                  <span className="muted" style={{ marginLeft: 6 }}>
                    {s.ai.message ?? 'The AI service had a problem.'} Pages use your fallback text meanwhile. It retries every couple of
                    minutes, or straight away when you press Try it on a campaign’s AI field.
                  </span>
                </span>
              ) : (
                <span>
                  <Badge tone="ok" dot>
                    On
                  </Badge>{' '}
                  <span className="muted small" style={{ marginLeft: 6 }}>
                    Per-prospect copy uses <code>{s.ai.models.fast}</code>; page versions and PDF polish use{' '}
                    <code>{s.ai.models.smart}</code>.
                  </span>
                </span>
              )}
            </div>
            <div
              className="st-help"
              style={{ background: 'var(--bg)', borderRadius: 10, padding: '11px 12px', fontSize: 12.5, lineHeight: 1.5 }}
            >
              <b>What is sent to Anthropic.</b> For AI fields: each prospect’s name, company, job title and any custom fields you send from
              Clay, plus a short summary of the page. Email addresses and LinkedIn URLs are never sent. Persona versions and PDF polish send
              only your own page text.
            </div>
          </div>
        </Section>
        <Account user={user} />
        <Section title="This server">
          <dl className="kv" style={{ gridTemplateColumns: '150px 1fr' }}>
            <dt>Dashboard</dt>
            <dd className="mono">{s.urls.app}</dd>
            <dt>Personalised links</dt>
            <dd className="mono">{s.urls.public}</dd>
            <dt>Largest PDF</dt>
            <dd>{s.limits.max_upload_mb} MB</dd>
          </dl>
        </Section>
      </div>
    </div>
  );
}
