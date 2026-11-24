import { describe, expect, it, vi } from 'vitest';
import { InferenceConnections, type InferenceRecord, type InferenceStore } from '../src/inference-connections';
import { inferenceFetch } from '../hosted/pi-fetch';
import { inferenceStream, piModel, type PiBridge } from '../hosted/pi-transport';
import { browserPiAgent } from '../hosted/pi-agent';
import { MobilePi } from '../src/mobile-pi';
import { S3Connections } from '../src/s3-connections';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import { UTF8Decoder } from '../src/utf8';

const page = 'https://app.example/agent/pi.html';
function fixture(fetcher: typeof fetch, hasHostAccess?: (origin: string) => Promise<boolean>) {
  const record: InferenceRecord = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Private provider', model: 'configured-model', url: 'https://provider.example/custom/chat/completions', headers: [{ name: 'Authorization', value: 'Bearer private-secret' }, { name: 'X-Custom', value: 'custom-secret' }], hostedGrants: [{ origin: 'https://app.example', subpath: '/agent/' }] };
  const store: InferenceStore = { all: async () => [record], get: async () => record, put: async () => {}, remove: async () => {} };
  const broker = new InferenceConnections(store, fetcher, hasHostAccess);
  const bridge: PiBridge = async <T>(request: Parameters<PiBridge>[0]) => await broker.handleHosted(page, request) as T;
  const connection = { id: record.id, revision: record.revision, model: record.model, name: record.name, hostedGrants: [], transport: 'http-stream-v1' as const };
  return { broker, bridge, connection, record };
}
function sse(chunks: unknown[]) {
  const bytes = new TextEncoder().encode(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n');
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    // Deliberately split SSE records, JSON and multibyte UTF-8 characters.
    controller.enqueue(bytes.slice(offset, offset += Math.min(7, bytes.length - offset)));
  } }), { headers: { 'content-type': 'text/event-stream', 'x-secret': 'private-secret' } });
}
const chunk = (delta: unknown, finish_reason: string | null = null) => ({ id: 'response-1', choices: [{ index: 0, delta, finish_reason }] });

