import { CheckCircle2, Plus, Trash2, XCircle } from 'lucide-react';
import { evalRule, describeRule } from '@shared/conditions';
import { DEPARTMENT_LABELS, SENIORITY_GROUPS, SENIORITY_LABELS } from '@shared/derive';
import { CONDITION_OPS, type Condition, type Rule } from '@shared/schema';
import { OP_LABELS } from '@shared/conditions';
import { useCampaign } from '../campaign';
import { Button, Input, Select } from '../ui';

const PRESETS: Array<{ label: string; rule: Rule }> = [
  { label: 'Marketing', rule: one('department', 'equals', 'marketing') },
  { label: 'Sales', rule: one('department', 'equals', 'sales') },
  { label: 'Engineering', rule: one('department', 'equals', 'engineering') },
  { label: 'Product', rule: one('department', 'equals', 'product') },
  { label: 'Customer success', rule: one('department', 'equals', 'customer_success') },
  { label: 'Executives', rule: one('seniority_group', 'equals', 'executive') },
  { label: 'Leaders', rule: one('seniority_group', 'equals', 'leader') },
  { label: 'Practitioners', rule: one('seniority_group', 'equals', 'practitioner') },
];

function one(field: string, op: Condition['op'], value: string): Rule {
  return { match: 'all', conditions: [{ field, op, value }] };
}

/** Value choices for fields whose values we know (derived from the job title). */
function optionsFor(field: string): Array<[string, string]> | null {
  if (field === 'department') return Object.entries(DEPARTMENT_LABELS).map(([k, v]) => [k, v]);
  if (field === 'seniority') return Object.entries(SENIORITY_LABELS).map(([k, v]) => [k, v]);
  if (field === 'seniority_group') return [...new Set(Object.values(SENIORITY_GROUPS))].map((v) => [v, v[0]!.toUpperCase() + v.slice(1)]);
  return null;
}

/**
 * "Show this only to…": persona targeting. Quick presets cover the common job-title segments;
 * the editor below handles anything else, including your own Clay fields.
 */
export function RuleEditor({ rule, onChange, noun = 'block' }: { rule: Rule | undefined; onChange: (r: Rule | undefined) => void; noun?: string }) {
  const c = useCampaign();
  const active = !!rule && rule.conditions.length > 0;
  const matches = active ? evalRule(rule, c.previewCtx) : true;
  const fieldKeys = [...new Set([...c.fields.map((f) => f.key), ...(rule?.conditions.map((x) => x.field) ?? [])])];

  const setCond = (i: number, patch: Partial<Condition>) => onChange({ ...(rule as Rule), conditions: rule!.conditions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="hint">Show this {noun} only to the people it’s written for. Everyone else sees the page without it.</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {PRESETS.map((p) => {
          const on = active && JSON.stringify(rule!.conditions) === JSON.stringify(p.rule.conditions);
          return (
            <button key={p.label} type="button" className={`btn xs ${on ? 'primary' : ''}`} onClick={() => onChange(on ? undefined : p.rule)}>
              {p.label}
            </button>
          );
        })}
      </div>

      {active ? (
        <div className="col" style={{ gap: 8, background: 'var(--bg)', borderRadius: 10, padding: 10 }}>
          {rule!.conditions.length > 1 ? (
            <div className="row small">
              Match
              <Select small value={rule!.match} onChange={(e) => onChange({ ...rule!, match: e.target.value as 'all' | 'any' })} style={{ width: 90 }}>
                <option value="all">all</option>
                <option value="any">any</option>
              </Select>
              of these:
            </div>
          ) : null}
          {rule!.conditions.map((cond, i) => {
            const opts = optionsFor(cond.field);
            const noValue = cond.op === 'exists' || cond.op === 'not_exists';
            return (
              <div key={i} className="col" style={{ gap: 6, paddingBottom: 8, borderBottom: i < rule!.conditions.length - 1 ? '1px dashed var(--line-2)' : 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <Select small value={cond.field} onChange={(e) => setCond(i, { field: e.target.value, value: '' })} aria-label="Field">
                    {fieldKeys.map((k) => <option key={k} value={k}>{c.fields.find((f) => f.key === k)?.label ?? k}</option>)}
                  </Select>
                  <Button size="xs" variant="ghost" icon aria-label="Remove condition" onClick={() => { const next = rule!.conditions.filter((_, j) => j !== i); onChange(next.length ? { ...rule!, conditions: next } : undefined); }}>
                    <Trash2 size={13} />
                  </Button>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Select small value={cond.op} onChange={(e) => setCond(i, { op: e.target.value as Condition['op'] })} aria-label="Operator" style={{ width: 150 }}>
                    {CONDITION_OPS.map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
                  </Select>
                  {noValue ? null : opts && (cond.op === 'equals' || cond.op === 'not_equals') ? (
                    <Select small value={cond.value} onChange={(e) => setCond(i, { value: e.target.value })} aria-label="Value">
                      <option value="">Choose…</option>
                      {opts.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  ) : (
                    <Input small value={cond.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder={cond.op === 'in' || cond.op === 'not_in' ? 'a, b, c' : cond.op === 'matches' ? 'regular expression' : 'value'} aria-label="Value" />
                  )}
                </div>
              </div>
            );
          })}
          <div className="row">
            <Button size="xs" onClick={() => onChange({ ...rule!, conditions: [...rule!.conditions, { field: 'job_title', op: 'contains', value: '' }] })}>
              <Plus size={13} /> Add condition
            </Button>
            <Button size="xs" variant="ghost" className="right" onClick={() => onChange(undefined)}>Show to everyone</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => onChange({ match: 'all', conditions: [{ field: 'job_title', op: 'contains', value: '' }] })}>
          <Plus size={14} /> Custom rule…
        </Button>
      )}

      {active ? (
        <div className="small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: matches ? 'var(--ok)' : 'var(--ink-3)' }}>
          {matches ? <CheckCircle2 size={15} style={{ flex: 'none', marginTop: 2 }} /> : <XCircle size={15} style={{ flex: 'none', marginTop: 2 }} />}
          <span>
            <b>{describeRule(rule)}</b>
            <br />
            {matches ? 'Matches the person you’re previewing.' : 'Doesn’t match the person you’re previewing, so it’s hidden in the preview.'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
