import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery } from '@tanstack/react-query';
import { AlignLeft, BadgeCheck, BarChart3, CalendarDays, CircleHelp, Code, Copy, Eye, EyeOff, FileDown, GripVertical, Image as ImageIcon, LayoutGrid, ListChecks, ListOrdered, MessageSquareHeart, Minus, MousePointerClick, PanelTop, PlayCircle, Plus, Quote, Square, TextCursorInput, Trash2, Users, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { BLOCK_TYPES, newBlock, newBlockId } from '@shared/blocks';
import { describeRule } from '@shared/conditions';
import type { Block, BlockType } from '@shared/schema';
import { api } from '../../api';
import { useCampaign } from '../../campaign';
import type { SettingsResponse } from '../../types';
import { Button, Modal } from '../../ui';

// Explicit map (rather than `import *`) so the bundler can drop every icon we don't use.
const BLOCK_ICONS: Record<string, LucideIcon> = {
  'panel-top': PanelTop,
  'message-square-heart': MessageSquareHeart,
  'align-left': AlignLeft,
  'layout-grid': LayoutGrid,
  'list-checks': ListChecks,
  'list-ordered': ListOrdered,
  image: ImageIcon,
  'play-circle': PlayCircle,
  'bar-chart-3': BarChart3,
  quote: Quote,
  'badge-check': BadgeCheck,
  'mouse-pointer-click': MousePointerClick,
  'text-cursor-input': TextCursorInput,
  'calendar-days': CalendarDays,
  'file-down': FileDown,
  'circle-help': CircleHelp,
  code: Code,
  minus: Minus,
};
const iconFor = (name: string): LucideIcon => BLOCK_ICONS[name] ?? Square;

export function blockSummary(b: Block): string {
  const s = (v: unknown) => String(v ?? '').replace(/\{\{[^}]*\}\}/g, '…').replace(/\s+/g, ' ').trim();
  switch (b.type) {
    case 'hero': return s(b.headline);
    case 'text': return s(b.heading || b.body);
    case 'features': return s(b.heading) || `${b.items.length} features`;
    case 'checklist': return s(b.heading) || `${b.items.length} points`;
    case 'stats': return b.items.map((i) => s(i.value)).join(' · ');
    case 'steps': return s(b.heading) || `${b.items.length} steps`;
    case 'testimonial': return s(b.quote);
    case 'logos': return `${b.items.length} logos`;
    case 'image': return s(b.caption || b.image.alt) || 'Picture';
    case 'video': return s(b.heading) || 'Video';
    case 'cta': return s(b.heading);
    case 'form': return s(b.heading) || `${b.fields.length} fields`;
    case 'faq': return s(b.heading) || `${b.items.length} questions`;
    case 'calendar': return s(b.heading) || 'Meeting booker';
    case 'note': return `From ${s(b.from_name)}`;
    case 'document': return s(b.heading) || 'PDF download';
    case 'html': return 'Custom HTML';
    case 'divider': return '';
  }
}

