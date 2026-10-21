import { describe, expect, it } from 'vitest';
import { escapeHtml, extractTokens, hasTokens, normKey, parseTemplate, renderTemplate, renderUrl, safeUrl, titleCase } from '@shared/template';

const ctx = { first_name: 'Jane', company: 'Acme Inc', job_title: 'vp of marketing', empty: '', n: 42, tags: ['a', 'b'] };

describe('renderTemplate', () => {
  it('substitutes tokens and leaves other text alone', () => {
    expect(renderTemplate('Hi {{first_name}}, welcome to {{company}}!', ctx)).toBe('Hi Jane, welcome to Acme Inc!');
  });

  it('renders unknown or empty fields as empty, or the fallback', () => {
    expect(renderTemplate('Hi {{nope}}.', ctx)).toBe('Hi .');
    expect(renderTemplate('Hi {{nope|there}}.', ctx)).toBe('Hi there.');
    expect(renderTemplate('Hi {{empty|there}}.', ctx)).toBe('Hi there.');
    expect(renderTemplate('Hi {{first_name|there}}.', ctx)).toBe('Hi Jane.');
  });

  it('normalises keys so "Company Name" and company_name are the same field', () => {
    expect(normKey(' Company Name ')).toBe('company_name');
    expect(renderTemplate('{{ Company Name }}', { company_name: 'Globex' })).toBe('Globex');
    expect(renderTemplate('{{First-Name}}', { first_name: 'Jo' })).toBe('Jo');
  });

  it('applies filters only when there is a value, chaining left to right', () => {
    expect(renderTemplate('{{company|upper}}', ctx)).toBe('ACME INC');
    expect(renderTemplate('{{job_title|title}}', ctx)).toBe('VP of Marketing'.replace('VP', 'Vp'));
    expect(renderTemplate('{{nope|upper}}', ctx)).toBe('');
    expect(renderTemplate('{{nope|upper|friend}}', ctx)).toBe('friend');
    expect(renderTemplate('{{nope|friend|upper}}', ctx)).toBe('FRIEND');
    expect(renderTemplate('{{first_name|possessive}}', ctx)).toBe('Jane’s');
    expect(renderTemplate('{{company|first_word}}', ctx)).toBe('Acme');
    expect(renderTemplate('{{company|initials}}', ctx)).toBe('AI');
    expect(renderTemplate('{{company|truncate:4}}', ctx)).toBe('Acm…');
    expect(renderTemplate('{{x|domain}}', { x: 'https://www.acme.com/pricing?x=1' })).toBe('acme.com');
    expect(renderTemplate('{{x|possessive}}', { x: 'James' })).toBe('James’');
  });

  it('treats quoted pipe segments as literal fallbacks even if they look like filters', () => {
    expect(renderTemplate('{{nope|"title"}}', ctx)).toBe('title');
    expect(renderTemplate('{{nope|\'upper\'}}', ctx)).toBe('upper');
  });

  it('allows pipes inside quoted fallbacks', () => {
    expect(renderTemplate('{{nope|"a | b"}}', ctx)).toBe('a | b');
  });

  it('coerces numbers and arrays; ignores objects', () => {
    expect(renderTemplate('{{n}} / {{tags}} / {{o}}', { ...ctx, o: { a: 1 } })).toBe('42 / a, b / ');
  });

  it('supports dotted paths into nested data', () => {
    expect(renderTemplate('{{company.name}}', { company: { name: 'Initech' } })).toBe('Initech');
  });

  it('escapes only substituted values, never the template text', () => {
    const out = renderTemplate('<b>{{x}}</b>', { x: '<script>alert(1)</script>' }, { escape: escapeHtml });
    expect(out).toBe('<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>');
  });

  it('does not re-interpret braces coming from data', () => {
    expect(renderTemplate('{{x}}', { x: '{{first_name}}' })).toBe('{{first_name}}');
  });

  it('reports token results so callers can warn about missing data', () => {
    const seen: string[] = [];
    renderTemplate('{{a}} {{b|x}} {{first_name}}', ctx, { onToken: (r) => seen.push(`${r.field}:${r.missing}:${r.usedFallback}`) });
    expect(seen).toEqual(['a:true:false', 'b:true:true', 'first_name:false:false']);
  });

  it('leaves malformed braces as text', () => {
    expect(renderTemplate('{{ }} and {{', ctx)).toBe('{{ }} and {{');
    expect(parseTemplate('no tokens here')).toEqual([{ kind: 'text', value: 'no tokens here' }]);
  });
});

