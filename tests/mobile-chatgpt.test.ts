import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { MobilePiStore } from '../src/mobile-pi-store';
import { mobileInferenceRecordSchema, mobileInferenceSecretFields } from '../src/mobile-inference-record';
import { inferenceConfigurationSchema } from '../src/inference-protocol';
import { InferenceConnections, type InferenceRecord } from '../src/inference-connections';
import { MobilePi } from '../src/mobile-pi';
import { mobilePiRequest } from '../src/mobile-pi-client';
import { S3Connections } from '../src/s3-connections';
import { utf8Bytes, utf8Encode, utf8Text } from '../src/utf8';
import { z } from 'zod';
import { chatgptEventStream } from '../src/chatgpt-auth';

function storage() {
  const publicValues = new Map<string, string>(), secrets = new Map<string, string>();
  let failMetadata = false, failVault = false;
  const metadata = { async getItem(key: string) { return publicValues.get(key) ?? null; }, async setItem(key: string, value: string) { if (failMetadata) throw Error('metadata failure'); publicValues.set(key, value); } };
  const vault = { async getItem(key: string) { if (failVault) throw Error('locked'); return secrets.get(key) ?? null; }, async setItem(key: string, value: string) { if (failVault) throw Error('locked'); expect(utf8Bytes(value)).toBeLessThanOrEqual(1600); secrets.set(key, value); }, async removeItem(key: string) { secrets.delete(key); } };
  const restart = () => new MobilePiStore('inference', metadata, vault, randomUUID, mobileInferenceRecordSchema, mobileInferenceSecretFields);
  return { publicValues, secrets, metadata, vault, restart, failMetadata: (value: boolean) => { failMetadata = value; }, failVault: (value: boolean) => { failVault = value; } };
}
const custom: InferenceRecord = { id: randomUUID(), revision: randomUUID(), name: 'Custom', url: 'https://custom.example/v1/chat/completions', headers: [{ name: 'Authorization', value: 'custom-private-header' }], model: 'custom-model', hostedGrants: [{ origin: 'https://agent.example', subpath: '/pi-web/' }] };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test('production native schema preserves legacy records and secures the entire pending/rotating ChatGPT state across restarts', async () => {
  const disk = storage();
  const legacy = new MobilePiStore('inference', disk.metadata, disk.vault, randomUUID, inferenceConfigurationSchema.extend({ id: z.string().uuid(), revision: z.string().uuid(), hostedGrants: z.array(z.object({ origin: z.string(), subpath: z.string() })) }).strict(), ['url', 'headers']);
  await legacy.put(custom);
  expect(await disk.restart().get(custom.id)).toEqual(custom);
  const record: InferenceRecord = { ...custom, id: randomUUID(), chatgpt: { access: 'private-access'.repeat(500), refresh: 'private-refresh', accountId: 'private-account', refreshing: true, pending: { deviceId: 'private-device', userCode: 'PRIVATE-CODE', interval: 1000, nextPoll: 42, expires: 99, exchanging: true } } };
  await disk.restart().put(record);
  expect(await disk.restart().get(record.id)).toEqual(record);
  expect(await disk.restart().get(custom.id)).toEqual(custom);
  expect([...disk.publicValues.values()].join('')).not.toMatch(/private|PRIVATE|chatgpt|headers|https:\/\/custom/);
  await disk.restart().remove(record.id);
  expect(await disk.restart().get(record.id)).toBeUndefined();
  expect(await disk.restart().get(custom.id)).toEqual(custom);
});

test.each(['metadata', 'vault'])('native credential commit failure (%s) retains the previous generation and never exposes replacement secrets', async mode => {
  const disk = storage(), store = disk.restart();
  await store.put(custom);
  const before = [...disk.publicValues], beforeSecrets = [...disk.secrets];
  (mode === 'metadata' ? disk.failMetadata : disk.failVault)(true);
  await expect(store.put({ ...custom, chatgpt: { access: 'new-private-access', refresh: 'new-private-refresh' } })).rejects.toThrow();
  disk.failMetadata(false); disk.failVault(false);
  expect([...disk.publicValues]).toEqual(before);
  expect([...disk.secrets]).toEqual(beforeSecrets);
  expect(await disk.restart().get(custom.id)).toEqual(custom);
});

