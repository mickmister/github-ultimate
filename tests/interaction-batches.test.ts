import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { GitRead, GitTree } from '../src/git-reads';
import type { GitTransport } from '../hosted/workspaces';
import { documentsV1Adapter, importBatch, validateBatch } from '../webapp/src/features/interactions/batch';
import { previewBatch, type PreviewServices } from '../webapp/src/features/interactions/preview';
import { createGitResourceResolver } from '../webapp/src/features/interactions/resources';
import type { InteractionBatch } from '../webapp/src/features/interactions/schema';

const binding = { workspaceRef: 'ws-' + '1'.repeat(32), repository: 'example/storage', namespace: 'demo', collectionId: '11111111-1111-4111-8111-111111111111', doltCommit: 'a'.repeat(32) };
const commit = '1'.repeat(40), treeOid = '2'.repeat(40), build = '3'.repeat(40);
const source = 'Before 😀 retry owner. After\r\nretry owner.';
const sourceBytes = new TextEncoder().encode(source);
const imageBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
const oid = (bytes: Uint8Array) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const sourceOid = oid(sourceBytes), imageOid = oid(imageBytes);
const tree: GitTree = { sha: treeOid, truncated: false, tree: [
  { path: 'documents/plan.md', type: 'blob', mode: '100644', sha: sourceOid, size: sourceBytes.length },
  { path: 'documents/diagram.png', type: 'blob', mode: '100644', sha: imageOid, size: imageBytes.length },
] };
function transport(corrupt = false): GitTransport {
  return async <T>(request: GitRead): Promise<T> => {
    if (request.operation === 'gitCommit' && request.oid === commit) return { sha: commit, tree: { sha: treeOid } } as T;
    if (request.operation === 'gitTree' && request.oid === treeOid) return tree as T;
    if (request.operation === 'gitBlob') {
      const bytes = request.oid === sourceOid ? sourceBytes : imageBytes;
      return { sha: request.oid, encoding: 'base64', size: bytes.length, content: Buffer.from(corrupt ? bytes.map(byte => byte ^ 1) : bytes).toString('base64') } as T;
    }
    throw new Error('Unexpected fixture request');
  };
}
function fixture(): InteractionBatch {
  const context = { target: { elementId: 'reader', label: 'plan.md', uiPath: ['Documents', 'Reader'], featureId: 'documents.markdown-renderer', resource: { kind: 'document' as const, id: sourceOid + ':documents/plan.md', path: 'plan.md', revisionKind: 'git-commit' as const, revision: commit } }, selection: { text: 'retry owner', representation: 'source', prefix: 'Before 😀 ', suffix: '. After' }, appBuild: build, capturedAt: '2026-11-11T00:00:00Z' };
  return { schemaVersion: 2, batchId: '22222222-2222-4222-8222-222222222222', exportedAt: '2026-11-11T00:00:00Z', workspace: { workspaceRef: binding.workspaceRef, repository: binding.repository, namespace: binding.namespace }, interactions: [
    { id: '33333333-3333-4333-8333-333333333331', version: 1, kind: 'content-comment', comment: 'Clarify retry ownership.', context },
    { id: '33333333-3333-4333-8333-333333333332', version: 2, kind: 'feature-comment', comment: 'Improve table layout.', context: structuredClone(context) },
    { id: '33333333-3333-4333-8333-333333333333', version: 1, kind: 'annotation', context: { ...structuredClone(context), selection: null, target: { ...context.target, resource: { kind: 'image', id: 'diagram', path: 'diagram.png', revisionKind: 'git-blob', revision: imageOid } } },
      payload: { schema: 'test-editor/v1', value: { shapes: [{ id: 'rect-1' }] } }, selectors: [{ id: 'region', type: 'image-region', imageWidth: 1, imageHeight: 1, x: 0, y: 0, width: 1, height: 1 }, { id: 'shape', type: 'editor-elements', elementIds: ['rect-1'] }], comments: [{ id: '44444444-4444-4444-8444-444444444444', body: 'Retry here.', selectorIds: ['region', 'shape'] }] },
    { id: '33333333-3333-4333-8333-333333333334', version: 1, kind: 'beads-changeset', changeset: { schema: 'beads.changeset/v1', changesetId: '55555555-5555-4555-8555-555555555555', workspaceRef: binding.workspaceRef, collectionId: binding.collectionId, observedDoltCommit: 'b'.repeat(32), operations: [
      { operationId: 'comment-1', type: 'comment.add', issueId: 'task-1', body: 'Check retry ownership.', precondition: { issueExists: true } },
      { operationId: 'label-1', type: 'label.add', issueId: 'task-1', label: 'needs-design', precondition: { labelPresent: false } },
    ] } },
  ] };
}
function services(corrupt = false): PreviewServices {
  return {
    resolve: createGitResourceResolver({ send: transport(corrupt), scope: { connectionId: '66666666-6666-4666-8666-666666666666', installationId: 123, repository: binding.repository, workspace: binding.namespace }, binding, snapshotCommit: commit, imageDimensions: async () => ({ width: 1, height: 1 }) }),
    feature: (featureId, appBuild) => featureId === 'documents.markdown-renderer' && appBuild === build,
    native: async request => ({ ...request, issues: [{ issueId: 'task-1', exists: true, issueVersion: 'sha256:' + 'a'.repeat(64), labels: [] }] }),
    annotations: new Map([['test-editor/v1', () => ({ elementIds: ['rect-1'] })]]),
  };
}
const content = (batch: InteractionBatch) => { const item = batch.interactions[0]; if (item.kind !== 'content-comment') throw new Error(); return item; };
const annotation = (batch: InteractionBatch) => { const item = batch.interactions[2]; if (item.kind !== 'annotation') throw new Error(); return item; };
const native = (batch: InteractionBatch) => { const item = batch.interactions[3]; if (item.kind !== 'beads-changeset') throw new Error(); return item; };

