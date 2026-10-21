import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import type { CampaignSummary, SettingsResponse } from '../types';
import { CenterSpinner } from '../ui';
import { ClayGuide } from './integrations/ClayGuide';
import { Webhooks } from './integrations/Webhooks';

export function Integrations() {
  // The plaintext key only exists right after creation; keep it in memory so the guide can show real snippets.
  const [newKey, setNewKey] = useState('');
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<{ campaigns: CampaignSummary[] }>('/campaigns') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsResponse>('/settings') });
  if (campaigns.isLoading) return <CenterSpinner />;
  const list = campaigns.data?.campaigns ?? [];
  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <div className="page-head">
        <div className="grow">
          <h1>Clay &amp; integrations</h1>
          <p>Plug Multiplier into Clay: rows go in, personalised links come out, and engagement flows back.</p>
        </div>
      </div>
      <div className="stack">
        <ClayGuide campaigns={list} settings={settings.data} newKey={newKey} onNewKey={setNewKey} />
        <Webhooks campaigns={list} />
      </div>
    </div>
  );
}
