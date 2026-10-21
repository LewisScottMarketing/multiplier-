import { UserRound } from 'lucide-react';
import { buildContext } from '@shared/derive';
import { useEffect, useState } from 'react';
import { SAMPLE_PROSPECTS } from '@shared/fields';
import { api, qs } from '../api';
import { useCampaign, type PreviewSource } from '../campaign';
import { personName } from '../lib/format';
import type { ProspectItem } from '../types';
import { Button, Input, Menu, Modal, Spinner } from '../ui';

export const sourceToApi = (s: PreviewSource) => (s.kind === 'prospect' ? { kind: 'prospect' as const, id: s.id } : s);

/**
 * Keeps the campaign's preview context (used by every "→ Hi Jane" hint) in step with the chosen
 * person, for editors that don't get one back from the server (the PDF studio).
 */
export function useSyncPreviewContext() {
  const c = useCampaign();
  const src = c.previewSource;
  const clean = c.draft.settings.clean_names;
  const { setPreviewCtx } = c;
  useEffect(() => {
    let live = true;
    if (src.kind === 'empty') setPreviewCtx({});
    else if (src.kind === 'sample') {
      const ctx = buildContext(SAMPLE_PROSPECTS[src.index] ?? SAMPLE_PROSPECTS[0]!, { cleanNames: clean });
      ctx.page_url = `${c.detail.public_url}/p/SAMPLEtoken`;
      ctx.pdf_url = `${c.detail.public_url}/p/SAMPLEtoken.pdf`;
      ctx.today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      setPreviewCtx(ctx);
    } else {
      api.get<{ context: Record<string, string> }>(`/prospects/${src.id}`).then((r) => live && setPreviewCtx(r.context)).catch(() => live && setPreviewCtx({}));
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(src), clean]);
}

export function sourceLabel(s: PreviewSource): string {
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

/** "Preview as Jane Doe ▾": pick who the page or PDF is rendered for. Shared by both editors. */
export function PreviewAs() {
  const c = useCampaign();
  const [picking, setPicking] = useState(false);
  return (
    <>
      <Menu
        align="left"
        trigger={(_o, toggle) => (
          <Button size="sm" className="pv-who" onClick={toggle}>
            <UserRound size={14} style={{ flex: 'none' }} /> <span>Preview as <b>{sourceLabel(c.previewSource)}</b></span>
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
      {picking ? <ProspectPicker onClose={() => setPicking(false)} onPick={(p) => { c.setPreviewSource({ kind: 'prospect', id: p.id, label: personName(p) }); setPicking(false); }} /> : null}
    </>
  );
}
