import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { WorkspaceReader, documents, documentText, type GitTransport } from '../hosted/workspaces';
import { boundedJSON, gitReadSchema } from '../src/git-reads';
import type { GitRead } from '../src/git-reads';

const scope = { id: crypto.randomUUID(), repository: 'owner/storage', installationId: 1, workspace: 'workspace-a' };
const oid = 'a'.repeat(40);
test('workspace discovery unions ref namespaces without merging unrelated identities', async () => {
  const send = vi.fn(async (request: Extract<GitRead, { operation: 'gitRefs' }>) => [
    { ref: `refs/${request.prefix}shared`, object: { sha: oid, type: 'commit' } },
    { ref: `refs/${request.prefix}${request.prefix === 'dolt/' ? 'recovery' : 'documents-only'}`, object: { sha: oid, type: 'commit' } },
  ]);
  const reader = new WorkspaceReader(send as GitTransport, scope.id, scope.repository, scope.installationId, scope.workspace);
  expect(await reader.discover()).toEqual([{ name: 'documents-only', documents: oid }, { name: 'recovery', dolt: oid }, { name: 'shared', documents: oid, dolt: oid }]);
  expect(send.mock.calls.every(([request]) => request.id === scope.id && request.repository === scope.repository)).toBe(true);
});
test('snapshot pins the commit tree and excludes symlinks and non-document files', async () => {
  const entries = [
    { path: 'documents/workspace/manifest.json', type: 'blob', mode: '100644', sha: oid, size: 10 },
    { path: 'documents/symlink', type: 'blob', mode: '120000', sha: oid, size: 10 },
    { path: 'other.json', type: 'blob', mode: '100644', sha: oid, size: 10 },
  ];
  const send = vi.fn(async (request: GitRead) => request.operation === 'gitCommit' ? { sha: oid, tree: { sha: 'b'.repeat(40) } } : { sha: 'b'.repeat(40), tree: entries, truncated: false });
  const reader = new WorkspaceReader(send as GitTransport, scope.id, scope.repository, scope.installationId, scope.workspace);
  const snapshot = await reader.snapshot(oid);
  expect(documents(snapshot).map(entry => entry.path)).toEqual(['documents/workspace/manifest.json']);
  expect(send.mock.calls[1][0]).toMatchObject({ oid: 'b'.repeat(40) });
});
test('document reads verify Git object bytes, size and text encoding before preview', async () => {
  const bytes = Buffer.from('<script>private document</script>');
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const blob = { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') };
  const send = vi.fn(async () => blob);
  const reader = new WorkspaceReader(send as GitTransport, scope.id, scope.repository, scope.installationId, scope.workspace);
  const entry = { sha, size: bytes.length, type: 'blob' as const, mode: '100644', path: 'documents/private.md' };
  expect(documentText(await reader.blob(entry))).toBe(bytes.toString());
  blob.content = Buffer.from('x'.repeat(bytes.length)).toString('base64');
  await expect(reader.blob(entry)).rejects.toThrow('integrity');
  await expect(reader.blob({ ...entry, size: 20 * 1024 * 1024 })).rejects.toThrow('limit');
  await expect(reader.blob({ ...entry, mode: '120000' })).rejects.toThrow('regular');
  expect(() => documentText(new Uint8Array([0]))).toThrow('Binary');
  expect(() => documentText(new Uint8Array([255]))).toThrow('UTF-8');
});
test('bounded responses stop streaming immediately at the byte cap', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(11)); }, cancel() { cancelled = true; } });
  await expect(boundedJSON(new Response(stream), 10)).rejects.toThrow('limit');
  expect(cancelled).toBe(true);
  expect(await boundedJSON(Response.json({ ok: true }), 100)).toEqual({ ok: true });
  for (const value of ['../main', 'a'.repeat(41), `${oid}?raw=1`]) expect(gitReadSchema.safeParse({ ...scope, operation: 'gitBlob', oid: value }).success).toBe(false);
});

test('opening a workspace requires its hash-verified manifest before exposing the snapshot', async () => {
  const bytes = Buffer.from(JSON.stringify({ schema_version: 1, workspace: scope.workspace, observed_at: '2026-11-09T00:00:00Z', purpose: 'Coordinate independent design research' }));
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  let includeManifest = true;
  const send = vi.fn(async (request: GitRead) => {
    if (request.operation === 'gitCommit') return { sha: oid, tree: { sha: oid } };
    if (request.operation === 'gitTree') return { sha: oid, truncated: false, tree: includeManifest ? [{ path: 'documents/workspace/manifest.json', type: 'blob', mode: '100644', sha, size: bytes.length }] : [] };
    return { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') };
  });
  const reader = new WorkspaceReader(send as GitTransport, scope.id, scope.repository, scope.installationId, scope.workspace);
  const opened = await reader.open({ name: scope.workspace, documents: oid });
  expect(opened.manifest.purpose).toBe('Coordinate independent design research');
  expect(opened.version).toBe(sha);
  expect(send.mock.calls.every(([request]) => request.installationId === scope.installationId)).toBe(true);
  includeManifest = false;
  await expect(reader.open({ name: scope.workspace, documents: oid })).rejects.toThrow('manifest is required');
  const count = send.mock.calls.length;
  await expect(reader.open({ name: scope.workspace, dolt: oid })).rejects.toThrow('no matching documents ref');
  expect(send).toHaveBeenCalledTimes(count);
});
