import { expect, it } from 'vitest';
import { createFeedbackQueue, restoreFeedbackDraft } from '../webapp/src/features/feedback/queue';
import type { FeedbackCapture } from '../webapp/src/features/feedback/contracts';

const context: FeedbackCapture = {
  target: { elementId: 'reader', label: 'notes.md', uiPath: ['Documents', 'Reader'], featureId: 'documents.markdown-renderer', resource: { kind: 'document', id: 'doc-a', path: 'notes.md', revision: 'document-revision' } },
  selection: { text: 'selected words', representation: 'rendered-markdown' },
  pageUrl: 'https://example.test/app/', appBuild: 'application-revision', capturedAt: '2026-11-11T00:00:00Z',
};

it('freezes captured context and restores a versioned tab draft without merging content and feature targets', () => {
  let saved = '';
  const queue = createFeedbackQueue([], value => { saved = value; });
  const capture = { ...structuredClone(context), target: { ...context.target, uiPath: ['Documents', 'Reader'] } };
  queue.add('content-comment', 'Change these words', capture);
  capture.target.uiPath = ['Changed after opening'];
  queue.add('feature-comment', 'Improve rendering', context);
  const restored = restoreFeedbackDraft(saved);
  expect(restored).toHaveLength(2);
  expect(restored[0].context.target.uiPath).toEqual(['Documents', 'Reader']);
  expect(restored.map(item => item.kind)).toEqual(['content-comment', 'feature-comment']);
  expect(restored[1].context.appBuild).not.toBe(restored[1].context.target.resource?.revision);
  expect(restoreFeedbackDraft('{broken')).toEqual([]);
  expect(restoreFeedbackDraft('{"schemaVersion":2,"interactions":[]}')).toEqual([]);
  expect(restoreFeedbackDraft('{"schemaVersion":1,"interactions":[null,{},42]}')).toEqual([]);
});

it('preserves the entire queue when clipboard writing fails', async () => {
  const queue = createFeedbackQueue();
  queue.add('content-comment', 'Keep this thought', context);
  await queue.copyAndClear(async () => { throw new Error('Clipboard permission denied'); });
  expect(queue.getSnapshot().items).toHaveLength(1);
  expect(queue.getSnapshot().exporting).toBe(false);
  expect(queue.getSnapshot().message).toContain('still queued');
});

it('clears only unchanged exported entries after clipboard success, retaining concurrent additions and edits', async () => {
  const queue = createFeedbackQueue();
  queue.add('content-comment', 'Original', context);
  queue.add('feature-comment', 'Export and remove this', context);
  let copied = '', finish!: () => void;
  const copy = queue.copyAndClear(text => { copied = text; return new Promise(resolve => { finish = resolve; }); });
  const first = queue.getSnapshot().items[0];
  queue.edit(first.id, 'Edited while copying');
  queue.add('feature-comment', 'Added while copying', context);
  finish(); await copy;
  expect(queue.getSnapshot().items.map(item => item.comment)).toEqual(['Edited while copying', 'Added while copying']);
  const batch = JSON.parse(copied);
  expect(batch.schemaVersion).toBe(1);
  expect(batch.batchId).toBeTruthy();
  expect(batch.interactions.map((item: { comment: string }) => item.comment)).toEqual(['Original', 'Export and remove this']);
  await queue.copyAndClear(async () => {});
  expect(queue.getSnapshot().items).toEqual([]);
});

it('keeps comments usable in memory if tab draft storage fails', () => {
  const queue = createFeedbackQueue([], () => { throw new Error('Storage disabled'); });
  queue.add('feature-comment', 'Remember this', context);
  expect(queue.getSnapshot().items).toHaveLength(1);
  expect(queue.getSnapshot().message).toContain('could not be saved');
});
