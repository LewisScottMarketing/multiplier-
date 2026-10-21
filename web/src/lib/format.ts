export const fmtNum = (n: number): string =>
  n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K` : n.toLocaleString('en-GB');
export const fmtPct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

export function timeAgo(ts: number | string | null | undefined): string {
  if (!ts) return '—';
  const t = typeof ts === 'string' ? Date.parse(ts) : ts;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: s > 300 * 86_400 ? 'numeric' : undefined });
}

export const fmtDateTime = (ts: number | string): string =>
  new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtDuration = (s: number): string => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60 ? `${s % 60}s` : ''}`.trim());

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

export const personName = (p: { first_name?: string | null; last_name?: string | null; email?: string | null }): string =>
  [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Unknown';

/** Deterministic gradient for a campaign thumbnail from its brand colour. */
export function brandGradient(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const dark = (k: number) => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  return `linear-gradient(135deg, ${hex} 0%, ${dark(0.62)} 100%)`;
}

export function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
