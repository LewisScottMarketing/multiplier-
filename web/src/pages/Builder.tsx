import { AlertTriangle, CheckCircle2, Info, Layers, Palette, Redo2, ShieldCheck, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCampaign } from '../campaign';
import { Button, Segmented } from '../ui';
import { BlockEditor, NothingSelected } from './builder/BlockEditor';
import { BlockList } from './builder/BlockList';
import { DesignPanel } from './builder/DesignPanel';
import { Preview } from './builder/Preview';
import './builder/builder.css';

type Tab = 'blocks' | 'design' | 'checks';

function Checks({ onSelect }: { onSelect: (id: string) => void }) {
  const c = useCampaign();
  if (!c.issues.length) {
    return (
      <div className="empty" style={{ padding: '36px 12px' }}>
        <div className="icon-bubble" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}><CheckCircle2 size={22} /></div>
        <h3>All clear</h3>
        <p className="small">Every merge field has a fallback and every button goes somewhere.</p>
      </div>
    );
  }
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="hint">These are the things that would look wrong to a prospect if their data were missing.</div>
      {c.issues.map((i, n) => (
        <button key={n} type="button" className="btn" style={{ height: 'auto', padding: '9px 11px', justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal', alignItems: 'flex-start' }} onClick={() => i.block && onSelect(i.block)}>
          {i.level === 'warn' ? <AlertTriangle size={15} style={{ color: 'var(--warn)', flex: 'none', marginTop: 2 }} /> : <Info size={15} style={{ color: 'var(--ink-3)', flex: 'none', marginTop: 2 }} />}
          <span className="small">{i.message}</span>
        </button>
      ))}
    </div>
  );
}

export function BuilderPage() {
  const c = useCampaign();
  const [tab, setTab] = useState<Tab>('blocks');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = c.draft.page.blocks.find((b) => b.id === selectedId) ? selectedId : null;
  const warn = c.issues.filter((i) => i.level === 'warn').length;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? c.history.redo() : c.history.undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        c.history.redo();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [c.history]);

  return (
    <div className="builder">
      <aside className="b-left">
        <div className="b-left-head">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'blocks', label: <><Layers size={13} /> Blocks</> },
              { value: 'design', label: <><Palette size={13} /> Design</> },
              { value: 'checks', label: <><ShieldCheck size={13} /> Checks{warn ? <span className="badge warn" style={{ height: 16 }}>{warn}</span> : null}</> },
            ]}
          />
          <span className="row right" style={{ gap: 2 }}>
            <Button size="xs" variant="ghost" icon title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!c.history.canUndo} onClick={c.history.undo}><Undo2 size={14} /></Button>
            <Button size="xs" variant="ghost" icon title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!c.history.canRedo} onClick={c.history.redo}><Redo2 size={14} /></Button>
          </span>
        </div>
        <div className="b-left-body">
          {tab === 'blocks' ? <BlockList selectedId={selected} onSelect={setSelectedId} /> : tab === 'design' ? <DesignPanel /> : <Checks onSelect={(id) => { setSelectedId(id); setTab('blocks'); }} />}
        </div>
      </aside>
      <section className="b-center">
        <Preview selectedId={selected} onSelect={(id) => { setSelectedId(id); setTab('blocks'); }} />
      </section>
      <aside className="b-right">{selected ? <BlockEditor key={selected} id={selected} onSelect={setSelectedId} /> : <NothingSelected />}</aside>
    </div>
  );
}
