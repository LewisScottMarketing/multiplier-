import { ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { PERSONAS, type Persona } from '@shared/personas';
import { textLeaves } from '@shared/block-text';
import type { Block } from '@shared/schema';
import { api } from '../api';
import { useCampaign } from '../campaign';
import { Alert, Button, Modal, Spinner } from '../ui';

interface Variant {
  block: Block;
  changed: number;
  warnings: string[];
}

/**
 * "Write a version for…": pick an audience, let Claude rewrite this block for them, read the result
 * next to the original, and only then add it. Nothing is saved until the author accepts.
 */
export function VariantModal({ block, onClose, onAdd }: { block: Block; onClose: () => void; onAdd: (variant: Block, persona: Persona) => void }) {
  const c = useCampaign();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Variant | null>(null);

  const write = async (p: Persona) => {
    setPersona(p);
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await api.post<Variant>(`/campaigns/${c.id}/ai/variant`, { block, persona: { label: p.label, description: p.description } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t write that version.');
    } finally {
      setBusy(false);
    }
  };

  const before = new Map(textLeaves(block).map((l) => [l.path, l]));
  const after = result ? textLeaves(result.block) : [];
  const changed = after.filter((l) => before.get(l.path)?.text !== l.text);

  if (!persona) {
    return (
      <Modal title="Write a version for…" size="wide" onClose={onClose} description="Claude rewrites this block for one audience, keeping your offer and facts. Everyone else keeps seeing the original.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
          {PERSONAS.map((p) => (
            <button key={p.id} type="button" className="option-card" onClick={() => void write(p)}>
              <b>{p.label}</b>
              <span style={{ textTransform: 'capitalize' }}>{p.description.split(',')[0]}</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`A version for ${persona.label.toLowerCase()}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => { setPersona(null); setResult(null); setError(''); }}>Choose another audience</Button>
          <Button onClick={() => void write(persona)} disabled={busy}><RefreshCw size={14} /> Try again</Button>
          <Button variant="primary" disabled={!result || busy} onClick={() => result && onAdd(result.block, persona)}>Add this version <ArrowRight size={15} /></Button>
        </>
      }
    >
      {busy ? (
        <div className="col" style={{ alignItems: 'center', padding: '40px 0', gap: 12 }}>
          <Spinner size={22} />
          <div className="muted small"><Sparkles size={13} style={{ verticalAlign: '-2px' }} /> Writing for {persona.label.toLowerCase()}… this takes about ten seconds.</div>
        </div>
      ) : error ? (
        <Alert tone="bad">{error}</Alert>
      ) : result ? (
        <div className="col" style={{ gap: 16 }}>
          {result.warnings.map((w, i) => <Alert key={i} tone="warn">{w}</Alert>)}
          {changed.map((l) => (
            <div key={l.path} className="col" style={{ gap: 6 }}>
              <div className="label">{l.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                  <div className="tiny muted" style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 650 }}>Now</div>
                  {before.get(l.path)?.text}
                </div>
                <div style={{ background: 'var(--brand-50)', borderRadius: 10, padding: '10px 12px', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                  <div className="tiny" style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 650, color: 'var(--brand-600)' }}>For {persona.label.toLowerCase()}</div>
                  {l.text}
                </div>
              </div>
            </div>
          ))}
          <div className="hint">Shown only to people whose job title matches. Everyone else still sees the original. You can edit the new block like any other.</div>
        </div>
      ) : null}
    </Modal>
  );
}
