import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BarChart3, Plug } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useCampaign } from '../campaign';
import { ActivityFeed, TopList } from '../components/Activity';
import { ChartCard, Funnel, HBars, SplitBar, StatTile, TimeSeries, useStale } from '../charts';
import { fmtDuration, fmtNum, fmtPct } from '../lib/format';
import type { CampaignAnalytics, DayPoint } from '../types';
import { CenterSpinner, EmptyState, Segmented } from '../ui';

type Metric = 'views' | 'clicks' | 'downloads' | 'submissions';
const METRICS: Array<{ value: Metric; label: string; noun: string }> = [
  { value: 'views', label: 'Views', noun: 'Views' },
  { value: 'clicks', label: 'Clicks', noun: 'Clicks' },
  { value: 'downloads', label: 'PDF downloads', noun: 'Downloads' },
  { value: 'submissions', label: 'Replies', noun: 'Replies' },
];

export function Analytics() {
  const c = useCampaign();
  const [days, setDays] = useState<7 | 14 | 30 | 90>(30);
  const [metric, setMetric] = useState<Metric>('views');
  const q = useQuery({
    queryKey: ['analytics', c.id, days],
    queryFn: () => api.get<CampaignAnalytics>(`/campaigns/${c.id}/analytics?days=${days}`),
    placeholderData: keepPreviousData,
  });
  const stale = useStale(q.isFetching && q.isPlaceholderData);

  if (q.isLoading) return <CenterSpinner />;
  const a = q.data!;
  const t = a.totals;

  if (t.prospects === 0 && !a.anonymous_views) {
    return (
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1>Analytics</h1>
            <p>See who opens their link, what they read and who replies.</p>
          </div>
        </div>
        <div className="card">
          <EmptyState
            icon={<BarChart3 size={24} />}
            title="Nothing to measure yet"
            action={
              <Link className="btn primary" to="../audience">
                <Plug size={15} /> Add prospects
              </Link>
            }
          >
            Once prospects have their links and start opening them, you’ll see opens, time on page, clicks, downloads and replies here.
          </EmptyState>
        </div>
      </div>
    );
  }

  const m = METRICS.find((x) => x.value === metric)!;
  const points: Array<{ date: string; value: number }> = a.series.map((p: DayPoint) => ({ date: p.date, value: p[metric] }));
  const viewSeries = a.series.map((p) => p.views);
  const segRows = (rows: CampaignAnalytics['segments']['departments']) =>
    rows.map((r) => ({
      label: r.label,
      value: r.prospects ? Math.round((r.opened / r.prospects) * 100) : 0,
      sub: `${r.opened} of ${r.prospects}`,
      detail: `${r.opened} of ${r.prospects} opened · ${r.converted} replied`,
    }));
  const pct = (n: number) => `${n}%`;
  // call out the step where the most people are lost, which is where to focus next
  const worst = a.funnel
    .slice(1)
    .map((s, i) => ({ from: a.funnel[i]!, to: s, ratio: a.funnel[i]!.n > 0 ? s.n / a.funnel[i]!.n : 1 }))
    .filter((x) => x.from.n >= 5)
    .sort((x, y) => x.ratio - y.ratio)[0];
  const funnelNote =
    worst && worst.ratio < 0.9
      ? `Biggest drop: ${worst.from.label.toLowerCase()} → ${worst.to.label.toLowerCase()}, where ${Math.round((1 - worst.ratio) * 100)}% fall away.`
      : '';
  const noSegments = !a.segments.departments.length && !a.segments.seniority.length;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Analytics</h1>
          <p>Counts people only. Email security scanners and link previews are filtered out.</p>
        </div>
        <Segmented
          value={String(days) as '7' | '14' | '30' | '90'}
          onChange={(v) => setDays(Number(v) as 7 | 14 | 30 | 90)}
          options={[
            { value: '7', label: '7 days' },
            { value: '14', label: '14 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ]}
        />
      </div>

      <div className="kpis">
        <StatTile
          label="Open rate"
          value={fmtPct(t.opened, t.prospects)}
          sub={`${fmtNum(t.opened)} of ${fmtNum(t.prospects)} prospects`}
          spark={viewSeries}
        />
        <StatTile label="Engaged" value={fmtPct(t.engaged, t.prospects)} sub={`${fmtNum(t.engaged)} read, clicked or downloaded`} />
        <StatTile label="Replied" value={fmtNum(t.converted)} sub={`${fmtNum(t.submissions)} form submissions & bookings`} />
        <StatTile
          label="Time on page"
          value={t.avg_engaged_seconds ? fmtDuration(t.avg_engaged_seconds) : '—'}
          sub="Average among people who opened"
        />
      </div>

      <div className="two-col" style={{ marginBottom: 20 }}>
        <ChartCard
          title={`${m.noun} per day`}
          subtitle={`Last ${days} days${a.anonymous_views ? ` · includes ${fmtNum(a.anonymous_views)} view${a.anonymous_views === 1 ? '' : 's'} of the generic link` : ''}`}
          stale={stale}
          actions={<Segmented value={metric} onChange={setMetric} options={METRICS.map((x) => ({ value: x.value, label: x.label }))} />}
          table={{ columns: ['Date', m.noun], rows: a.series.map((p) => [p.date, p[metric]]) }}
        >
          <TimeSeries label={m.noun} data={points} />
        </ChartCard>
        <ChartCard
          title="Funnel"
          subtitle="From link created to reply"
          stale={stale}
          table={{ columns: ['Stage', 'People'], rows: a.funnel.map((f) => [f.label, f.n]) }}
        >
          <Funnel stages={a.funnel} />
          {funnelNote ? (
            <p className="small muted" style={{ marginTop: 18 }}>
              {funnelNote}
            </p>
          ) : null}
        </ChartCard>
      </div>

      <div className="two-col" style={{ marginBottom: 20, gridTemplateColumns: '1fr 1fr' }}>
        <ChartCard
          title="Who opens it?"
          subtitle="Open rate by department, from job titles"
          stale={stale}
          table={
            noSegments
              ? undefined
              : {
                  columns: ['Department', 'Prospects', 'Opened', 'Replied'],
                  rows: a.segments.departments.map((r) => [r.label, r.prospects, r.opened, r.converted]),
                }
          }
        >
          {noSegments ? (
            <div className="viz-empty">Add prospects with job titles to see which roles respond.</div>
          ) : (
            <HBars rows={segRows(a.segments.departments)} format={pct} max={100} />
          )}
        </ChartCard>
        <ChartCard
          title="By seniority"
          subtitle="Open rate by level"
          stale={stale}
          table={
            noSegments
              ? undefined
              : {
                  columns: ['Level', 'Prospects', 'Opened', 'Replied'],
                  rows: a.segments.seniority.map((r) => [r.label, r.prospects, r.opened, r.converted]),
                }
          }
        >
          {noSegments ? (
            <div className="viz-empty">Nothing to compare yet.</div>
          ) : (
            <HBars rows={segRows(a.segments.seniority)} format={pct} max={100} />
          )}
        </ChartCard>
      </div>

      <div className="two-col" style={{ marginBottom: 20, gridTemplateColumns: '1.6fr 1fr' }}>
        <ChartCard
          title="What they click"
          subtitle="Buttons and links, all time"
          stale={stale}
          table={
            a.clicks.length ? { columns: ['Button', 'Clicks'], rows: a.clicks.map((r) => [r.label || r.slot || r.block, r.n]) } : undefined
          }
        >
          {a.clicks.length ? (
            <HBars
              rows={a.clicks.map((r) => ({
                label: r.label || r.slot || 'Link',
                value: r.n,
                detail: `${r.n} click${r.n === 1 ? '' : 's'}`,
              }))}
            />
          ) : (
            <div className="viz-empty">No clicks yet.</div>
          )}
        </ChartCard>
        <ChartCard title="Devices" subtitle="Where pages are opened" stale={stale}>
          <SplitBar a={{ label: 'Phone', value: a.devices.mobile }} b={{ label: 'Computer', value: a.devices.desktop }} />
        </ChartCard>
      </div>

      <div className="two-col" style={{ gridTemplateColumns: '1fr 1.2fr' }}>
        <div className="card">
          <div className="card-head">
            <h2>Hot prospects</h2>
            <span className="muted small right">By engagement score</span>
          </div>
          <TopList items={a.top} empty="Nobody has opened their link yet." />
          {a.top.length ? (
            <div style={{ marginTop: 10 }}>
              <Link className="btn sm" to="../audience">
                See the whole audience
              </Link>
            </div>
          ) : null}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Recent activity</h2>
          </div>
          <ActivityFeed items={a.activity} />
        </div>
      </div>
    </div>
  );
}
