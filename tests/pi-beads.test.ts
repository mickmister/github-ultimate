import { expect, test, vi } from 'vitest';
import { PiBeads } from '../hosted/pi-beads';
import type { BeadsSession, openBeadsSample } from '../hosted/beads-sample';
import type { PiBridge } from '../hosted/pi-transport';
import { queryBeads } from '../src/beads-query';
import { beadContext, withBeadContext } from '../src/bead-context';

const workspace = { repository: 'owner/storage', workspace: 'first' };
const issues = [{ id: 'task-a', title: 'An epic', issue_type: 'epic', priority: 1, status: 'open', labels: ['ui'], description: 'Native detail' }, { id: 'task-b', title: 'Other work', issue_type: 'task', priority: 2, status: 'blocked', labels: [] }];
const send: PiBridge = async request => {
  if (request.operation === 'connections') return [{ id: 'connection', installation: { id: 1 } }] as never;
  if (request.operation === 'repositories') return [{ full_name: workspace.repository }] as never;
  throw Error('Unexpected operation');
};
function gate() { let release!: () => void; const promise = new Promise<void>(done => { release = done; }); return { promise, release }; }
function session(): BeadsSession {
  return { gitCommit: 'a'.repeat(40), doltCommit: 'commit', root: 'root', storageRoot: 'storage', fileCount: 1, encodedBytes: 1,
    state: async () => ({ sealed: true, putRejected: true, commitRejected: true, heapAllocBytes: 1, heapSysBytes: 1 }),
    query: async operation => ({ operation, request: {}, issues: operation === 'list' ? issues : operation === 'ready' ? [issues[0]] : [issues[1]], durationMs: 0 }), dispose: vi.fn() };
}
test('workspace navigation starts one load; all first Beads requests wait for it', async () => {
  const held = gate(), opened = session(), open = vi.fn<typeof openBeadsSample>(async () => { await held.promise; return opened; });
  const beads = new PiBeads(send, open), handle = beads.select(workspace)!;
  expect(handle.snapshot().phase).toBe('loading');
  expect(beads.select({ ...workspace })).toBe(handle);
  let answered = false;
  const query = beads.query(workspace, { operation: 'show', id: 'task-a' }).then(value => { answered = true; return value; });
  const other = handle.query({ operation: 'blocked' });
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  expect(answered).toBe(false);
  // Creating/using the owner requires no await of the held initialization.
  expect(beads.select(workspace)?.snapshot().phase).toBe('loading');
  held.release();
  expect((await query).issues).toEqual([issues[0]]);
  expect((await other).issues).toEqual([{ id: 'task-b', title: 'Other work', status: 'blocked', priority: 2, issue_type: 'task', labels: [] }]);
  expect(handle.snapshot().phase).toBe('ready'); expect(open).toHaveBeenCalledTimes(1);
});
test('cancelling a waiter does not abort shared initialization, and scope changes reject obsolete waiters', async () => {
  const held = gate(), old = session(), open = vi.fn<typeof openBeadsSample>(async () => { await held.promise; return old; });
  const beads = new PiBeads(send, open), handle = beads.select(workspace)!, controller = new AbortController();
  const cancelled = handle.query({ operation: 'list' }, controller.signal);
  controller.abort(Error('Stop only this request')); await expect(cancelled).rejects.toThrow('Stop only this request');
  const obsolete = handle.query({ operation: 'list' });
  beads.select({ ...workspace, workspace: 'second' });
  await expect(obsolete).rejects.toThrow();
  held.release();
  await expect(beads.query(workspace, { operation: 'list' })).rejects.toThrow('current conversation workspace');
  expect(old.dispose).toHaveBeenCalled();
});
test('refresh immediately cancels an obsolete waiter and publishes only the replacement snapshot', async () => {
  const held = gate(), old = session(), replacement = session();
  const open = vi.fn<typeof openBeadsSample>().mockImplementationOnce(async () => { await held.promise; return old; }).mockResolvedValue(replacement);
  const beads = new PiBeads(send, open), handle = beads.select(workspace)!;
  const obsolete = handle.query({ operation: 'list' });
  const rejected = expect(obsolete).rejects.toThrow();
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  await handle.query({ operation: 'refresh' });
  await rejected;
  held.release();
  await vi.waitFor(() => expect(old.dispose).toHaveBeenCalled());
  expect(replacement.dispose).not.toHaveBeenCalled();
  expect((await handle.query({ operation: 'show', id: 'task-a' })).issues).toEqual([issues[0]]);
});
test('load failures remain Beads-local and explicit refresh retries without silent reinitialization', async () => {
  const open = vi.fn<typeof openBeadsSample>().mockRejectedValueOnce(Error('Reader offline')).mockResolvedValue(session());
  const beads = new PiBeads(send, open), handle = beads.select(workspace)!;
  await expect(handle.query({ operation: 'list' })).rejects.toThrow('Reader offline');
  expect(handle.snapshot()).toMatchObject({ phase: 'error', error: 'Reader offline' });
  expect(beads.select(workspace)).toBe(handle); expect(open).toHaveBeenCalledTimes(1);
  await handle.query({ operation: 'refresh' }); expect(handle.snapshot().phase).toBe('ready'); expect(open).toHaveBeenCalledTimes(2);
});
test('querying supports epic type, native readiness rows, bounded pages and exact lookup', () => {
  expect(queryBeads(issues, { operation: 'list', type: 'epic' })).toMatchObject({ total: 1, complete: true });
  expect(queryBeads(issues, { operation: 'list', limit: 1 })).toMatchObject({ total: 2, nextOffset: 1, complete: false });
  expect(() => queryBeads(issues, { operation: 'show', id: 'missing' })).toThrow('not found');
});
test('context stores only scoped IDs/titles and lookup instruction, while preserving literal @ prompts', () => {
  const text = withBeadContext('@review compare these', workspace, [{ id: 'task-a', title: 'An epic' }, { id: 'task-a', title: 'An epic' }]);
  expect(beadContext(text)).toEqual({ text: '@review compare these', context: { ...workspace, beads: [{ id: 'task-a', title: 'An epic' }] } });
  expect(text).toContain('tools.beads_query'); expect(text).not.toContain('Native detail');
  expect(() => withBeadContext(' ', workspace, [{ id: 'task-a', title: 'An epic' }])).toThrow('Enter a message');
  expect(() => withBeadContext('Compare', workspace, Array.from({ length: 51 }, (_, id) => ({ id: `task-${id}`, title: 'Task' })))).toThrow('maximum 50');
  expect(beadContext('ordinary text <beads-context>not metadata')).toBeUndefined();
});
