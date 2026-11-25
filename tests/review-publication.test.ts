import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { createReviewFixture, reviewScope } from '../webapp/stories/reviews.fixtures';

test('CLI publication dates new requests and preserves dated and undated amendments', async () => {
  const root = mkdtempSync(join(tmpdir(), 'review-publication-'));
  try {
    const store = join(root, 'store.json'), file = join(root, 'request.json'), bin = join(root, 'nugs');
    // A document-store transport double; exercise the shipping CLI's validation,
    // expected-version guard, publication and exact readback without a remote write.
    writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), path = process.env.PUBLICATION_STORE;
const db = JSON.parse(fs.readFileSync(path, 'utf8'));
const name = args[args.indexOf('--name') + 1];
let result;
if (args[1] === 'list') result = { resources: Object.values(db).map(({ text, ...resource }) => resource) };
else if (args[1] === 'read') result = { document: db[name] };
else if (args[1] === 'upsert') {
  const expected = args.includes('--expected') ? args[args.indexOf('--expected') + 1] : undefined;
  if (db[name]?.version !== expected) throw new Error('Version conflict');
  const text = fs.readFileSync(0, 'utf8');
  const version = require('node:crypto').createHash('sha1').update(text).digest('hex');
  db[name] = { name, version, commit: 'b'.repeat(40), uri: 'nugs://fixture/' + name, text };
  fs.writeFileSync(path, JSON.stringify(db)); result = { receipt: db[name] };
} else throw new Error('Unexpected action');
process.stdout.write(JSON.stringify(result));
`, { mode: 0o755 });
    const fixture = createReviewFixture(), request = (await fixture.modules.reviews!.list(reviewScope)).requests[0].request;
    const name = `review-requests/${request.request_id}/request.json`;
    const document = { ...request.members.find(member => member.kind === 'document')!, baseline: undefined };
    const base = { [document.target.resource]: { name: document.target.resource, version: document.target.version, commit: document.target.snapshot, text: '# Pinned document' } };
    const input = { ...request, members: [document], revision_id: 'new-revision' };
    const publish = (expected?: string) => {
      writeFileSync(file, JSON.stringify(input));
      return JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', resolve('cli/review.ts'), 'publish', '--workspace', request.workspace, '--file', file, '--repository', 'owner/storage', '--app-url', 'https://example.com/app/', '--vk-origin', 'none', ...(expected ? ['--expected', expected] : [])], {
        encoding: 'utf8', env: { ...process.env, NUGS_BIN: bin, PUBLICATION_STORE: store },
      }));
    };
    const saved = () => JSON.parse(JSON.parse(readFileSync(store, 'utf8'))[name].text);
    writeFileSync(store, JSON.stringify(base));
    const before = Date.now(), first = publish(), created = saved().created_at;
    expect(Date.parse(created)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(created)).toBeLessThanOrEqual(Date.now());
    input.revision_id = 'amended-revision';
    input.created_at = '2000-01-01T00:00:00Z';
    publish(first.receipt.version);
    expect(saved().created_at).toBe(created);
    writeFileSync(store, JSON.stringify({ ...base, [name]: { name, version: 'a'.repeat(40), commit: 'b'.repeat(40), text: JSON.stringify(request) } }));
    publish('a'.repeat(40));
    expect(saved()).not.toHaveProperty('created_at');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
