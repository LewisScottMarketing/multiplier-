import { Download, Eye, MousePointerClick, Send, CalendarCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { initials, timeAgo } from '../lib/format';
import type { ActivityItem, TopProspect } from '../types';

const ICON: Record<string, React.ReactNode> = {
  view: <Eye size={14} />,
  click: <MousePointerClick size={14} />,
  download: <Download size={14} />,
  submit: <Send size={14} />,
  booked: <CalendarCheck size={14} />,
};
const VERB: Record<string, string> = {
  view: 'opened the page',
  click: 'clicked',
  download: 'downloaded the PDF',
  submit: 'submitted the form',
  booked: 'booked a meeting',
};

export function ActivityFeed({ items, showCampaign }: { items: ActivityItem[]; showCampaign?: boolean }) {
  if (!items.length) return <div className="viz-empty">Activity will show up here as prospects open and click their links.</div>;
  return (
    <div className="timeline">
      {items.map((a) => (
        <div key={a.id} className="tl-item">
          <div className={`tl-ico ${a.type}`}>{ICON[a.type] ?? <Eye size={14} />}</div>
          <div style={{ minWidth: 0 }}>
            <div>
              <b>{a.name}</b>{a.company ? <span className="muted"> · {a.company}</span> : null} {VERB[a.type] ?? a.type}
              {a.detail ? <span className="muted"> “{a.detail}”</span> : null}
            </div>
            {showCampaign ? <div className="muted tiny">{a.campaign_name}</div> : null}
          </div>
          <div className="muted tiny nowrap">{timeAgo(a.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

export function TopList({ items, empty }: { items: TopProspect[]; empty: string }) {
  if (!items.length) return <div className="viz-empty">{empty}</div>;
  return (
    <div className="col" style={{ gap: 4 }}>
      {items.map((p) => (
        <Link key={p.id} to={`/campaigns/${p.campaign_id}/audience?prospect=${p.id}`} className="row" style={{ color: 'inherit', padding: '7px 6px', borderRadius: 8, margin: '0 -6px' }}>
          <span className="avatar">{initials(p.name)}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="truncate"><b>{p.name}</b></div>
            <div className="muted tiny truncate">{[p.job_title, p.company].filter(Boolean).join(' · ') || '—'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700 }}>{p.score}</div>
            <div className="muted tiny">{p.views} view{p.views === 1 ? '' : 's'}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
