import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Context } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.pdf': 'application/pdf',
};

export const mimeFor = (file: string) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/** Resolve `rel` inside `root`, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = path.resolve(root, '.' + path.sep + decoded);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

export async function sendFile(c: Context, file: string, opts: { immutable?: boolean; headers?: Record<string, string> } = {}): Promise<Response | null> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  const headers: Record<string, string> = {
    'Content-Type': mimeFor(file),
    ETag: etag,
    'Cache-Control': opts.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...opts.headers,
  };
  if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers });
  headers['Content-Length'] = String(stat.size);
  if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { status: 200, headers });
}
