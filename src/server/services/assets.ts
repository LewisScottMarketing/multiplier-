import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { AppContext } from '../context';
import { badRequest, notFound } from '../lib/errors';
import { newId } from '../lib/ids';

export interface AssetRow {
  id: string;
  kind: 'pdf' | 'image';
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  storage_key: string;
  meta: string;
  campaign_id: string | null;
  created_at: number;
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DIM = 2400;

function sniff(buf: Buffer): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/**
 * Accepts PNG/JPEG/GIF/WebP only (no SVG: it can carry script). The image is decoded and re-encoded,
 * which strips EXIF/GPS data, flattens polyglot files, and caps the pixel size.
 */
export async function storeImage(app: AppContext, input: { data: Buffer; filename: string; campaignId?: string | null }): Promise<AssetRow> {
  if (input.data.length > MAX_IMAGE_BYTES) throw badRequest('Images can be up to 8 MB.');
  const kind = sniff(input.data);
  if (!kind) throw badRequest('Upload a PNG, JPEG, GIF or WebP image.');
  let img;
  try {
    img = await loadImage(input.data);
  } catch {
    throw badRequest('That image could not be read.');
  }
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const g = canvas.getContext('2d');
  if (kind === 'jpeg') {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
  }
  g.drawImage(img, 0, 0, w, h);
  const mime = kind === 'jpeg' ? 'image/jpeg' : 'image/png';
  const out = kind === 'jpeg' ? canvas.toBuffer('image/jpeg', 90) : canvas.toBuffer('image/png');

  const id = newId('ast');
  const key = `assets/${id}.${kind === 'jpeg' ? 'jpg' : 'png'}`;
  await app.storage.put(key, out);
  app.db.run(
    'INSERT INTO assets (id, kind, filename, mime, size, sha256, storage_key, meta, campaign_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    'image',
    input.filename.slice(0, 200),
    mime,
    out.length,
    createHash('sha256').update(out).digest('hex'),
    key,
    JSON.stringify({ width: w, height: h }),
    input.campaignId ?? null,
    Date.now(),
  );
  return getAsset(app, id)!;
}

export const getAsset = (app: AppContext, id: string): AssetRow | null => app.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', id) ?? null;

export function requireAsset(app: AppContext, id: string): AssetRow {
  const a = getAsset(app, id);
  if (!a) throw notFound('Asset');
  return a;
}

export const listAssets = (app: AppContext, kind: 'image' | 'pdf', campaignId?: string) =>
  app.db.all<AssetRow>(
    `SELECT * FROM assets WHERE kind = ? ${campaignId ? 'AND (campaign_id = ? OR campaign_id IS NULL)' : ''} ORDER BY created_at DESC LIMIT 200`,
    ...(campaignId ? [kind, campaignId] : [kind]),
  );
