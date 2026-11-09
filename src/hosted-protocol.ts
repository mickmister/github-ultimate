import { z } from 'zod';
import { pageChannel } from './bridge-channels';
import { gitReadSchemas } from './git-reads';
export { pageChannel, replyChannel } from './bridge-channels';

export const hostedRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('discover') }).strict(),
  z.object({ operation: z.literal('connections') }).strict(),
  z.object({ operation: z.literal('repositories'), id: z.string().uuid() }).strict(),
  z.object({ operation: z.literal('probe'), id: z.string().uuid(), repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/).max(220) }).strict(),
  ...gitReadSchemas,
]);
export type HostedRequest = z.infer<typeof hostedRequestSchema>;
export const pageEnvelopeSchema = z.object({ channel: z.literal(pageChannel), version: z.literal(1), requestId: z.string().uuid(), request: z.unknown() }).strict();
export const pageMessageSchema = pageEnvelopeSchema.extend({ request: hostedRequestSchema });

export function trustedOrigin(input: string): string {
  const url = new URL(input);
  if (url.username || url.password || url.origin === 'null' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Use an HTTPS origin (or HTTP loopback for local development).');
  }
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Enter only the origin, without a path, query or fragment. Grants cover every path on that origin.');
  return url.origin;
}

// Browser match patterns cover all ports; the broker's actual grant still
// compares the full origin including the port on every request.
export function originPattern(origin: string): string {
  const url = new URL(trustedOrigin(origin));
  return `${url.protocol}//${url.hostname}/*`;
}

export type HostedConnection = { id: string; name: string; appId: number; user?: { login: string; id: number }; installation?: { id: number; account: string } };
