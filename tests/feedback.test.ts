import { expect, it } from 'vitest';
import { createFeedbackQueue, restoreFeedbackDraft } from '../webapp/src/features/feedback/queue';
import type { FeedbackCapture } from '../webapp/src/features/feedback/contracts';

const context: FeedbackCapture = {
  target: { elementId: 'reader', label: 'notes.md', uiPath: ['Documents', 'Reader'], featureId: 'documents.markdown-renderer', resource: { kind: 'document', id: 'doc-a', path: 'notes.md', revision: 'document-revision' } },
  selection: { text: 'selected words', representation: 'rendered-markdown' },
  pageUrl: 'https://example.test/app/', appBuild: 'application-revision', capturedAt: '2026-11-11T00:00:00Z',
};

it('omits browser URLs from new captures, persisted drafts and exported events by default', async () => {
  let saved = '', copied = '';
  const queue = createFeedbackQueue([], value => { saved = value; });
  queue.add('content-comment', 'A useful comment', context);
  expect(queue.getSnapshot().items[0].context).not.toHaveProperty('pageUrl');
  expect(restoreFeedbackDraft(saved)[0].context).not.toHaveProperty('pageUrl');
  await queue.copyAndClear(async text => { copied = text; });
  expect(JSON.parse(copied).interactions[0].context).not.toHaveProperty('pageUrl');
  expect(copied).not.toContain('https://example.test/app/');
  expect(context.pageUrl).toBe('https://example.test/app/');
});

it('preserves old comments while immediately removing URLs from legacy tab drafts', async () => {
  const legacy = { schemaVersion: 1, interactions: [{ id: 'old-comment', version: 3, kind: 'content-comment', comment: 'Keep this draft', context }] };
  let saved = '', copied = '';
  const queue = createFeedbackQueue(restoreFeedbackDraft(JSON.stringify(legacy)), value => { saved = value; });
  expect(queue.getSnapshot().items[0]).toMatchObject({ id: 'old-comment', version: 3, comment: 'Keep this draft' });
  expect(restoreFeedbackDraft(saved)[0].context).not.toHaveProperty('pageUrl');
  await queue.copyAndClear(async text => { copied = text; });
  expect(JSON.parse(copied).interactions[0].context).not.toHaveProperty('pageUrl');
});

it('allows explicit URL opt-in and strips queued URLs when that policy is turned off', async () => {
  let saved = '', copied = '';
  const queue = createFeedbackQueue([], value => { saved = value; }, { includePageUrl: true });
  queue.add('feature-comment', 'Explicit URL capture', context);
  expect(restoreFeedbackDraft(saved)[0].context.pageUrl).toBe(context.pageUrl);
  await queue.copyAndClear(async text => { copied = text; });
  expect(JSON.parse(copied).interactions[0].context.pageUrl).toBe(context.pageUrl);
  queue.add('content-comment', 'Retain the comment, remove its URL', context);
  let finish!: () => void;
  const exporting = queue.copyAndClear(() => new Promise(resolve => { finish = resolve; }));
  queue.setIncludePageUrl(false);
  finish(); await exporting;
  expect(queue.getSnapshot().items[0].comment).toBe('Retain the comment, remove its URL');
  expect(restoreFeedbackDraft(saved)[0].context).not.toHaveProperty('pageUrl');
  queue.setIncludePageUrl(true);
  expect(queue.getSnapshot().items[0].context).not.toHaveProperty('pageUrl');
});

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
