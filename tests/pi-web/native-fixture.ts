import type { Page } from '@playwright/test';
import { MobileFixtureBroker } from '../../src/mobile-protocol';
import { MobilePi } from '../../src/mobile-pi';
import { S3Connections, type S3ConnectionRecord } from '../../src/s3-connections';
import { InferenceConnections, type InferenceRecord } from '../../src/inference-connections';
import { mobileS3Sign } from '../../src/mobile-s3-sign';
import type { MobileGitHub } from '../../src/mobile-github';
import { previewFixture } from './preview-fixture';
import { BrowserChat, ChatStorage } from '../../hosted/pi-chat';
import type { PiBridge } from '../../hosted/pi-transport';

export function remoteFixture(streamPause?: () => Promise<void>, toolCode?: string, thinking?: string) {
  const objects = new Map<string, { text: string; version: string }>();
  const requests: { messages: { role: string; content: string }[]; reasoning_effort?: string }[] = [];
  let failSaves = false, failTelemetry = false;
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.hostname === 'inference.example') {
      if (request.headers.get('Authorization') !== 'Bearer private-fixture-secret') throw Error('Missing private inference header');
      const body = await request.json(); requests.push(body);
      const saved = [...objects.values()].map(object => JSON.parse(object.text));
      if (!saved.some(checkpoint => checkpoint.phase === 'pending' && (body.messages.at(-1).role === 'tool'
        ? checkpoint.messages?.at(-1)?.role === 'toolResult' && checkpoint.messages.at(-1).toolCallId === body.messages.at(-1).tool_call_id
        : checkpoint.messages?.at(-1)?.content === body.messages.at(-1).content))) throw Error('Inference started before its input was durable');
      const content = `Real Pi reply ${requests.length}: Café 🌴`;
      if (body.stream) return new Response(new ReadableStream({ async start(controller) {
        const emit = (delta: unknown, finish_reason: string | null = null) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`));
        if (toolCode !== undefined && body.messages.at(-1).role !== 'tool') {
          emit({ tool_calls: [{ index: 0, id: requests.length === 1 ? 'call-render' : `call-render-${requests.length}`, type: 'function', function: { name: 'codemode', arguments: '' } }] });
          await streamPause?.();
          emit({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ code: toolCode }) } }] });
          emit({}, 'tool_calls'); controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close(); return;
        }
        if (thinking) emit({ reasoning_content: thinking });
        emit({ content: `Real Pi reply ${requests.length}: `, reasoning_content: null, tool_calls: null });
        await streamPause?.();
        emit({ content: 'Café 🌴' }); emit({}, 'stop');
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close();
      } }), { headers: { 'content-type': 'text/event-stream' } });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content, reasoning_content: null, tool_calls: null } }] });
    }
    const r2 = url.hostname === 'fixture.r2.cloudflarestorage.com';
    if (url.hostname !== 's3.us-west-004.backblazeb2.com' && !r2 || !request.headers.get('Authorization')?.startsWith('AWS4-HMAC-SHA256 ')) throw Error('Unexpected unsigned request');
    if (r2 && (url.searchParams.has('versions') || url.searchParams.has('versionId'))) return new Response('R2 version operations are not implemented', { status: 501 });
    const key = decodeURIComponent(url.pathname.slice('/chats/'.length));
    if (request.method === 'PUT') {
      if (failTelemetry && key.includes('/telemetry/pi-agent/')) return new Response('', { status: 503 });
      if (failSaves) return new Response('', { status: 503 });
      if (request.headers.has('If-None-Match') && !r2) return new Response('', { status: 501 });
      const version = crypto.randomUUID(); objects.set(key, { text: await request.text(), version });
      return new Response('', { headers: { 'x-amz-version-id': version } });
    }
    if (url.searchParams.has('versions')) {
      const prefix = url.searchParams.get('prefix') ?? '';
      return new Response(`<ListVersionsResult><IsTruncated>false</IsTruncated>${[...objects].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => `<Version><Key>${key}</Key><VersionId>${object.version}</VersionId><Size>${Buffer.byteLength(object.text)}</Size></Version>`).join('')}</ListVersionsResult>`);
    }
    if (url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => `<Contents><Key>${key}</Key><Size>${Buffer.byteLength(object.text)}</Size></Contents>`).join('')}</ListBucketResult>`);
    }
    const object = objects.get(key);
    if (!object || url.searchParams.has('versionId') && url.searchParams.get('versionId') !== object.version) return new Response('', { status: 404 });
    return new Response(object.text, { headers: { 'x-amz-version-id': object.version } });
  };
  return { objects, requests, fetcher, setFailSaves(value: boolean) { failSaves = value; }, setFailTelemetry(value: boolean) { failTelemetry = value; } };
}
export async function nativeFixture(page: Page, source: string, remote: ReturnType<typeof remoteFixture>, github?: MobileGitHub, location?: { endpoint: string; region: string }) {
  const previews = previewFixture(source);
  const url = new URL(source); url.searchParams.set('repository', previews.navigation.repository); url.searchParams.set('workspace', previews.workspace);
  const origin = new URL(source).origin, subpath = new URL(source).pathname;
  const storage: S3ConnectionRecord = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Shared chats', endpoint: 'https://s3.us-west-004.backblazeb2.com/', bucket: 'chats', prefix: 'workspace/', region: 'us-west-004', addressing: 'path', accessKeyId: 'private-key', secretAccessKey: 'private-s3-secret', allowRead: true, allowUpload: true, allowOverwrite: false, hostedGrants: [{ origin, subpath }], ...location };
  const inference: InferenceRecord = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Pi model', model: 'fixture-model', url: 'https://inference.example/chat', headers: [{ name: 'Authorization', value: 'Bearer private-fixture-secret' }], hostedGrants: [{ origin, subpath }] };
  const store = <T extends { id: string }>(record: T) => ({ async all() { return [record]; }, async get(id: string) { return id === record.id ? record : undefined; }, async put() {}, async remove() {} });
  const pi = new MobilePi(new S3Connections(store(storage), remote.fetcher, undefined, undefined, undefined, mobileS3Sign), new InferenceConnections(store(inference), remote.fetcher));
  const broker = new MobileFixtureBroker(undefined, github ?? previews.host, undefined, pi);
  const document = { documentId: crypto.randomUUID(), documentURL: source, isMainFrame: true };
  broker.activate(document);
  await page.exposeFunction('fixtureNativeRequest', async (raw: string) => JSON.stringify(await broker.handleAsync(document, raw)));
  await page.addInitScript(({ documentId }) => {
    Object.assign(window, { alohakNative: { protocolVersion: 1, documentId, postMessage(raw: string) {
      void (window as unknown as { fixtureNativeRequest(raw: string): Promise<string> }).fixtureNativeRequest(raw).then(detail => window.dispatchEvent(new CustomEvent('alohak-native-message', { detail })));
    } } });
  }, { documentId: document.documentId });
  const bridge: PiBridge = (request) => pi.hosted(source, request, () => true) as never;
  return { storage, inference, url: url.href, previews, async seedLegacy(text: string) { const chat = new BrowserChat(new ChatStorage(bridge, storage), inference, bridge); await chat.send(text); return chat; },
    async seedCopied(text: string, pending = false) {
      const old = { ...storage, endpoint: 'https://s3.us-west-004.backblazeb2.com/', region: 'us-west-004' };
      const oldPi = new MobilePi(new S3Connections(store(old), remote.fetcher, undefined, undefined, undefined, mobileS3Sign), new InferenceConnections(store(inference), remote.fetcher));
      const send: PiBridge = request => oldPi.hosted(source, request, () => true) as never;
      const copiedStore = new ChatStorage(send, old), chat = new BrowserChat(copiedStore, inference, send, undefined, { repository: previews.navigation.repository, workspace: previews.workspace });
      await chat.send(text);
      if (pending) {
        const checkpoint = await copiedStore.read(chat.snapshot().sessionId!, chat.snapshot().reference!);
        await copiedStore.save({ ...checkpoint, phase: 'pending', parent: chat.snapshot().reference!, created_at: new Date().toISOString(), messages: [...checkpoint.messages, { role: 'user', content: 'Interrupted copied request', timestamp: Date.now() }] });
      }
      return chat;
    }, dispose: () => broker.invalidate() };
}
