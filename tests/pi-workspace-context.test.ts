import { expect, test } from 'vitest';
import { PiWorkspaceContext } from '../hosted/pi-workspace-context';
import type { PiBridge } from '../hosted/pi-transport';
import { gitObject } from '../src/scratch';
import { workspaceFilesSchema } from '../src/workspace-context-interface';

function fixture(options: { s3?: boolean; members?: boolean; connectionCopies?: number } = {}) {
  const workspace = { repository: 'owner/storage', workspace: 'workspace' };
  let selected: typeof workspace | undefined = workspace, head = 'a'.repeat(40), corrupt = false, s3Content = 'Private workspace context 🌴', s3Etag = 'etag-1';
  const calls: Parameters<PiBridge>[0][] = [], blobs = new Map<string, { sha: string; size: number; encoding: 'base64'; content: string }>();
  const blob = (text: string) => { const sha = gitObject('blob', text), bytes = Buffer.from(text); blobs.set(sha, { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }); return { sha, size: bytes.length }; };
  const makeFile = (name: string, text: string) => { const value = blob(text); return { name, mode: '100644', type: 'blob', oid: value.sha, size: value.size }; };
  const sourceFiles = [makeFile('README.md', 'Original pinned source 🌴\nNeedle line\nLast line'), makeFile('binary.bin', '\0binary'), { name: 'link', mode: '120000', type: 'blob', oid: '9'.repeat(40), size: 12 }];
  const nextFiles = [makeFile('README.md', 'New branch content')];
  const docText = blob('Workspace document\nNeedle document');
  const members = options.members === false ? [] : [
    { path: 'app', branch: 'refs/heads/main', commit: '1'.repeat(40), publication: 'unverified', remotes: [{ name: 'origin', url: 'git@github.com:owner/app.git' }] },
    { path: 'library', detached: true, commit: '2'.repeat(40), publication: 'unverified', remotes: [{ name: 'origin', url: 'https://github.com/owner/library.git' }] },
  ];
  const manifest = blob(JSON.stringify({ schema_version: 1, workspace: workspace.workspace, observed_at: '2026-11-25T00:00:00Z', purpose: 'Context test', repositories: members }));
  const config = blob(JSON.stringify({ schema_version: 1, sources: [{ id: 'notes', kind: 's3', endpoint: 'https://s3.example/', bucket: 'private', prefix: 'workspace/notes/' }] }));
  const docEntries = [
    { path: 'documents/workspace/manifest.json', type: 'blob', mode: '100644', ...manifest },
    { path: 'documents/guide.md', type: 'blob', mode: '100644', ...docText },
    ...(options.s3 ? [{ path: 'documents/workspace/context-sources.json', type: 'blob', mode: '100644', ...config }] : []),
  ];
  const ids = Array.from({ length: options.connectionCopies ?? 1 }, () => crypto.randomUUID());
  const s3 = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Private', endpoint: 'https://s3.example/', bucket: 'private', prefix: 'workspace/', region: 'us-east-1', addressing: 'path' as const, allowRead: true, allowUpload: false, allowOverwrite: false, hostedGrants: [] };
  const send: PiBridge = async request => {
    calls.push(request);
    if (request.operation === 'connections') return ids.map(id => ({ id, name: 'GitHub', appId: 1, user: { id: 42, login: 'test' }, installation: { id: 2, account: 'owner' } })) as never;
    if (request.operation === 'repositories') return ['owner/storage', 'owner/app', 'owner/library', 'owner/unrelated'].map(full_name => ({ full_name })) as never;
    if (request.operation === 'gitRefs') return [{ ref: 'refs/documents/workspace', object: { sha: '3'.repeat(40) } }] as never;
    if (request.operation === 'gitCommit') return { sha: request.oid, tree: { sha: '4'.repeat(40) } } as never;
    if (request.operation === 'gitTree') return { sha: request.oid, truncated: false, tree: docEntries } as never;
    if (request.operation === 'gitBlob' || request.operation === 'agentBlob') {
      const value = blobs.get(request.oid)!;
      return (corrupt ? { ...value, content: Buffer.from('Corrupted').toString('base64') } : value) as never;
    }
    if (request.operation === 'agentGraphql') return { data: { repository: { object: { oid: request.variables.name === 'library' ? '2'.repeat(40) : head, tree: { oid: head === 'a'.repeat(40) ? '5'.repeat(40) : '6'.repeat(40) } } } } } as never;
    if (request.operation === 'agentTree') return (request.oid === '5'.repeat(40) ? sourceFiles : nextFiles) as never;
    if (request.operation === 's3Connections') return [s3] as never;
    if (request.operation === 's3List') return { objects: [{ key: 'workspace/notes/context.txt', size: Buffer.byteLength(s3Content), etag: s3Etag }] } as never;
    if (request.operation === 's3Read') return { key: request.key, size: Buffer.byteLength(s3Content), contentType: 'text/plain', base64: Buffer.from(s3Content).toString('base64'), etag: s3Etag, versionId: 'version-1' } as never;
    throw Error(`Unexpected operation ${request.operation}`);
  };
  const context = () => new PiWorkspaceContext(send, send, async () => selected);
  return { context, send, calls, workspace, ids, s3, sourceFiles, docEntries, blobs, select(value?: typeof workspace) { selected = value; }, advance() { head = 'b'.repeat(40); }, corrupt() { corrupt = true; }, changeS3() { s3Content = 'Changed object'; s3Etag = 'etag-2'; } };
}

