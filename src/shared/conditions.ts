import type { Condition, Rule } from './schema';
import { lookup, normKey, type Ctx } from './template';

const MAX_VALUE = 500;

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE);
}

/**
 * How a `matches` pattern is run. The default is a plain `re.test`. The server swaps in a guarded
 * runner (see server/lib/safe-regex.ts) because a pattern is owner-written but the text it is tested
 * against comes from prospect data, and a badly written pattern can otherwise take minutes.
 */
export type RegexTester = (re: RegExp, input: string) => boolean;
let testRegex: RegexTester = (re, input) => re.test(input);
export const setRegexTester = (fn: RegexTester): void => {
  testRegex = fn;
};

const regexCache = new Map<string, RegExp | null>();
function compile(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  let re: RegExp | null = null;
  // Patterns are authored by the workspace owner and matched against short strings, but keep
  // them bounded anyway so a typo can't hang a request.
  if (pattern.length <= 200) {
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      re = null;
    }
  }
  if (regexCache.size > 500) regexCache.clear();
  regexCache.set(pattern, re);
  return re;
}

export function evalCondition(c: Condition, ctx: Ctx): boolean {
  const left = norm(lookup(ctx, normKey(c.field)));
  const right = norm(c.value ?? '');
  switch (c.op) {
    case 'equals':
      return left === right;
    case 'not_equals':
      return left !== right;
    case 'contains':
      return right !== '' && left.includes(right);
    case 'not_contains':
      return right === '' || !left.includes(right);
    case 'starts_with':
      return left.startsWith(right);
    case 'ends_with':
      return left.endsWith(right);
    case 'in':
      return list(c.value).includes(left);
    case 'not_in':
      return !list(c.value).includes(left);
    case 'matches': {
      const re = compile(c.value ?? '');
      return re ? testRegex(re, left) : false;
    }
    case 'exists':
      return left !== '';
    case 'not_exists':
      return left === '';
    default:
      return false;
  }
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => norm(s))
    .filter(Boolean);

/** A missing or empty rule always matches. */
export function evalRule(rule: Rule | undefined | null, ctx: Ctx): boolean {
  if (!rule || rule.conditions.length === 0) return true;
  return rule.match === 'any'
    ? rule.conditions.some((c) => evalCondition(c, ctx))
    : rule.conditions.every((c) => evalCondition(c, ctx));
}

export const OP_LABELS: Record<Condition['op'], string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  in: 'is one of',
  not_in: 'is not one of',
  matches: 'matches pattern',
  exists: 'is known',
  not_exists: 'is unknown',
};

export function describeRule(rule: Rule | undefined | null): string {
  if (!rule || rule.conditions.length === 0) return 'Everyone';
  const parts = rule.conditions.map((c) => {
    const v = c.op === 'exists' || c.op === 'not_exists' ? '' : ` “${c.value}”`;
    return `${c.field} ${OP_LABELS[c.op]}${v}`;
  });
  return parts.join(rule.match === 'any' ? ' or ' : ' and ');
}

const INVERSE: Partial<Record<Condition['op'], Condition['op']>> = {
  equals: 'not_equals',
  not_equals: 'equals',
  in: 'not_in',
  not_in: 'in',
  contains: 'not_contains',
  not_contains: 'contains',
  exists: 'not_exists',
  not_exists: 'exists',
};

/**
 * "Everyone except the people `persona` matches", added on top of a block's existing rule, so a
 * persona-specific version can replace the original for that audience rather than sit beside it.
 * Only single-condition personas invert cleanly; so do not-yet-targeted blocks and "match all"
 * rules. Returns null when the result can't be expressed (the caller then leaves the original as is).
 */
export function excludingRule(original: Rule | undefined | null, persona: Rule): Rule | null {
  if (persona.conditions.length !== 1) return null;
  const c = persona.conditions[0]!;
  const op = INVERSE[c.op];
  if (!op) return null;
  const inverted: Condition = { ...c, op };
  if (!original || original.conditions.length === 0) return { match: 'all', conditions: [inverted] };
  if (original.match === 'any' && original.conditions.length > 1) return null;
  if (original.conditions.length >= 10) return null;
  return { match: 'all', conditions: [...original.conditions, inverted] };
}

/**
 * A persona-specific version of a block must reach the persona AND still respect whatever audience
 * the original was already limited to. Returns the combined rule, or just the persona's when the
 * original uses "any" (which can't be intersected without regrouping).
 */
export function intersectRule(original: Rule | undefined | null, persona: Rule): Rule {
  if (!original || original.conditions.length === 0) return persona;
  if (original.match === 'any' && original.conditions.length > 1) return persona;
  const conditions = [...original.conditions, ...persona.conditions].slice(0, 10);
  return { match: 'all', conditions };
}
