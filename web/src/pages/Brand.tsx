import { useQueryClient } from '@tanstack/react-query';
import { FileUp, Globe, Palette, Pencil, Plus, Star, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { inkFor } from '@shared/color';
import { STYLE_PRESETS } from '@shared/presets';
import type { ImageRef } from '@shared/schema';
import { api } from '../api';
import { blankKit, kitOf, useBrands } from '../lib/brands';
import { FONT_OPTIONS, fontCss } from '../lib/fonts';
import type { Brand, BrandKit } from '../types';
import {
  Alert,
  Badge,
  Button,
  CenterSpinner,
  ColorField,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  useConfirm,
  useToast,
} from '../ui';

interface Draft {
  id?: string;
  kit: BrandKit;
}

const logoUrl = (logo: ImageRef | undefined) => (logo?.src && /^ast_/.test(logo.src) ? `/a/${logo.src}` : null);

// ── Setting a brand up ──────────────────────────────────────────────────────

/** The three ways in: read a website, read guidelines, or fill it in by hand. */
function BrandSetup({ onKit, intro }: { onKit: (kit: BrandKit) => void; intro?: boolean }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<'site' | 'guide' | null>(null);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const readSite = async () => {
    if (!url.trim()) return setError('Enter the address of your website first.');
    setError('');
    setBusy('site');
    try {
      onKit((await api.post<{ kit: BrandKit }>('/brands/read-website', { url })).kit);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read that site.');
    } finally {
      setBusy(null);
    }
  };
  const readGuide = async (f: File) => {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return setError('Please choose a PDF file.');
    setError('');
    setBusy('guide');
    try {
      const form = new FormData();
      form.set('file', f);
      onKit((await api.upload<{ kit: BrandKit }>('/brands/read-guidelines', form)).kit);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read those guidelines.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card brand-setup">
      {intro ? (
        <EmptyState icon={<Palette size={24} />} title="Make every page follow your brand">
          Optional. Give us your colours, typefaces, logo and how you write, and new pages, imported PDFs and the AI all follow them. Set it
          up once, however is easiest.
        </EmptyState>
      ) : (
        <h3 style={{ marginBottom: 14 }}>Add a brand</h3>
      )}
      {error ? (
        <div style={{ margin: '0 0 14px' }}>
          <Alert tone="bad">{error}</Alert>
        </div>
      ) : null}
      <div className="setup-options">
        <div className="setup-option">
          <b>
            <Globe size={16} /> From a website
          </b>
          <p className="muted small">We read its colours, typefaces and logo, and (with AI on) describe how its writing sounds.</p>
          <div className="row" style={{ gap: 8 }}>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourcompany.com"
              aria-label="Website address"
              onKeyDown={(e) => e.key === 'Enter' && void readSite()}
              disabled={busy !== null}
            />
            <Button variant="primary" onClick={readSite} loading={busy === 'site'} disabled={busy !== null}>
              Read it
            </Button>
          </div>
        </div>
        <div className="setup-option">
          <b>
            <FileUp size={16} /> From brand guidelines
          </b>
          <p className="muted small">
            Upload your brand book as a PDF. With AI on, Claude reads the pages for colours, typefaces, voice and rules.
          </p>
          <Button onClick={() => file.current?.click()} loading={busy === 'guide'} disabled={busy !== null}>
            <Upload size={15} /> Choose a PDF
          </Button>
          <input
            ref={file}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readGuide(f);
              e.target.value = '';
            }}
          />
        </div>
        <div className="setup-option">
          <b>
            <Pencil size={16} /> By hand
          </b>
          <p className="muted small">Pick the colours and typefaces yourself and write down how you want to sound.</p>
          <Button onClick={() => onKit(blankKit())} disabled={busy !== null}>
            Start from scratch
          </Button>
        </div>
      </div>
      {busy ? (
        <p className="muted small" style={{ marginTop: 14 }}>
          <Spinner size={14} />{' '}
          {busy === 'site'
            ? 'Reading the site. This takes a few seconds.'
            : 'Reading the guidelines. With AI on, this can take up to a minute.'}
        </p>
      ) : null}
    </div>
  );
}

// ── The editor ──────────────────────────────────────────────────────────────

const parseList = (text: string, max: number) =>
  [
    ...new Set(
      text
        .split(/\n|,/)
        .map((s) => s.trim().slice(0, 60))
        .filter(Boolean),
    ),
  ].slice(0, max);

