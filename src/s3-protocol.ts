import { z } from 'zod';
import { maxS3ObjectBytes } from './s3-limits';
export { maxS3ObjectBytes } from './s3-limits';
const id = z.string().uuid();
const revision = z.string().uuid();
const key = z.string().min(1).max(1024);
export const s3HostedSchemas = [
  z.object({ operation: z.literal('s3Connections') }).strict(),
  z.object({ operation: z.literal('s3List'), id, revision, prefix: z.string().max(1024).optional(), continuationToken: z.string().max(8192).optional() }).strict(),
  z.object({ operation: z.literal('s3Read'), id, revision, key }).strict(),
  z.object({ operation: z.literal('s3Upload'), id, revision, key, base64: z.string().max(Math.ceil(maxS3ObjectBytes / 3) * 4), contentType: z.string().min(1).max(200).regex(/^[\x20-\x7e]+$/).default('application/octet-stream') }).strict(),
] as const;
export const s3HostedSchema = z.discriminatedUnion('operation', s3HostedSchemas);
export type S3HostedRequest = z.infer<typeof s3HostedSchema>;

export const s3ConfigurationSchema = z.object({
  name: z.string().trim().min(1).max(80), endpoint: z.string().min(1).max(1000),
  region: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/), bucket: z.string().min(1).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
  addressing: z.enum(['path', 'virtual']).default('path'), prefix: z.string().max(1024).default(''),
  accessKeyId: z.string().min(1).max(256), secretAccessKey: z.string().min(1).max(1000), sessionToken: z.string().max(8192).optional(),
  allowRead: z.boolean().default(true), allowUpload: z.boolean().default(false), allowOverwrite: z.boolean().default(false),
}).strict();
const pair = z.object({ origin: z.string().max(300), subpath: z.string().max(1000).default('/') }).strict();
export const s3SettingsSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  s3ConfigurationSchema.extend({ operation: z.literal('add') }).strict(),
  s3ConfigurationSchema.extend({ operation: z.literal('update'), id }).strict(),
  z.object({ operation: z.literal('remove'), id }).strict(),
  z.object({ operation: z.enum(['grantOrigin', 'revokeOrigin']), id, ...pair.shape, replace: pair.optional() }).strict(),
]);
export type S3SettingsRequest = z.input<typeof s3SettingsSchema>;
export type S3Configuration = z.infer<typeof s3ConfigurationSchema>;
export type PublicS3Connection = Pick<S3Configuration, 'name' | 'endpoint' | 'region' | 'bucket' | 'addressing' | 'prefix' | 'allowRead' | 'allowUpload' | 'allowOverwrite'> & { id: string; revision: string; hostedGrants: { origin: string; subpath: string }[] };
export type S3Listing = { objects: { key: string; size: number; etag?: string }[]; continuationToken?: string };
export type S3Object = { key: string; size: number; contentType: string; base64: string; etag?: string; versionId?: string };

export function s3BucketURL(config: Pick<S3Configuration, 'endpoint' | 'bucket' | 'addressing'>): URL {
  const url = new URL(config.endpoint);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Use an HTTPS S3 endpoint, or HTTP loopback for local development.');
  if (/%(?:2f|5c|2e|25)/i.test(url.pathname)) throw new Error('Ambiguous endpoint path.');
  if (config.addressing === 'virtual') {
    if (url.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) throw new Error('Use path-style addressing for loopback or IP endpoints.');
    url.hostname = `${config.bucket}.${url.hostname}`;
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + (config.addressing === 'path' ? `/${config.bucket}/` : '/');
  return url;
}

export function s3Key(input: string): string {
  if (new TextEncoder().encode(input).length > 1024 || /[\x00-\x1f\x7f]/.test(input) || input.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid object key. Dot segments and control characters are not supported.');
  return input;
}
export function s3Prefix(input: string): string {
  return s3Key(input && !input.endsWith('/') ? input + '/' : input);
}
