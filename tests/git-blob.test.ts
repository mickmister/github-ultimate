import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { maxBlobBytes, verifiedGitBlobBytes } from '../src/git-blob';

test('verifies a maximum-size native blob without exhausting the regexp stack', () => {
  const bytes = Buffer.alloc(maxBlobBytes, 123);
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const blob = { sha, size: bytes.length, encoding: 'base64' as const, content: bytes.toString('base64') };
  expect(Buffer.compare(Buffer.from(verifiedGitBlobBytes(blob)), bytes)).toBe(0);
  expect(() => verifiedGitBlobBytes({ ...blob, sha: '0'.repeat(40) })).toThrow('integrity');
  expect(() => verifiedGitBlobBytes({ ...blob, content: blob.content.slice(0, -4) + '!AAA' })).toThrow('base64');
}, 30000);

test('rejects malformed Base64 padding and size while accepting GitHub line breaks', () => {
  const bytes = Buffer.from('a'), sha = createHash('sha1').update('blob 1\0').update(bytes).digest('hex');
  const blob = { sha, size: 1, encoding: 'base64' as const, content: 'YQ==\n' };
  expect(verifiedGitBlobBytes(blob)).toEqual(new Uint8Array(bytes));
  for (const content of ['Y===', '====', 'Y=Q=', 'YQ=', 'YQ==AAAA', 'YQ!!']) expect(() => verifiedGitBlobBytes({ ...blob, content })).toThrow('base64');
  expect(() => verifiedGitBlobBytes({ ...blob, size: 2 })).toThrow('size');
});
