import { Braces, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FIELD_GROUPS } from '@shared/fields';
import { extractTokens, normKey, renderTemplate } from '@shared/template';
import { useCampaign } from '../campaign';
import { Input } from '../ui';

const SUGGESTED_FALLBACK: Record<string, string> = {
  first_name: 'there',
  full_name: 'there',
  company: 'your team',
  company_short: 'your team',
  job_title: 'your role',
  department_label: 'your team',
  domain: 'your website',
};

/**
 * A text input that knows about merge fields: insert a field with an optional fallback, see what
 * the text resolves to for the person being previewed, and fix missing fallbacks in one click.
 */
export function TokenField({
  label,
  hint,
  value,
  onChange,
  multiline,
  rows = 3,
  placeholder,
  mono,
  small,
  noTokens,
  autoFocus,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
  small?: boolean;
  noTokens?: boolean;
  autoFocus?: boolean;
}) {
  const c = useCampaign();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [fallback, setFallback] = useState('');
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  const tokens = useMemo(() => extractTokens(value), [value]);
  const known = useMemo(() => new Set(c.fields.map((f) => f.key)), [c.fields]);
  const required = useMemo(() => new Set(c.draft.settings.required_fields.map(normKey)), [c.draft.settings.required_fields]);
  const missingFallback = tokens.filter(
    (t) =>
      known.has(t.field) &&
      !t.hasFallback &&
      !required.has(t.field) &&
      !['page_url', 'pdf_url', 'cover_url', 'today', 'prospect_id'].includes(t.field),
  );
  const unknown = tokens.filter((t) => !known.has(t.field));
  const resolved = useMemo(
    () => (tokens.length ? renderTemplate(value, c.previewCtx).replace(/\s+/g, ' ').trim() : ''),
    [value, tokens.length, c.previewCtx],
  );

  const insert = (key: string) => {
    const token = `{{${key}${fallback.trim() ? `|${fallback.trim()}` : ''}}}`;
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    setOpen(false);
    setFallback('');
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const fixFallback = (field: string) => {
    const fb = SUGGESTED_FALLBACK[field] ?? 'friend';
    onChange(value.replace(new RegExp(`\\{\\{\\s*${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'gi'), `{{${field}|${fb}}}`));
  };

  const filtered = c.fields.filter(
    (f) => !search || f.label.toLowerCase().includes(search.toLowerCase()) || f.key.includes(search.toLowerCase()),
  );
  const groups = (Object.keys(FIELD_GROUPS) as Array<keyof typeof FIELD_GROUPS>)
    .map((g) => ({ g, items: filtered.filter((f) => f.group === g) }))
    .filter((x) => x.items.length);

  const common = {
    ref,
    value,
    placeholder,
    autoFocus,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    style: mono ? { fontFamily: 'var(--mono)', fontSize: 12.5 } : undefined,
  };

  return (
    <div className="field" ref={wrap} style={{ position: 'relative' }}>
      {label !== undefined || !noTokens ? (
        <label>
          {label}
          {!noTokens ? (
            <button
              type="button"
              className="btn xs ghost right"
              onClick={() => setOpen((o) => !o)}
              title="Insert a merge field such as the prospect’s first name"
              style={{ fontWeight: 600, color: 'var(--brand-600)' }}
            >
              <Braces size={13} /> Insert field
            </button>
          ) : null}
        </label>
      ) : null}
      {multiline ? <textarea className="textarea" rows={rows} {...common} /> : <Input small={small} {...common} />}
      {resolved && resolved !== value ? (
        <div className="hint" style={{ fontStyle: 'italic' }}>
          → {resolved.length > 150 ? `${resolved.slice(0, 150)}…` : resolved}
        </div>
      ) : null}
      {unknown.length ? (
        <div className="hint" style={{ color: 'var(--bad)' }}>
          <TriangleAlert size={12} style={{ verticalAlign: '-2px' }} /> {unknown.map((u) => `{{${u.field}}}`).join(', ')} isn’t a known
          field.
        </div>
      ) : null}
      {missingFallback.length ? (
        <div className="hint" style={{ color: 'var(--warn)' }}>
          <TriangleAlert size={12} style={{ verticalAlign: '-2px' }} /> No fallback for{' '}
          {missingFallback.map((m) => `{{${m.field}}}`).join(', ')}.{' '}
          <button
            type="button"
            className="btn xs ghost"
            style={{ height: 20, padding: '0 6px', color: 'var(--warn)', textDecoration: 'underline' }}
            onClick={() => missingFallback.forEach((m) => fixFallback(m.field))}
          >
            Add one
          </button>
        </div>
      ) : null}
      {hint && !resolved ? <div className="hint">{hint}</div> : null}

      {open ? (
        <div className="menu left" style={{ width: 320, top: 28, zIndex: 80, padding: 0 }} role="dialog" aria-label="Insert a merge field">
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)' }} className="col">
            <div className="search">
              <Search size={14} />
              <Input
                small
                placeholder="Search fields"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                style={{ minWidth: 0 }}
              />
            </div>
            <Input
              small
              placeholder="Fallback if empty (optional) — e.g. there"
              value={fallback}
              onChange={(e) => setFallback(e.target.value)}
            />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', padding: 5 }}>
            {groups.map(({ g, items }) => (
              <div key={g}>
                <div
                  className="tiny muted"
                  style={{ padding: '8px 10px 3px', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 650 }}
                >
                  {FIELD_GROUPS[g]}
                </div>
                {items.map((f) => (
                  <button key={f.key} type="button" onClick={() => insert(f.key)} title={f.hint}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 560 }}>{f.label}</span>
                      <span className="mono muted tiny">{`{{${f.key}}}`}</span>
                    </span>
                    <span className="muted tiny truncate" style={{ maxWidth: 110 }}>
                      {String(c.previewCtx[f.key] ?? f.example ?? '')}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {!groups.length ? <div className="viz-empty">No matching fields.</div> : null}
          </div>
          <div className="tiny muted" style={{ padding: '8px 12px', borderTop: '1px solid var(--line)' }}>
            Tip: <code>{'{{first_name|there}}'}</code> shows “there” when the name is empty. Filters: <code>upper</code>, <code>title</code>
            , <code>possessive</code>.
          </div>
        </div>
      ) : null}
    </div>
  );
}
