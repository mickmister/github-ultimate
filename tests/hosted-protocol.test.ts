import { expect, test } from 'vitest';
import { trustedOrigin, originPattern, pageMessageSchema } from '../src/hosted-protocol';

test('origin grants never silently become path-specific or accept non-HTTPS remote URLs', () => {
  expect(trustedOrigin('https://EXAMPLE.com:443/')).toBe('https://example.com');
  expect(trustedOrigin('http://localhost:5174')).toBe('http://localhost:5174');
  expect(originPattern('http://localhost:5174')).toBe('http://localhost/*');
  for (const value of ['https://example.com/branch/', 'https://example.com?path=a', 'https://user:pass@example.com', 'http://example.com', 'file:///tmp/a', 'null', 'https://example.com/#a']) expect(() => trustedOrigin(value)).toThrow();
});
test('bridge schema bounds operations and correlation identifiers', () => {
  const requestId = crypto.randomUUID();
  const message = { channel: 'github-ultimate-page-v1', version: 1, requestId, request: { operation: 'connections' } };
  expect(pageMessageSchema.safeParse(message).success).toBe(true);
  expect(pageMessageSchema.safeParse({ ...message, version: 2 }).success).toBe(false);
  expect(pageMessageSchema.safeParse({ ...message, origin: 'https://claimed.example' }).success).toBe(false);
  expect(pageMessageSchema.safeParse({ ...message, request: { operation: 'grantOrigin', id: requestId, origin: 'https://example.com' } }).success).toBe(false);
});
