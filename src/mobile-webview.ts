import { z } from 'zod';

// This decodes native-origin events only. Native checks establish authority;
// ordinary page onMessage payloads must never be routed into this decoder.
const identity = { documentId: z.string().min(1).max(80), documentURL: z.string().max(4096) };
const event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('document'), ...identity, state: z.enum(['loading', 'ready', 'error']) }).strict(),
  z.object({ type: z.literal('message'), ...identity, isMainFrame: z.literal(true), replyId: z.string().min(1).max(80), data: z.string() }).strict(),
]);
export function nativeWebViewEvent(raw: string) {
  try { const value = event.safeParse(JSON.parse(raw)); return value.success ? value.data : undefined; }
  catch { return undefined; }
}
