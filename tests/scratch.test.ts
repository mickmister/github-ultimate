import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Scratch, scratchTree, gitObject } from '../src/scratch';
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
test('pinned directory import verifies file bytes and records independent scratch ancestry', async () => {
  const blob = gitObject('blob', 'Pinned\n'), commit = 'a'.repeat(40), tree = 'b'.repeat(40);
  const request = { operation: 'agentSnapshot' as const, id: crypto.randomUUID(), userId: 1, installationId: 2, repository: 'owner/repo', commit, directory: 'docs' };
  const seen: string[] = [];
  const api = async (path: string) => { seen.push(path); if (path.includes('/commits/')) return { sha: commit, tree: { sha: tree } }; if (path.includes('/trees/')) return { sha: tree, truncated: false, tree: [{ path: 'docs', type: 'tree', mode: '040000', sha: 'c'.repeat(40) }, { path: 'docs/readme.md', type: 'blob', mode: '100644', sha: blob, size: 7 }] }; return { sha: blob, encoding: 'base64', size: 7, content: Buffer.from('Pinned\n').toString('base64') }; };
  const state = await agentSnapshot(request, api);
  expect(state.files).toEqual([{ path: 'readme.md', mode: '100644', content: 'Pinned\n' }]); expect(state.origin).toEqual({ repository: 'owner/repo', commit, directory: 'docs' }); expect(state.commits[0].parent).toBeNull();
  expect(seen).toContain(`/repos/owner/repo/git/commits/${commit}`);
  await expect(agentSnapshot(request, async path => path.includes('/blobs/') ? { sha: blob, encoding: 'base64', size: 7, content: Buffer.from('Forged\n').toString('base64') } : api(path))).rejects.toThrow('integrity');
});
