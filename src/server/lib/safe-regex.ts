import vm from 'node:vm';
import { setRegexTester } from '@shared/conditions';
import type { Logger } from './log';

/**
 * Targeting rules can use a "matches pattern" test. The pattern is written by the workspace owner, but
 * it is run against job titles and company names that came from scraped profiles, and a pattern like
 * `(\w+\s?)+$` takes exponential time on the wrong input. Running it on the main thread would freeze
 * every request, so patterns with repetition run under a short watchdog; one that overruns is treated
 * as "no match" and switched off until restart.
 */

const BUDGET_MS = 25;
const sandbox = vm.createContext({ re: null as RegExp | null, input: '' });
const script = new vm.Script('re.test(input)');
/** Patterns that overran the budget. */
const slow = new Set<string>();
// alternation and literals can't backtrack badly; anything with a quantifier might
const MAY_BACKTRACK = /[*+?{]/;

let report: (pattern: string) => void = () => undefined;

export function guardedRegexTest(re: RegExp, input: string): boolean {
  if (!MAY_BACKTRACK.test(re.source)) return re.test(input);
  if (slow.has(re.source)) return false;
  sandbox.re = re;
  sandbox.input = input;
  try {
    return script.runInContext(sandbox, { timeout: BUDGET_MS }) as boolean;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw e;
    slow.add(re.source);
    report(re.source);
    return false;
  } finally {
    sandbox.re = null;
    sandbox.input = '';
  }
}

export function installRegexGuard(log: Logger): void {
  report = (pattern) => log.warn('A "matches pattern" rule ran too long and is being ignored until restart. Simplify the pattern.', { pattern: pattern.slice(0, 120) });
  setRegexTester(guardedRegexTest);
}

/** For tests. */
export const slowPatterns = (): string[] => [...slow];
export const forgetSlowPatterns = (): void => slow.clear();
