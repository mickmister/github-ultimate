import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { githubDevURL } from '../hosted/github-dev';
import { parseRoute, workspaceURL, resolveWorkspaceConnection } from '../hosted/routes';
import { WorkspaceCatalog, type Send } from '../hosted/catalog';
import { defineWorkspaceApps } from '../hosted/workspace-apps';
import type { HostedRequest } from '../src/hosted-protocol';

const oid = 'a'.repeat(40), tree = 'b'.repeat(40);
const connections = [1, 2].map(index => ({ id: crypto.randomUUID(), name: `App ${index}`, appId: index, installation: { id: index, account: `account-${index}` } }));
const content = Buffer.from(JSON.stringify({ schema_version: 1, workspace: 'planning', observed_at: '2026-11-09T00:00:00Z', purpose: 'Evaluate requirements before selecting repositories' }));
const sha = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
function transport() {
  return vi.fn(async (request: HostedRequest) => {
    if (request.operation === 'repositories') return [{ full_name: 'owner/storage' }, { full_name: 'owner/code' }];
    if (request.operation === 'gitRefs') return request.repository === 'owner/code' ? [] : request.prefix === 'documents/' ? [{ ref: 'refs/documents/planning', object: { sha: oid, type: 'commit' } }] : [{ ref: 'refs/dolt/recovery', object: { sha: oid, type: 'commit' } }];
    if (request.operation === 'gitCommit') return { sha: oid, tree: { sha: tree } };
    if (request.operation === 'gitTree') return { sha: tree, truncated: false, tree: [{ path: 'documents/workspace/manifest.json', type: 'blob', mode: '100644', sha, size: content.length }] };
    if (request.operation === 'gitBlob') return { sha, size: content.length, encoding: 'base64', content: content.toString('base64') };
    throw new Error('Unexpected operation');
  });
}
test('github.dev links pin custom-ref snapshots and encode document names safely', () => {
  expect(githubDevURL('owner/storage', oid)).toBe(`https://github.dev/owner/storage/tree/${oid}/documents`);
  expect(githubDevURL('owner/storage', oid, 'documents/review a.md', true)).toBe(`https://github.dev/owner/storage/blob/${oid}/documents/review%20a.md`);
  for (const path of ['../outside', '/absolute', 'documents/../outside']) expect(() => githubDevURL('owner/storage', oid, path)).toThrow();
  expect(() => githubDevURL('owner/storage', 'refs/documents/planning')).toThrow();
});
test('workspace detail routes survive refresh and reject invalid access metadata', () => {
  const route = { connectionId: connections[0].id, installationId: 1, repository: 'owner/storage', workspace: 'planning' };
  expect(parseRoute(workspaceURL(route))).toEqual({ ...route, page: 'workspace', app: 'beads' });
  expect(parseRoute(workspaceURL(route, 'review.custom'))).toMatchObject({ app: 'review.custom' });
  expect(parseRoute('')).toEqual({ page: 'chooser' });
  expect(() => parseRoute('#/workspace?connection=invalid')).toThrow();
});
test('connection-free workspace links resolve only a sole approved connection and still bind installation', () => {
  const url = workspaceURL({ installationId: 1, repository: 'owner/storage', workspace: 'planning' });
  expect(url).not.toContain('connection=');
  const route = parseRoute(url);
  if (route.page !== 'workspace') throw new Error('Expected workspace route');
  expect(route.connectionId).toBeUndefined();
  expect(resolveWorkspaceConnection(route, [connections[0]])).toBe(connections[0]);
  expect(() => resolveWorkspaceConnection(route, [])).toThrow('No approved signed-in connection');
  expect(() => resolveWorkspaceConnection(route, connections)).toThrow('more than one approved connection');
  expect(() => resolveWorkspaceConnection({ ...route, installationId: 999 }, [connections[0]])).toThrow('no fallback');
  expect(resolveWorkspaceConnection({ ...route, connectionId: connections[0].id }, connections)).toBe(connections[0]);
  expect(() => resolveWorkspaceConnection({ ...route, connectionId: crypto.randomUUID() }, [connections[0]])).toThrow('not approved');
  expect(() => parseRoute(url + '&connection=')).toThrow('Invalid workspace link');
});
test('catalogue deduplicates workspace identity while preserving each approved access route', async () => {
  const send = transport(), catalog = new WorkspaceCatalog(send as Send, connections, 'owner/storage');
  await catalog.prepare(() => {}, () => true);
  await catalog.loadMore(() => {}, () => true, () => {});
  expect([...catalog.workspaces.keys()]).toEqual(['owner/storage:planning']);
  const routes = catalog.workspaces.get('owner/storage:planning')!;
  expect(routes.map(route => route.connection.id)).toEqual(connections.map(connection => connection.id));
  expect(routes[0].opened.manifest.purpose).toContain('Evaluate requirements');
  expect(catalog.queue).toHaveLength(0);
  expect(catalog.notices).toHaveLength(0);
});
test('discovery batches are bounded and a rate limit stops rather than trying another credential', async () => {
  const send = transport(), catalog = new WorkspaceCatalog(send as Send, connections);
  await catalog.prepare(() => {}, () => true);
  await catalog.loadMore(() => {}, () => true, () => {}, 1);
  expect(catalog.queue.length).toBeGreaterThan(0);
  const failing = vi.fn(async () => { throw new Error('GitHub API rate limit: retry after tomorrow'); });
  const limited = new WorkspaceCatalog(failing as Send, connections);
  limited.queue.push({ connection: connections[0], repository: 'owner/storage' }, { connection: connections[1], repository: 'owner/storage' });
  await limited.loadMore(() => {}, () => true, () => {});
  expect(failing).toHaveBeenCalledTimes(1); expect(limited.queue).toHaveLength(2);
});
test('custom views can share a nug kind but must have unique stable app identities', () => {
  const load = async () => ({ mount() {} });
  const apps = defineWorkspaceApps([{ id: 'contracts.review', kind: 'contracts', title: 'Review', description: '', load }, { id: 'contracts.diff', kind: 'contracts', title: 'Diff', description: '', load }]);
  expect(apps.size).toBe(2);
  expect(() => defineWorkspaceApps([...apps.values(), ...apps.values()])).toThrow('unique stable IDs');
});
