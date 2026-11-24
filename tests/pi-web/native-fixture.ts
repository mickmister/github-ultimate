import type { Page } from '@playwright/test';
import { MobileFixtureBroker } from '../../src/mobile-protocol';
import { MobilePi } from '../../src/mobile-pi';
import { S3Connections, type S3ConnectionRecord } from '../../src/s3-connections';
import { InferenceConnections, type InferenceRecord } from '../../src/inference-connections';
import { mobileS3Sign } from '../../src/mobile-s3-sign';
import type { MobileGitHub } from '../../src/mobile-github';

export function remoteFixture(streamPause?: () => Promise<void>) {
  const objects = new Map<string, { text: string; version: string }>();
  const requests: { messages: { role: string; content: string }[] }[] = [];
  let failSaves = false;
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.hostname === 'inference.example') {
      if (request.headers.get('Authorization') !== 'Bearer private-fixture-secret') throw Error('Missing private inference header');
      const body = await request.json(); requests.push(body);
      const saved = [...objects.values()].map(object => JSON.parse(object.text));
      if (!saved.some(checkpoint => checkpoint.phase === 'pending' && checkpoint.messages?.at(-1)?.content === body.messages.at(-1).content)) throw Error('Inference started before the user message was durable');
      const content = `Real Pi reply ${requests.length}: Café 🌴`;
      if (body.stream) return new Response(new ReadableStream({ async start(controller) {
        const emit = (delta: unknown, finish_reason: string | null = null) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`));
        emit({ content: `Real Pi reply ${requests.length}: `, reasoning_content: null, tool_calls: null });
        await streamPause?.();
        emit({ content: 'Café 🌴' }); emit({}, 'stop');
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close();
      } }), { headers: { 'content-type': 'text/event-stream' } });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content, reasoning_content: null, tool_calls: null } }] });
    }
    if (url.hostname !== 's3.us-west-004.backblazeb2.com' || !request.headers.get('Authorization')?.startsWith('AWS4-HMAC-SHA256 ')) throw Error('Unexpected unsigned request');
    const key = decodeURIComponent(url.pathname.slice('/chats/'.length));
    if (request.method === 'PUT') {
      if (failSaves) return new Response('', { status: 503 });
      if (request.headers.has('If-None-Match')) return new Response('', { status: 501 });
      const version = crypto.randomUUID(); objects.set(key, { text: await request.text(), version });
      return new Response('', { headers: { 'x-amz-version-id': version } });
    }
    if (url.searchParams.has('versions')) {
      const prefix = url.searchParams.get('prefix') ?? '';
      return new Response(`<ListVersionsResult><IsTruncated>false</IsTruncated>${[...objects].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => `<Version><Key>${key}</Key><VersionId>${object.version}</VersionId><Size>${Buffer.byteLength(object.text)}</Size></Version>`).join('')}</ListVersionsResult>`);
    }
    const object = objects.get(key);
    if (!object || url.searchParams.get('versionId') !== object.version) return new Response('', { status: 404 });
    return new Response(object.text, { headers: { 'x-amz-version-id': object.version } });
  };
  return { objects, requests, fetcher, setFailSaves(value: boolean) { failSaves = value; } };
}
export async function nativeFixture(page: Page, source: string, remote: ReturnType<typeof remoteFixture>, github?: MobileGitHub) {
  const origin = new URL(source).origin, subpath = new URL(source).pathname;
  const storage: S3ConnectionRecord = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Shared chats', endpoint: 'https://s3.us-west-004.backblazeb2.com/', bucket: 'chats', prefix: 'workspace/', region: 'us-west-004', addressing: 'path', accessKeyId: 'private-key', secretAccessKey: 'private-s3-secret', allowRead: true, allowUpload: true, allowOverwrite: false, hostedGrants: [{ origin, subpath }] };
  const inference: InferenceRecord = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Pi model', model: 'fixture-model', url: 'https://inference.example/chat', headers: [{ name: 'Authorization', value: 'Bearer private-fixture-secret' }], hostedGrants: [{ origin, subpath }] };
  const store = <T extends { id: string }>(record: T) => ({ async all() { return [record]; }, async get(id: string) { return id === record.id ? record : undefined; }, async put() {}, async remove() {} });
  const pi = new MobilePi(new S3Connections(store(storage), remote.fetcher, undefined, undefined, undefined, mobileS3Sign), new InferenceConnections(store(inference), remote.fetcher));
  const broker = new MobileFixtureBroker(undefined, github, undefined, pi);
  const document = { documentId: crypto.randomUUID(), documentURL: source, isMainFrame: true };
  broker.activate(document);
  await page.exposeFunction('fixtureNativeRequest', async (raw: string) => JSON.stringify(await broker.handleAsync(document, raw)));
  await page.addInitScript(({ documentId }) => {
    Object.assign(window, { alohakNative: { protocolVersion: 1, documentId, postMessage(raw: string) {
      void (window as unknown as { fixtureNativeRequest(raw: string): Promise<string> }).fixtureNativeRequest(raw).then(detail => window.dispatchEvent(new CustomEvent('alohak-native-message', { detail })));
    } } });
  }, { documentId: document.documentId });
  return { storage, inference, dispose: () => broker.invalidate() };
}
