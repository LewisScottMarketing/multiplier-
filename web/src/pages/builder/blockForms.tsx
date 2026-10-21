import {
  Award, Banknote, Briefcase, Calendar, ChartColumn, Check, ChevronDown, ChevronUp, Clock, Compass, FileText, Globe, Handshake, Heart, Layers, Lightbulb, Lock, Mail, Phone, Plus, Puzzle, Rocket, Search, Settings, Shield, Sparkles, Star, Target, Trash2, TrendingUp, Users, Zap,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ICON_NAMES, type Block, type BlockType, type Button as ButtonT, type FormField, type ImageRef } from '@shared/schema';
import { useCampaign } from '../../campaign';
import { ImagePicker } from '../../components/ImagePicker';
import { TokenField } from '../../components/TokenField';
import { Button, Field, Input, Select, SwitchRow } from '../../ui';

export const ICONS: Record<string, LucideIcon> = {
  check: Check, zap: Zap, target: Target, users: Users, clock: Clock, shield: Shield, star: Star, rocket: Rocket, chart: ChartColumn, 'trending-up': TrendingUp,
  mail: Mail, phone: Phone, globe: Globe, lock: Lock, sparkles: Sparkles, calendar: Calendar, 'file-text': FileText, heart: Heart, lightbulb: Lightbulb,
  layers: Layers, handshake: Handshake, search: Search, settings: Settings, puzzle: Puzzle, award: Award, banknote: Banknote, briefcase: Briefcase, compass: Compass,
};

// ── field definitions ───────────────────────────────────────────────────────

export type FieldDef =
  | { kind: 'text'; key: string; label: string; hint?: string; multiline?: boolean; rows?: number; placeholder?: string; mono?: boolean }
  | { kind: 'button'; key: string; label: string; optional?: boolean }
  | { kind: 'image'; key: string; label: string; optional?: boolean; hint?: string; showIf?: (b: Record<string, unknown>) => boolean }
  | { kind: 'select'; key: string; label: string; options: Array<[string | number, string]>; number?: boolean }
  | { kind: 'switch'; key: string; label: string; hint?: string }
  | { kind: 'number'; key: string; label: string; min: number; max: number }
  | { kind: 'icon'; key: string; label: string }
  | { kind: 'list'; key: string; label: string; itemLabel: string; fields: FieldDef[]; make: () => unknown; max?: number; summary?: (item: Record<string, unknown>) => string }
  | { kind: 'strings'; key: string; label: string; placeholder?: string; max?: number; hint?: string }
  | { kind: 'formfields'; key: string };

const t = (key: string, label: string, extra: Partial<Extract<FieldDef, { kind: 'text' }>> = {}): FieldDef => ({ kind: 'text', key, label, ...extra });

