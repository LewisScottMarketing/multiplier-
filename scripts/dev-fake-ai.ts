/**
 * Runs the server with a scripted stand-in for Claude, so the AI screens (Try it, persona versions,
 * AI fields on live pages) can be tried and screenshotted without an API key or any network.
 *
 *   npm run dev:fake-ai         (same env vars as the normal server)
 *
 * The "model" here just rearranges what it is given. It is for demos and UI work only.
 */
import { serve } from '@hono/node-server';
import { createApp } from '../src/server/app';
import { loadConfig, loadDotEnv } from '../src/server/config';
import { createContext } from '../src/server/context';
import { setAiBackend, type AiBackend, type AiResult } from '../src/server/services/ai';
import { startWebhookWorker } from '../src/server/services/webhooks';

const between = (s: string, tag: string) => s.match(new RegExp(`<${tag}[^>]*>\\n?([\\s\\S]*?)\\n?</${tag}>`))?.[1] ?? '';

const backend: AiBackend = {
  async complete(call): Promise<AiResult> {
    await new Promise((r) => setTimeout(r, 650));
    if (call.label === 'prospect-fields') {
      const facts = JSON.parse(between(call.user, 'prospect_data') || '{}') as Record<string, string>;
      const fields = JSON.parse(between(call.user, 'fields') || '[]') as Array<{ key: string; max_characters: number }>;
      const who = facts.company ? `Teams like ${facts.company}` : 'Teams like yours';
      const role = facts.job_title ? `, and ${facts.job_title.toLowerCase()}s especially,` : '';
      const out: Record<string, string> = {};
      for (const f of fields)
        out[f.key] = `${who}${role} tend to get the most from starting with the message, not the list.`.slice(0, f.max_characters);
      return { ok: true, data: out };
    }
    if (call.label === 'persona-variant') {
      const label = between(call.user, 'audience').split(':')[0]!.trim().toLowerCase();
      const leaves = JSON.parse(between(call.user, 'block') || '{}') as Record<string, { text: string; max_characters: number }>;
      const out: Record<string, string> = {};
      for (const [id, leaf] of Object.entries(leaves)) {
        const t = leaf.text;
        const next =
          t.length < 90
            ? `${t.replace(/[.:!?]+$/, '')}, the ${label} way`
            : `${t.replace(/\s+$/, '')} For ${label}, the first result is usually visible inside a week.`;
        out[id] = next.slice(0, leaf.max_characters);
      }
      return { ok: true, data: out };
    }
    const blank = Object.fromEntries(Object.keys((call.schema as { properties: object }).properties).map((k) => [k, '']));
    return { ok: true, data: blank };
  },
};

loadDotEnv();
const config = loadConfig();
const ctx = createContext(config);
setAiBackend(ctx, backend);
const app = createApp(ctx);
startWebhookWorker(ctx);
serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) =>
  ctx.log.info(`Multiplier (fake AI) on http://localhost:${info.port}`),
);
