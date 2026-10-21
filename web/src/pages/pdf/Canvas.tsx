import { useMemo, useRef, useState } from 'react';
import type { PdfField } from '@shared/schema';
import { Spinner } from '../../ui';
import { FIELD_META, fieldTitle, type Tool } from './fields';
import { area, clampRect, intersection, rectFromPoints, resizeRect, roundRect, squareUp, type Handle, type Rect } from './geometry';

export interface StudioRun {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StudioPageData {
  page: number;
  width: number;
  height: number;
  runs: StudioRun[];
}

type Pt = { x: number; y: number };
type Drag =
  | { kind: 'move'; id: string; start: Pt; orig: Rect; moved: boolean }
  | { kind: 'resize'; id: string; handle: Handle; start: Pt; orig: Rect; square: boolean }
  | { kind: 'draw'; start: Pt };

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNERS: Handle[] = ['nw', 'ne', 'se', 'sw'];

const FONT_CSS: Record<string, string> = {
  inter: "'Inter Variable', Inter, system-ui, sans-serif",
  helvetica: 'Helvetica, Arial, sans-serif',
  serif: "Georgia, 'Times New Roman', serif",
  mono: 'ui-monospace, Menlo, Consolas, monospace',
  auto: "'Inter Variable', Inter, system-ui, sans-serif",
};

/** Is this piece of original text already being replaced by one of our text fields? */
export function runCoveredBy(run: StudioRun, fields: PdfField[], pageNo: number): PdfField | undefined {
  return fields.find((f) => f.type === 'text' && f.page === pageNo && f.mask && intersection(f.mask.rect ?? f.rect, run) > 0.5 * area(run));
}

export function PageCanvas({
  page,
  pageNo,
  imageUrl,
  scale,
  fields,
  mode,
  previewUrl,
  previewBusy,
  tool,
  showAllText,
  selectedId,
  onSelect,
  onRunClick,
  onCreate,
  onRect,
}: {
  page: StudioPageData;
  pageNo: number;
  imageUrl: string;
  scale: number;
  fields: PdfField[];
  mode: 'edit' | 'preview';
  previewUrl: string | null;
  previewBusy: boolean;
  tool: Tool;
  showAllText: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRunClick: (run: StudioRun) => void;
  onCreate: (type: Exclude<Tool, 'select'>, rect: Rect) => void;
  onRect: (id: string, rect: Rect) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const W = page.width;
  const H = page.height;
  const s = scale;
  const onPage = useMemo(() => fields.filter((f) => f.page === pageNo), [fields, pageNo]);
  const covered = useMemo(
    () => new Set(page.runs.filter((r) => runCoveredBy(r, fields, pageNo)).map((r) => r.id)),
    [page.runs, fields, pageNo],
  );

  const pt = (e: { clientX: number; clientY: number }): Pt => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };

  const downField = (e: React.PointerEvent, f: PdfField, handle?: Handle) => {
    if (e.button !== 0 || mode !== 'edit') return;
    e.stopPropagation();
    onSelect(f.id);
    const start = pt(e);
    drag.current = handle
      ? { kind: 'resize', id: f.id, handle, start, orig: f.rect, square: f.type === 'qr' }
      : { kind: 'move', id: f.id, start, orig: f.rect, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const downPage = (e: React.PointerEvent) => {
    if (e.button !== 0 || mode !== 'edit') return;
    if (tool === 'select') {
      onSelect(null);
      return;
    }
    const start = pt(e);
    drag.current = { kind: 'draw', start };
    setDraft({ ...start, w: 0, h: 0 });
    wrap.current?.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const cur = pt(e);
    const dx = cur.x - d.start.x;
    const dy = cur.y - d.start.y;
    if (d.kind === 'draw') {
      setDraft(rectFromPoints(d.start, { x: Math.min(Math.max(cur.x, 0), W), y: Math.min(Math.max(cur.y, 0), H) }));
    } else if (d.kind === 'move') {
      if (!d.moved && Math.hypot(dx, dy) * s < 3) return;
      d.moved = true;
      onRect(d.id, roundRect(clampRect({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }, W, H, 1)));
    } else {
      let r = resizeRect(d.orig, d.handle, dx, dy);
      if (d.square) r = squareUp(r, d.handle, d.orig);
      onRect(d.id, roundRect(clampRect(r, W, H)));
    }
  };

  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'draw' && tool !== 'select') {
      const r = draft;
      setDraft(null);
      const size = FIELD_META[tool].size;
      const tiny = !r || (r.w * s < 8 && r.h * s < 8);
      const made: Rect = tiny ? { x: d.start.x, y: d.start.y, ...size } : r!;
      if (tool === 'qr') {
        const side = tiny ? size.w : Math.max(made.w, made.h);
        onCreate(tool, roundRect(clampRect({ x: made.x, y: made.y, w: side, h: side }, W, H)));
      } else onCreate(tool, roundRect(clampRect(made, W, H)));
    }
  };

  return (
    <div
      ref={wrap}
      className={`pdf-page ${mode}`}
      data-tool={mode === 'edit' ? tool : 'select'}
      style={{ width: W * s, height: H * s }}
      onPointerDown={downPage}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <img className="pdf-img" src={imageUrl} alt={`Page ${pageNo} of the PDF`} draggable={false} />

      {mode === 'preview' ? (
        <>
          {previewUrl ? (
            <img className="pdf-img pdf-preview" src={previewUrl} alt="How this page looks for the previewed person" draggable={false} />
          ) : null}
          {previewBusy ? (
            <div className="pdf-busy">
              <Spinner size={16} /> Rendering…
            </div>
          ) : null}
        </>
      ) : (
        <>
          {tool === 'select' && page.runs.length
            ? page.runs.map((r) =>
                covered.has(r.id) ? null : (
                  <button
                    key={r.id}
                    type="button"
                    className={`pdf-run ${showAllText ? 'all' : ''}`}
                    style={{ left: r.x * s - 2, top: r.y * s - 1, width: r.w * s + 4, height: r.h * s + 2 }}
                    title={`Click to personalise “${r.text.length > 60 ? `${r.text.slice(0, 57)}…` : r.text}”`}
                    aria-label={`Personalise the text: ${r.text}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onRunClick(r)}
                  />
                ),
              )
            : null}

          {onPage.map((f) =>
            f.type !== 'text' && f.type !== 'image' ? null : f.mask ? (
              <div
                key={`m-${f.id}`}
                className="pdf-mask"
                style={{
                  left: ((f.mask.rect ?? f.rect).x - f.mask.pad) * s,
                  top: ((f.mask.rect ?? f.rect).y - f.mask.pad) * s,
                  width: ((f.mask.rect ?? f.rect).w + f.mask.pad * 2) * s,
                  height: ((f.mask.rect ?? f.rect).h + f.mask.pad * 2) * s,
                  background: f.mask.color,
                }}
              />
            ) : null,
          )}

          {onPage.map((f) => {
            const sel = f.id === selectedId;
            const Icon = FIELD_META[f.type].icon;
            return (
              <div
                key={f.id}
                className={`pdf-field t-${f.type} ${sel ? 'sel' : ''} ${f.rule?.conditions.length ? 'ruled' : ''}`}
                style={{ left: f.rect.x * s, top: f.rect.y * s, width: f.rect.w * s, height: f.rect.h * s }}
                tabIndex={0}
                role="button"
                aria-label={`${FIELD_META[f.type].label} field: ${fieldTitle(f)}`}
                aria-pressed={sel}
                onPointerDown={(e) => downField(e, f)}
                onFocus={() => onSelect(f.id)}
              >
                <span className="pdf-tag">
                  <Icon size={11} /> <span>{fieldTitle(f)}</span>
                </span>
                {f.type === 'text' ? (
                  <span
                    className="pdf-ftext"
                    style={{
                      fontSize: Math.max(8, Math.min(f.size * s, 16)),
                      textAlign: f.align,
                      fontFamily: FONT_CSS[f.font.family] ?? FONT_CSS.inter,
                    }}
                  >
                    {f.text}
                  </span>
                ) : f.type === 'image' ? (
                  <span className="pdf-fcenter">{f.src.replace(/\{\{\s*|\s*\}\}/g, '') || 'Image'}</span>
                ) : f.type === 'qr' ? (
                  <span className="pdf-fcenter">
                    <Icon size={Math.min(28, f.rect.w * s * 0.5)} />
                  </span>
                ) : null}
                {sel
                  ? (f.type === 'qr' ? CORNERS : HANDLES).map((h) => (
                      <i key={h} className={`pdf-h h-${h}`} onPointerDown={(e) => downField(e, f, h)} />
                    ))
                  : null}
              </div>
            );
          })}

          {draft ? (
            <div className="pdf-draft" style={{ left: draft.x * s, top: draft.y * s, width: draft.w * s, height: draft.h * s }} />
          ) : null}
        </>
      )}
    </div>
  );
}
