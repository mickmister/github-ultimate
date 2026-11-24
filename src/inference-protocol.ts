import { z } from 'zod';

export function inferenceURL(input: string): URL {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Use a full HTTPS inference URL without credentials, query or fragment (HTTP loopback is supported for development).');
  return url;
}
const id = z.string().uuid();
const body = z.string().min(1).max(1024 * 1024);
const headerName = z.string().regex(/^[!#$%&'*+.^_`|~0-9a-zA-Z-]{1,100}$/).refine(name => !/^(host|content-length|content-type|connection|cookie|origin|referer|proxy-.*|sec-.*|transfer-encoding)$/i.test(name), 'This header is controlled by the broker.');
const configuration = z.object({
  name: z.string().trim().min(1).max(80), url: z.string().max(2000).transform(value => inferenceURL(value).href),
  model: z.string().trim().min(1).max(200),
  headers: z.array(z.object({ name: headerName, value: z.string().max(8192).regex(/^[\x20-\x7e]*$/) }).strict()).max(20).default([]),
}).strict();
export const inferenceConfigurationSchema = configuration;
const grant = { origin: z.string().max(300), subpath: z.string().max(1000) };
export const inferenceSettingsSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  configuration.extend({ operation: z.literal('add') }).strict(),
  z.object({ operation: z.literal('remove'), id }).strict(),
  z.object({ operation: z.enum(['grantOrigin', 'revokeOrigin']), id, ...grant }).strict(),
]);
export const inferenceHostedSchemas = [
  z.object({ operation: z.literal('inferenceConnections') }).strict(),
  z.object({ operation: z.literal('inferenceComplete'), id, revision: id, requestId: id, body }).strict(),
  z.object({ operation: z.literal('inferenceOpen'), id, revision: id, requestId: id, body }).strict(),
  z.object({ operation: z.literal('inferenceRead'), id, revision: id, requestId: id, sequence: z.number().int().nonnegative() }).strict(),
  z.object({ operation: z.literal('inferenceCancel'), id, revision: id, requestId: id }).strict(),
] as const;
export const inferenceHostedSchema = z.discriminatedUnion('operation', inferenceHostedSchemas);
export type InferenceConfiguration = z.infer<typeof configuration>;
export type PublicInferenceConnection = { id: string; revision: string; name: string; model: string; hostedGrants: { origin: string; subpath: string }[]; transport?: 'http-stream-v1' };
export type InferenceHTTPResponse = { status: number; headers: Record<string, string>; body?: string };
export type InferenceHTTPChunk = { text: string; done: boolean };
