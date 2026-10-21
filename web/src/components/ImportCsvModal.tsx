import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, FileUp } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { normKey } from '@shared/template';
import { api } from '../api';
import { useCampaign } from '../campaign';
import { download } from '../lib/format';
import { Alert, Button, Modal, Select, Spinner } from '../ui';

interface Preview {
  headers: string[];
  suggested_mapping: Record<string, string>;
  total: number;
  rows: Array<Record<string, string>>;
}

interface Result {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

const TARGETS: Array<{ key: string; label: string }> = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'full_name', label: 'Full name' },
  { key: 'email', label: 'Email' },
  { key: 'company', label: 'Company' },
  { key: 'job_title', label: 'Job title' },
  { key: 'linkedin_url', label: 'LinkedIn URL' },
  { key: 'website', label: 'Company website' },
  { key: 'logo_url', label: 'Company logo URL' },
  { key: 'external_id', label: 'Your own ID (so re-imports update)' },
];
const TARGET_KEYS = new Set(TARGETS.map((t) => t.key));
const CUSTOM = '__custom';
const CHUNK = 400;

const TEMPLATE = 'first_name,last_name,email,company,job_title,linkedin_url\nJane,Doe,jane@northwind.com,"Northwind Traders, Inc.",VP of Marketing,https://linkedin.com/in/janedoe\n';

