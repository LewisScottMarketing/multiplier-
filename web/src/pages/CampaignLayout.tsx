import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Check, CloudOff, Copy, ExternalLink, FileText, Layers, Loader2, MoreHorizontal, Settings, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { CampaignProvider, useCampaign } from '../campaign';
import { StatusBadge } from './Campaigns';
import { Alert, Button, CenterSpinner, copyText, Menu, Modal, useConfirm, useToast } from '../ui';

function Bar() {
  const c = useCampaign();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(c.campaign.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(c.campaign.name), [c.campaign.name]);
  const live = c.campaign.status === 'live';
  const warnings = c.issues.filter((i) => i.level === 'warn');

  const setStatus = async (status: 'live' | 'draft') => {
    if (status === 'live' && warnings.length) {
      const ok = await confirm({
        title: `Publish with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}?`,
        body: (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.slice(0, 5).map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        ),
        confirm: 'Publish anyway',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await c.save.flush();
      await api.post(`/campaigns/${c.id}/status`, { status });
      await c.reload();
      toast.ok(status === 'live' ? 'Published. Prospect links now work.' : 'Unpublished. Links will show “not available”.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change status');
    } finally {
      setBusy(false);
    }
  };

  const publicLink = `${c.detail.public_url}/c/${c.campaign.slug}`;
  return (
    <div className="camp-bar">
      <NavLinkBack />
      <input
        className="title-input"
        value={name}
        aria-label="Campaign name"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== c.campaign.name && void c.rename(name.trim()).catch((e) => toast.error(e.message))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <StatusBadge status={c.campaign.status} />
      <div className="grow" />
      <SaveIndicator />
      <Menu
        trigger={(_o, toggle) => (
          <Button size="sm" onClick={toggle}>
            <ExternalLink size={14} /> Share
          </Button>
        )}
      >
        {(close) => (
          <>
            <button disabled={!live} onClick={() => { window.open(`/c/${c.campaign.slug}`, '_blank'); close(); }}>
              <ExternalLink size={15} /> Open generic page {live ? '' : '(publish first)'}
            </button>
            <button onClick={async () => { await copyText(publicLink); toast.ok('Link copied'); close(); }}>
              <Copy size={15} /> Copy generic page link
            </button>
          </>
        )}
      </Menu>
      <Button variant={live ? 'default' : 'primary'} size="sm" loading={busy} onClick={() => setStatus(live ? 'draft' : 'live')}>
        {live ? 'Unpublish' : 'Publish'}
      </Button>
      <Menu
        trigger={(_o, toggle) => (
          <Button size="sm" icon variant="ghost" onClick={toggle} aria-label="More">
            <MoreHorizontal size={16} />
          </Button>
        )}
      >
        {(close) => (
          <>
            <button onClick={async () => { close(); const r = await api.post<{ campaign: { id: string } }>(`/campaigns/${c.id}/duplicate`); qc.invalidateQueries({ queryKey: ['campaigns'] }); nav(`/campaigns/${r.campaign.id}/page`); toast.ok('Duplicated'); }}>
              <Layers size={15} /> Duplicate
            </button>
            <hr />
            <button
              className="danger"
              onClick={async () => {
                close();
                const ok = await confirm({ title: 'Delete this campaign?', body: 'This permanently deletes the page, the PDF, every prospect and all their activity. Links already sent will stop working.', confirm: 'Delete campaign', danger: true });
                if (!ok) return;
                await api.del(`/campaigns/${c.id}`);
                qc.invalidateQueries({ queryKey: ['campaigns'] });
                nav('/campaigns');
              }}
            >
              <Trash2 size={15} /> Delete…
            </button>
          </>
        )}
      </Menu>
    </div>
  );
}

function NavLinkBack() {
  return (
    <NavLink to="/campaigns" className="back" aria-label="Back to campaigns" title="Back to campaigns">
      <ArrowLeft size={18} />
    </NavLink>
  );
}

function SaveIndicator() {
  const { save } = useCampaign();
  if (save.state === 'saving') return <span className="save-state"><Loader2 size={13} className="spin" /> Saving…</span>;
  if (save.state === 'dirty') return <span className="save-state">Unsaved changes…</span>;
  if (save.state === 'error') return <span className="save-state err"><CloudOff size={13} /> {save.error} <Button size="xs" onClick={() => void save.flush()}>Retry</Button></span>;
  return <span className="save-state"><Check size={13} /> Saved</span>;
}

function ConflictModal() {
  const c = useCampaign();
  if (c.save.state !== 'conflict') return null;
  return (
    <Modal title="Changed somewhere else" onClose={() => undefined} footer={<Button variant="primary" onClick={() => void c.reload()}>Reload the latest version</Button>}>
      <Alert tone="warn">This campaign was edited in another tab or by someone else, so your last change couldn’t be saved. Reload to continue from the latest version.</Alert>
    </Modal>
  );
}

function Tabs() {
  const c = useCampaign();
  const warn = c.issues.filter((i) => i.level === 'warn').length;
  const tab = (to: string, icon: React.ReactNode, label: string, extra?: React.ReactNode) => (
    <NavLink to={to} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
      {icon} {label} {extra}
    </NavLink>
  );
  return (
    <div className="camp-tabs tabs">
      {tab('page', <Layers size={15} />, 'Page', warn ? <span className="badge warn" title={`${warn} to check`}>{warn}</span> : null)}
      {tab('pdf', <FileText size={15} />, 'PDF', !c.draft.document ? <span className="badge">none</span> : null)}
      {tab('audience', <Users size={15} />, 'Audience')}
      {tab('analytics', <BarChart3 size={15} />, 'Analytics')}
      {tab('settings', <Settings size={15} />, 'Settings')}
    </div>
  );
}

export function CampaignLayout() {
  const { id = '' } = useParams();
  return (
    <CampaignProvider id={id} key={id}>
      {(ctx, status) =>
        !ctx ? (
          status.error ? (
            <div className="page"><Alert tone="bad">{status.error.message}</Alert></div>
          ) : (
            <CenterSpinner />
          )
        ) : (
          <div className="camp-shell">
            <Bar />
            <Tabs />
            <ConflictModal />
            <Outlet />
          </div>
        )
      }
    </CampaignProvider>
  );
}
