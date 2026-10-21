/**
 * The merge fields available in every campaign. Custom fields sent by Clay show up in the
 * dashboard automatically; these are the ones that always exist.
 */
export interface FieldInfo {
  key: string;
  label: string;
  example: string;
  group: 'person' | 'company' | 'segment' | 'links';
  hint?: string;
}

export const STANDARD_FIELDS: FieldInfo[] = [
  { key: 'first_name', label: 'First name', example: 'Jane', group: 'person' },
  { key: 'last_name', label: 'Last name', example: 'Doe', group: 'person' },
  { key: 'full_name', label: 'Full name', example: 'Jane Doe', group: 'person' },
  { key: 'email', label: 'Email', example: 'jane@acme.com', group: 'person' },
  { key: 'job_title', label: 'Job title', example: 'VP of Marketing', group: 'person' },
  { key: 'company', label: 'Company', example: 'Acme, Inc.', group: 'company' },
  { key: 'company_short', label: 'Company (short)', example: 'Acme', group: 'company', hint: 'Legal suffixes like Inc. / Ltd removed' },
  { key: 'domain', label: 'Company domain', example: 'acme.com', group: 'company' },
  { key: 'website', label: 'Website', example: 'https://acme.com', group: 'company' },
  { key: 'logo_url', label: 'Company logo URL', example: 'https://logo.acme.com/acme.png', group: 'company' },
  { key: 'linkedin_url', label: 'LinkedIn URL', example: 'https://linkedin.com/in/janedoe', group: 'person' },
  {
    key: 'seniority',
    label: 'Seniority',
    example: 'vp',
    group: 'segment',
    hint: 'owner, c_level, vp, head, director, manager, senior, individual, junior',
  },
  { key: 'seniority_group', label: 'Seniority group', example: 'executive', group: 'segment', hint: 'executive, leader or practitioner' },
  {
    key: 'department',
    label: 'Department',
    example: 'marketing',
    group: 'segment',
    hint: 'sales, marketing, product, engineering, design, data, operations, finance, hr, it, customer_success, legal, executive, other',
  },
  { key: 'department_label', label: 'Department (name)', example: 'Marketing', group: 'segment' },
  { key: 'page_url', label: 'Personalised page URL', example: 'https://go.example.com/p/k3x9Qm2aWdPz', group: 'links' },
  { key: 'pdf_url', label: 'Personalised PDF URL', example: 'https://go.example.com/p/k3x9Qm2aWdPz.pdf', group: 'links' },
  { key: 'today', label: 'Today’s date', example: '21 October 2026', group: 'links' },
];

export const FIELD_GROUPS: Record<FieldInfo['group'], string> = {
  person: 'Person',
  company: 'Company',
  segment: 'Segment (derived from job title)',
  links: 'Links & dates',
};

/** Used to preview a page before any real prospect exists, and in screenshots. */
export const SAMPLE_PROSPECTS: Array<Record<string, string>> = [
  {
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane.doe@northwind.com',
    company: 'Northwind Traders, Inc.',
    job_title: 'VP of Marketing',
    website: 'https://northwind.com',
    linkedin_url: 'https://linkedin.com/in/janedoe',
  },
  {
    first_name: 'Marcus',
    last_name: 'Okafor',
    email: 'marcus@globex.io',
    company: 'Globex Corporation',
    job_title: 'Head of Sales Development',
    website: 'https://globex.io',
  },
  {
    first_name: 'Łukasz',
    last_name: 'Nowak',
    email: 'lukasz@initech.pl',
    company: 'Initech GmbH',
    job_title: 'Chief Technology Officer',
    website: 'https://initech.pl',
  },
];
