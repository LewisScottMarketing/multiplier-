import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type Param = string | number | bigint | null | Uint8Array | boolean | undefined;

/**
 * Thin wrapper over node:sqlite. Adds statement caching, undefined/boolean binding,
 * typed rows and nestable transactions. Everything is synchronous by design: SQLite
 * calls are microseconds and a single writer avoids lock juggling.
 */
export class Db {
  readonly raw: DatabaseSync;
  private stmts = new Map<string, StatementSync>();
  private depth = 0;

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA synchronous = NORMAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
  }

  private prepare(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      if (this.stmts.size > 500) this.stmts.clear();
      this.stmts.set(sql, s);
    }
    return s;
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
    const r = this.prepare(sql).run(...bind(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
    return this.prepare(sql).get(...bind(params)) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
    return this.prepare(sql).all(...bind(params)) as T[];
  }

  /** Runs `fn` atomically. Nested calls become savepoints. */
  transaction<T>(fn: () => T): T {
    const name = `sp_${this.depth}`;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const out = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
      return out;
    } catch (err) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
      throw err;
    }
  }

  close() {
    this.stmts.clear();
    this.raw.close();
  }
}

function bind(params: Param[]): Array<string | number | bigint | null | Uint8Array> {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Escapes % and _ so user input can be used inside a LIKE pattern. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
