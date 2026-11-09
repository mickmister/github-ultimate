import { expect, test } from 'vitest';
import { parseWorkspaceManifest } from '../hosted/manifest';

const base = { schema_version: 1, workspace: 'planning', observed_at: '2026-11-09T00:00:00Z' };
const repository = { path: 'application', branch: 'refs/heads/main', commit: 'a'.repeat(40), detached: false, dirty: false, publication: 'no_remote', remotes: [] };
test('standalone manifests require a reason and do not require repository or branch data', () => {
  for (const repositories of [undefined, [], null]) {
    const manifest = { ...base, purpose: 'Research the product before selecting repositories', repositories };
    expect(parseWorkspaceManifest(JSON.stringify(manifest), 'planning').purpose).toBe(manifest.purpose);
    for (const purpose of [undefined, '', ' \n\t']) expect(() => parseWorkspaceManifest(JSON.stringify({ ...manifest, purpose }), 'planning')).toThrow('nonblank purpose');
  }
});
test('existing repo-backed schema-v1 manifests remain valid and malformed pointers do not', () => {
  expect(parseWorkspaceManifest(JSON.stringify({ ...base, repositories: [repository] }), 'planning').repositories).toHaveLength(1);
  expect(parseWorkspaceManifest(JSON.stringify({ ...base, repositories: [{ ...repository, branch: '', detached: true }] }), 'planning').repositories).toHaveLength(1);
  for (const change of [
    { schema_version: 2 }, { workspace: 'different' }, { observed_at: 'not-a-timestamp' }, { observed_at: '2026-02-30T00:00:00Z' }, { observed_at: '2026-11-09T24:00:00Z' }, { repositories: {} },
    { repositories: [{ ...repository, path: '../outside' }] }, { repositories: [repository, repository] },
    { repositories: [{ ...repository, branch: 'main' }] }, { repositories: [{ ...repository, commit: 'short' }] },
    { repositories: [{ ...repository, publication: 'unverified', remotes: [{ name: 'origin', url: 'https://user:secret@example.com/repo' }] }] },
  ]) expect(() => parseWorkspaceManifest(JSON.stringify({ ...base, repositories: [repository], ...change }), 'planning')).toThrow('Invalid workspace/manifest.json');
});
