import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { WorkspaceReader, type GitTransport } from '../hosted/workspaces';
import { ReviewReader } from '../hosted/reviews';
import { writeReview } from '../src/review-writes';
import { artifactResource, parseReviewRequest, reviewRequestSchema, validateReviewArtifact, type ReviewArtifact, type ReviewPin, type ReviewRequest } from '../src/review-protocol';
import { reviewStatus, restoreReviewComments, storeReviewComments } from '../webapp/src/features/reviews/model';
import { reviewBeadMetadata } from '../src/review-beads';
import { Connections, type ConnectionRecord } from '../src/connections';
import { processMetadata } from '../hosted/review-process';
import { createHostedReviews, isLegacyProcessSchemaError } from '../webapp/src/app-hooks/reviews';
import { bridgeRequest } from '../hosted/client';
import { MobileGitHub } from '../src/mobile-github';
import { MobileFixtureBroker } from '../src/mobile-protocol';
import { mobileGitHubRequest } from '../src/mobile-github-client';

vi.mock('../hosted/client', () => ({ bridgeRequest: vi.fn(async (request: any) => request.operation === 'discover' ? { capabilities: [] } : [{ id: 'a6075abf-226e-4c88-977c-e11404e59f32', installation: { id: 1 }, user: { id: 1 } }]) }));

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
test('exact review open reads its historical pin without discovering refs or fetching unrelated requests', async () => {
  const { git, request, snapshot, requestVersion } = fixture();
  git.snapshot({ 'workspace/manifest.json': manifest, 'review-requests/unrelated/request.json': 'unrelated-invalid-manifest' });
  const calls: any[] = [];
  const service = createHostedReviews((async (input: any) => { calls.push(input); return git.read(input); }) as GitTransport);
  const pin: ReviewPin = { resource: 'review-requests/reader-01/request.json', version_kind: 'git-blob', version: requestVersion, snapshot };
  expect(await service.open({ connectionId: scope.id, ...scope }, pin)).toEqual({ request, pin });
  expect(calls.some(input => input.operation === 'gitRefs')).toBe(false);
  expect(calls.filter(input => input.operation === 'gitCommit').map(input => input.oid)).toEqual([snapshot]);
  const fetched = calls.filter(input => input.operation === 'gitBlob').map(input => git.blobs.get(input.oid));
  expect(fetched).toEqual([manifest, JSON.stringify(request)]);
});
test('targeted review loading skips unrelated packets and foreign drafts, bounds concurrency and reuses pinned snapshots', async () => {
  const { git, request, value } = fixture();
  const files: Record<string, string> = {
    'workspace/manifest.json': manifest,
    'review-requests/reader-01/request.json': JSON.stringify(request),
    'review-requests/unrelated/request.json': 'unrelated-invalid-manifest',
    [`review-requests/reader-01/drafts/2/${value.request.version}.json`]: 'foreign-private-draft',
  };
  for (let index = 0; index < 8; index++) {
    const response = { ...value, id: `response-${index}` };
    files[artifactResource(response)] = JSON.stringify(response);
  }
  git.snapshot(files);
  let active = 0, peak = 0;
  const calls: any[] = [];
  const service = createHostedReviews((async (input: any) => {
    calls.push(input); active++; peak = Math.max(peak, active);
    try { await new Promise(resolve => setTimeout(resolve, 2)); return await git.read(input); }
    finally { active--; }
  }) as GitTransport);
  const selected = { connectionId: scope.id, ...scope };
  const found = await service.list(selected, 'reader-01');
  expect(found.requests.map(item => item.request.request_id)).toEqual(['reader-01']);
  expect(found.artifacts).toHaveLength(8);
  expect(peak).toBe(4);
  const fetched = calls.filter(item => item.operation === 'gitBlob').map(item => git.blobs.get(item.oid));
  expect(fetched).not.toContain('foreign-private-draft');
  expect(fetched).not.toContain('unrelated-invalid-manifest');
  const pin = (request.members[0] as Extract<ReviewRequest['members'][number], { kind: 'document' }>).target;
  calls.length = 0;
  expect(await service.read(selected, pin)).toBe('# Before');
  expect(await service.read(selected, pin)).toBe('# Before');
  expect(calls.filter(item => item.operation === 'gitCommit')).toHaveLength(1);
  expect(calls.filter(item => item.operation === 'gitTree')).toHaveLength(1);
});
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
function processFixture() {
  const f = fixture();
  const configText = '---\npipeline: full\nroute: [goals, questions, research]\n---\n';
  const configSnapshot = f.git.snapshot({ 'workspace/manifest.json': manifest, 'threads/task-review/config.md': configText });
  f.request.process = { kind: 'qrspi', id: 'pilot', workspace_ref: 'nugs://workspace/workspace-a', thread_id: f.request.thread, config: { resource: 'threads/task-review/config.md', version_kind: 'git-blob', version: f.git.blob(configText), snapshot: configSnapshot } };
  const text = JSON.stringify(f.request);
  f.value.request.version = f.git.blob(text);
  f.value.request.snapshot = f.git.snapshot({ 'workspace/manifest.json': manifest, 'review-requests/reader-01/request.json': text });
  return f;
}

