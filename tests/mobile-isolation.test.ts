import { afterEach, expect, it, vi } from 'vitest';
import { grantForEntry, MobileFixtureBroker } from '../src/mobile-protocol';

const document = { documentId: 'generation', documentURL: 'https://example.test/isolation/index.html', isMainFrame: true };
const raw = (id: string, delayMs: number, text = id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'fixture.delay', params: { text, delayMs } });
function setup() { const broker = new MobileFixtureBroker(); broker.activate(document); broker.approve(grantForEntry(document.documentURL)); return broker; }
afterEach(() => vi.useRealTimers());

it('returns delayed fixture replies out of order with their original request identities', async () => {
  vi.useFakeTimers(); const broker = setup(), order: string[] = [];
  const slow = broker.handleAsync(document, raw('slow', 300)).then(reply => { order.push('slow'); return reply; });
  const fast = broker.handleAsync(document, raw('fast', 20)).then(reply => { order.push('fast'); return reply; });
  await vi.advanceTimersByTimeAsync(20);
  expect(await fast).toMatchObject({ id: 'fast', result: { text: 'fast' } }); expect(order).toEqual(['fast']);
  await vi.advanceTimersByTimeAsync(280);
  expect(await slow).toMatchObject({ id: 'slow', result: { text: 'slow' } }); expect(order).toEqual(['fast', 'slow']);
});

it.each(['revoke', 'revoke-regrant', 'navigation', 'replacement'] as const)('denies an already pending fixture after %s', async change => {
  vi.useFakeTimers(); const broker = setup(), pending = broker.handleAsync(document, raw('pending', 100));
  if (change.startsWith('revoke')) { broker.approve(); if (change === 'revoke-regrant') broker.approve(grantForEntry(document.documentURL)); }
  else { broker.invalidate(); if (change === 'replacement') broker.activate({ ...document, documentId: 'new' }); }
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ id: 'pending', error: { code: -32001 } }); expect((await pending).result).toBeUndefined();
});

it('rejects frames, unapproved original paths, invalid delays and excessive parallel fixtures', async () => {
  vi.useFakeTimers(); const broker = setup();
  expect((await broker.handleAsync({ ...document, isMainFrame: false }, raw('frame', 0))).error).toBeDefined();
  const outside = { ...document, documentURL: 'https://example.test/outside.html' }; broker.activate(outside);
  expect((await broker.handleAsync(outside, raw('outside', 0))).error).toBeDefined(); broker.activate(document);
  for (const delay of [-1, 10001, 1.5]) expect((await broker.handleAsync(document, raw('invalid', delay))).error?.code).toBe(-32602);
  const pending = Array.from({ length: 8 }, (_, i) => broker.handleAsync(document, raw(`request${i}`, 100)));
  expect((await broker.handleAsync(document, raw('overflow', 100))).error?.code).toBe(-32001);
  await vi.advanceTimersByTimeAsync(100); expect((await Promise.all(pending)).every(reply => reply.result)).toBe(true);
});
