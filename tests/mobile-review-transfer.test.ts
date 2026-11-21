import { afterEach, expect, test, vi } from 'vitest';
import { MobileReviewTransfers } from '../src/mobile-review-transfer';
import { mobileGitHubRequest } from '../src/mobile-github-client';
import { maxMobileReviewBytes, mobileReviewTransferTTL } from '../src/mobile-transfer-protocol';
import { utf8Bytes, utf8Text } from '../src/utf8';

const id = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const third = '33333333-3333-4333-8333-333333333333';
const metadata = { operation: 'reviewWrite' as const, id, installationId: 1, repository: 'owner/storage', workspace: 'workspace', expected: null };
afterEach(() => vi.useRealTimers());

test('transfer assembly enforces strict review metadata, scope, order, bytes, capacity, cancellation and expiry', async () => {
  vi.useFakeTimers();
  const transfers = new MobileReviewTransfers(), save = vi.fn(async () => 'saved');
  const call = (input: unknown, source = 'https://review.test/app/') => transfers.handle(source, input, () => true, save);
  const begin = (transferId = id, bytes = 4) => ({ phase: 'begin', transferId, bytes, request: metadata });
  try {
    await expect(call({ ...begin(), request: { ...metadata, operation: 'disconnect' } })).rejects.toThrow();
    await expect(call({ ...begin(), bytes: maxMobileReviewBytes + 1 })).rejects.toThrow();
    await call(begin()); await call(begin(second));
    await expect(call(begin(third))).rejects.toThrow('Too many');
    await expect(call(begin())).rejects.toThrow('already exists');
    await expect(call({ phase: 'commit', transferId: id }, 'https://other.test/')).rejects.toThrow('changed');
    await expect(call({ phase: 'chunk', transferId: id, index: 1, text: 'abcd' })).rejects.toThrow('order');
    await expect(call({ phase: 'commit', transferId: id })).rejects.toThrow('expired');
    await call(begin());
    await expect(call({ phase: 'chunk', transferId: id, index: 0, text: '🧪x' })).rejects.toThrow('byte limit');
    await call(begin());
    await call({ phase: 'chunk', transferId: id, index: 0, text: '🧪' });
    await expect(call({ phase: 'commit', transferId: id })).resolves.toBe('saved');
    expect(save).toHaveBeenCalledWith({ ...metadata, text: '🧪' }, expect.any(Function));
    await call(begin());
    await expect(call({ phase: 'commit', transferId: id })).rejects.toThrow('incomplete');
    await call(begin()); await call({ phase: 'cancel', transferId: id });
    await expect(call({ phase: 'commit', transferId: id })).rejects.toThrow('expired');
    await vi.advanceTimersByTimeAsync(mobileReviewTransferTTL);
    await expect(call({ phase: 'commit', transferId: second })).rejects.toThrow('expired');
    expect(save).toHaveBeenCalledTimes(1);
  } finally { transfers.clear(); }
});

test('client cancels partial large transfers after authority changes; a new epoch cannot revive the upload', async () => {
  const transfers = new MobileReviewTransfers(), save = vi.fn();
  let epoch = 0, count = 0, transferId: unknown;
  const phases: unknown[] = [];
  const client = { request: async (_method: string, params: Record<string, unknown>) => {
    phases.push(params.phase);
    if (params.phase === 'begin') transferId = params.transferId;
    if (params.phase === 'chunk' && ++count === 2) epoch++;
    return transfers.handle('https://review.test/app/', params, () => epoch === 0, save);
  } };
  try {
    await expect(mobileGitHubRequest(client, { ...metadata, text: 'x'.repeat(20000) }, 30000)).rejects.toThrow('changed');
    // A new request cannot commit the original document's stale partial upload.
    await expect(transfers.handle('https://review.test/app/', { phase: 'commit', transferId }, () => true, save)).rejects.toThrow('expired');
    expect(phases.at(-1)).toBe('cancel');
    expect(save).not.toHaveBeenCalled();
  } finally { transfers.clear(); }
});

test('client safely segments worst-case JSON escaping and surrogate boundaries at the full artifact byte limit', async () => {
  const transfers = new MobileReviewTransfers();
  const text = '\u0001'.repeat(2047) + '🧪' + 'x'.repeat(maxMobileReviewBytes - 2051);
  const save = vi.fn(async (request: any) => request.text);
  const client = { request: async (method: string, params: Record<string, unknown>) => {
    expect(utf8Bytes(JSON.stringify({ jsonrpc: '2.0', id: 'rpc_1', method, params }))).toBeLessThanOrEqual(16384);
    return transfers.handle('https://review.test/app/', params, () => true, save);
  } };
  try {
    expect(utf8Bytes(text)).toBe(maxMobileReviewBytes);
    await expect(mobileGitHubRequest(client, { ...metadata, text }, 30000)).resolves.toBe(text);
  } finally { transfers.clear(); }
});

test('portable UTF-8 decoding rejects invalid, truncated and surrogate encodings', () => {
  vi.stubGlobal('TextDecoder', undefined);
  try {
    expect(utf8Text(Uint8Array.from([0xf0, 0x9f, 0xa7, 0xaa]))).toBe('🧪');
    for (const bytes of [[0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x9f], [0x80]]) expect(() => utf8Text(Uint8Array.from(bytes))).toThrow('Invalid UTF-8');
  } finally { vi.unstubAllGlobals(); }
});
