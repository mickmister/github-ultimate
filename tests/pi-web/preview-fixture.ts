import { createHash } from 'node:crypto';
import { Connections, type ConnectionRecord } from '../../src/connections';
import { MobileGitHub } from '../../src/mobile-github';
import { gitObject, gitTreeEntries } from '../../src/scratch';

export function previewFixture(source: string, contextFiles = false) {
  const workspace = 'selected-workspace', repository = 'owner/storage', branch = 'feature/preview-slots';
  const entry = new URL(source);
  const record: ConnectionRecord = { id: crypto.randomUUID(), name: 'Workspace GitHub', appId: 123, clientId: 'IvFixture', user: { id: 1, login: 'owner' }, installation: { id: 7, account: 'owner' }, hostedGrants: [{ origin: entry.origin, subpath: entry.pathname }], tokens: { accessToken: 'private-github-secret', refreshToken: 'private-refresh-secret', expiresAt: Date.now() + 1e9, refreshExpiresAt: Date.now() + 2e9 } };
  const navigation = { connectionId: record.id, installationId: 7, repository, workspace };
  const document = new URL(source); record.recentNavigation = [{ source: document.origin + document.pathname, updatedAt: Date.now(), navigation }];
  const blobs = new Map<string, { sha: string; size: number; encoding: string; content: string }>(), files = new Map<string, { path: string; type: string; mode: string; sha: string; size: number }>();
  let generation = 1;
  const calls: string[] = [];
  function file(path: string, value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value)), sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    blobs.set(sha, { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
    files.set(path, { path, type: 'blob', mode: '100644', sha, size: bytes.length });
  }
   const manifest = (workspace: string) => ({ schema_version: 1, workspace, observed_at: '2026-11-24T00:00:00Z', repositories: [{ path: 'repo', branch: `refs/heads/${branch}`, commit: 'c'.repeat(40), publication: 'unverified', remotes: [{ name: 'origin', url: 'https://github.com/owner/repo.git' }] }] });
   file('documents/workspace/manifest.json', manifest(workspace));
   const identities = new Map<string, string>();
  const config = (title: string) => ({ schema_version: 1, repositories: [{ repository: 'owner/repo', previewSlots: [{ id: 'storybook', title, service: 'storybook', provider: { kind: 'github-pages', baseUrl: 'https://preview.example/owner-repo/', path: 'storybook/{previewDirectory}/?workspace={workspace}' } }] }] });
   file('documents/workspace-config.json', config('Storybook'));
   const sourceText = 'Pinned repository context 🌴\nNeedle source line';
   const sourceEntry = { name: 'README.md', type: 'blob', mode: '100644' as const, oid: gitObject('blob', sourceText), size: Buffer.byteLength(sourceText) };
   const sourceTree = gitTreeEntries([sourceEntry]);
   if (contextFiles) {
     blobs.set(sourceEntry.oid, { sha: sourceEntry.oid, size: sourceEntry.size, encoding: 'base64', content: Buffer.from(sourceText).toString('base64') });
     file('documents/workspace/context-sources.json', { schema_version: 1, sources: [{ id: 'notes', kind: 's3', endpoint: 'https://s3.us-west-004.backblazeb2.com/', bucket: 'chats', prefix: `workspace/context/${workspace}/` }] });
   }
  const store = { async all() { return [record]; }, async get(id: string) { return id === record.id ? record : undefined; }, async put() {}, async remove() {} };
   const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    if (new Headers(init?.headers).get('authorization') !== 'Bearer private-github-secret') throw Error('Missing GitHub authorization');
    if (url.pathname === '/user/installations') return Response.json({ installations: [{ id: 7, app_id: 123, account: { login: 'owner' }, permissions: { contents: 'read', metadata: 'read' } }] });
     if (url.pathname === '/user/installations/7/repositories') return Response.json({ repositories: [{ full_name: repository, private: true, default_branch: 'main' }, ...(contextFiles ? [{ full_name: 'owner/repo', private: true, default_branch: 'main' }] : [])] });
     if (contextFiles && url.pathname === '/graphql') {
       const { variables } = JSON.parse(String(init?.body));
       if (variables.oid === sourceTree) return Response.json({ data: { repository: { object: { oid: sourceTree, entries: [{ ...sourceEntry, mode: 33188 }] } } } });
       return Response.json({ data: { repository: { object: { oid: 'c'.repeat(40), tree: { oid: sourceTree } } } } });
     }
     if (url.pathname.includes('/matching-refs/')) return Response.json(url.pathname.endsWith('/documents/') ? [workspace, 'other-workspace'].map(name => { const sha = createHash('sha1').update(`${name}:${generation}`).digest('hex'); identities.set(sha, name); return { ref: `refs/documents/${name}`, object: { sha, type: 'commit' } }; }) : []);
     if (url.pathname.includes('/commits/')) { const sha = url.pathname.split('/').at(-1)!; return Response.json({ sha, tree: { sha } }); }
     if (url.pathname.includes('/trees/')) { const sha = url.pathname.split('/').at(-1)!; file('documents/workspace/manifest.json', manifest(identities.get(sha)!)); return Response.json({ sha, truncated: false, tree: [...files.values()] }); }
    if (url.pathname.includes('/blobs/')) return Response.json(blobs.get(url.pathname.split('/').at(-1)!));
    throw Error(`Unexpected fixture route ${url.pathname}`);
   };
   const connections = new Connections(store, fetcher);
   return { host: new MobileGitHub(connections), record, fetcher, navigation, branch, workspace, calls, update() { generation++; file('documents/workspace-config.json', config('Updated Storybook')); }, remove() { generation++; files.delete('documents/workspace-config.json'); } };
}