test('discovers only manifest members, pins branches once across calls, reads blobs lazily, and refreshes only for a new invocation', async () => {
  const f = fixture(), context = f.context();
  const discovered = await context.discover({});
  expect(discovered.sources.map(source => source.id)).toEqual(['documents', 'github:app', 'github:library']);
  expect(discovered.sources[1]).toMatchObject({ repository: 'owner/app', commit: 'a'.repeat(40), observedCommit: '1'.repeat(40) });
  expect(f.calls.some(call => call.operation === 'agentBlob' || call.operation === 'agentTree')).toBe(false);
  expect(f.calls.filter(call => call.operation === 'agentGraphql')).toHaveLength(2);
  f.advance();
  const first = await context.files({ operation: 'read', source: 'github:app', path: 'README.md', startLine: 2, lineCount: 1 });
  expect(first).toMatchObject({ content: 'Needle line', commit: 'a'.repeat(40), startLine: 2, nextLine: 3 });
  expect(await context.files({ operation: 'read', source: 'github:app', path: 'README.md' })).toMatchObject({ content: expect.stringContaining('Original pinned source') });
  expect(f.calls.filter(call => call.operation === 'agentBlob')).toHaveLength(1);
  expect(await f.context().files({ operation: 'read', source: 'github:app', path: 'README.md' })).toMatchObject({ commit: 'b'.repeat(40), content: 'New branch content' });
  await expect(context.files({ operation: 'read', source: 'owner/unrelated', path: 'README.md' })).rejects.toThrow('not available');
});

test('document search/read carries exact workspace snapshot and blob provenance', async () => {
  const f = fixture(), context = f.context();
  const result = await context.files({ operation: 'read', source: 'documents', path: 'guide.md' });
  expect(result).toMatchObject({ repository: 'owner/storage', workspace: 'workspace', snapshot: '3'.repeat(40), version: gitObject('blob', 'Workspace document\nNeedle document') });
  expect(await context.files({ operation: 'search', source: 'documents', query: 'needle' })).toMatchObject({ matches: [expect.objectContaining({ path: 'guide.md', line: 2 })], coverage: { complete: true } });
});

test('rejects unsafe paths, symlinks, malformed hashes, binary files and unselected/moved workspace', async () => {
  const f = fixture(), context = f.context();
  for (const path of ['../secret', '/secret', 'x/../y', '.git/config', 'x\\y']) expect(workspaceFilesSchema.safeParse({ operation: 'read', source: 'documents', path }).success).toBe(false);
  await expect(context.files({ operation: 'read', source: 'github:app', path: 'link' })).rejects.toThrow('regular');
  await expect(context.files({ operation: 'read', source: 'github:app', path: 'binary.bin' })).rejects.toThrow('Binary');
  f.corrupt(); await expect(context.files({ operation: 'read', source: 'github:library', path: 'README.md' })).rejects.toThrow(/mismatch|integrity/);
  f.select({ ...f.workspace, workspace: 'other' });
  await expect(context.files({ operation: 'list', source: 'documents' })).rejects.toThrow('current conversation');
  f.select(); await expect(f.context().discover({})).rejects.toThrow('current conversation');
});

test('search reports omitted binary/oversized files and result/page limits instead of claiming exhaustive absence', async () => {
  const f = fixture(), context = f.context();
  const result = await context.files({ operation: 'search', source: 'github:app', query: 'needle' });
  expect(result).toMatchObject({ matches: [expect.objectContaining({ path: 'README.md', line: 2 })], coverage: { complete: false } });
  expect('skipped' in result && result.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'binary.bin' }), expect.objectContaining({ path: 'link' })]));
  const found = await context.files({ operation: 'find', source: 'github:app', query: '.', limit: 1 });
  expect(found).toMatchObject({ entries: [expect.objectContaining({ path: 'binary.bin' })], nextOffset: 1 });
});