describe('shared batch composition and explicit legacy adaptation', () => {
  it('adapts an actual-shaped v1 export without generating IDs, URLs or revision guesses', () => {
    const batch = fixture(), item = content(batch);
    const { revisionKind, ...resource } = item.context.target.resource!;
    const legacy = JSON.stringify({ schemaVersion: 1, batchId: batch.batchId, exportedAt: batch.exportedAt, interactions: [{ ...item, context: { ...item.context, target: { ...item.context.target, resource: { ...resource, repository: binding.repository, workspace: binding.namespace } } } }] });
    expect(() => importBatch(legacy, binding)).toThrow('explicit producer adapter');
    const adapted = importBatch(legacy, binding, documentsV1Adapter(binding));
    expect(adapted.interactions[0]).toMatchObject({ id: item.id, version: item.version, context: { target: { resource: { revisionKind: 'git-commit', revision: commit } } } });
    expect(adapted.interactions[0]).not.toHaveProperty('context.pageUrl');
    const rendered = JSON.parse(legacy);
    rendered.interactions[0].context.selection = { text: 'retry owner', representation: 'rendered-markdown', textRange: { startOffset: 10, endOffset: 21 } };
    expect(importBatch(JSON.stringify(rendered), binding, documentsV1Adapter(binding)).interactions[0]).toHaveProperty('context.selection.textRange', { startOffset: 10, endOffset: 21 });
    const unknown = JSON.parse(legacy); unknown.interactions.push({ ...unknown.interactions[0], kind: 'run-command' });
    expect(() => importBatch(JSON.stringify(unknown), binding, documentsV1Adapter(binding))).toThrow('all original items');
  });
  it('rejects mismatched scopes, duplicate identities and changed native groups instead of dropping entries', () => {
    const batch = fixture();
    batch.workspace.namespace = 'other'; expect(() => validateBatch(batch, binding)).toThrow('selected workspace');
    const duplicate = fixture(); duplicate.interactions[1].id = duplicate.interactions[0].id;
    expect(() => validateBatch(duplicate, binding)).toThrow('Duplicate');
    const wrong = fixture(); native(wrong).changeset.collectionId = '77777777-7777-4777-8777-777777777777';
    expect(() => validateBatch(wrong, binding)).toThrow('selected collection');
    const repeated = fixture(); const op = native(repeated).changeset.operations[1]; native(repeated).changeset.operations.push({ ...op, operationId: 'another' });
    expect(() => validateBatch(repeated, binding)).toThrow('Duplicate');
  });
  it('enforces Unicode byte limits, selector associations and unknown fields', () => {
    const batch = fixture(); content(batch).comment = '💡'.repeat(20000);
    expect(() => validateBatch(batch, binding)).toThrow('64 KiB');
    const unicode = fixture(); content(unicode).comment = '\ud800'; expect(() => validateBatch(unicode, binding)).toThrow('surrogate');
    const linked = fixture(); annotation(linked).comments[0].selectorIds = ['missing']; expect(() => validateBatch(linked, binding)).toThrow('missing selector');
    expect(() => validateBatch({ ...fixture(), approved: true }, binding)).toThrow('approved');
    expect(() => importBatch(' '.repeat(1024 * 1024) + '{}', binding)).toThrow('1 MiB');
  });
});

