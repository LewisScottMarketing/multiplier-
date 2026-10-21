import { parseJson } from '../db/database';
import type { AppContext } from '../context';

export interface WorkspaceSettings {
  name: string;
  /** Hostnames that are allowed to serve personalised pages (custom domains). */
  domains: string[];
  /** Sender identity used as the default for "personal note" blocks. */
  sender: { name: string; role: string; avatar: string };
  /** Trusted snippets (analytics, pixels) injected into every public page. */
  scripts: { head: string; body_end: string };
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  name: 'My workspace',
  domains: [],
  sender: { name: '', role: '', avatar: '' },
  scripts: { head: '', body_end: '' },
};

export function getSetting<T>(ctx: AppContext, key: string, fallback: T): T {
  const row = ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? parseJson<T>(row.value, fallback) : fallback;
}

export function setSetting(ctx: AppContext, key: string, value: unknown): void {
  ctx.db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value),
    Date.now(),
  );
}

export function getWorkspace(ctx: AppContext): WorkspaceSettings {
  const stored = getSetting<Partial<WorkspaceSettings>>(ctx, 'workspace', {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    sender: { ...DEFAULT_SETTINGS.sender, ...stored.sender },
    scripts: { ...DEFAULT_SETTINGS.scripts, ...stored.scripts },
  };
}

export function saveWorkspace(ctx: AppContext, next: WorkspaceSettings): void {
  setSetting(ctx, 'workspace', next);
}
