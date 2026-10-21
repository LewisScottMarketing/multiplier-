import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, LayoutDashboard, LogOut, Plug, Settings as SettingsIcon } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Navigate, NavLink, Route, Routes, useMatch } from 'react-router-dom';
import { api, ApiError } from './api';
import { Audience } from './pages/Audience';
import { CampaignLayout } from './pages/CampaignLayout';
import { CampaignSettings } from './pages/CampaignSettings';
import { Campaigns } from './pages/Campaigns';
import { Analytics } from './pages/Analytics';
import { Integrations } from './pages/Integrations';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { SettingsPage } from './pages/SettingsPage';
import type { User } from './types';
import { CenterSpinner, LogoMark, Menu } from './ui';

// the two heavy editors load on demand
const BuilderPage = lazy(() => import('./pages/Builder').then((m) => ({ default: m.BuilderPage })));
const PdfStudio = lazy(() => import('./pages/PdfStudio').then((m) => ({ default: m.PdfStudio })));

function Shell({ user }: { user: User }) {
  const qc = useQueryClient();
  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    qc.setQueryData(['me'], null);
  };
  // inside a campaign the editor needs the width, so the app menu folds down to icons
  const compact = !!useMatch('/campaigns/:id/*');
  return (
    <div className={`app ${compact ? 'compact' : ''}`}>
      <aside className="sidebar">
        <NavLink to="/" className="logo" title="Multiplier">
          <LogoMark />
          <span className="label">Multiplier</span>
        </NavLink>
        <NavLink to="/" end className="nav-link" title="Overview">
          <LayoutDashboard size={17} /> <span className="label">Overview</span>
        </NavLink>
        <NavLink to="/campaigns" className="nav-link" title="Campaigns">
          <FolderKanban size={17} /> <span className="label">Campaigns</span>
        </NavLink>
        <div className="nav-section">Connect</div>
        <NavLink to="/integrations" className="nav-link" title="Clay & integrations">
          <Plug size={17} /> <span className="label">Clay &amp; integrations</span>
        </NavLink>
        <NavLink to="/settings" className="nav-link" title="Settings">
          <SettingsIcon size={17} /> <span className="label">Settings</span>
        </NavLink>
        <div className="sidebar-foot">
          <Menu
            up
            align="left"
            trigger={(_o, toggle) => (
              <button
                className="user-chip btn ghost"
                style={{ height: 'auto', padding: 6, width: '100%', justifyContent: 'flex-start' }}
                onClick={toggle}
              >
                <span className="avatar">{(user.name || user.email)[0]!.toUpperCase()}</span>
                <span className="grow truncate" style={{ textAlign: 'left', minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }} className="truncate">
                    {user.name || user.email.split('@')[0]}
                  </span>
                  <span className="muted tiny truncate" style={{ display: 'block' }}>
                    {user.email}
                  </span>
                </span>
              </button>
            )}
          >
            {() => (
              <button onClick={logout}>
                <LogOut size={15} /> Sign out
              </button>
            )}
          </Menu>
        </div>
      </aside>
      <main className="main">
        <Suspense fallback={<CenterSpinner />}>
          <Routes>
            <Route index element={<Overview />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="settings" element={<SettingsPage user={user} />} />
            <Route path="campaigns/:id" element={<CampaignLayout />}>
              <Route index element={<Navigate to="page" replace />} />
              <Route path="page" element={<BuilderPage />} />
              <Route path="pdf" element={<PdfStudio />} />
              <Route path="audience" element={<Audience />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="settings" element={<CampaignSettings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export function App() {
  const status = useQuery({ queryKey: ['auth-status'], queryFn: () => api.get<{ setup_required: boolean }>('/auth/status'), staleTime: 0 });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.get<{ user: User }>('/auth/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });
  if (me.isLoading || status.isLoading) return <CenterSpinner />;
  if (!me.data) return <Login setup={!!status.data?.setup_required} />;
  return <Shell user={me.data} />;
}
