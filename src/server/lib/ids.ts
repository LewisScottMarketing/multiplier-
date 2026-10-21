import { randomInt } from 'node:crypto';

// No look-alike characters (0/O, 1/l/I) so tokens survive being read aloud or retyped.
const TOKEN_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Uniformly random string. `randomInt` uses rejection sampling, so there is no modulo bias. */
export function randomString(length: number, alphabet: string): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export type IdPrefix = 'usr' | 'cmp' | 'prs' | 'ast' | 'key' | 'whk' | 'sub' | 'dlv' | 'pvw';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomString(16, ID_ALPHABET)}`;
}

/** Public, unguessable token used in personalised URLs (54^12 ≈ 2^69 possibilities). */
export function newToken(): string {
  return randomString(12, TOKEN_ALPHABET);
}

export function newBlockId(): string {
  return `b_${randomString(8, ID_ALPHABET)}`;
}
