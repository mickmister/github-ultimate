import { expect, test } from 'vitest';
import { AwsClient } from 'aws4fetch';
import { z } from 'zod';
import { mobileS3Sign } from '../src/mobile-s3-sign';
import { MobilePiStore } from '../src/mobile-pi-store';
import { MobilePi } from '../src/mobile-pi';
import { mobilePiRequest } from '../src/mobile-pi-client';
import { S3Connections, type S3ConnectionRecord } from '../src/s3-connections';
import { InferenceConnections } from '../src/inference-connections';
import { utf8Bytes } from '../src/utf8';

const s3: S3ConnectionRecord = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'S3', endpoint: 'https://s3.example/', bucket: 'chats', prefix: '', region: 'us-east-1', addressing: 'path', allowRead: true, allowUpload: true, allowOverwrite: false, accessKeyId: 'private-key', secretAccessKey: 'private-secret', sessionToken: 'private-token', hostedGrants: [{ origin: 'https://agent.example', subpath: '/pi-web/' }] };
test.each(['GET', 'PUT'])('native SigV4 %s agrees with the existing WebCrypto signer, including encoded keys and versions', async method => {
  const now = new Date('2026-11-23T20:00:00Z'), url = new URL('https://s3.example/chats/a%20b/%E2%98%83%25.json?versionId=v%2B1&prefix=a%2Fb');
  const init: RequestInit = { method, headers: { 'x-amz-date': '20261123T200000Z', 'Content-Type': 'application/json', 'If-None-Match': '*' }, ...(method === 'PUT' ? { body: new TextEncoder().encode('Café 🌴').buffer } : {}) };
  const native = await mobileS3Sign(s3, url, init, now);
  const expectedHeaders = new Headers(init.headers); expectedHeaders.set('x-amz-content-sha256', native.headers.get('x-amz-content-sha256')!);
  const standard = await new AwsClient({ accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, sessionToken: s3.sessionToken, region: s3.region, service: 's3', retries: 0 }).sign(url, { ...init, headers: expectedHeaders, aws: { allHeaders: true, datetime: '20261123T200000Z' } });
  expect(native.headers.get('Authorization')).toBe(standard.headers.get('Authorization'));
  expect(await native.text()).toBe(await standard.text());
});

test('native credentials survive restart in secure chunks and never enter metadata', async () => {
  const values = new Map<string, string>(), secrets = new Map<string, string>();
  const metadata = { async getItem(key: string) { return values.get(key) ?? null; }, async setItem(key: string, value: string) { values.set(key, value); } };
  const vault = { async getItem(key: string) { return secrets.get(key) ?? null; }, async setItem(key: string, value: string) { expect(utf8Bytes(value)).toBeLessThanOrEqual(1600); secrets.set(key, value); }, async removeItem(key: string) { secrets.delete(key); } };
  const schema = z.object({ id: z.string().uuid(), name: z.string(), token: z.string() }).strict(), id = crypto.randomUUID();
  const store = new MobilePiStore('inference', metadata, vault, () => crypto.randomUUID(), schema, ['token']);
  const record = { id, name: 'Public name', token: 'private 🌴'.repeat(800) };
  await store.put(record); expect([...values.values()].join()).not.toContain('private'); expect(secrets.size).toBeGreaterThan(1);
  expect(await new MobilePiStore('inference', metadata, vault, () => crypto.randomUUID(), schema, ['token']).get(id)).toEqual(record);
  await store.remove(id); expect(secrets.size).toBe(0);
});

test('native Pi chunks a large S3 response without changing the native frame limit and rejects changed documents', async () => {
  const source = 'https://agent.example/pi-web/', content = 'Café 🌴'.repeat(2000);
  const records = { async all() { return [s3]; }, async get() { return s3; }, async put() {}, async remove() {} };
  const service = new MobilePi(new S3Connections(records, async () => new Response(content), undefined, undefined, undefined, async (_record, url, init) => new Request(url, init)), new InferenceConnections({ async all() { return []; }, async get() { return undefined; }, async put() {}, async remove() {} }));
  let current = true;
  const client = { async request(method: string, params: Record<string, unknown>) {
    expect(utf8Bytes(JSON.stringify({ jsonrpc: '2.0', id: 'id', method, params }))).toBeLessThan(16 * 1024);
    const result = await service.handle(source, params, () => current);
    expect(utf8Bytes(JSON.stringify(result))).toBeLessThan(16 * 1024); return result;
  } };
  const object = await mobilePiRequest<{ base64: string }>(client, { operation: 's3Read', id: s3.id, revision: s3.revision, key: 'chat.json' }, 30000);
  expect(Buffer.from(object.base64, 'base64').toString()).toBe(content);
  const transferId = crypto.randomUUID(); await service.handle(source, { phase: 'begin', transferId, bytes: 10 }, () => current);
  current = false; service.clear();
  await expect(service.handle(source, { phase: 'chunk', transferId, index: 0, text: '1234567890' }, () => current)).rejects.toThrow('document changed');
});
