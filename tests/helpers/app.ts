import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import { closeContext, createContext, type AppContext } from '../../src/server/context';

export interface TestApp {
  ctx: AppContext;
  app: ReturnType<typeof createApp>;
  dir: string;
  /** Call the app. Cookies from `login()` are sent automatically. */
  req: (method: string, url: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>;
  /** Parsed JSON convenience wrapper. */
  json: <T = any>(
    method: string,
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; body: T; res: Response }>;
  /** Creates the owner account (first run) and keeps the session cookie. */
  login: () => Promise<void>;
  cookie: string;
  close: () => Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpl-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dir,
    APP_SECRET: 'test-secret-test-secret-test-secret',
    APP_URL: 'http://app.test',
    PUBLIC_URL: 'http://go.test',
    LOG_LEVEL: 'error',
    WEB_DIR: path.join(dir, 'web'),
    ...env,
  });
  const ctx = createContext(config, { dbFile: ':memory:', quiet: true });
  const app = createApp(ctx);
  const t: TestApp = {
    ctx,
    app,
    dir,
    cookie: '',
    async req(method, url, body, headers = {}) {
      const init: RequestInit = { method, headers: { host: 'app.test', ...(t.cookie ? { cookie: t.cookie } : {}), ...headers } };
      if (body !== undefined) {
        if (body instanceof FormData) init.body = body;
        else {
          init.body = JSON.stringify(body);
          (init.headers as Record<string, string>)['content-type'] ??= 'application/json';
        }
      }
      return app.request(`http://app.test${url}`, init);
    },
    async json(method, url, body, headers) {
      const res = await t.req(method, url, body, headers);
      const text = await res.text();
      let parsed: any = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* leave as text */
      }
      return { status: res.status, body: parsed, res };
    },
    async login() {
      const res = await app.request('http://app.test/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'app.test' },
        body: JSON.stringify({ email: 'owner@example.com', name: 'Owner', password: 'correct horse battery' }),
      });
      if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${await res.text()}`);
      t.cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    },
    async close() {
      await Promise.allSettled([...ctx.background]);
      closeContext(ctx);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return t;
}
