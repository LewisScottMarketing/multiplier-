import http from 'node:http';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { buildContext, cleanPersonName, domainOf, shortCompany, splitFullName } from '../../src/shared/derive';
import { evalRule } from '../../src/shared/conditions';
import { renderTemplate, safeUrl } from '../../src/shared/template';
import { MAX_IMAGE_PIXELS, probeImage, withinPixelBudget } from '../../src/server/lib/image-probe';
import { RateLimiter } from '../../src/server/lib/ratelimit';
import { silentLogger } from '../../src/server/lib/log';
import { isBlockedAddress, safeRequest } from '../../src/server/lib/safe-fetch';
import { forgetSlowPatterns, installRegexGuard, slowPatterns } from '../../src/server/lib/safe-regex';
import { renderPageRaster } from '../../src/server/pdf/raster';
import { Semaphore } from '../../src/server/pdf/runtime';
import { slackSafe } from '../../src/server/services/webhooks';

// ── Image headers ───────────────────────────────────────────────────────────

const be32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const be16 = (n: number) => Buffer.from([(n >>> 8) & 255, n & 255]);
const le16 = (n: number) => Buffer.from([n & 255, (n >>> 8) & 255]);
const le24 = (n: number) => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255]);

const png = (w: number, h: number) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), be32(13), Buffer.from('IHDR'), be32(w), be32(h), Buffer.from([8, 6, 0, 0, 0]), Buffer.alloc(8)]);
const jpeg = (w: number, h: number) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]), be16(h), be16(w), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])]);
const gif = (w: number, h: number) => Buffer.concat([Buffer.from('GIF89a'), le16(w), le16(h), Buffer.alloc(8)]);
const webp = (kind: 'VP8X' | 'VP8L' | 'VP8 ', w: number, h: number) => {
  const head = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from(kind), Buffer.alloc(4)]);
  const body =
    kind === 'VP8X'
      ? Buffer.concat([Buffer.alloc(4), le24(w - 1), le24(h - 1)])
      : kind === 'VP8L'
        ? Buffer.concat([Buffer.from([0x2f]), Buffer.from(Uint32Array.of(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)).buffer)])
        : Buffer.concat([Buffer.alloc(3), Buffer.from([0x9d, 0x01, 0x2a]), le16(w), le16(h)]);
  return Buffer.concat([head, body, Buffer.alloc(8)]);
};

describe('reading image sizes from headers', () => {
  it('matches what real encoders write', () => {
    const c = createCanvas(37, 23);
    c.getContext('2d').fillRect(0, 0, 10, 10);
    expect(probeImage(c.toBuffer('image/png'))).toEqual({ format: 'png', width: 37, height: 23 });
    expect(probeImage(c.toBuffer('image/jpeg'))).toEqual({ format: 'jpeg', width: 37, height: 23 });
    expect(probeImage(c.toBuffer('image/webp'))).toMatchObject({ format: 'webp', width: 37, height: 23 });
  });

  it('reads each format’s own header layout', () => {
    expect(probeImage(png(640, 480))).toEqual({ format: 'png', width: 640, height: 480 });
    expect(probeImage(jpeg(1920, 1080))).toEqual({ format: 'jpeg', width: 1920, height: 1080 });
    expect(probeImage(gif(300, 250))).toEqual({ format: 'gif', width: 300, height: 250 });
    expect(probeImage(webp('VP8X', 4000, 3000))).toEqual({ format: 'webp', width: 4000, height: 3000 });
    expect(probeImage(webp('VP8L', 1234, 567))).toEqual({ format: 'webp', width: 1234, height: 567 });
    expect(probeImage(webp('VP8 ', 800, 600))).toEqual({ format: 'webp', width: 800, height: 600 });
  });

  it('sees through a tiny file that claims billions of pixels', () => {
    for (const bomb of [png(60_000, 60_000), jpeg(65_000, 65_000), gif(65_000, 65_000), webp('VP8X', 16_000_000, 16_000_000)]) {
      expect(bomb.length).toBeLessThan(100);
      const p = probeImage(bomb)!;
      expect(p).not.toBeNull();
      expect(withinPixelBudget(p)).toBe(false);
    }
    expect(withinPixelBudget({ format: 'png', width: 6000, height: 6000 })).toBe(true);
    expect(MAX_IMAGE_PIXELS).toBeLessThanOrEqual(50_000_000);
  });

  it('refuses anything that is not a readable PNG, JPEG, GIF or WebP', () => {
    expect(probeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(probeImage(Buffer.from('%PDF-1.7 not an image at all'))).toBeNull();
    expect(probeImage(Buffer.alloc(0))).toBeNull();
    expect(probeImage(png(0, 10))).toBeNull(); // zero-sized
    expect(probeImage(jpeg(10, 10).subarray(0, 12))).toBeNull(); // truncated before the frame header
    expect(probeImage(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0, 0]))).toBeNull(); // image data before any frame header
  });
});

