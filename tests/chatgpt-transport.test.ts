import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InferenceConnections, type InferenceRecord } from '../src/inference-connections';
import { CHATGPT_INFERENCE_URL } from '../src/chatgpt-auth';
import { inferenceStream, piModel, type PiBridge } from '../hosted/pi-transport';
import { browserPiAgent } from '../hosted/pi-agent';
import { checkpointSchema } from '../hosted/pi-session';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';

// Match browser execution: Pi's optional Node-only zstd compressor is absent.
beforeEach(() => { vi.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined); });
afterEach(() => vi.restoreAllMocks());

export function codexSSE(tool = false) {
  const item = tool ? { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'github_probe', arguments: '' } : { type: 'message', id: 'msg_1', role: 'assistant', content: [], status: 'in_progress' };
  return [
    { type: 'response.created', response: { id: 'resp_1' } },
    { type: 'response.output_item.added', output_index: 0, item },
    ...(tool ? [{ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"repository":"owner/repo"}' }] : [
      { type: 'response.content_part.added', item_id: 'msg_1', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Connected 🌴' },
    ]),
    { type: 'response.output_item.done', output_index: 0, item: tool ? { ...item, arguments: '{"repository":"owner/repo"}' } : { ...item, status: 'completed', content: [{ type: 'output_text', text: 'Connected 🌴', annotations: [] }] } },
    { type: 'response.completed', response: { id: 'resp_1', status: 'completed', usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
  ];
}
function sse(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset += 13));
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
function fixture(fetcher: typeof fetch) {
  let record: InferenceRecord = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'ChatGPT', url: CHATGPT_INFERENCE_URL, model: 'gpt-6.1-sol', headers: [], hostedGrants: [{ origin: 'https://app.example', subpath: '/' }], chatgpt: { access: 'real-private-token', refresh: 'real-private-refresh', accountId: 'private-account', expires: Date.now() + 3600000 } };
  const broker = new InferenceConnections({ all: async () => [structuredClone(record)], get: async () => structuredClone(record), put: async r => { record = structuredClone(r); }, remove: async () => {} }, fetcher);
  const bridge: PiBridge = async <T>(request: Parameters<PiBridge>[0]) => request.operation === 'agentProbe' ? { headOid: 'head' } as T : await broker.handleHosted('https://app.example/', request) as T;
  const connection = { id: record.id, revision: record.revision, name: record.name, model: record.model, provider: 'chatgpt' as const, protocol: 'openai-codex-responses' as const, transport: 'http-stream-v1' as const, hostedGrants: [] };
  return { broker, bridge, connection };
}
describe('ChatGPT Pi transport', () => {
  it('uses the real pinned Pi Responses adapter, keeps auth private and restores tool-call history', async () => {
    const payloads: any[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_, init) => { payloads.push(JSON.parse(init!.body as string)); return sse(codexSSE(payloads.length === 1)); });
    const { bridge, connection } = fixture(fetcher);
    const { agent } = browserPiAgent(bridge, connection, { id: crypto.randomUUID(), appId: 1, name: 'GitHub', user: { id: 42, login: 'tester' }, installation: { id: 2, account: 'tester' } });
    await agent.prompt('Read owner/repo');
    expect(agent.state.messages.at(-1)).not.toHaveProperty('errorMessage');
    expect(agent.state.messages.at(-1)).toMatchObject({ stopReason: 'stop', api: 'openai-codex-responses', content: [{ type: 'text', text: 'Connected 🌴' }], usage: { input: 12, output: 3 } });
    expect(agent.state.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'toolResult', 'assistant']);
    expect(payloads[0]).toMatchObject({ store: false, stream: true, model: 'gpt-6.1-sol', reasoning: { effort: 'medium' } });
    expect(payloads[1]).toMatchObject({ reasoning: { effort: 'medium' } });
    expect(payloads[0]).not.toHaveProperty('max_tokens'); expect(payloads[0]).not.toHaveProperty('max_output_tokens');
    expect(payloads[1].input).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: 'call_1', output: '{"headOid":"head"}' }));
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe(CHATGPT_INFERENCE_URL); expect(new Headers(init!.headers).get('authorization')).toBe('Bearer real-private-token');
    }
    const messages = checkpointSchema.shape.messages.parse(agent.state.messages.filter(m => m.role !== 'system'));
    expect(messages.at(-1)).toMatchObject({ content: [{ textSignature: expect.any(String) }] });
    agent.state.messages = messages; await agent.prompt('Continue after restore');
    expect(agent.state.messages.at(-1)).toMatchObject({ stopReason: 'stop' });
    expect(JSON.stringify(payloads)).not.toMatch(/real-private|private-account/);
  });
  it('does not turn a truncated stream or terminal provider failure into success', async () => {
    for (const events of [codexSSE().slice(0, -1), [{ type: 'response.failed', response: { error: { code: 'usage_limit_reached', message: 'Limit reached' } } }]]) {
      const { connection, bridge } = fixture(async () => sse(events));
      const stream = await inferenceStream(bridge, connection)(piModel(connection), normalizeContext({ messages: [{ role: 'user', content: 'Hi', timestamp: Date.now() }] }));
      expect(await stream.result()).toMatchObject({ stopReason: 'error' });
    }
  });
  it('redacts reflected private credentials across byte boundaries and maps SSE quota failures', async () => {
    const events = codexSSE().map(event => JSON.parse(JSON.stringify(event).replaceAll('Connected 🌴', 'real-private-token real-private-refresh')));
    const { connection, bridge } = fixture(async () => sse(events));
    const stream = await inferenceStream(bridge, connection)(piModel(connection), normalizeContext({ messages: [{ role: 'user', content: 'Hi', timestamp: Date.now() }] }));
    expect(await stream.result()).toMatchObject({ stopReason: 'stop', content: [{ text: '[redacted] [redacted]' }] });
    const failed = fixture(async () => sse([{ type: 'response.failed', response: { error: { code: 'usage_limit_reached', message: 'real-private-refresh provider-private-diagnostics' } } }]));
    const failure = await inferenceStream(failed.bridge, failed.connection)(piModel(failed.connection), normalizeContext({ messages: [{ role: 'user', content: 'Hi', timestamp: Date.now() }] }));
    const result = await failure.result(); expect(result.errorMessage).toContain('usage limit');
    expect(JSON.stringify(result)).not.toMatch(/real-private|provider-private/);
  });
  it('preserves reasoning signatures and legacy checkpoint messages', () => {
    const base = { role: 'assistant', provider: 'extension', model: 'model', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 0 };
    const messages = [{ ...base, api: 'openai-completions', content: [{ type: 'text', text: 'old' }] }, { ...base, api: 'openai-codex-responses', responseId: 'resp_1', endTurn: true, content: [{ type: 'thinking', thinking: '', thinkingSignature: '{"encrypted_content":"opaque"}' }, { type: 'text', text: 'new', textSignature: '{"v":1,"id":"msg_1"}' }] }];
    expect(checkpointSchema.shape.messages.parse(messages)).toEqual(messages);
  });
});
