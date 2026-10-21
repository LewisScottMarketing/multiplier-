import { STANDARD_FIELDS } from './fields';
import type { Block, Campaign } from './schema';
import { extractTokens, normKey } from './template';

export interface LintIssue {
  level: 'warn' | 'info';
  code: string;
  message: string;
  /** Block id this issue belongs to, when there is one. */
  block?: string;
  field?: string;
}

/** Fields that always resolve, so a missing fallback is not a risk. */
const ALWAYS_PRESENT = new Set(['page_url', 'today', 'prospect_id']);

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** Strings in a block that are rendered as page content (excludes ids and enum-like props). */
function blockStrings(b: Block): string[] {
  const { id: _id, type: _t, anchor: _a, rule: _r, hidden: _h, bg: _bg, pad: _p, align: _al, ...rest } = b as Block & Record<string, unknown>;
  return strings(rest);
}

/**
 * Static checks that catch the mistakes that embarrass you in front of a prospect:
 * "Hi ," because a token had no fallback, a button that goes nowhere, a typo in a field name.
 */
export function lintCampaign(c: Pick<Campaign, 'page' | 'document' | 'settings'>, knownCustomFields: string[] = []): LintIssue[] {
  const issues: LintIssue[] = [];
  const known = new Set<string>([
    ...STANDARD_FIELDS.map((f) => f.key),
    ...knownCustomFields.map(normKey),
    ...c.settings.ai_fields.map((f) => `ai_${f.key}`),
    'cover_url',
    'full_name',
  ]);
  const required = new Set(c.settings.required_fields.map(normKey));

  const noFallback = new Map<string, Set<string>>();
  const unknown = new Map<string, Set<string>>();
  const note = (map: Map<string, Set<string>>, field: string, block: string) => {
    if (!map.has(field)) map.set(field, new Set());
    map.get(field)!.add(block);
  };

  const hasForm = c.page.blocks.some((b) => b.type === 'form' && !b.hidden);

  for (const b of c.page.blocks) {
    if (b.hidden) continue;
    for (const s of blockStrings(b)) {
      for (const t of extractTokens(s)) {
        if (!known.has(t.field)) note(unknown, t.field, b.id);
        else if (!t.hasFallback && !required.has(t.field) && !ALWAYS_PRESENT.has(t.field)) note(noFallback, t.field, b.id);
      }
    }
    for (const rule of b.rule?.conditions ?? []) {
      if (rule.field && !known.has(normKey(rule.field))) note(unknown, normKey(rule.field), b.id);
    }

    if (b.type === 'hero' && !b.headline.trim()) issues.push({ level: 'warn', code: 'empty_headline', block: b.id, message: 'The hero has no headline.' });
    if (b.type === 'video' && b.url && !/\{\{/.test(b.url) && !/(youtube\.com|youtu\.be|vimeo\.com|loom\.com|wistia\.)/i.test(b.url)) {
      issues.push({ level: 'warn', code: 'video_unsupported', block: b.id, message: 'Video links must be YouTube, Vimeo, Loom or Wistia.' });
    }
    if (b.type === 'calendar' && b.url && !/\{\{/.test(b.url) && !/(calendly\.com|cal\.com|hubspot\.com)/i.test(b.url)) {
      issues.push({ level: 'warn', code: 'calendar_unsupported', block: b.id, message: 'Meeting links must be Calendly, Cal.com or HubSpot.' });
    }
    if ((b.type === 'document' || (b.type === 'hero' && b.show_document)) && !c.document) {
      issues.push({ level: 'warn', code: 'no_document', block: b.id, message: 'This block needs a PDF. Upload one on the PDF tab.' });
    }
    const buttons = b.type === 'hero' ? [b.primary, b.secondary] : b.type === 'cta' ? [b.button, b.secondary] : [];
    for (const btn of buttons) {
      if (!btn) continue;
      if (btn.action.type === 'form' && !hasForm) issues.push({ level: 'warn', code: 'no_form', block: b.id, message: `“${btn.label}” scrolls to a form, but the page has no form.` });
      if (btn.action.type === 'document' && !c.document) issues.push({ level: 'warn', code: 'no_document', block: b.id, message: `“${btn.label}” downloads the PDF, but no PDF is attached.` });
      if (btn.action.type === 'link' && !btn.action.url.trim()) issues.push({ level: 'warn', code: 'empty_link', block: b.id, message: `“${btn.label}” has no link.` });
    }
  }

  for (const [field, blocks] of unknown) {
    issues.push({ level: 'warn', code: 'unknown_field', field, block: [...blocks][0], message: `{{${field}}} isn’t a field we know about yet. Check the spelling, or send it from Clay.` });
  }
  for (const [field, blocks] of noFallback) {
    issues.push({
      level: 'info',
      code: 'no_fallback',
      field,
      block: [...blocks][0],
      message: `{{${field}}} has no fallback. If a prospect has no ${field.replace(/_/g, ' ')}, it will render blank. Try {{${field}|there}} or mark it required.`,
    });
  }
  return issues;
}
