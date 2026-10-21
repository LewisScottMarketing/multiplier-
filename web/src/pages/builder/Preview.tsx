import { AlertTriangle, ExternalLink, Monitor, RefreshCw, Smartphone, Tablet, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SAMPLE_PROSPECTS } from '@shared/fields';
import { api, qs } from '../../api';
import { useCampaign, type PreviewSource } from '../../campaign';
import { personName } from '../../lib/format';
import type { ProspectItem } from '../../types';
import { Button, Input, Menu, Modal, Segmented, Spinner } from '../../ui';

type Device = 'desktop' | 'tablet' | 'mobile';
const WIDTH: Record<Device, string> = { desktop: '100%', tablet: '820px', mobile: '390px' };

interface PreviewResult {
  url: string;
  blocks: string[];
  tokens: { missing: string[]; fallbacks: string[] };
  context: Record<string, unknown>;
}

export const sourceToApi = (s: PreviewSource) => (s.kind === 'prospect' ? { kind: 'prospect' as const, id: s.id } : s);

function sourceLabel(s: PreviewSource): string {
  if (s.kind === 'sample') return personName(SAMPLE_PROSPECTS[s.index] ?? SAMPLE_PROSPECTS[0]!);
  if (s.kind === 'prospect') return s.label;
  return 'No data (fallbacks)';
}

