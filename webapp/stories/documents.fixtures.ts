import type { AppHooksV1, DocumentSnapshotDTO } from '../src/app-hooks/contracts';
import type { DocumentBrowserModel } from '../src/features/documents/contracts';
import { defaultTreeAppearance } from '../src/features/documents/tree-appearance';

export const mockConnection = Object.freeze({ id: 'mock-personal', name: 'Personal GitHub App', installationId: 123, account: 'octo-example' });
export const mockWorkspaces = Object.freeze([
  { id: 'product-research', hasDocuments: true },
  { id: 'release-planning', hasDocuments: true },
  { id: 'tasks-only', hasDocuments: false },
]);
export const mockDocumentContents: Readonly<Record<string, string>> = Object.freeze({
  brief: '# Product brief\n\nExplore a **calmer engineering workspace** for humans and agents.\n\n## Goals\n- Keep decisions alongside source.\n- Make the next action clear.\n- Preserve room for long-form research.\n\n| View | Purpose |\n| --- | --- |\n| Source | Inspect exact document bytes |\n| Markdown | Read formatted research |\n\n## Review\n- [x] Verify the document snapshot\n- [ ] Compare UI candidates\n\n```json\n{ "workspace": "product-research" }\n```\n\nThis is deterministic Storybook fixture data, not a live GitHub document.',
  research: '# Research notes\n\nPeople want a clear distinction between their workspace, access route, and the document they are reading.\n\nA split-pane layout keeps navigation nearby while leaving space for reading.',
  checklist: '# Release checklist\n\n[ ] Review the candidate UI\n[ ] Verify keyboard navigation\n[ ] Check a narrow viewport\n[ ] Promote the selected presentation',
  unsafe: '<script>window.__unsafeDocument = true</script>\n\nDocuments are displayed as text, including this deliberately literal script tag.',
  unsafeMarkdown: '# Untrusted Markdown\n\n<script>window.__unsafeDocument = true</script>\n<img src="https://example.invalid/tracker" onerror="window.__unsafeDocument = true">\n\n[Unsafe link](javascript:alert(1))\n\n**Safe document text**',
  config: '{\n  "workspace": "product-research",\n  "readOnly": true\n}',
  interview: '# Interview notes\n\nNested research notes for the document browser.',
  planningNotes: '# Planning notes\n\nA different document with the same basename.',
});
export const mockSnapshot: DocumentSnapshotDTO = Object.freeze({
  id: 'mock-snapshot', commit: 'a1b2c3d4'.repeat(5),
  purpose: 'Explore a workspace-first product before choosing source repositories.',
  documents: [
    { id: 'brief', path: 'planning/product-brief.md', size: 340 },
    { id: 'research', path: 'research/interview-notes.md', size: 264 },
    { id: 'checklist', path: 'releases/checklist.md', size: 156 },
    { id: 'unsafe', path: 'examples/literal-html.txt', size: 149 },
    { id: 'unsafeMarkdown', path: 'examples/untrusted.md', size: 220 },
    { id: 'config', path: 'workspace/config.json', size: 64 },
    { id: 'interview', path: 'research/interviews/notes.md', size: 70 },
    { id: 'planningNotes', path: 'planning/notes.md', size: 68 },
  ],
});
export const readyModel: DocumentBrowserModel = Object.freeze({
  connections: [mockConnection], connectionId: mockConnection.id, repository: 'octo-example/workspace-storage',
  workspaces: mockWorkspaces, workspaceId: 'product-research', snapshot: mockSnapshot,
  documentId: 'brief', query: '', expandedFolders: ['planning'], treeAppearance: defaultTreeAppearance, content: mockDocumentContents.brief, documentMode: 'source', busy: false,
  status: 'Mock document loaded. No extension or GitHub connection is used.', error: null,
  canDiscover: true, canBrowse: true,
});

/** Same public capability contract as production, with no transport or storage. */
export function createMockAppHooks(): AppHooksV1 {
  return Object.freeze({ contractVersion: 1, modules: Object.freeze({ documents: Object.freeze({
    version: 1,
    async connect() { return [mockConnection]; },
    async discover() { return mockWorkspaces; },
    async open() { return mockSnapshot; },
    async read(snapshotId: string, documentId: string) {
      if (snapshotId !== mockSnapshot.id || !(documentId in mockDocumentContents)) throw new Error('Unknown mock document.');
      return mockDocumentContents[documentId];
    },
    dispose() {},
  }) }) });
}
