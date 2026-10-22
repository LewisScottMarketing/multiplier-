import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { applyBrand } from '@shared/brand';
import { contrast, shiftHue } from '@shared/color';
import { withPreset } from '@shared/presets';
import { api } from '../../api';
import { useCampaign } from '../../campaign';
import { BrandField } from '../../components/BrandSelect';
import { ImagePicker } from '../../components/ImagePicker';
import { TokenField } from '../../components/TokenField';
import { useBrands } from '../../lib/brands';
import { FONT_OPTIONS } from '../../lib/fonts';
import type { Campaign } from '../../types';
import { Button, ColorField, Field, Input, Modal, Segmented, Select, SwitchRow, useToast } from '../../ui';
import { ButtonEditor } from './blockForms';
import { StyleGallery } from './StyleGallery';

/** The languages offered for the page; whatever a page already has is added to the list when it isn't one of these. */
const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'tr', 'ja', 'zh', 'ko'];
const languageName = (code: string): string => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
};

function Group({ title, children, open: initial = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="be-sec">
      <button type="button" className="be-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <h4>{title}</h4>
        <span className="muted">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <div className="col" style={{ gap: 14 }}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Follow a brand: its colours, typefaces and logo go onto this page, and its voice guides the AI. */
function BrandGroup() {
  const c = useCampaign();
  const toast = useToast();
  const brands = useBrands().data?.brands ?? [];
  const [choice, setChoice] = useState(c.draft.settings.brand_id ?? '');
  if (!brands.length) return null;
  const chosen = choice === 'none' ? null : (brands.find((b) => b.id === choice) ?? brands.find((b) => b.is_default) ?? brands[0]!);

  const apply = () => {
    if (chosen) c.setPage((p) => applyBrand(p, chosen));
    c.setSettings((s) => ({ ...s, brand_id: chosen ? chosen.id : 'none' }));
    toast.ok(chosen ? `“${chosen.name}” is on this page` : 'This campaign follows no brand');
  };
  return (
    <Group title="Brand" open>
      <BrandField
        value={choice}
        onChange={setChoice}
        noneLabel="No brand"
        hint="Its colours, typefaces and logo go onto this page, and its voice guides the AI."
      />
      <div>
        <Button onClick={apply}>{chosen ? 'Apply to this page' : 'Follow no brand'}</Button>
      </div>
    </Group>
  );
}

/** Build the page again from this campaign's own PDF, as a copy, so the two can be compared. */
function RedesignGroup() {
  const c = useCampaign();
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState(c.draft.settings.brand_id ?? '');
  const [ai, setAi] = useState(true);
  const [name, setName] = useState(`${c.campaign.name} (redesign)`);
  const [busy, setBusy] = useState(false);
  if (!c.draft.document) return null;

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ campaign: Campaign }>(`/campaigns/${c.id}/redesign`, {
        brand_id: brand || undefined,
        ai: c.detail.ai_available ? ai : undefined,
        name: name.trim() || undefined,
      });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.ok('Your new page is ready');
      nav(`/campaigns/${r.campaign.id}/page`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Couldn’t build the new page');
      setBusy(false);
    }
  };

  return (
    <Group title="Redesign from the PDF">
      <div className="hint" style={{ marginTop: -4 }}>
        Not happy with how this page looks? Build a fresh one from the same PDF, with a brand and (with AI on) Claude’s design. This page
        isn’t touched: you get a copy to compare.
      </div>
      <div>
        <Button onClick={() => setOpen(true)}>Redesign…</Button>
      </div>
      {open ? (
        <Modal
          title="Redesign this page"
          description="We build a new campaign from the same PDF and keep this one as it is."
          onClose={() => (busy ? undefined : setOpen(false))}
          footer={
            <>
              <Button onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={run} loading={busy}>
                Build the new page
              </Button>
            </>
          }
        >
          <div className="col" style={{ gap: 14 }}>
            <Field label="Name of the copy">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
            <BrandField value={brand} onChange={setBrand} noneLabel="No brand (match the PDF’s own look)" />
            {c.detail.ai_available ? (
              <label className="check">
                <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} />
                <span>
                  Let Claude design the page <span className="muted">(takes up to a minute and uses Claude credit)</span>
                </span>
              </label>
            ) : null}
            {busy ? <p className="muted small">Building the new page. This can take up to a minute.</p> : null}
          </div>
        </Modal>
      ) : null}
    </Group>
  );
}

