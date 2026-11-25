import { expect, test, vi } from 'vitest';
import { BrowserChat, ChatStorage, chatStorageId, type ChatCheckpoint } from '../hosted/pi-chat';
import type { PiBridge } from '../hosted/pi-transport';
import type { PublicS3Connection } from '../src/s3-protocol';
import type { PublicInferenceConnection } from '../src/inference-protocol';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

function fixture(pageSize = 100, sameTimestamp = false, response?: (body: any, count: number) => unknown) {
  const storage: PublicS3Connection = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Storage', endpoint: 'https://s3.example/', bucket: 'chats', prefix: 'workspace/', region: 'us-east-1', addressing: 'path', allowRead: true, allowUpload: true, allowOverwrite: false, hostedGrants: [] };
  const inference: PublicInferenceConnection = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Model', model: 'test-model', hostedGrants: [] };
  const objects = new Map<string, string>(), requests: { messages: { role: string; content: string }[] }[] = [];
  let failSave = false, failResults = false;
  let saves = 0;
  const listingRequests: string[] = [];
  const bridge: PiBridge = async request => {
    if (request.operation === 's3Checkpoint') {
      if (failSave) throw Error('Storage offline');
      const bytes = Uint8Array.from(atob(request.base64), character => character.charCodeAt(0)), hash = bytesToHex(sha256(bytes));
      if (failResults && JSON.parse(new TextDecoder().decode(bytes)).messages?.at(-1)?.role === 'toolResult') throw Error('Result checkpoint offline');
      const stamp = new Date(Date.UTC(2026, 10, 24) + (sameTimestamp ? 0 : ++saves)).toISOString().replace(/[:.]/g, '-');
      const key = `${storage.prefix}pi-sessions/${request.sessionId}/${stamp}-${crypto.randomUUID()}-${hash}.json`;
      objects.set(key, request.base64); return { key, sha256: hash } as never;
    }
    if (request.operation === 's3Read') {
      const base64 = objects.get(request.key)!;
      return { key: request.key, base64, size: atob(base64).length } as never;
    }
    if (request.operation === 'inferenceComplete') {
      const body = JSON.parse(request.body); requests.push(body);
      const last = [...objects.values()].at(-1)!;
      const pending = JSON.parse(Buffer.from(last, 'base64').toString());
      expect(pending.phase).toBe('pending');
      expect(pending.messages.at(-1).role).toBe(body.messages.at(-1).role === 'tool' ? 'toolResult' : 'user');
      if (body.messages.at(-1).role === 'tool') expect(pending.messages.at(-1).toolCallId).toBe(body.messages.at(-1).tool_call_id);
      if (response) return response(body, requests.length) as never;
      return { choices: [{ finish_reason: 'stop', message: { content: `Reply ${requests.length}: Café 🌴` } }] } as never;
    }
    if (request.operation === 's3List') {
      listingRequests.push(request.continuationToken ?? '');
      const keys = [...objects.keys()].sort(), start = Number(request.continuationToken ?? 0), end = start + pageSize;
      return { objects: keys.slice(start, end).map(key => ({ key, size: 1 })), ...(end < keys.length ? { continuationToken: String(end) } : {}) } as never;
    }
    throw Error(`Unexpected operation ${request.operation}`);
  };
  return { storage, inference, bridge, objects, requests, listingRequests, setFailSave(value: boolean) { failSave = value; }, setFailResults(value: boolean) { failResults = value; } };
}

test('chat durably journals the user before inference and restores with new device-local connection IDs', async () => {
  const f = fixture(), store = new ChatStorage(f.bridge, f.storage), chat = new BrowserChat(store, f.inference, f.bridge);
  await chat.retrySave(); await chat.send('Hello');
  expect(chat.snapshot().dirty).toBe(false);
  const saved = await store.read(chat.snapshot().sessionId!, chat.snapshot().reference!);
  expect(saved.messages.map(message => message.role)).toEqual(['user', 'assistant']);
  const otherStore = new ChatStorage(f.bridge, { ...f.storage, id: crypto.randomUUID(), revision: crypto.randomUUID() });
  const other = new BrowserChat(otherStore, { ...f.inference, id: crypto.randomUUID(), revision: crypto.randomUUID() }, f.bridge, { checkpoint: await otherStore.read(saved.session_id, chat.snapshot().reference!), reference: chat.snapshot().reference! });
  expect(f.requests).toHaveLength(1);
  await other.send('Continue');
  expect(f.requests[1].messages).toContainEqual({ role: 'assistant', content: 'Reply 1: Café 🌴' });
  expect((await otherStore.read(saved.session_id, other.snapshot().reference!)).messages).toHaveLength(4);
});