function ProspectPicker({ onPick, onClose }: { onPick: (p: ProspectItem) => void; onClose: () => void }) {
  const c = useCampaign();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ProspectItem[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => api.get<{ prospects: ProspectItem[] }>(`/campaigns/${c.id}/prospects${qs({ q, limit: 20 })}`).then((r) => setRows(r.prospects)), 200);
    return () => clearTimeout(t);
  }, [q, c.id]);
  return (
    <Modal title="Preview as a real prospect" onClose={onClose}>
      <Input autoFocus placeholder="Search by name, company or email" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="col" style={{ gap: 2, marginTop: 12 }}>
        {rows === null ? <div className="viz-empty"><Spinner /></div> : !rows.length ? <div className="viz-empty">No prospects yet. Send one through from Clay or add one on the Audience tab.</div> : rows.map((p) => (
          <button key={p.id} className="btn ghost" style={{ justifyContent: 'flex-start', height: 'auto', padding: '8px 10px' }} onClick={() => onPick(p)}>
            <UserRound size={15} />
            <span style={{ textAlign: 'left' }}><b>{personName(p)}</b><br /><span className="muted small">{[p.job_title, p.company].filter(Boolean).join(' · ') || p.email}</span></span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function Preview({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const c = useCampaign();
  const [device, setDevice] = useState<Device>('desktop');
  const [urls, setUrls] = useState<{ a: string; b: string }>({ a: '', b: '' });
  const [front, setFront] = useState<'a' | 'b'>('a');
  const frontRef = useRef<'a' | 'b'>('a');
  const refs = { a: useRef<HTMLIFrameElement>(null), b: useRef<HTMLIFrameElement>(null) };
  const pending = useRef<'a' | 'b' | null>(null);
  const scrollY = useRef(0);
  const req = useRef(0);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [picking, setPicking] = useState(false);
  const [nonce, setNonce] = useState(0);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const key = JSON.stringify([c.draft.page, c.draft.document, c.draft.settings, c.previewSource, nonce]);
  useEffect(() => {
    const id = ++req.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.post<PreviewResult>(`/campaigns/${c.id}/preview`, { page: c.draft.page, document: c.draft.document, settings: c.draft.settings, source: sourceToApi(c.previewSource) });
        if (id !== req.current) return;
        setError('');
        setResult(r);
        c.setPreviewCtx(r.context);
        const back = frontRef.current === 'a' ? 'b' : 'a';
        scrollY.current = refs[frontRef.current].current?.contentWindow?.scrollY ?? 0;
        pending.current = back;
        setUrls((u) => ({ ...u, [back]: r.url }));
      } catch (e) {
        if (id === req.current) {
          setError(e instanceof Error ? e.message : 'Preview failed');
          setBusy(false);
        }
      }
    }, 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const highlight = (id: string | null, scroll: boolean) => {
    if (!id) return;
    refs[frontRef.current].current?.contentWindow?.postMessage({ type: 'mpl-highlight', id, scroll }, location.origin);
  };

  const onLoad = (which: 'a' | 'b') => {
    if (pending.current !== which) return;
    pending.current = null;
    try {
      refs[which].current?.contentWindow?.scrollTo(0, scrollY.current);
    } catch {
      /* cross-origin guard */
    }
    frontRef.current = which;
    setFront(which);
    setBusy(false);
    setTimeout(() => highlight(selectedRef.current, false), 30);
  };

  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      if (e.data?.type === 'mpl-select' && typeof e.data.id === 'string') {
        onSelect(e.data.id);
        highlight(e.data.id, false);
      }
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelect]);

  useEffect(() => highlight(selectedId, true), [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = c.previewCtx;
  const persona = [ctx.department_label, ctx.seniority_label].filter(Boolean).join(' · ');
  const missing = result?.tokens.missing ?? [];
  const live = c.campaign.status === 'live';

  return (
    <div className="pv">
      <div className="pv-bar">
        <Menu
          align="left"
          trigger={(_o, toggle) => (
            <Button size="sm" onClick={toggle}>
              <UserRound size={14} /> Preview as <b>{sourceLabel(c.previewSource)}</b>
            </Button>
          )}
        >
          {(close) => (
            <>
              <div className="tiny muted" style={{ padding: '6px 10px', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 650 }}>Sample people</div>
              {SAMPLE_PROSPECTS.map((p, i) => (
                <button key={i} onClick={() => { c.setPreviewSource({ kind: 'sample', index: i }); close(); }}>
                  <span><b>{personName(p)}</b><br /><span className="muted tiny">{p.job_title} · {p.company}</span></span>
                </button>
              ))}
              <hr />
              <button onClick={() => { c.setPreviewSource({ kind: 'empty' }); close(); }}>No data — see the fallbacks</button>
              <button onClick={() => { setPicking(true); close(); }}>A real prospect…</button>
            </>
          )}
        </Menu>
        {persona ? <span className="sample-pill" title="Segment derived from the job title">{persona}</span> : <span className="muted small">No job title → no segment</span>}
        {missing.length ? (
          <span className="badge warn" title={`Empty with no fallback: ${missing.join(', ')}`}><AlertTriangle size={11} /> {missing.length} empty field{missing.length === 1 ? '' : 's'}</span>
        ) : null}
        <div className="grow" />
        {busy ? <Spinner size={15} /> : null}
        <Segmented
          value={device}
          onChange={setDevice}
          options={[
            { value: 'desktop', label: <Monitor size={14} />, title: 'Desktop' },
            { value: 'tablet', label: <Tablet size={14} />, title: 'Tablet' },
            { value: 'mobile', label: <Smartphone size={14} />, title: 'Phone' },
          ]}
        />
        <Button size="sm" icon variant="ghost" title="Refresh preview" aria-label="Refresh preview" onClick={() => setNonce((n) => n + 1)}><RefreshCw size={14} /></Button>
        <Button size="sm" icon variant="ghost" title={live ? 'Open the published generic page' : 'Open this preview in a new tab'} aria-label="Open in new tab" onClick={() => window.open(urls[front] || undefined, '_blank')}><ExternalLink size={14} /></Button>
      </div>
      <div className="pv-stage">
        <div className="pv-frame" style={{ width: WIDTH[device] }}>
          {error ? <div className="alert bad" style={{ margin: 16 }}><AlertTriangle size={16} /><div>{error}</div></div> : null}
          {(['a', 'b'] as const).map((k) => (
            <iframe
              key={k}
              ref={refs[k]}
              src={urls[k] || undefined}
              title={`Page preview ${k}`}
              onLoad={() => onLoad(k)}
              style={{ opacity: front === k ? 1 : 0, pointerEvents: front === k ? 'auto' : 'none', zIndex: front === k ? 2 : 1 }}
            />
          ))}
        </div>
      </div>
      {picking ? <ProspectPicker onClose={() => setPicking(false)} onPick={(p) => { c.setPreviewSource({ kind: 'prospect', id: p.id, label: personName(p) }); setPicking(false); }} /> : null}
    </div>
  );
}
