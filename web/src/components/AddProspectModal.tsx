import { useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { normKey } from '@shared/template';
import { api } from '../api';
import { useCampaign } from '../campaign';
import type { ProspectItem } from '../types';
import { Alert, Button, CopyBox, Field, Input, Modal } from '../ui';

const BASE = [
  { key: 'first_name', label: 'First name', placeholder: 'Jane' },
  { key: 'last_name', label: 'Last name', placeholder: 'Doe' },
  { key: 'email', label: 'Email', placeholder: 'jane@northwind.com' },
  { key: 'job_title', label: 'Job title', placeholder: 'VP of Marketing' },
  { key: 'company', label: 'Company', placeholder: 'Northwind Traders' },
  { key: 'linkedin_url', label: 'LinkedIn URL', placeholder: 'https://linkedin.com/in/…' },
] as const;

export function AddProspectModal({ onClose, onAdded }: { onClose: () => void; onAdded: (p: ProspectItem) => void }) {
  const c = useCampaign();
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Array<{ k: string; v: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<{ prospect: ProspectItem; status: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const body: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) if (v.trim()) body[k] = v.trim();
      for (const e of extra) {
        const key = normKey(e.k);
        if (key && e.v.trim()) body[key] = e.v.trim();
      }
      if (!Object.keys(body).length) throw new Error('Fill in at least one field.');
      const r = await api.post<{ status: string; prospect: ProspectItem }>(`/campaigns/${c.id}/prospects`, body);
      setMade(r);
      qc.invalidateQueries({ queryKey: ['prospects'] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['campaign', c.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the prospect');
    } finally {
      setBusy(false);
    }
  };

  if (made) {
    return (
      <Modal
        title={made.status === 'created' ? 'Prospect added' : 'Prospect updated'}
        onClose={onClose}
        footer={
          <>
            <Button onClick={() => { setMade(null); setForm({}); setExtra([]); }}><Plus size={15} /> Add another</Button>
            <Button variant="primary" onClick={() => { onAdded(made.prospect); onClose(); }}>View prospect</Button>
          </>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          <div className="row"><Check size={18} style={{ color: 'var(--ok)' }} /> <b>{[made.prospect.first_name, made.prospect.last_name].filter(Boolean).join(' ') || made.prospect.email}</b></div>
          <div className="label">Their personalised link</div>
          <CopyBox text={made.prospect.url} />
          {made.prospect.pdf_url ? <CopyBox text={made.prospect.pdf_url} /> : null}
          <div className="row">
            <Button size="sm" onClick={() => window.open(made.prospect.url, '_blank', 'noopener')}><ExternalLink size={14} /> Open page</Button>
          </div>
          {c.campaign.status !== 'live' ? <Alert tone="warn">Publish the campaign for this link to work for the prospect.</Alert> : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Add a prospect"
      onClose={onClose}
      description="Handy for testing, or for a one-off. For lists, import a CSV or connect Clay."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>Add prospect</Button>
        </>
      }
    >
      <form className="col" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {BASE.map((f, i) => (
            <Field key={f.key} label={f.label}>
              <Input value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} placeholder={f.placeholder} autoFocus={i === 0} />
            </Field>
          ))}
        </div>
        {extra.length ? (
          <div className="col" style={{ gap: 8 }}>
            <div className="label">Extra fields</div>
            {extra.map((e, i) => (
              <div key={i} className="row">
                <Input small placeholder="field_name" value={e.k} onChange={(ev) => setExtra((x) => x.map((r, j) => (j === i ? { ...r, k: ev.target.value } : r)))} style={{ maxWidth: 170, fontFamily: 'var(--mono)' }} />
                <Input small placeholder="value" value={e.v} onChange={(ev) => setExtra((x) => x.map((r, j) => (j === i ? { ...r, v: ev.target.value } : r)))} />
                <Button size="sm" variant="ghost" icon aria-label="Remove field" onClick={() => setExtra((x) => x.filter((_, j) => j !== i))}><X size={14} /></Button>
              </div>
            ))}
          </div>
        ) : null}
        <div>
          <Button size="sm" variant="ghost" onClick={() => setExtra((x) => [...x, { k: '', v: '' }])}><Plus size={14} /> Add a custom field</Button>
          <span className="hint" style={{ marginLeft: 6 }}>Anything you add is available as <code>{'{{field_name}}'}</code>.</span>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
