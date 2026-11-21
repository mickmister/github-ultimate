import { expect, test } from 'vitest';
import { diffMarkdownBlocks } from '../webapp/src/features/reviews/markdown-block-diff';

test('keeps unchanged context between replacements, additions and deletions', () => {
  expect(diffMarkdownBlocks(['heading', 'old paragraph', 'table', 'deleted'], ['heading', 'new paragraph', 'table', 'added'])).toEqual([
    { kind: 'unchanged', blocks: ['heading'] },
    { kind: 'removed', blocks: ['old paragraph'] },
    { kind: 'added', blocks: ['new paragraph'] },
    { kind: 'unchanged', blocks: ['table'] },
    { kind: 'removed', blocks: ['deleted'] },
    { kind: 'added', blocks: ['added'] },
  ]);
});

test.each([
  [[], []], [[], ['new']], [['old'], []], [['same'], ['same']],
  [['a', 'b', 'a', 'c'], ['a', 'a', 'b', 'c']],
  [['one', 'two', 'three'], ['three', 'two', 'one']],
])('both pinned documents can be reconstructed without losing or duplicating blocks: %j → %j', (before, after) => {
  const changes = diffMarkdownBlocks(before, after);
  expect(changes.filter(change => change.kind !== 'added').flatMap(change => change.blocks)).toEqual(before);
  expect(changes.filter(change => change.kind !== 'removed').flatMap(change => change.blocks)).toEqual(after);
});

test('large rewrites retain common edges and show the whole replacement with bounded work', () => {
  const before = ['heading', ...Array.from({ length: 1100 }, (_, i) => `old ${i}`), 'footer'];
  const after = ['heading', ...Array.from({ length: 1100 }, (_, i) => `new ${i}`), 'footer'];
  const changes = diffMarkdownBlocks(before, after);
  expect(changes.map(change => change.kind)).toEqual(['unchanged', 'removed', 'added', 'unchanged']);
  expect(changes[1].blocks).toEqual(before.slice(1, -1));
  expect(changes[2].blocks).toEqual(after.slice(1, -1));
});