describe('extractTokens / hasTokens', () => {
  it('lists tokens and whether each has a fallback', () => {
    expect(extractTokens('Hi {{first_name|there}}, {{company}}')).toEqual([
      { field: 'first_name', hasFallback: true },
      { field: 'company', hasFallback: false },
    ]);
    expect(hasTokens('plain')).toBe(false);
    expect(hasTokens('{{x}}')).toBe(true);
    expect(hasTokens(undefined)).toBe(false);
  });

  it('does not count filter-only pipes as fallbacks', () => {
    expect(extractTokens('{{company|upper}}')).toEqual([{ field: 'company', hasFallback: false }]);
  });
});

describe('titleCase', () => {
  it('capitalises words but keeps small words lowercase', () => {
    expect(titleCase('HEAD OF GROWTH AND PARTNERSHIPS')).toBe('Head of Growth and Partnerships');
    expect(titleCase('the quick fox')).toBe('The Quick Fox');
    expect(titleCase('co-founder')).toBe('Co-Founder');
  });
});

describe('safeUrl', () => {
  it('allows http(s), mailto, tel and relative anchors', () => {
    expect(safeUrl('https://acme.com/x')).toBe('https://acme.com/x');
    expect(safeUrl('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeUrl('tel:+441234')).toBe('tel:+441234');
    expect(safeUrl('#book')).toBe('#book');
  });
  it('upgrades bare domains to https', () => {
    expect(safeUrl('acme.com/demo')).toBe('https://acme.com/demo');
  });
  it('blocks script-bearing and protocol-relative URLs, including obfuscated ones', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('JaVaScRiPt:alert(1)')).toBe('');
    expect(safeUrl('java\tscript:alert(1)')).toBe('');
    expect(safeUrl(' \u0001javascript:alert(1)')).toBe('');
    expect(safeUrl('data:text/html;base64,AAAA')).toBe('');
    expect(safeUrl('vbscript:x')).toBe('');
    expect(safeUrl('//evil.com')).toBe('');
    expect(safeUrl('')).toBe('');
  });
});

describe('renderUrl', () => {
  it('percent-encodes tokens embedded in a URL', () => {
    expect(renderUrl('https://cal.com/me?name={{full_name}}&email={{email}}', { full_name: 'Jane Doe & Co', email: 'j@acme.com' })).toBe(
      'https://cal.com/me?name=Jane%20Doe%20%26%20Co&email=j%40acme.com',
    );
  });
  it('treats a lone token as a complete URL', () => {
    expect(renderUrl('{{website}}', { website: 'https://acme.com/a?b=c' })).toBe('https://acme.com/a?b=c');
  });
  it('keeps a leading URL token intact when more text follows it', () => {
    expect(renderUrl('{{page_url}}?src=pdf', { page_url: 'https://go.test/p/abc' })).toBe('https://go.test/p/abc?src=pdf');
    expect(renderUrl('{{page_url}}?n={{name}}', { page_url: 'https://go.test/p/abc', name: 'A B' })).toBe('https://go.test/p/abc?n=A%20B');
    // only the FIRST token gets this treatment
    expect(renderUrl('https://x.com/?u={{page_url}}', { page_url: 'https://go.test/p/abc' })).toBe('https://x.com/?u=https%3A%2F%2Fgo.test%2Fp%2Fabc');
  });
  it('refuses a token that resolves to a dangerous scheme', () => {
    expect(renderUrl('{{website}}', { website: 'javascript:alert(1)' })).toBe('');
  });
  it('cannot be tricked into a different scheme by data in the host position', () => {
    expect(renderUrl('https://{{domain}}/x', { domain: 'evil.com/@' })).toBe('https://evil.com%2F%40/x');
  });
});
