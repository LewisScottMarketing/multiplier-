import type { Rule } from './schema';

/**
 * The audiences the dashboard offers for persona targeting. The same list feeds the quick-pick chips
 * in the rule editor and the "write a version for…" action, which uses the description to brief the
 * writer. Rules match on fields derived from the job title (see derive.ts).
 */
export interface Persona {
  id: string;
  label: string;
  /** Who they are and what they care about, in one clause. Used as a writing brief. */
  description: string;
  rule: Rule;
}

const one = (field: string, value: string): Rule => ({ match: 'all', conditions: [{ field, op: 'equals', value }] });

export const PERSONAS: Persona[] = [
  { id: 'marketing', label: 'Marketing', description: 'marketing leaders and practitioners, who care about pipeline contribution, brand, message-market fit and campaign performance', rule: one('department', 'marketing') },
  { id: 'sales', label: 'Sales', description: 'sales leaders and reps, who care about quota attainment, pipeline coverage, reply rates and rep productivity', rule: one('department', 'sales') },
  { id: 'engineering', label: 'Engineering', description: 'engineers and engineering leaders, who care about reliability, integration effort, security, build-versus-buy and ongoing maintenance', rule: one('department', 'engineering') },
  { id: 'product', label: 'Product', description: 'product managers and product leaders, who care about adoption, activation, roadmap trade-offs and evidence from customers', rule: one('department', 'product') },
  { id: 'customer_success', label: 'Customer success', description: 'customer success and support leaders, who care about retention, onboarding speed, account health and expansion', rule: one('department', 'customer_success') },
  { id: 'executive', label: 'Executives', description: 'C-level executives, founders and owners, who care about growth, risk, cost, time to value and competitive position, and who want the short version', rule: one('seniority_group', 'executive') },
  { id: 'leader', label: 'Leaders', description: 'directors, VPs and heads of function, who care about team outcomes, budget, hiring and how a change plays out across the organisation', rule: one('seniority_group', 'leader') },
  { id: 'practitioner', label: 'Practitioners', description: 'hands-on practitioners and managers, who care about day-to-day workflow, ease of use, time saved and how to get started this week', rule: one('seniority_group', 'practitioner') },
];
