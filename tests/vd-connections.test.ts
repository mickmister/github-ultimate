import { expect, test, vi } from 'vitest';
import { VdConnections, type VdRecord, type VdStore } from '../src/vd-connections';
import { MobileVdStore } from '../src/mobile-vd-store';
import { reviewOrigin } from '../src/review-origin';
import { parseReviewRequest, type ReviewReceipt, type ReviewRequest } from '../src/review-protocol';
import { randomUUID } from 'node:crypto';

const workspaceId = '46e5772c-a538-498f-b3ae-4d7073dddc39', sessionId = '8d4c83eb-bfd9-4321-8bb4-976f1bac24c5';
const page = 'https://review.test/app/', repository = 'owner/storage';
const draft = { name: 'My VD', origin: 'https://vd.test', headers: [{ name: 'Authorization', mode: 'secret' as const, value: 'Bearer very-private-token' }] };
const record: VdRecord = { ...draft, id: randomUUID(), revision: randomUUID(), hostedGrants: [{ origin: 'https://review.test', subpath: '/app/' }] };
const review = parseReviewRequest(JSON.stringify({ kind: 'review-request', schema_version: 1, request_id: 'request', revision_id: 'revision', workspace: 'workspace-a', bead_id: 'task-1', thread: 'threads/task-1', title: 'Review', purpose: 'Discuss', question: 'What next?', status: 'published', change_kind: 'proposal', response_effect: { kind: 'vk-session', workspace_id: workspaceId, session_id: sessionId }, members: [{ kind: 'document', id: 'doc', label: 'Plan', target: { resource: 'threads/task-1/plan.md', version_kind: 'git-blob', version: 'a'.repeat(40), snapshot: 'b'.repeat(40) } }] }));
const receipt: ReviewReceipt = { resource: 'review-requests/request/responses/response.json', version: 'c'.repeat(40), snapshot: 'd'.repeat(40), reviewer: 'github:1' };
class MemoryStore implements VdStore {
  records = new Map([[record.id, structuredClone(record)]]);
  receipts = new Map<string, ReviewReceipt>();
  async all() { return [...this.records.values()].map(item => structuredClone(item)); }
  async get(id: string) { const value = this.records.get(id); return value && structuredClone(value); }
  async put(value: VdRecord) { this.records.set(value.id, structuredClone(value)); }
  async remove(id: string) { this.records.delete(id); }
  async delivery(key: string) { return structuredClone(this.receipts.get(key)); }
  async saveDelivery(key: string, value: ReviewReceipt) { this.receipts.set(key, structuredClone(value)); }
}
function fixture() {
  const store = new MemoryStore(), posts: { url: string; body: any }[] = [];
  let running = false, occupied = false, fail = false, wrongSession = false, archived = false, allowed = true;
  let beforeActivity: (() => void) | undefined;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.redirect).toBe('error'); expect(init?.credentials).toBe('omit'); expect(init?.cache).toBe('no-store');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer very-private-token');
    const path = String(url);
    const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
    if (init?.method === 'POST') {
      expect([...store.receipts.values()][0].dispatch?.state).toBe('unknown');
      posts.push({ url: path, body: JSON.parse(String(init.body)) });
      if (fail) throw new Error('network lost after acceptance');
      return json(path.endsWith('/queue') ? { status: 'queued' } : { id: 'a6075abf-226e-4c88-977c-e11404e59f32', session_id: sessionId });
    }
    if (path.endsWith('/api/workspaces')) return json([{ id: workspaceId, archived }]);
    if (path.endsWith('/queue')) return json({ status: occupied ? 'queued' : 'empty' });
    if (path.includes('conversation-preview')) { beforeActivity?.(); return json({ session_id: sessionId, has_running_turn: running }); }
    return json({ id: wrongSession ? randomUUID() : sessionId, workspace_id: workspaceId, executor: 'CLAUDE_CODE' });
  });
  const broker = () => new VdConnections(store, fetcher, async () => allowed);
  return { store, posts, fetcher, broker, set: (values: { running?: boolean; occupied?: boolean; fail?: boolean; wrongSession?: boolean; archived?: boolean; allowed?: boolean }) => { ({ running = running, occupied = occupied, fail = fail, wrongSession = wrongSession, archived = archived, allowed = allowed } = values); }, onActivity: (fn: () => void) => { beforeActivity = fn; } };
}
test('verified idle delivery journals before POST, preserves executor/pins and deduplicates across broker restart and credential rotation', async () => {
  const f = fixture(), vd = f.broker();
  const sent = await vd.deliver(page, repository, receipt, review, () => true);
  expect(sent.dispatch).toMatchObject({ kind: 'vk', state: 'dispatched', queued: false, process_id: expect.any(String) });
  expect(f.posts[0].url).toBe('https://vd.test/api/sessions/' + sessionId + '/follow-up');
  expect(f.posts[0].body).toMatchObject({ executor_config: { executor: 'CLAUDE_CODE' }, retry_process_id: null, perform_git_reset: null });
  expect(f.posts[0].body.prompt).toContain(receipt.version); expect(f.posts[0].body.prompt).toContain(receipt.snapshot); expect(f.posts[0].body.prompt).not.toContain('very-private-token');
  await vd.handle({ operation: 'save', draft: { ...draft, id: record.id } });
  expect((await f.broker().deliver(page, repository, { ...receipt, snapshot: 'e'.repeat(40) }, review, () => true)).snapshot).toBe(receipt.snapshot);
  expect(f.posts).toHaveLength(1);
});
test('busy empty queue uses queue body; occupied queue retains the response without mutation', async () => {
  const f = fixture(); f.set({ running: true });
  const sent = await f.broker().deliver(page, repository, receipt, review, () => true);
  expect(sent.dispatch).toMatchObject({ state: 'dispatched', queued: true });
  expect(f.posts[0].body.message).toContain(receipt.resource); expect(f.posts[0].body).not.toHaveProperty('prompt');
  const occupied = fixture(); occupied.set({ occupied: true });
  expect((await occupied.broker().deliver(page, repository, receipt, review, () => true)).dispatch?.state).toBe('pending');
  expect(occupied.posts).toHaveLength(0);
});
test('uncertain mutation suppresses automatic replay, including a new broker instance', async () => {
  const f = fixture(); f.set({ fail: true });
  expect((await f.broker().deliver(page, repository, receipt, review, () => true)).dispatch?.state).toBe('unknown');
  f.set({ fail: false });
  expect((await f.broker().deliver(page, repository, receipt, review, () => true)).dispatch?.state).toBe('unknown'); expect(f.posts).toHaveLength(1);
});
test.each(['wrongSession', 'archived', 'revoked', 'wrongPage', 'missing', 'ambiguous', 'notCurrent'] as const)('%s prevents notification without losing saved pins', async mode => {
  const f = fixture();
  if (mode === 'wrongSession') f.set({ wrongSession: true });
  if (mode === 'archived') f.set({ archived: true });
  if (mode === 'revoked') f.set({ allowed: false });
  if (mode === 'missing') f.store.records.clear();
  if (mode === 'ambiguous') { const copy = { ...record, id: randomUUID() }; f.store.records.set(copy.id, copy); }
  const result = await f.broker().deliver(mode === 'wrongPage' ? 'https://review.test/other/' : page, repository, receipt, review, () => mode !== 'notCurrent');
  expect(result.resource).toBe(receipt.resource); expect(result.dispatch?.state).not.toBe('dispatched'); expect(f.posts).toHaveLength(0);
});
test('queue change and revocation during awaited reads stop before POST', async () => {
  for (const mode of ['queue', 'revoke']) {
    const f = fixture(), vd = f.broker();
    f.onActivity(() => { if (mode === 'queue') f.set({ occupied: true }); else void vd.handle({ operation: 'revokeOrigin', id: record.id, origin: 'https://review.test', subpath: '/app/' }); });
    const result = await vd.deliver(page, repository, receipt, review, () => true);
    expect(result.dispatch?.state).not.toBe('dispatched'); expect(f.posts).toHaveLength(0);
  }
});
test('process metadata selects Actions rather than a second VK effect', async () => {
  const f = fixture();
  await f.broker().deliver(page, repository, receipt, { ...review, process: { kind: 'qrspi', id: 'process' } }, () => true);
  expect(f.fetcher).not.toHaveBeenCalled();
});
test('one instance connection serves different review workspaces, storage repositories and sessions without reconfiguration', async () => {
  const destinations = [{ workspace: workspaceId, session: sessionId }, { workspace: randomUUID(), session: randomUUID() }];
  const store = new MemoryStore(), posts: string[] = [];
  const vd = new VdConnections(store, async (url, init) => {
    const path = String(url), json = (data: unknown) => Response.json({ success: true, data });
    if (path.endsWith('/api/workspaces')) return json(destinations.map(item => ({ id: item.workspace })));
    const destination = destinations.find(item => path.includes(item.session))!;
    if (init?.method === 'POST') { posts.push(path); return json({ id: randomUUID(), session_id: destination.session }); }
    if (path.endsWith('/queue')) return json({ status: 'empty' });
    if (path.includes('conversation-preview')) return json({ session_id: destination.session, has_running_turn: false });
    return json({ id: destination.session, workspace_id: destination.workspace, executor: 'OPENCODE' });
  });
  const before = await store.all();
  for (const [index, destination] of destinations.entries()) {
    const request = { ...review, workspace: `storage-workspace-${index}`, response_effect: { kind: 'vk-session' as const, workspace_id: destination.workspace, session_id: destination.session } };
    const result = await vd.deliver(page, `owner/storage-${index}`, receipt, request, () => true);
    expect(result.dispatch?.state).toBe('dispatched');
  }
  expect(posts).toEqual(destinations.map(item => `https://vd.test/api/sessions/${item.session}/follow-up`));
  expect(await store.all()).toEqual(before);
});
test('legacy saved bindings do not constrain an instance or leak into public settings; saved headers and grants survive editing', async () => {
  const f = fixture();
  f.store.records.set(record.id, { ...record, repository: 'old/storage', workspace: 'old-workspace', workspaceId: randomUUID() } as VdRecord);
  const vd = f.broker();
  const listed = await vd.handle({ operation: 'list' }) as any[];
  expect(listed[0]).not.toHaveProperty('workspaceId'); expect(listed[0]).not.toHaveProperty('workspace'); expect(listed[0]).not.toHaveProperty('repository');
  expect((await vd.deliver(page, repository, receipt, review, () => true)).dispatch?.state).toBe('dispatched');
  await vd.handle({ operation: 'save', draft: { ...draft, id: record.id, headers: [{ name: 'Authorization', mode: 'secret' }] } });
  expect(await f.store.get(record.id)).toMatchObject({ headers: [{ name: 'authorization', mode: 'secret', value: draft.headers[0].value }], hostedGrants: record.hostedGrants });
  expect(await f.store.get(record.id)).not.toHaveProperty('workspaceId');
});
test('test accepts an instance with no workspaces yet', async () => {
  const vd = new VdConnections(new MemoryStore(), async () => Response.json({ success: true, data: [] }));
  expect(await vd.handle({ operation: 'test', draft })).toMatchObject({ message: expect.stringContaining('0 workspace(s) visible') });
});
test('an accessible workspace does not authorize a session belonging to another workspace', async () => {
  const f = fixture();
  const vd = new VdConnections(f.store, async (url, init) => String(url).endsWith(`/api/sessions/${sessionId}`)
    ? Response.json({ success: true, data: { id: sessionId, workspace_id: randomUUID(), executor: 'OPENCODE' } })
    : f.fetcher(url, init));
  const result = await vd.deliver(page, repository, receipt, review, () => true);
  expect(result.dispatch).toMatchObject({ state: 'failed', message: expect.stringContaining('review request workspace') });
  expect(f.posts).toHaveLength(0);
});
test('discovery selects the instance containing the requested workspace, and never guesses when another instance is unavailable', async () => {
  const f = fixture(), second = { ...record, id: randomUUID(), origin: 'https://other.test' };
  f.store.records.set(second.id, second);
  let fail = false;
  const vd = new VdConnections(f.store, async (url, init) => {
    if (String(url).startsWith(second.origin)) {
      if (fail) throw new Error('offline');
      return Response.json({ success: true, data: [{ id: randomUUID() }] });
    }
    return f.fetcher(url, init);
  });
  expect((await vd.deliver(page, repository, receipt, review, () => true)).dispatch?.state).toBe('dispatched');
  fail = true;
  expect((await vd.deliver(page, repository, { ...receipt, version: 'e'.repeat(40) }, review, () => true)).dispatch?.state).toBe('pending');
  expect(f.posts).toHaveLength(1);
});
test('test resolves unchanged secrets and unsaved edits without persistence; origin changes require new headers', async () => {
  const f = fixture(), vd = f.broker();
  const before = structuredClone(await f.store.all());
  const value = await vd.handle({ operation: 'test', draft: { ...draft, id: record.id, name: 'Unsaved', headers: [{ name: 'Authorization', mode: 'secret' }] } });
  expect(value).toMatchObject({ message: expect.stringContaining('succeeded') }); expect(await f.store.all()).toEqual(before); expect(f.posts).toHaveLength(0);
  expect(JSON.stringify(await vd.handle({ operation: 'list' }))).not.toContain('very-private-token');
  await expect(vd.handle({ operation: 'test', draft: { ...draft, id: record.id, origin: 'https://other.test', headers: [{ name: 'Authorization', mode: 'secret' }] } })).rejects.toThrow(/replacement/);
});
test('diagnostics redact credentials before truncation and reject HTML/auth envelopes', async () => {
  const store = new MemoryStore();
  const vd = new VdConnections(store, async () => new Response('x'.repeat(3990) + 'very-private-token Bearer%20very-private-token', { status: 401, headers: { 'www-authenticate': 'Bearer' } }));
  await expect(vd.handle({ operation: 'test', draft })).rejects.toThrow(/HTTP 401/);
  try { await vd.handle({ operation: 'test', draft }); } catch (error) { expect(String(error)).not.toContain('very-private'); }
});
test('mobile transport does not require browser TextDecoder, TextEncoder or crypto', async () => {
  const f = fixture(); new Response('{}');
  vi.stubGlobal('TextEncoder', undefined); vi.stubGlobal('TextDecoder', undefined); vi.stubGlobal('crypto', undefined);
  try {
    const vd = new VdConnections(f.store, f.fetcher, undefined, randomUUID);
    expect((await vd.deliver(page, repository, receipt, review, () => true)).dispatch?.state).toBe('dispatched');
  } finally { vi.unstubAllGlobals(); }
});
test('mobile headers stay in secure storage and metadata failures preserve previous generation', async () => {
  const metadata = new Map<string, string>(), secrets = new Map<string, string>(); let fail = false;
  const plain = { getItem: async (key: string) => metadata.get(key) ?? null, setItem: async (key: string, value: string) => { if (fail) throw new Error('disk'); metadata.set(key, value); } };
  const vault = { getItem: async (key: string) => secrets.get(key) ?? null, setItem: async (key: string, value: string) => { secrets.set(key, value); }, removeItem: async (key: string) => { secrets.delete(key); } };
  let store = new MobileVdStore(plain, vault, randomUUID); await store.put(record);
  expect(JSON.stringify([...metadata])).not.toContain('very-private-token');
  fail = true; await expect(store.put({ ...record, headers: [] })).rejects.toThrow(/commit/); fail = false;
  store = new MobileVdStore(plain, vault, randomUUID); expect((await store.get(record.id))?.headers).toEqual(record.headers); expect(secrets.size).toBe(1);
  const secretKey = [...secrets.keys()][0]; const original = secrets.get(secretKey)!;
  secrets.set(secretKey, '{"value":"very-private-token" broken');
  try { await store.get(record.id); } catch (error) { expect(String(error)).toMatch(/Reconnect/); expect(String(error)).not.toContain('very-private-token'); }
  secrets.set(secretKey, original);
  await store.saveDelivery('test', receipt); await store.remove(record.id); expect(await store.delivery('test')).toEqual(receipt);
});
test('publication captures a complete pair, retains amendment binding and requires explicit handoff/suppression', () => {
  const env = { VK_WORKSPACE_ID: workspaceId, VK_SESSION_ID: sessionId };
  expect(reviewOrigin({}, undefined, env)).toHaveProperty('response_effect', review.response_effect);
  const next = { ...env, VK_SESSION_ID: randomUUID() };
  expect(reviewOrigin({}, review, next)).toHaveProperty('response_effect', review.response_effect);
  expect(reviewOrigin({}, review, next, 'handoff')).toHaveProperty('response_effect.session_id', next.VK_SESSION_ID);
  expect(reviewOrigin({ response_effect: review.response_effect }, review, env, 'none')).not.toHaveProperty('response_effect');
  expect(() => reviewOrigin({}, undefined, { VK_SESSION_ID: sessionId })).toThrow();
  expect(reviewOrigin({}, undefined, {})).toEqual({});
});
