import { describe, expect, it } from 'vitest';
import { describeRule, evalCondition, evalRule } from '@shared/conditions';

const ctx = { job_title: 'VP of Marketing', department: 'marketing', company: 'Acme Inc', empty: '' };

describe('evalCondition', () => {
  it('compares case-insensitively and ignores extra whitespace', () => {
    expect(evalCondition({ field: 'department', op: 'equals', value: 'Marketing ' }, ctx)).toBe(true);
    expect(evalCondition({ field: 'department', op: 'not_equals', value: 'sales' }, ctx)).toBe(true);
  });
  it('supports contains / starts / ends', () => {
    expect(evalCondition({ field: 'job_title', op: 'contains', value: 'marketing' }, ctx)).toBe(true);
    expect(evalCondition({ field: 'job_title', op: 'starts_with', value: 'vp' }, ctx)).toBe(true);
    expect(evalCondition({ field: 'job_title', op: 'ends_with', value: 'marketing' }, ctx)).toBe(true);
    expect(evalCondition({ field: 'job_title', op: 'not_contains', value: 'sales' }, ctx)).toBe(true);
  });
  it('supports in / not_in lists', () => {
    expect(evalCondition({ field: 'department', op: 'in', value: 'sales, Marketing ,product' }, ctx)).toBe(true);
    expect(evalCondition({ field: 'department', op: 'not_in', value: 'sales,product' }, ctx)).toBe(true);
  });
  it('supports regex and never throws on a bad pattern', () => {
    expect(evalCondition({ field: 'job_title', op: 'matches', value: '^(vp|svp)\\b' }, ctx)).toBe(true);
    expect(evalCondition({ field: 'job_title', op: 'matches', value: '([' }, ctx)).toBe(false);
  });
  it('supports exists / not_exists, treating empty strings as unknown', () => {
    expect(evalCondition({ field: 'company', op: 'exists', value: '' }, ctx)).toBe(true);
    expect(evalCondition({ field: 'empty', op: 'exists', value: '' }, ctx)).toBe(false);
    expect(evalCondition({ field: 'missing', op: 'not_exists', value: '' }, ctx)).toBe(true);
  });
  it('contains with an empty value never matches (avoids accidental match-all)', () => {
    expect(evalCondition({ field: 'job_title', op: 'contains', value: '' }, ctx)).toBe(false);
  });
});

describe('evalRule', () => {
  it('no rule or no conditions means show to everyone', () => {
    expect(evalRule(undefined, ctx)).toBe(true);
    expect(evalRule({ match: 'all', conditions: [] }, ctx)).toBe(true);
  });
  it('all vs any', () => {
    const conds = [
      { field: 'department', op: 'equals' as const, value: 'marketing' },
      { field: 'company', op: 'contains' as const, value: 'zzz' },
    ];
    expect(evalRule({ match: 'all', conditions: conds }, ctx)).toBe(false);
    expect(evalRule({ match: 'any', conditions: conds }, ctx)).toBe(true);
  });
  it('describes rules in plain English', () => {
    expect(describeRule({ match: 'all', conditions: [{ field: 'department', op: 'equals', value: 'sales' }] })).toBe(
      'department is “sales”',
    );
    expect(describeRule(undefined)).toBe('Everyone');
  });
});
