import { expect, it } from 'vitest';
import { findFeedbackTextRange, sameFeedbackResource } from '../webapp/src/features/feedback/anchors';
import type { FeedbackSelection } from '../webapp/src/features/feedback/contracts';

const selection = (text: string, rest: Partial<FeedbackSelection> = {}): FeedbackSelection => ({ text, representation: 'rendered-markdown', ...rest });

it('uses validated rendered offsets to distinguish duplicate selections, but rejects stale offsets', () => {
  const text = 'First quote. Second quote.';
  expect(findFeedbackTextRange(text, selection('quote', { textRange: { startOffset: 20, endOffset: 25 } }))).toEqual({ startOffset: 20, endOffset: 25 });
  expect(findFeedbackTextRange(text, selection('quote', { textRange: { startOffset: 0, endOffset: 5 }, prefix: 'Second ' }))).toEqual({ startOffset: 20, endOffset: 25 });
  expect(findFeedbackTextRange(text, selection('quote'))).toBeNull();
});

it('resolves legacy quotes with surrounding context and tolerates browser whitespace between blocks', () => {
  expect(findFeedbackTextRange('Before repeated after. Other repeated ending.', selection('repeated', { prefix: 'Other ', suffix: ' ending.' }))).toEqual({ startOffset: 29, endOffset: 37 });
  expect(findFeedbackTextRange('First paragraphSecond paragraph', selection('First paragraph\n\nSecond paragraph'))).toEqual({ startOffset: 0, endOffset: 31 });
  expect(findFeedbackTextRange('Nothing matches here', selection('gone'))).toBeNull();
  expect(findFeedbackTextRange('anything', selection('   '))).toBeNull();
});

it('never shares annotations across resources, repositories, workspaces or revisions', () => {
  const resource = { kind: 'document', id: 'doc', path: 'notes.md', repository: 'owner/storage', workspace: 'research', revision: 'commit-a' };
  expect(sameFeedbackResource(resource, { ...resource })).toBe(true);
  for (const key of ['kind', 'id', 'path', 'repository', 'workspace', 'revision'] as const) expect(sameFeedbackResource(resource, { ...resource, [key]: 'different' })).toBe(false);
  expect(sameFeedbackResource(undefined, undefined)).toBe(false);
});
