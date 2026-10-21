import { AlignCenter, AlignLeft, AlignRight, Copy, Pipette, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PdfField } from '@shared/schema';
import { ImagePicker } from '../../components/ImagePicker';
import { RuleEditor } from '../../components/RuleEditor';
import { TokenField } from '../../components/TokenField';
import { Alert, Button, ColorField, Field, Input, Segmented, Select, SwitchRow } from '../../ui';
import { FIELD_META, fieldTitle, type TextField } from './fields';
import { clamp, sampleBackground } from './geometry';

function NumInput({ value, onChange, min, max, step = 1 }: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Input
      small
      type="number"
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) onChange(clamp(n, min, max));
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

function Position({ field, onChange, pageW, pageH }: { field: PdfField; onChange: (fn: (f: PdfField) => PdfField) => void; pageW: number; pageH: number }) {
  const set = (k: 'x' | 'y' | 'w' | 'h', v: number) => onChange((f) => ({ ...f, rect: { ...f.rect, [k]: v } }) as PdfField);
  return (
    <div className="st-sec">
      <h4>Position &amp; size <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(points)</span></h4>
      <div className="num-grid">
        <Field label="X"><NumInput value={field.rect.x} min={0} max={pageW} onChange={(v) => set('x', v)} /></Field>
        <Field label="Y"><NumInput value={field.rect.y} min={0} max={pageH} onChange={(v) => set('y', v)} /></Field>
        <Field label="Width"><NumInput value={field.rect.w} min={4} max={pageW} onChange={(v) => set('w', v)} /></Field>
        <Field label="Height"><NumInput value={field.rect.h} min={4} max={pageH} onChange={(v) => set('h', v)} /></Field>
      </div>
    </div>
  );
}

function Cover({ field, onChange, imageUrl, pageW }: { field: Extract<PdfField, { type: 'text' | 'image' }>; onChange: (fn: (f: PdfField) => PdfField) => void; imageUrl: string; pageW: number }) {
  const [busy, setBusy] = useState(false);
  const mask = field.mask;
  const sample = async () => {
    setBusy(true);
    const color = await sampleBackground(imageUrl, mask?.rect ?? field.rect, pageW);
    setBusy(false);
    return color;
  };
  return (
    <div className="st-sec">
      <h4>Cover the original</h4>
      <SwitchRow
        label="Paint over what’s underneath"
        hint={field.type === 'text' ? 'Hides the original text so only the new text shows.' : 'Hides the original picture or logo first.'}
        checked={!!mask}
        onChange={async (on) => {
          if (!on) return onChange((f) => ({ ...f, mask: null }) as PdfField);
          const color = await sample();
          onChange((f) => ({ ...f, mask: { color, pad: 1 } }) as PdfField);
        }}
      />
      {mask ? (
        <>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Cover colour"><ColorField value={mask.color} onChange={(color) => onChange((f) => ({ ...f, mask: { ...(f as TextField).mask!, color } }) as PdfField)} /></Field>
            <Button size="sm" loading={busy} onClick={async () => { const color = await sample(); onChange((f) => ({ ...f, mask: { ...(f as TextField).mask!, color } }) as PdfField); }} title="Match the colour of the page around this box"><Pipette size={14} /> Match page</Button>
          </div>
          <Field label="Extra margin"><NumInput value={mask.pad} min={0} max={20} step={0.5} onChange={(pad) => onChange((f) => ({ ...f, mask: { ...(f as TextField).mask!, pad } }) as PdfField)} /></Field>
          {mask.rect ? (
            <div className="hint">
              Covers exactly the original text.{' '}
              <button type="button" className="btn xs ghost" style={{ height: 20 }} onClick={() => onChange((f) => ({ ...f, mask: { ...(f as TextField).mask!, rect: undefined } }) as PdfField)}>Cover the whole box instead</button>
            </div>
          ) : null}
          <div className="hint">The original text stays inside the PDF file (it’s hidden, not deleted), so don’t use this to hide anything confidential.</div>
        </>
      ) : null}
    </div>
  );
}

