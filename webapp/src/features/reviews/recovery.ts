import { z } from 'zod';
import { reviewArtifactSchema, type ReviewArtifact } from '../../../../src/review-protocol';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { OpenReview } from '../../../../hosted/reviews';

const MAX = 128000;
const PREFIX = 'review-answer-recovery:';
const pendingSchema = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/) }).strict();
const schema = z.object({ version: z.literal(1), time: z.number().finite(), draft: reviewArtifactSchema, pending: pendingSchema.nullable() }).strict();
export type ReviewRecovery = z.infer<typeof schema>;
export function recoveryKey(scope: WorkspaceScope, review: OpenReview, reviewer: string) {
  return PREFIX + JSON.stringify([scope.connectionId, scope.installationId, scope.repository.toLowerCase(), scope.workspace, review.request.request_id, review.pin.version, review.pin.snapshot, reviewer]);
}
export function readRecovery(key: string, reviewer: string, request: ReviewArtifact['request'], storage?: Storage): ReviewRecovery | null {
  try {
    const text = (storage ?? sessionStorage).getItem(key);
    if (!text || text.length > MAX) return null;
    const value = schema.parse(JSON.parse(text));
    if (Date.now() - value.time > 7 * 86400000 || value.time > Date.now() + 60000 || value.draft.kind !== 'review-draft'
      || value.draft.reviewer !== reviewer || JSON.stringify(value.draft.request) !== JSON.stringify(request)
      || value.draft.comments.length) return null;
    return value;
  } catch { return null; }
}
export function writeRecovery(key: string, value: ReviewRecovery, storage?: Storage): boolean {
  try {
    const target = storage ?? sessionStorage;
    const text = JSON.stringify(schema.parse(value));
    if (text.length > MAX || value.draft.comments.length) return false;
    // Bound this category only; never evict feature intake or unrelated browser state.
    const entries = Array.from({ length: target.length }, (_, index) => target.key(index)).filter((item): item is string => Boolean(item?.startsWith(PREFIX)));
    for (const item of entries.filter(item => item !== key).slice(0, Math.max(0, entries.length - 7))) target.removeItem(item);
    target.setItem(key, text);
    return true;
  } catch { return false; }
}
export async function recoveryFingerprint(identity: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