function mobileFixture() {
  const f = processFixture();
  const json = (value: unknown) => new Response(Buffer.from(JSON.stringify(value)), { headers: { 'Content-Type': 'application/json' } });
  let record: ConnectionRecord = { id: scope.id, name: 'Storage', appId: 7, clientId: 'client', user: { id: 1, login: 'reviewer' }, installation: { id: 1, account: 'owner' }, tokens: { accessToken: 'native-secret', expiresAt: Date.now() + 999999 }, hostedGrants: [{ origin: 'https://review.test', subpath: '/app/' }] };
  let responseVersion = '';
  let beforeMutation: (() => Promise<void>) | undefined;
  const dispatches: unknown[] = [], messages: string[] = [];
  const store = { all: async () => [structuredClone(record)], get: async () => structuredClone(record), put: async (value: ConnectionRecord) => { record = structuredClone(value); }, remove: async () => {} };
  const engine = new Connections(store, async (url, init = {}) => {
    const path = String(url).replace('https://api.github.com', '');
    if (path.includes('/user/installations?')) return json({ installations: [{ id: 1, app_id: 7, account: { login: 'owner' }, permissions: { contents: 'write', actions: 'write' } }] });
    if (path.includes('/user/installations/1/repositories?')) return json({ repositories: [{ full_name: scope.repository, private: true, default_branch: 'main' }, { full_name: 'owner/source', private: true, default_branch: 'main' }] });
    if (path.endsWith('/dispatches')) { dispatches.push(JSON.parse(String(init.body))); return new Response(null, { status: 204 }); }
    if (path.includes('/runs?')) return json({ workflow_runs: [{ id: 42, html_url: 'https://github.com/owner/source/actions/runs/42', event: 'workflow_dispatch', head_branch: 'main', actor: { id: 1 }, display_title: `Review · ${responseVersion}`, status: 'completed', conclusion: 'success' }] });
    if (init.method === 'POST' || init.method === 'PATCH') return json(await f.git.mutate(path, init.method, JSON.parse(String(init.body))));
    const route = path.split('/git/')[1];
    const operation = route.startsWith('matching-refs/') ? 'gitRefs' : route.startsWith('commits/') ? 'gitCommit' : route.startsWith('trees/') ? 'gitTree' : 'gitBlob';
    return json(await f.git.read({ operation, prefix: route.slice('matching-refs/'.length), oid: route.split('/')[1]?.split('?')[0] } as any));
  }, undefined, undefined, undefined, undefined, { repository: 'owner/source', workflow: 'review.yml', ref: 'main' });
  // Pause in the storage await inside api(), after its caller's authority check.
  const all = store.all;
  store.all = async () => { if (beforeMutation && f.git.mutations.length === 1) { const pause = beforeMutation; beforeMutation = undefined; await pause(); } return all(); };
  const host = new MobileGitHub(engine, () => true);
  const broker = new MobileFixtureBroker(undefined, host);
  const context = { documentId: 'review-document', documentURL: 'https://review.test/app/', isMainFrame: true };
  broker.activate(context);
  const client = { request: async (method: string, params: Record<string, unknown>) => {
    const raw = JSON.stringify({ jsonrpc: '2.0', id: 'review_rpc', method, params }); messages.push(raw);
    const reply = await broker.handleAsync(context, raw);
    if (reply.error) throw new Error(reply.error.message);
    return reply.result;
  } };
  return { ...f, host, broker, context, client, messages, dispatches, version: (value: string) => { responseVersion = value; }, pause: (value: () => Promise<void>) => { beforeMutation = value; } };
}

