import { useQuery } from '@tanstack/react-query';
import { Eye, FileUp, Hand, Highlighter, Minus, MousePointer2, PenLine, Plus, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newBlockId } from '@shared/blocks';
import type { PdfField } from '@shared/schema';
import { api } from '../api';
import { useCampaign } from '../campaign';
import { PreviewAs, sourceToApi, useSyncPreviewContext } from '../components/PreviewAs';
import { Alert, Button, CenterSpinner, EmptyState, Segmented, Spinner, useConfirm, useToast } from '../ui';
import { PageCanvas, runCoveredBy, type StudioPageData, type StudioRun } from './pdf/Canvas';
import { FIELD_META, makeField, suggestTemplate, type FieldType, type Tool } from './pdf/fields';
import { clamp, sampleBackground, type Rect } from './pdf/geometry';
import { Inspector } from './pdf/Inspector';
import { SidePanel, type FileInfo } from './pdf/SidePanel';
import './pdf/studio.css';

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function useSize(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 800, h: 700 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(read);
    read();
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Shown until a PDF is attached. */
function NoPdf() {
  const c = useCampaign();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      await c.save.flush();
      const form = new FormData();
      form.set('file', file);
      const r = await api.upload<{ detected: number }>(`/campaigns/${c.id}/document/upload`, form);
      await c.reload();
      toast.ok(r.detected ? `PDF added. We found ${r.detected} placeholder${r.detected === 1 ? '' : 's'} to fill in.` : 'PDF added. Click any text to personalise it.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the PDF');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="card">
        <EmptyState icon={<FileUp size={24} />} title="Add a PDF to personalise">
          Each prospect gets their own copy of your PDF with their name, company, logo or a QR code in place. You choose what changes by clicking the text.
        </EmptyState>
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          style={{ margin: '0 24px 24px' }}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
        >
          <div className="icon-bubble">{busy ? <Spinner size={22} /> : <FileUp size={22} />}</div>
          <b>{busy ? 'Reading your PDF…' : 'Drop a PDF here, or click to browse'}</b>
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        </div>
      </div>
    </div>
  );
}

export function PdfStudio() {
  const c = useCampaign();
  const doc = c.draft.document;
  if (!doc) return <NoPdf />;
  return <Studio key={doc.asset_id} />;
}

