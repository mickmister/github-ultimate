import type { GitRead } from '../../src/git-reads';
import type { GitTransport } from '../../hosted/workspaces';
import { createGitResourceResolver } from '../src/features/interactions/resources';
import type { PreviewServices } from '../src/features/interactions/preview';
import type { InteractionBatch } from '../src/features/interactions/schema';
import { currentDocumentAdapters } from '../src/features/interactions/document-adapters';

export const interactionBinding = { workspaceRef: 'ws-' + '1'.repeat(32), repository: 'example/storage', namespace: 'demo', collectionId: '11111111-1111-4111-8111-111111111111', doltCommit: 'a'.repeat(32) };
const commit = '1'.repeat(40), tree = '2'.repeat(40), build = '3'.repeat(40);
const bytes = new TextEncoder().encode('The **retry owner** is the dispatcher.');
const context = { target: { elementId: 'reader', label: 'plan.md', uiPath: ['Documents', 'Reader'], featureId: 'documents.markdown-renderer', resource: { kind: 'document' as const, id: 'plan', path: 'plan.md', revisionKind: 'git-commit' as const, revision: commit } }, selection: { text: 'retry owner', representation: 'source' }, appBuild: build, capturedAt: '2026-11-11T00:00:00Z' };
export const interactionExample: InteractionBatch = {
  schemaVersion: 2, batchId: '22222222-2222-4222-8222-222222222222', exportedAt: '2026-11-11T00:00:00Z',
  workspace: { workspaceRef: interactionBinding.workspaceRef, repository: interactionBinding.repository, namespace: interactionBinding.namespace },
  interactions: [
    { id: '33333333-3333-4333-8333-333333333331', version: 1, kind: 'content-comment', comment: 'Explain retries.', context },
    { id: '33333333-3333-4333-8333-333333333332', version: 1, kind: 'feature-comment', comment: 'Improve table layout.', context: structuredClone(context) },
    { id: '33333333-3333-4333-8333-333333333333', version: 1, kind: 'annotation', context: { ...structuredClone(context), selection: null }, payload: { schema: 'story.editor/v1', value: { elements: [{ id: 'note-1', text: 'retry owner' }] } }, selectors: [{ id: 'quote', type: 'text-quote', representation: 'source', quote: 'retry owner' }, { id: 'element', type: 'editor-elements', elementIds: ['note-1'] }], comments: [{ id: '44444444-4444-4444-8444-444444444444', body: 'Identify this owner.', selectorIds: ['quote', 'element'] }] },
    { id: '33333333-3333-4333-8333-333333333334', version: 1, kind: 'beads-changeset', changeset: { schema: 'beads.changeset/v1', changesetId: '55555555-5555-4555-8555-555555555555', workspaceRef: interactionBinding.workspaceRef, collectionId: interactionBinding.collectionId, observedDoltCommit: 'b'.repeat(32), operations: [
      { operationId: 'comment-1', type: 'comment.add', issueId: 'task-1', body: 'Check ownership.', precondition: { issueExists: true } },
      { operationId: 'label-1', type: 'label.add', issueId: 'task-1', label: 'needs-design', precondition: { labelPresent: false } },
    ] } },
  ],
};
const send: GitTransport = async <T>(request: GitRead): Promise<T> => {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`), object = new Uint8Array(header.length + bytes.length);
  object.set(header); object.set(bytes, header.length);
  const blob = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', object)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (request.operation === 'gitCommit' && request.oid === commit) return { sha: commit, tree: { sha: tree } } as T;
  if (request.operation === 'gitTree' && request.oid === tree) return { sha: tree, truncated: false, tree: [{ path: 'documents/plan.md', sha: blob, mode: '100644', type: 'blob', size: bytes.length }] } as T;
  if (request.operation === 'gitBlob' && request.oid === blob) return { sha: blob, size: bytes.length, encoding: 'base64', content: btoa(String.fromCharCode(...bytes)) } as T;
  throw new Error('Unexpected fixture read');
};
export const interactionServices: PreviewServices = {
  ...currentDocumentAdapters(build),
  resolve: createGitResourceResolver({ send, scope: { connectionId: '66666666-6666-4666-8666-666666666666', installationId: 1, repository: interactionBinding.repository, workspace: interactionBinding.namespace }, binding: interactionBinding, snapshotCommit: commit }),
  annotations: new Map([['story.editor/v1', () => ({ elementIds: ['note-1'] })]]),
  native: async request => ({ ...request, issues: [{ issueId: 'task-1', exists: true, labels: [] }] }),
};