// ── PDF page size ───────────────────────────────────────────────────────────

describe('rendering pages of any size', () => {
  const pdfOf = async (w: number, h: number) => {
    const doc = await PDFDocument.create();
    doc.addPage([w, h]);
    return doc.save();
  };

  it('draws an oversized poster smaller instead of allocating gigabytes', async () => {
    const r = await renderPageRaster(await pdfOf(5000, 5000), 1, 2);
    expect(r.width * r.height).toBeLessThanOrEqual(16_100_000);
    expect(r.scale).toBeLessThan(2);
    expect(r.scale).toBeGreaterThan(0.5);
  }, 30_000);

  it('leaves ordinary pages at the requested scale', async () => {
    const r = await renderPageRaster(await pdfOf(595, 842), 1, 2);
    expect(r.scale).toBe(2);
    expect([r.width, r.height]).toEqual([1190, 1684]);
  });

  it('refuses a page beyond the 200-inch limit PDF itself has', async () => {
    await expect(renderPageRaster(await pdfOf(20_000, 20_000), 1, 1)).rejects.toMatchObject({ status: 422 });
  });
});

// ── Merge fields ────────────────────────────────────────────────────────────

describe('merge fields only read the prospect’s own data', () => {
  it('does not resolve names that exist on every object', () => {
    expect(renderTemplate('[{{constructor}}][{{constructor.name}}][{{tostring}}][{{__proto__}}][{{a.constructor}}]', { a: { b: 1 } })).toBe('[][][][][]');
    expect(renderTemplate('{{constructor|fallback}}', {})).toBe('fallback');
  });

  it('still resolves dotted paths and list lengths', () => {
    expect(renderTemplate('{{a.b}} {{list.length}}', { a: { b: 'x' }, list: [1, 2, 3] })).toBe('x 3');
  });
});

