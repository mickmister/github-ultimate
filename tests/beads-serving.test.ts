import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { resolveBeadsServing, selectBeadsServing } from '../hosted/beads-serving';
import { WorkspaceReader, type GitTransport, type Snapshot } from '../hosted/workspaces';
import type { GitRead, GitTree } from '../src/git-reads';

function fixture() {
  const sourceCommit = 'a'.repeat(40), packCommit = 'b'.repeat(40), treeId = 'c'.repeat(40), name = '0'.repeat(32);
  const manifest = Buffer.from(`5:__DOLT__:${name}:${name}:${name}`);
  const sha = createHash('sha1').update(`blob ${manifest.length}\0`).update(manifest).digest('hex');
  const manifestEntry = { path: 'manifest', mode: '100644', type: 'blob' as const, sha, size: manifest.length };
  const source: Snapshot = { commit: sourceCommit, tree: { sha: 'd'.repeat(40), truncated: false, tree: [manifestEntry, { ...manifestEntry, path: name, size: 70 * 1024 * 1024 }] } };
  const descriptor = { schemaVersion: 1, format: 'beads-current-head-v1', workspace: 'selected', collectionId: '11111111-1111-4111-8111-111111111111', sourceGitCommit: sourceCommit,
    storageRoot: name, doltCommit: name, root: name, manifest: { path: 'manifest', size: manifest.length, sha256: createHash('sha256').update(manifest).digest('hex') },
    files: [{ path: name, size: 123, sha256: 'f'.repeat(64) }] };
  const tree: GitTree = { sha: treeId, truncated: false, tree: [{ ...manifestEntry }, { ...manifestEntry, path: name, size: 123 }] };
  let refs = [{ ref: 'refs/beads/selected', object: { sha: packCommit, type: 'commit' as const } }];
  const send = vi.fn(async (request: GitRead) => {
    expect(request.id).toBe('11111111-1111-4111-8111-111111111111'); expect(request.namespace).toBe('dolt'); expect(request.repository).toBe('owner/private');
    if (request.operation === 'gitRefs') { expect(request.prefix).toBe('beads/'); return refs; }
    expect(request.workspace).toBe('selected');
    if (request.operation === 'gitCommit') { expect(request.oid).toBe(packCommit); return { sha: packCommit, tree: { sha: treeId } }; }
    if (request.operation === 'gitTree') { expect(request.oid).toBe(treeId); return tree; }
    if (request.operation === 'gitBlob') {
      const bytes = Buffer.from(JSON.stringify(descriptor)), sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      expect(request.oid).toBe(sha);
      return { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') };
    }
    throw new Error('Unexpected request');
  });
  const reader = new WorkspaceReader(send as GitTransport, '11111111-1111-4111-8111-111111111111', 'owner/private', 7, 'selected', 'dolt');
  const prepare = () => {
    const bytes = Buffer.from(JSON.stringify(descriptor));
    tree.tree = tree.tree.filter(entry => entry.path !== 'serving.json');
    tree.tree.push({ path: 'serving.json', type: 'blob', mode: '100644', size: bytes.length, sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') });
  };
  const select = (signal = new AbortController().signal) => { prepare(); return selectBeadsServing(reader, source, 'selected', signal); };
  const resolve = async (fresh: Snapshot, signal = new AbortController().signal) => {
    prepare();
    const refresh = vi.fn(async () => fresh);
    return { result: await resolveBeadsServing(reader, source, 'selected', signal, refresh), refresh };
  };
  return { source, descriptor, tree, send, select, resolve, noPack: () => { refs = []; } };
}

test('selects only the pinned compact native pack even when canonical storage exceeds 64 MiB', async () => {
  const value = fixture(), result = await value.select();
  expect(result?.entries.map(entry => entry.size)).toEqual([123]);
  expect(result?.descriptor.sourceGitCommit).toBe(value.source.commit);
  expect(value.send.mock.calls.filter(([request]) => request.operation === 'gitBlob')).toHaveLength(1); // descriptor only, no historical files
});

test('an absent pack permits the existing raw-snapshot path, while stale/misbound packs fail closed', async () => {
  const absent = fixture(); absent.noPack(); expect(await absent.select()).toBeUndefined();
  for (const change of [{ workspace: 'other' }, { sourceGitCommit: 'e'.repeat(40) }]) {
    const value = fixture(); Object.assign(value.descriptor, change); await expect(value.select()).rejects.toThrow('not current');
  }
});

test('rejects canonical manifest mismatch, duplicate files, symlinks, missing files and oversized current state', async () => {
  const mismatch = fixture(); mismatch.tree.tree[0].sha = 'f'.repeat(40); await expect(mismatch.select()).rejects.toThrow('canonical');
  const duplicate = fixture(); duplicate.descriptor.files.push(duplicate.descriptor.files[0]); await expect(duplicate.select()).rejects.toThrow('Duplicate');
  const symlink = fixture(); symlink.tree.tree[1].mode = '120000'; await expect(symlink.select()).rejects.toThrow('mismatched');
  const missing = fixture(); missing.tree.tree.splice(1, 1); await expect(missing.select()).rejects.toThrow('absent');
  const oversized = fixture(); oversized.descriptor.files = Array.from({ length: 5 }, (_, index) => ({ path: String(index).padStart(32, '0'), size: 14 * 1024 * 1024, sha256: 'f'.repeat(64) }));
  oversized.tree.tree = [oversized.tree.tree[0], ...oversized.descriptor.files.map(file => ({ path: file.path, mode: '100644', type: 'blob' as const, size: file.size, sha: 'a'.repeat(40) }))];
  await expect(oversized.select()).rejects.toThrow('64 MiB');
  await expect(fixture().select(AbortSignal.abort())).rejects.toThrow();
});

test('rediscovers once when the serving ref advances after canonical discovery', async () => {
  const value = fixture(), commit = 'e'.repeat(40);
  value.descriptor.sourceGitCommit = commit;
  const { result, refresh } = await value.resolve({ ...value.source, commit });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(result.snapshot.commit).toBe(commit);
  expect(result.serving?.descriptor.sourceGitCommit).toBe(commit);
});

test('still rejects a genuinely stale pack after bounded reconciliation, with revision diagnostics', async () => {
  const value = fixture(); value.descriptor.sourceGitCommit = 'e'.repeat(40);
  await expect(value.resolve(value.source)).rejects.toThrow(`Canonical: ${value.source.commit}; pack source: ${value.descriptor.sourceGitCommit}`);
  expect(value.send.mock.calls.filter(([request]) => request.operation === 'gitRefs')).toHaveLength(2);
});