function Studio() {
  const c = useCampaign();
  const toast = useToast();
  const confirm = useConfirm();
  const doc = c.draft.document!;
  const [pageNo, setPageNo] = useState(1);
  const [tool, setTool] = useState<Tool>('select');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // the field made a moment ago gets the typing cursor; later re-selections don't steal focus
  const [fresh, setFresh] = useState<string | null>(null);
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [showAll, setShowAll] = useState(false);
  const [uploading, setUploading] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const stageSize = useSize(stage);
  useSyncPreviewContext();

  const fileQ = useQuery({ queryKey: ['document', c.id, doc.asset_id], queryFn: () => api.get<{ file: FileInfo | null }>(`/campaigns/${c.id}/document`), staleTime: Infinity });
  const file = fileQ.data?.file ?? undefined;
  const page = Math.min(Math.max(pageNo, 1), doc.page_count);
  const pageQ = useQuery({
    queryKey: ['doc-page', c.id, doc.asset_id, page],
    queryFn: () => api.get<{ page: StudioPageData; image_url: string }>(`/campaigns/${c.id}/document/page/${page}`),
    staleTime: Infinity,
  });
  const editable = file?.editable !== false;
  const imageUrl = pageQ.data?.image_url ?? `/api/campaigns/${c.id}/document/page/${page}.png`;
  const selected = doc.fields.find((f) => f.id === selectedId) ?? null;

  // ── document edits ────────────────────────────────────────────────────────
  const patchFields = useCallback((fn: (fields: PdfField[]) => PdfField[]) => c.setDocument((d) => (d ? { ...d, fields: fn(d.fields) } : d)), [c]);
  const addField = (f: PdfField) => {
    patchFields((fs) => [...fs, f]);
    setSelectedId(f.id);
    setFresh(f.id);
    setTool('select');
  };
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), 600);
    return () => clearTimeout(t);
  }, [fresh]);
  const updateField = (id: string, fn: (f: PdfField) => PdfField) => patchFields((fs) => fs.map((f) => (f.id === id ? fn(f) : f)));
  const removeField = (id: string) => {
    patchFields((fs) => fs.filter((f) => f.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  };
  const duplicate = (f: PdfField) => {
    const copy = { ...structuredClone(f), id: `f_${newBlockId()}`, rect: { ...f.rect, x: f.rect.x + 12, y: f.rect.y + 12 } } as PdfField;
    addField(copy);
  };

  const onRunClick = async (run: StudioRun) => {
    const existing = runCoveredBy(run, doc.fields, page);
    if (existing) return setSelectedId(existing.id);
    try {
      const r = await api.post<{ field: PdfField }>(`/campaigns/${c.id}/document/field-from-run`, { page, run_id: run.id, template: suggestTemplate(run.text) });
      addField(r.field);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not use that text');
    }
  };

  const onCreate = (type: Exclude<Tool, 'select'>, rect: Rect) => addField(makeField(type as FieldType, page, rect));

  const addStamp = async () => {
    const dim = file?.pages[0];
    try {
      const bg = dim ? await sampleBackground(`/api/campaigns/${c.id}/document/page/1.png`, { x: 40, y: dim.h - 44, w: dim.w - 80, h: 16 }, dim.w) : '#ffffff';
      const r = await api.post<{ field: PdfField }>(`/campaigns/${c.id}/document/stamp`, { page: 1, bg });
      setPageNo(1);
      addField(r.field);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the line');
    }
  };

  const upload = async (f: File) => {
    if (doc.fields.length && !(await confirm({ title: 'Replace the PDF?', body: `The ${doc.fields.length} field${doc.fields.length === 1 ? '' : 's'} you set up will be removed, because the layout of a new file can be different.`, confirm: 'Replace PDF' }))) return;
    setUploading(true);
    try {
      await c.save.flush();
      const form = new FormData();
      form.set('file', f);
      const r = await api.upload<{ detected: number }>(`/campaigns/${c.id}/document/upload`, form);
      await c.reload();
      setPageNo(1);
      setSelectedId(null);
      toast.ok(r.detected ? `PDF replaced. Found ${r.detected} placeholder${r.detected === 1 ? '' : 's'}.` : 'PDF replaced.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not replace the PDF');
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Remove the PDF?', body: 'Prospects will no longer get a personalised PDF, and the download button disappears from the page.', confirm: 'Remove PDF', danger: true }))) return;
    try {
      await c.save.flush();
      await api.del(`/campaigns/${c.id}/document`);
      await c.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the PDF');
    }
  };

  // ── preview ───────────────────────────────────────────────────────────────
  const [pv, setPv] = useState<{ url: string | null; busy: boolean; warnings: string[]; error: string }>({ url: null, busy: false, warnings: [], error: '' });
  const req = useRef(0);
  const urlRef = useRef<string | null>(null);
  const pvKey = JSON.stringify([mode, doc, c.previewSource, page]);
  useEffect(() => {
    if (mode !== 'preview') return;
    const id = ++req.current;
    setPv((p) => ({ ...p, busy: true }));
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/campaigns/${c.id}/document/preview`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ document: doc, source: sourceToApi(c.previewSource), page }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(j?.error?.message ?? `The preview failed (${res.status})`);
        }
        let warnings: string[] = [];
        try {
          warnings = JSON.parse(atob(res.headers.get('X-Preview-Warnings') ?? 'W10=')) as string[];
        } catch {
          /* header is advisory */
        }
        const blob = await res.blob();
        if (id !== req.current) return;
        const url = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setPv({ url, busy: false, warnings, error: '' });
      } catch (e) {
        if (id === req.current) setPv((p) => ({ ...p, busy: false, error: e instanceof Error ? e.message : 'The preview failed' }));
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvKey]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  // ── keyboard ──────────────────────────────────────────────────────────────
  const stateRef = useRef({ selected, tool, mode });
  stateRef.current = { selected, tool, mode };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && stateRef.current.selected) {
          e.preventDefault();
          duplicate(stateRef.current.selected);
        }
        return;
      }
      const { selected: sel } = stateRef.current;
      if (stateRef.current.mode !== 'edit') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault();
        removeField(sel.id);
      } else if (e.key === 'Escape') {
        setTool('select');
        setSelectedId(null);
      } else if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        updateField(sel.id, (f) => ({ ...f, rect: { ...f.rect, x: f.rect.x + dx, y: f.rect.y + dy } }) as PdfField);
      } else if (!e.shiftKey) {
        const t = ({ v: 'select', t: 'text', i: 'image', q: 'qr', l: 'link' } as Record<string, Tool>)[e.key.toLowerCase()];
        if (t) setTool(t);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── layout ────────────────────────────────────────────────────────────────
  const pageData = pageQ.data?.page;
  // "Fit" shows the whole page, so the first look is the real layout, not just the top third
  const fit = pageData ? clamp(Math.min((stageSize.w - 56) / pageData.width, (stageSize.h - 56) / pageData.height), 0.25, 2.2) : 1;
  const scale = zoom === 'fit' ? fit : zoom;
  const stepZoom = (dir: 1 | -1) => {
    const cur = scale;
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.01) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.01);
    if (next) setZoom(next);
  };

  return (
    <div className="studio">
      <SidePanel
        campaignId={c.id}
        doc={doc}
        file={file}
        pageNo={page}
        selectedId={selectedId}
        uploading={uploading}
        onPage={(n) => setPageNo(n)}
        onSelect={(id, p) => { setSelectedId(id); setPageNo(p); setMode('edit'); }}
        onFilename={(filename) => c.setDocument((d) => (d ? { ...d, filename } : d))}
        onReplace={upload}
        onRemove={remove}
      />

      <div className="st-center">
        <div className="st-bar">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'edit', label: <><PenLine size={13} /> Edit</> },
              { value: 'preview', label: <><Eye size={13} /> Preview</> },
            ]}
          />
          {mode === 'edit' && editable ? (
            <>
              <span className="sep" />
              <button type="button" className="tool-btn" aria-pressed={tool === 'select'} onClick={() => setTool('select')} title="Select and click text (V)"><MousePointer2 size={14} /> <span className="lbl">Select</span></button>
              {(Object.keys(FIELD_META) as FieldType[]).map((t) => {
                const Icon = FIELD_META[t].icon;
                return (
                  <button key={t} type="button" className="tool-btn" aria-pressed={tool === t} onClick={() => setTool(tool === t ? 'select' : t)} title={`${FIELD_META[t].hint} (${({ text: 'T', image: 'I', qr: 'Q', link: 'L' })[t]})`}>
                    <Icon size={14} /> <span className="lbl">{FIELD_META[t].label}</span>
                  </button>
                );
              })}
              <span className="sep" />
              <button type="button" className="tool-btn" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)} title="Outline all the text you can click"><Highlighter size={14} /> <span className="lbl">Show text</span></button>
            </>
          ) : null}
          <div className="grow" />
          <PreviewAs />
        </div>

        {mode === 'preview' ? (
          <div style={{ padding: '8px 14px 0', background: '#e9ebf3' }}>
            {pv.error ? <Alert tone="bad">{pv.error}</Alert> : pv.warnings.length ? (
              <Alert tone="warn">
                <b>Heads up for this person:</b>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{pv.warnings.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}</ul>
              </Alert>
            ) : (
              <div className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Hand size={13} /> This is exactly what this person’s PDF looks like. Switch to Edit to change it.</div>
            )}
          </div>
        ) : null}

        <div className="st-stage-wrap">
        <div className="st-stage" ref={stage}>
          {pageQ.isLoading || !pageData ? (
            <div style={{ margin: 'auto' }}>{pageQ.error ? <Alert tone="bad">{(pageQ.error as Error).message}</Alert> : <CenterSpinner />}</div>
          ) : (
            <div className="pdf-holder">
              <PageCanvas
                page={pageData}
                pageNo={page}
                imageUrl={imageUrl}
                scale={scale}
                fields={doc.fields}
                mode={mode}
                previewUrl={pv.url}
                previewBusy={pv.busy}
                tool={editable ? tool : 'select'}
                showAllText={showAll}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onRunClick={editable ? onRunClick : () => undefined}
                onCreate={onCreate}
                onRect={(id, rect) => updateField(id, (f) => ({ ...f, rect }) as PdfField)}
              />
            </div>
          )}
        </div>
        <div className="zoom zoom-float">
          <Button size="sm" variant="ghost" icon aria-label="Zoom out" onClick={() => stepZoom(-1)}><Minus size={14} /></Button>
          <span>{Math.round(scale * 100)}%</span>
          <Button size="sm" variant="ghost" icon aria-label="Zoom in" onClick={() => stepZoom(1)}><Plus size={14} /></Button>
          <Button size="xs" variant={zoom === 'fit' ? 'default' : 'ghost'} onClick={() => setZoom('fit')} title="Fit the whole page in the window">Fit</Button>
        </div>
        </div>
      </div>

      <div className="st-right">
        {selected && mode === 'edit' ? (
          <Inspector
            field={selected}
            pageW={pageData?.width ?? 612}
            pageH={pageData?.height ?? 792}
            imageUrl={`/api/campaigns/${c.id}/document/page/${selected.page}.png`}
            onChange={(fn) => updateField(selected.id, fn)}
            onDelete={() => removeField(selected.id)}
            onDuplicate={() => duplicate(selected)}
            focusText={fresh === selected.id}
          />
        ) : (
          <>
            <div className="st-sec">
              <h4>Make this PDF personal</h4>
              <ol className="st-steps">
                <li><span><b>Click any text</b> in the PDF, such as a name placeholder or a company, to swap it for a merge field.</span></li>
                <li><span><b>Draw a box</b> with Text, Image, QR code or Link to add something new, like a logo or a QR code to their page.</span></li>
                <li><span>Hit <b>Preview</b> and pick someone to see exactly what they’ll get.</span></li>
              </ol>
            </div>
            <div className="st-sec">
              <h4>Quick adds</h4>
              <Button size="sm" onClick={addStamp} disabled={!editable}><Sparkles size={14} /> Add a “Prepared for …” line</Button>
              <Button size="sm" disabled={!editable || !pageData} onClick={() => pageData && addField(makeField('qr', page, { x: pageData.width - 110, y: pageData.height - 110, w: 72, h: 72 }))}>{(() => { const I = FIELD_META.qr.icon; return <I size={14} />; })()} Add a QR code to their page</Button>
              <p className="hint">Quick adds land on {page === 1 ? 'this page' : 'page 1 or this page'}; drag them wherever you like.</p>
            </div>
            <div className="st-sec">
              <h4>Good to know</h4>
              <div className="st-help">
                <b>Long names fit.</b> Text shrinks to fit its box, so “Montgomery-Featherstonehaugh” doesn’t break your layout. Set the fallback for blanks, for example <code>{'{{first_name|there}}'}</code>.
              </div>
              <div className="st-help">
                <b>Covering text</b> paints over the original so only the new text shows. The original is still inside the file, so it isn’t suitable for hiding secrets.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