test('mobile bridge saves a large Unicode draft, submits an immutable response and reads exact workflow progress without browser crypto/codecs', async () => {
  const f = mobileFixture();
  // Initialize Node's lazy fetch implementation before removing browser codecs.
  new Response(Buffer.from('{}'));
  const uuid = crypto.randomUUID.bind(crypto);
  vi.stubGlobal('crypto', { randomUUID: uuid });
  vi.stubGlobal('TextEncoder', undefined); vi.stubGlobal('TextDecoder', undefined);
  try {
    f.value.comments = Array.from({ length: 5 }, (_, index) => ({ id: `large-${index}`, member_id: 'doc', kind: 'content-comment', text: '🧪\\"\n'.repeat(1500) }));
    const { intent: _, ...draft } = f.value;
    const saved: any = await mobileGitHubRequest(f.client, { ...f.input(), text: JSON.stringify({ ...draft, kind: 'review-draft', id: 'draft-mobile' }) }, 30000);
    expect(saved.resource).toContain('/drafts/1/');
    expect(JSON.parse(f.git.blobs.get(saved.version)!).comments).toEqual(f.value.comments);
    expect(f.dispatches).toHaveLength(0);
    const receipt: any = await mobileGitHubRequest(f.client, f.input(), 30000);
    expect(receipt.dispatch.state).toBe('dispatched');
    expect(JSON.parse(f.git.blobs.get(receipt.version)!)).toEqual(f.value);
    expect(f.messages.filter(raw => JSON.parse(raw).params.phase === 'chunk').length).toBeGreaterThan(20);
    expect(f.messages.every(raw => Buffer.byteLength(raw) <= 16 * 1024)).toBe(true);
    expect(f.messages.join('')).not.toContain('native-secret');
    f.version(receipt.version);
    await expect(mobileGitHubRequest(f.client, { ...scope, operation: 'reviewProgress', resource: receipt.resource, version: receipt.version }, 30000)).resolves.toMatchObject({ state: 'completed', run: { id: 42, conclusion: 'success' } });
    const count = f.git.mutations.length;
    await mobileGitHubRequest(f.client, f.input(), 30000);
    expect(f.git.mutations).toHaveLength(count);
  } finally { vi.unstubAllGlobals(); }
});

test.each(['navigation', 'revoke'])('mobile review stops subsequent Git mutations when %s happens during async write preparation', async change => {
  const f = mobileFixture();
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  f.pause(async () => { reached(); await resume; });
  const writing = mobileGitHubRequest(f.client, f.input(), 30000);
  await entered;
  const revoke = change === 'revoke' ? f.host.settings({ operation: 'revokeOrigin', id: scope.id, origin: 'https://review.test', subpath: '/app/' }) : undefined;
  if (change === 'navigation') { f.broker.invalidate(); f.broker.activate(f.context); }
  release();
  await expect(writing).rejects.toThrow('changed'); await revoke;
  expect(f.git.mutations).toHaveLength(1);
  expect(f.git.mutations[0].path).toMatch(/\/blobs$/);
  expect(f.dispatches).toHaveLength(0);
});

