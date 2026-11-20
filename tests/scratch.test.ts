import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Scratch, scratchTree, gitObject, gitTreeEntries, type ScratchEntry } from '../src/scratch';
import { agentSnapshot } from '../src/agent-snapshot';
import { scratchTools } from '../hosted/scratch-tools';

test('scratch Git objects match native Git, commits parent correctly and restoration detects corruption', () => {
  const scratch = new Scratch(); scratch.write('src/café.txt', 'Hello 🌴\n', 0);
  const first = scratch.commit('Initial import', 1, null, 0);
  const blob = execFileSync('git', ['hash-object', '--stdin'], { input: 'Hello 🌴\n', encoding: 'utf8' }).trim();
  expect(blob).toBe(gitObject('blob', 'Hello 🌴\n'));
  const nativeTree = execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'], { input: Buffer.concat([Buffer.from('100644 café.txt\0'), Buffer.from(blob, 'hex')]), encoding: 'utf8' }).trim();
  const root = execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'], { input: Buffer.concat([Buffer.from('40000 src\0'), Buffer.from(nativeTree, 'hex')]), encoding: 'utf8' }).trim();
  expect(first.tree).toBe(root);
  const state = scratch.snapshot();
  expect(execFileSync('git', ['hash-object', '-t', 'commit', '--stdin'], { input: state.commits[0].body, encoding: 'utf8' }).trim()).toBe(first.oid);
  scratch.write('src/café.txt', 'Changed\n', 2); expect(scratch.diff()[0].patch).toContain('-Hello 🌴');
  const second = scratch.commit('Update', 3, first.oid, 1000); expect(second.parent).toBe(first.oid);
  expect(new Scratch(scratch.snapshot()).snapshot()).toEqual(scratch.snapshot());
  state.commits[0].files[0].content = 'tampered'; expect(() => new Scratch(state)).toThrow('Invalid scratch');
  expect(scratchTree([])).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
});
test('paths, stale revisions, collisions and size limits leave existing files intact', () => {
  const scratch = new Scratch(); scratch.write('file.txt', 'Original', 0);
  for (const path of ['../outside', '/absolute', 'a/../b', '.git/config', 'a\\b', 'a\0b']) expect(() => scratch.write(path, 'bad', 1)).toThrow();
  expect(() => scratch.write('file.txt', 'stale', 0)).toThrow('changed');
  expect(() => scratch.write('file.txt/child', 'collision', 1)).toThrow('collision');
  expect(() => scratch.write('big', '🌴'.repeat(40_000), 1)).toThrow();
  expect(scratch.read('file.txt').content).toBe('Original'); expect(scratch.revision).toBe(1);
  const overlay = new Scratch(scratch.snapshot()); overlay.write('new', 'new', 1);
  scratch.write('file.txt', 'concurrent', 1); expect(() => scratch.applyOverlay(overlay, 1)).toThrow('changed');
});
test('tool execution validates actual script arguments, rejects ambient options and cancelled calls', async () => {
  const scratch = new Scratch(), tools = scratchTools(scratch), context = { signal: new AbortController().signal };
  const write = tools.find(t => t.name === 'write_file')!;
  expect(() => write.execute({ path: '../outside', content: 'bad', expectedRevision: 0 }, context)).toThrow();
  expect(() => write.execute({ path: 'file', content: 'bad', expectedRevision: 0, repository: 'other/repo' }, context)).toThrow();
  const controller = new AbortController(); controller.abort();
  expect(() => write.execute({ path: 'file', content: 'bad', expectedRevision: 0 }, { signal: controller.signal })).toThrow();
  expect(scratch.list()).toEqual([]);
});
test('pinned directory initialization fetches shallow metadata only and verifies tree identities', async () => {
  const blob = gitObject('blob', 'Pinned\n'), commit = 'a'.repeat(40);
  const entries: ScratchEntry[] = [{ name: 'readme.md', mode: '100644', type: 'blob', oid: blob, size: 7 }], child = gitTreeEntries(entries);
  const root: ScratchEntry[] = [{ name: 'docs', mode: '40000', type: 'tree', oid: child, size: 0 }], tree = gitTreeEntries(root);
  const request = { operation: 'agentSnapshot' as const, id: crypto.randomUUID(), userId: 1, installationId: 2, repository: 'owner/repo', commit, directory: 'docs' };
  const seen: string[] = [];
  const api = async (path: string) => { seen.push(path); if (path.includes('/commits/')) return { sha: commit, tree: { sha: tree } }; throw Error('No blob or recursive tree requests at initialization'); };
  const graphql = async (_query: string, variables: Record<string, unknown>) => ({ data: { repository: { object: { oid: variables.oid, entries: (variables.oid === tree ? root : entries).map(e => ({ ...e, mode: parseInt(e.mode, 8) })) } } } });
  const state = await agentSnapshot(request, api, graphql);
  expect(state.files).toEqual([]); expect(state.base?.tree).toBe(child); expect(state.origin).toEqual({ repository: 'owner/repo', commit, directory: 'docs' }); expect(state.commits[0].parent).toBeNull();
  expect(seen).toContain(`/repos/owner/repo/git/commits/${commit}`);
  await expect(agentSnapshot(request, api, async () => ({ data: { repository: { object: { oid: tree, entries: [] } } } }))).rejects.toThrow('integrity');
});

