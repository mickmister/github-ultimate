import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { utf8Text } from './utf8';
import { ConnectionError } from './connections';
import { loadedDocument, matchesGrant, trustedSubpath, type HostedGrant } from './hosted-access';
import { trustedOrigin } from './hosted-protocol';
import { maxS3ObjectBytes, s3BucketURL, s3HostedSchema, s3Key, s3Prefix, s3SettingsSchema, s3ConfigurationSchema, backblaze, cloudflareR2, type S3Configuration, type PublicS3Connection, type S3Listing, type S3Object } from './s3-protocol';
import type { CacheScope, WorkspaceCache } from './workspace-cache';
import { maxPiTelemetryBytes, piTelemetrySchema } from './pi-telemetry-protocol';

export type S3ConnectionRecord = S3Configuration & { id: string; revision: string; hostedGrants: HostedGrant[] };
export interface S3ConnectionStore {
  all(): Promise<S3ConnectionRecord[]>;
  get(id: string): Promise<S3ConnectionRecord | undefined>;
  put(record: S3ConnectionRecord): Promise<void>;
  remove(id: string): Promise<void>;
}
const cachedObjectSchema = z.object({ key: z.string().max(1024), size: z.number().int().min(0).max(maxS3ObjectBytes), contentType: z.string().max(1000), base64: z.string().max(Math.ceil(maxS3ObjectBytes / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/), etag: z.string().optional(), versionId: z.string().optional() });
const cachedListingSchema = z.object({ objects: z.array(z.object({ key: z.string().max(1024), size: z.number().int().nonnegative(), etag: z.string().optional(), versionId: z.string().optional() })).max(100), continuationToken: z.string().max(8192).optional() });
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
  private epoch = 0;
  constructor(private store: S3ConnectionStore, private fetcher: typeof fetch = (...args) => fetch(...args), private hasHostAccess: (origin: string) => Promise<boolean> = async () => true, private cache?: WorkspaceCache, private newId: () => string = () => crypto.randomUUID(), private signer?: (record: S3ConnectionRecord, url: URL, init: RequestInit) => Promise<Request>, private timeout = (ms: number) => AbortSignal.timeout(ms)) {}
  private serialize<T>(work: () => Promise<T>) {
    const result = this.tail.catch(() => {}).then(work); this.tail = result; return result;
  }
  handle(input: unknown) {
    const request = s3SettingsSchema.parse(input);
    if (request.operation !== 'list') this.epoch++;
    return this.serialize(async () => {
      if (request.operation === 'list') return (await this.store.all()).map(publicConnection);
      if (request.operation === 'add' || request.operation === 'update') {
        const existing = request.operation === 'update' ? await this.store.get(request.id) : undefined;
        if (request.operation === 'update' && !existing) throw new ConnectionError('S3 connection no longer exists.');
        const fields: Record<string, unknown> = { ...request }; delete fields.operation; delete fields.id;
        const config = s3ConfigurationSchema.parse({ ...fields,
          accessKeyId: request.accessKeyId ?? existing?.accessKeyId,
          secretAccessKey: request.secretAccessKey ?? existing?.secretAccessKey,
          sessionToken: request.sessionToken ?? existing?.sessionToken,
        });
        const target = s3BucketURL(config);
        if (!await this.hasHostAccess(target.origin)) throw new ConnectionError('Browser host access to the S3 endpoint was not granted.');
        const record: S3ConnectionRecord = { ...config, endpoint: new URL(config.endpoint).href, prefix: s3Prefix(config.prefix), id: existing?.id ?? this.newId(), revision: this.newId(), hostedGrants: existing?.hostedGrants ?? [] };
        await this.store.put(record); if (existing) await this.cache?.clearConnection(`s3:${record.id}`).catch(() => {}); return publicConnection(record);
      }
      const record = await this.store.get(request.id);
      if (!record) throw new ConnectionError('S3 connection no longer exists.');
      if (request.operation === 'remove') { await this.store.remove(record.id); await this.cache?.clearConnection(`s3:${record.id}`).catch(() => {}); return null; }
      const grant = { origin: trustedOrigin(request.origin), subpath: trustedSubpath(request.subpath) };
      if (request.operation === 'grantOrigin') {
        const replace = request.replace && { origin: trustedOrigin(request.replace.origin), subpath: trustedSubpath(request.replace.subpath) };
        record.hostedGrants = record.hostedGrants.filter(item => !replace || item.origin !== replace.origin || item.subpath !== replace.subpath);
        if (!record.hostedGrants.some(item => item.origin === grant.origin && item.subpath === grant.subpath)) record.hostedGrants.push(grant);
      } else record.hostedGrants = record.hostedGrants.filter(item => item.origin !== grant.origin || item.subpath !== grant.subpath);
      await this.store.put(record); if (request.operation === 'revokeOrigin') await this.cache?.clearConnection(`s3:${record.id}`).catch(() => {}); return publicConnection(record);
    });
  }
  handleHosted(documentURL: string, input: unknown, current: () => boolean = () => true) {
    const document = loadedDocument(documentURL), request = s3HostedSchema.parse(input);
    const epoch = this.epoch;
    return this.serialize(async () => {
      if (!current() || epoch !== this.epoch) throw new ConnectionError('S3 document or access changed.');
      const approved = (await this.store.all()).filter(record => record.hostedGrants.some(grant => matchesGrant(grant, document)));
      // Public protocol information; data operations still require their own
      // original-document grant. S3-only readers need no GitHub connection.
      if (request.operation === 's3Capabilities') return { protocolVersion: 1, capabilities: ['s3AllowMissing'] };
      if (request.operation === 's3Connections') return approved.map(publicConnection);
      const record = approved.find(item => item.id === request.id);
      if (!record) throw new ConnectionError('S3 connection is not approved for the original document path.');
      if (record.revision !== request.revision) throw new ConnectionError('S3 configuration changed. Reconnect storage before reading or uploading; no fallback was used.');
      const upload = request.operation === 's3Upload' || request.operation === 's3Checkpoint' || request.operation === 's3PiTelemetry';
      if (upload ? !record.allowUpload : !record.allowRead) throw new ConnectionError('This S3 operation is not enabled for the connection.');
      const url = s3BucketURL(record);
      if (!await this.hasHostAccess(url.origin)) throw new ConnectionError('Browser host access to the S3 endpoint was revoked.');
      if (request.operation === 's3PiTelemetry') {
        if (record.allowOverwrite) throw new ConnectionError('Pi telemetry requires overwrites disabled.');
        const bytes = Uint8Array.from(atob(request.base64), char => char.charCodeAt(0));
        if (base64(bytes) !== request.base64 || bytes.length > maxPiTelemetryBytes) throw new ConnectionError('Invalid Pi telemetry bytes or exceeds 128 KiB.');
        const data = piTelemetrySchema.parse(JSON.parse(utf8Text(bytes)));
        const spans = data.resourceSpans[0].scopeSpans[0].spans, root = spans[0];
        if (root.name !== 'pi.agent.invocation' || root.parentSpanId || !root.attributes.some(item => item.key === 'pi.conversation.id' && 'stringValue' in item.value && item.value.stringValue === request.sessionId) || spans.some(span => span.traceId !== root.traceId || BigInt(span.endTimeUnixNano) < BigInt(span.startTimeUnixNano))) throw new ConnectionError('Invalid Pi telemetry trace identity.');
        const key = s3Key(`${record.prefix}telemetry/pi-agent/${new Date().toISOString().slice(0, 10)}/${request.sessionId}/${root.traceId}-${this.newId()}.otel.json`);
        url.pathname += key.split('/').map(encodeURIComponent).join('/');
        const response = await this.send(record, url, { method: 'PUT', body: bytes.buffer, headers: { 'Content-Type': 'application/json', ...(!backblaze(record.endpoint) ? { 'If-None-Match': '*' } : {}) } }, false, current);
        await response.body?.cancel();
        return { key, size: bytes.length };
      }
      if (request.operation === 's3Checkpoint') {
        if (record.allowOverwrite || !record.allowRead) throw new ConnectionError('Checkpoints require reads/uploads enabled and overwrites disabled.');
        const bytes = Uint8Array.from(atob(request.base64), char => char.charCodeAt(0));
        if (base64(bytes) !== request.base64 || bytes.length > 4 * 1024 * 1024) throw new ConnectionError('Invalid checkpoint bytes or exceeds 4 MiB.');
        const header = z.object({ kind: z.literal('browser-pi-checkpoint'), session_id: z.literal(request.sessionId) }).safeParse(JSON.parse(utf8Text(bytes)));
        if (!header.success) throw new ConnectionError('Checkpoint session identity mismatch.');
        const digest = bytesToHex(sha256(bytes));
        const key = s3Key(`${record.prefix}pi-sessions/${request.sessionId}/${new Date().toISOString().replace(/[:.]/g, '-')}-${this.newId()}-${digest}.json`);
        url.pathname += key.split('/').map(encodeURIComponent).join('/');
        const versioned = backblaze(record.endpoint);
        const response = await this.send(record, url, { method: 'PUT', body: bytes.buffer, headers: { 'Content-Type': 'application/json', ...(!versioned ? { 'If-None-Match': '*' } : {}) } }, false, current);
        await response.body?.cancel();
        const rawVersionId = cloudflareR2(record.endpoint) ? null : response.headers.get('x-amz-version-id');
        const versionId = rawVersionId && rawVersionId !== 'null' ? rawVersionId : undefined;
        if (versioned && (!versionId || versionId === 'null')) throw new ConnectionError('Backblaze did not return a checkpoint version ID. Save was not verified.');
        await this.cache?.clearConnection(`s3:${record.id}`).catch(() => {});
        return { key, size: bytes.length, versionId, sha256: digest };
      }
      if (cloudflareR2(record.endpoint) && (request.operation === 's3List' && request.versions || request.operation === 's3Read' && request.versionId)) throw new ConnectionError('R2 does not support version-specific object operations.');
      const path = s3Key(request.operation === 's3List' ? request.prefix ?? record.prefix : request.key);
      if (!path.startsWith(record.prefix)) throw new ConnectionError('The object key or listing prefix is outside this connection’s allowed prefix.');
      const scope: CacheScope = { connection: `s3:${record.id}`, account: 0, installation: 0, generation: record.revision, repository: record.endpoint + record.bucket, workspace: record.prefix, namespace: 'metadata' };
      const resource = JSON.stringify([request.operation, path, request.operation === 's3List' ? request.versions ? ['versions', request.continuationToken ?? ''] : request.continuationToken ?? '' : request.operation === 's3Read' && request.versionId ? ['version', request.versionId] : '']);
      const candidate = upload ? undefined : await this.cache?.get(scope, resource);
      const parsed = z.object({ result: request.operation === 's3List' ? cachedListingSchema : cachedObjectSchema, etag: z.string().max(8192).optional() }).safeParse(candidate);
      let cached = parsed.success ? parsed.data : undefined;
      if (cached) {
        const result = cached.result;
        if ('objects' in result ? result.objects.some(object => !object.key.startsWith(path)) : result.key !== path || request.operation === 's3Read' && request.versionId && request.versionId !== result.versionId || result.base64.length / 4 * 3 - (result.base64.endsWith('==') ? 2 : result.base64.endsWith('=') ? 1 : 0) !== result.size) cached = undefined;
      }
      if (candidate !== undefined && !cached) await this.cache?.remove(scope, resource).catch(() => {});
      if (request.operation !== 's3Upload' && request.cacheOnly) {
        if (!cached) throw new ConnectionError('No persisted S3 read is available.');
        return cached.result;
      }
      if (request.operation === 's3List') {
        if (request.versions) {
          url.searchParams.set('versions', ''); url.searchParams.set('max-keys', '100'); url.searchParams.set('prefix', path); url.searchParams.set('encoding-type', 'url');
          if (request.continuationToken) {
            const marker = z.object({ key: z.string().max(1024), version: z.string().max(2000) }).strict().parse(JSON.parse(request.continuationToken));
            if (!marker.key.startsWith(path)) throw new ConnectionError('Invalid version-list continuation.');
            url.searchParams.set('key-marker', marker.key); url.searchParams.set('version-id-marker', marker.version);
          }
          const response = await this.send(record, url);
          const xml = new TextDecoder('utf-8', { fatal: true }).decode(await boundedBytes(response, 2 * 1024 * 1024));
          if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ConnectionError('Unsupported S3 XML response.');
          const raw = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: false, isArray: name => name === 'Version' || name === 'DeleteMarker' }).parse(xml);
          const data = z.object({ ListVersionsResult: z.object({ EncodingType: z.string().optional(), IsTruncated: z.enum(['true', 'false']), NextKeyMarker: z.string().optional(), NextVersionIdMarker: z.string().optional(), Version: z.array(z.object({ Key: z.string(), VersionId: z.string().min(1).max(2000), Size: z.string().regex(/^\d+$/), ETag: z.string().optional() })).max(100).default([]) }) }).parse(raw).ListVersionsResult;
          const decode = (key: string) => data.EncodingType === 'url' ? decodeURIComponent(key) : key;
          const objects = data.Version.map(v => ({ key: decode(v.Key), versionId: v.VersionId, size: Number(v.Size), etag: v.ETag }));
          if (objects.some(o => !o.key.startsWith(path) || !Number.isSafeInteger(o.size) || o.versionId === 'null')) throw new ConnectionError('Invalid version listing.');
          if (data.IsTruncated === 'true' && (!data.NextKeyMarker || !data.NextVersionIdMarker)) throw new ConnectionError('Incomplete version listing.');
          return { objects, ...(data.IsTruncated === 'true' ? { continuationToken: JSON.stringify({ key: decode(data.NextKeyMarker!), version: data.NextVersionIdMarker }) } : {}) } satisfies S3Listing;
        }
        url.searchParams.set('list-type', '2'); url.searchParams.set('max-keys', '100'); url.searchParams.set('prefix', path); url.searchParams.set('encoding-type', 'url');
        if (request.continuationToken) url.searchParams.set('continuation-token', request.continuationToken);
        const response = await this.send(record, url, {}, false, current);
        if (response.status === 304 && cached) return cached.result;
        const xml = new TextDecoder('utf-8', { fatal: true }).decode(await boundedBytes(response, 2 * 1024 * 1024));
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
        const page = { objects, ...(listing.IsTruncated === 'true' ? { continuationToken: listing.NextContinuationToken } : {}) } satisfies S3Listing;
        if (epoch === this.epoch) await this.cache?.put(scope, resource, { result: page, etag: response.headers.get('ETag') ?? undefined });
        return page;
      }
      // Encode keys once, preserving literal % and slash structure. Dot segments
      // are rejected before URL construction so they cannot escape the bucket.
      url.pathname += path.split('/').map(encodeURIComponent).join('/');
      if (request.operation === 's3Read') {
        if (request.versionId) url.searchParams.set('versionId', request.versionId);
        const response = await this.send(record, url, { headers: cached?.etag ? { 'If-None-Match': cached.etag } : {} }, request.allowMissing, current);
        if (response.status === 404) { await response.body?.cancel(); return { key: path, missing: true as const }; }
        if (response.status === 304 && cached) return cached.result;
        const bytes = await boundedBytes(response, maxS3ObjectBytes);
        const result = { key: path, size: bytes.length, contentType: response.headers.get('Content-Type') ?? 'application/octet-stream', base64: base64(bytes), etag: response.headers.get('ETag') ?? undefined, versionId: cloudflareR2(record.endpoint) ? undefined : response.headers.get('x-amz-version-id') ?? undefined } satisfies S3Object;
        if (request.versionId && result.versionId !== request.versionId) throw new ConnectionError('S3 returned a different object version.');
        if (epoch === this.epoch) await this.cache?.put(scope, resource, { result, etag: result.etag });
        return result;
      }
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.base64)) throw new ConnectionError('Upload must contain canonical base64 bytes.');
      const bytes = Uint8Array.from(atob(request.base64), char => char.charCodeAt(0));
      if (bytes.length > maxS3ObjectBytes) throw new ConnectionError('Upload exceeds the 8 MiB object limit.');
      const response = await this.send(record, url, { method: 'PUT', body: bytes.buffer, headers: { 'Content-Type': request.contentType, ...(!record.allowOverwrite ? { 'If-None-Match': '*' } : {}) } }, false, current);
      await response.body?.cancel();
      await this.cache?.clearConnection(`s3:${record.id}`).catch(() => {});
      return { key: path, size: bytes.length, etag: response.headers.get('ETag') ?? undefined, versionId: cloudflareR2(record.endpoint) ? undefined : response.headers.get('x-amz-version-id') ?? undefined };
    }).then(value => { if (!current() || epoch !== this.epoch) throw new ConnectionError('S3 access changed during the request. Reconnect.'); return value; });
  }
  private async send(record: S3ConnectionRecord, url: URL, init: RequestInit = {}, allowMissing = false, current = () => true) {
    // Hermes uses the injected portable signer; it must not evaluate aws4fetch's
    // browser-only top-level TextEncoder/WebCrypto assumptions.
    const signed = this.signer ? await this.signer(record, url, init) : await new (await import('aws4fetch')).AwsClient({ accessKeyId: record.accessKeyId, secretAccessKey: record.secretAccessKey, sessionToken: record.sessionToken, service: 's3', region: record.region, retries: 0 }).sign(url, { ...init, aws: { allHeaders: true } });
    if (!current()) throw new ConnectionError('S3 document changed before transmission.');
    let response: Response;
    try { response = await this.fetcher(signed, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: this.timeout(30000) }); }
    catch { throw new ConnectionError('S3 request failed or timed out. Check endpoint, region, credentials and browser host access.'); }
    const notModified = response.status === 304 && (!init.method || init.method === 'GET') && new Headers(init.headers).has('If-None-Match');
    if (!response.ok && !notModified && !(allowMissing && response.status === 404)) {
      await response.body?.cancel();
      if (response.status === 412) throw new ConnectionError('That object already exists. This connection does not permit replacement; choose another key.');
      if ([401, 403, 404].includes(response.status)) await this.cache?.clearConnection(`s3:${record.id}`).catch(() => {});
      throw new ConnectionError(`S3 returned HTTP ${response.status}. Check access and endpoint compatibility. No automatic retry or overwrite fallback was used.`);
    }
    return response;
  }
}
