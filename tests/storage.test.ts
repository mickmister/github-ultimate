import { afterEach, expect, test, vi } from 'vitest';
import { read, write } from '../src/storage';

afterEach(() => vi.unstubAllGlobals());

test('Safari browser storage wins over chrome and draft snapshots publish in order', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const stored: Record<string, unknown> = {};
  const set = vi.fn(async (data: Record<string, unknown>) => {
    if (set.mock.calls.length === 1) await blocked;
    Object.assign(stored, data);
  });
  vi.stubGlobal('browser', { storage: { local: { set, get: async () => stored } } });
  const chromeSet = vi.fn();
  vi.stubGlobal('chrome', { storage: { local: { set: chromeSet } } });
  const values = { instructions: 'First edit' };
  const first = write('draft', values);
  values.instructions = 'Final edit';
  const second = write('draft', values);
  await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
  expect(set.mock.calls[0][0]).toEqual({ draft: { instructions: 'First edit' } });
  release(); await Promise.all([first, second]);
  expect(await read('draft', null)).toEqual({ instructions: 'Final edit' });
  expect(chromeSet).not.toHaveBeenCalled();
});

test('a failed storage write does not prevent subsequent saves', async () => {
  const set = vi.fn().mockRejectedValueOnce(new Error('Suspended')).mockResolvedValueOnce(undefined);
  vi.stubGlobal('browser', { storage: { local: { set } } });
  await expect(write('draft', 'first')).rejects.toThrow('Suspended');
  await expect(write('draft', 'retry')).resolves.toBeUndefined();
  expect(set).toHaveBeenLastCalledWith({ draft: 'retry' });
});