export const FORMS: Record<BlockType, FieldDef[]> = {
  hero: [
    t('badge', 'Personal line', { hint: 'The small pill above the headline, e.g. “Prepared for Jane at Acme”.' }),
    t('headline', 'Headline', { multiline: true, rows: 2 }),
    t('subheadline', 'Sub-headline', { multiline: true, rows: 3 }),
    { kind: 'button', key: 'primary', label: 'Main button' },
    { kind: 'button', key: 'secondary', label: 'Second button', optional: true },
    { kind: 'switch', key: 'show_document', label: 'Show the PDF cover', hint: 'Uses the first page of their personalised PDF as the picture.' },
    { kind: 'image', key: 'image', label: 'Picture', optional: true, showIf: (b) => !b.show_document },
    { kind: 'select', key: 'layout', label: 'Layout', options: [['split', 'Text left, picture right'], ['centered', 'Centered']] },
    t('eyebrow', 'Small label above the headline'),
  ],
  note: [
    t('from_name', 'From'),
    t('from_role', 'Role'),
    { kind: 'image', key: 'avatar', label: 'Photo', optional: true },
    t('message', 'Message', { multiline: true, rows: 6 }),
  ],
  text: [t('heading', 'Heading'), t('body', 'Text', { multiline: true, rows: 9, hint: 'Supports **bold**, *italic*, [links](https://…) and “- ” bullet lists.' })],
  features: [
    t('heading', 'Heading'),
    t('intro', 'Intro', { multiline: true, rows: 2 }),
    { kind: 'select', key: 'columns', label: 'Columns', number: true, options: [[2, '2'], [3, '3'], [4, '4']] },
    {
      kind: 'list', key: 'items', label: 'Features', itemLabel: 'Feature', max: 12, make: () => ({ icon: 'zap', title: 'New feature', text: '' }),
      summary: (i) => String(i.title ?? ''),
      fields: [{ kind: 'icon', key: 'icon', label: 'Icon' }, t('title', 'Title'), t('text', 'Description', { multiline: true, rows: 2 })],
    },
  ],
  checklist: [
    t('heading', 'Heading'),
    t('intro', 'Intro', { multiline: true, rows: 2 }),
    { kind: 'select', key: 'style', label: 'Style', options: [['check', 'Checkmarks'], ['bullet', 'Bullets'], ['number', 'Numbers']] },
    { kind: 'strings', key: 'items', label: 'Items', placeholder: 'A point worth making', max: 20 },
  ],
  stats: [
    t('heading', 'Heading'),
    { kind: 'list', key: 'items', label: 'Numbers', itemLabel: 'Number', max: 6, make: () => ({ value: '10x', label: 'what it measures' }), summary: (i) => `${i.value ?? ''} ${i.label ?? ''}`, fields: [t('value', 'Number', { placeholder: '47%' }), t('label', 'Label')] },
  ],
  steps: [
    t('heading', 'Heading'),
    t('intro', 'Intro', { multiline: true, rows: 2 }),
    { kind: 'list', key: 'items', label: 'Steps', itemLabel: 'Step', max: 8, make: () => ({ title: 'New step', text: '' }), summary: (i) => String(i.title ?? ''), fields: [t('title', 'Title'), t('text', 'Description', { multiline: true, rows: 2 })] },
  ],
  testimonial: [
    t('quote', 'Quote', { multiline: true, rows: 4 }),
    t('name', 'Name'),
    t('role', 'Role'),
    t('company', 'Company'),
    { kind: 'image', key: 'avatar', label: 'Photo', optional: true },
    { kind: 'image', key: 'logo', label: 'Company logo', optional: true },
  ],
  logos: [
    t('heading', 'Heading'),
    { kind: 'switch', key: 'grayscale', label: 'Grayscale logos' },
    { kind: 'list', key: 'items', label: 'Logos', itemLabel: 'Logo', max: 12, make: () => ({ src: '', alt: '' }), summary: (i) => String(i.alt || 'Logo'), fields: [{ kind: 'image', key: '', label: 'Logo' }] },
  ],
  image: [{ kind: 'image', key: 'image', label: 'Image' }, t('caption', 'Caption'), { kind: 'select', key: 'width', label: 'Width', options: [['content', 'Content width'], ['wide', 'Wide'], ['full', 'Full width']] }],
  video: [
    t('heading', 'Heading'),
    t('url', 'Video link', { placeholder: 'https://www.loom.com/share/…', hint: 'YouTube, Vimeo, Loom or Wistia. Use a field like {{video_url}} to give every prospect their own video.' }),
    t('caption', 'Caption'),
  ],
  cta: [t('heading', 'Heading'), t('text', 'Text', { multiline: true, rows: 2 }), { kind: 'button', key: 'button', label: 'Button' }, { kind: 'button', key: 'secondary', label: 'Second button', optional: true }],
  form: [
    t('heading', 'Heading'),
    t('intro', 'Intro', { multiline: true, rows: 2 }),
    { kind: 'formfields', key: 'fields' },
    t('button_label', 'Button text'),
    t('success_message', 'Thank-you message', { multiline: true, rows: 2 }),
    t('redirect_url', 'Send them to a link afterwards', { placeholder: 'https://… (optional)' }),
  ],
  calendar: [t('heading', 'Heading'), t('intro', 'Intro', { multiline: true, rows: 2 }), t('url', 'Booking link', { placeholder: 'https://calendly.com/you/intro', hint: 'Calendly, Cal.com or HubSpot meetings. Name and email are prefilled.' }), { kind: 'number', key: 'height', label: 'Height (px)', min: 360, max: 1200 }],
  faq: [t('heading', 'Heading'), { kind: 'list', key: 'items', label: 'Questions', itemLabel: 'Question', max: 15, make: () => ({ q: 'New question', a: '' }), summary: (i) => String(i.q ?? ''), fields: [t('q', 'Question'), t('a', 'Answer', { multiline: true, rows: 3 })] }],
  document: [t('heading', 'Heading'), t('text', 'Text', { multiline: true, rows: 2 }), t('button_label', 'Button text'), { kind: 'switch', key: 'show_preview', label: 'Show a preview of the PDF cover' }],
  html: [t('html', 'HTML', { multiline: true, rows: 12, mono: true, hint: 'Scripts and event handlers are removed for safety. Merge fields work.' })],
  divider: [],
};

