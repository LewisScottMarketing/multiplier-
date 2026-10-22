import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, FileText, FileUp, LayoutTemplate } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { TemplateInfo } from '@shared/templates';
import { api } from '../api';
import type { Campaign, SettingsResponse } from '../types';
import { BrandField } from './BrandSelect';
import { Alert, Button, Field, Input, Modal, Spinner, useToast } from '../ui';

type Mode = 'pdf' | 'template';

/** The width pages are laid out at inside a gallery thumbnail; the frame is then scaled down to fit its card. */
const THUMB_WIDTH = 1280;

/** A live, scaled-down view of a template's first screen. */
function Thumb({ id }: { id: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / THUMB_WIDTH);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <span className="tpl-shot" ref={box} aria-hidden="true">
      <iframe
        src={`/preview/template/${id}`}
        title=""
        tabIndex={-1}
        loading="lazy"
        style={{ width: THUMB_WIDTH, height: THUMB_WIDTH * 0.64, transform: `scale(${scale})` }}
      />
    </span>
  );
}

export function NewCampaignModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('pdf');
  const [template, setTemplate] = useState('personal-pitch');
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ templates: TemplateInfo[] }>('/campaigns/templates'),
    staleTime: Infinity,
    enabled: mode === 'template',
  });
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
  /** The brand to follow: "" is the default brand, "none" is none. */
  const [brand, setBrand] = useState('');

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
      if (brand) form.set('brand_id', brand);
      const r = await api.upload<{ campaign: Campaign; report: string[] }>('/campaigns/import-pdf', form);
      setResult(r);
      setPhase('done');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed.');
      setPhase('choose');
    }
  };

  const createFromTemplate = async () => {
    setPhase('working');
    try {
      const chosen = templates.data?.templates.find((t) => t.id === template);
      const r = await api.post<{ campaign: Campaign }>('/campaigns', {
        name: name.trim() || chosen?.name || 'Untitled campaign',
        template,
        brand_id: brand || undefined,
      });
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
      <Modal title={mode === 'pdf' ? 'Building your page…' : 'Creating your campaign…'} onClose={() => undefined}>
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
                {aiOn && polish
                  ? 'Claude is looking at every page and designing the page from it. This takes up to a minute.'
                  : 'Reading the text and layout, picking your brand colour and drafting the page. This usually takes a few seconds.'}
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
    <Modal
      title="New campaign"
      onClose={onClose}
      size={mode === 'template' ? 'xwide' : undefined}
      description="Start from a PDF you already have, or from a ready-made page."
      footer={
        mode === 'template' ? (
          // the choice is made above, so the name and the button stay in view however far the gallery is scrolled
          <>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Campaign name (optional)"
              aria-label="Campaign name"
              style={{ maxWidth: 340 }}
              onKeyDown={(e) => e.key === 'Enter' && templates.data && void createFromTemplate()}
            />
            <Button variant="primary" onClick={createFromTemplate} disabled={!templates.data}>
              Use this template <ArrowRight size={15} />
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="option-cards">
        <button type="button" className={`option-card ${mode === 'pdf' ? 'on' : ''}`} onClick={() => setMode('pdf')}>
          <b>
            <FileUp size={17} /> From a PDF
          </b>
          <span>We build the landing page from it, and each prospect gets their own edited copy of the PDF.</span>
        </button>
        <button type="button" className={`option-card ${mode === 'template' ? 'on' : ''}`} onClick={() => setMode('template')}>
          <b>
            <LayoutTemplate size={17} /> From a template
          </b>
          <span>Pick a designed, personalised page, then swap in your own words and numbers.</span>
        </button>
      </div>
      {error ? (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="bad">{error}</Alert>
        </div>
      ) : null}
      {mode === 'template' ? (
        <div style={{ marginBottom: 14 }}>
          <BrandField
            value={brand}
            onChange={setBrand}
            noneLabel="No brand (each template’s own look)"
            hint="Its colours, typefaces and logo go on the page, and its voice guides the AI."
          />
        </div>
      ) : null}
      {mode === 'template' ? (
        <div className="tpl-grid" role="radiogroup" aria-label="Templates">
          {templates.isLoading ? <Spinner /> : null}
          {templates.isError ? <Alert tone="bad">The templates could not be loaded.</Alert> : null}
          {templates.data?.templates.map((t) => (
            <div
              key={t.id}
              className={`tpl ${template === t.id ? 'on' : ''}`}
              role="radio"
              aria-checked={template === t.id}
              tabIndex={0}
              onClick={() => setTemplate(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setTemplate(t.id);
                }
              }}
            >
              <Thumb id={t.id} />
              <span className="tpl-name">{t.name}</span>
              <span className="tpl-blurb">{t.blurb}</span>
              <span className="tpl-use">{t.use}</span>
            </div>
          ))}
        </div>
      ) : null}
      {mode === 'pdf' ? (
        <>
          <Field label="Campaign name" hint="Optional. We’ll use the PDF’s title.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q4 outbound — Playbook" autoFocus />
          </Field>
          <div style={{ height: 14 }} />
          <BrandField
            value={brand}
            onChange={setBrand}
            noneLabel="No brand (match the PDF’s own look)"
            hint="Its colours, typefaces and logo go on the page, and its voice guides Claude."
          />
          <div style={{ height: 14 }} />
          {aiOn ? (
            <label className="check" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={polish} onChange={(e) => setPolish(e.target.checked)} />
              <span>
                Let Claude design the page{' '}
                <span className="muted">
                  (it looks at every page and lays the content out with the best-fitting blocks. This takes up to a minute and uses more of
                  your Claude credit than the other AI features, since it reads the pages as pictures. If anything looks off, the standard
                  import is used instead)
                </span>
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
      ) : null}
    </Modal>
  );
}