test('mixed-version broker rejects process early, translates only the old schema failure, and preserves legacy writes', async () => {
  const bridge = vi.mocked(bridgeRequest);
  const oldError = JSON.stringify([{ code: 'unrecognized_keys', keys: ['process'], path: [], message: 'Unrecognized key: "process"' }]);
  const f = processFixture();
  // Reproduce the older strict request parser, without relaxing the authoritative schema.
  const { z } = await import('zod');
  expect(() => z.object(Object.fromEntries(Object.keys(f.request).filter(key => key !== 'process').map(key => [key, z.unknown()]))).strict().parse(f.request)).toThrow('process');
  const writes: any[] = [];
  let capabilities = ['reviewWrite'];
  let failure = '';
  bridge.mockImplementation(async (input: any) => {
    if (input.operation === 'discover') return { capabilities } as any;
    if (input.operation === 'reviewWrite') {
      writes.push(input);
      if (failure) throw new Error(failure);
      const git = input.text.includes(f.value.request.version) ? f.git : legacy.git;
      return await writeReview(input, 'github:1', git.read, git.mutate) as any;
    }
    return [] as any;
  });
  const legacy = fixture();
  const selected = { connectionId: scope.id, ...scope };
  try {
    const service = createHostedReviews(f.git.read);
    await expect(service.save(selected, f.value, null)).rejects.toThrow('Update the browser extension or Alohak broker');
    expect(writes).toHaveLength(0);
    expect(f.git.mutations).toHaveLength(0);
    capabilities = ['reviewWrite', 'qrspiProcessReview'];
    failure = oldError;
    await expect(service.save(selected, f.value, null)).rejects.toThrow('reload this page');
    failure = 'arbitrary validation failure';
    await expect(service.save(selected, f.value, null)).rejects.toThrow(failure);
    failure = '';
    await expect(service.save(selected, f.value, null)).resolves.toHaveProperty('version');
    capabilities = ['reviewWrite'];
    await expect(createHostedReviews(legacy.git.read).save(selected, legacy.value, null)).resolves.toHaveProperty('version');
    expect(isLegacyProcessSchemaError(new Error(oldError))).toBe(true);
    for (const issues of [[{ code: 'unrecognized_keys', keys: ['process', 'other'], path: [] }], [{ code: 'unrecognized_keys', keys: ['process'], path: ['nested'] }], [{ code: 'invalid_type', keys: ['process'], path: [] }]]) expect(isLegacyProcessSchemaError(JSON.stringify(issues))).toBe(false);
  } finally {
    bridge.mockImplementation(async (input: any) => input.operation === 'discover' ? { capabilities: [] } as any : [{ id: scope.id, installation: { id: 1 }, user: { id: 1 } }] as any);
  }
});

test('process delivery runs only after immutable response readback and retries without writing answers', async () => {
  const { git, request, value, input } = processFixture();
  const deliver = vi.fn(async (receipt: any, bound: ReviewRequest) => {
    expect(bound.process).toEqual(request.process);
    expect(JSON.parse(git.blobs.get(receipt.version)!)).toEqual(value);
    expect(git.head).toBe(receipt.snapshot);
    throw new Error('Actions unavailable');
  });
  const first = await writeReview(input(), 'github:1', git.read, git.mutate, deliver);
  expect(first.dispatch).toMatchObject({ state: 'failed', message: 'Actions unavailable' });
  expect(first.version).toBeTruthy();
  const mutations = git.mutations.length;
  const retry = await writeReview(input(), 'github:1', git.read, git.mutate, deliver);
  expect(retry).toEqual(first);
  expect(git.mutations).toHaveLength(mutations);
  expect(deliver).toHaveBeenCalledTimes(2);
  const { intent: _, ...rest } = value as Extract<ReviewArtifact, { kind: 'review-response' }>;
  await writeReview({ ...input(), text: JSON.stringify({ ...rest, kind: 'review-draft', id: 'draft-process' }) }, 'github:1', git.read, git.mutate, deliver);
  expect(deliver).toHaveBeenCalledTimes(2);
});

test('process binding rejects unknown config pins, mismatched threads and feature continuation', async () => {
  const f = processFixture();
  expect(() => reviewRequestSchema.parse({ ...f.request, process: { ...f.request.process, thread_id: 'threads/task-other' } })).toThrow('Process thread');
  f.value.comments.push({ id: 'feature', member_id: 'doc', kind: 'feature-comment', text: 'Improve app' });
  const deliver = vi.fn();
  await expect(writeReview(f.input(), 'github:1', f.git.read, f.git.mutate, deliver)).rejects.toThrow('separate app intake');
  expect(deliver).not.toHaveBeenCalled();
  expect(f.git.mutations).toHaveLength(0);
  f.value.comments = [];
  f.request.process!.config.version = 'f'.repeat(40);
  const text = JSON.stringify(f.request);
  f.value.request.version = f.git.blob(text);
  f.value.request.snapshot = f.git.snapshot({ 'workspace/manifest.json': manifest, 'review-requests/reader-01/request.json': text });
  await expect(writeReview(f.input(), 'github:1', f.git.read, f.git.mutate, deliver)).rejects.toThrow('unavailable');
  expect(f.git.mutations).toHaveLength(0);
});

