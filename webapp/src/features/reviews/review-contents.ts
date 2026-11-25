import type { OpenReview } from '../../../../hosted/reviews';
import { limitConcurrency } from '../../../../hosted/concurrency';
import type { ReviewPin } from '../../../../src/review-protocol';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewsModuleV1 } from '../../app-hooks/reviews';

export type ReviewResource = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'error'; error: string };
export type ReviewContents = ReadonlyMap<string, ReviewResource>;
export const reviewResourceKey = (pin: ReviewPin) => JSON.stringify([pin.resource, pin.version_kind, pin.version, pin.snapshot]);

/** Session-local, exact-pin cache: never rebind downloaded content to a newer review. */
export function createReviewContents(scope: WorkspaceScope, review: OpenReview, service: ReviewsModuleV1) {
  const pins = new Map<string, ReviewPin>();
  // Queue primary contents first so historical baselines cannot delay every form.
  for (const member of review.request.members) {
    const pin = member.kind === 'document' ? member.target : member.dsl;
    pins.set(reviewResourceKey(pin), pin);
  }
  for (const member of review.request.members) if (member.kind === 'document' && member.baseline) pins.set(reviewResourceKey(member.baseline), member.baseline);
  let snapshot: ReviewContents = new Map([...pins.keys()].map(key => [key, { status: 'loading' }]));
  const listeners = new Set<() => void>();
  const pending = new Map<string, Promise<string>>();
  const run = limitConcurrency(4);
  function update(key: string, value: ReviewResource) {
    snapshot = new Map(snapshot).set(key, value);
    listeners.forEach(listener => listener());
  }
  function read(pin: ReviewPin): Promise<string> {
    const key = reviewResourceKey(pin), resource = snapshot.get(key);
    if (resource?.status === 'ready') return Promise.resolve(resource.text);
    if (resource?.status === 'error') return Promise.reject(new Error(resource.error));
    const existing = pending.get(key);
    if (existing) return existing;
    const request = run(async () => {
      try {
        const text = await service.read(scope, pin);
        update(key, { status: 'ready', text });
        return text;
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        update(key, { status: 'error', error });
        throw new Error(error);
      } finally { pending.delete(key); }
    });
    pending.set(key, request);
    return request;
  }
  const download = async (values: ReviewPin[]) => { await Promise.allSettled(values.map(read)); };
  return {
    read,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    preload: () => download([...pins.values()]),
    retryFailed() {
      const failed = [...pins].filter(([key]) => snapshot.get(key)?.status === 'error');
      for (const [key] of failed) update(key, { status: 'loading' });
      return download(failed.map(([, pin]) => pin));
    },
  };
}