describe('Pi provider adapter over host HTTP transport', () => {
  it('streams text/thinking and usage through Pi with configured destination, model and secret headers', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => sse([
      chunk({ reasoning_content: 'Check first.' }), chunk({ content: 'Café ' }), chunk({ content: '🌴', tool_calls: null, reasoning_content: null }), chunk({}, 'stop'),
      { choices: [], usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 } },
    ]));
    const { bridge, connection, record } = fixture(fetcher);
    const events: string[] = [];
    const stream = await inferenceStream(bridge, connection)(piModel(connection), normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }] }));
    for await (const event of stream) events.push(event.type);
    expect((await stream.result()).errorMessage).toBeUndefined();
    expect(await stream.result()).toMatchObject({ stopReason: 'stop', content: [{ type: 'thinking', thinking: 'Check first.' }, { type: 'text', text: 'Café 🌴' }], usage: { input: 21, output: 8, totalTokens: 29 } });
    expect(events).toContain('text_delta'); expect(events).toContain('thinking_delta');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(record.url); expect(new Headers(init!.headers).get('x-custom')).toBe('custom-secret');
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer private-secret');
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: record.model, stream: true });
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
  });
  it('runs a streamed tool-call loop and sends Pi-converted tool history to the next request', async () => {
    const payloads: any[] = [];
    const { bridge, connection } = fixture(async (_, init) => {
      payloads.push(JSON.parse(init!.body as string));
      return payloads.length === 1 ? sse([
        chunk({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'github_probe', arguments: '{"repository":' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"owner/repo"}' } }] }), chunk({}, 'tool_calls'),
      ]) : sse([chunk({ content: 'Found the head.' }), chunk({}, 'stop')]);
    });
    const send: PiBridge = async <T>(request: Parameters<PiBridge>[0]) => request.operation === 'agentProbe' ? { headOid: 'abc' } as T : bridge<T>(request);
    const { agent } = browserPiAgent(send, connection, { id: crypto.randomUUID(), appId: 123, name: 'GitHub', user: { id: 42, login: 'tester' }, installation: { id: 456, account: 'tester' } });
    await agent.prompt('Read owner/repo');
    expect(agent.state.messages.at(-1)).not.toHaveProperty('errorMessage');
    expect(agent.state.messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'toolResult', 'assistant']);
    expect(payloads[1].messages).toContainEqual({ role: 'tool', tool_call_id: 'call-1', content: '{"headOid":"abc"}' });
    expect(agent.state.messages.at(-1)).toMatchObject({ stopReason: 'stop', content: [{ type: 'text', text: 'Found the head.' }] });
    await agent.prompt('Continue'); expect(payloads).toHaveLength(3);
    expect(agent.state.messages.at(-1)).toMatchObject({ stopReason: 'stop' });
  });
  it('preserves HTTP status but redacts error bodies and response headers', async () => {
    const { bridge, connection } = fixture(async () => new Response('private-secret https://provider.example', { status: 429, headers: { 'x-secret': 'private-secret' } }));
    const response = await inferenceFetch(bridge, connection)('https://extension.invalid/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }) });
    expect(response.status).toBe(429); expect(response.headers.get('x-secret')).toBeNull();
    const body = await response.text(); expect(body).toContain('HTTP 429'); expect(body).not.toMatch(/private-secret|provider\.example/);
  });
  it('supports native bounded transfers of streamed chunks without widening allowed operations', async () => {
    const { broker, connection } = fixture(async () => sse([chunk({ content: 'Native 🌴' }), chunk({}, 'stop')]));
    const native = new MobilePi(new S3Connections({ all: async () => [], get: async () => undefined, put: async () => {}, remove: async () => {} }), broker);
    const send: PiBridge = async <T>(request: Parameters<PiBridge>[0]) => {
      const transferId = crypto.randomUUID(), text = JSON.stringify(request);
      await native.handle(page, { phase: 'begin', transferId, bytes: new TextEncoder().encode(text).length }, () => true);
      await native.handle(page, { phase: 'chunk', transferId, index: 0, text }, () => true);
      const result = await native.handle(page, { phase: 'commit', transferId }, () => true) as { chunks: number };
      const parts: string[] = [];
      for (let index = 0; index < result.chunks; index++) parts.push((await native.handle(page, { phase: 'read', transferId, index }, () => true) as { text: string }).text);
      await native.handle(page, { phase: 'cancel', transferId }, () => true);
      return JSON.parse(parts.join('')) as T;
    };
    const stream = await inferenceStream(send, connection)(piModel(connection), normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }] }));
    expect((await stream.result()).errorMessage).toBeUndefined();
    expect(await stream.result()).toMatchObject({ stopReason: 'stop', content: [{ type: 'text', text: 'Native 🌴' }] });
    native.clear();
  });
  it('aborts a pending read and releases its host stream', async () => {
    let cancelled = false;
    const { bridge, connection } = fixture(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
    const controller = new AbortController();
    const response = await inferenceFetch(bridge, connection)('https://extension.invalid/chat/completions', { method: 'POST', signal: controller.signal, body: JSON.stringify({ messages: [{}] }) });
    const reading = response.text(); controller.abort();
    await expect(reading).rejects.toThrow(); expect(cancelled).toBe(true);
  });
  it('revokes a pending stream and denies its continuation', async () => {
    const { bridge, broker, connection, record } = fixture(async () => new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } }));
    const response = await inferenceFetch(bridge, connection)('https://extension.invalid/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [{}] }) });
    const reading = response.text();
    await broker.handle({ operation: 'revokeOrigin', id: record.id, origin: 'https://app.example', subpath: '/agent/' });
    await expect(reading).rejects.toThrow();
    await expect(bridge({ operation: 'inferenceOpen', id: record.id, revision: connection.revision, requestId: crypto.randomUUID(), body: JSON.stringify({ messages: [{}] }) })).rejects.toThrow('access changed');
  });
  it('bounds provider bytes and bridge chunks, pins host policy and rejects injected destinations', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('🌴'.repeat(600000)));
    const { bridge, connection, broker, record } = fixture(fetcher);
    const response = await inferenceFetch(bridge, connection)('https://extension.invalid/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [{}], model: 'override', stream: false, store: true, max_tokens: 999999 }) });
    await expect(response.text()).rejects.toThrow('response limit');
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({ model: record.model, stream: true, store: false, max_tokens: 4096 });
    await expect(bridge({ operation: 'inferenceOpen', id: record.id, revision: record.revision, requestId: crypto.randomUUID(), body: JSON.stringify({ messages: [{}], url: 'https://evil.example', headers: { authorization: 'evil' } }) })).rejects.toThrow('Expected messages');
    const small = fixture(async () => new Response('🌴'.repeat(20000)));
    const requestId = crypto.randomUUID(), identity = { id: small.record.id, revision: small.record.revision, requestId };
    await small.bridge({ operation: 'inferenceOpen', ...identity, body: JSON.stringify({ messages: [{}] }) });
    const part = await small.bridge<{ text: string }>({ operation: 'inferenceRead', ...identity, sequence: 0 });
    expect(part.text.length).toBeLessThanOrEqual(16384); expect(part.text).toBe('🌴'.repeat(part.text.length / 2));
    await expect(small.bridge({ operation: 'inferenceRead', ...identity, sequence: 0 })).rejects.toThrow('order mismatch');
    small.broker.cancelActive(); broker.cancelActive();
  });
  it('decodes every UTF-8 byte boundary without native TextDecoder and rejects truncated UTF-8', () => {
    const value = '\uFEFFCafé 🌴\uFEFF end', bytes = new TextEncoder().encode(value);
    vi.stubGlobal('TextDecoder', undefined);
    try {
      for (let split = 0; split <= bytes.length; split++) {
        const decoder = new UTF8Decoder();
        expect(decoder.decode(bytes.slice(0, split), { stream: true }) + decoder.decode(bytes.slice(split))).toBe(value.slice(1));
      }
      const decoder = new UTF8Decoder(); decoder.decode(Uint8Array.of(0xf0, 0x9f), { stream: true });
      expect(() => decoder.decode()).toThrow('UTF-8');
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not release a chunk when revocation overtakes asynchronous permission checks', async () => {
    let providerRead = false, blocked = false, ready!: () => void, resume!: () => void;
    const checking = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
    const { broker, bridge, record } = fixture(async () => new Response(new ReadableStream({ pull(controller) { providerRead = true; controller.enqueue(new TextEncoder().encode('Late text')); } }, { highWaterMark: 0 })), async () => { if (providerRead && !blocked) { blocked = true; ready(); await gate; } return true; });
    const identity = { id: record.id, revision: record.revision, requestId: crypto.randomUUID() };
    await bridge({ operation: 'inferenceOpen', ...identity, body: JSON.stringify({ messages: [{}] }) });
    const reading = bridge({ operation: 'inferenceRead', ...identity, sequence: 0 }); await checking;
    await broker.handle({ operation: 'revokeOrigin', id: record.id, origin: 'https://app.example', subpath: '/agent/' }); resume();
    await expect(reading).rejects.toThrow('cancelled');
  });
  it('does not start inference if the native document changes during authorization', async () => {
    let current = true, ready!: () => void, resume!: () => void;
    const checking = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
    const fetcher = vi.fn<typeof fetch>(async () => new Response('Should not fetch'));
    const { broker, record } = fixture(fetcher, async () => { ready(); await gate; return true; });
    const opening = broker.handleHosted(page, { operation: 'inferenceOpen', id: record.id, revision: record.revision, requestId: crypto.randomUUID(), body: JSON.stringify({ messages: [{}] }) }, () => current);
    await checking; current = false; resume();
    await expect(opening).rejects.toThrow('access changed'); expect(fetcher).not.toHaveBeenCalled();
  });
});