test('restored conversation polls only its retained workflow without inference or dispatch, recovers on another device and retains stale status after revocation', async () => {
  const f = fixture(), store = new ChatStorage(f.bridge, f.storage), original = new BrowserChat(store, f.inference, f.bridge);
  await original.retrySave();
  const saved = await store.read(original.snapshot().sessionId!, original.snapshot().reference!);
  const execution = { executionReference: crypto.randomUUID(), digest: 'd'.repeat(64), workspace: 'workspace', thread: 'thread', process: 'process', engineCommit: 'a'.repeat(40),
    userId: 7, installationId: 8, attemptedAt: '2026-11-25T00:00:00Z', state: 'dispatched' as const, runId: 123, connectionId: crypto.randomUUID(), storageRepository: 'owner/storage' };
  const checkpoint = { ...saved, workflow_executions: [execution] }, reference = await store.save(checkpoint);
  const connectionId = crypto.randomUUID(), operations: any[] = [];
  let revoked = false;
  const workflowBridge: PiBridge = async request => {
    operations.push(request);
    if (request.operation === 'connections') return (revoked ? [] : [{ id: connectionId, user: { id: 7 }, installation: { id: 8 } }]) as never;
    if (request.operation === 'workflowStatus') {
      expect(request.id).toBe(connectionId);
      if (!request.recoveryReceipt) throw Error('No device-local receipt');
      return { ...execution, executionState: 'in_progress', attempt: 1 } as never;
    }
    throw Error('Unexpected operation');
  };
  const chat = new BrowserChat(store, f.inference, f.bridge, { checkpoint, reference }, undefined, workflowBridge);
  await chat.refreshWorkflows();
  expect(chat.snapshot().workflows?.[0].observation?.executionState).toBe('in_progress');
  expect(f.requests).toHaveLength(0); expect(operations.some(op => op.operation === 'workflowStart')).toBe(false);
  const observedAt = chat.snapshot().workflows?.[0].observedAt;
  revoked = true; await expect(chat.refreshWorkflows()).rejects.toThrow('refresh incomplete');
  expect(chat.snapshot().workflows?.[0]).toMatchObject({ observedAt, error: expect.stringContaining('unavailable'), observation: { executionState: 'in_progress' } });
  expect(f.requests).toHaveLength(0);
  const other = new BrowserChat(store, f.inference, f.bridge, { checkpoint: saved, reference: original.snapshot().reference! }, undefined, workflowBridge);
  const count = operations.length; await other.refreshWorkflows(); expect(operations).toHaveLength(count);
});

test('post-turn S3 telemetry neither blocks chat completion nor fails saved history, and each invocation gets a trace', async () => {
  const f = fixture(), exports: any[] = [];
  let reject!: (reason: Error) => void;
  const bridge: PiBridge = async request => {
    if (request.operation !== 's3PiTelemetry') return f.bridge(request);
    exports.push(JSON.parse(Buffer.from(request.base64, 'base64').toString()));
    if (exports.length === 1) return new Promise((_resolve, fail) => { reject = fail; });
    return { key: `${f.storage.prefix}telemetry/pi-agent/trace.otel.json`, size: atob(request.base64).length } as never;
  };
  const store = new ChatStorage(bridge, f.storage), chat = new BrowserChat(store, f.inference, bridge);
  await chat.send('Private prompt that must not enter telemetry');
  expect(chat.snapshot()).toMatchObject({ busy: false, dirty: false, phase: 'idle', telemetry: { state: 'uploading' } });
  expect(exports).toHaveLength(1); expect(JSON.stringify(exports)).not.toContain('Private prompt');
  reject(Error('Private provider details')); await vi.waitFor(() => expect(chat.snapshot().telemetry?.state).toBe('failed'));
  expect(chat.snapshot().error).toBeUndefined(); expect((await store.list()).chats).toHaveLength(1);
  await chat.send('Next invocation'); await vi.waitFor(() => expect(chat.snapshot().telemetry?.state).toBe('saved'));
  const traces = exports.map(data => data.resourceSpans[0].scopeSpans[0].spans[0].traceId);
  expect(new Set(traces).size).toBe(2); expect(f.requests).toHaveLength(2);
});

