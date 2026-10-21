import type { Condition, Rule } from './schema';
import { lookup, normKey, type Ctx } from './template';

const MAX_VALUE = 500;

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE);
}

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
      return re ? re.test(left) : false;
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
