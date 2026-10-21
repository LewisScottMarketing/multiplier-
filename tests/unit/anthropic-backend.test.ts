import { describe, expect, it } from 'vitest';
import { AnthropicBackend, type AiCall } from '../../src/server/services/ai';

type Seen = { url: string; headers: Headers; body: Record<string, any> };

/** A stand-in for the network: records each request and answers with whatever the test says. */
function network(reply: { status?: number; body: unknown }) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { seen, fetchImpl };
}

const message = (content: unknown[], stop_reason = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
});
const apiError = (status: number, type: string, text: string) => ({
  status,
  body: { type: 'error', error: { type, message: text }, request_id: 'req_1' },
});

const call = (model = 'claude-haiku-5-5'): AiCall & { model: string; timeoutMs: number } => ({
  tier: 'fast',
  label: 'test',
  system: 'sys',
  user: 'hello',
  schema: { type: 'object', properties: { opening: { type: 'string' } }, required: ['opening'], additionalProperties: false },
  maxTokens: 2000,
  effort: 'low',
  model,
  timeoutMs: 5000,
});

describe('talking to Claude', () => {
  it('sends the key, and names a workspace only when one is configured', async () => {
    const plain = network({ body: message([{ type: 'text', text: '{"opening":"Hi"}' }]) });
    await new AnthropicBackend('sk-ant-test', { fetch: plain.fetchImpl }).complete(call());
    expect(plain.seen[0].url).toContain('/v1/messages');
    expect(plain.seen[0].headers.get('x-api-key')).toBe('sk-ant-test');
    expect(plain.seen[0].headers.get('anthropic-workspace-id')).toBeNull();

    const scoped = network({ body: message([{ type: 'text', text: '{"opening":"Hi"}' }]) });
    await new AnthropicBackend('sk-ant-test', { workspaceId: 'wrkspc_abc', fetch: scoped.fetchImpl }).complete(call());
    expect(scoped.seen[0].headers.get('anthropic-workspace-id')).toBe('wrkspc_abc');
  });

  it('asks for structured output, and for effort only where the model supports it', async () => {
    for (const [model, effort] of [
      ['claude-haiku-5-5', 'low'],
      ['claude-opus-5-5', 'low'],
      ['claude-sonnet-5-5', 'low'],
      ['claude-haiku-4-5', undefined],
      ['claude-sonnet-4-5', undefined],
    ] as const) {
      const n = network({ body: message([{ type: 'text', text: '{"opening":"Hi"}' }]) });
      await new AnthropicBackend('k', { fetch: n.fetchImpl }).complete(call(model));
      const body = n.seen[0].body;
      expect(body.model).toBe(model);
      expect(body.max_tokens).toBe(2000);
      expect(body.output_config.format.type).toBe('json_schema');
      expect(body.output_config.effort, model).toBe(effort);
      // nothing the newer models reject: no sampling settings, no thinking switch, no prefill
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('thinking');
      expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    }
  });

  it('reads the answer by type, even when thinking comes first', async () => {
    const n = network({
      body: message([
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: '{"opening":"Hi Jane"}' },
      ]),
    });
    expect(await new AnthropicBackend('k', { fetch: n.fetchImpl }).complete(call())).toEqual({ ok: true, data: { opening: 'Hi Jane' } });
  });

  it('treats a refusal, a cut-off and silence as failures with the reason', async () => {
    const refused = network({ body: message([], 'refusal') });
    expect(await new AnthropicBackend('k', { fetch: refused.fetchImpl }).complete(call())).toMatchObject({ ok: false, reason: 'refused' });
    const cut = network({ body: message([{ type: 'text', text: '{"openi' }], 'max_tokens') });
    expect(await new AnthropicBackend('k', { fetch: cut.fetchImpl }).complete(call())).toMatchObject({ ok: false, reason: 'bad_output' });
    const silent = network({ body: message([{ type: 'thinking', thinking: '', signature: 's' }]) });
    expect(await new AnthropicBackend('k', { fetch: silent.fetchImpl }).complete(call())).toMatchObject({
      ok: false,
      reason: 'bad_output',
    });
  });
});

describe('when the Anthropic account isn’t ready yet', () => {
  const fail = async (status: number, type: string, text: string) => {
    const n = network(apiError(status, type, text));
    return new AnthropicBackend('sk-ant-test', { fetch: n.fetchImpl }).complete(call());
  };

  it('says a key without a workspace needs one, and how to fix it', async () => {
    const r = await fail(
      400,
      'invalid_request_error',
      'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.',
    );
    expect(r).toMatchObject({ ok: false, reason: 'config' });
    expect((r as { message: string }).message).toMatch(/isn’t tied to a workspace.*ANTHROPIC_WORKSPACE_ID/);
  });

  it('says a wrong workspace id is wrong', async () => {
    const r = await fail(404, 'not_found_error', 'Workspace `wrkspc_nope` not found.');
    expect(r).toMatchObject({ ok: false, reason: 'config' });
    expect((r as { message: string }).message).toMatch(/ANTHROPIC_WORKSPACE_ID wasn’t found/);
  });

  it('says an account with no credit needs some', async () => {
    const r = await fail(
      400,
      'invalid_request_error',
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    );
    expect(r).toMatchObject({ ok: false, reason: 'auth' });
    expect((r as { message: string }).message).toMatch(/no credit.*Billing/);
  });

  it('says a rejected key is rejected, and a wrong model name is a model problem', async () => {
    expect(await fail(401, 'authentication_error', 'invalid x-api-key')).toMatchObject({
      ok: false,
      reason: 'auth',
      message: expect.stringMatching(/key was rejected/),
    });
    const model = await fail(404, 'not_found_error', 'model: claude-nope');
    expect(model).toMatchObject({ ok: false, reason: 'config' });
    expect((model as { message: string }).message).toMatch(/AI_MODEL_FAST/);
  });
});
