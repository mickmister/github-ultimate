import { expect, test, vi } from 'vitest';
import { BoundedReads, mapReads } from '../src/bounded-reads';

function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

test('host reads obey count, aggregate response-byte budget, FIFO and queue bound', async () => {
  const pool = new BoundedReads(3, 128, 2), started: number[] = [], gates = Array.from({ length: 4 }, gate);
  const run = (index: number, bytes: number) => pool.run(bytes, async () => { started.push(index); await gates[index].promise; return index; });
  const first = run(0, 96), second = run(1, 24), third = run(2, 24), fourth = run(3, 1);
  await expect(pool.run(1, async () => 4)).rejects.toThrow('bound');
  await vi.waitFor(() => expect(started).toEqual([0, 1]));
  gates[1].release(); await second;
  await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
  gates.forEach(value => value.release());
  expect(await Promise.all([first, third, fourth])).toEqual([0, 2, 3]);
  for (const bytes of [NaN, Infinity, -1, 0, 129]) await expect(pool.run(bytes, async () => 0)).rejects.toThrow('bound');
});

test('failed host work releases its count and byte reservation', async () => {
  const pool = new BoundedReads(1, 10), blocked = gate();
  const first = pool.run(10, async () => { await blocked.promise; throw new Error('read failed'); });
  const failed = expect(first).rejects.toThrow('read failed');
  const second = pool.run(10, async () => 'next');
  blocked.release(); await failed; expect(await second).toBe('next');
});

test('file map overlaps three reads, preserves input order and respects the count cap', async () => {
  const controller = new AbortController(), gates = Array.from({ length: 5 }, gate), started: number[] = [];
  const result = mapReads([0, 1, 2, 3, 4], 3, controller.signal, async index => { started.push(index); await gates[index].promise; return index * 2; });
  expect(started).toEqual([0, 1, 2]);
  gates[2].release(); await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
  gates[1].release(); await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3, 4]));
  gates.forEach(value => value.release());
  expect(await result).toEqual([0, 2, 4, 6, 8]);
});

test.each(['cancel', 'error'])('file map stops scheduling on %s and drains active work before rejecting', async mode => {
  const controller = new AbortController(), gates = Array.from({ length: 3 }, gate), started: number[] = [];
  const result = mapReads([0, 1, 2, 3, 4], 3, controller.signal, async index => { started.push(index); await gates[index].promise; if (index === 0 && mode === 'error') throw new Error('broken file'); return index; });
  let settled = false;
  const checked = expect(result.finally(() => { settled = true; })).rejects.toThrow(mode === 'cancel' ? 'aborted' : 'broken file');
  if (mode === 'cancel') controller.abort();
  gates[0].release(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(started).toEqual([0, 1, 2]); expect(settled).toBe(false);
  gates[1].release(); gates[2].release(); await checked;
});
