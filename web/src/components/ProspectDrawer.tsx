import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CalendarCheck, Download, ExternalLink, Eye, FileText, MousePointerClick, Send, Timer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DEPARTMENT_LABELS, SENIORITY_LABELS, type Department, type Seniority } from '@shared/derive';
import { api } from '../api';
import { fmtDateTime, fmtDuration, initials, personName, timeAgo } from '../lib/format';
import type { ProspectItem, TimelineEvent } from '../types';
import { Alert, Button, CenterSpinner, CopyBox, Drawer, useConfirm, useToast } from '../ui';
import { StageChip } from './Stage';

interface Detail {
  prospect: ProspectItem;
  campaign: { id: string; name: string; slug: string; status: 'draft' | 'live' | 'archived' };
  timeline: TimelineEvent[];
  submissions: Array<{ id: string; created_at: number; data: Record<string, unknown> }>;
  context: Record<string, string>;
}

const HIDDEN_CONTEXT = new Set(['page_url', 'pdf_url', 'cover_url', 'prospect_id', 'today']);

const ICON = {
  view: <Eye size={14} />,
  engaged: <Timer size={14} />,
  click: <MousePointerClick size={14} />,
  download: <Download size={14} />,
  submit: <Send size={14} />,
  booked: <CalendarCheck size={14} />,
  hit: <Bot size={14} />,
} as const;

function describe(e: TimelineEvent): { text: string; detail?: string } {
  const p = e.props;
  switch (e.type) {
    case 'view': {
      const w = Number(p.w);
      return { text: 'Opened the page', detail: w ? (w < 700 ? 'On a phone' : 'On a computer') : undefined };
    }
    case 'engaged': {
      const s = Number(p.s) || 0;
      const scroll = Number(p.scroll);
      return { text: `Spent ${fmtDuration(s)} reading`, detail: scroll ? `Scrolled ${Math.round(scroll)}% of the page` : undefined };
    }
    case 'click':
      return { text: `Clicked “${String(p.label ?? 'a button')}”` };
    case 'download':
      return { text: 'Downloaded the PDF' };
    case 'submit':
      return { text: 'Submitted the form' };
    case 'booked':
      return { text: 'Booked a meeting' };
    default:
      return { text: e.is_bot ? 'Link fetched by an automated scanner' : 'Link requested' };
  }
}

