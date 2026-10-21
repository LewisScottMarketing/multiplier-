import type { Campaign } from '@shared/schema';
import type { AppContext } from '../context';
import type { Prospect } from './prospects';

export function aiEnabled(ctx: AppContext): boolean {
  return !!ctx.config.anthropicApiKey;
}

/** Placeholder until the AI module lands: keeps call sites stable and never blocks a request. */
export async function generateAiFields(
  _ctx: AppContext,
  _campaign: Campaign,
  prospect: Prospect,
): Promise<{ prospect: Prospect; warnings: Array<{ code: string; message: string }> }> {
  return { prospect, warnings: [] };
}
