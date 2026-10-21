import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  dataDir: string;
  /** Dashboard + API origin. */
  appUrl: string;
  /** Origin used for the personalised links sent to prospects. */
  publicUrl: string;
  secret: Buffer;
  /** Number of reverse proxies in front of the app (0 = none). Used to read the client IP safely. */
  trustProxy: number;
  cookieSecure: boolean;
  /** Let outbound fetches reach private addresses. Tests and local development only. */
  allowPrivateFetch: boolean;
  maxUploadBytes: number;
  anthropicApiKey?: string;
  aiModelSmart: string;
  aiModelFast: string;
  adminEmail?: string;
  adminPassword?: string;
  /** Directory containing the built dashboard (Vite output). */
  webDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

type Env = Record<string, string | undefined>;

const bool = (v: string | undefined, fallback = false) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

function proxyHops(v: string | undefined): number {
  if (!v || ['0', 'false', 'no', 'off'].includes(v.toLowerCase())) return 0;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

const stripSlash = (u: string) => u.replace(/\/+$/, '');

export function loadConfig(env: Env = process.env): Config {
  const nodeEnv = (env.NODE_ENV as Config['env']) || 'development';
  const port = Number(env.PORT || 3000);
  const dataDir = path.resolve(env.DATA_DIR || './.data');
  fs.mkdirSync(dataDir, { recursive: true });

  const appUrl = stripSlash(env.APP_URL || `http://localhost:${port}`);
  const publicUrl = stripSlash(env.PUBLIC_URL || appUrl);

  return {
    env: nodeEnv,
    port,
    host: env.HOST || '0.0.0.0',
    dataDir,
    appUrl,
    publicUrl,
    secret: loadSecret(env.APP_SECRET, dataDir),
    trustProxy: proxyHops(env.TRUST_PROXY),
    cookieSecure: bool(env.COOKIE_SECURE, appUrl.startsWith('https://')),
    allowPrivateFetch: bool(env.ALLOW_PRIVATE_FETCH),
    maxUploadBytes: Math.max(1, Number(env.MAX_UPLOAD_MB || 25)) * 1024 * 1024,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    aiModelSmart: env.AI_MODEL_SMART || 'claude-sonnet-5-5',
    aiModelFast: env.AI_MODEL_FAST || 'claude-haiku-5-5',
    adminEmail: env.ADMIN_EMAIL || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    webDir: path.resolve(env.WEB_DIR || 'web/dist'),
    logLevel: (env.LOG_LEVEL as Config['logLevel']) || 'info',
  };
}

/** APP_SECRET if provided, otherwise a random key persisted next to the database. */
function loadSecret(fromEnv: string | undefined, dataDir: string): Buffer {
  if (fromEnv) {
    if (fromEnv.length < 16) throw new Error('APP_SECRET must be at least 16 characters');
    return Buffer.from(fromEnv, 'utf8');
  }
  const file = path.join(dataDir, 'secret.key');
  try {
    return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64url');
  } catch {
    const key = randomBytes(48);
    fs.writeFileSync(file, key.toString('base64url'), { mode: 0o600 });
    return key;
  }
}