function ListField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  max,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max: number;
}) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => {
    if (JSON.stringify(parseList(text, max)) !== JSON.stringify(value)) setText(value.join('\n'));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field label={label} hint={hint}>
      <Textarea
        rows={3}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseList(e.target.value, max));
        }}
      />
    </Field>
  );
}

function OptionalColor({
  label,
  hint,
  value,
  onChange,
  fallback,
}: {
  label: string;
  hint: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  fallback: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {value ? (
        <div className="row" style={{ gap: 8 }}>
          <ColorField value={value} onChange={onChange} />
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined)} aria-label={`Remove ${label.toLowerCase()}`}>
            <X size={14} />
          </Button>
        </div>
      ) : (
        <div>
          <Button size="sm" onClick={() => onChange(fallback)}>
            <Plus size={14} /> Add
          </Button>
        </div>
      )}
    </Field>
  );
}

function LogoPicker({ value, onChange }: { value: ImageRef | undefined; onChange: (v: ImageRef | undefined) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const url = logoUrl(value);
  const upload = async (f: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', f);
      const r = await api.upload<{ asset: { id: string } }>('/assets', form);
      onChange({ src: r.asset.id, alt: value?.alt ?? '' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row" style={{ gap: 14, alignItems: 'center' }}>
      <div className="logo-box">{url ? <img src={url} alt={value?.alt || 'Logo'} /> : <span className="muted tiny">No logo</span>}</div>
      <div className="col" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" onClick={() => input.current?.click()} loading={busy}>
            <Upload size={14} /> {url ? 'Replace' : 'Upload'}
          </Button>
          {url ? (
            <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
              Remove
            </Button>
          ) : null}
        </div>
        <span className="hint">PNG, JPEG or WebP on a transparent or plain background. SVG isn’t supported.</span>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** A small page in the brand's colours and typefaces, so a change shows at once. */
function BrandPreview({ kit }: { kit: BrandKit }) {
  const bg = kit.bg ?? '#ffffff';
  const dark = kit.dark ?? '#0f1224';
  const heading = fontCss(kit.heading_font ?? kit.body_font ?? 'inter');
  const logo = logoUrl(kit.logo);
  return (
    <div
      className="brand-preview"
      style={{ background: bg, color: kit.text ?? '#0f172a', fontFamily: fontCss(kit.body_font ?? 'inter') }}
      aria-label="Preview"
    >
      <div className="bp-top">{logo ? <img src={logo} alt="" /> : <b style={{ fontFamily: heading }}>{kit.name || 'Your brand'}</b>}</div>
      <h4 style={{ fontFamily: heading }}>Pages that sound like you wrote them</h4>
      <p>A short line of body copy in your body typeface, so you can see how it reads.</p>
      <div className="row" style={{ gap: 8 }}>
        <span className="bp-btn" style={{ background: kit.brand, color: inkFor(kit.brand) }}>
          Book a call
        </span>
        {kit.accent ? (
          <span className="bp-btn" style={{ background: kit.accent, color: inkFor(kit.accent) }}>
            Accent
          </span>
        ) : null}
      </div>
      <div className="bp-dark" style={{ background: dark, color: inkFor(dark) }}>
        A dark section
      </div>
    </div>
  );
}

const SOURCE_LABEL = { manual: 'Written by hand', website: 'Read from a website', guidelines: 'Read from brand guidelines' } as const;

function BrandEditor({
  draft,
  saved,
  onChange,
  onSave,
  onDelete,
  onDefault,
  saving,
}: {
  draft: Draft;
  saved: Brand | undefined;
  onChange: (kit: BrandKit) => void;
  onSave: () => void;
  onDelete: () => void;
  onDefault: () => void;
  saving: boolean;
}) {
  const kit = draft.kit;
  const set = (patch: Partial<BrandKit>) => onChange({ ...kit, ...patch });
  const dirty = !saved || JSON.stringify(kit) !== JSON.stringify(kitOf(saved));
  const notes = kit.source.notes;
  return (
    <div className="col" style={{ gap: 16, minWidth: 0 }}>
      {!draft.id && notes.length ? (
        <Alert>
          <b>Have a look, then save.</b> Nothing is kept until you do, and everything here can be changed.
        </Alert>
      ) : null}

      <section className="card brand-sec">
        <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div className="grow" style={{ minWidth: 240 }}>
            <Field label="Name">
              <Input value={kit.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
            </Field>
          </div>
          <div className="row" style={{ gap: 8, paddingTop: 22 }}>
            {saved && !saved.is_default ? (
              <Button onClick={onDefault}>
                <Star size={14} /> Make default
              </Button>
            ) : null}
            {saved?.is_default ? <Badge tone="brand">Default brand</Badge> : null}
            {draft.id ? (
              <Button variant="danger" onClick={onDelete} aria-label="Delete this brand">
                <Trash2 size={14} />
              </Button>
            ) : null}
            <Button variant="primary" onClick={onSave} loading={saving} disabled={!dirty || !kit.name.trim()}>
              {draft.id ? 'Save changes' : 'Save brand'}
            </Button>
          </div>
        </div>
      </section>

      <div className="brand-grid">
        <div className="col" style={{ gap: 16, minWidth: 0 }}>
          <section className="card brand-sec">
            <h3>Colours</h3>
            <div className="brand-colors">
              <Field label="Brand colour" hint="Buttons, links and highlights.">
                <ColorField value={kit.brand} onChange={(v) => set({ brand: v })} />
              </Field>
              <OptionalColor
                label="Accent"
                hint="A second colour for variety."
                value={kit.accent}
                onChange={(v) => set({ accent: v })}
                fallback="#0ea5e9"
              />
              <OptionalColor
                label="Background"
                hint="Left out, the style decides."
                value={kit.bg}
                onChange={(v) => set({ bg: v })}
                fallback="#fbf8f3"
              />
              <OptionalColor
                label="Text"
                hint="Body text. Kept readable on the background."
                value={kit.text}
                onChange={(v) => set({ text: v })}
                fallback="#0f172a"
              />
              <OptionalColor
                label="Dark sections"
                hint="The background of dark bands."
                value={kit.dark}
                onChange={(v) => set({ dark: v })}
                fallback="#0f1224"
              />
            </div>
          </section>

          <section className="card brand-sec">
            <h3>Typefaces and look</h3>
            <div className="brand-colors">
              <Field label="Headings">
                <Select
                  value={kit.heading_font ?? ''}
                  onChange={(e) => set({ heading_font: (e.target.value || undefined) as BrandKit['heading_font'] })}
                >
                  <option value="">Let the style decide</option>
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Body text">
                <Select
                  value={kit.body_font ?? ''}
                  onChange={(e) => set({ body_font: (e.target.value || undefined) as BrandKit['body_font'] })}
                >
                  <option value="">Let the style decide</option>
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Your own typefaces" hint="For reference. We can only serve ours, so pick the closest above.">
                <Input
                  value={kit.font_names}
                  onChange={(e) => set({ font_names: e.target.value })}
                  placeholder="Headings: Canela; Body: Graphik"
                  maxLength={160}
                />
              </Field>
              <Field label="Look" hint="One click sets corners, cards and spacing.">
                <Select value={kit.style ?? ''} onChange={(e) => set({ style: e.target.value || undefined })}>
                  <option value="">Keep the page’s look</option>
                  {STYLE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}: {p.blurb}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div style={{ marginTop: 16 }}>
              <Field label="Logo" hint="Shown in the page header.">
                <LogoPicker value={kit.logo} onChange={(v) => set({ logo: v })} />
              </Field>
            </div>
          </section>

          <section className="card brand-sec">
            <h3>Voice and rules</h3>
            <p className="muted small" style={{ marginTop: -4, marginBottom: 12 }}>
              The AI follows these when it designs a page from a PDF, writes a line for a prospect or rewrites a block for an audience.
            </p>
            <Field label="How you sound">
              <Textarea
                rows={3}
                value={kit.voice}
                onChange={(e) => set({ voice: e.target.value })}
                maxLength={800}
                placeholder="Warm, plain and specific. Short sentences. We talk to people like colleagues."
              />
            </Field>
            <div className="brand-colors" style={{ marginTop: 14 }}>
              <ListField
                label="Words and phrases to use"
                hint="One per line."
                value={kit.use}
                onChange={(v) => set({ use: v })}
                max={20}
                placeholder="teams&#10;straight answers"
              />
              <ListField
                label="Never use"
                hint="One per line."
                value={kit.avoid}
                onChange={(v) => set({ avoid: v })}
                max={30}
                placeholder="synergy&#10;leverage"
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <Field label="Other rules">
                <Textarea
                  rows={3}
                  value={kit.rules}
                  onChange={(e) => set({ rules: e.target.value })}
                  maxLength={2000}
                  placeholder="Never promise results. Speak to the reader as “you”."
                />
              </Field>
            </div>
          </section>
        </div>

        <aside className="col" style={{ gap: 16, minWidth: 0 }}>
          <BrandPreview kit={kit} />
          <section className="card brand-sec">
            <h3>Where this came from</h3>
            <p className="small" style={{ marginBottom: notes.length ? 8 : 0 }}>
              {SOURCE_LABEL[kit.source.type]}
              {kit.source.url ? (
                <>
                  : <span className="muted">{kit.source.url}</span>
                </>
              ) : kit.source.filename ? (
                <>
                  : <span className="muted">{kit.source.filename}</span>
                </>
              ) : null}
            </p>
            {notes.length ? (
              <ul className="small brand-notes">
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export function BrandPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useBrands();
  const brands = q.data?.brands ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  // open the default brand when there is one and nothing else is open
  useEffect(() => {
    if (!draft && !adding && brands.length) setDraft({ id: brands[0]!.id, kit: kitOf(brands[0]!) });
  }, [brands.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = draft?.id ? brands.find((b) => b.id === draft.id) : undefined;
  const refresh = () => qc.invalidateQueries({ queryKey: ['brands'] });

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = draft.id
        ? await api.put<{ brand: Brand }>(`/brands/${draft.id}`, draft.kit)
        : await api.post<{ brand: Brand }>('/brands', draft.kit);
      setDraft({ id: r.brand.id, kit: kitOf(r.brand) });
      setAdding(false);
      await refresh();
      toast.ok('Brand saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Couldn’t save the brand');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    const ok = await confirm({
      title: `Delete “${draft.kit.name}”?`,
      body: 'Pages already using this brand keep their colours and typefaces. New campaigns will follow the next brand instead.',
      confirm: 'Delete brand',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/brands/${draft.id}`);
      setDraft(null);
      await refresh();
      toast.ok('Brand deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Couldn’t delete the brand');
    }
  };

  const makeDefault = async () => {
    if (!draft?.id) return;
    try {
      await api.post(`/brands/${draft.id}/default`);
      await refresh();
      toast.ok('Now the default brand');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Couldn’t change the default');
    }
  };

  const unsaved = !!draft && !draft.id;
  const showSetup = !draft;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Brand</h1>
          <p>
            Your colours, typefaces, logo and voice. New pages, imported PDFs and the AI follow them. Optional: everything works without it.
          </p>
        </div>
        {brands.length || draft ? (
          <Button
            variant="primary"
            onClick={() => {
              setDraft(null);
              setAdding(true);
            }}
          >
            <Plus size={16} /> Add a brand
          </Button>
        ) : null}
      </div>

      {q.isLoading ? (
        <CenterSpinner />
      ) : showSetup && !brands.length ? (
        <BrandSetup intro onKit={(kit) => setDraft({ kit })} />
      ) : (
        <div className="brand-layout">
          <nav className="brand-list" aria-label="Brands">
            {brands.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`brand-item ${draft?.id === b.id ? 'on' : ''}`}
                onClick={() => {
                  setAdding(false);
                  setDraft({ id: b.id, kit: kitOf(b) });
                }}
              >
                <span className="swatch-pair">
                  <i style={{ background: b.brand }} />
                  <i style={{ background: b.accent ?? b.dark ?? b.text ?? 'var(--line-2)' }} />
                </span>
                <span className="grow truncate">{b.name}</span>
                {b.is_default ? <Badge tone="brand">Default</Badge> : null}
              </button>
            ))}
            {unsaved ? (
              <div className="brand-item on" aria-current="true">
                <span className="swatch-pair">
                  <i style={{ background: draft!.kit.brand }} />
                  <i style={{ background: draft!.kit.accent ?? 'var(--line-2)' }} />
                </span>
                <span className="grow truncate">{draft!.kit.name}</span>
                <Badge tone="warn">Unsaved</Badge>
              </div>
            ) : null}
          </nav>
          {draft ? (
            <BrandEditor
              key={draft.id ?? 'new'}
              draft={draft}
              saved={saved}
              onChange={(kit) => setDraft({ ...draft, kit })}
              onSave={save}
              onDelete={remove}
              onDefault={makeDefault}
              saving={saving}
            />
          ) : (
            <BrandSetup onKit={(kit) => setDraft({ kit })} />
          )}
        </div>
      )}
    </div>
  );
}
