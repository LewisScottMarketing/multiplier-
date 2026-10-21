import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { normKey } from '@shared/template';
import { badRequest } from '../lib/errors';

const ALIASES: Record<string, string[]> = {
  first_name: ['first_name', 'firstname', 'first', 'given_name', 'forename'],
  last_name: ['last_name', 'lastname', 'last', 'surname', 'family_name'],
  full_name: ['full_name', 'fullname', 'name', 'contact_name', 'person_name', 'contact'],
  email: ['email', 'work_email', 'email_address', 'e_mail', 'business_email', 'contact_email'],
  company: ['company', 'company_name', 'organisation', 'organization', 'account', 'account_name', 'employer'],
  job_title: ['job_title', 'title', 'position', 'role', 'jobtitle', 'headline', 'current_title'],
  linkedin_url: ['linkedin_url', 'linkedin', 'linkedin_profile', 'profile_url', 'linkedin_profile_url', 'person_linkedin_url'],
  website: ['website', 'domain', 'company_website', 'company_domain', 'url', 'company_url', 'site'],
  logo_url: ['logo_url', 'logo', 'company_logo', 'company_logo_url'],
  external_id: ['external_id', 'id', 'record_id', 'row_id', 'clay_id'],
};

export interface ParsedCsv {
  headers: string[];
  rows: Array<Record<string, string>>;
  suggested_mapping: Record<string, string>;
}

export const MAX_IMPORT_ROWS = 5000;

export function parseCsv(buf: Buffer): ParsedCsv {
  let records: Array<Record<string, string>>;
  try {
    records = parse(buf, { columns: (h: string[]) => h.map((x) => x.trim()), skip_empty_lines: true, skip_records_with_empty_values: true, bom: true, relax_column_count: true, relax_quotes: true, trim: true, max_record_size: 100_000 });
  } catch (e) {
    throw badRequest(`Couldn’t read that CSV: ${(e as Error).message}`);
  }
  if (records.length === 0) throw badRequest('That CSV has no rows.');
  if (records.length > MAX_IMPORT_ROWS) throw badRequest(`Please import at most ${MAX_IMPORT_ROWS} rows at a time (this file has ${records.length}).`);
  const headers = Object.keys(records[0]).filter(Boolean);
  return { headers, rows: records, suggested_mapping: suggestMapping(headers) };
}

/** header → our field key; unknown columns map to their own normalised name so nothing is lost. */
export function suggestMapping(headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const h of headers) {
    const n = normKey(h);
    const hit = Object.entries(ALIASES).find(([key, names]) => !used.has(key) && names.includes(n));
    if (hit) {
      out[h] = hit[0];
      used.add(hit[0]);
    } else out[h] = n;
  }
  return out;
}

/**
 * Spreadsheet apps execute cells that start with = + - @ (CSV/formula injection). Prospect data is
 * attacker-influenced (it comes from scraped profiles), so neutralise such cells in exports.
 */
export const safeCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return stringify(rows.map((r) => headers.map((h) => safeCell(r[h]))), { header: true, columns: headers });
}
