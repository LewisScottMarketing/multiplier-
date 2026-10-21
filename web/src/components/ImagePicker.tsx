import { useQuery } from '@tanstack/react-query';
import { ImageIcon, Link2, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ImageRef } from '@shared/schema';
import { api } from '../api';
import { useCampaign } from '../campaign';
import type { AssetInfo } from '../types';
import { Button, Input, Modal, Spinner, useToast } from '../ui';

const resolveSrc = (src: string): string | null => (/^ast_/.test(src) ? `/a/${src}` : /^https:\/\//.test(src) ? src : null);

/** Upload an image, pick one you used before, or point at a URL / merge field such as {{logo_url}}. */
export function ImagePicker({
  value,
  onChange,
  optional,
  label,
  withAlt = true,
  hint,
}: {
  value: ImageRef | undefined;
  onChange: (v: ImageRef | undefined) => void;
  optional?: boolean;
  label?: string;
  withAlt?: boolean;
  hint?: string;
}) {
  const c = useCampaign();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [lib, setLib] = useState(false);
  const [link, setLink] = useState(false);
  const src = value?.src ?? '';
  const preview = resolveSrc(src);
  const isToken = /\{\{/.test(src);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('campaign_id', c.id);
      const r = await api.upload<{ asset: AssetInfo }>('/assets', form);
      onChange({ src: r.asset.id, alt: value?.alt ?? '' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      {label ? <label>{label}</label> : null}
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 84,
            height: 62,
            borderRadius: 8,
            border: '1px solid var(--line-2)',
            background: 'var(--bg) center/contain no-repeat',
            backgroundImage: preview ? `url(${preview})` : undefined,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--ink-4)',
            flex: 'none',
          }}
        >
          {busy ? <Spinner /> : !preview ? isToken ? <Link2 size={18} /> : <ImageIcon size={20} /> : null}
        </div>
        <div className="col" style={{ gap: 6, minWidth: 0, flex: 1 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <Button size="xs" onClick={() => input.current?.click()}>
              <Upload size={12} /> Upload
            </Button>
            <Button size="xs" onClick={() => setLib(true)}>
              Library
            </Button>
            <Button
              size="xs"
              variant={link || isToken ? 'primary' : 'default'}
              onClick={() => setLink((v) => !v)}
              title="Use a link or a merge field"
            >
              <Link2 size={12} /> Link
            </Button>
            {src && optional ? (
              <Button size="xs" variant="ghost" icon aria-label="Remove image" onClick={() => onChange(undefined)}>
                <Trash2 size={12} />
              </Button>
            ) : null}
          </div>
          {link || isToken ? (
            <Input
              small
              value={src}
              placeholder="https://… or {{logo_url}}"
              onChange={(e) => onChange({ src: e.target.value, alt: value?.alt ?? '' })}
              style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
            />
          ) : null}
          {hint ? <div className="hint">{hint}</div> : null}
        </div>
      </div>
      {withAlt && src ? (
        <Input
          small
          value={value?.alt ?? ''}
          placeholder="Describe the image (alt text)"
          onChange={(e) => onChange({ src, alt: e.target.value })}
        />
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />
      {lib ? (
        <Library
          onClose={() => setLib(false)}
          onPick={(a) => {
            onChange({ src: a.id, alt: value?.alt ?? '' });
            setLib(false);
          }}
        />
      ) : null}
    </div>
  );
}

function Library({ onClose, onPick }: { onClose: () => void; onPick: (a: AssetInfo) => void }) {
  const c = useCampaign();
  const q = useQuery({ queryKey: ['assets', c.id], queryFn: () => api.get<{ assets: AssetInfo[] }>(`/assets?campaign=${c.id}`) });
  return (
    <Modal title="Image library" onClose={onClose} size="wide">
      {q.isLoading ? (
        <div className="viz-empty">
          <Spinner />
        </div>
      ) : !q.data?.assets.length ? (
        <div className="viz-empty">No images yet. Upload one and it will appear here.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
          {q.data.assets.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onPick(a)}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 10,
                padding: 6,
                background: 'var(--panel)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ height: 90, background: `var(--bg) url(${a.url}) center/contain no-repeat`, borderRadius: 6 }} />
              <div className="tiny muted truncate" style={{ marginTop: 6 }}>
                {a.filename}
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
