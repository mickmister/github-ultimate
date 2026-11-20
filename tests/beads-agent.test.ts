import { test, expect, vi } from 'vitest';
import { beadsAgent } from '../hosted/beads-agent';
import type { BeadsSession, BeadsOperation } from '../hosted/beads-sample';
import type { PiBridge } from '../hosted/pi-transport';

test('Beads tool uses selected workspace snapshot, TS filters and native dependency results; refresh is explicit', async () => {
  let generation = 0;
  const queries: string[] = [], disposed = vi.fn();
  const open = vi.fn(async (scope: unknown) => {
    expect(scope).toMatchObject({ repository: 'owner/storage', workspace: 'selected', connectionId: 'connection' }); generation++;
    return { gitCommit: `git-${generation}`, doltCommit: `dolt-${generation}`, root: 'root', storageRoot: 'storage', fileCount: 1, encodedBytes: 1, state: async () => ({ putRejected: true, commitRejected: true, sealed: true, heapAllocBytes: 0, heapSysBytes: 0 }), dispose: disposed, query: async (operation: BeadsOperation) => { queries.push(operation); return { operation, request: {}, durationMs: 0, issues: operation === 'ready' ? [{ id: 'task-ready', title: 'Open but ready', status: 'open', priority: 1 }] : operation === 'blocked' ? [{ id: 'task-blocked', status: 'open' }] : [{ id: 'task-blocked', title: 'Search me', status: 'open', priority: 2, labels: ['browser'] }, { id: 'task-ready', title: 'Open but ready', status: 'open', priority: 1 }] }; } } satisfies BeadsSession;
  });
  const send: PiBridge = async <T>() => [{ full_name: 'owner/storage' }] as T;
  const api = beadsAgent({ repository: 'owner/storage', workspace: 'selected', connectionId: 'connection', installationId: 1 }, 2, send, open);
  const query = async (args: unknown) => { const result = await api.tool.execute('test', args, new AbortController().signal); return JSON.parse((result.content[0] as { text: string }).text); };
  expect(await query({ operation: 'list', query: 'Search', label: 'browser' })).toMatchObject({ workspace: 'selected', doltCommit: 'dolt-1', total: 1, issues: [{ id: 'task-blocked' }] });
  expect(await query({ operation: 'show', id: 'task-ready' })).toMatchObject({ doltCommit: 'dolt-1', issues: [{ id: 'task-ready' }] });
  expect(await query({ operation: 'ready' })).toMatchObject({ issues: [{ id: 'task-ready' }] });
  expect(await query({ operation: 'blocked' })).toMatchObject({ issues: [{ id: 'task-blocked' }] });
  expect(queries).toEqual(['list', 'ready', 'blocked']); expect(open).toHaveBeenCalledTimes(1);
  await expect(query({ operation: 'close', id: 'task-ready' })).rejects.toThrow();
  await expect(query({ operation: 'show', id: 'missing' })).rejects.toThrow('not found');
  expect(await query({ operation: 'refresh' })).toMatchObject({ refreshed: true, doltCommit: 'dolt-2' });
  expect(disposed).toHaveBeenCalledTimes(1); api.dispose(); expect(disposed).toHaveBeenCalledTimes(2);
});
