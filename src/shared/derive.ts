import { toStr, type Ctx } from './template';

/**
 * Turns the handful of fields every prospect has (name, company, title, email) into the
 * richer set rules and copy actually want: seniority, department, a short company name, a
 * tidy first name. Pure and deterministic — no network, no AI.
 */

// ── Seniority ───────────────────────────────────────────────────────────────

export const SENIORITY_LABELS = {
  owner: 'Founder / Owner',
  c_level: 'C-level',
  vp: 'VP',
  head: 'Head of',
  director: 'Director',
  manager: 'Manager',
  senior: 'Senior',
  individual: 'Individual contributor',
  junior: 'Junior / Intern',
} as const;
export type Seniority = keyof typeof SENIORITY_LABELS;

export const SENIORITY_GROUPS: Record<Seniority, 'executive' | 'leader' | 'practitioner'> = {
  owner: 'executive',
  c_level: 'executive',
  vp: 'executive',
  head: 'leader',
  director: 'leader',
  manager: 'leader',
  senior: 'practitioner',
  individual: 'practitioner',
  junior: 'practitioner',
};

const SENIORITY_RULES: Array<[Seniority, RegExp]> = [
  ['owner', /\b(co-?founder|founder|(?<!product |process |budget |data |system )owner|proprietor)\b/i],
  ['vp', /\b(vp|v\.p\.|svp|evp|avp|vice[\s-]+president)\b/i],
  ['c_level', /\b(chief|c[a-z]o|ceo|cto|cfo|coo|cmo|cro|cio|ciso|cpo|chro|cco|president|managing director|general manager|managing partner)\b/i],
  ['head', /\b(head|global head|head of)\b/i],
  ['director', /\bdirector\b/i],
  ['manager', /\b(manager|team lead|supervisor)\b|\blead$/i],
  ['junior', /\b(intern|trainee|apprentice|graduate|junior|jr\.?|assistant|coordinator)\b/i],
  ['senior', /\b(senior|sr\.?|principal|staff|lead(?!\s+gen)|expert|partner)\b/i],
];

export function classifySeniority(title: string): Seniority {
  const t = title.trim();
  if (!t) return 'individual';
  // "Vice President" must win over "President"; the order above handles it (vp before c_level).
  for (const [level, re] of SENIORITY_RULES) if (re.test(t)) return level;
  return 'individual';
}

// ── Department ──────────────────────────────────────────────────────────────

export const DEPARTMENT_LABELS = {
  sales: 'Sales',
  marketing: 'Marketing',
  product: 'Product',
  engineering: 'Engineering',
  design: 'Design',
  data: 'Data & Analytics',
  operations: 'Operations',
  finance: 'Finance',
  hr: 'People & HR',
  it: 'IT & Security',
  customer_success: 'Customer Success',
  legal: 'Legal & Compliance',
  executive: 'Executive / General management',
  other: 'Other',
} as const;
export type Department = keyof typeof DEPARTMENT_LABELS;

const DEPARTMENT_RULES: Array<[Exclude<Department, 'executive' | 'other'>, RegExp]> = [
  ['marketing', /\b(marketing|growth|brand|demand gen(?:eration)?|content|seo|sem|communications?|comms|pr|social media|community|campaigns?|cmo|digital|lifecycle|crm|events?|partnerships? marketing)\b/i],
  ['sales', /\b(sales|account executives?|ae|business development|bizdev|bdr|sdr|revenue|cro|partnerships?|channel|commercial|inside sales|go[- ]to[- ]market|gtm|new business|enterprise accounts?)\b/i],
  ['customer_success', /\b(customer success|customer support|customer experience|client success|client services?|support|cx|account management|implementation|onboarding|service desk)\b/i],
  ['product', /\b(product|cpo|pm)\b/i],
  ['engineering', /\b(engineers?|engineering|developers?|software|devops|sre|architect|cto|technical|programmer|full[- ]?stack|back[- ]?end|front[- ]?end|qa|technology)\b/i],
  ['design', /\b(design|designer|ux|ui|creative|art director)\b/i],
  ['data', /\b(data|analytics|analyst|business intelligence|bi|machine learning|ml|scientist|ai)\b/i],
  ['finance', /\b(finance|financial|cfo|accounting|accountant|controller|treasury|fp&a|audit|billing|payroll|procurement)\b/i],
  ['hr', /\b(hr|human resources|people|talent|recruit(?:er|ing|ment)?|culture|learning|l&d|chro|workforce)\b/i],
  ['it', /\b(it|information technology|cio|sysadmin|infrastructure|security|ciso|cyber|network|helpdesk|systems)\b/i],
  ['legal', /\b(legal|counsel|compliance|attorney|lawyer|gc|clo|regulatory|privacy|risk)\b/i],
  ['operations', /\b(operations?|ops|supply chain|logistics|coo|facilities|program manager|project manager|business operations|chief of staff|strategy)\b/i],
];

