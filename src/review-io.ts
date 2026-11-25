import { z } from 'zod';
import { utf8Bytes } from './utf8.ts';

// Installed-host IO contract, not the review/form domain schema. Project only
// identity, storage mode and credential-bearing delivery destinations. Never
// serialize these projections over the original evolving document payload.
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/);
const bead = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
export const reviewOid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const oid = reviewOid;
export const reviewWriteSchema = z.object({
  operation: z.literal('reviewWrite'), id: z.string().uuid(), installationId: z.number().int().positive(),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220), workspace: key,
  text: z.string().max(256000), expected: oid.nullable(),
}).strict();
export type ReviewWrite = z.infer<typeof reviewWriteSchema>;
const envelope = z.object({
  kind: z.enum(['review-response', 'review-draft', 'review-queue-state']),
  id: key, reviewer: z.string().regex(/^github:[1-9][0-9]*$/),
  request: z.object({ id: key, version: oid, snapshot: oid }),
});
const route = z.object({
  request_id: key, workspace: key, bead_id: bead.optional(),
  execution: z.object({ kind: z.literal('development'), id: z.string().regex(/^[1-9]\d*-[1-9]\d*$/), process: key, thread_id: bead }).optional(),
  process: z.object({ kind: z.literal('qrspi'), id: key }).optional(),
  response_effect: z.object({ kind: z.literal('vk-session'), workspace_id: z.string().uuid(), session_id: z.string().uuid() }).optional(),
}).refine(value => Boolean(value.bead_id) !== Boolean(value.execution) && (!value.process || Boolean(value.bead_id)), 'Review route requires one owning Bead or development execution');
function json(text: string) {
  if (utf8Bytes(text) > 256000) throw new Error('Review IO payload exceeds 256 KB.');
  return JSON.parse(text);
}
export const reviewIOEnvelope = (text: string) => envelope.parse(json(text));
export const reviewDeliveryRoute = (text: string) => route.parse(json(text));
export type ReviewDeliveryRoute = z.infer<typeof route>;
/** Older hosts formatted/ordered JSON before storage. Recognize their exact
 * payload on retry without stripping unknown fields or rewriting history. */
export function sameReviewPayload(left: string, right: string) {
  const pending: [unknown, unknown][] = [[json(left), json(right)]];
  while (pending.length) {
    const [a, b] = pending.pop()!;
    if (a === b) continue;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(b, key)) return false;
      pending.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]]);
    }
  }
  return true;
}
export function reviewIOResource(value: ReturnType<typeof reviewIOEnvelope>) {
  const root = `review-requests/${value.request.id}`;
  return value.kind === 'review-queue-state' ? `${root}/queue/${value.reviewer.slice(7)}.json`
    : value.kind === 'review-response' ? `${root}/responses/${value.id}.json`
      : `${root}/drafts/${value.reviewer.slice(7)}/${value.request.version}.json`;
}