function copiedStorageFixture(sameTimestamp = false) {
  const f = fixture(1, sameTimestamp); f.storage.endpoint = 'https://s3.us-west-004.backblazeb2.com/';
  const r2 = { ...f.storage, id: crypto.randomUUID(), revision: crypto.randomUUID(), endpoint: 'https://account.r2.cloudflarestorage.com/', region: 'auto' };
  const r2Ids = new Set<string>([r2.id]);
  const bridge: PiBridge = async request => {
    const r2Request = 'id' in request && r2Ids.has(request.id);
    if (r2Request && (request.operation === 's3Read' && request.versionId || request.operation === 's3List' && request.versions)) throw Error('R2 does not implement version operations');
    const result = await f.bridge(request);
    if (request.operation === 's3Checkpoint' || request.operation === 's3Read') return { ...(result as object), ...(!r2Request ? { versionId: 'b2-version' } : {}) } as never;
    if (request.operation === 's3List' && !r2Request) return { ...(result as object), objects: (result as { objects: object[] }).objects.map(value => ({ ...value, versionId: 'b2-version' })) } as never;
    return result as never;
  };
  return { ...f, bridge, r2, r2Ids };
}

test('copied B2 conversations require explicit durable import into R2; original objects and interrupted history survive', async () => {
  const f = copiedStorageFixture(), { r2, bridge } = f;
  const originalStore = new ChatStorage(bridge, f.storage), workspace = { repository: 'owner/storage', workspace: 'migrated-workspace' };
  const chat = new BrowserChat(originalStore, f.inference, bridge, undefined, workspace);
  await chat.send('Original B2 conversation');
  const original = await originalStore.read(chat.snapshot().sessionId!, chat.snapshot().reference!);
  const pending = { ...original, phase: 'pending' as const, messages: [...original.messages, { role: 'user' as const, content: 'Interrupted request', timestamp: Date.now() }] };
  const pendingReference = await originalStore.save(pending);
  const copiedBytes = new Map(f.objects), target = new ChatStorage(bridge, r2);
  expect(await target.list()).toMatchObject({ chats: [], copied: [{ storage: chatStorageId(f.storage), conversations: 1 }] });
  await expect(target.read(original.session_id, pendingReference)).rejects.toThrow('Import copied conversations');
  // Foreign catalog entries must not poison fresh R2 conversations.
  const fresh = new BrowserChat(target, f.inference, bridge, undefined, workspace); await fresh.send('Fresh R2 conversation');
  expect((await target.list()).chats).toHaveLength(1);
  const calls = f.requests.length;
  await target.importCopied(); expect(f.requests).toHaveLength(calls);
  expect((await target.list()).copied).toEqual([]);
  expect((await target.list()).chats).toContainEqual(expect.objectContaining({ sessionId: original.session_id, workspace }));
  for (const [key, bytes] of copiedBytes) expect(f.objects.get(key)).toBe(bytes);
  const count = f.objects.size; await target.importCopied(); expect(f.objects.size).toBe(count);
  const otherConnection = { ...r2, id: crypto.randomUUID(), revision: crypto.randomUUID() }; f.r2Ids.add(otherConnection.id);
  const otherDevice = new ChatStorage(bridge, otherConnection);
  const restored = await otherDevice.read(original.session_id, pendingReference);
  expect(restored).toEqual(pending);
  const continued = new BrowserChat(otherDevice, f.inference, bridge, { checkpoint: restored, reference: pendingReference });
  expect(continued.snapshot().phase).toBe('interrupted'); expect(f.requests).toHaveLength(calls);
  await continued.send(); expect(f.requests).toHaveLength(calls + 1);
  expect((await target.read(original.session_id, continued.snapshot().reference!)).storage).toBe(chatStorageId(r2));
  expect((await target.read(original.session_id, pendingReference)).storage).toBe(chatStorageId(f.storage));
  // Copying this import marker again cannot authorize a third destination.
  const third = new ChatStorage(bridge, { ...r2, bucket: 'another-r2-bucket' });
  await expect(third.read(original.session_id, pendingReference)).rejects.toThrow('Import copied conversations');
});

