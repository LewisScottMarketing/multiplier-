import { useQuery } from '@tanstack/react-query';
import { FileText, FolderKanban, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { NewCampaignModal } from '../components/NewCampaignModal';
import { brandGradient, fmtNum, fmtPct, timeAgo } from '../lib/format';
import type { CampaignSummary } from '../types';
import { Badge, Button, CenterSpinner, EmptyState, Segmented } from '../ui';

export function StatusBadge({ status }: { status: CampaignSummary['status'] }) {
  return status === 'live' ? (
    <Badge tone="ok" dot>
      Live
    </Badge>
  ) : status === 'archived' ? (
    <Badge>Archived</Badge>
  ) : (
    <Badge tone="warn" dot>
      Draft
    </Badge>
  );
}

export function Campaigns() {
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'live' | 'draft'>('all');
  const q = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<{ campaigns: CampaignSummary[] }>('/campaigns') });
  const all = q.data?.campaigns ?? [];
  const list = all.filter((c) => filter === 'all' || c.status === filter);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Campaigns</h1>
          <p>Each campaign is one landing page (and optionally one PDF) that’s personalised for every prospect you send it to.</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> New campaign
        </Button>
      </div>

      {q.isLoading ? (
        <CenterSpinner />
      ) : all.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FolderKanban size={24} />}
            title="Create your first campaign"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={16} /> New campaign
              </Button>
            }
          >
            Drop in a PDF and we’ll turn it into a landing page, then you can send a personalised version to every prospect.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="filters">
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All ${all.length}` },
                { value: 'live', label: 'Live' },
                { value: 'draft', label: 'Drafts' },
              ]}
            />
          </div>
          <div className="grid-cards">
            {list.map((c) => (
              <Link key={c.id} to={`/campaigns/${c.id}/page`} className="camp">
                <div className="camp-thumb" style={{ background: brandGradient(c.brand) }}>
                  <span className="pill">
                    <StatusBadge status={c.status} />
                  </span>
                  <span className="s">
                    {c.has_document ? (
                      <>
                        <FileText size={11} style={{ verticalAlign: '-1px' }} /> Page + PDF
                      </>
                    ) : (
                      'Page'
                    )}
                  </span>
                  <span className="t">{c.headline || c.name}</span>
                </div>
                <div className="camp-body">
                  <div>
                    <h3 className="truncate">{c.name}</h3>
                    <span className="muted tiny">Updated {timeAgo(c.updated_at)}</span>
                  </div>
                  <div className="camp-stats">
                    <div>
                      <b>{fmtNum(c.prospects)}</b>
                      <span>Prospects</span>
                    </div>
                    <div>
                      <b>{fmtPct(c.viewed, c.prospects)}</b>
                      <span>Opened</span>
                    </div>
                    <div>
                      <b>{fmtNum(c.submissions)}</b>
                      <span>Replies</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
      {creating ? <NewCampaignModal onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
