import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { WorkspaceReader, type GitTransport } from '../hosted/workspaces';
import { ReviewReader } from '../hosted/reviews';
import { writeReview } from '../src/review-writes';
import { artifactResource, parseReviewRequest, reviewRequestSchema, validateReviewArtifact, type ReviewArtifact, type ReviewPin, type ReviewRequest } from '../src/review-protocol';
import { reviewStatus, restoreReviewComments, storeReviewComments } from '../webapp/src/features/reviews/model';
import { reviewBeadMetadata } from '../src/review-beads';

const scope = { id: 'a6075abf-226e-4c88-977c-e11404e59f32', installationId: 1, repository: 'owner/storage', workspace: 'workspace-a' };
const oid = (text: string) => createHash('sha1').update(text).digest('hex');
class GitFixture {
  blobs = new Map<string, string>();
  trees = new Map<string, any[]>();
  commits = new Map<string, string>();
  head = '';
  mutations: { path: string; method: string; body: any }[] = [];
  conflict = false;
  blob(text: string) { const sha = createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex'); this.blobs.set(sha, text); return sha; }
  snapshot(files: Record<string, string>) {
    const entries = Object.entries(files).map(([path, text]) => ({ path: `documents/${path}`, sha: this.blob(text), type: 'blob', mode: '100644', size: Buffer.byteLength(text) }));
    const tree = oid(JSON.stringify(entries)); this.trees.set(tree, entries);
    const commit = oid(tree + this.commits.size); this.commits.set(commit, tree); this.head = commit; return commit;
  }
  read = (async (input: any) => {
    if (input.operation === 'gitRefs') return input.prefix === 'documents/' ? [{ ref: `refs/documents/${scope.workspace}`, object: { type: 'commit', sha: this.head } }] : [];
    if (input.operation === 'gitCommit') return { sha: input.oid, tree: { sha: this.commits.get(input.oid) } };
    if (input.operation === 'gitTree') return { sha: input.oid, truncated: false, tree: this.trees.get(input.oid) };
    const text = this.blobs.get(input.oid)!;
    return { sha: input.oid, encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') };
  }) as GitTransport;
  mutate = async (path: string, method: 'POST' | 'PATCH', body: any) => {
    this.mutations.push({ path, method, body });
    if (path.endsWith('/blobs')) return { sha: this.blob(body.content) };
    if (path.endsWith('/trees')) {
      const entries = [...this.trees.get(body.base_tree)!.filter(entry => !body.tree.some((item: any) => item.path === entry.path)), ...body.tree.map((item: any) => ({ ...item, size: Buffer.byteLength(this.blobs.get(item.sha)!) }))];
      const sha = oid(JSON.stringify(entries)); this.trees.set(sha, entries); return { sha };
    }
    if (path.endsWith('/commits')) { const sha = oid(JSON.stringify(body)); this.commits.set(sha, body.tree); return { sha }; }
    if (this.conflict) throw new Error('HTTP 422: ref changed');
    this.head = body.sha; return { object: { sha: body.sha } };
  };
}
const manifest = JSON.stringify({ schema_version: 1, workspace: scope.workspace, observed_at: '2026-11-12T00:00:00Z', purpose: 'Review requests' });
const formText = JSON.stringify({ format: 'standard', id: 'reader_decisions', task_id: 'task-reader', title: 'Reader choices', questions: [{ id: 'choice', type: 'choices', title: 'Pick', required: true, choices: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }], choiceGroups: [{ id: 'exclusive', mode: 'atMostOne', choiceIds: ['one', 'two'] }] }] });
function fixture() {
  const git = new GitFixture();
  const memberSnapshot = git.snapshot({ 'workspace/manifest.json': manifest, 'threads/task-review/doc.md': '# Before', 'forms/reader.json': formText });
  const pin = (resource: string, text: string): ReviewPin => ({ resource, version_kind: 'git-blob', version: git.blob(text), snapshot: memberSnapshot });
  const request: ReviewRequest = reviewRequestSchema.parse({ kind: 'review-request', schema_version: 1, request_id: 'reader-01', revision_id: 'revision-1', workspace: scope.workspace, bead_id: 'task-review', thread: 'threads/task-review', title: 'Reader review', purpose: 'Review the reader', question: 'What next?', status: 'published', change_kind: 'implemented', members: [{ id: 'doc', kind: 'document', label: 'Plan', target: pin('threads/task-review/doc.md', '# Before') }, { id: 'form', kind: 'form', label: 'Reader decisions', bead_id: 'task-reader', form_id: 'reader_decisions', dsl: pin('forms/reader.json', formText) }] });
  const requestText = JSON.stringify(request);
  const snapshot = git.snapshot({ 'workspace/manifest.json': manifest, 'review-requests/reader-01/request.json': requestText });
  const requestVersion = git.blob(requestText);
  const value: ReviewArtifact = { kind: 'review-response', schema_version: 1, transport: 'workspace-resources', id: 'response-1', reviewer: 'github:1', request: { id: request.request_id, version: requestVersion, snapshot }, intent: 'feedback', forms: [{ member_id: 'form', bead_id: 'task-reader', form_id: 'reader_decisions', dsl: (request.members[1] as any).dsl, answers: { choice: { one: true } }, intent: 'discussion' }], comments: [], progress: ['doc'] };
  const input = () => ({ ...scope, operation: 'reviewWrite' as const, text: JSON.stringify(value), expected: null });
  return { git, request, value, input, snapshot, requestVersion };
}
test('request contracts reject mutable pins, duplicate members and unsafe resource paths', () => {
  const { request } = fixture();
  expect(parseReviewRequest(JSON.stringify(request))).toEqual(request);
  for (const resource of ['../secret', '/absolute', 'x//y', 'x/%2e%2e/y', 'x\\y', 'x/.git/y']) expect(() => reviewRequestSchema.parse({ ...request, members: [{ ...request.members[0], target: { ...(request.members[0] as any).target, resource } }] })).toThrow();
  expect(() => reviewRequestSchema.parse({ ...request, members: [request.members[0], request.members[0]] })).toThrow('Duplicate');
});
test('response writes verify pinned form identity, use create-only paths and return readback receipts', async () => {
  const { git, value, input } = fixture();
  const receipt = await writeReview(input(), 'github:1', git.read, git.mutate);
  expect(receipt.resource).toBe(artifactResource(value));
  expect(JSON.parse(git.blobs.get(receipt.version)!)).toEqual(value);
  expect(git.mutations.at(-1)?.body).toEqual({ sha: receipt.snapshot, force: false });
  const count = git.mutations.length;
  expect((await writeReview(input(), 'github:1', git.read, git.mutate)).version).toBe(receipt.version);
  expect(git.mutations).toHaveLength(count);
  value.forms[0].answers.choice = { two: true };
  await expect(writeReview(input(), 'github:1', git.read, git.mutate)).rejects.toThrow('conflict');
});
test('draft identity survives unrelated commits and stale saves cannot overwrite remote work', async () => {
  const { git, value, input } = fixture();
  const { intent: _intent, ...rest } = value as Extract<ReviewArtifact, { kind: 'review-response' }>;
  const draft: ReviewArtifact = { ...rest, kind: 'review-draft', id: 'draft-1' };
  const save = (expected: string | null) => writeReview({ ...input(), text: JSON.stringify(draft), expected }, 'github:1', git.read, git.mutate);
  const first = await save(null);
  draft.forms[0].answers.choice = { two: true };
  await expect(save(null)).rejects.toThrow('conflict');
  const second = await save(first.version);
  expect(second.resource).toBe(first.resource);
  expect(second.version).not.toBe(first.version);
  draft.progress = [];
  await expect(save(first.version)).rejects.toThrow('conflict');
});
test('reviewer spoofing, changed form pins and invalid exclusive answers fail before any write', async () => {
  const { git, value, input } = fixture();
  await expect(writeReview(input(), 'github:2', git.read, git.mutate)).rejects.toThrow('another authenticated');
  value.forms[0].dsl.version = 'c'.repeat(40);
  await expect(writeReview(input(), 'github:1', git.read, git.mutate)).rejects.toThrow('pinned form');
  expect(git.mutations).toHaveLength(0);
  const valid = fixture();
  valid.value.forms[0].answers.choice = { one: true, two: true };
  await expect(writeReview(valid.input(), 'github:1', valid.git.read, valid.git.mutate)).rejects.toThrow('at most one');
});
test('request amendments do not rebind old responses; failed ref updates issue no receipt', async () => {
  const { git, request, value, input, requestVersion } = fixture();
  const changed = { ...request, revision_id: 'revision-2', question: 'A new question' };
  git.snapshot({ 'workspace/manifest.json': manifest, 'review-requests/reader-01/request.json': JSON.stringify(changed) });
  const receipt = await writeReview(input(), 'github:1', git.read, git.mutate);
  expect(JSON.parse(git.blobs.get(receipt.version)!).request.version).toBe(requestVersion);
  expect(reviewStatus({ request: changed, pin: { resource: 'review-requests/reader-01/request.json', version_kind: 'git-blob', version: git.blob(JSON.stringify(changed)), snapshot: git.head } }, [{ value, pin: { ...receipt, version_kind: 'git-blob' } }])).toBe('Needs response');
  const other = fixture(); other.git.conflict = true;
  await expect(writeReview(other.input(), 'github:1', other.git.read, other.git.mutate)).rejects.toThrow('422');
});
test('missing historical bytes are unavailable, never replaced with a current document', async () => {
  const { git, request } = fixture();
  const reader = new ReviewReader(new WorkspaceReader(git.read, scope.id, scope.repository, 1, scope.workspace), scope.workspace);
  const pin = (request.members[0] as Extract<ReviewRequest['members'][number], { kind: 'document' }>).target;
  expect(await reader.read(pin)).toBe('# Before');
  await expect(reader.read({ ...pin, snapshot: git.head })).rejects.toThrow('unavailable');
});
test('withdrawal stops new saves against a previously published revision', async () => {
  const { git, request, input } = fixture();
  git.snapshot({ 'workspace/manifest.json': manifest, 'review-requests/reader-01/request.json': JSON.stringify({ ...request, status: 'withdrawn', revision_id: 'withdrawn-1' }) });
  await expect(writeReview(input(), 'github:1', git.read, git.mutate)).rejects.toThrow('withdrawn');
  expect(git.mutations).toHaveLength(0);
});
test('restored comments remain packet-scoped and discard ambient page URLs', () => {
  const { request, snapshot, requestVersion } = fixture();
  const opened = { request, pin: { resource: 'review-requests/reader-01/request.json', version_kind: 'git-blob' as const, version: requestVersion, snapshot } };
  const workspaceScope = { ...scope, connectionId: scope.id };
  const items = restoreReviewComments(workspaceScope, opened, [{ id: 'comment-1', member_id: 'doc', text: 'Comment', selection: { text: 'Before', representation: 'rendered-markdown' } }]);
  const stored = storeReviewComments(workspaceScope, opened, [{ ...items[0], context: { ...items[0].context, pageUrl: 'https://private.example/path' } }]);
  expect(JSON.stringify(stored)).not.toContain('private.example');
  const other = { ...opened, request: { ...request, request_id: 'reader-02' } };
  expect(() => storeReviewComments(workspaceScope, other, items)).toThrow('another review');
});
test('Bead mapping stores only response pointers and does not answer edited or unrelated forms', async () => {
  const { value } = fixture();
  const metadata = { beadForms: { forms: [{ ...JSON.parse(formText), html: '<form>rendered</form>', controls: [] }] } };
  const receipt = { uri: 'nugs://workspace/example/documents/response.json', version: 'a'.repeat(40), snapshot: 'b'.repeat(40) };
  const read = async () => formText;
  const patch = await reviewBeadMetadata('task-reader', metadata, value, receipt, read);
  expect(patch.beadFormsSummary.pendingFormIds).toEqual([]);
  expect(JSON.stringify(patch)).not.toContain('"answers"');
  expect(patch.reviewResponsePointers[0].forms[0].dsl.version).toBe(value.forms[0].dsl.version);
  metadata.beadForms.forms[0].title = 'Edited question';
  expect((await reviewBeadMetadata('task-reader', metadata, value, receipt, read)).beadFormsSummary.pendingFormIds).toEqual(['reader_decisions']);
  metadata.beadForms.forms[0].title = 'Reader choices';
  expect((await reviewBeadMetadata('another-bead', metadata, value, receipt, read)).beadFormsSummary.pendingFormIds).toEqual(['reader_decisions']);
});
