import { beforeEach, expect, test } from 'vitest';
import { S3Connections, type S3ConnectionRecord, type S3ConnectionStore } from '../src/s3-connections';
import { s3BucketURL, type PublicS3Connection, type S3Object, type S3Listing } from '../src/s3-protocol';
import { indexedDB } from 'fake-indexeddb';
import { IndexedWorkspaceCacheStore } from '../src/indexed-workspace-cache';
import { CacheSettingsService } from '../src/cache-settings';
import { WorkspaceCache } from '../src/workspace-cache';

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
