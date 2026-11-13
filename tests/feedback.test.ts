import { expect, it } from 'vitest';
import { createFeedbackQueue, restoreFeedbackDraft } from '../webapp/src/features/feedback/queue';
import type { FeedbackCapture } from '../webapp/src/features/feedback/contracts';
import { formatFeedbackReview } from '../webapp/src/features/feedback/review';

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
  expect(copied).toContain('> selected words\n\nA useful comment');
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
  expect(copied).toContain('Keep this draft');
  expect(copied).not.toContain(context.pageUrl);
});

it('allows explicit URL opt-in and strips queued URLs when that policy is turned off', async () => {
  let saved = '', copied = '';
  const queue = createFeedbackQueue([], value => { saved = value; }, { includePageUrl: true });
  queue.add('feature-comment', 'Explicit URL capture', context);
  expect(restoreFeedbackDraft(saved)[0].context.pageUrl).toBe(context.pageUrl);
  await queue.copyAndClear(async text => { copied = text; });
  expect(copied).toContain(`Page: ${context.pageUrl}`);
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
  expect(copied).toContain('> selected words\n\nOriginal');
  expect(copied).toContain('Feature: documents.markdown-renderer');
  expect(copied).toContain('Export and remove this');
  expect(copied).not.toContain('Edited while copying');
  expect(copied).not.toContain('Added while copying');
  await queue.copyAndClear(async () => {});
  expect(queue.getSnapshot().items).toEqual([]);
});

it('keeps comments usable in memory if tab draft storage fails', () => {
  const queue = createFeedbackQueue([], () => { throw new Error('Storage disabled'); });
  queue.add('feature-comment', 'Remember this', context);
  expect(queue.getSnapshot().items).toHaveLength(1);
  expect(queue.getSnapshot().message).toContain('could not be saved');
});

it('copies document identity once and only the selected text and verbatim comments, retaining full internal anchors', async () => {
  let saved = '', copied = '';
  const queue = createFeedbackQueue([], value => { saved = value; });
  const capture = { ...context, target: { ...context.target, resource: { ...context.target.resource!, repository: 'owner/storage', workspace: 'workspace-a' } },
    selection: { text: 'first line\nsecond line', representation: 'rendered-markdown', prefix: 'Unchosen prefix', suffix: 'Unchosen suffix' } };
  queue.add('content-comment', 'Is this **necessary**?\nExplain the tradeoff.', capture);
  queue.add('content-comment', 'Another comment', capture);
  expect(restoreFeedbackDraft(saved)[0].context.selection).toEqual(capture.selection);
  await queue.copyAndClear(async text => { copied = text; });
  expect(copied).toBe('Repository: owner/storage\nWorkspace: workspace-a\n\n# notes.md\nRevision: document-revision\n\n## 1\n\n> first line\n> second line\n\nIs this **necessary**?\nExplain the tradeoff.\n\n## 2\n\n> first line\n> second line\n\nAnother comment\n');
  for (const omitted of ['Unchosen prefix', 'Unchosen suffix', 'application-revision', 'capturedAt', 'schemaVersion', 'elementId', 'batchId', 'rendered-markdown']) expect(copied).not.toContain(omitted);
});

it('keeps revisions and workspace scopes distinct and handles whole-document and feature comments', () => {
  const queue = createFeedbackQueue();
  queue.add('content-comment', 'First revision', { ...context, selection: null });
  queue.add('content-comment', 'Second revision', { ...context, target: { ...context.target, resource: { ...context.target.resource!, revision: 'next-revision' } } });
  queue.add('content-comment', 'Other workspace', { ...context, target: { ...context.target, resource: { ...context.target.resource!, repository: 'other/storage', workspace: 'other-workspace' } } });
  queue.add('feature-comment', 'Improve the browser', { ...context, target: { elementId: 'browser', label: 'Document browser', featureId: 'documents.browser', uiPath: ['Documents'] }, selection: null });
  const review = formatFeedbackReview(queue.getSnapshot().items);
  expect(review.match(/# notes\.md\n/g)).toHaveLength(3);
  expect(review).toContain('Revision: document-revision\n\n## 1\n\nFirst revision');
  expect(review).toContain('Revision: next-revision');
  expect(review).toContain('Repository: other/storage\nWorkspace: other-workspace');
  expect(review).toContain('# Document browser\n\n## 1 — Feature: documents.browser\n\nImprove the browser');
});

it('includes only real source line ranges, accounting for exclusive end positions and multiple selections', () => {
  const queue = createFeedbackQueue();
  const ranges = [{ startLineNumber: 3, startColumn: 2, endLineNumber: 5, endColumn: 1 }, { startLineNumber: 9, startColumn: 1, endLineNumber: 9, endColumn: 4 }];
  queue.add('content-comment', 'Source selection', { ...context, selection: { ...context.selection!, representation: 'source', ranges } });
  queue.add('content-comment', 'Rendered selection', { ...context, selection: { ...context.selection!, ranges } });
  queue.add('content-comment', 'Invalid legacy range', { ...context, selection: { ...context.selection!, representation: 'source', ranges: [{ ...ranges[0], startLineNumber: 0 }] } });
  const review = formatFeedbackReview(queue.getSnapshot().items);
  expect(review).toContain('## 1 — lines 3–4, 9');
  expect(review).toContain('## 2\n\n> selected words\n\nRendered selection');
  expect(review).toContain('## 3\n\n> selected words\n\nInvalid legacy range');
});