describe('link safety', () => {
  it('rejects anything a browser would treat as another site or a script', () => {
    for (const bad of ['//evil.example', '/\\evil.example', '\\\\evil.example', '\\/evil.example', '/\t/evil.example', 'javascript:alert(1)', 'java\tscript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<b>', 'vbscript:x']) {
      expect(safeUrl(bad), JSON.stringify(bad)).toBe('');
    }
  });

  it('accepts ordinary links', () => {
    expect(safeUrl('https://acme.com/a?b=1')).toBe('https://acme.com/a?b=1');
    expect(safeUrl('/p/abc')).toBe('/p/abc');
    expect(safeUrl('#book')).toBe('#book');
    expect(safeUrl('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeUrl('acme.com/demo')).toBe('https://acme.com/demo');
  });
});

describe('hostile profile data cannot stall the server', () => {
  // values are capped at 2000 characters when they are stored; every pattern must stay fast at that size
  const N = 2000;
  const inputs = [' '.repeat(N) + 'x', 'a' + ','.repeat(N) + 'x', 'a' + ' \u{1F600}'.repeat(N / 2), '('.repeat(N), ' (he/'.repeat(N / 5), 'x.' + 'a'.repeat(N), '@'.repeat(N), 'a@'.repeat(N / 2), 'Acme' + ' inc'.repeat(N / 4), 'Ph.D, '.repeat(N / 6)];

  it('keeps name, company and domain clean-up fast', () => {
    const started = performance.now();
    for (const v of inputs) {
      cleanPersonName(v);
      shortCompany(v);
      splitFullName(v);
      domainOf(v);
      buildContext({ first_name: v, last_name: v, company: v, job_title: v, email: v, website: v });
      renderTemplate('{{x|domain}} {{x|title}} {{x|initials}} {{x|upper}}', { x: v });
    }
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

// ── Network and queues ──────────────────────────────────────────────────────

describe('addresses outbound requests may not reach', () => {
  it('blocks private, loopback, link-local and mapped forms', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', '::7f00:1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', 'fd00::1', 'fe80::1', 'not-an-ip']) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isBlockedAddress(a), a).toBe(false);
  });
});

describe('outbound requests have a hard deadline', () => {
  it('gives up on a server that trickles bytes forever, even though it never goes idle', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      const t = setInterval(() => res.write('x'), 150);
      res.on('close', () => clearInterval(t));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    const started = Date.now();
    await expect(safeRequest(url, { allowPrivate: true, timeoutMs: 400 })).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(3000);
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }, 10_000);
});

describe('the PDF work queue', () => {
  it('runs at most N jobs at once and turns away callers beyond the queue', async () => {
    const gate = new Semaphore(2, 3);
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const job = () =>
      gate.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((r) => release.push(r));
        active--;
      });
    const running = Array.from({ length: 5 }, job); // two running, three waiting
    await vi.waitFor(() => expect(release.length).toBe(2));
    expect(gate.pending).toBe(3);
    await expect(job()).rejects.toMatchObject({ status: 503, code: 'busy' });
    const all = Promise.all(running);
    for (let i = 0; i < 5; i++) {
      await vi.waitFor(() => expect(release.length).toBeGreaterThan(i));
      release[i]();
    }
    await all;
    expect(peak).toBe(2);
    expect(gate.pending).toBe(0);
    await gate.run(async () => undefined); // and it is usable again
  });

  it('frees the slot when a job throws', async () => {
    const gate = new Semaphore(1, 1);
    await expect(gate.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('the rate limiter', () => {
  it('stays bounded when callers invent endless keys', () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 100_500; i++) rl.hit(`k${i}`, 5, 60_000);
    expect(rl.size).toBeLessThanOrEqual(100_000);
    // and an ordinary key still counts up as usual
    const hits = Array.from({ length: 7 }, () => rl.hit('visitor', 5, 60_000).ok);
    expect(hits).toEqual([true, true, true, true, true, false, false]);
    rl.close();
  });
});

describe('Slack messages', () => {
  it('neutralises mentions and links that came from a profile', () => {
    expect(slackSafe('<!channel> <https://evil.example|Reset your password> & more')).toBe('&lt;!channel&gt; &lt;https://evil.example|Reset your password&gt; &amp; more');
    expect(slackSafe(undefined)).toBe('');
    expect(slackSafe('Jane Doe')).toBe('Jane Doe');
  });
});

describe('targeting rules that use a pattern', () => {
  const rule = (pattern: string) => ({ match: 'all' as const, conditions: [{ field: 'job_title', op: 'matches' as const, value: pattern }] });

  it('still match ordinary titles, with or without repetition in the pattern', () => {
    installRegexGuard(silentLogger);
    expect(evalRule(rule('^(vp|vice president)\\b'), { job_title: 'Vice President, Growth' })).toBe(true);
    expect(evalRule(rule('head\\s+of\\s+\\w+'), { job_title: 'Head of Sales' })).toBe(true);
    expect(evalRule(rule('chief|cmo'), { job_title: 'CMO' })).toBe(true);
    expect(evalRule(rule('^engineer'), { job_title: 'Sales' })).toBe(false);
  });

  it('give up on a catastrophic pattern instead of freezing the server', () => {
    const warned: string[] = [];
    installRegexGuard({ ...silentLogger, warn: (_m, f) => warned.push(String(f?.pattern)) });
    forgetSlowPatterns();
    const hostile = { job_title: 'word '.repeat(90) + '!' };
    const started = performance.now();
    expect(evalRule(rule('(\\w+\\s?)+$'), hostile)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
    expect(warned).toEqual(['(\\w+\\s?)+$']);
    expect(slowPatterns()).toEqual(['(\\w+\\s?)+$']);

    // the pattern is then skipped outright
    const again = performance.now();
    expect(evalRule(rule('(\\w+\\s?)+$'), hostile)).toBe(false);
    expect(performance.now() - again).toBeLessThan(20);
    forgetSlowPatterns();
  });
});
