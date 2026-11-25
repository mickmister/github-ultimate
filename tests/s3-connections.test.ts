import { beforeEach, expect, test } from 'vitest';
import { S3Connections, type S3ConnectionRecord, type S3ConnectionStore } from '../src/s3-connections';
import { s3BucketURL, type PublicS3Connection, type S3Object, type S3Listing } from '../src/s3-protocol';
import { indexedDB } from 'fake-indexeddb';
import { IndexedWorkspaceCacheStore } from '../src/indexed-workspace-cache';
import { CacheSettingsService } from '../src/cache-settings';
import { WorkspaceCache } from '../src/workspace-cache';
import { PiTelemetry } from '../hosted/pi-telemetry';

class MemoryStore implements S3ConnectionStore {
  records = new Map<string, S3ConnectionRecord>();
  async all() { return structuredClone([...this.records.values()]); }
  async get(id: string) { return structuredClone(this.records.get(id)); }
  async put(record: S3ConnectionRecord) { this.records.set(record.id, structuredClone(record)); }
  async remove(id: string) { this.records.delete(id); }
}
const config = { name: 'Staging storage', endpoint: 'https://objects.example.test/gateway/', region: 'auto', bucket: 'test-bucket', addressing: 'path' as const, prefix: 'workspace-a', accessKeyId: 'EXAMPLEACCESS', secretAccessKey: 'private-s3-secret', allowRead: true, allowUpload: true, allowOverwrite: false };
const origin = 'https://apps.example.test', documentURL = origin + '/storage/s3.html';
let store: MemoryStore, broker: S3Connections, calls: Request[], hostAllowed: boolean, objects: Map<string, Uint8Array>;
let override: ((request: Request) => Response | undefined) | undefined;
const bytes = new TextEncoder().encode('Private <script>object</script>');
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const scope = (record: PublicS3Connection) => ({ id: record.id, revision: record.revision });
beforeEach(() => {
  store = new MemoryStore(); calls = []; hostAllowed = true; objects = new Map([['workspace-a/note %.md', bytes]]); override = undefined;
  broker = new S3Connections(store, async input => {
    const request = input as Request; calls.push(request);
    const response = override?.(request); if (response) return response;
    const url = new URL(request.url);
    expect(url.origin).toBe('https://objects.example.test');
    expect(request.headers.get('Authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=EXAMPLEACCESS\/\d{8}\/auto\/s3\/aws4_request,/);
    if (url.searchParams.get('list-type') === '2') return new Response('<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;token</NextContinuationToken><Contents><Key>workspace-a%2Fnote%20%25.md</Key><Size>' + bytes.length + '</Size><ETag>etag</ETag></Contents></ListBucketResult>');
    const key = decodeURIComponent(url.pathname.slice('/gateway/test-bucket/'.length));
    if (request.method === 'PUT') {
      if (objects.has(key) && request.headers.get('If-None-Match') === '*') return new Response('sensitive provider detail', { status: 412 });
      objects.set(key, new Uint8Array(await request.arrayBuffer()));
      return new Response(null, { headers: { ETag: 'uploaded', 'x-amz-version-id': 'v2' } });
    }
    const body = objects.get(key);
    return body ? new Response(new Uint8Array(body).buffer, { headers: { 'Content-Type': 'text/plain', ETag: 'etag' } }) : new Response('', { status: 404 });
  }, async () => hostAllowed);
});
async function connect() {
  const record = await broker.handle({ operation: 'add', ...config }) as PublicS3Connection;
  await broker.handle({ operation: 'grantOrigin', id: record.id, origin, subpath: '/storage/' });
  return record;
}
test('Pi telemetry is bounded, append-only, session-bound and reauthorizes the original document', async () => {
  const record = await connect(), sessionId = crypto.randomUUID();
  const data = new PiTelemetry(sessionId, crypto.randomUUID()).data('success');
  const request = { operation: 's3PiTelemetry', ...scope(record), sessionId, base64: btoa(JSON.stringify(data)) };
  const receipt = await broker.handleHosted(documentURL, request) as { key: string; size: number };
  expect(receipt.key).toMatch(/^workspace-a\/telemetry\/pi-agent\/\d{4}-\d{2}-\d{2}\//);
  expect(JSON.parse(new TextDecoder().decode(objects.get(receipt.key)))).toEqual(data);
  expect(calls.at(-1)!.headers.get('If-None-Match')).toBe('*');
  expect(calls.at(-1)!.headers.get('Content-Type')).toBe('application/json');
  await expect(broker.handleHosted(documentURL, { ...request, sessionId: crypto.randomUUID() })).rejects.toThrow('identity');
  const bad = structuredClone(data); (bad.resourceSpans[0] as any).prompt = 'private data';
  await expect(broker.handleHosted(documentURL, { ...request, base64: btoa(JSON.stringify(bad)) })).rejects.toThrow();
  expect(() => broker.handleHosted(documentURL, { ...request, base64: 'A'.repeat(180000) })).toThrow();
  await expect(broker.handleHosted(origin + '/sibling/', request)).rejects.toThrow('not approved');
  await expect(broker.handleHosted(documentURL, { ...request, revision: crypto.randomUUID() })).rejects.toThrow('configuration changed');
  hostAllowed = false; await expect(broker.handleHosted(documentURL, request)).rejects.toThrow('revoked');
  expect(calls).toHaveLength(1);
  hostAllowed = true;
  await broker.handle({ operation: 'revokeOrigin', id: record.id, origin, subpath: '/storage/' });
  await expect(broker.handleHosted(documentURL, request)).rejects.toThrow('not approved');
});

test.each(['https://s3.us-west-004.backblazeb2.com', 'https://account.r2.cloudflarestorage.com'])('Pi telemetry respects provider PUT behavior at %s', async endpoint => {
  const record = await broker.handle({ operation: 'add', ...config, endpoint }) as PublicS3Connection;
  await broker.handle({ operation: 'grantOrigin', id: record.id, origin, subpath: '/storage/' });
  override = () => new Response(null);
  const sessionId = crypto.randomUUID(), base64 = btoa(JSON.stringify(new PiTelemetry(sessionId, crypto.randomUUID()).data('success')));
  await broker.handleHosted(documentURL, { operation: 's3PiTelemetry', ...scope(record), sessionId, base64 });
  expect(calls[0].headers.has('If-None-Match')).toBe(endpoint.includes('cloudflarestorage'));
  const updated = await broker.handle({ operation: 'update', id: record.id, ...config, endpoint, allowUpload: false }) as PublicS3Connection;
  await expect(broker.handleHosted(documentURL, { operation: 's3PiTelemetry', ...scope(updated), sessionId, base64 })).rejects.toThrow('not enabled');
});
test('live polling returns typed missing only for opt-in 404 and rechecks publication without masking access failures', async () => {
  expect(await broker.handleHosted(documentURL, { operation: 's3Capabilities' })).toEqual({ protocolVersion: 1, capabilities: ['s3AllowMissing'] });
  expect(await broker.handleHosted(documentURL, { operation: 's3Connections' })).toEqual([]);
  const record = await connect(), key = 'workspace-a/chunks/000001.json';
  const request = { operation: 's3Read', ...scope(record), key, allowMissing: true };
  expect(await broker.handleHosted(documentURL, request)).toEqual({ key, missing: true });
  objects.set(key, new TextEncoder().encode('{}'));
  expect(await broker.handleHosted(documentURL, request)).toMatchObject({ key, base64: btoa('{}') });
  objects.delete(key);
  await expect(broker.handleHosted(documentURL, { ...request, allowMissing: false })).rejects.toThrow('404');
  override = () => new Response('private details', { status: 403 });
  await expect(broker.handleHosted(documentURL, request)).rejects.toThrow('403');
  override = () => new Response('private details', { status: 503 });
  await expect(broker.handleHosted(documentURL, request)).rejects.toThrow('503');
});
test('signs paginated list/read/upload requests, preserves literal object keys and never exposes credentials', async () => {
  const record = await connect();
  const listing = await broker.handleHosted(documentURL, { operation: 's3List', ...scope(record) }) as S3Listing;
  expect(listing).toEqual({ objects: [{ key: 'workspace-a/note %.md', size: bytes.length, etag: 'etag' }], continuationToken: 'next&token' });
  await broker.handleHosted(documentURL, { operation: 's3List', ...scope(record), continuationToken: listing.continuationToken });
  expect(new URL(calls[1].url).searchParams.get('continuation-token')).toBe('next&token');
  const read = await broker.handleHosted(documentURL, { operation: 's3Read', ...scope(record), key: 'workspace-a/note %.md' }) as S3Object;
  expect(read.base64).toBe(encode(bytes));
  expect(new URL(calls[2].url).pathname).toBe('/gateway/test-bucket/workspace-a/note%20%25.md');
  const upload = await broker.handleHosted(documentURL, { operation: 's3Upload', ...scope(record), key: 'workspace-a/new.bin', base64: encode(new Uint8Array([0, 255, 128, 1])) });
  expect(upload).toMatchObject({ key: 'workspace-a/new.bin', size: 4, etag: 'uploaded', versionId: 'v2' });
  expect(objects.get('workspace-a/new.bin')).toEqual(new Uint8Array([0, 255, 128, 1]));
  expect(calls.at(-1)!.headers.get('If-None-Match')).toBe('*');
  expect(calls.at(-1)!.headers.get('Authorization')).toContain('if-none-match');
  expect(JSON.stringify([record, await broker.handle({ operation: 'list' }), await broker.handleHosted(documentURL, { operation: 's3Connections' })])).not.toMatch(/private-s3-secret|EXAMPLEACCESS/);
});
test('denies sibling documents, prefix escapes, unsupported operations and revoked host access before network activity', async () => {
  const record = await connect();
  for (const request of [
    { operation: 's3Read', ...scope(record), key: 'workspace-ab/secret' },
    { operation: 's3Read', ...scope(record), key: 'workspace-a/../secret' },
    { operation: 's3List', ...scope(record), prefix: '' },
  ]) await expect(broker.handleHosted(documentURL, request)).rejects.toThrow();
  await expect(broker.handleHosted(origin + '/sibling/', { operation: 's3Read', ...scope(record), key: 'workspace-a/note' })).rejects.toThrow('not approved');
  expect(await broker.handleHosted(origin + '/sibling/', { operation: 's3Connections' })).toEqual([]);
  expect(() => broker.handleHosted(documentURL, { operation: 's3Read', ...scope(record), key: 'workspace-a/note', endpoint: 'https://evil.test' })).toThrow();
  expect(() => broker.handleHosted(documentURL, { operation: 's3Upload', id: record.id, key: 'workspace-a/note', base64: '' })).toThrow();
  hostAllowed = false;
  await expect(broker.handleHosted(documentURL, { operation: 's3Read', ...scope(record), key: 'workspace-a/note' })).rejects.toThrow('revoked');
  expect(calls).toHaveLength(0);
});
test('create-only upload never retries an existing key; explicit connection update can enable replacement and rotate credentials', async () => {
  const record = await connect();
  const request = { operation: 's3Upload', ...scope(record), key: 'workspace-a/note %.md', base64: btoa('Updated') };
  await expect(broker.handleHosted(documentURL, request)).rejects.toThrow('already exists');
  expect(calls).toHaveLength(1); expect(objects.get(request.key)).toEqual(bytes);
  const updated = await broker.handle({ operation: 'update', id: record.id, ...config, allowOverwrite: true }) as PublicS3Connection;
  expect(updated.hostedGrants).toHaveLength(1);
  await expect(broker.handleHosted(documentURL, request)).rejects.toThrow('configuration changed');
  expect(calls).toHaveLength(1);
  request.revision = updated.revision;
  await broker.handleHosted(documentURL, request);
  expect(calls.at(-1)!.headers.has('If-None-Match')).toBe(false);
  expect(new TextDecoder().decode(objects.get(request.key))).toBe('Updated');
  await broker.handle({ operation: 'update', id: record.id, ...config, secretAccessKey: 'rotated-private-secret' });
  expect((await store.get(record.id))!.secretAccessKey).toBe('rotated-private-secret');
  await broker.handle({ operation: 'revokeOrigin', id: record.id, origin, subpath: '/storage/' });
  await expect(broker.handleHosted(documentURL, request)).rejects.toThrow('not approved');
});
test('config-only edits retain private credentials, preserve grants and invalidate the old revision', async () => {
  const record = await connect();
  await broker.handle({ operation: 'update', id: record.id, ...config, sessionToken: 'saved-private-session-token' });
  const { accessKeyId: _key, secretAccessKey: _secret, ...publicConfig } = config;
  const updated = await broker.handle({ operation: 'update', id: record.id, ...publicConfig, allowOverwrite: true, name: 'Renamed storage' }) as PublicS3Connection;
  expect(await store.get(record.id)).toMatchObject({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, sessionToken: 'saved-private-session-token', allowOverwrite: true, name: 'Renamed storage' });
  expect(updated.hostedGrants).toHaveLength(1); expect(updated.revision).not.toBe(record.revision);
  expect(JSON.stringify([updated, await broker.handle({ operation: 'list' }), await broker.handleHosted(documentURL, { operation: 's3Connections' })])).not.toMatch(/EXAMPLEACCESS|private-s3-secret|saved-private-session-token/);
  await expect(broker.handleHosted(documentURL, { operation: 's3Read', ...scope(record), key: 'workspace-a/note %.md' })).rejects.toThrow('configuration changed');
  await broker.handleHosted(documentURL, { operation: 's3Read', ...scope(updated), key: 'workspace-a/note %.md' });
  expect(calls.at(-1)!.headers.get('X-Amz-Security-Token')).toBe('saved-private-session-token');
  await broker.handle({ operation: 'update', id: record.id, ...publicConfig, secretAccessKey: 'rotated-only-secret' });
  expect(await store.get(record.id)).toMatchObject({ accessKeyId: config.accessKeyId, secretAccessKey: 'rotated-only-secret', sessionToken: 'saved-private-session-token' });
  await broker.handle({ operation: 'update', id: record.id, ...publicConfig, sessionToken: '' });
  expect((await store.get(record.id))!.sessionToken).toBe('');
  expect(() => broker.handle({ operation: 'add', ...publicConfig })).toThrow();
  expect(() => broker.handle({ operation: 'update', id: record.id, ...publicConfig, secretAccessKey: '' })).toThrow();
});
test('read-only and upload-only connections enforce operation grants', async () => {
  const record = await connect();
  const readOnly = await broker.handle({ operation: 'update', id: record.id, ...config, allowUpload: false }) as PublicS3Connection;
  await expect(broker.handleHosted(documentURL, { operation: 's3Upload', ...scope(readOnly), key: 'workspace-a/new', base64: '' })).rejects.toThrow('not enabled');
  const uploadOnly = await broker.handle({ operation: 'update', id: record.id, ...config, allowRead: false }) as PublicS3Connection;
  await expect(broker.handleHosted(documentURL, { operation: 's3Read', ...scope(uploadOnly), key: 'workspace-a/new' })).rejects.toThrow('not enabled');
  expect(calls).toHaveLength(0);
});
test('bounds transfer sizes, rejects entity definitions and rejects out-of-prefix provider listings', async () => {
  const record = await connect();
  override = () => new Response('small', { headers: { 'Content-Length': String(9 * 1024 * 1024) } });
  await expect(broker.handleHosted(documentURL, { operation: 's3Read', ...scope(record), key: 'workspace-a/note' })).rejects.toThrow('size limit');
  override = () => new Response('<!DOCTYPE x [<!ENTITY e "private">]><ListBucketResult/>');
  await expect(broker.handleHosted(documentURL, { operation: 's3List', ...scope(record) })).rejects.toThrow('Unsupported');
  override = () => new Response('<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>outside/secret</Key><Size>1</Size></Contents></ListBucketResult>');
  await expect(broker.handleHosted(documentURL, { operation: 's3List', ...scope(record) })).rejects.toThrow('outside');
  const before = calls.length;
  await expect(broker.handleHosted(documentURL, { operation: 's3Upload', ...scope(record), key: 'workspace-a/note', base64: 'not base64' })).rejects.toThrow('base64');
  expect(calls).toHaveLength(before);
});
test('supports custom endpoint paths and virtual buckets without credentials or redirects in URLs', () => {
  expect(s3BucketURL(config).href).toBe('https://objects.example.test/gateway/test-bucket/');
  expect(s3BucketURL({ ...config, addressing: 'virtual' }).href).toBe('https://test-bucket.objects.example.test/gateway/');
  for (const endpoint of ['https://user:secret@objects.example.test', 'https://objects.example.test?token=secret', 'http://untrusted.test']) expect(() => s3BucketURL({ ...config, endpoint })).toThrow();
  expect(s3BucketURL({ ...config, endpoint: 'http://127.0.0.1:9000', addressing: 'path' }).origin).toBe('http://127.0.0.1:9000');
});

test('S3 cache survives broker replacement, revalidates ETags, enforces grants and invalidates after upload', async () => {
  Object.assign(globalThis, { indexedDB });
  const name = crypto.randomUUID(), settings = new CacheSettingsService({ async getItem() { return null; }, async setItem() {} });
  const cache = () => new WorkspaceCache(new IndexedWorkspaceCacheStore(name), settings);
  let hits = 0;
  const provider: typeof fetch = async input => {
    hits++;
    const request = input as Request;
    if (request.method === 'PUT') return new Response(null, { headers: { ETag: 'new' } });
    if (request.headers.has('If-None-Match')) { expect(request.headers.get('If-None-Match')).toBe('"v1"'); return new Response(null, { status: 304 }); }
    return new Response('body', { headers: { ETag: '"v1"', 'Content-Type': 'text/plain' } });
  };
  broker = new S3Connections(store, provider, async () => hostAllowed, cache());
  const record = await connect(), read = { operation: 's3Read', ...scope(record), key: 'workspace-a/cache.txt' };
  const first = await broker.handleHosted(documentURL, read);
  broker = new S3Connections(store, provider, async () => hostAllowed, cache());
  expect(await broker.handleHosted(documentURL, { ...read, cacheOnly: true })).toEqual(first); expect(hits).toBe(1);
  expect(await broker.handleHosted(documentURL, read)).toEqual(first); expect(hits).toBe(2);
  hostAllowed = false;
  await expect(broker.handleHosted(documentURL, { ...read, cacheOnly: true })).rejects.toThrow('revoked');
  hostAllowed = true;
  await broker.handleHosted(documentURL, { operation: 's3Upload', ...scope(record), key: read.key, base64: btoa('new') });
  await expect(broker.handleHosted(documentURL, { ...read, cacheOnly: true })).rejects.toThrow('No persisted');
  expect(hits).toBe(3);
});

test('Backblaze checkpoints use broker-owned unique keys without conditional PUT, and pin exact versions on read/list', async () => {
  const record = await broker.handle({ operation: 'add', ...config, endpoint: 'https://s3.us-west-004.backblazeb2.com/' }) as PublicS3Connection;
  await broker.handle({ operation: 'grantOrigin', id: record.id, origin, subpath: '/storage/' });
  const sessionId = crypto.randomUUID(), payload = btoa(JSON.stringify({ kind: 'browser-pi-checkpoint', session_id: sessionId }));
  override = request => {
    const url = new URL(request.url);
    if (request.method === 'PUT') { expect(request.headers.has('If-None-Match')).toBe(false); expect(url.pathname).toContain(`/workspace-a/pi-sessions/${sessionId}/`); return new Response(null, { headers: { 'x-amz-version-id': 'version-one' } }); }
    if (url.searchParams.has('versions')) return new Response(`<ListVersionsResult><EncodingType>url</EncodingType><IsTruncated>true</IsTruncated><NextKeyMarker>${encodeURIComponent(`workspace-a/pi-sessions/${sessionId}/key.json`)}</NextKeyMarker><NextVersionIdMarker>version-one</NextVersionIdMarker><Version><Key>${encodeURIComponent(`workspace-a/pi-sessions/${sessionId}/key.json`)}</Key><VersionId>version-one</VersionId><Size>2</Size></Version></ListVersionsResult>`);
    expect(url.searchParams.get('versionId')).toBe('version-one'); return new Response('{}', { headers: { 'x-amz-version-id': 'version-one' } });
  };
  const first = await broker.handleHosted(documentURL, { operation: 's3Checkpoint', ...scope(record), sessionId, base64: payload }) as { key: string; sha256: string; versionId: string };
  const second = await broker.handleHosted(documentURL, { operation: 's3Checkpoint', ...scope(record), sessionId, base64: payload }) as { key: string };
  expect(first.key).not.toBe(second.key); expect(first.key).toMatch(new RegExp(`-${first.sha256}\\.json$`)); expect(first.versionId).toBe('version-one');
  expect(await broker.handleHosted(documentURL, { operation: 's3Read', ...scope(record), key: first.key, versionId: first.versionId })).toMatchObject({ versionId: 'version-one' });
  const listing = await broker.handleHosted(documentURL, { operation: 's3List', ...scope(record), prefix: `workspace-a/pi-sessions/${sessionId}/`, versions: true }) as S3Listing;
  expect(listing.objects[0].versionId).toBe('version-one');
  await broker.handleHosted(documentURL, { operation: 's3List', ...scope(record), prefix: `workspace-a/pi-sessions/${sessionId}/`, versions: true, continuationToken: listing.continuationToken });
  expect(new URL(calls.at(-1)!.url).searchParams.get('version-id-marker')).toBe('version-one');
  override = () => new Response(null);
  await expect(broker.handleHosted(documentURL, { operation: 's3Checkpoint', ...scope(record), sessionId, base64: payload })).rejects.toThrow('version ID');
  override = () => new Response('{}', { headers: { 'x-amz-version-id': 'wrong-version' } });
  await expect(broker.handleHosted(documentURL, { operation: 's3Read', ...scope(record), key: first.key, versionId: first.versionId })).rejects.toThrow('different object version');
});


test('R2 checkpoint receipts ignore opaque version headers and retain conditional creation', async () => {
  const record = await broker.handle({ operation: 'add', ...config, endpoint: 'https://account.r2.cloudflarestorage.com/' }) as PublicS3Connection;
  await broker.handle({ operation: 'grantOrigin', id: record.id, origin, subpath: '/storage/' });
  const sessionId = crypto.randomUUID(), json = JSON.stringify({ kind: 'browser-pi-checkpoint', session_id: sessionId });
  override = request => {
    const url = new URL(request.url);
    expect(url.searchParams.has('versionId')).toBe(false);
    if (request.method === 'PUT') { expect(request.headers.get('If-None-Match')).toBe('*'); return new Response(null, { headers: { 'x-amz-version-id': 'opaque-r2-id' } }); }
    return new Response(json, { headers: { 'x-amz-version-id': 'opaque-r2-id' } });
  };
  const receipt = await broker.handleHosted(documentURL, { operation: 's3Checkpoint', ...scope(record), sessionId, base64: btoa(json) }) as { key: string; versionId?: string };
  expect(receipt.versionId).toBeUndefined();
  const read = { operation: 's3Read', ...scope(record), key: receipt.key };
  expect((await broker.handleHosted(documentURL, read) as S3Object).versionId).toBeUndefined();
  const before = calls.length;
  await expect(broker.handleHosted(documentURL, { ...read, versionId: 'opaque-r2-id' })).rejects.toThrow('does not support version-specific');
  await expect(broker.handleHosted(documentURL, { operation: 's3List', ...scope(record), prefix: 'workspace-a/', versions: true })).rejects.toThrow('does not support version-specific');
  expect(calls.length).toBe(before);
});