test('failed import is retryable and copied versioned catalog parent chains retain the final workspace', async () => {
  const f = copiedStorageFixture(true), source = new ChatStorage(f.bridge, f.storage), chat = new BrowserChat(source, f.inference, f.bridge);
  await chat.send('History');
  const id = chat.snapshot().sessionId!;
  for (const workspace of ['first', 'second', 'third', 'fourth']) await source.assign(id, { repository: 'owner/storage', workspace });
  const target = new ChatStorage(f.bridge, f.r2);
  f.setFailSave(true); await expect(target.importCopied()).rejects.toThrow('Storage offline');
  expect((await target.list()).chats).toEqual([]);
  f.setFailSave(false); await target.importCopied();
  expect((await target.list()).chats).toMatchObject([{ sessionId: id, workspace: { workspace: 'fourth' } }]);
  const before = f.objects.size;
  await expect(new ChatStorage(f.bridge, { ...f.r2, allowUpload: false }).importCopied()).rejects.toThrow('immutable');
  expect(f.objects.size).toBe(before);
});

test('append-only destination import records retain multiple old storage fingerprints', async () => {
  const f = copiedStorageFixture(), workspace = { repository: 'owner/storage', workspace: 'workspace' };
  const first = new BrowserChat(new ChatStorage(f.bridge, f.storage), f.inference, f.bridge, undefined, workspace);
  await first.send('First source binding');
  f.storage.region = 'another-source-region';
  const second = new BrowserChat(new ChatStorage(f.bridge, f.storage), f.inference, f.bridge, undefined, workspace);
  await second.send('Second source binding');
  const target = new ChatStorage(f.bridge, f.r2);
  expect((await target.list()).copied).toHaveLength(2);
  await target.importCopied();
  expect((await target.list()).copied).toEqual([]);
  expect((await target.list()).chats.map(chat => chat.sessionId).sort()).toEqual([first.snapshot().sessionId, second.snapshot().sessionId].sort());
});

test('restored unresolved codemode calls become uncertainty observations without replay', async () => {
  const f = fixture(), store = new ChatStorage(f.bridge, f.storage), chat = new BrowserChat(store, f.inference, f.bridge);
  await chat.send('Start');
  const checkpoint = await store.read(chat.snapshot().sessionId!, chat.snapshot().reference!);
  const assistant = checkpoint.messages.find(message => message.role === 'assistant')!;
  if (assistant.role !== 'assistant') throw Error('Assistant fixture missing');
  checkpoint.phase = 'pending'; checkpoint.messages.push({ ...assistant, stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'lost-call', name: 'codemode', arguments: { code: 'await tools.workflow_start({})' } }] });
  const restored = new BrowserChat(store, f.inference, f.bridge, { checkpoint, reference: chat.snapshot().reference! });
  expect(restored.snapshot().phase).toBe('interrupted');
  expect(restored.snapshot().messages.at(-1)).toMatchObject({ role: 'toolResult', toolCallId: 'lost-call', isError: true });
  expect(JSON.stringify(restored.snapshot().messages.at(-1))).toContain('Do not replay');
  expect(f.requests).toHaveLength(1);
  await restored.retrySave();
  expect((await store.read(checkpoint.session_id, restored.snapshot().reference!)).messages.at(-1)?.role).toBe('toolResult');
});

