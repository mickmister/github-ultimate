// Optional paired-checkout proof: real pinned Spec Kit/Pi writes through the
// runner's S3 SDK, and the packaged browser reads the same local S3 fixture.
// Set PI_LIVE_PRODUCER_ROOT to a frozen-installed runner checkout (including
// its pinned Spec Kit venv); run live-session.spec.ts with built assets and
// NODE_OPTIONS=--experimental-strip-types. Default CI uses the B2-host fixture.
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export async function liveProducerFixture(sourceRoot: string) {
  const module = (name: string) => import(pathToFileURL(resolve(sourceRoot, '.github/qrspi-hosted', name + '.ts')).href);
  const [{ specKitTurn }, { ExecutionEvidence }, { PrivateStore, digest }, { announceLive }] = await Promise.all(['spec-kit-turn', 'execution', 'storage', 'live-session'].map(module));
  const objects = new Map<string, string>(), calls: { key: string; signed: boolean; method: string; actor: 'producer' | 'viewer' }[] = [];
  let partialPublishedAt = 0;
  let finishInference: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://fixture');
    if (url.pathname === '/v1/chat/completions') {
      for await (const _ of request) { /* Consume actual Pi provider request. */ }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const event = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'live-fixture', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      event({ role: 'assistant', content: '{"title":"Fixture","question":"Private live batch arrived' });
      finishInference = () => { finishInference = undefined; event({ content: '; Private final result","reviewArtifact":"intake.md","approvalOffered":false}' }); event({}, 'stop'); response.end('data: [DONE]\n\n'); };
      return;
    }
    const key = decodeURIComponent(url.pathname.slice('/live-bucket/'.length));
    const signed = request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=LIVEACCESS/') ?? false;
    calls.push({ key, signed, method: request.method!, actor: request.headers['amz-sdk-invocation-id'] ? 'producer' : 'viewer' });
    if (!signed || !url.pathname.startsWith('/live-bucket/')) { response.writeHead(403).end(); return; }
    if (url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix')!;
      response.setHeader('content-type', 'application/xml');
      response.end(`<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${[...objects].filter(([key]) => key.startsWith(prefix)).map(([key, body]) => `<Contents><Key>${encodeURIComponent(key)}</Key><Size>${Buffer.byteLength(body)}</Size></Contents>`).join('')}</ListBucketResult>`); return;
    }
    if (request.method === 'PUT') { const parts = []; for await (const part of request) parts.push(part); const body = Buffer.concat(parts).toString('utf8'); objects.set(key, body); if (!partialPublishedAt && key.includes('/chunks/') && body.includes('Private live batch arrived') && body.includes('text_delta')) partialPublishedAt = Date.now(); response.setHeader('ETag', '"' + createHash('sha256').update(body).digest('hex') + '"'); response.end(); return; }
    const body = objects.get(key);
    if (body === undefined) { response.writeHead(404, { 'content-type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>'); return; }
    const etag = '"' + createHash('sha256').update(body).digest('hex') + '"';
    if (request.headers['if-none-match'] === etag) { response.writeHead(304).end(); return; }
    response.writeHead(200, { ETag: etag, 'content-type': 'application/json' }).end(body);
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const home = await mkdtemp(join(tmpdir(), 'pi-live-paired-')), root = join(home, 'workspace'); await mkdir(root);
  const previous = { ...process.env }, abort = new AbortController();
  Object.assign(process.env, { INFERENCE_BASE_URL: endpoint + '/v1', INFERENCE_API_KEY: 'test', CF_ACCESS_CLIENT_ID: 'test', CF_ACCESS_CLIENT_SECRET: 'test', QRSPI_MODEL: 'test-model' });
  const store = new PrivateStore({ S3_CACHE_URL: endpoint, S3_CACHE_BUCKET: 'live-bucket', S3_CACHE_PREFIX: 'private', S3_CACHE_REGION: 'us-west-004', S3_CACHE_PATH_STYLE: 'true', S3_CACHE_ACCESS_KEY_ID: 'LIVEACCESS', S3_CACHE_SECRET_ACCESS_KEY: 'private-live-secret' });
  const binding = { workspace: 'demo', workspace_ref: 'ws-' + '1'.repeat(32), process: 'pilot', bead: 'task-live' }, executionId = '123-1';
  const relative = `processes/${digest(binding)}/executions/${executionId}/work/`, prefix = store.prefix + relative;
  const evidence = new ExecutionEvidence(binding, executionId, (key: string, value: unknown) => store.put(relative + key, value, { create: true }));
  const settle = await announceLive(store, evidence, 'work', { GITHUB_REPOSITORY: 'owner/engine', REVIEW_REPOSITORY: 'owner/storage', GITHUB_SHA: 'b'.repeat(40) });
  let done: Promise<void> | undefined;
  return { endpoint, prefix, calls, partialPublishedAt: () => partialPublishedAt, start() {
    done = (async () => {
      try {
        await specKitTurn(home, 'Return the fixture checkpoint.', { docs: {}, prefix: '', root, home, artifacts: { 'intake.md': '# Fixture' }, pins: {}, methodology: root, sources: { writable: false } },
          { id: 'parent', parentId: null, executionId, role: 'orchestrator', sourceSha: 'b'.repeat(40) }, async () => {}, async () => {}, evidence, { signal: abort.signal, timeoutMs: 90000 });
        await settle('completed');
      } catch (error) { await settle('failed').catch(() => {}); throw error; }
    })();
    void done.catch(() => {});
  }, async finish() { if (!finishInference) throw Error('Pi did not start its provider stream.'); finishInference(); await done; }, async dispose() {
    abort.abort(Error('Paired fixture disposed')); finishInference?.(); await done?.catch(() => {}); await evidence.close().catch(() => {});
    store.client.destroy(); server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok())); await rm(home, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous);
  } };
}
