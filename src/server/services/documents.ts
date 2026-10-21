import type { Campaign } from '@shared/schema';
import type { Ctx } from '@shared/template';
import type { AppContext } from '../context';
import { notFound } from '../lib/errors';

/** Filled in by the PDF engine. */
export async function personalizedPdf(_app: AppContext, _campaign: Campaign, _ctx: Ctx, _cacheKey: string | null): Promise<{ bytes: Uint8Array; filename: string }> {
  throw notFound('Document');
}

export async function personalizedCover(_app: AppContext, _campaign: Campaign, _ctx: Ctx, _cacheKey: string | null): Promise<Uint8Array> {
  throw notFound('Document');
}
