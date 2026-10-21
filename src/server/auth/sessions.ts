import type { AppContext } from '../context';
import { randomToken, sha256Hex } from '../lib/crypto';
import type { User } from './users';

export const SESSION_COOKIE = 'mpl_session';
const SESSION_TTL_MS = 30 * 24 * 3600_000;
const REFRESH_AFTER_MS = 3600_000;

export function createSession(ctx: AppContext, userId: string, meta: { ip?: string; ua?: string }): { token: string; expiresAt: number } {
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  ctx.db.run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    sha256Hex(token),
    userId,
    now,
    expiresAt,
    now,
    meta.ip ?? null,
    meta.ua?.slice(0, 300) ?? null,
  );
  return { token, expiresAt };
}

export function getSessionUser(ctx: AppContext, token: string | undefined): User | null {
  if (!token) return null;
  const id = sha256Hex(token);
  const row = ctx.db.get<User & { expires_at: number; last_seen_at: number }>(
    `SELECT u.id, u.email, u.name, u.role, u.created_at, s.expires_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    id,
  );
  const now = Date.now();
  if (!row) return null;
  if (row.expires_at < now) {
    ctx.db.run('DELETE FROM sessions WHERE id = ?', id);
    return null;
  }
  if (now - row.last_seen_at > REFRESH_AFTER_MS) {
    ctx.db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', now, now + SESSION_TTL_MS, id);
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role, created_at: row.created_at };
}

export function destroySession(ctx: AppContext, token: string | undefined): void {
  if (token) ctx.db.run('DELETE FROM sessions WHERE id = ?', sha256Hex(token));
}

export function destroyOtherSessions(ctx: AppContext, userId: string, keepToken: string | undefined): void {
  ctx.db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', userId, keepToken ? sha256Hex(keepToken) : '');
}

export function purgeExpiredSessions(ctx: AppContext): void {
  ctx.db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
}