test('Pi owns multi-round continuation and checkpoints every intent/result with explicit workspace context', async () => {
  const workspace = { repository: 'owner/storage', workspace: 'project-a' };
  const f = fixture(100, false, (body, count) => {
    expect(body.messages[0].content).toContain(JSON.stringify(workspace));
    expect(body.tools[0].function.description).toContain(JSON.stringify(workspace));
    return { choices: [{ finish_reason: count < 3 ? 'tool_calls' : 'stop', message: count < 3
      ? { content: null, tool_calls: [{ id: `read-${count}`, type: 'function', function: { name: 'unavailable_read', arguments: '{}' } }] }
      : { content: 'Final answer based on saved results' } }] };
  });
  const store = new ChatStorage(f.bridge, f.storage), chat = new BrowserChat(store, f.inference, f.bridge, undefined, workspace);
  await chat.send('Inspect this workspace');
  expect(f.requests).toHaveLength(3); expect(chat.snapshot()).toMatchObject({ phase: 'idle', dirty: false });
  const saved = await store.read(chat.snapshot().sessionId!, chat.snapshot().reference!);
  expect(saved.messages.map(message => message.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant', 'toolResult', 'assistant']);
  const checkpoints = [...f.objects.values()].map(raw => JSON.parse(atob(raw))).filter(checkpoint => checkpoint.profile === 'pi-web-chat-1');
  expect(checkpoints.some(checkpoint => checkpoint.phase === 'pending' && checkpoint.messages.at(-1).role === 'assistant' && checkpoint.messages.at(-1).content[0].id === 'read-1')).toBe(true);
  expect(checkpoints.some(checkpoint => checkpoint.phase === 'pending' && checkpoint.messages.at(-1).toolCallId === 'read-1')).toBe(true);
  expect(checkpoints.some(checkpoint => checkpoint.phase === 'pending' && checkpoint.messages.at(-1).toolCallId === 'read-2')).toBe(true);
});

test('a required intent checkpoint failure halts the SDK before any tool or follow-up request', async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture(100, false, () => {
    f.setFailSave(true);
    return { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'blocked', type: 'function', function: { name: 'codemode', arguments: '{"code":"text(1)"}' } }] } }] };
  });
  const chat = new BrowserChat(new ChatStorage(f.bridge, f.storage), f.inference, f.bridge);
  await chat.send('Do work'); expect(f.requests).toHaveLength(1);
  expect(chat.snapshot()).toMatchObject({ phase: 'interrupted', dirty: true, error: 'Storage offline' });
  expect(chat.snapshot().messages.some(message => message.role === 'toolResult')).toBe(false);
  f.setFailSave(false); await chat.retrySave(); expect(chat.snapshot().dirty).toBe(false); expect(f.requests).toHaveLength(1);
});

test('turn limits pause explicitly and a restored Continue uses saved results without replay', async () => {
  const f = fixture(100, false, (_body, count) => ({ choices: [{ finish_reason: count === 1 ? 'tool_calls' : 'stop', message: count === 1
    ? { content: null, tool_calls: [{ id: 'once', type: 'function', function: { name: 'unavailable_read', arguments: '{}' } }] }
    : { content: 'Continued from the saved result' } }] }));
  const store = new ChatStorage(f.bridge, f.storage), chat = new BrowserChat(store, f.inference, f.bridge, undefined, undefined, undefined, { limits: { modelTurns: 1 } });
  await chat.send('Work'); expect(f.requests).toHaveLength(1); expect(chat.snapshot()).toMatchObject({ phase: 'interrupted', dirty: false });
  expect(chat.snapshot().error).toContain('model turn budget');
  const saved = await store.read(chat.snapshot().sessionId!, chat.snapshot().reference!);
  const other = new BrowserChat(store, f.inference, f.bridge, { checkpoint: saved, reference: chat.snapshot().reference! });
  expect(f.requests).toHaveLength(1); await other.send(); expect(f.requests).toHaveLength(2);
  expect(other.snapshot()).toMatchObject({ phase: 'idle', dirty: false });
  expect(other.snapshot().messages.filter(message => message.role === 'toolResult')).toHaveLength(1);
});

test('a failed result checkpoint blocks model follow-up until explicit save recovery', async () => {
  const f = fixture(100, false, () => ({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'result-once', type: 'function', function: { name: 'unavailable_read', arguments: '{}' } }] } }] }));
  f.setFailResults(true);
  const store = new ChatStorage(f.bridge, f.storage), chat = new BrowserChat(store, f.inference, f.bridge);
  await chat.send('Read'); expect(f.requests).toHaveLength(1);
  expect(chat.snapshot()).toMatchObject({ phase: 'interrupted', dirty: true, error: 'Result checkpoint offline' });
  expect(chat.snapshot().messages.filter(message => message.role === 'toolResult')).toHaveLength(1);
  f.setFailResults(false); await chat.retrySave(); expect(f.requests).toHaveLength(1);
  const saved = await store.read(chat.snapshot().sessionId!, chat.snapshot().reference!);
  expect(saved.messages.filter(message => message.role === 'toolResult')).toHaveLength(1);
});

