import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Outbound HTTP for user-supplied URLs (webhooks, prospect logos). Defends against SSRF:
 *  - only http(s)
 *  - every resolved address is checked against private / loopback / link-local / metadata ranges
 *  - the socket is pinned to the address we validated, so DNS rebinding can't swap it afterwards
 *  - redirects are re-validated hop by hop, response size and time are capped
 */

const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) blocked.addSubnet(net4, prefix, 'ipv4');
for (const [net6, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['64:ff9b::', 96],
  ['2002::', 16],
] as const) blocked.addSubnet(net6, prefix, 'ipv6');

export function isBlockedAddress(addr: string): boolean {
  const mapped = addr.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ip = mapped ? mapped[1] : addr;
  const family = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null;
  return family === null ? true : blocked.check(ip, family);
}

export class FetchBlockedError extends Error {}

export interface SafeRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Skip the private-address check (tests and local development only). */
  allowPrivate?: boolean;
  httpsOnly?: boolean;
}

export interface SafeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  url: string;
}

function pinnedLookup(allowPrivate: boolean): net.LookupFunction {
  return (hostname, options, cb) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err, '', 4);
      if (!addrs.length) return cb(new Error(`No address for ${hostname}`), '', 4);
      if (!allowPrivate && addrs.some((a) => isBlockedAddress(a.address))) {
        return cb(new FetchBlockedError(`Refusing to connect to a private address (${hostname})`), '', 4);
      }
      const first = addrs[0];
      // honour `all: true` callers (autoSelectFamily) as well as the classic single-address form
      if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addrs);
      cb(null, first.address, first.family);
    });
  };
}

function once(url: URL, opts: SafeRequestOptions): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: opts.method ?? 'GET',
        headers: { 'user-agent': 'Multiplier/1.0', accept: '*/*', ...opts.headers },
        lookup: pinnedLookup(!!opts.allowPrivate),
        timeout: opts.timeoutMs ?? 10_000,
      },
      (res) => {
        const max = opts.maxBytes ?? 5 * 1024 * 1024;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > max) {
            req.destroy(new Error(`Response larger than ${max} bytes`));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), url: url.toString() }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

export async function safeRequest(rawUrl: string, opts: SafeRequestOptions = {}): Promise<SafeResponse> {
  let url = new URL(rawUrl);
  const maxRedirects = opts.method && opts.method !== 'GET' ? 0 : (opts.maxRedirects ?? 3);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'https:' && (opts.httpsOnly || url.protocol !== 'http:')) throw new FetchBlockedError('Only https URLs are allowed');
    if (!opts.allowPrivate && net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
      throw new FetchBlockedError('Refusing to connect to a private address');
    }
    const res = await once(url, opts);
    if (res.status >= 300 && res.status < 400 && res.headers.location && hop < maxRedirects) {
      url = new URL(res.headers.location, url);
      continue;
    }
    return res;
  }
}
