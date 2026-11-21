import { expect, test } from 'vitest';
import { ApiReadCache, responseCooldown } from '../src/github-rate-limit';

test('HTTP-date Retry-After and combined reset use the latest deadline', async () => {
  const now = Date.parse('2026-11-09T00:00:00Z');
  const response = new Response(null, { status: 429, headers: { 'retry-after': new Date(now + 120000).toUTCString(), 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((now + 300000) / 1000) } });
  expect(await responseCooldown(response, now, 0)).toEqual({ until: now + 301000, failures: 1, scope: 'global' });
  expect(await responseCooldown(Response.json({ message: 'Resource not accessible' }, { status: 403 }), now, 0)).toBeUndefined();
});

test('read cache evicts bounded entries and isolates connections', () => {
  const cache = new ApiReadCache();
  cache.put('one:1:object', { secret: 'private' }); cache.put('two:1:object', { other: true });
  cache.clearConnection('one'); expect(cache.get('one:1:object')).toBeUndefined();
  expect(cache.get('two:1:object')!.value).toEqual({ other: true });
  for (let i = 0; i < 257; i++) cache.put(`one:1:${i}`, { i });
  expect(cache.get('one:1:0')).toBeUndefined(); expect(cache.get('one:1:256')).toBeDefined();
});