test('lazy read/edit/commit/restore preserves untouched objects and reports search coverage', async () => {
  const contents = 'Original\n', blob = gitObject('blob', contents), childEntries: ScratchEntry[] = [{ name: 'code.ts', mode: '100644', type: 'blob', oid: blob, size: contents.length }], child = gitTreeEntries(childEntries);
  const rootEntries: ScratchEntry[] = [{ name: 'src', mode: '40000', type: 'tree', oid: child, size: 0 }, { name: 'large.bin', mode: '100644', type: 'blob', oid: 'f'.repeat(40), size: 1024 * 1024 }], root = gitTreeEntries(rootEntries);
  const calls: string[] = [], loader = { tree: async (oid: string) => { calls.push(`tree:${oid}`); return childEntries; }, blob: async (oid: string) => { calls.push(`blob:${oid}`); return contents; } };
  const scratch = new Scratch({ version: 1, revision: 0, origin: { repository: 'owner/repo', commit: 'a'.repeat(40), directory: '' }, base: { tree: root, trees: { [root]: rootEntries } }, files: [], commits: [] }, loader);
  scratch.commit('Base', 0, null); expect(calls).toEqual([]);
  expect(scratch.list().map(f => f.path)).toEqual(['large.bin', 'src']);
  const context = { signal: new AbortController().signal }, tools = scratchTools(scratch), call = (name: string, args: unknown) => tools.find(t => t.name === name)!.execute(args, context);
  expect(await call('read_file', { path: 'src/code.ts' })).toMatchObject({ content: contents, revision: 1 });
  expect(calls).toEqual([`tree:${child}`, `blob:${blob}`]);
  await call('write_file', { path: 'src/code.ts', content: 'Changed\n', expectedRevision: 1 });
  const committed = scratch.commit('Change', 2, scratch.head);
  const changedChild = gitTreeEntries([{ ...childEntries[0], oid: gitObject('blob', 'Changed\n') }]);
  expect(committed.tree).toBe(gitTreeEntries(rootEntries.map(e => e.name === 'src' ? { ...e, oid: changedChild } : e)));
  expect(calls).toHaveLength(2);
  const restored = new Scratch(scratch.snapshot(), loader); expect(restored.read('src/code.ts').content).toBe('Changed\n');
  const search = await scratchTools(restored).find(t => t.name === 'search')!.execute({ path: '.', text: 'Changed' }, context);
  expect(search).toMatchObject({ complete: false, matches: [{ path: 'src/code.ts', line: 1, text: 'Changed' }], skipped: [{ path: 'large.bin' }] });
  expect(calls).toHaveLength(2);
  await restored.prepare('src/code.ts'); restored.remove('src/code.ts', restored.revision); expect(restored.changed()).toEqual([{ path: 'src/code.ts', status: 'deleted' }]);
  expect(await restored.inspectDiff()).toMatchObject({ complete: true, changes: [{ path: 'src/code.ts', patch: expect.stringContaining('-Changed') }] });
  expect(calls).toHaveLength(2);
});
