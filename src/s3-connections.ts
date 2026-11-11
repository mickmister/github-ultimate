import { AwsClient } from 'aws4fetch';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { ConnectionError } from './connections';
import { loadedDocument, matchesGrant, trustedSubpath, type HostedGrant } from './hosted-access';
import { trustedOrigin } from './hosted-protocol';
import { maxS3ObjectBytes, s3BucketURL, s3HostedSchema, s3Key, s3Prefix, s3SettingsSchema, type S3Configuration, type PublicS3Connection, type S3Listing, type S3Object } from './s3-protocol';

export type S3ConnectionRecord = S3Configuration & { id: string; revision: string; hostedGrants: HostedGrant[] };
export interface S3ConnectionStore {
  all(): Promise<S3ConnectionRecord[]>;
  get(id: string): Promise<S3ConnectionRecord | undefined>;
  put(record: S3ConnectionRecord): Promise<void>;
  remove(id: string): Promise<void>;
}
function publicConnection(record: S3ConnectionRecord): PublicS3Connection {
  const { id, revision, name, endpoint, region, bucket, addressing, prefix, allowRead, allowUpload, allowOverwrite, hostedGrants } = record;
  return { id, revision, name, endpoint, region, bucket, addressing, prefix, allowRead, allowUpload, allowOverwrite, hostedGrants };
}
async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get('Content-Length')) > limit) { await response.body?.cancel(); throw new ConnectionError('S3 response exceeded the size limit.'); }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new ConnectionError('S3 response exceeded the size limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function base64(bytes: Uint8Array) {
  let raw = ''; for (let i = 0; i < bytes.length; i += 16384) raw += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(raw);
}

