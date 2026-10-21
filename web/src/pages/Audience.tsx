import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileUp, Plug, Plus, Search, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DEPARTMENT_LABELS, SENIORITY_LABELS, type Department, type Seniority } from '@shared/derive';
import { api, qs } from '../api';
import { useCampaign } from '../campaign';
import { AddProspectModal } from '../components/AddProspectModal';
import { ImportCsvModal } from '../components/ImportCsvModal';
import { ProspectDrawer } from '../components/ProspectDrawer';
import { StageChip } from '../components/Stage';
import { fmtNum, initials, personName, timeAgo } from '../lib/format';
import type { Engagement, ProspectItem } from '../types';
import { Alert, Button, CenterSpinner, CopyButton, EmptyState, Input, Segmented, Select } from '../ui';

const PAGE = 25;
type Stage = 'all' | Engagement['stage'];
type Sort = 'created' | 'score' | 'last_seen' | 'views' | 'company';

const SORTS: Array<{ value: Sort; label: string; order: 'asc' | 'desc' }> = [
  { value: 'created', label: 'Newest first', order: 'desc' },
  { value: 'score', label: 'Most engaged', order: 'desc' },
  { value: 'last_seen', label: 'Seen most recently', order: 'desc' },
  { value: 'views', label: 'Most views', order: 'desc' },
  { value: 'company', label: 'Company A–Z', order: 'asc' },
];

function Segment({ p }: { p: ProspectItem }) {
  // "Executive" adds nothing next to "C-level" / "Founder", so the level alone is shown for those
  const dept = p.department && p.department !== 'other' && p.department !== 'executive' ? DEPARTMENT_LABELS[p.department as Department] : null;
  const sen = p.seniority ? SENIORITY_LABELS[p.seniority as Seniority] : null;
  const label = [dept, sen].filter(Boolean).join(' · ');
  return label ? <span className="chip" title={label}>{label}</span> : <span className="muted">—</span>;
}

export function Audience() {
  const c = useCampaign();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<Stage>('all');
  const [sort, setSort] = useState<Sort>('created');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const order = SORTS.find((s) => s.value === sort)!.order;
  const list = useQuery({
    queryKey: ['prospects', c.id, { q, stage, sort, page }],
    queryFn: () => api.get<{ total: number; prospects: ProspectItem[] }>(`/campaigns/${c.id}/prospects${qs({ q, stage: stage === 'all' ? '' : stage, sort, order, limit: PAGE, offset: page * PAGE })}`),
    placeholderData: keepPreviousData,
  });

  const selected = params.get('prospect');
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('prospect', id);
    else next.delete('prospect');
    setParams(next, { replace: !id });
  };

  const rows = list.data?.prospects ?? [];
  const total = list.data?.total ?? 0;
  const filtering = !!q || stage !== 'all';
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const empty = !list.isLoading && total === 0 && !filtering;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Audience</h1>
          <p>Everyone who has a personalised link for this campaign, and what they’ve done with it.</p>
        </div>
        {!empty ? (
          <>
            <a className="btn" href={`/api/campaigns/${c.id}/prospects/export.csv`} download><Download size={15} /> Export</a>
            <Button onClick={() => setImporting(true)}><FileUp size={15} /> Import CSV</Button>
            <Button variant="primary" onClick={() => setAdding(true)}><Plus size={16} /> Add prospect</Button>
          </>
        ) : null}
      </div>

      {c.campaign.status !== 'live' && total > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="warn">This campaign is a draft, so personalised links say “not available” until you publish it (top right).</Alert>
        </div>
      ) : null}

      {list.isLoading ? (
        <CenterSpinner />
      ) : empty ? (
        <div className="card">
          <EmptyState icon={<Users size={24} />} title="No prospects yet">
            Send rows from Clay with the HTTP API, import a CSV, or add someone by hand. Each one gets their own link (and PDF) with their details filled in.
            <div className="row wrap" style={{ justifyContent: 'center', marginTop: 20 }}>
              <Link className="btn primary" to="/integrations"><Plug size={15} /> Connect Clay</Link>
              <Button onClick={() => setImporting(true)}><FileUp size={15} /> Import a CSV</Button>
              <Button onClick={() => setAdding(true)}><Plus size={15} /> Add one</Button>
            </div>
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="filters">
            <div className="search">
              <Search size={15} />
              <Input placeholder="Search name, company, title or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search prospects" />
            </div>
            <Segmented
              value={stage}
              onChange={(s) => { setStage(s); setPage(0); }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'new', label: 'Not opened' },
                { value: 'opened', label: 'Opened' },
                { value: 'engaged', label: 'Engaged' },
                { value: 'converted', label: 'Converted' },
              ]}
            />
            <div className="grow" />
            <Select small style={{ width: 190 }} value={sort} onChange={(e) => { setSort(e.target.value as Sort); setPage(0); }} aria-label="Sort by">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </div>

          <div className="card flush" style={{ opacity: list.isFetching && list.isPlaceholderData ? 0.7 : 1, transition: 'opacity .12s' }}>
            {!rows.length ? (
              <div className="viz-empty" style={{ padding: 48 }}>No one matches those filters.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Prospect</th>
                      <th>Company &amp; role</th>
                      <th>Segment</th>
                      <th>Status</th>
                      <th className="num">Views</th>
                      <th>Last seen</th>
                      <th style={{ width: 84 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => {
                      const name = personName(p);
                      return (
                        <tr key={p.id} className="click" onClick={() => open(p.id)}>
                          <td>
                            <div className="name-cell">
                              <span className="avatar">{initials(name)}</span>
                              <div style={{ minWidth: 0 }}>
                                <div className="truncate"><b>{name}</b></div>
                                {p.email && p.email !== name ? <div className="muted tiny truncate">{p.email}</div> : null}
                              </div>
                            </div>
                          </td>
                          <td style={{ maxWidth: 240 }}>
                            <div className="truncate">{p.company || <span className="muted">—</span>}</div>
                            <div className="muted tiny truncate">{p.job_title}</div>
                          </td>
                          <td><Segment p={p} /></td>
                          <td><StageChip stage={p.stage} /></td>
                          <td className="num">{fmtNum(p.engagement.views)}</td>
                          <td className="muted nowrap">{timeAgo(p.engagement.last_seen_at)}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                              <CopyButton text={p.url} variant="ghost" />
                              <Button size="sm" variant="ghost" icon title="Open their page" aria-label="Open their page" onClick={() => window.open(p.url, '_blank', 'noopener')}><ExternalLink size={14} /></Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pagination">
              <span>
                {total ? `${page * PAGE + 1}–${Math.min((page + 1) * PAGE, total)} of ${total.toLocaleString()}` : '0 prospects'}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" icon disabled={page === 0} onClick={() => setPage((n) => n - 1)} aria-label="Previous page"><ChevronLeft size={15} /></Button>
                <span className="small">Page {page + 1} of {pages}</span>
                <Button size="sm" icon disabled={page + 1 >= pages} onClick={() => setPage((n) => n + 1)} aria-label="Next page"><ChevronRight size={15} /></Button>
              </div>
            </div>
          </div>
        </>
      )}

      {selected ? <ProspectDrawer id={selected} onClose={() => open(null)} onDeleted={() => open(null)} /> : null}
      {adding ? <AddProspectModal onClose={() => setAdding(false)} onAdded={(p) => open(p.id)} /> : null}
      {importing ? <ImportCsvModal onClose={() => setImporting(false)} /> : null}
    </div>
  );
}
