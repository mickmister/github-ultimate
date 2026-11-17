import { expect, test } from 'vitest';
import { readRecovery, writeRecovery, recoveryKey, recoveryFingerprint, type ReviewRecovery } from '../webapp/src/features/reviews/recovery';
import type { OpenReview } from '../hosted/reviews';

test('bounded recovery isolates reviewer and exact pins, rejects malformed state and tolerates blocked storage', async () => {
  const data = new Map<string, string>();
  const storage = { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); }, clear: () => data.clear() } satisfies Storage;
  const request = { id: 'request-1', version: 'a'.repeat(40), snapshot: 'b'.repeat(40) };
  const value: ReviewRecovery = { version: 1, time: Date.now(), draft: { kind: 'review-draft', schema_version: 1, transport: 'workspace-resources', id: 'draft-1', reviewer: 'github:1', request, forms: [], progress: ['document'], comments: [] }, pending: { id: 'response-exact', fingerprint: await recoveryFingerprint('exact identity') } };
  expect(writeRecovery('review-answer-recovery:one', value, storage)).toBe(true);
  expect(readRecovery('review-answer-recovery:one', 'github:1', request, storage)).toEqual(value);
  expect(readRecovery('review-answer-recovery:one', 'github:2', request, storage)).toBeNull();
  expect(readRecovery('review-answer-recovery:one', 'github:1', { ...request, snapshot: 'c'.repeat(40) }, storage)).toBeNull();
  for (const text of ['{', '{}', JSON.stringify({ ...value, pending: { id: 'bad', fingerprint: 'bad' } }), JSON.stringify({ ...value, time: 0 }), 'x'.repeat(128001)]) {
    storage.setItem('bad', text); expect(readRecovery('bad', 'github:1', request, storage)).toBeNull();
  }
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } as unknown as Storage;
  expect(readRecovery('x', 'github:1', request, blocked)).toBeNull();
  expect(writeRecovery('x', value, blocked)).toBe(false);
  storage.setItem('review-feature-intake:test', 'private category');
  for (let index = 0; index < 15; index++) writeRecovery(`review-answer-recovery:${index}`, value, storage);
  expect([...data.keys()].filter(key => key.startsWith('review-answer-recovery:'))).toHaveLength(8);
  expect(storage.getItem('review-feature-intake:test')).toBe('private category');
  const scope = { connectionId: 'connection', installationId: 1, repository: 'owner/repo', workspace: 'workspace' };
  const review = { request: { request_id: request.id }, pin: { version: request.version, snapshot: request.snapshot } } as OpenReview;
  const key = recoveryKey(scope, review, 'github:1');
  expect(recoveryKey(scope, review, 'github:2')).not.toBe(key);
  expect(recoveryKey({ ...scope, installationId: 2 }, review, 'github:1')).not.toBe(key);
  expect(recoveryKey(scope, { ...review, pin: { ...review.pin, version: 'd'.repeat(40) } }, 'github:1')).not.toBe(key);
});
