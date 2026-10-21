import { Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useCampaign } from '../../campaign';
import { ImagePicker } from '../../components/ImagePicker';
import { TokenField } from '../../components/TokenField';
import { Button, ColorField, Field, Input, Select, SwitchRow } from '../../ui';
import { ButtonEditor } from './blockForms';

function Group({ title, children, open: initial = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="be-sec">
      <button type="button" className="be-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <h4>{title}</h4>
        <span className="muted">{open ? '−' : '+'}</span>
      </button>
      {open ? <div className="col" style={{ gap: 14 }}>{children}</div> : null}
    </section>
  );
}

export function DesignPanel() {
  const c = useCampaign();
  const { theme, header, footer, seo } = c.draft.page;
  const set = <K extends 'theme' | 'header' | 'footer' | 'seo'>(k: K, patch: Partial<(typeof c.draft.page)[K]>) =>
    c.setPage((p) => ({ ...p, [k]: { ...p[k], ...patch } }), { coalesce: `design:${k}:${Object.keys(patch)[0]}` });
  const FONTS = [['inter', 'Inter (modern)'], ['system', 'System'], ['serif', 'Serif'], ['mono', 'Monospace']];

  return (
    <div>
      <Group title="Colours & style" open>
        <Field label="Brand colour" hint="Buttons, accents and highlights."><ColorField value={theme.brand} onChange={(v) => set('theme', { brand: v })} /></Field>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <Field label="Font"><Select small value={theme.font} onChange={(e) => set('theme', { font: e.target.value as typeof theme.font })}>{FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Corners"><Select small value={theme.radius} onChange={(e) => set('theme', { radius: e.target.value as typeof theme.radius })}><option value="sharp">Sharp</option><option value="soft">Soft</option><option value="round">Round</option></Select></Field>
        </div>
        <Field label="Page width"><Select small value={theme.width} onChange={(e) => set('theme', { width: e.target.value as typeof theme.width })}><option value="narrow">Narrow</option><option value="normal">Standard</option><option value="wide">Wide</option></Select></Field>
        <Field label="Heading font"><Select small value={theme.heading_font ?? ''} onChange={(e) => set('theme', { heading_font: (e.target.value || undefined) as typeof theme.heading_font })}><option value="">Same as body</option>{FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label="Page background"><ColorField value={theme.bg} onChange={(v) => set('theme', { bg: v })} /></Field>
          <Field label="Soft tint"><ColorField value={theme.alt_bg} onChange={(v) => set('theme', { alt_bg: v })} /></Field>
          <Field label="Dark sections"><ColorField value={theme.dark_bg} onChange={(v) => set('theme', { dark_bg: v })} /></Field>
          <Field label="Text"><ColorField value={theme.text} onChange={(v) => set('theme', { text: v })} /></Field>
          <Field label="Muted text"><ColorField value={theme.muted} onChange={(v) => set('theme', { muted: v })} /></Field>
        </div>
      </Group>

      <Group title="Header">
        <SwitchRow label="Show a header" checked={header.enabled} onChange={(v) => set('header', { enabled: v })} />
        {header.enabled ? (
          <>
            <ImagePicker label="Logo" optional value={header.logo} onChange={(v) => set('header', { logo: v })} withAlt={false} />
            <TokenField label="Or logo text" noTokens value={header.logo_text ?? ''} onChange={(v) => set('header', { logo_text: v || undefined })} placeholder="Your company" />
            <ButtonEditor label="Header button" optional value={header.button} onChange={(v) => set('header', { button: v })} />
            <SwitchRow label="Stick to the top" checked={header.sticky} onChange={(v) => set('header', { sticky: v })} />
          </>
        ) : null}
      </Group>

      <Group title="Footer">
        <TokenField label="Footer text" multiline rows={3} value={footer.text} onChange={(v) => set('footer', { text: v })} placeholder="© Your Company · Prepared for {{first_name|you}}" />
        <div className="col" style={{ gap: 8 }}>
          <label className="label">Links</label>
          {footer.links.map((l, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <Input small value={l.label} placeholder="Label" onChange={(e) => set('footer', { links: footer.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Input small value={l.url} placeholder="https://…" onChange={(e) => set('footer', { links: footer.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
              <Button size="xs" variant="ghost" icon aria-label="Remove link" onClick={() => set('footer', { links: footer.links.filter((_, j) => j !== i) })}><Trash2 size={13} /></Button>
            </div>
          ))}
          {footer.links.length < 8 ? <div><Button size="sm" onClick={() => set('footer', { links: [...footer.links, { label: 'Privacy', url: 'https://' }] })}><Plus size={13} /> Add link</Button></div> : null}
        </div>
      </Group>

      <Group title="Search & sharing">
        <TokenField label="Page title" value={seo.title} onChange={(v) => set('seo', { title: v })} placeholder="A plan for {{company|your team}}" hint="Shown in the browser tab and when the link is shared." />
        <TokenField label="Description" multiline rows={2} value={seo.description} onChange={(v) => set('seo', { description: v })} />
        <ImagePicker label="Share image" optional withAlt={false} value={seo.og_image} onChange={(v) => set('seo', { og_image: v })} hint="Defaults to the PDF cover when there is one." />
        <SwitchRow label="Hide from search engines" hint="Recommended: personalised pages contain personal details." checked={seo.noindex} onChange={(v) => set('seo', { noindex: v })} />
      </Group>

      <Group title="Custom CSS">
        <Field hint="Advanced. Appended after the theme.">
          <textarea className="textarea" rows={8} spellCheck={false} style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }} value={c.draft.page.custom_css ?? ''} onChange={(e) => c.setPage((p) => ({ ...p, custom_css: e.target.value || undefined }), { coalesce: 'css' })} placeholder=".btn-primary { text-transform: uppercase; }" />
        </Field>
      </Group>
    </div>
  );
}
