import { expect, it } from 'vitest';
import { buildDocumentTree } from '../webapp/src/features/documents/document-tree';

it('keeps document identities and full folder paths distinct, with folders first and natural ordering', () => {
  const documents = Object.freeze([
    Object.freeze({ id: 'a', path: 'research/interviews/notes.md', size: 12 }),
    Object.freeze({ id: 'b', path: 'planning/notes.md', size: 14 }),
    Object.freeze({ id: 'c', path: 'readme10.md', size: null }),
    Object.freeze({ id: 'd', path: 'readme2.md', size: 0 }),
    Object.freeze({ id: 'e', path: 'planning/interviews/notes.md', size: 15 }),
  ]);
  const tree = buildDocumentTree(documents, '');
  expect(tree.root.children?.map(node => node.name)).toEqual(['planning', 'research', 'readme2.md', 'readme10.md']);
  const planning = tree.root.children![0], research = tree.root.children![1];
  expect(planning.children![0].path).toBe('planning/interviews');
  expect(research.children![0].path).toBe('research/interviews');
  expect(planning.children![0].id).not.toBe(research.children![0].id);
  expect(planning.children![1].document).toBe(documents[1]);
  expect(research.children![0].children![0].document).toBe(documents[0]);
  expect(documents[0].path).toBe('research/interviews/notes.md');
});

it('retains the full hierarchy for case-insensitive path matches and removes unrelated branches', () => {
  const documents = [{ id: 'a', path: 'research/interviews/notes.md', size: 12 }, { id: 'b', path: 'planning/notes.md', size: 14 }];
  const tree = buildDocumentTree(documents, ' INTERVIEWS/NOTES ');
  expect(tree.count).toBe(1);
  expect(tree.folders).toEqual(['research', 'research/interviews']);
  expect(tree.root.children![0].children![0].children![0].document?.id).toBe('a');
  expect(buildDocumentTree(documents, 'no-match').root.children).toEqual([]);
});
