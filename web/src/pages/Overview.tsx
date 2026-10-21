import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Circle, FileText, FolderKanban, MousePointerClick, Plug, Plus, Send } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ChartCard, StatTile, TimeSeries } from '../charts';
import { NewCampaignModal } from '../components/NewCampaignModal';
import { ActivityFeed, TopList } from '../components/Activity';
import { fmtNum, fmtPct } from '../lib/format';
import type { ApiKeyInfo, CampaignSummary, Overview as OverviewData } from '../types';
import { Button, CenterSpinner } from '../ui';

export function Overview() {
  const [creating, setCreating] = useState(false);
  const o = useQuery({ queryKey: ['overview'], queryFn: () => api.get<OverviewData>('/overview?days=14') });
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<{ campaigns: CampaignSummary[] }>('/campaigns') });
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<{ keys: ApiKeyInfo[] }>('/api-keys') });
  if (o.isLoading || campaigns.isLoading) return <CenterSpinner />;
  const d = o.data!;
  const list = campaigns.data?.campaigns ?? [];
  const t = d.totals;
  const views = d.series.map((p) => p.views);

  const hasCampaign = list.length > 0;
  const hasLive = list.some((c) => c.status === 'live');
  const hasKey = (keys.data?.keys ?? []).some((k) => !k.revoked_at);
  const hasProspects = t.prospects > 0;
  const onboarding = !(hasCampaign && hasLive && hasKey && hasProspects);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Overview</h1>
          <p>How your personalised pages are performing across every campaign.</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> New campaign
        </Button>
      </div>

      {onboarding ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <h2>Get your first personalised link out</h2>
            <span className="muted small right">4 steps</span>
          </div>
          <div className="col" style={{ gap: 12 }}>
            {[
              {
                done: hasCampaign,
                title: 'Create a campaign from a PDF',
                body: 'Upload a case study, one-pager or deck and we’ll build the landing page.',
                to: '/campaigns',
                icon: FileText,
              },
              {
                done: hasLive,
                title: 'Publish it',
                body: 'Review the page, personalise the copy with merge fields, then switch it live.',
                to: hasCampaign ? `/campaigns/${list[0]?.id}/page` : '/campaigns',
                icon: FolderKanban,
              },
              {
                done: hasKey,
                title: 'Connect Clay',
                body: 'Create an API key and copy the HTTP API column setup into your Clay table.',
                to: '/integrations',
                icon: Plug,
              },
              {
                done: hasProspects,
                title: 'Send a prospect through',
                body: 'Run a row in Clay (or import a CSV) and open the personalised link it returns.',
                to: hasCampaign ? `/campaigns/${list[0]?.id}/audience` : '/campaigns',
                icon: Send,
              },
            ].map((s, i) => (
              <Link
                key={i}
                to={s.to}
                className="row"
                style={{ padding: '10px 12px', borderRadius: 10, background: s.done ? 'var(--ok-bg)' : 'var(--bg)', color: 'inherit' }}
              >
                {s.done ? (
                  <CheckCircle2 size={20} style={{ color: 'var(--ok)' }} />
                ) : (
                  <Circle size={20} style={{ color: 'var(--ink-4)' }} />
                )}
                <div className="grow">
                  <b>{s.title}</b>
                  <div className="muted small">{s.body}</div>
                </div>
                <ArrowRight size={16} className="muted" />
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div className="kpis">
        <StatTile label="Live campaigns" value={fmtNum(d.campaigns.live)} sub={`${d.campaigns.total} in total`} />
        <StatTile label="Links sent" value={fmtNum(t.prospects)} sub="Prospects with a personalised link" />
        <StatTile
          label="Opened"
          value={fmtPct(t.opened, t.prospects)}
          sub={`${fmtNum(t.opened)} of ${fmtNum(t.prospects)} prospects`}
          spark={views}
        />
        <StatTile label="Converted" value={fmtNum(t.converted)} sub={`${fmtNum(t.clicks)} clicks · ${fmtNum(t.downloads)} PDF downloads`} />
      </div>

      <div className="two-col" style={{ marginBottom: 20 }}>
        <ChartCard
          title="Page views"
          subtitle="Last 14 days, people only (link scanners are filtered out)"
          table={{ columns: ['Date', 'Views'], rows: d.series.map((p) => [p.date, p.views]) }}
        >
          <TimeSeries label="Views" data={d.series.map((p) => ({ date: p.date, value: p.views }))} height={340} />
        </ChartCard>
        <div className="card">
          <div className="card-head">
            <h2>Hot prospects</h2>
            <MousePointerClick size={15} className="muted right" />
          </div>
          <TopList items={d.top} empty="Nobody has opened a link yet." />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Recent activity</h2>
        </div>
        <ActivityFeed items={d.activity} showCampaign />
      </div>
      {creating ? <NewCampaignModal onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
