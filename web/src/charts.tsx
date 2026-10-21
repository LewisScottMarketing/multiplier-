import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './charts.css';
import { Segmented } from './ui';
import { fmtNum } from './lib/format';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Round the axis to clean numbers (0 / 1K / 2K …) for about `count` intervals. */
export function niceScale(max: number, count = 4): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { top, ticks };
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || 600);
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// ── chart card with a table twin ────────────────────────────────────────────

export interface TableSpec {
  columns: string[];
  rows: Array<Array<string | number>>;
}

export function ChartCard({ title, subtitle, actions, table, children, stale }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; table?: TableSpec; children: ReactNode; stale?: boolean }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className="viz viz-card">
      <div className="viz-head">
        <div className="grow">
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions}
        {table ? (
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'table', label: 'Table' },
            ]}
          />
        ) : null}
      </div>
      <div className={`viz-body ${stale ? 'stale' : ''}`}>
        {view === 'table' && table ? (
          <table className="viz-table">
            <thead>
              <tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

// ── stat tile + sparkline ───────────────────────────────────────────────────

export function Sparkline({ values }: { values: number[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const h = 28;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * (w - 8) + 4, h - 5 - (v / max) * (h - 10)] as const);
  const last = pts[pts.length - 1];
  return (
    <div ref={ref} className="spark" aria-hidden="true">
      <svg width={w} height={h} style={{ display: 'block' }}>
        <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--s1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
        {last ? <circle cx={last[0]} cy={last[1]} r="4" fill="var(--s1)" stroke="var(--v-surface)" strokeWidth="2" /> : null}
      </svg>
    </div>
  );
}

export function StatTile({ label, value, sub, spark, hero }: { label: string; value: ReactNode; sub?: ReactNode; spark?: number[]; hero?: boolean }) {
  return (
    <div className={`viz tile ${hero ? 'hero' : ''}`}>
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
      {spark && spark.some((v) => v > 0) ? <Sparkline values={spark} /> : null}
    </div>
  );
}

// ── time series (single series: area + line, snapping crosshair) ────────────

export function TimeSeries({ data, label, height = 220 }: { data: Array<{ date: string; value: number }>; label: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const m = { t: 10, r: 14, b: 26, l: 40 };
  const plotW = Math.max(width - m.l - m.r, 10);
  const plotH = height - m.t - m.b;
  const max = Math.max(...data.map((d) => d.value), 0);
  const { top, ticks } = useMemo(() => niceScale(max), [max]);
  const x = (i: number) => m.l + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => m.t + plotH - (v / top) * plotH;
  const pts = data.map((d, i) => [x(i), y(d.value)] as const);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${y(0)} L${pts[0][0].toFixed(1)},${y(0)} Z` : '';
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 78))));
  const idx = hover;

  const locate = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const i = Math.round(((px - m.l) / plotW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  return (
    <div ref={ref} className="viz" style={{ position: 'relative' }}>
      <svg
        className="ts"
        width={width}
        height={height}
        role="img"
        aria-label={`${label} per day`}
        tabIndex={0}
        onPointerMove={(e) => locate(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover((h) => h ?? data.length - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? data.length - 1) - 1));
          if (e.key === 'ArrowRight') setHover((h) => Math.min(data.length - 1, (h ?? 0) + 1));
        }}
      >
        <defs>
          <clipPath id={`${id}-c`}>
            <rect x={m.l} y={m.t} width={plotW} height={plotH + 2} />
          </clipPath>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'axis' : 'grid'} x1={m.l} x2={m.l + plotW} y1={y(t)} y2={y(t)} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end">{fmtNum(t)}</text>
          </g>
        ))}
        {data.map((d, i) => (i % labelEvery === 0 || i === data.length - 1) && (data.length - 1 - i >= labelEvery * 0.6 || i === data.length - 1) ? (
          <text key={d.date} x={x(i)} y={height - 7} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>{shortDate(d.date)}</text>
        ) : null)}
        <g clipPath={`url(#${id}-c)`}>
          <path className="area" d={area} />
          <path className="line" d={line} />
        </g>
        {idx !== null && pts[idx] ? (
          <>
            <line className="cross" x1={pts[idx][0]} x2={pts[idx][0]} y1={m.t} y2={y(0)} />
            <circle className="dot" cx={pts[idx][0]} cy={pts[idx][1]} r="4" />
          </>
        ) : pts.length ? (
          <circle className="dot" cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" />
        ) : null}
      </svg>
      {idx !== null && data[idx] ? (
        <div className="viz-tip" style={{ left: Math.min(Math.max(pts[idx][0] - 60, 0), width - 150), top: Math.max(pts[idx][1] - 62, 0) }}>
          <div className="v"><i />{fmtNum(data[idx].value)} <span style={{ fontWeight: 500, color: 'var(--v-ink-2)', fontSize: 12.5 }}>{label.toLowerCase()}</span></div>
          <div className="d">{longDate(data[idx].date)}</div>
        </div>
      ) : null}
    </div>
  );
}

// ── horizontal bars (one series → one colour) ───────────────────────────────

export interface BarRow {
  label: string;
  value: number;
  /** Shown beside the value, e.g. "of 13". */
  sub?: string;
  /** Tooltip detail. */
  detail?: string;
  color?: string;
}

export function HBars({ rows, format = fmtNum, max, className = '' }: { rows: BarRow[]; format?: (n: number) => string; max?: number; className?: string }) {
  const [tip, setTip] = useState<{ row: BarRow; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <div className="viz-empty">Nothing to show yet.</div>;
  const show = (row: BarRow, el: HTMLElement) => {
    const w = wrap.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (w) setTip({ row, x: Math.min(r.left - w.left + 140, w.width - 170), y: r.top - w.top - 46 });
  };
  return (
    <div ref={wrap} className={`viz hbars ${className}`} style={{ position: 'relative' }}>
      {rows.map((r) => (
        <div
          key={r.label}
          className="hbar"
          tabIndex={0}
          onPointerEnter={(e) => show(r, e.currentTarget)}
          onFocus={(e) => show(r, e.currentTarget)}
          onPointerLeave={() => setTip(null)}
          onBlur={() => setTip(null)}
        >
          <div className="name" title={r.label}>{r.label}</div>
          <div className="plot">
            <div className="bar" style={{ width: `calc(${Math.max((r.value / top) * 100, 0)}% * 0.82)`, background: r.color }} />
            <div className="num">{format(r.value)}{r.sub ? <small>{r.sub}</small> : null}</div>
          </div>
        </div>
      ))}
      {tip ? (
        <div className="viz-tip" style={{ left: tip.x, top: Math.max(tip.y, -4) }}>
          <div className="v">{format(tip.row.value)} {tip.row.sub ? <span style={{ fontWeight: 500, color: 'var(--v-ink-2)', fontSize: 12.5 }}>{tip.row.sub}</span> : null}</div>
          <div className="d">{tip.row.detail ?? tip.row.label}</div>
        </div>
      ) : null}
    </div>
  );
}

/** Funnel stages are ordered, so they take the ordinal ramp (one hue, light → dark). */
export function Funnel({ stages }: { stages: Array<{ label: string; n: number }> }) {
  const ramp = ['var(--ramp-1)', 'var(--ramp-2)', 'var(--ramp-3)', 'var(--ramp-4)'];
  const first = stages[0]?.n ?? 0;
  const rows: BarRow[] = stages.map((s, i) => {
    const prev = i === 0 ? null : stages[i - 1].n;
    return {
      label: s.label,
      value: s.n,
      sub: prev !== null && prev > 0 ? `${Math.round((s.n / prev) * 100)}% of previous` : first > 0 && i === 0 ? '' : undefined,
      detail: first > 0 ? `${Math.round((s.n / first) * 100)}% of all links` : s.label,
      color: ramp[Math.min(i, ramp.length - 1)],
    };
  });
  return <HBars rows={rows} className="funnel" max={Math.max(first, 1)} />;
}

/** Two-part split (e.g. mobile vs desktop): two series, so it carries a legend. */
export function SplitBar({ a, b }: { a: { label: string; value: number }; b: { label: string; value: number } }) {
  const total = a.value + b.value;
  if (!total) return <div className="viz-empty">No views yet.</div>;
  return (
    <div className="viz">
      <div className="stacked" role="img" aria-label={`${a.label} ${a.value}, ${b.label} ${b.value}`}>
        <i style={{ width: `${(a.value / total) * 100}%`, background: 'var(--s1)' }} title={`${a.label}: ${a.value}`} />
        <i style={{ width: `${(b.value / total) * 100}%`, background: 'var(--s2)' }} title={`${b.label}: ${b.value}`} />
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--s1)' }} />{a.label} <b style={{ color: 'var(--v-ink)' }}>{Math.round((a.value / total) * 100)}%</b></span>
        <span><i style={{ background: 'var(--s2)' }} />{b.label} <b style={{ color: 'var(--v-ink)' }}>{Math.round((b.value / total) * 100)}%</b></span>
      </div>
    </div>
  );
}

export function useStale(loading: boolean): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => setStale(loading), [loading]);
  return stale;
}
