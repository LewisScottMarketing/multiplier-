import { Copy, MoveDown, MoveUp, Sparkles, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { canVary } from '@shared/block-text';
import { excludingRule, intersectRule } from '@shared/conditions';
import { BLOCK_TYPES, newBlockId } from '@shared/blocks';
import type { Block } from '@shared/schema';
import { blockAnchor } from './util';
import { useCampaign } from '../../campaign';
import { RuleEditor } from '../../components/RuleEditor';
import { VariantModal } from '../../components/VariantModal';
import { Button, Field, Input, Select, SwitchRow, useToast } from '../../ui';
import { blockFields, FieldRenderer } from './blockForms';

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="be-sec">
      <h4>{title}</h4>
      {hint ? <div className="hint" style={{ marginTop: -4 }}>{hint}</div> : null}
      {children}
    </section>
  );
}

export function BlockEditor({ id, onSelect }: { id: string; onSelect: (id: string | null) => void }) {
  const c = useCampaign();
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const idx = c.draft.page.blocks.findIndex((b) => b.id === id);
  const block = c.draft.page.blocks[idx];
  if (!block) return null;
  const meta = BLOCK_TYPES.find((m) => m.type === block.type)!;
  const record = block as unknown as Record<string, unknown>;

  const patch = (key: string, value: unknown) =>
    c.setPage((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? ({ ...b, [key]: value } as Block) : b)) }), { coalesce: `${id}:${key}` });
  const move = (d: number) =>
    c.setPage((p) => {
      const i = p.blocks.findIndex((b) => b.id === id);
      const j = i + d;
      if (j < 0 || j >= p.blocks.length) return p;
      const next = [...p.blocks];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return { ...p, blocks: next };
    });

  return (
    <div className="be">
      <div className="be-head">
        <div className="grow">
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 650 }}>Editing</div>
          <h3>{meta.label}</h3>
        </div>
        <Button size="xs" variant="ghost" icon title="Move up" aria-label="Move up" disabled={idx === 0} onClick={() => move(-1)}><MoveUp size={14} /></Button>
        <Button size="xs" variant="ghost" icon title="Move down" aria-label="Move down" disabled={idx === c.draft.page.blocks.length - 1} onClick={() => move(1)}><MoveDown size={14} /></Button>
        <Button size="xs" variant="ghost" icon title="Duplicate" aria-label="Duplicate" onClick={() => { const copy = { ...structuredClone(block), id: newBlockId() } as Block; c.setPage((p) => ({ ...p, blocks: [...p.blocks.slice(0, idx + 1), copy, ...p.blocks.slice(idx + 1)] })); onSelect(copy.id); }}><Copy size={14} /></Button>
        <Button size="xs" variant="ghost" icon title="Delete" aria-label="Delete block" onClick={() => { c.setPage((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== id) })); onSelect(null); }}><Trash2 size={14} /></Button>
      </div>

      <Section title="Content">
        <div className="col" style={{ gap: 14 }}>
          {blockFields(block).map((def, i) => (
            <FieldRenderer key={`${block.id}-${i}`} def={def} block={record} value={'key' in def ? record[def.key] : undefined} onChange={(v) => 'key' in def && patch(def.key, v)} />
          ))}
          {!blockFields(block).length ? <div className="muted small">Nothing to edit here.</div> : null}
        </div>
      </Section>

      <Section title="Personalise" hint="The same page can say different things to different people.">
        {canVary(block) ? (
          <div className="col" style={{ gap: 6 }}>
            <Button onClick={() => setWriting(true)} disabled={!c.detail.ai_available} title={c.detail.ai_available ? undefined : 'Set ANTHROPIC_API_KEY on the server to turn on AI writing'}>
              <Sparkles size={14} /> Write a version for…
            </Button>
            {!c.detail.ai_available ? <div className="hint">AI writing is off. Set <code>ANTHROPIC_API_KEY</code> to have Claude draft versions for marketing, sales, executives and more.</div> : null}
          </div>
        ) : null}
        <RuleEditor rule={block.rule} onChange={(r) => patch('rule', r)} />
        {writing ? (
          <VariantModal
            block={block}
            onClose={() => setWriting(false)}
            onAdd={(variant, persona) => {
              const excluded = excludingRule(block.rule, persona.rule);
              c.setPage((p) => {
                const i = p.blocks.findIndex((b) => b.id === id);
                if (i < 0) return p;
                const blocks = [...p.blocks];
                // the persona sees the new version instead of the original, and everyone else is unchanged
                if (excluded) blocks[i] = { ...blocks[i]!, rule: excluded } as Block;
                blocks.splice(i + 1, 0, { ...variant, rule: intersectRule(block.rule, persona.rule) } as Block);
                return { ...p, blocks };
              });
              setWriting(false);
              onSelect(variant.id);
              toast.ok(excluded ? `Added a version for ${persona.label.toLowerCase()}. Everyone else still sees the original.` : `Added a version for ${persona.label.toLowerCase()}. It shows alongside the original, since that block's targeting couldn't be split automatically.`);
            }}
          />
        ) : null}
      </Section>

      <Section title="Appearance">
        <div className="col" style={{ gap: 12 }}>
          <Field label="Background">
            <Select small value={block.bg ?? 'default'} onChange={(e) => patch('bg', e.target.value === 'default' ? undefined : e.target.value)}>
              <option value="default">Page background</option>
              <option value="alt">Soft tint</option>
              <option value="brand">Brand colour</option>
              <option value="dark">Dark</option>
            </Select>
          </Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Spacing">
              <Select small value={block.pad ?? 'md'} onChange={(e) => patch('pad', e.target.value === 'md' ? undefined : e.target.value)}>
                <option value="sm">Compact</option>
                <option value="md">Normal</option>
                <option value="lg">Roomy</option>
              </Select>
            </Field>
            <Field label="Alignment">
              <Select small value={block.align ?? 'left'} onChange={(e) => patch('align', e.target.value === 'left' ? undefined : e.target.value)}>
                <option value="left">Left</option>
                <option value="center">Centered</option>
              </Select>
            </Field>
          </div>
          <Field label="Anchor name" hint={`Buttons can scroll here. Link: #${blockAnchor(block)}`}>
            <Input small value={block.anchor ?? ''} placeholder={block.id} onChange={(e) => patch('anchor', e.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || undefined)} />
          </Field>
          <SwitchRow label="Hidden" hint="Keep the block but don’t show it to anyone." checked={!!block.hidden} onChange={(v) => patch('hidden', v || undefined)} />
        </div>
      </Section>
    </div>
  );
}

export function NothingSelected() {
  const c = useCampaign();
  const targeted = c.draft.page.blocks.filter((b) => b.rule && b.rule.conditions.length).length;
  return (
    <div className="col" style={{ gap: 14, padding: 18 }}>
      <div className="empty" style={{ padding: '28px 8px' }}>
        <div className="icon-bubble"><Users size={22} /></div>
        <h3>Select a block to edit it</h3>
        <p className="small">Click anything in the preview, or pick a block from the list.</p>
      </div>
      <div className="alert">
        <Users size={16} />
        <div>
          <b>Persona targeting</b>
          <div className="small">{targeted ? `${targeted} block${targeted === 1 ? ' is' : 's are'} targeted at specific job titles.` : 'Show a block only to marketers, executives or any segment: select a block and use Personalise.'}</div>
        </div>
      </div>
    </div>
  );
}