export function ImportCsvModal({ onClose }: { onClose: () => void }) {
  const c = useCampaign();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'pick' | 'map' | 'run' | 'done'>('pick');
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  const pick = async (f: File) => {
    if (!/\.(csv|tsv|txt)$/i.test(f.name) && !f.type.includes('csv') && !f.type.includes('text')) return setError('Please choose a .csv file. In Clay: table menu → Export → CSV.');
    setError('');
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', f);
      const r = await api.upload<Preview>(`/campaigns/${c.id}/prospects/import/preview`, form);
      setFile(f);
      setPreview(r);
      const m: Record<string, string> = {};
      for (const h of r.headers) {
        const s = r.suggested_mapping[h] ?? normKey(h);
        m[h] = TARGET_KEYS.has(s) ? s : CUSTOM;
      }
      setMapping(m);
      setStep('map');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  };

  const used = useMemo(() => {
    const count = new Map<string, number>();
    for (const v of Object.values(mapping)) if (v && v !== CUSTOM) count.set(v, (count.get(v) ?? 0) + 1);
    return count;
  }, [mapping]);
  const duplicates = [...used.entries()].filter(([, n]) => n > 1).map(([k]) => TARGETS.find((t) => t.key === k)?.label ?? k);

  const mappedKeys = useMemo(() => new Set(Object.entries(mapping).filter(([, v]) => v).map(([h, v]) => (v === CUSTOM ? normKey(h) : v))), [mapping]);
  const required = c.draft.settings.required_fields;
  const missingRequired = required.filter((k) => !mappedKeys.has(k) && !(k === 'first_name' && mappedKeys.has('full_name')));

  const run = async () => {
    if (!preview) return;
    setStep('run');
    setProgress(0);
    const rows = preview.rows.map((r) => {
      const o: Record<string, string> = {};
      for (const h of preview.headers) {
        const target = mapping[h];
        if (!target) continue;
        const key = target === CUSTOM ? normKey(h) : target;
        const v = r[h];
        if (key && v !== undefined && v !== '') o[key] = v;
      }
      return o;
    });
    const total: Result = { created: 0, updated: 0, unchanged: 0, failed: 0, errors: [] };
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const part = await api.post<Result>(`/campaigns/${c.id}/prospects/import`, { rows: rows.slice(i, i + CHUNK) });
        total.created += part.created;
        total.updated += part.updated;
        total.unchanged += part.unchanged;
        total.failed += part.failed;
        for (const e of part.errors) if (total.errors.length < 50) total.errors.push({ row: e.row + i, message: e.message });
        setProgress(Math.min(100, Math.round(((i + CHUNK) / rows.length) * 100)));
      }
      setResult(total);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import stopped part-way.');
      setResult(total);
      setStep('done');
    } finally {
      qc.invalidateQueries({ queryKey: ['prospects'] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['campaign', c.id] });
    }
  };

  if (step === 'run') {
    return (
      <Modal title="Importing…" onClose={() => undefined}>
        <div className="col" style={{ padding: '14px 0 24px', gap: 14 }}>
          <div className="progress"><i style={{ width: `${progress}%` }} /></div>
          <p className="muted small">Adding {preview?.total} prospects and creating their personalised links.</p>
        </div>
      </Modal>
    );
  }

  if (step === 'done' && result) {
    const ok = result.created + result.updated + result.unchanged;
    return (
      <Modal
        title={result.failed || error ? 'Imported with some problems' : 'Import complete'}
        onClose={onClose}
        footer={<Button variant="primary" onClick={onClose}>Done</Button>}
      >
        <div className="col" style={{ gap: 14 }}>
          {error ? <Alert tone="bad">{error}</Alert> : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              ['New', result.created],
              ['Updated', result.updated],
              ['Unchanged', result.unchanged],
              ['Skipped', result.failed],
            ].map(([k, v]) => (
              <div key={k as string} style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div>
                <div className="muted tiny">{k}</div>
              </div>
            ))}
          </div>
          {ok > 0 ? (
            <Alert tone="ok" icon={<CheckCircle2 size={16} />}>
              {ok} {ok === 1 ? 'person has' : 'people have'} a personalised link. Use <b>Export</b> to get a CSV with each link, or fetch them from Clay with the HTTP API.
            </Alert>
          ) : null}
          {result.errors.length ? (
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Rows that were skipped</div>
              <div style={{ maxHeight: 160, overflowY: 'auto', background: 'var(--bg)', borderRadius: 10, padding: '8px 12px' }} className="small">
                {result.errors.map((e, i) => <div key={i}>Row {e.row}: {e.message}</div>)}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    );
  }

  if (step === 'map' && preview) {
    const sample = preview.rows.slice(0, 3);
    return (
      <Modal
        title="Match your columns"
        size="wide"
        onClose={onClose}
        description={<><b>{preview.total.toLocaleString()}</b> rows in <span className="mono">{file?.name}</span>. Anything we can’t match becomes a custom field you can use as <code>{'{{field}}'}</code> in the page and PDF.</>}
        footer={
          <>
            <Button onClick={() => { setStep('pick'); setPreview(null); }}><ArrowLeft size={15} /> Back</Button>
            <Button variant="primary" onClick={run} disabled={!mappedKeys.size}>Import {preview.total.toLocaleString()} prospects <ArrowRight size={15} /></Button>
          </>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          {missingRequired.length ? (
            <Alert tone="warn" icon={<AlertTriangle size={16} />}>This campaign needs <b>{missingRequired.join(', ')}</b> to personalise properly, and no column is matched to {missingRequired.length === 1 ? 'it' : 'them'}.</Alert>
          ) : null}
          {duplicates.length ? <Alert tone="warn">More than one column is set to <b>{duplicates.join(', ')}</b>. Only the last one is kept.</Alert> : null}
          <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
            <table className="table">
              <thead>
                <tr><th>Column in your file</th><th>Example</th><th style={{ width: 250 }}>Use it as</th></tr>
              </thead>
              <tbody>
                {preview.headers.map((h) => (
                  <tr key={h}>
                    <td><b>{h}</b></td>
                    <td className="muted small" style={{ maxWidth: 220 }}>
                      <div className="truncate">{sample.map((r) => r[h]).filter(Boolean).slice(0, 2).join(' · ') || '—'}</div>
                    </td>
                    <td>
                      <Select small value={mapping[h] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))} aria-label={`What to do with ${h}`}>
                        <option value="">Skip this column</option>
                        <optgroup label="Standard fields">
                          {TARGETS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </optgroup>
                        <optgroup label="Custom">
                          <option value={CUSTOM}>Custom field: {'{{'}{normKey(h) || '…'}{'}}'}</option>
                        </optgroup>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Import prospects from a CSV" onClose={onClose} description="Export a table from Clay (or any spreadsheet) and drop it here. Each row gets its own personalised link.">
      <div className="col" style={{ gap: 14 }}>
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void pick(f); }}
        >
          <div className="icon-bubble">{busy ? <Spinner size={22} /> : <FileUp size={22} />}</div>
          <b>{busy ? 'Reading your file…' : 'Drop a CSV here, or click to browse'}</b>
          <p className="muted small" style={{ marginTop: 4 }}>The first row must be column headings. Up to 5,000 rows.</p>
          <input ref={input} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
        </div>
        <div className="row small muted">
          <FileSpreadsheet size={15} />
          Not sure of the format?
          <button type="button" className="btn xs" onClick={() => download('multiplier-template.csv', new Blob([TEMPLATE], { type: 'text/csv' }))}>Download a template</button>
        </div>
      </div>
    </Modal>
  );
}