describe('verified pinned-resource previews', () => {
  it('resolves real Git blob bytes, keeps feature/content targets separate and permits unrelated native head advancement', async () => {
    const result = await previewBatch(fixture(), binding, services());
    expect(result.ready).toBe(true);
    expect(result.rows.map(row => row.group)).toEqual(['documents', 'documents', 'documents', 'native-beads']);
    expect(result.rows[0].resource).toEqual({ blobOid: sourceOid, path: 'documents/plan.md', snapshotCommit: commit });
    expect(result.rows[0].anchors[0]).toEqual({ id: 'selection', status: 'exact', ranges: [{ startUtf8: 12, endUtf8: 23 }] });
    expect(result.rows[1].target).toEqual({ kind: 'feature', featureId: 'documents.markdown-renderer', appBuild: build });
    expect(result.rows[2].item).toEqual(fixture().interactions[2]);
    expect(result.rows[3].target).toMatchObject({ observedDoltCommit: 'b'.repeat(32), previewDoltCommit: binding.doltCommit });
  });
  it('keeps replay identities/digests stable across exports and property order, but binds edits', async () => {
    const batch = fixture(); const first = await previewBatch(batch, binding, services());
    const exported = JSON.parse(JSON.stringify(batch)); exported.batchId = '88888888-8888-4888-8888-888888888888'; exported.exportedAt = '2026-11-12T00:00:00Z';
    exported.workspace = Object.fromEntries(Object.entries(exported.workspace).reverse());
    const second = await previewBatch(exported, binding, services());
    expect(second.rows.map(row => [row.effectId, row.itemDigest])).toEqual(first.rows.map(row => [row.effectId, row.itemDigest]));
    content(batch).comment = 'Edited thought'; content(batch).version++;
    expect((await previewBatch(batch, binding, services())).rows[0].itemDigest).not.toBe(first.rows[0].itemDigest);
  });
  it('reports stale, ambiguous and unsupported representation anchors without moving the original target', async () => {
    const batch = fixture(); content(batch).context.selection = { text: 'retry owner', representation: 'source' };
    const ambiguous = await previewBatch(batch, binding, services()); expect(ambiguous.rows[0].anchors[0].status).toBe('ambiguous');
    content(batch).context.selection!.text = 'no longer present';
    expect((await previewBatch(batch, binding, services())).rows[0].anchors[0].status).toBe('orphaned');
    content(batch).context.selection!.representation = 'rendered-markdown';
    const unsupported = await previewBatch(batch, binding, services());
    expect(unsupported.rows[0].status).toBe('unsupported'); expect(unsupported.rows).toHaveLength(4);
    expect(unsupported.rows[0].item).toEqual(batch.interactions[0]);
  });
  it('converts exact UTF-16 model ranges to UTF-8 source offsets and rejects stale selections', async () => {
    const batch = fixture(); content(batch).context.selection = { text: '😀', representation: 'source', ranges: [{ startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 10 }] };
    const preview = await previewBatch(batch, binding, services());
    expect(preview.rows[0].anchors[0].ranges).toEqual([{ startUtf8: 7, endUtf8: 11 }]);
    content(batch).context.selection!.text = 'different'; expect((await previewBatch(batch, binding, services())).rows[0].issues[0].code).toBe('stale-range');
    content(batch).context.selection = { text: 'retry owner.', representation: 'source', ranges: [{ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 13 }] };
    expect((await previewBatch(batch, binding, services())).rows[0].anchors[0].ranges).toEqual([{ startUtf8: 32, endUtf8: 44 }]);
  });
  it('blocks corrupt blobs, unknown native payloads, mismatched image dimensions and missing native readers', async () => {
    const corrupt = await previewBatch(fixture(), binding, services(true));
    expect(corrupt.ready).toBe(false); expect(corrupt.rows[0].issues[0].message).toContain('integrity');
    const batch = fixture(); annotation(batch).payload.schema = 'unknown-editor/v2';
    expect((await previewBatch(batch, binding, services())).rows[2].issues[0].code).toBe('annotation-format');
    const dimensions = fixture(); annotation(dimensions).selectors[0] = { id: 'region', type: 'image-region', imageWidth: 2, imageHeight: 2, x: 0, y: 0, width: 1, height: 1 };
    expect((await previewBatch(dimensions, binding, services())).rows[2].issues[0].code).toBe('image-dimensions');
    expect((await previewBatch(fixture(), binding, { ...services(), native: undefined })).rows[3].status).toBe('unsupported');
  });
  it('checks label membership and optional strict versions against the selected native snapshot', async () => {
    const adapter: PreviewServices = { ...services(), native: async request => ({ ...request, issues: [{ issueId: 'task-1', exists: true, labels: ['needs-design'], issueVersion: 'sha256:' + 'a'.repeat(64) }] }) };
    expect((await previewBatch(fixture(), binding, adapter)).rows[3].issues[0].code).toBe('label-membership');
    const batch = fixture(); native(batch).changeset.operations[0].precondition.issueVersion = 'sha256:' + 'b'.repeat(64);
    expect((await previewBatch(batch, binding, services())).rows[3].issues[0].code).toBe('issue-version');
    const badReader: PreviewServices = { ...services(), native: async request => ({ ...request, collectionId: 'other', issues: [] }) };
    expect((await previewBatch(fixture(), binding, badReader)).rows[3].issues[0].code).toBe('native-snapshot-binding');
  });
  it('cancels cooperatively without processing subsequent items', async () => {
    const controller = new AbortController(), resolve = vi.fn(services().resolve);
    controller.abort(); await expect(previewBatch(fixture(), binding, { ...services(), resolve }, controller.signal)).rejects.toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });
  it('does not read arbitrary blobs outside a verified snapshot membership or a substituted workspace', async () => {
    const batch = fixture(), resolver = services().resolve, resource = content(batch).context.target.resource!;
    await expect(resolver({ ...resource, revisionKind: 'git-blob', revision: 'f'.repeat(40) })).rejects.toThrow('missing');
    await expect(resolver({ ...resource, repository: 'other/repo' })).rejects.toThrow('different workspace');
    await expect(resolver({ ...resource, path: '../outside' })).rejects.toThrow('document-relative');
  });
});
