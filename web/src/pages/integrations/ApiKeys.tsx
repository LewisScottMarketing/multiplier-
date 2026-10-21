import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { timeAgo } from '../../lib/format';
import type { ApiKeyInfo, CampaignSummary } from '../../types';
import { Alert, Badge, Button, CenterSpinner, CopyBox, Field, Input, Modal, Select, useConfirm, useToast } from '../../ui';

/** Name a key, optionally lock it to one campaign, then show the plaintext exactly once. */
function CreateKeyModal({
  campaigns,
  onClose,
  onCreated,
}: {
  campaigns: CampaignSummary[];
  onClose: () => void;
  onCreated: (key: string, info: ApiKeyInfo) => void;
}) {
  const [name, setName] = useState('Clay');
  const [campaign, setCampaign] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<{ key: string; info: ApiKeyInfo } | null>(null);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ key: string; info: ApiKeyInfo }>('/api-keys', {
        name: name.trim() || 'API key',
        campaign_id: campaign || null,
      });
      setMade(r);
      onCreated(r.key, r.info);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the key');
    } finally {
      setBusy(false);
    }
  };

  if (made) {
    return (
      <Modal
        title="Your API key"
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose}>
            I’ve copied it
          </Button>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          <Alert tone="warn">
            Copy this now. For security we only keep a fingerprint, so it can’t be shown again. If you lose it, create a new key and revoke
            this one.
          </Alert>
          <CopyBox text={made.key} />
          <div className="muted small">
            <Check size={13} style={{ verticalAlign: '-2px', color: 'var(--ok)' }} /> This key is also kept in the setup guide below until
            you leave this page.
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Create an API key"
      onClose={onClose}
      description="Clay uses this key to ask Multiplier for each prospect’s link."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={create}>
            Create key
          </Button>
        </>
      }
    >
      <form
        className="col"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <Field label="Name" hint="So you can tell keys apart later, e.g. “Clay – Q4 table”.">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Can use" hint="Restrict a key to one campaign if you’re sharing it with a contractor or agency.">
          <Select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="">Any campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function ApiKeys({ campaigns, onNewKey }: { campaigns: CampaignSummary[]; onNewKey: (key: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<{ keys: ApiKeyInfo[] }>('/api-keys') });
  const keys = (q.data?.keys ?? []).filter((k) => !k.revoked_at);

  const revoke = async (k: ApiKeyInfo) => {
    const ok = await confirm({
      title: `Revoke “${k.name}”?`,
      body: 'Anything using this key stops working immediately, including Clay columns that are set up with it.',
      confirm: 'Revoke key',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api-keys/${k.id}`);
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      toast.ok('Key revoked');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not revoke the key');
    }
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      {q.isLoading ? (
        <CenterSpinner />
      ) : !keys.length ? (
        <div className="muted small">No keys yet.</div>
      ) : (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
          {keys.map((k, i) => (
            <div key={k.id} className="row" style={{ padding: '10px 12px', borderTop: i ? '1px solid var(--line)' : 0 }}>
              <KeyRound size={16} className="muted" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b className="truncate">{k.name}</b>
                  {k.campaign_id ? <Badge>{campaigns.find((c) => c.id === k.campaign_id)?.name ?? 'One campaign'}</Badge> : null}
                </div>
                <div className="muted tiny">
                  <span className="mono">
                    {k.prefix}••••{k.last4}
                  </span>{' '}
                  · {k.last_used_at ? `used ${timeAgo(k.last_used_at)}` : 'never used'} · created {timeAgo(k.created_at)}
                </div>
              </div>
              <Button size="sm" variant="ghost" className="danger" onClick={() => revoke(k)}>
                <Trash2 size={14} /> Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
      <div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Create API key
        </Button>
      </div>
      {creating ? (
        <CreateKeyModal
          campaigns={campaigns}
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            onNewKey(key);
            qc.invalidateQueries({ queryKey: ['api-keys'] });
          }}
        />
      ) : null}
    </div>
  );
}