test('URL scope is checked against durable membership before inference', async () => {
  const f = fixture(), store = new ChatStorage(f.bridge, f.storage), workspace = { repository: 'owner/storage', workspace: 'original' };
  const chat = new BrowserChat(store, f.inference, f.bridge, undefined, workspace, undefined, { workspace: () => ({ ...workspace, workspace: 'wrong' }) });
  await chat.send('Do not run in a different workspace'); expect(f.requests).toHaveLength(0);
  expect(chat.snapshot()).toMatchObject({ dirty: true, phase: 'interrupted' }); expect(chat.snapshot().error).toContain('workspace changed');
});

test('independent device continuations preserve separate branches and exact ancestry', async () => {
  const f = fixture(), store = new ChatStorage(f.bridge, f.storage), original = new BrowserChat(store, f.inference, f.bridge);
  await original.retrySave(); await original.send('Start');
  const reference = original.snapshot().reference!, checkpoint = await store.read(original.snapshot().sessionId!, reference);
  const left = new BrowserChat(store, f.inference, f.bridge, { checkpoint, reference }), right = new BrowserChat(store, f.inference, f.bridge, { checkpoint, reference });
  await left.send('Left'); await right.send('Right');
  const records = [...f.objects.values()].map(base64 => JSON.parse(Buffer.from(base64, 'base64').toString()) as ChatCheckpoint);
  const children = records.filter(record => record.parent === reference);
  expect(children).toHaveLength(2); expect(new Set(children.map(record => record.branch_id)).size).toBe(2);
  expect(left.snapshot().reference).not.toBe(right.snapshot().reference);
});

test('failed user save blocks inference; retry and explicit interrupted continuation send only once', async () => {
  const f = fixture(), store = new ChatStorage(f.bridge, f.storage), chat = new BrowserChat(store, f.inference, f.bridge);
  await chat.retrySave(); f.setFailSave(true); await chat.send('Keep this message');
  expect(f.requests).toHaveLength(0); expect(chat.snapshot()).toMatchObject({ dirty: true, phase: 'interrupted', error: 'Storage offline' });
  f.setFailSave(false); await chat.retrySave();
  const checkpoint = await store.read(chat.snapshot().sessionId!, chat.snapshot().reference!);
  const restored = new BrowserChat(store, f.inference, f.bridge, { checkpoint, reference: chat.snapshot().reference! });
  expect(restored.snapshot().phase).toBe('interrupted'); expect(f.requests).toHaveLength(0);
  await restored.send(); expect(f.requests).toHaveLength(1);
  expect(f.requests[0].messages.filter(message => message.role === 'user')).toEqual([{ role: 'user', content: 'Keep this message' }]);
});

test('checkpoint byte tampering and a mismatched model are rejected', async () => {
  const f = fixture(), store = new ChatStorage(f.bridge, f.storage), chat = new BrowserChat(store, f.inference, f.bridge);
  await chat.retrySave(); const reference = chat.snapshot().reference!, checkpoint = await store.read(chat.snapshot().sessionId!, reference);
  expect(() => new BrowserChat(store, { ...f.inference, model: 'different' }, f.bridge, { checkpoint, reference })).toThrow('saved conversation');
  f.objects.set(reference, btoa('{}'));
  await expect(store.read(checkpoint.session_id, reference)).rejects.toThrow('integrity');
});

test('catalog lists canonical conversations across pages, hides empty legacy drafts and opens the newest continuation', async () => {
  const f = fixture(1), store = new ChatStorage(f.bridge, f.storage);
  const empty = new BrowserChat(store, f.inference, f.bridge); await empty.retrySave();
  const first = new BrowserChat(store, f.inference, f.bridge);
  expect(f.objects.size).toBe(1); // Creating the handle alone writes nothing.
  await first.send('First conversation'); await first.send('Another turn');
  const reference = first.snapshot().reference!, checkpoint = await store.read(first.snapshot().sessionId!, reference);
  const fork = new BrowserChat(store, f.inference, f.bridge, { checkpoint, reference }); await fork.send('Other device');
  const second = new BrowserChat(store, f.inference, f.bridge); await second.send('Second conversation');
  f.listingRequests.length = 0;
  const { chats } = await store.list();
  expect(f.listingRequests.length).toBe(f.objects.size);
  expect(chats).toHaveLength(2);
  expect(chats.map(chat => chat.label)).toEqual(['Second conversation', 'First conversation']);
  expect(chats.find(chat => chat.sessionId === first.snapshot().sessionId)).toMatchObject({ reference: fork.snapshot().reference, messageCount: 6 });
  expect(chats.map(chat => chat.sessionId)).not.toContain(empty.snapshot().sessionId);
  expect((await store.read(first.snapshot().sessionId!, reference)).messages).toHaveLength(4);
});