test.each(['allowed', 'missing-actions', 'missing-source', 'different-user', 'separate-app', 'network'])('authenticated broker dispatch route: %s', async mode => {
  const f = processFixture();
  const record: ConnectionRecord = { id: scope.id, name: 'Storage', appId: 7, clientId: 'client', user: { id: 1, login: 'reviewer' }, installation: { id: 1, account: 'owner' }, tokens: { accessToken: 'storage-token', expiresAt: Date.now() + 999999 }, hostedGrants: [{ origin: 'https://review.test', subpath: '/' }] };
  const source: ConnectionRecord = { ...structuredClone(record), id: 'a6075abf-226e-4c88-977c-e11404e59f33', appId: 8, tokens: { accessToken: 'source-token', expiresAt: Date.now() + 999999 }, user: { id: mode === 'different-user' ? 2 : 1, login: 'source' } };
  const records = new Map([[record.id, record], [source.id, source]]);
  const dispatches: any[] = [];
  let fail = true;
  const fetcher = vi.fn(async (url: any, init: RequestInit = {}) => {
    const path = String(url).replace('https://api.github.com', '');
    const isSource = (init.headers as any)?.Authorization === 'Bearer source-token';
    if (path.includes('/user/installations?')) return Response.json({ installations: [{ id: 1, app_id: isSource ? 8 : 7, account: { login: 'owner' }, permissions: { contents: 'write', actions: mode === 'missing-actions' ? 'read' : 'write' } }] });
    if (path.includes('/user/installations/1/repositories?')) return Response.json({ repositories: [{ full_name: scope.repository, private: true, default_branch: 'main' }, ...(mode === 'missing-source' || mode === 'separate-app' && !isSource ? [] : [{ full_name: 'mickmister/gh-agentic-workflows', private: false, default_branch: 'main' }])] });
    if (path.endsWith('/dispatches')) { dispatches.push({ body: JSON.parse(String(init.body)), token: (init.headers as any).Authorization }); if (mode === 'network' && fail) throw new TypeError('Network disconnected; dispatch outcome unknown'); return fail ? Response.json({ message: 'unavailable' }, { status: 503 }) : new Response(null, { status: 204 }); }
    const route = path.split('/git/')[1];
    if (init.method === 'POST' || init.method === 'PATCH') return Response.json(await f.git.mutate(path, init.method, JSON.parse(String(init.body))));
    const operation = route.startsWith('matching-refs/') ? 'gitRefs' : route.startsWith('commits/') ? 'gitCommit' : route.startsWith('trees/') ? 'gitTree' : 'gitBlob';
    return Response.json(await f.git.read({ operation, prefix: route.slice('matching-refs/'.length), oid: route.split('/')[1]?.split('?')[0] } as any));
  }) as typeof fetch;
  const store = { all: async () => structuredClone([...records.values()]), get: async (id: string) => structuredClone(records.get(id)), put: async (r: ConnectionRecord) => { records.set(r.id, structuredClone(r)); }, remove: async (id: string) => { records.delete(id); } };
  const broker = new Connections(store, fetcher, undefined, undefined, undefined, undefined, { repository: 'mickmister/gh-agentic-workflows', workflow: 'qrspi-process.yml', ref: 'vk/46e5-vd-multi-instanc', ...(mode === 'separate-app' || mode === 'different-user' ? { sourceConnectionId: source.id } : {}) });
  expect(await broker.handleHosted('https://review.test/', { operation: 'discover' })).toMatchObject({ capabilities: expect.arrayContaining(['reviewWrite', 'qrspiProcessReview']) });
  const first = await broker.handleHosted('https://review.test/', f.input()) as any;
  expect(first.dispatch.state).toBe(mode === 'network' ? 'unknown' : 'failed');
  const entries = f.git.trees.get(f.git.commits.get(f.git.head)!)!;
  f.git.snapshot({ ...Object.fromEntries(entries.map(entry => [entry.path.slice(10), f.git.blobs.get(entry.sha)!])), 'threads/task-review/unrelated.md': 'Unrelated publisher advanced Documents' });
  expect(f.git.head).not.toBe(first.snapshot);
  const count = f.git.mutations.length;
  fail = false;
  const second = await broker.handleHosted('https://review.test/', f.input()) as any;
  expect(f.git.mutations).toHaveLength(count);
  if (mode === 'allowed' || mode === 'separate-app' || mode === 'network') {
    expect(second.dispatch.state).toBe('dispatched');
    expect(second.snapshot).toBe(first.snapshot);
    expect(dispatches).toHaveLength(2);
    const exact = { resource: first.resource, version: first.version, snapshot: first.snapshot, reviewer: first.reviewer };
    expect(dispatches[1].body).toEqual({ ref: 'vk/46e5-vd-multi-instanc', inputs: { workspace: scope.workspace, process: 'pilot', bead: 'task-review', response: JSON.stringify(exact) } });
    expect(dispatches[1].token).toBe(mode === 'separate-app' ? 'Bearer source-token' : 'Bearer storage-token');
  } else { expect(dispatches).toHaveLength(0); expect(second.dispatch.message).toMatch(/source|reviewer/i); }
});

