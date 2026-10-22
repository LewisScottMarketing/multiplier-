/**
 * A table as plain text, one row a line with the cells separated by "|", so it can be typed in a text box or pasted
 * from a spreadsheet (a copied range arrives tab-separated, which is accepted too).
 */
export const MAX_TABLE_ROWS = 40;
export const MAX_TABLE_COLUMNS = 8;

export const tableToText = (rows: string[][]): string => rows.map((row) => row.join(' | ')).join('\n');

export const textToTable = (text: string): string[][] =>
  text
    .split(/\r?\n/)
    .map((line) => line.split(/\s*[|\t]\s*/).map((c) => c.trim()))
    .filter((row) => row.some(Boolean))
    .slice(0, MAX_TABLE_ROWS)
    .map((row) => row.slice(0, MAX_TABLE_COLUMNS));
