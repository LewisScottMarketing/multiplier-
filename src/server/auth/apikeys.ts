import type { AppContext } from '../context';
import { sha256Hex } from '../lib/crypto';
import { newId, randomString } from '../lib/ids';

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  campaign_id: string | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const KEY_PREFIX = 'mpl_live_';

/** Returns the plaintext key exactly once; only its SHA-256 is stored. */
export function createApiKey(ctx: AppContext, input: { name: string; campaignId?: string | null }): { key: string; info: ApiKeyInfo } {
  const secret = randomString(40, ALPHABET);
  const key = `${KEY_PREFIX}${secret}`;
  const id = newId('key');
  ctx.db.run(
    'INSERT INTO api_keys (id, name, key_hash, prefix, last4, campaign_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    input.name.trim() || 'API key',
    sha256Hex(key),
    key.slice(0, KEY_PREFIX.length + 4),
    key.slice(-4),
    input.campaignId ?? null,
    Date.now(),
  );
  return { key, info: getApiKey(ctx, id)! };
}

const COLS = 'id, name, prefix, last4, campaign_id, created_at, last_used_at, revoked_at';

export const getApiKey = (ctx: AppContext, id: string) => ctx.db.get<ApiKeyInfo>(`SELECT ${COLS} FROM api_keys WHERE id = ?`, id);

export const listApiKeys = (ctx: AppContext) => ctx.db.all<ApiKeyInfo>(`SELECT ${COLS} FROM api_keys ORDER BY created_at DESC`);

export function verifyApiKey(ctx: AppContext, presented: string): ApiKeyInfo | null {
  if (!presented.startsWith(KEY_PREFIX)) return null;
  const row = ctx.db.get<ApiKeyInfo>(`SELECT ${COLS} FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL`, sha256Hex(presented));
  if (!row) return null;
  // avoid a write on every request: touch at most once a minute
  const now = Date.now();
  if (!row.last_used_at || now - row.last_used_at > 60_000) ctx.db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', now, row.id);
  return row;
}

export const revokeApiKey = (ctx: AppContext, id: string): boolean =>
  ctx.db.run('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', Date.now(), id).changes > 0;