// ── controls ────────────────────────────────────────────────────────────────

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const Cur = ICONS[value];
  return (
    <div className="field">
      <label>Icon</label>
      <div>
        <Button size="sm" onClick={() => setOpen((o) => !o)}>{Cur ? <Cur size={15} /> : null} {value || 'None'} <ChevronDown size={13} /></Button>
      </div>
      {open ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, padding: 8, background: 'var(--bg)', borderRadius: 10 }}>
          {ICON_NAMES.map((n) => {
            const I = ICONS[n]!;
            return (
              <button key={n} type="button" title={n} className={`btn icon sm ${n === value ? 'primary' : 'ghost'}`} onClick={() => { onChange(n); setOpen(false); }}>
                <I size={15} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ButtonEditor({ value, onChange, label, optional }: { value: ButtonT | undefined; onChange: (v: ButtonT | undefined) => void; label: string; optional?: boolean }) {
  const c = useCampaign();
  const anchors = c.draft.page.blocks.map((b) => ({ id: b.anchor || b.id, label: `${b.type}${'heading' in b && b.heading ? ` — ${String(b.heading).slice(0, 24)}` : ''}` }));
  if (!value) {
    return (
      <Field label={label}>
        <div><Button size="sm" onClick={() => onChange({ label: 'Learn more', action: { type: 'form' } })}><Plus size={13} /> Add button</Button></div>
      </Field>
    );
  }
  const a = value.action;
  return (
    <div className="col" style={{ gap: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 10 }}>
      <div className="row">
        <b className="small">{label}</b>
        {optional ? <Button size="xs" variant="ghost" className="right" onClick={() => onChange(undefined)}>Remove</Button> : null}
      </div>
      <TokenField small value={value.label} onChange={(v) => onChange({ ...value, label: v })} placeholder="Button text" noTokens />
      <Select small value={a.type} onChange={(e) => {
        const type = e.target.value as ButtonT['action']['type'];
        onChange({ ...value, action: type === 'link' ? { type, url: '' } : type === 'anchor' ? { type, anchor: anchors[0]?.id ?? '' } : ({ type } as ButtonT['action']) });
      }}>
        <option value="link">Open a link (tracked)</option>
        <option value="form">Scroll to the form</option>
        <option value="document">Download their PDF</option>
        <option value="anchor">Scroll to a section</option>
      </Select>
      {a.type === 'link' ? (
        <TokenField small value={a.url} onChange={(v) => onChange({ ...value, action: { type: 'link', url: v } })} placeholder="https://cal.com/you/intro?name={{full_name}}" hint="Merge fields are URL-encoded for you. Clicks are tracked." />
      ) : null}
      {a.type === 'anchor' ? (
        <Select small value={a.anchor} onChange={(e) => onChange({ ...value, action: { type: 'anchor', anchor: e.target.value } })}>
          {anchors.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </Select>
      ) : null}
    </div>
  );
}

const slugKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]+/, '') || 'field';
const QUICK_FIELDS: Array<Pick<FormField, 'key' | 'label' | 'type' | 'prefill'>> = [
  { key: 'name', label: 'Name', type: 'text', prefill: '{{full_name}}' },
  { key: 'email', label: 'Work email', type: 'email', prefill: '{{email}}' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'company', label: 'Company', type: 'text', prefill: '{{company}}' },
  { key: 'message', label: 'Message', type: 'textarea' },
];

function FormFieldsEditor({ value, onChange }: { value: FormField[]; onChange: (v: FormField[]) => void }) {
  const set = (i: number, patch: Partial<FormField>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: number) => {
    const next = [...value];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const unused = QUICK_FIELDS.filter((q) => !value.some((f) => f.key === q.key));
  return (
    <div className="col" style={{ gap: 8 }}>
      <label className="label">Form fields</label>
      {value.map((f, i) => (
        <div key={i} className="col" style={{ gap: 6, padding: 10, border: '1px solid var(--line)', borderRadius: 10 }}>
          <div className="row" style={{ gap: 6 }}>
            <Input small value={f.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Label" aria-label="Field label" />
            <Select small value={f.type} onChange={(e) => set(i, { type: e.target.value as FormField['type'] })} style={{ width: 118 }} aria-label="Field type">
              {['text', 'email', 'tel', 'textarea', 'select', 'checkbox'].map((x) => <option key={x}>{x}</option>)}
            </Select>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <label className="check small"><input type="checkbox" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} /> Required</label>
            <span className="mono muted tiny truncate" title="Key used in Clay and webhooks">{f.key}</span>
            <span className="right row" style={{ gap: 2 }}>
              <Button size="xs" variant="ghost" icon aria-label="Move up" onClick={() => move(i, -1)}><ChevronUp size={13} /></Button>
              <Button size="xs" variant="ghost" icon aria-label="Move down" onClick={() => move(i, 1)}><ChevronDown size={13} /></Button>
              <Button size="xs" variant="ghost" icon aria-label="Remove field" disabled={value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={13} /></Button>
            </span>
          </div>
          {f.type === 'select' ? <Input small value={(f.options ?? []).join(', ')} onChange={(e) => set(i, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="Options, separated by commas" /> : null}
          {f.type !== 'checkbox' ? <TokenField small value={f.prefill ?? ''} onChange={(v) => set(i, { prefill: v || undefined })} placeholder="Prefill, e.g. {{email}}" /> : null}
        </div>
      ))}
      <div className="row wrap" style={{ gap: 6 }}>
        {unused.map((q) => (
          <Button key={q.key} size="xs" onClick={() => onChange([...value, { ...q, required: q.key === 'email' || q.key === 'name' }])}><Plus size={12} /> {q.label}</Button>
        ))}
        <Button size="xs" onClick={() => { const label = `Question ${value.length + 1}`; onChange([...value, { key: slugKey(`${label}_${value.length}`), label, type: 'text', required: false }]); }}><Plus size={12} /> Custom</Button>
      </div>
    </div>
  );
}

function ListEditor({ def, items, onChange }: { def: Extract<FieldDef, { kind: 'list' }>; items: Array<Record<string, unknown>>; onChange: (v: unknown[]) => void }) {
  const [open, setOpen] = useState<number | null>(items.length === 1 ? 0 : null);
  const move = (i: number, d: number) => {
    const next = [...items];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
    setOpen(j);
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <label className="label">{def.label} <span className="muted" style={{ fontWeight: 400 }}>({items.length})</span></label>
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
            <div className="row" style={{ padding: '6px 6px 6px 12px', background: isOpen ? 'var(--panel-2)' : undefined, cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : i)}>
              <span className="grow truncate small"><b>{def.itemLabel} {i + 1}</b> <span className="muted">{def.summary?.(item) ? `· ${def.summary(item)}` : ''}</span></span>
              <Button size="xs" variant="ghost" icon aria-label="Move up" onClick={(e) => { e.stopPropagation(); move(i, -1); }}><ChevronUp size={13} /></Button>
              <Button size="xs" variant="ghost" icon aria-label="Move down" onClick={(e) => { e.stopPropagation(); move(i, 1); }}><ChevronDown size={13} /></Button>
              <Button size="xs" variant="ghost" icon aria-label="Remove" onClick={(e) => { e.stopPropagation(); onChange(items.filter((_, j) => j !== i)); setOpen(null); }}><Trash2 size={13} /></Button>
            </div>
            {isOpen ? (
              <div className="col" style={{ padding: 12, gap: 10 }}>
                {def.fields.map((f, k) => (
                  <FieldRenderer key={k} def={f} value={f.key ? item[f.key] : item} onChange={(v) => onChange(items.map((x, j) => (j === i ? (f.key ? { ...x, [f.key]: v } : (v as Record<string, unknown>)) : x)))} block={item} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {!def.max || items.length < def.max ? (
        <div><Button size="sm" onClick={() => { onChange([...items, def.make()]); setOpen(items.length); }}><Plus size={13} /> Add {def.itemLabel.toLowerCase()}</Button></div>
      ) : null}
    </div>
  );
}

function StringsEditor({ def, items, onChange }: { def: Extract<FieldDef, { kind: 'strings' }>; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <label className="label">{def.label}</label>
      {items.map((it, i) => (
        <div key={i} className="row" style={{ gap: 4, alignItems: 'flex-start' }}>
          <div className="grow"><TokenField small value={it} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} placeholder={def.placeholder} /></div>
          <Button size="xs" variant="ghost" icon aria-label="Remove" style={{ marginTop: 3 }} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={13} /></Button>
        </div>
      ))}
      {!def.max || items.length < def.max ? <div><Button size="sm" onClick={() => onChange([...items, ''])}><Plus size={13} /> Add item</Button></div> : null}
    </div>
  );
}

export function FieldRenderer({ def, value, onChange, block }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; block: Record<string, unknown> }): ReactNode {
  switch (def.kind) {
    case 'text':
      return <TokenField label={def.label} hint={def.hint} multiline={def.multiline} rows={def.rows} placeholder={def.placeholder} mono={def.mono} value={String(value ?? '')} onChange={(v) => onChange(v === '' && !def.multiline ? '' : v)} />;
    case 'button':
      return <ButtonEditor label={def.label} optional={def.optional} value={value as ButtonT | undefined} onChange={onChange} />;
    case 'image':
      if (def.showIf && !def.showIf(block)) return null;
      return <ImagePicker label={def.label} optional={def.optional} hint={def.hint} value={value as ImageRef | undefined} onChange={onChange} />;
    case 'select':
      return (
        <Field label={def.label}>
          <Select small value={String(value ?? '')} onChange={(e) => onChange(def.number ? Number(e.target.value) : e.target.value)}>
            {def.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
      );
    case 'switch':
      return <SwitchRow label={def.label} hint={def.hint} checked={!!value} onChange={onChange} />;
    case 'number':
      return (
        <Field label={def.label}>
          <Input small type="number" min={def.min} max={def.max} value={Number(value ?? def.min)} onChange={(e) => onChange(Math.min(def.max, Math.max(def.min, Number(e.target.value) || def.min)))} />
        </Field>
      );
    case 'icon':
      return <IconPicker value={String(value ?? '')} onChange={onChange} />;
    case 'list':
      return <ListEditor def={def} items={(value as Array<Record<string, unknown>>) ?? []} onChange={onChange} />;
    case 'strings':
      return <StringsEditor def={def} items={(value as string[]) ?? []} onChange={onChange} />;
    case 'formfields':
      return <FormFieldsEditor value={(value as FormField[]) ?? []} onChange={onChange} />;
  }
}

export const blockFields = (b: Block): FieldDef[] => FORMS[b.type];
