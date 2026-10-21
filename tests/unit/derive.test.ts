import { describe, expect, it } from 'vitest';
import {
  buildContext,
  classifyDepartment,
  classifySeniority,
  cleanPersonName,
  domainOf,
  shortCompany,
  splitFullName,
} from '@shared/derive';

describe('classifySeniority', () => {
  const cases: Array<[string, string]> = [
    ['CEO', 'c_level'],
    ['Chief Revenue Officer', 'c_level'],
    ['Co-Founder & CEO', 'owner'],
    ['Founder', 'owner'],
    ['Managing Director', 'c_level'],
    ['President', 'c_level'],
    ['Vice President of Marketing', 'vp'],
    ['SVP, Sales', 'vp'],
    ['VP Engineering', 'vp'],
    ['Head of Growth', 'head'],
    ['Director of Demand Generation', 'director'],
    ['Engineering Manager', 'manager'],
    ['Sales Team Lead', 'manager'],
    ['Senior Software Engineer', 'senior'],
    ['Principal Consultant', 'senior'],
    ['Lead Developer', 'senior'],
    ['Lead Generation Specialist', 'individual'],
    ['Account Executive', 'individual'],
    ['Marketing Intern', 'junior'],
    ['Product Owner', 'individual'],
    ['', 'individual'],
  ];
  it.each(cases)('%s → %s', (title, expected) => {
    expect(classifySeniority(title)).toBe(expected);
  });
});

describe('classifyDepartment', () => {
  const cases: Array<[string, string]> = [
    ['VP of Marketing', 'marketing'],
    ['Head of Growth', 'marketing'],
    ['Chief Revenue Officer', 'sales'],
    ['Sales Development Representative', 'sales'],
    ['Account Executive', 'sales'],
    ['VP Sales and Marketing', 'sales'],
    ['Product Marketing Manager', 'marketing'],
    ['Product Manager', 'product'],
    ['Product Designer', 'design'],
    ['Software Engineer', 'engineering'],
    ['CTO', 'engineering'],
    ['Solutions Engineer', 'sales'],
    ['Data Engineer', 'data'],
    ['Customer Success Manager', 'customer_success'],
    ['Support Engineer', 'customer_success'],
    ['Director of Finance', 'finance'],
    ['CFO', 'finance'],
    ['People Operations Lead', 'hr'],
    ['Talent Acquisition Partner', 'hr'],
    ['IT Manager', 'it'],
    ['General Counsel', 'legal'],
    ['Head of Operations', 'operations'],
    ['Marketing Operations Manager', 'marketing'],
    ['CEO', 'executive'],
    ['Founder', 'executive'],
    ['Barista', 'other'],
  ];
  it.each(cases)('%s → %s', (title, expected) => {
    expect(classifyDepartment(title, classifySeniority(title))).toBe(expected);
  });
});

describe('name & company cleaning', () => {
  it('fixes monocase names but leaves mixed case alone', () => {
    expect(cleanPersonName('JANE DOE')).toBe('Jane Doe');
    expect(cleanPersonName('jane doe')).toBe('Jane Doe');
    expect(cleanPersonName('McDonald')).toBe('McDonald');
    expect(cleanPersonName('DeShawn')).toBe('DeShawn');
    expect(cleanPersonName('MCDONALD')).toBe('McDonald');
    expect(cleanPersonName("o'brien-nuñez")).toBe("O'Brien-Nuñez");
    expect(cleanPersonName('LUDWIG VAN BEETHOVEN')).toBe('Ludwig van Beethoven');
  });
  it('strips honorifics, credentials, pronouns and emoji', () => {
    expect(cleanPersonName('Dr. Jane Doe, PhD')).toBe('Jane Doe');
    expect(cleanPersonName('Jane Doe (she/her) 🚀')).toBe('Jane Doe');
    expect(cleanPersonName('John Smith, MBA, PMP')).toBe('John Smith');
  });
  it('shortens company names', () => {
    expect(shortCompany('Acme, Inc.')).toBe('Acme');
    expect(shortCompany('Globex Corporation')).toBe('Globex');
    expect(shortCompany('Initech GmbH')).toBe('Initech');
    expect(shortCompany('Hooli Pty Ltd')).toBe('Hooli');
    expect(shortCompany('Inc')).toBe('Inc');
    expect(shortCompany('Stripe')).toBe('Stripe');
  });
  it('splits full names, including "Last, First"', () => {
    expect(splitFullName('Jane Doe')).toEqual(['Jane', 'Doe']);
    expect(splitFullName('Doe, Jane')).toEqual(['Jane', 'Doe']);
    expect(splitFullName('Madonna')).toEqual(['Madonna', '']);
    expect(splitFullName('Jane Q. Public')).toEqual(['Jane', 'Q. Public']);
  });
  it('extracts domains', () => {
    expect(domainOf('https://www.acme.com/pricing')).toBe('acme.com');
    expect(domainOf('jane@acme.co.uk')).toBe('acme.co.uk');
    expect(domainOf('acme.com')).toBe('acme.com');
    expect(domainOf('not a domain')).toBe('');
  });
});

describe('buildContext', () => {
  it('derives name parts, seniority, department and company short name', () => {
    const ctx = buildContext({ full_name: 'JANE DOE', company: 'Acme, Inc.', job_title: 'VP of Marketing', email: 'Jane@acme.com' });
    expect(ctx).toMatchObject({
      first_name: 'Jane',
      last_name: 'Doe',
      full_name: 'Jane Doe',
      company: 'Acme, Inc.',
      company_short: 'Acme',
      seniority: 'vp',
      seniority_label: 'VP',
      seniority_group: 'executive',
      department: 'marketing',
      department_label: 'Marketing',
      domain: 'acme.com',
      email: 'jane@acme.com',
    });
  });

  it('never overrides values that were supplied explicitly', () => {
    const ctx = buildContext({ first_name: 'Janey', job_title: 'VP of Marketing', department: 'revops', company_short: 'ACME' });
    expect(ctx.first_name).toBe('Janey');
    expect(ctx.department).toBe('revops');
    expect(ctx.company_short).toBe('ACME');
    expect(ctx.seniority).toBe('vp');
  });

  it('does not use free-mail domains as the company domain', () => {
    expect(buildContext({ email: 'jane@gmail.com' }).domain).toBeUndefined();
    expect(buildContext({ email: 'jane@gmail.com', website: 'acme.com' }).domain).toBe('acme.com');
  });

  it('can leave names untouched', () => {
    expect(buildContext({ first_name: 'JANE' }, { cleanNames: false }).first_name).toBe('JANE');
  });

  it('drops empty values so fallbacks apply', () => {
    const ctx = buildContext({ first_name: '  ', company: '' });
    expect(ctx.first_name).toBeUndefined();
    expect(ctx.company).toBeUndefined();
  });
});
