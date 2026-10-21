import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AiField } from '@shared/schema';
import { api } from '../api';
import { useCampaign } from '../campaign';
import { PreviewAs, sourceToApi } from '../components/PreviewAs';
import { Alert, Badge, Button, CopyBox, Field, Input, Menu, Select, SwitchRow, Textarea, useToast } from '../ui';
import { useQuery } from '@tanstack/react-query';
import type { SettingsResponse } from '../types';

function Section({ title, desc, children, right }: { title: string; desc?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
        <div className="grow">
          <h2>{title}</h2>
          {desc ? (
            <p className="muted small" style={{ marginTop: 3, maxWidth: 620 }}>
              {desc}
            </p>
          ) : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const AI_PRESETS: Array<{ label: string; field: Omit<AiField, 'fallback'> & { fallback: string } }> = [
  {
    label: 'Personal opening line',
    field: {
      key: 'opening',
      label: 'Opening line',
      prompt:
        'Write one warm, specific sentence that opens a landing page for this person. Refer to their role or company in a believable way. No flattery, no emoji, no exclamation marks.',
      max_chars: 200,
      fallback: 'We put this together for teams like yours.',
    },
  },
  {
    label: 'Why this matters to them',
    field: {
      key: 'why_it_matters',
      label: 'Why it matters',
      prompt:
        'In two short sentences, explain why the material on this page is relevant to someone with this job title at this company. Be concrete and avoid buzzwords.',
      max_chars: 320,
      fallback: 'It covers the questions leaders in your position usually ask first.',
    },
  },
  {
    label: 'Industry angle',
    field: {
      key: 'industry_angle',
      label: 'Industry angle',
      prompt:
        'Write one sentence connecting the topic of this page to the likely industry this company operates in. If the industry is unclear, stay general.',
      max_chars: 220,
      fallback: '',
    },
  },
];

const cleanKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);

export function CampaignSettings() {
  const c = useCampaign();
  const toast = useToast();
  const s = c.draft.settings;
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsResponse>('/settings') });
  const domains = settings.data?.workspace.domains ?? [];
  const [slug, setSlug] = useState(c.campaign.slug);
  const [savingSlug, setSavingSlug] = useState(false);
  useEffect(() => setSlug(c.campaign.slug), [c.campaign.slug]);

  // "Try it": write one AI field for whoever is being previewed, so the prompt can be tuned before any prospect sees it
  const [tries, setTries] = useState<
    Record<number, { busy: boolean; text?: string; fallback?: boolean; warnings?: string[]; error?: string }>
  >({});
  const tryField = async (i: number) => {
    setTries((t) => ({ ...t, [i]: { busy: true } }));
    try {
      const r = await api.post<{ text: string; used_fallback: boolean; warnings: Array<{ message: string }> }>(
        `/campaigns/${c.id}/ai/field-preview`,
        { field: s.ai_fields[i], source: sourceToApi(c.previewSource) },
      );
      setTries((t) => ({
        ...t,
        [i]: { busy: false, text: r.text, fallback: r.used_fallback, warnings: r.warnings.map((w) => w.message) },
      }));
    } catch (e) {
      setTries((t) => ({ ...t, [i]: { busy: false, error: e instanceof Error ? e.message : 'Couldn’t try that.' } }));
    }
  };

  const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const genericUrl = `${c.detail.public_url}/c/${c.campaign.slug}`;

  const saveSlug = async () => {
    setSavingSlug(true);
    try {
      await c.save.flush(); // reload() below replaces the draft, so make sure nothing is left unsaved
      await api.put(`/campaigns/${c.id}`, { slug });
      await c.reload();
      toast.ok('URL name updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change the URL name');
    } finally {
      setSavingSlug(false);
    }
  };

  const requiredCandidates = c.fields.filter(
    (f) => ['person', 'company'].includes(f.group) && !['full_name', 'company_short', 'domain'].includes(f.key),
  );
  const toggleRequired = (key: string, on: boolean) =>
    c.setSettings((st) => ({
      ...st,
      required_fields: on ? [...new Set([...st.required_fields, key])] : st.required_fields.filter((k) => k !== key),
    }));

  const setAi = (i: number, patch: Partial<AiField>) =>
    c.setSettings((st) => ({ ...st, ai_fields: st.ai_fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const addAi = (field: AiField) =>
    c.setSettings((st) => {
      let key = field.key;
      for (let n = 2; st.ai_fields.some((f) => f.key === key); n++) key = `${field.key}_${n}`;
      return { ...st, ai_fields: [...st.ai_fields, { ...field, key }] };
    });

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div className="page-head">
        <div className="grow">
          <h1>Campaign settings</h1>
          <p>How links are built, what Clay has to send, and optional AI-written copy.</p>
        </div>
      </div>

      <div className="stack">
        <Section
          title="Link"
          desc="Every prospect gets their own private link. This is the shared “generic” link, which works for anyone and uses fallbacks for names."
        >
          <div className="col" style={{ gap: 14 }}>
            <Field
              label="URL name"
              error={!slugOk ? 'Use lowercase letters, numbers and dashes.' : undefined}
              hint="Clay uses this (or the campaign ID) to pick the campaign. Changing it breaks the generic link and any Clay column that refers to the old name."
            >
              <div className="input-group">
                <span
                  className="input"
                  style={{
                    width: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    background: 'var(--bg)',
                    color: 'var(--ink-3)',
                    borderRight: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  /c/
                </span>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))}
                  style={{ borderRadius: 0 }}
                />
                <Button disabled={!slugOk || slug === c.campaign.slug} loading={savingSlug} onClick={saveSlug}>
                  Save
                </Button>
              </div>
            </Field>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>
                Generic link
              </div>
              <CopyBox text={genericUrl} />
            </div>
            <div className="row">
              <div className="grow">
                <div className="label">Campaign ID</div>
                <div className="hint">
                  Stable even if you rename the campaign. Use it as <code>"campaign"</code> in API calls.
                </div>
              </div>
              <span className="mono small">{c.id}</span>
            </div>
            <Field
              label="Link domain"
              hint={
                domains.length ? (
                  'Links for this campaign use this domain.'
                ) : (
                  <>
                    Add your own domains (for example <code>go.yourbrand.com</code>) under <Link to="/settings">Settings</Link>.
                  </>
                )
              }
            >
              <Select
                value={s.domain ?? ''}
                onChange={(e) => c.setSettings((st) => ({ ...st, domain: e.target.value || undefined }))}
                disabled={!domains.length}
              >
                <option value="">Default ({new URL(c.detail.public_url).host})</option>
                {domains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section
          title="What Clay has to send"
          desc="If a row is missing one of these, the API replies with an error instead of creating a link, so nobody receives a page that says “Hi ,”."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {requiredCandidates.map((f) => {
              const on = s.required_fields.includes(f.key);
              return (
                <label
                  key={f.key}
                  className="check"
                  style={{
                    padding: '8px 10px',
                    border: `1px solid ${on ? 'var(--brand)' : 'var(--line)'}`,
                    background: on ? 'var(--brand-50)' : 'var(--panel)',
                    borderRadius: 9,
                  }}
                >
                  <input type="checkbox" checked={on} onChange={(e) => toggleRequired(f.key, e.target.checked)} />
                  <span>
                    <b style={{ fontWeight: 600 }}>{f.label}</b>
                    <br />
                    <span className="mono muted tiny">{`{{${f.key}}}`}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {!s.required_fields.length ? (
            <p className="hint" style={{ marginTop: 10 }}>
              Nothing is required. Missing values use the fallbacks you set in the page, for example <code>{'{{first_name|there}}'}</code>.
            </p>
          ) : null}
        </Section>

        <Section title="Names and text">
          <div className="col" style={{ gap: 16 }}>
            <SwitchRow
              label="Tidy names automatically"
              hint="Fixes “JANE DOE”, “jane doe” and trailing credentials from enrichment tools, so pages read like a person wrote them."
              checked={s.clean_names}
              onChange={(v) => c.setSettings((st) => ({ ...st, clean_names: v }))}
            />
            <hr className="divider" style={{ margin: 0 }} />
            <SwitchRow
              label="Personalise the generic link from URL parameters"
              hint={
                <>
                  Lets <code>{`/c/${c.campaign.slug}?first_name=Jane&company=Acme`}</code> fill in the page without creating a prospect.
                  Anyone can put text in a URL, so leave this off unless you need it.
                </>
              }
              checked={s.allow_url_params}
              onChange={(v) => c.setSettings((st) => ({ ...st, allow_url_params: v }))}
            />
          </div>
        </Section>

        <Section
          title="AI-written fields"
          desc={
            <>
              Ask Claude to write a line of copy for each prospect from their details, then drop it in anywhere with{' '}
              <code>{'{{ai_opening}}'}</code>. If AI isn’t available, or it fails for a row, the fallback text is used, so a page is never
              left blank.
            </>
          }
          right={
            <Menu
              trigger={(_o, toggle) => (
                <Button size="sm" onClick={toggle} disabled={s.ai_fields.length >= 8}>
                  <Plus size={14} /> Add field
                </Button>
              )}
            >
              {(close) => (
                <>
                  {AI_PRESETS.map((p) => (
                    <button
                      key={p.field.key}
                      onClick={() => {
                        addAi(p.field);
                        close();
                      }}
                    >
                      <Sparkles size={14} /> {p.label}
                    </button>
                  ))}
                  <hr />
                  <button
                    onClick={() => {
                      addAi({ key: 'custom', label: 'Custom', prompt: '', max_chars: 220, fallback: '' });
                      close();
                    }}
                  >
                    Blank field
                  </button>
                </>
              )}
            </Menu>
          }
        >
          {!c.detail.ai_available ? (
            <div style={{ marginBottom: 14 }}>
              <Alert>
                AI isn’t switched on for this server. Set <code>ANTHROPIC_API_KEY</code> to enable it. Until then these fields show their
                fallback text.
              </Alert>
            </div>
          ) : null}
          {!s.ai_fields.length ? (
            <p className="muted small">No AI fields yet. Use “Add field” for a ready-made starting point.</p>
          ) : (
            <div className="col" style={{ gap: 14 }}>
              <div className="row small muted">
                Try fields as <PreviewAs />
              </div>
              {s.ai_fields.map((f, i) => (
                <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14 }} className="col">
                  <div className="row">
                    <span className="badge brand mono">{`{{ai_${f.key}}}`}</span>
                    <div className="grow" />
                    <Button
                      size="xs"
                      variant="ghost"
                      icon
                      aria-label="Remove this AI field"
                      onClick={() => c.setSettings((st) => ({ ...st, ai_fields: st.ai_fields.filter((_, j) => j !== i) }))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="Name">
                      <Input value={f.label} onChange={(e) => setAi(i, { label: e.target.value })} placeholder="Opening line" />
                    </Field>
                    <Field label="Token name" hint="Letters, numbers and underscores.">
                      <Input
                        value={f.key}
                        onChange={(e) => setAi(i, { key: cleanKey(e.target.value) || 'field' })}
                        style={{ fontFamily: 'var(--mono)' }}
                      />
                    </Field>
                  </div>
                  <Field
                    label="What should it write?"
                    hint="Describe the copy. Claude is given the prospect’s name, title, company and any other data you send."
                  >
                    <Textarea rows={3} value={f.prompt} onChange={(e) => setAi(i, { prompt: e.target.value })} />
                  </Field>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 12 }}>
                    <Field label="Fallback" hint="Shown when AI is off, slow, or has nothing to say.">
                      <Input value={f.fallback} onChange={(e) => setAi(i, { fallback: e.target.value })} />
                    </Field>
                    <Field label="Max characters">
                      <Input
                        type="number"
                        min={20}
                        max={1000}
                        value={f.max_chars}
                        onChange={(e) => setAi(i, { max_chars: Math.min(1000, Math.max(20, Number(e.target.value) || 220)) })}
                      />
                    </Field>
                  </div>
                  <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                    <Button
                      size="sm"
                      loading={tries[i]?.busy}
                      disabled={!c.detail.ai_available || !f.prompt.trim()}
                      title={
                        c.detail.ai_available
                          ? 'Write this field once for the person you’re previewing'
                          : 'AI isn’t switched on for this server'
                      }
                      onClick={() => void tryField(i)}
                    >
                      <Sparkles size={14} /> Try it
                    </Button>
                    {tries[i] && !tries[i]!.busy ? (
                      <div className="grow" style={{ background: 'var(--bg)', borderRadius: 10, padding: '9px 12px', fontSize: 13 }}>
                        {tries[i]!.error ? (
                          <span style={{ color: 'var(--bad)' }}>{tries[i]!.error}</span>
                        ) : (
                          <>
                            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                              {tries[i]!.fallback ? <Badge tone="warn">Fallback used</Badge> : <Badge tone="ok">AI-written</Badge>}
                              <span className="muted tiny">{tries[i]!.text?.length ?? 0} characters</span>
                            </div>
                            <div>{tries[i]!.text || <span className="muted">Nothing (the field would be empty).</span>}</div>
                            {tries[i]!.warnings?.map((w, j) => (
                              <div key={j} className="tiny" style={{ color: 'var(--warn)', marginTop: 4 }}>
                                {w}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
