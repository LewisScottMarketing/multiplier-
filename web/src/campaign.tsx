import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { lintCampaign } from '@shared/lint';
import type { Ctx } from '@shared/template';
import { STANDARD_FIELDS } from '@shared/fields';
import type { CampaignSettings, DocumentConfig, Page } from '@shared/schema';
import { api, ApiError } from './api';
import type { Campaign, CampaignDetail, FieldInfo, LintIssue } from './types';

export interface Draft {
  page: Page;
  document: DocumentConfig | null;
  settings: CampaignSettings;
}

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
export type PreviewSource = { kind: 'sample'; index: number } | { kind: 'prospect'; id: string; label: string } | { kind: 'empty' };

export interface CampaignCtx {
  id: string;
  campaign: Campaign;
  detail: CampaignDetail;
  draft: Draft;
  setPage: (fn: (p: Page) => Page, opts?: { coalesce?: string }) => void;
  setDocument: (fn: (d: DocumentConfig | null) => DocumentConfig | null) => void;
  setSettings: (fn: (s: CampaignSettings) => CampaignSettings) => void;
  save: { state: SaveState; error: string; flush: () => Promise<void> };
  issues: LintIssue[];
  /** Merge fields available to templates: standard, custom (from Clay) and AI fields. */
  fields: FieldInfo[];
  previewSource: PreviewSource;
  setPreviewSource: (s: PreviewSource) => void;
  /** Context the latest preview was rendered with, for live "→ Hi Jane" hints. */
  previewCtx: Ctx;
  setPreviewCtx: (c: Ctx) => void;
  history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
  /** Re-fetch from the server, discarding the local draft (after server-side changes like a PDF upload). */
  reload: () => Promise<void>;
  rename: (name: string) => Promise<void>;
}

const Ctx = createContext<CampaignCtx | null>(null);
export function useCampaign(): CampaignCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCampaign outside provider');
  return v;
}

const SOURCE_KEY = 'mpl-preview-source';
function loadSource(): PreviewSource {
  try {
    const raw = localStorage.getItem(SOURCE_KEY);
    if (raw) return JSON.parse(raw) as PreviewSource;
  } catch {
    /* ignore */
  }
  return { kind: 'sample', index: 0 };
}

const section = (d: Draft) => ({ page: JSON.stringify(d.page), document: JSON.stringify(d.document), settings: JSON.stringify(d.settings) });

