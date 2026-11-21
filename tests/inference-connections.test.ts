import { describe, it, expect, vi } from 'vitest';
import { InferenceConnections, type InferenceRecord, type InferenceStore } from '../src/inference-connections';
import { inferenceSettingsSchema, inferenceURL } from '../src/inference-protocol';

const page = 'https://app.example/agent/pi.html';
const record: InferenceRecord = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Private provider', model: 'model-a', url: 'https://inference.example/v1/chat/completions', headers: [{ name: 'Authorization', value: 'Bearer private-secret' }, { name: 'X-Custom', value: 'custom-secret' }], hostedGrants: [{ origin: 'https://app.example', subpath: '/agent/' }] };
function fixture(fetcher: typeof fetch = vi.fn(async () => Response.json({ choices: [] }))) {
  const values = new Map([[record.id, structuredClone(record)]]);
  const store: InferenceStore = { all: async () => structuredClone([...values.values()]), get: async id => structuredClone(values.get(id)), put: async value => { values.set(value.id, structuredClone(value)); }, remove: async id => { values.delete(id); } };
  const broker = new InferenceConnections(store, fetcher);
  const request = { operation: 'inferenceComplete', id: record.id, revision: record.revision, requestId: crypto.randomUUID(), body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) };
  return { broker, request, fetcher };
}
describe('privileged inference broker', () => {
  it('keeps headers and endpoint private and fixes model, method, credentials, redirects and output limit', async () => {
    const { broker, request, fetcher } = fixture();
    expect(JSON.stringify(await broker.handle({ operation: 'list' }))).not.toMatch(/secret|inference\.example|Authorization/);
    expect(JSON.stringify(await broker.handleHosted(page, { operation: 'inferenceConnections' }))).not.toMatch(/secret|inference\.example/);
    await broker.handleHosted(page, request);
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe(record.url); expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' });
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer private-secret');
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: 'model-a', stream: false, max_tokens: 4096 });
  });
  it('rejects wrong original paths, revision and injected endpoint/headers', async () => {
    const { broker, request, fetcher } = fixture();
    await expect(broker.handleHosted('https://app.example/elsewhere/pi.html', request)).rejects.toThrow('access changed');
    await expect(broker.handleHosted(page, { ...request, revision: crypto.randomUUID() })).rejects.toThrow('access changed');
    for (const body of [{ messages: [{}], headers: { authorization: 'x' } }, { messages: [{}], url: 'https://evil.example' }, { messages: [{}], model: 'override' }]) await expect(broker.handleHosted(page, { ...request, body: JSON.stringify(body) })).rejects.toThrow('messages and optional tools');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels active inference and never returns a late answer', async () => {
    let started!: () => void, finish!: (value: Response) => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const fetcher = vi.fn<typeof fetch>(async () => { started(); return new Promise(resolve => { finish = resolve; }); });
    const { broker, request } = fixture(fetcher);
    const work = broker.handleHosted(page, request); await ready;
    await broker.handleHosted(page, { operation: 'inferenceCancel', id: request.id, revision: request.revision, requestId: request.requestId });
    finish(Response.json({ answer: 'late' })); await expect(work).rejects.toThrow('cancelled');
  });
  it('invalidates in-flight results on revoke and prevents the next request', async () => {
    let started!: () => void, finish!: (value: Response) => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const { broker, request } = fixture(async () => { started(); return new Promise(resolve => { finish = resolve; }); });
    const work = broker.handleHosted(page, request); await ready;
    await broker.handle({ operation: 'revokeOrigin', id: record.id, origin: 'https://app.example', subpath: '/agent/' });
    finish(Response.json({ answer: 'late' })); await expect(work).rejects.toThrow('cancelled');
    await expect(broker.handleHosted(page, request)).rejects.toThrow('access changed');
  });
  it('honors a cancellation that arrives before completion authorization finishes', async () => {
    const { broker, request, fetcher } = fixture();
    await broker.handleHosted(page, { operation: 'inferenceCancel', id: request.id, revision: request.revision, requestId: request.requestId });
    await expect(broker.handleHosted(page, request)).rejects.toThrow('cancelled');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('redacts provider error bodies and rejects oversized replies', async () => {
    for (const response of [new Response('private-secret', { status: 401 }), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
      const { broker, request } = fixture(async () => response);
      await expect(broker.handleHosted(page, request)).rejects.not.toThrow('private-secret');
    }
  });
  it('rejects ambiguous endpoint and unsafe headers, permits empty optional headers', () => {
    for (const url of ['https://user:pass@provider.example/a', 'https://provider.example/a?key=secret', 'http://remote.example/a']) expect(() => inferenceURL(url)).toThrow();
    for (const name of ['Cookie', 'Host', 'Content-Length', 'Sec-Fetch-Site']) expect(() => inferenceSettingsSchema.parse({ operation: 'add', name: 'test', url: record.url, model: 'test', headers: [{ name, value: 'bad' }] })).toThrow();
    expect(inferenceSettingsSchema.parse({ operation: 'add', name: 'test', url: record.url, model: 'test' })).toMatchObject({ headers: [] });
  });
});
