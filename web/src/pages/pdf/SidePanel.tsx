import { FileText, Replace, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import type { DocumentConfig } from '@shared/schema';
import { TokenField } from '../../components/TokenField';
import { Alert, Badge, Button } from '../../ui';
import { FIELD_META, fieldTitle } from './fields';

export interface FileInfo {
  filename: string;
  size: number;
  pages: Array<{ w: number; h: number }>;
  tokens: string[];
  editable: boolean;
}

const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function SidePanel({
  campaignId,
  doc,
  file,
  pageNo,
  selectedId,
  uploading,
  onPage,
  onSelect,
  onFilename,
  onReplace,
  onRemove,
}: {
  campaignId: string;
  doc: DocumentConfig;
  file: FileInfo | undefined;
  pageNo: number;
  selectedId: string | null;
  uploading: boolean;
  onPage: (n: number) => void;
  onSelect: (id: string, page: number) => void;
  onFilename: (v: string) => void;
  onReplace: (f: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const count = (n: number) => doc.fields.filter((f) => f.page === n).length;
  const pages = Array.from({ length: doc.page_count }, (_, i) => i + 1);

  return (
    <div className="st-left">
      <div className="st-sec">
        <h4>PDF</h4>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="bl-ico">
            <FileText size={15} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="truncate" title={file?.filename} style={{ fontWeight: 600, fontSize: 13 }}>
              {file?.filename ?? 'document.pdf'}
            </div>
            <div className="muted tiny">
              {doc.page_count} page{doc.page_count === 1 ? '' : 's'}
              {file ? ` · ${fmtSize(file.size)}` : ''}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Button size="xs" loading={uploading} onClick={() => input.current?.click()}>
            <Replace size={12} /> Replace
          </Button>
          <Button size="xs" variant="ghost" className="danger" onClick={onRemove}>
            <Trash2 size={12} /> Remove
          </Button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onReplace(f);
              e.target.value = '';
            }}
          />
        </div>
        {file && !file.editable ? (
          <Alert tone="warn">This PDF can’t be edited, so each prospect gets the original file. The landing page still personalises.</Alert>
        ) : null}
        <TokenField
          label="Name of each person’s file"
          value={doc.filename}
          onChange={onFilename}
          small
          hint="e.g. Playbook for Northwind.pdf"
        />
      </div>

      <div className="st-sec">
        <h4>Pages</h4>
        <div className="col" style={{ gap: 4 }}>
          {pages.map((n) => {
            const dim = file?.pages[n - 1];
            return (
              <button
                key={n}
                type="button"
                className={`thumb ${n === pageNo ? 'on' : ''}`}
                onClick={() => onPage(n)}
                aria-label={`Page ${n}`}
                aria-current={n === pageNo}
              >
                <div className="im" style={{ aspectRatio: dim ? `${dim.w} / ${dim.h}` : '0.77' }}>
                  <img src={`/api/campaigns/${campaignId}/document/page/${n}.png`} alt="" loading="lazy" draggable={false} />
                </div>
                <div className="n">
                  <span>Page {n}</span>
                  {count(n) ? (
                    <Badge tone="brand">
                      {count(n)} field{count(n) === 1 ? '' : 's'}
                    </Badge>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="st-sec">
        <h4>Fields · {doc.fields.length}</h4>
        {!doc.fields.length ? (
          <div className="muted small">Nothing personalised yet. Click text in the PDF, or draw a box.</div>
        ) : (
          <div className="col" style={{ gap: 2 }}>
            {doc.fields.map((f) => {
              const Icon = FIELD_META[f.type].icon;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`frow ${f.id === selectedId ? 'on' : ''}`}
                  onClick={() => onSelect(f.id, f.page)}
                >
                  <span className="ic">
                    <Icon size={13} />
                  </span>
                  <span className="grow truncate small" style={{ fontWeight: 560 }}>
                    {fieldTitle(f)}
                  </span>
                  {f.rule?.conditions.length ? <Badge tone="brand">Targeted</Badge> : null}
                  <span className="muted tiny">p{f.page}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