export function CampaignProvider({ id, children }: { id: string; children: (ctx: CampaignCtx | null, status: { loading: boolean; error: Error | null }) => ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['campaign', id], queryFn: () => api.get<CampaignDetail>(`/campaigns/${id}`), staleTime: Infinity, refetchOnMount: 'always' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [state, setState] = useState<SaveState>('saved');
  const [error, setError] = useState('');
  const saved = useRef<ReturnType<typeof section> | null>(null);
  const version = useRef(0);
  const [previewSource, setSource] = useState<PreviewSource>(loadSource);
  const [previewCtx, setPreviewCtx] = useState<Ctx>({});

  // undo/redo over the page only
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const lastPush = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const [, bump] = useState(0);

  const adopt = useCallback((c: Campaign) => {
    const d: Draft = { page: c.page, document: c.document, settings: c.settings };
    setDraft(d);
    saved.current = section(d);
    version.current = c.version;
    past.current = [];
    future.current = [];
    setState('saved');
    setError('');
  }, []);

  useEffect(() => {
    if (q.data && (draft === null || version.current === 0)) adopt(q.data.campaign);
    // adopt once per server load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  // reset when navigating between campaigns
  useEffect(() => {
    setDraft(null);
    version.current = 0;
  }, [id]);

  const draftJson = draft ? section(draft) : null;
  const dirty = !!draftJson && !!saved.current && (draftJson.page !== saved.current.page || draftJson.document !== saved.current.document || draftJson.settings !== saved.current.settings);

  const flush = useCallback(async () => {
    if (!draft || !saved.current) return;
    const now = section(draft);
    const patch: Record<string, unknown> = { base_version: version.current };
    if (now.page !== saved.current.page) patch.page = draft.page;
    if (now.document !== saved.current.document) patch.document = draft.document;
    if (now.settings !== saved.current.settings) patch.settings = draft.settings;
    if (Object.keys(patch).length === 1) return;
    setState('saving');
    try {
      const r = await api.put<{ campaign: Campaign; issues: LintIssue[] }>(`/campaigns/${id}`, patch);
      version.current = r.campaign.version;
      saved.current = { page: patch.page ? now.page : saved.current.page, document: 'document' in patch ? now.document : saved.current.document, settings: 'settings' in patch ? now.settings : saved.current.settings };
      qc.setQueryData<CampaignDetail>(['campaign', id], (old) => (old ? { ...old, campaign: { ...old.campaign, version: r.campaign.version, updated_at: r.campaign.updated_at }, issues: r.issues } : old));
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      setState('saved');
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setState('conflict');
        setError(e.message);
      } else {
        setState('error');
        setError(e instanceof Error ? e.message : 'Could not save');
      }
    }
  }, [draft, id, qc]);

  // debounced autosave
  useEffect(() => {
    if (!dirty || state === 'saving' || state === 'conflict') return;
    setState((s) => (s === 'error' ? s : 'dirty'));
    const t = setTimeout(() => void flush(), 1200);
    return () => clearTimeout(t);
  }, [draftJson?.page, draftJson?.document, draftJson?.settings]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const pushHistory = (prev: Page, key?: string) => {
    const now = Date.now();
    // consecutive edits to the same field collapse into one undo step
    if (key && lastPush.current.key === key && now - lastPush.current.at < 900) {
      lastPush.current.at = now;
      return;
    }
    past.current.push(JSON.stringify(prev));
    if (past.current.length > 80) past.current.shift();
    future.current = [];
    lastPush.current = { key: key ?? '', at: now };
    bump((n) => n + 1);
  };

  const setPage = useCallback((fn: (p: Page) => Page, opts?: { coalesce?: string }) => {
    setDraft((d) => {
      if (!d) return d;
      const next = fn(d.page);
      if (next === d.page) return d;
      pushHistory(d.page, opts?.coalesce);
      return { ...d, page: next };
    });
  }, []);
  const setDocument = useCallback((fn: (d: DocumentConfig | null) => DocumentConfig | null) => setDraft((d) => (d ? { ...d, document: fn(d.document) } : d)), []);
  const setSettings = useCallback((fn: (s: CampaignSettings) => CampaignSettings) => setDraft((d) => (d ? { ...d, settings: fn(d.settings) } : d)), []);

  const history = useMemo(
    () => ({
      undo: () =>
        setDraft((d) => {
          const prev = past.current.pop();
          if (!d || prev === undefined) return d;
          future.current.push(JSON.stringify(d.page));
          lastPush.current = { key: '', at: 0 };
          bump((n) => n + 1);
          return { ...d, page: JSON.parse(prev) as Page };
        }),
      redo: () =>
        setDraft((d) => {
          const next = future.current.pop();
          if (!d || next === undefined) return d;
          past.current.push(JSON.stringify(d.page));
          bump((n) => n + 1);
          return { ...d, page: JSON.parse(next) as Page };
        }),
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [past.current.length, future.current.length],
  );

  const reload = useCallback(async () => {
    const fresh = await api.get<CampaignDetail>(`/campaigns/${id}`);
    qc.setQueryData(['campaign', id], fresh);
    adopt(fresh.campaign);
    qc.invalidateQueries({ queryKey: ['campaigns'] });
  }, [id, qc, adopt]);

  const rename = useCallback(
    async (name: string) => {
      const r = await api.put<{ campaign: Campaign }>(`/campaigns/${id}`, { name });
      version.current = r.campaign.version;
      qc.setQueryData<CampaignDetail>(['campaign', id], (old) => (old ? { ...old, campaign: { ...old.campaign, name: r.campaign.name, version: r.campaign.version } } : old));
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    [id, qc],
  );

  const setPreviewSource = useCallback((s: PreviewSource) => {
    setSource(s);
    try {
      localStorage.setItem(SOURCE_KEY, JSON.stringify(s));
    } catch {
      /* private mode */
    }
  }, []);

  const detail = q.data;
  const issues = useMemo(() => (draft && detail ? lintCampaign(draft, detail.custom_fields) : []), [draft, detail]);
  const fields = useMemo<FieldInfo[]>(() => {
    if (!draft || !detail) return STANDARD_FIELDS;
    const known = new Set(STANDARD_FIELDS.map((f) => f.key));
    const custom: FieldInfo[] = detail.custom_fields.filter((k) => !known.has(k)).map((k) => ({ key: k, label: k.replace(/_/g, ' '), example: '', group: 'person', hint: 'Custom field from Clay' }));
    const ai: FieldInfo[] = draft.settings.ai_fields.map((f) => ({ key: `ai_${f.key}`, label: f.label || `AI: ${f.key}`, example: f.fallback || 'AI-written', group: 'segment', hint: 'Written per prospect by AI' }));
    return [...STANDARD_FIELDS, ...custom, ...ai];
  }, [draft, detail]);

  if (!detail || !draft) return <>{children(null, { loading: q.isLoading || !draft, error: q.error as Error | null })}</>;

  const value: CampaignCtx = {
    id,
    campaign: detail.campaign,
    detail,
    draft,
    setPage,
    setDocument,
    setSettings,
    save: { state: dirty && state === 'saved' ? 'dirty' : state, error, flush },
    issues,
    fields,
    previewSource,
    setPreviewSource,
    previewCtx,
    setPreviewCtx,
    history,
    reload,
    rename,
  };
  return <Ctx.Provider value={value}>{children(value, { loading: false, error: null })}</Ctx.Provider>;
}