export function ProspectDrawer({ id, onClose, onDeleted }: { id: string; onClose: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [showBots, setShowBots] = useState(false);
  const q = useQuery({ queryKey: ['prospect', id], queryFn: () => api.get<Detail>(`/prospects/${id}`) });

  const remove = async () => {
    const ok = await confirm({
      title: 'Remove this prospect?',
      body: 'Their link will stop working and their activity is deleted. This can’t be undone.',
      confirm: 'Remove prospect',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/prospects/${id}`);
      qc.invalidateQueries({ queryKey: ['prospects'] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.ok('Prospect removed');
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the prospect');
    }
  };

  const d = q.data;
  const p = d?.prospect;
  const name = p ? personName(p) : '';
  const human = d?.timeline.filter((e) => !e.is_bot && e.type !== 'hit') ?? [];
  const automated = d?.timeline.filter((e) => e.is_bot || e.type === 'hit') ?? [];
  const shown = showBots ? [...human, ...automated].sort((a, b) => b.created_at - a.created_at) : human;
  const custom = p ? Object.entries(p.data).filter(([, v]) => v !== null && v !== '') : [];

  return (
    <Drawer
      onClose={onClose}
      title={
        p ? (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span className="avatar" style={{ width: 40, height: 40, fontSize: 14 }}>{initials(name)}</span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 680 }} className="truncate">{name}</h2>
              <div className="muted small truncate">{[p.job_title, p.company].filter(Boolean).join(' · ') || p.email || 'No details yet'}</div>
            </div>
          </div>
        ) : (
          <h2 style={{ fontSize: 18 }}>Prospect</h2>
        )
      }
      actions={
        p ? (
          <Button variant="ghost" size="sm" icon title="Remove prospect" aria-label="Remove prospect" onClick={remove}>
            <Trash2 size={15} />
          </Button>
        ) : null
      }
    >
      {q.isLoading ? <CenterSpinner /> : q.error ? <Alert tone="bad">{(q.error as Error).message}</Alert> : d && p ? (
        <>
          <div className="row wrap">
            <StageChip stage={p.stage} />
            {p.seniority ? <span className="chip">{SENIORITY_LABELS[p.seniority as Seniority] ?? p.seniority}</span> : null}
            {p.department && p.department !== 'other' ? <span className="chip">{DEPARTMENT_LABELS[p.department as Department] ?? p.department}</span> : null}
            <span className="muted tiny right">Added {timeAgo(p.created_at)}</span>
          </div>

          <section className="col" style={{ gap: 8 }}>
            <div className="label">Their personalised links</div>
            {d.campaign.status !== 'live' ? <Alert tone="warn">This campaign isn’t published yet, so these links will say “not available” until you publish it.</Alert> : null}
            <CopyBox text={p.url} />
            {p.pdf_url ? <CopyBox text={p.pdf_url} /> : null}
            <div className="row wrap">
              <Button size="sm" onClick={() => window.open(p.url, '_blank', 'noopener')}><ExternalLink size={14} /> Open page</Button>
              {p.pdf_url ? <Button size="sm" onClick={() => window.open(p.pdf_url!, '_blank', 'noopener')}><FileText size={14} /> Open PDF</Button> : null}
            </div>
          </section>

          <section>
            <div className="label" style={{ marginBottom: 8 }}>Engagement</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                ['Views', p.engagement.views],
                ['Clicks', p.engagement.clicks],
                ['Downloads', p.engagement.downloads],
                ['Replies', p.engagement.submissions],
                ['Time on page', p.engagement.engaged_seconds ? fmtDuration(p.engagement.engaged_seconds) : '—'],
                ['Score', p.engagement.score],
              ].map(([k, v]) => (
                <div key={k as string} style={{ background: 'var(--bg)', borderRadius: 10, padding: '9px 12px' }}>
                  <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>{v}</div>
                  <div className="muted tiny">{k}</div>
                </div>
              ))}
            </div>
            {p.engagement.last_seen_at ? <div className="muted small" style={{ marginTop: 8 }}>Last seen {timeAgo(p.engagement.last_seen_at)}</div> : null}
          </section>

          {d.submissions.length ? (
            <section className="col" style={{ gap: 8 }}>
              <div className="label">What they sent</div>
              {d.submissions.map((s) => (
                <div key={s.id} style={{ background: 'var(--ok-bg)', borderRadius: 10, padding: '10px 12px' }}>
                  <div className="muted tiny" style={{ marginBottom: 4 }}>{fmtDateTime(s.created_at)}</div>
                  <dl className="kv" style={{ gridTemplateColumns: '90px 1fr', margin: 0 }}>
                    {Object.entries(s.data).map(([k, v]) => (
                      <div key={k} style={{ display: 'contents' }}>
                        <dt>{k.replace(/_/g, ' ')}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </section>
          ) : null}

          <section>
            <div className="row" style={{ marginBottom: 6 }}>
              <div className="label">Activity</div>
              {automated.length ? (
                <button type="button" className="btn xs ghost right" onClick={() => setShowBots((s) => !s)}>
                  {showBots ? 'Hide' : 'Show'} {automated.length} automated
                </button>
              ) : null}
            </div>
            {!shown.length ? (
              <div className="muted small" style={{ padding: '8px 0' }}>Nothing yet. They haven’t opened their link.</div>
            ) : (
              <div className="timeline">
                {shown.map((e) => {
                  const t = describe(e);
                  return (
                    <div key={e.id} className="tl-item" style={{ opacity: e.is_bot || e.type === 'hit' ? 0.6 : 1 }}>
                      <div className={`tl-ico ${e.type}`}>{ICON[e.type] ?? <Eye size={14} />}</div>
                      <div style={{ minWidth: 0 }}>
                        <div>{t.text}</div>
                        {t.detail ? <div className="muted tiny">{t.detail}</div> : null}
                      </div>
                      <div className="muted tiny nowrap" title={fmtDateTime(e.created_at)}>{timeAgo(e.created_at)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <div className="label" style={{ marginBottom: 8 }}>Data from Clay</div>
            <dl className="kv">
              {p.email ? <><dt>Email</dt><dd>{p.email}</dd></> : null}
              {p.external_id ? <><dt>Your ID</dt><dd className="mono">{p.external_id}</dd></> : null}
              {custom.map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{k.replace(/_/g, ' ')}</dt>
                  <dd>{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
                </div>
              ))}
            </dl>
            {!p.email && !custom.length && !p.external_id ? <div className="muted small">No extra fields.</div> : null}
            <details style={{ marginTop: 12 }}>
              <summary className="small muted" style={{ cursor: 'pointer' }}>Every merge field the page can use for {p.first_name || 'them'}</summary>
              <dl className="kv" style={{ marginTop: 8 }}>
                {Object.entries(d.context)
                  .filter(([k]) => !HIDDEN_CONTEXT.has(k))
                  .map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt className="mono tiny">{`{{${k}}}`}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          </section>
        </>
      ) : null}
    </Drawer>
  );
}
