import { expect, test, vi } from 'vitest';
import { createReviewFixture, reviewScope } from '../webapp/stories/reviews.fixtures';
import { createReviewContents, reviewResourceKey } from '../webapp/src/features/reviews/review-contents';

async function fixture() {
  const service = createReviewFixture().modules.reviews!;
  const review = (await service.list(reviewScope)).requests[0];
  return { service, review };
}

test('preloads every document, form and baseline once, and shares in-flight and completed reads', async () => {
  const { service, review } = await fixture();
  service.read = vi.fn(service.read);
  const cache = createReviewContents(reviewScope, review, service);
  expect(service.read).not.toHaveBeenCalled();
  const member = review.request.members[0];
  if (member.kind !== 'document') throw new Error('Expected document fixture');
  const first = cache.read(member.target);
  expect(cache.read(member.target)).toBe(first);
  await Promise.all([cache.preload(), cache.preload(), first]);
  expect(service.read).toHaveBeenCalledTimes(4);
  expect([...cache.getSnapshot().values()].every(item => item.status === 'ready')).toBe(true);
  const snapshot = cache.getSnapshot();
  await cache.read(member.target);
  await cache.preload();
  expect(cache.getSnapshot()).toBe(snapshot);
  expect(service.read).toHaveBeenCalledTimes(4);
});

test('limits parallel downloads while starting the whole request without visiting members', async () => {
  const { service, review } = await fixture();
  const first = review.request.members[0];
  if (first.kind !== 'document') throw new Error('Expected document fixture');
  review.request.members = Array.from({ length: 12 }, (_, index) => ({ ...first, id: `doc-${index}`, baseline: undefined, target: { ...first.target, resource: `docs/${index}.md` } }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  service.read = vi.fn(async () => { await gate; return '# Downloaded'; });
  const cache = createReviewContents(reviewScope, review, service);
  const loading = cache.preload();
  await vi.waitFor(() => expect(service.read).toHaveBeenCalledTimes(4));
  release();
  await loading;
  expect(service.read).toHaveBeenCalledTimes(12);
  expect(cache.getSnapshot().size).toBe(12);
});

test('one failed baseline does not block other members and retries only failed resources', async () => {
  const { service, review } = await fixture();
  const original = service.read;
  let fail = true;
  service.read = vi.fn(async (scope, pin) => {
    if (fail && pin.version === 'b'.repeat(40)) throw new Error('Baseline temporarily unavailable');
    return original(scope, pin);
  });
  const cache = createReviewContents(reviewScope, review, service);
  await cache.preload();
  expect([...cache.getSnapshot().values()].filter(item => item.status === 'ready')).toHaveLength(3);
  expect([...cache.getSnapshot().values()].find(item => item.status === 'error')).toEqual({ status: 'error', error: 'Baseline temporarily unavailable' });
  fail = false;
  await cache.retryFailed();
  expect(service.read).toHaveBeenCalledTimes(5);
  expect([...cache.getSnapshot().values()].every(item => item.status === 'ready')).toBe(true);
});

test('deduplicates shared exact pins while keeping revisions, snapshots and sessions isolated', async () => {
  const { service, review } = await fixture();
  const first = review.request.members[0];
  if (first.kind !== 'document') throw new Error('Expected document fixture');
  review.request.members.push({ ...first, id: 'duplicate' });
  service.read = vi.fn(service.read);
  const cache = createReviewContents(reviewScope, review, service);
  await cache.preload();
  expect(service.read).toHaveBeenCalledTimes(4);
  expect(reviewResourceKey(first.target)).not.toBe(reviewResourceKey(first.baseline!));
  expect(reviewResourceKey(first.target)).not.toBe(reviewResourceKey({ ...first.target, snapshot: '9'.repeat(40) }));
  const otherScope = { ...reviewScope, connectionId: 'other-connection', workspace: 'other-workspace' };
  const other = createReviewContents(otherScope, review, service);
  expect([...other.getSnapshot().values()].every(item => item.status === 'loading')).toBe(true);
  await other.preload();
  expect(service.read).toHaveBeenCalledTimes(8);
  expect(service.read).toHaveBeenCalledWith(otherScope, first.target);
});
