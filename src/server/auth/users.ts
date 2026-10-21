import type { AppContext } from '../context';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { conflict, HttpError } from '../lib/errors';
import { newId } from '../lib/ids';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: number;
}

interface UserRow extends User {
  password_hash: string;
}

const publicUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, role: r.role, created_at: r.created_at });

export const countUsers = (ctx: AppContext): number => ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;

export async function createUser(
  ctx: AppContext,
  input: { email: string; name?: string; password: string; role?: string },
  opts: { onlyIfEmpty?: boolean } = {},
): Promise<User> {
  const email = input.email.trim().toLowerCase();
  // hash first (slow, async), then check-and-insert atomically so concurrent first-run requests can't both win
  const hash = await hashPassword(input.password);
  const id = newId('usr');
  ctx.db.transaction(() => {
    if (opts.onlyIfEmpty && countUsers(ctx) > 0) throw new HttpError(409, 'already_setup', 'An account already exists. Please sign in.');
    if (ctx.db.get('SELECT 1 FROM users WHERE email = ?', email)) throw conflict('A user with that email already exists');
    ctx.db.run(
      'INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      email,
      input.name?.trim() ?? '',
      hash,
      input.role ?? 'owner',
      Date.now(),
    );
  });
  return publicUser(ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id)!);
}

// Verified against a throwaway hash when the email is unknown so response time doesn't reveal which emails exist.
let dummyHash: Promise<string> | null = null;

export async function authenticate(ctx: AppContext, email: string, password: string): Promise<User | null> {
  const row = ctx.db.get<UserRow>('SELECT * FROM users WHERE email = ?', email.trim().toLowerCase());
  if (!row) {
    dummyHash ??= hashPassword('not-a-real-password');
    await verifyPassword(password, await dummyHash);
    return null;
  }
  if (!(await verifyPassword(password, row.password_hash))) return null;
  ctx.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', Date.now(), row.id);
  return publicUser(row);
}

export async function changePassword(ctx: AppContext, userId: string, current: string, next: string): Promise<boolean> {
  const row = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', userId);
  if (!row || !(await verifyPassword(current, row.password_hash))) return false;
  ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), userId);
  return true;
}