test.each(['storage', 'token'].flatMap(wait => ['navigation', 'revokeOrigin', 'disconnect', 'selectInstallation'].map(change => ({ wait, change }))))('dispatch rechecks authority after deferred $wait during $change', async ({ wait, change }) => {
  const f = processFixture();
  let now = Date.now(), current = true, installationsChecked = false, dispatchReady = false;
  let release!: () => void, reached!: () => void;
  const paused = new Promise<void>(resolve => { reached = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const record: ConnectionRecord = { id: scope.id, name: 'Storage', appId: 7, clientId: 'client', user: { id: 1, login: 'reviewer' }, installation: { id: 1, account: 'owner' }, tokens: { accessToken: 'token', expiresAt: now + 999999, refreshToken: 'refresh', refreshExpiresAt: now + 9999999 }, hostedGrants: [{ origin: 'https://review.test', subpath: '/' }] };
  let saved = structuredClone(record);
  const dispatches: unknown[] = [];
  const store = {
    all: async () => {
      if (dispatchReady && wait === 'storage') { dispatchReady = false; reached(); await resume; }
      return [structuredClone(saved)];
    },
    get: async () => structuredClone(saved),
    put: async (value: ConnectionRecord) => { saved = structuredClone(value); },
    remove: async () => {},
  };
  const fetcher = vi.fn(async (url: any, init: RequestInit = {}) => {
    const path = String(url).replace('https://api.github.com', '');
    if (String(url).endsWith('/login/oauth/access_token')) {
      expect(wait).toBe('token');
      expect(dispatchReady).toBe(true);
      dispatchReady = false; reached(); await resume;
      return Response.json({ access_token: 'rotated', token_type: 'bearer', expires_in: 3600, refresh_token: 'rotated-refresh', refresh_token_expires_in: 86400 });
    }
    if (path.includes('/user/installations?')) {
      installationsChecked = f.git.mutations.length > 0;
      return Response.json({ installations: [{ id: 1, app_id: 7, account: { login: 'owner' }, permissions: { contents: 'write', actions: 'write' } }] });
    }
    if (path.includes('/user/installations/1/repositories?')) {
      if (installationsChecked) {
        dispatchReady = true;
        if (wait === 'token') now += 1000000; // Expire only after source-route authorization.
      }
      return Response.json({ repositories: [{ full_name: scope.repository, private: true, default_branch: 'main' }, { full_name: 'mickmister/gh-agentic-workflows', private: false, default_branch: 'main' }] });
    }
    if (path.endsWith('/dispatches')) { dispatches.push(JSON.parse(String(init.body))); return new Response(null, { status: 204 }); }
    if (init.method === 'POST' || init.method === 'PATCH') return Response.json(await f.git.mutate(path, init.method, JSON.parse(String(init.body))));
    const route = path.split('/git/')[1];
    const operation = route.startsWith('matching-refs/') ? 'gitRefs' : route.startsWith('commits/') ? 'gitCommit' : route.startsWith('trees/') ? 'gitTree' : 'gitBlob';
    return Response.json(await f.git.read({ operation, prefix: route.slice('matching-refs/'.length), oid: route.split('/')[1]?.split('?')[0] } as any));
  }) as typeof fetch;
  const broker = new Connections(store, fetcher, () => now);
  const result = broker.handleHosted('https://review.test/', f.input(), () => current);
  const rejected = expect(result).rejects.toThrow('Document or connection access changed');
  await paused; // Both the dispatchReview guard and route authorization have passed.
  const pending = Object.values(saved.reviewDeliveries!)[0];
  expect(pending.dispatch?.state).toBe('pending');
  let changed: Promise<unknown> | undefined;
  if (change === 'navigation') current = false;
  else changed = broker.handle({ operation: change, id: scope.id, ...(change === 'revokeOrigin' ? { origin: 'https://review.test', subpath: '/' } : change === 'selectInstallation' ? { installationId: 1 } : {}) });
  release();
  await rejected;
  await changed;
  expect(dispatches).toHaveLength(0);
  const receipt = Object.values(saved.reviewDeliveries!)[0];
  expect(receipt).toMatchObject({ resource: pending.resource, version: pending.version, snapshot: pending.snapshot, reviewer: pending.reviewer, dispatch: { state: 'failed', message: expect.stringContaining('Response is saved') } });
  expect(JSON.parse(f.git.blobs.get(receipt.version)!)).toEqual(f.value);
  expect(f.git.trees.get(f.git.commits.get(receipt.snapshot)!)!).toContainEqual(expect.objectContaining({ path: `documents/${receipt.resource}`, sha: receipt.version }));
});

test('process presentation keeps missing metadata distinct from historical approval', () => {
  expect(processMetadata('---\nstatus: approved\n---\n')).toBe('status: approved');
  expect(processMetadata('# historical body')).toMatch(/missing.*unknown/);
  expect(processMetadata('---\npipeline: full\nroute: [goals, research]\nstatus: draft\n---\n')).toContain('route: goals → research');
});

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
test('reviewer spoofing and changed form pins fail before any write', async () => {
  const { git, value, input } = fixture();
  await expect(writeReview(input(), 'github:2', git.read, git.mutate)).rejects.toThrow('another authenticated');
  value.forms[0].dsl.version = 'c'.repeat(40);
  await expect(writeReview(input(), 'github:1', git.read, git.mutate)).rejects.toThrow('pinned form');
  expect(git.mutations).toHaveLength(0);
});
test('hosted responses and drafts preserve multiple checked choices despite exclusive group metadata', async () => {
  const { git, value, input } = fixture();
  value.forms[0].answers.choice = { one: true, two: true };
  value.forms[0].answers.choice_one_more_info = 'Existing per-choice notes remain valid.';
  const receipt = await writeReview(input(), 'github:1', git.read, git.mutate);
  expect(JSON.parse(git.blobs.get(receipt.version)!).forms[0].answers).toEqual(value.forms[0].answers);
  const { intent: _intent, ...rest } = value as Extract<ReviewArtifact, { kind: 'review-response' }>;
  const draft = { ...rest, kind: 'review-draft' as const, id: 'draft-multi' };
  await expect(writeReview({ ...input(), text: JSON.stringify(draft) }, 'github:1', git.read, git.mutate)).resolves.toHaveProperty('version');
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
test('the personal inbox is not satisfied by another reviewer response or draft', () => {
  const { request, requestVersion, value, git } = fixture();
  const pin = { resource: 'review-requests/reader-01/request.json', version_kind: 'git-blob' as const, version: requestVersion, snapshot: git.head };
  const review = {request, pin};
  const artifacts = [{value, pin}];
  expect(reviewStatus(review, artifacts, value.reviewer)).toBe('Responded');
  expect(reviewStatus(review, artifacts, 'github:2')).toBe('Needs response');
  const {intent: _intent, ...rest} = value as Extract<ReviewArtifact, {kind:'review-response'}>;
  expect(reviewStatus(review, [{value:{...rest,kind:'review-draft'},pin}], 'github:2')).toBe('Needs response');
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