export function DesignPanel() {
  const c = useCampaign();
  const { theme, header, footer, seo } = c.draft.page;
  const set = <K extends 'theme' | 'header' | 'footer' | 'seo'>(k: K, patch: Partial<(typeof c.draft.page)[K]>) =>
    c.setPage((p) => ({ ...p, [k]: { ...p[k], ...patch } }), { coalesce: `design:${k}:${Object.keys(patch)[0]}` });
  const lowText = contrast(theme.text, theme.bg) < 4.5;
  const lowMuted = contrast(theme.muted, theme.bg) < 4.5;

  return (
    <div>
      <BrandGroup />
      <Group title="Style" open>
        <div className="hint" style={{ marginTop: -4 }}>
          One click changes the type, colours, corners and spacing together. Your brand colour stays.
        </div>
        <StyleGallery theme={theme} onPick={(preset) => c.setPage((p) => withPreset(p, preset))} />
      </Group>

      <Group title="Colours" open>
        <Field label="Brand colour" hint="Buttons, links and highlights.">
          <ColorField value={theme.brand} onChange={(v) => set('theme', { brand: v })} />
        </Field>
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label="Page background">
            <ColorField value={theme.bg} onChange={(v) => set('theme', { bg: v })} />
          </Field>
          <Field label="Soft tint" hint="Alternate sections.">
            <ColorField value={theme.alt_bg} onChange={(v) => set('theme', { alt_bg: v })} />
          </Field>
          <Field label="Dark sections">
            <ColorField value={theme.dark_bg} onChange={(v) => set('theme', { dark_bg: v })} />
          </Field>
          <Field label="Text">
            <ColorField value={theme.text} onChange={(v) => set('theme', { text: v })} />
          </Field>
          <Field label="Muted text">
            <ColorField value={theme.muted} onChange={(v) => set('theme', { muted: v })} />
          </Field>
        </div>
        {lowText || lowMuted ? (
          <div className="hint" style={{ color: 'var(--warn)' }}>
            {lowText ? 'The text colour is hard to read on this background. ' : 'The muted text is hard to read on this background. '}
            Aim for a contrast of 4.5 or more.
          </div>
        ) : null}
        <SwitchRow
          label="Blend into a gradient"
          hint="Buttons and coloured sections flow from your brand colour into a second one."
          checked={theme.gradient}
          onChange={(v) => set('theme', { gradient: v })}
        />
        {theme.gradient ? (
          <Field label="Gradient ends at" hint="Leave it to pick a neighbouring hue automatically.">
            <div className="row" style={{ gap: 8 }}>
              <ColorField value={theme.accent ?? shiftHue(theme.brand, 32)} onChange={(v) => set('theme', { accent: v })} />
              {theme.accent ? (
                <Button size="xs" variant="ghost" onClick={() => c.setPage((p) => ({ ...p, theme: { ...p.theme, accent: undefined } }))}>
                  Automatic
                </Button>
              ) : null}
            </div>
          </Field>
        ) : null}
      </Group>

      <Group title="Type">
        <Field label="Body font">
          <Select small value={theme.font} onChange={(e) => set('theme', { font: e.target.value as typeof theme.font })}>
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Heading font">
          <Select
            small
            value={theme.heading_font ?? ''}
            onChange={(e) => set('theme', { heading_font: (e.target.value || undefined) as typeof theme.heading_font })}
          >
            <option value="">Same as body</option>
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Heading weight">
          <Segmented
            value={theme.heading_weight}
            onChange={(v) => set('theme', { heading_weight: v })}
            options={[
              { value: 'medium', label: 'Light' },
              { value: 'semibold', label: 'Medium' },
              { value: 'bold', label: 'Bold' },
              { value: 'extrabold', label: 'Heavy' },
            ]}
          />
        </Field>
      </Group>

      <Group title="Shape & spacing">
        <Field label="Corners">
          <Segmented
            value={theme.radius}
            onChange={(v) => set('theme', { radius: v })}
            options={[
              { value: 'sharp', label: 'Sharp' },
              { value: 'soft', label: 'Soft' },
              { value: 'round', label: 'Round' },
            ]}
          />
        </Field>
        <Field label="Cards" hint="Feature boxes, the note and the form.">
          <Segmented
            value={theme.cards}
            onChange={(v) => set('theme', { cards: v })}
            options={[
              { value: 'outlined', label: 'Outlined' },
              { value: 'flat', label: 'Flat' },
              { value: 'raised', label: 'Raised' },
            ]}
          />
        </Field>
        <Field label="Space between sections">
          <Segmented
            value={theme.density}
            onChange={(v) => set('theme', { density: v })}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Roomy' },
              { value: 'spacious', label: 'Airy' },
            ]}
          />
        </Field>
        <Field label="Page width">
          <Segmented
            value={theme.width}
            onChange={(v) => set('theme', { width: v })}
            options={[
              { value: 'narrow', label: 'Narrow' },
              { value: 'normal', label: 'Standard' },
              { value: 'wide', label: 'Wide' },
            ]}
          />
        </Field>
      </Group>

      <Group title="Header">
        <SwitchRow label="Show a header" checked={header.enabled} onChange={(v) => set('header', { enabled: v })} />
        {header.enabled ? (
          <>
            <ImagePicker label="Logo" optional value={header.logo} onChange={(v) => set('header', { logo: v })} withAlt={false} />
            <TokenField
              label="Or logo text"
              noTokens
              value={header.logo_text ?? ''}
              onChange={(v) => set('header', { logo_text: v || undefined })}
              placeholder="Your company"
            />
            <ButtonEditor label="Header button" optional value={header.button} onChange={(v) => set('header', { button: v })} />
            <SwitchRow label="Stick to the top" checked={header.sticky} onChange={(v) => set('header', { sticky: v })} />
          </>
        ) : null}
      </Group>

      <Group title="Footer">
        <TokenField
          label="Footer text"
          multiline
          rows={3}
          value={footer.text}
          onChange={(v) => set('footer', { text: v })}
          placeholder="© Your Company · Prepared for {{first_name|you}}"
        />
        <div className="col" style={{ gap: 8 }}>
          <label className="label">Links</label>
          {footer.links.map((l, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <Input
                small
                value={l.label}
                placeholder="Label"
                onChange={(e) => set('footer', { links: footer.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              />
              <Input
                small
                value={l.url}
                placeholder="https://…"
                onChange={(e) => set('footer', { links: footer.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
              />
              <Button
                size="xs"
                variant="ghost"
                icon
                aria-label="Remove link"
                onClick={() => set('footer', { links: footer.links.filter((_, j) => j !== i) })}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
          {footer.links.length < 8 ? (
            <div>
              <Button size="sm" onClick={() => set('footer', { links: [...footer.links, { label: 'Privacy', url: 'https://' }] })}>
                <Plus size={13} /> Add link
              </Button>
            </div>
          ) : null}
        </div>
      </Group>

      <Group title="Search & sharing">
        <TokenField
          label="Page title"
          value={seo.title}
          onChange={(v) => set('seo', { title: v })}
          placeholder="A plan for {{company|your team}}"
          hint="Shown in the browser tab and when the link is shared."
        />
        <TokenField label="Description" multiline rows={2} value={seo.description} onChange={(v) => set('seo', { description: v })} />
        <ImagePicker
          label="Share image"
          optional
          withAlt={false}
          value={seo.og_image}
          onChange={(v) => set('seo', { og_image: v })}
          hint="Defaults to the PDF cover when there is one."
        />
        <Field label="Page language" hint="Sets the page's language tag, and the language AI-written copy is written in.">
          <Select small value={seo.lang} onChange={(e) => set('seo', { lang: e.target.value })}>
            {(LANGUAGES.includes(seo.lang) ? LANGUAGES : [seo.lang, ...LANGUAGES]).map((code) => (
              <option key={code} value={code}>
                {languageName(code)}
              </option>
            ))}
          </Select>
        </Field>
        <SwitchRow
          label="Hide from search engines"
          hint="Recommended: personalised pages contain personal details."
          checked={seo.noindex}
          onChange={(v) => set('seo', { noindex: v })}
        />
      </Group>

      <Group title="Custom CSS">
        <Field hint="Advanced. Appended after the theme.">
          <textarea
            className="textarea"
            rows={8}
            spellCheck={false}
            style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}
            value={c.draft.page.custom_css ?? ''}
            onChange={(e) => c.setPage((p) => ({ ...p, custom_css: e.target.value || undefined }), { coalesce: 'css' })}
            placeholder=".btn-primary { text-transform: uppercase; }"
          />
        </Field>
      </Group>

      <RedesignGroup />
    </div>
  );
}