test('S3 reads require published workspace bindings, preserve bytes/version provenance, and never expose arbitrary storage', async () => {
  const unbound = fixture();
  expect((await unbound.context().discover({})).sources.some(source => source.kind === 's3')).toBe(false);
  expect(unbound.calls.some(call => call.operation === 's3Connections')).toBe(false);
  const f = fixture({ s3: true }), context = f.context();
  expect((await context.discover({})).sources).toContainEqual(expect.objectContaining({ id: 's3:notes', prefix: 'workspace/notes/' }));
  const first = await context.files({ operation: 'read', source: 's3:notes', path: 'context.txt' });
  expect(first).toMatchObject({ content: 'Private workspace context 🌴', key: 'workspace/notes/context.txt', versionId: 'version-1', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  f.changeS3(); expect(await context.files({ operation: 'read', source: 's3:notes', path: 'context.txt' })).toEqual(first);
  expect(f.calls.filter(call => call.operation === 's3Read')).toHaveLength(1);
  await expect(context.files({ operation: 'read', source: 's3:notes', path: 'other.txt' })).rejects.toThrow('not found');
});

test('S3 detects listing/read races and scope escapes, and respects connection read/prefix grants', async () => {
  const f = fixture({ s3: true }), context = f.context();
  await context.files({ operation: 'list', source: 's3:notes' }); f.changeS3();
  await expect(context.files({ operation: 'read', source: 's3:notes', path: 'context.txt' })).rejects.toThrow('changed since discovery');
  const denied = fixture({ s3: true }); denied.s3.allowRead = false;
  expect((await denied.context().discover({})).notices).toContainEqual(expect.objectContaining({ source: 's3:notes' }));
  const escaped = fixture({ s3: true });
  const send: PiBridge = async request => request.operation === 's3List' ? { objects: [{ key: 'workspace/other/secret', size: 10 }] } as never : escaped.send(request);
  const reader = new PiWorkspaceContext(send, send, async () => escaped.workspace);
  await expect(reader.files({ operation: 'list', source: 's3:notes' })).rejects.toThrow('escaped');
});

test('ambiguous connections require explicit selection and cannot be changed mid-invocation', async () => {
  const f = fixture({ connectionCopies: 2 });
  await expect(f.context().discover({})).rejects.toThrow('one approved connection');
  const context = f.context(); expect(await context.discover({ connectionId: f.ids[0] })).toMatchObject({ connectionId: f.ids[0] });
  await expect(context.discover({ connectionId: f.ids[1] })).rejects.toThrow('another workspace connection');
});

test('Stop or workspace changes during host reads cannot release context to the agent', async () => {
  for (const mode of ['stop', 'move']) {
    const f = fixture(), controller = new AbortController();
    const send: PiBridge = async request => {
      const value = await f.send(request);
      if (request.operation === 'agentBlob') { if (mode === 'stop') controller.abort(); else f.select({ ...f.workspace, workspace: 'other' }); }
      return value as never;
    };
    const context = new PiWorkspaceContext(send, send, async () => mode === 'move' ? { ...f.workspace, workspace: f.calls.some(call => call.operation === 'agentBlob') ? 'other' : 'workspace' } : f.workspace);
    await expect(context.files({ operation: 'read', source: 'github:app', path: 'README.md' }, controller.signal)).rejects.toThrow();
  }
});

test('cached Git and S3 content still require current host authorization on subsequent calls', async () => {
  const git = fixture(), context = git.context();
  await context.files({ operation: 'read', source: 'github:app', path: 'README.md' });
  git.ids[0] = crypto.randomUUID();
  await expect(context.files({ operation: 'read', source: 'github:app', path: 'README.md' })).rejects.toThrow('authorization changed');
  const s3 = fixture({ s3: true }), source = s3.context();
  await source.files({ operation: 'read', source: 's3:notes', path: 'context.txt' });
  s3.s3.allowRead = false;
  await expect(source.files({ operation: 'read', source: 's3:notes', path: 'context.txt' })).rejects.toThrow('authorization changed');
});

test('context host-request budget fails closed even when repeated reads are cached', async () => {
  const f = fixture(), context = f.context();
  let failure: unknown;
  for (let index = 0; index < 100; index++) {
    try { await context.files({ operation: 'read', source: 'github:app', path: 'README.md' }); }
    catch (error) { failure = error; break; }
  }
  expect(String(failure)).toContain('256 host requests');
  expect(f.calls.length).toBe(256);
  expect(f.calls.filter(call => call.operation === 'agentBlob')).toHaveLength(1);
});
