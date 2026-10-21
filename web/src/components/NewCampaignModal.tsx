import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, FileText, FileUp, LayoutTemplate } from 'lucide-react';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Campaign, SettingsResponse } from '../types';
import { Alert, Button, Field, Input, Modal, useToast } from '../ui';

type Mode = 'pdf' | 'blank';

export function NewCampaignModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('pdf');
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<'choose' | 'working' | 'done'>('choose');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ campaign: Campaign; report: string[] } | null>(null);
  const [fileName, setFileName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsResponse>('/settings'), staleTime: 60_000 });
  const aiOn = !!settings.data?.ai.available;
  const [polish, setPolish] = useState(true);

  const upload = async (file: File) => {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return setError('Please choose a PDF file.');
    setError('');
    setFileName(file.name);
    setPhase('working');
    try {
      const form = new FormData();
      form.set('file', file);
      if (name.trim()) form.set('name', name.trim());
      if (aiOn && !polish) form.set('ai', '0');
      const r = await api.upload<{ campaign: Campaign; report: string[] }>('/campaigns/import-pdf', form);
      setResult(r);
      setPhase('done');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed.');
      setPhase('choose');
    }
  };

  const createBlank = async () => {
    setPhase('working');
    try {
      const r = await api.post<{ campaign: Campaign }>('/campaigns', { name: name.trim() || 'Untitled campaign' });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      nav(`/campaigns/${r.campaign.id}/page`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the campaign');
      setPhase('choose');
    }
  };

  if (phase === 'working') {
    return (
      <Modal title={mode === 'pdf' ? 'Building your page…' : 'Creating…'} onClose={() => undefined}>
        <div className="col" style={{ padding: '18px 0 26px', gap: 16 }}>
          {mode === 'pdf' ? (
            <>
              <div className="row">
                <FileText size={18} className="muted" /> <b className="truncate">{fileName}</b>
              </div>
              <div className="progress indeterminate">
                <i />
              </div>
              <p className="muted small">
                Reading the text and layout, picking your brand colour and drafting the page. This usually takes a few seconds
                {aiOn && polish ? ', a little longer with AI polish' : ''}.
              </p>
            </>
          ) : (
            <div className="progress indeterminate">
              <i />
            </div>
          )}
        </div>
      </Modal>
    );
  }

  if (phase === 'done' && result) {
    return (
      <Modal
        title="Your page is ready"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Later</Button>
            <Button
              variant="primary"
              onClick={() => {
                nav(`/campaigns/${result.campaign.id}/page`);
                onClose();
              }}
            >
              Open the builder <ArrowRight size={15} />
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 14 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <CheckCircle2 size={20} style={{ color: 'var(--ok)', flex: 'none', marginTop: 2 }} />
            <div>
              <b>{result.campaign.name}</b>
              <p className="muted small">Here’s what we found. Everything is editable.</p>
            </div>
          </div>
          <ul className="steps-list" style={{ padding: 0, margin: 0 }}>
            {result.report.map((line, i) => (
              <li key={i}>
                <CheckCircle2 size={15} />
                {line}
              </li>
            ))}
          </ul>
          {result.campaign.document?.fields.length ? (
            <Alert tone="ok">
              We spotted <b>{result.campaign.document.fields.length}</b> placeholder
              {result.campaign.document.fields.length === 1 ? '' : 's'} in your PDF, so each prospect’s copy will have their details filled
              in.
            </Alert>
          ) : (
            <Alert>
              Open the <b>PDF</b> tab to click any text in your PDF and swap it for a merge field like <code>{'{{company}}'}</code>.
            </Alert>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New campaign" onClose={onClose} description="Start from a PDF you already have, or build a page from scratch.">
      <div className="option-cards">
        <button type="button" className={`option-card ${mode === 'pdf' ? 'on' : ''}`} onClick={() => setMode('pdf')}>
          <b>
            <FileUp size={17} /> From a PDF
          </b>
          <span>We build the landing page from it, and each prospect gets their own edited copy of the PDF.</span>
        </button>
        <button type="button" className={`option-card ${mode === 'blank' ? 'on' : ''}`} onClick={() => setMode('blank')}>
          <b>
            <LayoutTemplate size={17} /> From scratch
          </b>
          <span>Start with a ready-made personalised page and edit the blocks.</span>
        </button>
      </div>
      {error ? (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="bad">{error}</Alert>
        </div>
      ) : null}
      <Field label="Campaign name" hint={mode === 'pdf' ? 'Optional. We’ll use the PDF’s title.' : undefined}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q4 outbound — Playbook" autoFocus />
      </Field>
      <div style={{ height: 14 }} />
      {mode === 'pdf' ? (
        <>
          {aiOn ? (
            <label className="check" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={polish} onChange={(e) => setPolish(e.target.checked)} />
              <span>
                Let Claude tidy the copy where the PDF’s wording is weak{' '}
                <span className="muted">(optional; it never rewrites text that already reads well)</span>
              </span>
            </label>
          ) : null}
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files[0];
              if (f) void upload(f);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          >
            <div className="icon-bubble">
              <FileUp size={22} />
            </div>
            <b>Drop a PDF here, or click to browse</b>
            <p className="muted small" style={{ marginTop: 4 }}>
              Case studies, one-pagers, proposals, decks, whitepapers. Up to 25 MB.
            </p>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />
          </div>
        </>
      ) : (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" onClick={createBlank}>
            Create campaign <ArrowRight size={15} />
          </Button>
        </div>
      )}
    </Modal>
  );
}