function Row({ block, selected, onSelect }: { block: Block; selected: boolean; onSelect: () => void }) {
  const c = useCampaign();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const meta = BLOCK_TYPES.find((m) => m.type === block.type)!;
  const Icon = iconFor(meta.icon);
  const targeted = !!block.rule && block.rule.conditions.length > 0;
  const issue = c.issues.find((i) => i.block === block.id && i.level === 'warn');
  const update = (fn: (blocks: Block[]) => Block[]) => c.setPage((p) => ({ ...p, blocks: fn(p.blocks) }));
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : block.hidden ? 0.5 : 1, zIndex: isDragging ? 5 : undefined }}
      className={`bl-row ${selected ? 'sel' : ''}`}
      onClick={onSelect}
    >
      <button className="bl-grip" {...attributes} {...listeners} aria-label="Drag to reorder" onClick={(e) => e.stopPropagation()}><GripVertical size={15} /></button>
      <span className="bl-ico"><Icon size={15} /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="bl-title">
          {meta.label}
          {targeted ? <span className="badge brand" title={describeRule(block.rule)}><Users size={11} /> Targeted</span> : null}
          {issue ? <span className="badge warn" title={issue.message}>!</span> : null}
        </div>
        <div className="bl-sub truncate">{blockSummary(block)}</div>
      </div>
      <div className="bl-actions">
        <Button size="xs" variant="ghost" icon aria-label={block.hidden ? 'Show block' : 'Hide block'} title={block.hidden ? 'Hidden from everyone — click to show' : 'Hide'} onClick={(e) => { e.stopPropagation(); update((bs) => bs.map((b) => (b.id === block.id ? { ...b, hidden: !b.hidden } : b))); }}>{block.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</Button>
        <Button size="xs" variant="ghost" icon aria-label="Duplicate" title="Duplicate (handy for a persona variant)" onClick={(e) => { e.stopPropagation(); const copy = { ...structuredClone(block), id: newBlockId() } as Block; update((bs) => { const i = bs.findIndex((b) => b.id === block.id); return [...bs.slice(0, i + 1), copy, ...bs.slice(i + 1)]; }); onSelect(); }}><Copy size={13} /></Button>
        <Button size="xs" variant="ghost" icon aria-label="Delete" onClick={(e) => { e.stopPropagation(); update((bs) => bs.filter((b) => b.id !== block.id)); }}><Trash2 size={13} /></Button>
      </div>
    </div>
  );
}

export function BlockPalette({ onPick, onClose }: { onPick: (t: BlockType) => void; onClose: () => void }) {
  const groups = ['Hero & intro', 'Content', 'Proof', 'Convert', 'Advanced'] as const;
  return (
    <Modal title="Add a block" onClose={onClose} size="wide">
      <div className="col" style={{ gap: 18 }}>
        {groups.map((g) => (
          <div key={g}>
            <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 650, marginBottom: 8 }}>{g}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
              {BLOCK_TYPES.filter((m) => m.group === g).map((m) => {
                const I = iconFor(m.icon);
                return (
                  <button key={m.type} type="button" className="option-card" onClick={() => onPick(m.type)}>
                    <b><I size={16} /> {m.label}</b>
                    <span>{m.description}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function BlockList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const c = useCampaign();
  const blocks = c.draft.page.blocks;
  const [adding, setAdding] = useState(false);
  const sender = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsResponse>('/settings'), staleTime: 60_000 }).data?.workspace.sender;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    c.setPage((p) => {
      const from = p.blocks.findIndex((b) => b.id === e.active.id);
      const to = p.blocks.findIndex((b) => b.id === e.over!.id);
      return { ...p, blocks: arrayMove(p.blocks, from, to) };
    });
  };
  const add = (type: BlockType) => {
    let block = newBlock(type);
    // a new personal note starts out signed by the workspace's sender
    if (block.type === 'note' && sender?.name) {
      block = { ...block, from_name: sender.name, from_role: sender.role || undefined, avatar: /^ast_/.test(sender.avatar) ? { src: sender.avatar, alt: sender.name } : undefined };
    }
    c.setPage((p) => {
      const at = selectedId ? p.blocks.findIndex((b) => b.id === selectedId) : -1;
      const i = at >= 0 ? at + 1 : p.blocks.length;
      return { ...p, blocks: [...p.blocks.slice(0, i), block, ...p.blocks.slice(i)] };
    });
    onSelect(block.id);
    setAdding(false);
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <div className="col" style={{ gap: 6 }}>
            {blocks.map((b) => <Row key={b.id} block={b} selected={b.id === selectedId} onSelect={() => onSelect(b.id)} />)}
          </div>
        </SortableContext>
      </DndContext>
      {!blocks.length ? <div className="viz-empty">This page is empty. Add your first block.</div> : null}
      <Button onClick={() => setAdding(true)} block><Plus size={15} /> Add block</Button>
      {adding ? <BlockPalette onPick={add} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