export function Inspector({
  field,
  pageW,
  pageH,
  imageUrl,
  onChange,
  onDelete,
  onDuplicate,
  focusText,
}: {
  field: PdfField;
  pageW: number;
  pageH: number;
  imageUrl: string;
  onChange: (fn: (f: PdfField) => PdfField) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  /** Only for a field that was just created: put the cursor in its text so typing replaces the placeholder. */
  focusText?: boolean;
}) {
  const meta = FIELD_META[field.type];
  const Icon = meta.icon;
  const set = (p: Record<string, unknown>) => onChange((f) => ({ ...f, ...p }) as PdfField);
  const setFont = (p: Partial<TextField['font']>) => onChange((f) => ({ ...f, font: { ...(f as TextField).font, ...p } }) as PdfField);

  return (
    <div key={field.id} className="col" style={{ gap: 0 }}>
      <div className="st-head">
        <Icon size={17} style={{ marginRight: 8, color: 'var(--brand-600)' }} />
        <h3 className="grow truncate" title={fieldTitle(field)}>{meta.label} field</h3>
        <Button size="sm" variant="ghost" icon title="Duplicate" aria-label="Duplicate" onClick={onDuplicate}><Copy size={15} /></Button>
        <Button size="sm" variant="ghost" icon title="Delete (Del)" aria-label="Delete field" onClick={onDelete}><Trash2 size={15} /></Button>
      </div>

      <div className="st-sec">
        <Field label="Name" hint="Only for you, to find it in the list.">
          <Input small value={field.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })} placeholder={fieldTitle({ ...field, label: undefined } as PdfField).slice(0, 40)} />
        </Field>
      </div>

      {field.type === 'text' ? (
        <>
          <div className="st-sec">
            <h4>Text</h4>
            <TokenField
              value={field.text}
              onChange={(text) => set({ text })}
              multiline
              rows={3}
              autoFocus={focusText}
              hint={field.source_text ? <>Replaces “{field.source_text.length > 60 ? `${field.source_text.slice(0, 57)}…` : field.source_text}”. Use <b>Insert field</b> to pick a merge field.</> : 'Use Insert field to add a merge field, with a fallback for when it’s empty.'}
            />
          </div>
          <Cover field={field} onChange={onChange} imageUrl={imageUrl} pageW={pageW} />
          <div className="st-sec">
            <h4>Style</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 84px', gap: 10 }}>
              <Field label="Font">
                <Select small value={field.font.family} onChange={(e) => setFont({ family: e.target.value as TextField['font']['family'] })}>
                  <option value="auto">Same as original</option>
                  <option value="inter">Inter</option>
                  <option value="helvetica">Helvetica / Arial</option>
                  <option value="serif">Serif</option>
                  <option value="mono">Monospace</option>
                </Select>
              </Field>
              <Field label="Size"><NumInput value={field.size} min={4} max={200} step={0.5} onChange={(size) => set({ size })} /></Field>
            </div>
            <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
              <Field label="Style">
                <div className="toggle-btns">
                  <button type="button" aria-pressed={field.font.bold} title="Bold" onClick={() => setFont({ bold: !field.font.bold })}><b>B</b></button>
                  <button type="button" aria-pressed={field.font.italic} title="Italic" onClick={() => setFont({ italic: !field.font.italic })}><i style={{ fontFamily: 'serif' }}>I</i></button>
                </div>
              </Field>
              <Field label="Colour"><ColorField value={field.color} onChange={(color) => set({ color })} /></Field>
            </div>
            <Field label="Align">
              <Segmented
                value={field.align}
                onChange={(align) => set({ align })}
                options={[
                  { value: 'left', label: <AlignLeft size={14} />, title: 'Left' },
                  { value: 'center', label: <AlignCenter size={14} />, title: 'Centre' },
                  { value: 'right', label: <AlignRight size={14} />, title: 'Right' },
                ]}
              />
            </Field>
            <Field label="Vertical position">
              <Segmented value={field.valign} onChange={(valign) => set({ valign })} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
            </Field>
            <Field label="When the text is too long" hint={field.fit === 'shrink' ? 'Long names get smaller instead of spilling over.' : field.fit === 'wrap' ? 'Wraps onto more lines inside the box.' : 'Drawn at full size even if it overflows.'}>
              <Segmented value={field.fit} onChange={(fit) => set({ fit })} options={[{ value: 'shrink', label: 'Shrink' }, { value: 'wrap', label: 'Wrap' }, { value: 'none', label: 'Keep size' }]} />
            </Field>
            {field.fit === 'wrap' ? <Field label="Line spacing"><NumInput value={field.line_height} min={0.8} max={3} step={0.05} onChange={(line_height) => set({ line_height })} /></Field> : null}
          </div>
        </>
      ) : null}

      {field.type === 'image' ? (
        <>
          <div className="st-sec">
            <h4>Picture</h4>
            <ImagePicker
              value={{ src: field.src, alt: '' }}
              onChange={(v) => set({ src: v?.src ?? '' })}
              withAlt={false}
              hint="Use {{logo_url}} to place each company’s own logo. Rows without one are skipped, so nothing odd appears."
            />
            <Field label="Fitting">
              <Segmented value={field.fit} onChange={(fit) => set({ fit })} options={[{ value: 'contain', label: 'Fit inside' }, { value: 'cover', label: 'Fill & crop' }]} />
            </Field>
          </div>
          <Cover field={field} onChange={onChange} imageUrl={imageUrl} pageW={pageW} />
        </>
      ) : null}

      {field.type === 'qr' ? (
        <div className="st-sec">
          <h4>QR code</h4>
          <TokenField label="Opens" value={field.url} onChange={(url) => set({ url })} mono hint="Usually their personal page. Scanning lets a printed or forwarded PDF lead back to the web." />
          <div className="row" style={{ gap: 14, alignItems: 'flex-end' }}>
            <Field label="Colour"><ColorField value={field.color} onChange={(color) => set({ color })} /></Field>
          </div>
          <SwitchRow label="Transparent background" checked={field.background === null} onChange={(t) => set({ background: t ? null : '#ffffff' })} />
          {field.background ? <Field label="Background"><ColorField value={field.background} onChange={(background) => set({ background })} /></Field> : null}
          <Alert>Keep the code dark on a light background so phones can scan it.</Alert>
        </div>
      ) : null}

      {field.type === 'link' ? (
        <div className="st-sec">
          <h4>Link</h4>
          <TokenField label="Goes to" value={field.url} onChange={(url) => set({ url })} mono hint="Makes this area clickable in the PDF. Draw it over a button, a logo or a line of text." />
        </div>
      ) : null}

      <Position field={field} onChange={onChange} pageW={pageW} pageH={pageH} />

      <div className="st-sec">
        <h4>Show only to…</h4>
        <RuleEditor rule={field.rule} onChange={(rule) => set({ rule })} noun="item" />
      </div>
    </div>
  );
}