test('same-millisecond checkpoint keys do not select a pending parent over its settled reply', async () => {
  const f = fixture(1, true), store = new ChatStorage(f.bridge, f.storage), chat = new BrowserChat(store, f.inference, f.bridge);
  await chat.send('Same timestamp');
  expect((await store.list()).chats).toMatchObject([{ reference: chat.snapshot().reference, messageCount: 2 }]);
});

test('workspace association is durable across devices without rewriting transcripts or pinned branches', async () => {
  const f = fixture(1), store = new ChatStorage(f.bridge, f.storage), workspace = { repository: 'owner/storage', workspace: 'existing-nugs-workspace' };
  const chat = new BrowserChat(store, f.inference, f.bridge, undefined, workspace);
  expect(f.objects.size).toBe(0);
  await chat.send('Workspace conversation');
  const reference = chat.snapshot().reference!, sessionId = chat.snapshot().sessionId!, checkpoint = await store.read(sessionId, reference);
  const otherStore = new ChatStorage(f.bridge, { ...f.storage, id: crypto.randomUUID(), revision: crypto.randomUUID() });
  expect((await otherStore.list()).chats).toMatchObject([{ sessionId, reference, workspace }]);
  const transcriptObjects = [...f.objects.entries()].filter(([, bytes]) => JSON.parse(atob(bytes)).profile === 'pi-web-chat-1');
  await otherStore.assign(sessionId, { ...workspace, workspace: 'another-workspace' });
  const stale = new BrowserChat(store, f.inference, f.bridge, { checkpoint, reference }); await stale.send('Old device continues');
  expect((await store.list()).chats).toMatchObject([{ sessionId, workspace: { ...workspace, workspace: 'another-workspace' }, messageCount: 4 }]);
  expect(await store.read(sessionId, reference)).toEqual(checkpoint);
  for (const [key, bytes] of transcriptObjects) expect(f.objects.get(key)).toBe(bytes);
  await store.assign(sessionId, null);
  const rows = (await otherStore.list()).chats; expect(rows).toHaveLength(1); expect(rows[0].workspace).toBeUndefined();
});

test('workspace moves sharing one broker timestamp consistently select the latest descendant across pages', async () => {
  const f = fixture(1, true), store = new ChatStorage(f.bridge, f.storage), chat = new BrowserChat(store, f.inference, f.bridge);
  await chat.send('Existing unassigned conversation');
  const id = chat.snapshot().sessionId!;
  expect((await store.list()).chats[0].workspace).toBeUndefined();
  for (const workspace of ['first', 'second', 'third', 'fourth']) await store.assign(id, { repository: 'owner/storage', workspace });
  expect((await store.list()).chats).toMatchObject([{ sessionId: id, workspace: { repository: 'owner/storage', workspace: 'fourth' } }]);
  await store.assign(id, null); expect((await store.list()).chats[0].workspace).toBeUndefined();
});

test('failed initial workspace persistence blocks inference and a retry preserves the association', async () => {
  const f = fixture(), store = new ChatStorage(f.bridge, f.storage), workspace = { repository: 'owner/storage', workspace: 'workspace' };
  const chat = new BrowserChat(store, f.inference, f.bridge, undefined, workspace);
  f.setFailSave(true); await chat.send('Keep membership and message');
  expect(f.requests).toHaveLength(0); expect(chat.snapshot().dirty).toBe(true); expect(f.objects.size).toBe(0);
  f.setFailSave(false); await chat.retrySave();
  expect((await store.list()).chats).toMatchObject([{ workspace, messageCount: 1 }]);
  await chat.send(); expect(f.requests).toHaveLength(1);
});
