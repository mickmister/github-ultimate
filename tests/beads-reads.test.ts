import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gitReadSchema, readGit, gitBlobPartBytes, type GitRead } from '../src/git-reads';
import { WorkspaceReader, type GitTransport } from '../hosted/workspaces';

const scope = { id: crypto.randomUUID(), installationId: 1, repository: 'owner/storage', workspace: 'sample', namespace: 'dolt' as const };
test('Dolt blob parts are bounded, aligned and unavailable to ordinary document reads', async () => {
  const bytes = Buffer.from('abcdefghij'), sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const request = { ...scope, operation: 'gitBlobPart' as const, oid: sha, offset: 3, length: 6 };
  expect(gitReadSchema.parse(request)).toEqual(request);
  expect(await readGit(request, scope.repository, async () => ({ sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }))).toMatchObject({ sha, offset: 3, length: 6, content: Buffer.from('defghi').toString('base64') });
  for (const invalid of [{ namespace: 'documents' }, { offset: -3 }, { offset: 1 }, { length: gitBlobPartBytes + 3 }, { length: 0 }]) expect(gitReadSchema.safeParse({ ...request, ...invalid }).success).toBe(false);
});
test('large native blobs are reassembled and whole-Git-hash verified; corrupted parts never reach the engine', async () => {
  const bytes = Buffer.alloc(16 * 1024 * 1024 + 17, 42), sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const entry = { path: 'a'.repeat(32) + '.darc', sha, size: bytes.length, type: 'blob' as const, mode: '100644' };
  let corrupt = false;
  const send = vi.fn(async (request: GitRead) => {
    if (request.operation !== 'gitBlobPart') throw new Error('Expected multipart read');
    const part = Buffer.from(bytes.subarray(request.offset, request.offset + request.length)); if (corrupt && request.offset === 0) part[0] ^= 1;
    return { sha, size: bytes.length, offset: request.offset, length: part.length, encoding: 'base64', content: part.toString('base64') };
  });
  const native = new WorkspaceReader(send as GitTransport, scope.id, scope.repository, 1, scope.workspace, 'dolt');
  expect(Buffer.from(await native.blob(entry)).equals(bytes)).toBe(true);
  expect(send.mock.calls).toHaveLength(Math.ceil(bytes.length / gitBlobPartBytes));
  expect(send.mock.calls.every(([request]) => request.operation === 'gitBlobPart' && request.namespace === 'dolt' && request.repository === scope.repository && request.workspace === scope.workspace)).toBe(true);
  corrupt = true; await expect(native.blob(entry)).rejects.toThrow('integrity');
  const document = new WorkspaceReader(send as GitTransport, scope.id, scope.repository, 1, scope.workspace);
  await expect(document.blob(entry)).rejects.toThrow('read limit');
  await expect(native.blob(entry, AbortSignal.abort())).rejects.toThrow();
  await expect(native.blob({ ...entry, size: 65 * 1024 * 1024 })).rejects.toThrow('read limit');
}, 20000);