// Compound phrases whose head noun decides the function ("Product Marketing Manager" is marketing).
const DEPARTMENT_OVERRIDES: Array<[RegExp, Department]> = [
  [/\bproduct (marketing|marketer)\b/i, 'marketing'],
  [/\bproduct (design|designer)\b/i, 'design'],
  [/\bproduct (analytics|analyst|data)\b/i, 'data'],
  [/\bgrowth product\b/i, 'product'],
  [/\bcustomer marketing\b/i, 'marketing'],
  [/\b(sales|solutions?|pre-?sales|field|technical sales|revenue) (engineer|engineering|architect|consultant)/i, 'sales'],
  [/\bdata (engineer|engineering|platform)\b/i, 'data'],
];

/** Overrides first, then the department whose keyword appears earliest ("VP Sales & Marketing" → sales). */
export function classifyDepartment(title: string, seniority: Seniority): Department {
  const t = title.trim();
  if (!t) return 'other';
  for (const [re, dept] of DEPARTMENT_OVERRIDES) if (re.test(t)) return dept;
  let best: { dept: Department; index: number } | null = null;
  for (const [dept, re] of DEPARTMENT_RULES) {
    const m = re.exec(t);
    if (m && (best === null || m.index < best.index)) best = { dept, index: m.index };
  }
  if (best) return best.dept;
  if (seniority === 'owner' || seniority === 'c_level') return 'executive';
  return 'other';
}

// ── Names & companies ───────────────────────────────────────────────────────

const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'dos', 'das', 'du', 'la', 'le', 'bin', 'ibn', 'al', 'el', 'ter', 'ten']);
const HONORIFICS = /^(?:dr|mr|mrs|ms|miss|mx|prof|professor|sir|dame|rev|hon)\.?\s+/i;
const CREDENTIALS = /,?\s+\(?(?:ph\.?d|mba|cpa|cfa|pmp|md|dds|esq|jr|sr|ii|iii|iv|cissp|csm|msc|bsc|bba|ma|ba|phr|shrm-?[a-z]*|pe)\)?\.?$/i;
const PRONOUNS = /\s*\((?:he|she|they|him|her|them|xe|ze)\/[a-z/]+\)\s*/gi;
// emoji & pictographs; keep letters/marks/numbers/space/basic punctuation
const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;

function isMonocase(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, '');
  return letters.length > 1 && (letters === letters.toUpperCase() || letters === letters.toLowerCase());
}