// Credentials and SigV4 signing stay in the privileged broker. Hosted requests
// never select endpoints/headers, and replies never contain credentials.
export class S3Connections {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private store: S3ConnectionStore, private fetcher: typeof fetch = (...args) => fetch(...args), private hasHostAccess: (origin: string) => Promise<boolean> = async () => true) {}
  private serialize<T>(work: () => Promise<T>) {
    const result = this.tail.catch(() => {}).then(work); this.tail = result; return result;
  }
  handle(input: unknown) {
    const request = s3SettingsSchema.parse(input);
    return this.serialize(async () => {
      if (request.operation === 'list') return (await this.store.all()).map(publicConnection);
      if (request.operation === 'add' || request.operation === 'update') {
        const existing = request.operation === 'update' ? await this.store.get(request.id) : undefined;
        if (request.operation === 'update' && !existing) throw new ConnectionError('S3 connection no longer exists.');
        const { operation: _, ...config } = request;
        const target = s3BucketURL(config);
        if (!await this.hasHostAccess(target.origin)) throw new ConnectionError('Browser host access to the S3 endpoint was not granted.');
        const record: S3ConnectionRecord = { ...config, endpoint: new URL(config.endpoint).href, prefix: s3Prefix(config.prefix), id: existing?.id ?? crypto.randomUUID(), revision: crypto.randomUUID(), hostedGrants: existing?.hostedGrants ?? [] };
        await this.store.put(record); return publicConnection(record);
      }
      const record = await this.store.get(request.id);
      if (!record) throw new ConnectionError('S3 connection no longer exists.');
      if (request.operation === 'remove') { await this.store.remove(record.id); return null; }
      const grant = { origin: trustedOrigin(request.origin), subpath: trustedSubpath(request.subpath) };
      if (request.operation === 'grantOrigin') {
        const replace = request.replace && { origin: trustedOrigin(request.replace.origin), subpath: trustedSubpath(request.replace.subpath) };
        record.hostedGrants = record.hostedGrants.filter(item => !replace || item.origin !== replace.origin || item.subpath !== replace.subpath);
        if (!record.hostedGrants.some(item => item.origin === grant.origin && item.subpath === grant.subpath)) record.hostedGrants.push(grant);
      } else record.hostedGrants = record.hostedGrants.filter(item => item.origin !== grant.origin || item.subpath !== grant.subpath);
      await this.store.put(record); return publicConnection(record);
    });
  }
  handleHosted(documentURL: string, input: unknown) {
    const document = loadedDocument(documentURL), request = s3HostedSchema.parse(input);
    return this.serialize(async () => {
      const approved = (await this.store.all()).filter(record => record.hostedGrants.some(grant => matchesGrant(grant, document)));
      if (request.operation === 's3Connections') return approved.map(publicConnection);
      const record = approved.find(item => item.id === request.id);
      if (!record) throw new ConnectionError('S3 connection is not approved for the original document path.');
      if (record.revision !== request.revision) throw new ConnectionError('S3 configuration changed. Reconnect storage before reading or uploading; no fallback was used.');
      if (request.operation === 's3Upload' ? !record.allowUpload : !record.allowRead) throw new ConnectionError('This S3 operation is not enabled for the connection.');
      const url = s3BucketURL(record);
      if (!await this.hasHostAccess(url.origin)) throw new ConnectionError('Browser host access to the S3 endpoint was revoked.');
      const path = s3Key(request.operation === 's3List' ? request.prefix ?? record.prefix : request.key);
      if (!path.startsWith(record.prefix)) throw new ConnectionError('The object key or listing prefix is outside this connection’s allowed prefix.');
      if (request.operation === 's3List') {
        url.searchParams.set('list-type', '2'); url.searchParams.set('max-keys', '100'); url.searchParams.set('prefix', path); url.searchParams.set('encoding-type', 'url');
        if (request.continuationToken) url.searchParams.set('continuation-token', request.continuationToken);
        const xml = new TextDecoder('utf-8', { fatal: true }).decode(await boundedBytes(await this.send(record, url), 2 * 1024 * 1024));
        if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ConnectionError('Unsupported S3 XML response.');
        let data: unknown;
        try { data = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: false, isArray: name => name === 'Contents' }).parse(xml); }
        catch { throw new ConnectionError('Invalid S3 listing response.'); }
        const result = z.object({ ListBucketResult: z.object({ EncodingType: z.string().optional(), IsTruncated: z.enum(['true', 'false']), NextContinuationToken: z.string().min(1).max(8192).optional(), Contents: z.array(z.object({ Key: z.string(), Size: z.string().regex(/^\d+$/), ETag: z.string().optional() })).default([]) }) }).safeParse(data);
        if (!result.success) throw new ConnectionError('Invalid S3 listing response.');
        const listing = result.data.ListBucketResult;
        if (listing.Contents.length > 100 || listing.IsTruncated === 'true' && !listing.NextContinuationToken) throw new ConnectionError('Incomplete or oversized S3 listing response.');
        const objects = listing.Contents.map(item => {
          let key: string; try { key = listing.EncodingType === 'url' ? decodeURIComponent(item.Key) : item.Key; } catch { throw new ConnectionError('Invalid S3 object key encoding.'); }
          const size = Number(item.Size);
          if (!key.startsWith(path) || !key.startsWith(record.prefix) || !Number.isSafeInteger(size) || size < 0) throw new ConnectionError('S3 returned an object outside the requested prefix or an invalid size.');
          return { key, size, etag: item.ETag };
        });
        return { objects, ...(listing.IsTruncated === 'true' ? { continuationToken: listing.NextContinuationToken } : {}) } satisfies S3Listing;
      }
      // Encode keys once, preserving literal % and slash structure. Dot segments
      // are rejected before URL construction so they cannot escape the bucket.
      url.pathname += path.split('/').map(encodeURIComponent).join('/');
      if (request.operation === 's3Read') {
        const response = await this.send(record, url);
        const bytes = await boundedBytes(response, maxS3ObjectBytes);
        return { key: path, size: bytes.length, contentType: response.headers.get('Content-Type') ?? 'application/octet-stream', base64: base64(bytes), etag: response.headers.get('ETag') ?? undefined, versionId: response.headers.get('x-amz-version-id') ?? undefined } satisfies S3Object;
      }
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.base64)) throw new ConnectionError('Upload must contain canonical base64 bytes.');
      const bytes = Uint8Array.from(atob(request.base64), char => char.charCodeAt(0));
      if (bytes.length > maxS3ObjectBytes) throw new ConnectionError('Upload exceeds the 8 MiB object limit.');
      const response = await this.send(record, url, { method: 'PUT', body: bytes.buffer, headers: { 'Content-Type': request.contentType, ...(!record.allowOverwrite ? { 'If-None-Match': '*' } : {}) } });
      await response.body?.cancel();
      return { key: path, size: bytes.length, etag: response.headers.get('ETag') ?? undefined, versionId: response.headers.get('x-amz-version-id') ?? undefined };
    });
  }
  private async send(record: S3ConnectionRecord, url: URL, init: RequestInit = {}) {
    const client = new AwsClient({ accessKeyId: record.accessKeyId, secretAccessKey: record.secretAccessKey, sessionToken: record.sessionToken, service: 's3', region: record.region, retries: 0 });
    const signed = await client.sign(url, { ...init, aws: { allHeaders: true } });
    let response: Response;
    try { response = await this.fetcher(signed, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
    catch { throw new ConnectionError('S3 request failed or timed out. Check endpoint, region, credentials and browser host access.'); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 412) throw new ConnectionError('That object already exists. This connection does not permit replacement; choose another key.');
      throw new ConnectionError(`S3 returned HTTP ${response.status}. Check access and endpoint compatibility. No automatic retry or overwrite fallback was used.`);
    }
    return response;
  }
}