test('native device auth/restart/refresh/streaming works without browser crypto, codecs, atob or TransformStream', async () => {
  vi.useFakeTimers();
  const disk = storage();
  const access = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'private-account' } })).toString('base64url')}.private-access`;
  const payload = utf8Encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: `Hello 🌴 ${access}` })}\r\n\r\ndata: [DONE]\n\n`);
  new Response('{}'); // Initialize Node fetch internals before hiding browser globals.
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/usercode')) return Response.json({ device_auth_id: 'private-device', user_code: 'NATIVE-CODE', interval: 1 });
    if (String(url).endsWith('/deviceauth/token')) return Response.json({ authorization_code: 'private-code', code_verifier: 'private-verifier' });
    if (String(url).endsWith('/oauth/token')) return Response.json({ access_token: access, refresh_token: 'private-refresh', expires_in: 120 });
    expect(new Headers(init!.headers).get('Authorization')).toBe(`Bearer ${access}`);
    expect(new Headers(init!.headers).get('ChatGPT-Account-Id')).toBe('private-account');
    let offset = 0;
    return new Response(new ReadableStream({ pull(controller) { if (offset >= payload.length) controller.close(); else controller.enqueue(payload.slice(offset, ++offset)); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  for (const name of ['crypto', 'TextEncoder', 'TextDecoder', 'TransformStream', 'atob']) vi.stubGlobal(name, undefined);
  const timeout = () => new AbortController().signal;
  const create = () => new InferenceConnections(disk.restart(), fetcher, undefined, randomUUID, timeout, signals => signals[0]);
  let broker = create();
  const connection = await broker.handle({ operation: 'chatgptAdd', name: 'Native ChatGPT', model: 'model-a' }) as { id: string };
  expect(await broker.handle({ operation: 'chatgptStart', id: connection.id })).toMatchObject({ userCode: 'NATIVE-CODE' });
  expect([...disk.publicValues.values()].join('')).not.toContain('NATIVE-CODE');
  broker = create();
  expect(await broker.handle({ operation: 'chatgptPoll', id: connection.id })).toMatchObject({ pollAfterMs: 1000 });
  vi.advanceTimersByTime(1000);
  expect(await broker.handle({ operation: 'chatgptPoll', id: connection.id })).toBeNull();
  await broker.handle({ operation: 'grantOrigin', id: connection.id, origin: 'https://agent.example', subpath: '/pi-web/' });
  vi.advanceTimersByTime(61000); // Force rotating refresh before inference.
  const service = new MobilePi(new S3Connections({ all: async () => [], get: async () => undefined, put: async () => {}, remove: async () => {} }), broker);
  // The page-side SDK has browser crypto; the native side of every RPC does not.
  const browserCrypto = { randomUUID };
  vi.stubGlobal('crypto', browserCrypto);
  const client = { request: async (_method: string, value: Record<string, unknown>) => {
    vi.stubGlobal('crypto', undefined);
    try { return await service.handle('https://agent.example/pi-web/', value, () => true); }
    finally { vi.stubGlobal('crypto', browserCrypto); }
  } };
  const records = await mobilePiRequest<any[]>(client, { operation: 'inferenceConnections' }, 30000);
  expect(records[0]).toMatchObject({ provider: 'chatgpt', authStatus: 'connected' });
  expect(JSON.stringify(records)).not.toMatch(/private|NATIVE-CODE|auth\.openai/);
  const request = { id: connection.id, revision: records[0].revision, requestId: randomUUID() };
  expect(await mobilePiRequest(client, { operation: 'inferenceOpen', ...request, body: JSON.stringify({ input: [{}] }) }, 30000)).toMatchObject({ status: 200 });
  let text = '';
  for (let sequence = 0; sequence < 500; sequence++) {
    const part = await mobilePiRequest<{ text: string; done: boolean }>(client, { operation: 'inferenceRead', ...request, sequence }, 30000);
    text += part.text; if (part.done) break;
  }
  expect(text).toContain('Hello 🌴 [redacted]'); expect(text).not.toContain(access);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/oauth/token'))).toHaveLength(2);
  expect([...disk.publicValues.values()].join('')).not.toMatch(/private|NATIVE-CODE|chatgpt/);
  await broker.handle({ operation: 'chatgptDisconnect', id: connection.id });
  expect((await disk.restart().get(connection.id))!.chatgpt).toEqual({});
  service.clear();
});

test('portable UTF-8 encoder matches browser encoding including unpaired surrogates', () => {
  for (const value of ['Hello 🌴 café', '\ud800', '\udfff', '\uFEFFhello', '\0', '𐀀']) expect(utf8Encode(value)).toEqual(new TextEncoder().encode(value));
  expect(utf8Text(utf8Encode('Hello 🌴'))).toBe('Hello 🌴');
});

test('portable ChatGPT stream cancellation releases its upstream reader even if cancellation fails', async () => {
  const failure = Error('upstream cancellation failed');
  const cancel = vi.fn(() => { throw failure; });
  const upstream = new ReadableStream<Uint8Array>({ cancel });
  const reader = chatgptEventStream(upstream, []).getReader();
  await expect(reader.cancel('stop')).rejects.toThrow(failure);
  expect(cancel).toHaveBeenCalledWith('stop');
  expect(upstream.locked).toBe(false);
});