/** Title-case a name, respecting particles and Mc/O' prefixes. Mixed-case names are left alone. */
export function nameCase(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!isMonocase(s)) return s;
  return s
    .toLowerCase()
    .split(' ')
    .map((word, i) =>
      word
        .split('-')
        .map((part, j) => {
          if (i > 0 && j === 0 && PARTICLES.has(part)) return part;
          let w = part.charAt(0).toUpperCase() + part.slice(1);
          w = w.replace(/^(Mc)(\p{L})/u, (_m, a: string, b: string) => a + b.toUpperCase());
          w = w.replace(/^([OD])(['’])(\p{L})/u, (_m, a: string, q: string, b: string) => a + q + b.toUpperCase());
          return w;
        })
        .join('-'),
    )
    .join(' ');
}

export function cleanPersonName(raw: string): string {
  let s = raw.replace(EMOJI, '').replace(PRONOUNS, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(HONORIFICS, '');
  // strip trailing credentials, repeatedly ("Jane Doe, MBA, PMP")
  for (let i = 0; i < 3; i++) {
    const next = s.replace(CREDENTIALS, '').trim();
    if (next === s) break;
    s = next;
  }
  return nameCase(s.replace(/[,;]+$/, ''));
}

const COMPANY_SUFFIX =
  /[\s,]+(?:inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|ag|s\.?a|sas|sarl|bv|b\.v|nv|oy|ab|as|plc|llp|lp|pty(?:\s+ltd)?|pvt(?:\s+ltd)?|srl|spa|kk)\.?$/i;

/** "Acme, Inc." → "Acme". Returns the input when stripping would leave nothing. */
export function shortCompany(raw: string): string {
  let s = raw.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) {
    const next = s.replace(COMPANY_SUFFIX, '').replace(/[,\s]+$/, '').trim();
    if (!next || next === s) break;
    s = next;
  }
  return s || raw.trim();
}

/** "Doe, Jane" → ["Jane", "Doe"]; "Jane Q. Doe" → ["Jane", "Q. Doe"]. */
export function splitFullName(full: string): [string, string] {
  const s = cleanPersonName(full);
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((p) => p.trim());
    if (first) return [first.split(' ')[0] ?? '', last ?? ''];
  }
  const parts = s.split(' ').filter(Boolean);
  if (parts.length <= 1) return [parts[0] ?? '', ''];
  return [parts[0], parts.slice(1).join(' ')];
}

export function domainOf(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return '';
  const at = v.includes('@') && !v.includes('/') ? v.split('@').pop()! : v;
  const m = at.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]*@)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/);
  return m?.[1] ?? '';
}

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'live.com', 'msn.com', 'gmx.com']);

// ── Putting it together ─────────────────────────────────────────────────────

export interface ProspectFields {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  company?: string | null;
  job_title?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  [k: string]: unknown;
}

/**
 * Build the flat context used by tokens and rules: the prospect's own fields (cleaned),
 * plus everything derived from them. Own values always win over derived ones.
 */
export function buildContext(input: ProspectFields, opts: { cleanNames?: boolean } = {}): Ctx {
  const clean = opts.cleanNames !== false;
  const ctx: Ctx = {};
  for (const [k, v] of Object.entries(input)) {
    const s = toStr(v);
    if (s !== '') ctx[k] = s;
  }

  let first = toStr(input.first_name);
  let last = toStr(input.last_name);
  const full = toStr(input.full_name);
  if (!first && full) [first, last] = splitFullName(full);
  if (clean) {
    first = first && cleanPersonName(first);
    last = last && cleanPersonName(last);
  }
  if (first) ctx.first_name = first;
  else delete ctx.first_name;
  if (last) ctx.last_name = last;
  else delete ctx.last_name;
  const fullName = [first, last].filter(Boolean).join(' ') || (clean && full ? cleanPersonName(full) : full);
  if (fullName) ctx.full_name = fullName;

  // Derived values never overwrite what the CRM / Clay explicitly sent.
  const derive = (key: string, value: string) => {
    if (value && ctx[key] === undefined) ctx[key] = value;
  };

  const company = toStr(input.company);
  if (company) {
    derive('company', company);
    derive('company_short', shortCompany(company));
  }

  const title = toStr(input.job_title);
  if (title) {
    const seniority = classifySeniority(title);
    const department = classifyDepartment(title, seniority);
    derive('seniority', seniority);
    derive('seniority_label', SENIORITY_LABELS[seniority]);
    derive('seniority_group', SENIORITY_GROUPS[seniority]);
    derive('department', department);
    derive('department_label', DEPARTMENT_LABELS[department]);
  }

  const email = toStr(input.email).toLowerCase();
  const web = domainOf(toStr(input.website));
  const mailDomain = domainOf(email);
  derive('domain', web || (mailDomain && !FREE_MAIL.has(mailDomain) ? mailDomain : ''));
  if (email) ctx.email = email;
  return ctx;
}
