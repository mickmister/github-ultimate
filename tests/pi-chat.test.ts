import { expect, test } from 'vitest';
import { BrowserChat, ChatStorage, type ChatCheckpoint } from '../hosted/pi-chat';
import type { PiBridge } from '../hosted/pi-transport';
import type { PublicS3Connection } from '../src/s3-protocol';
import type { PublicInferenceConnection } from '../src/inference-protocol';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

function fixture(pageSize = 100, sameTimestamp = false) {
  const storage: PublicS3Connection = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Storage', endpoint: 'https://s3.example/', bucket: 'chats', prefix: 'workspace/', region: 'us-east-1', addressing: 'path', allowRead: true, allowUpload: true, allowOverwrite: false, hostedGrants: [] };
  const inference: PublicInferenceConnection = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Model', model: 'test-model', hostedGrants: [] };
  const objects = new Map<string, string>(), requests: { messages: { role: string; content: string }[] }[] = [];
  let failSave = false;
  let saves = 0;
  const listingRequests: string[] = [];
  const bridge: PiBridge = async request => {
    if (request.operation === 's3Checkpoint') {
      if (failSave) throw Error('Storage offline');
      const bytes = Uint8Array.from(atob(request.base64), character => character.charCodeAt(0)), hash = bytesToHex(sha256(bytes));
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
      expect(pending.messages.at(-1).role).toBe('user');
      return { choices: [{ finish_reason: 'stop', message: { content: `Reply ${requests.length}: Café 🌴` } }] } as never;
    }
    if (request.operation === 's3List') {
      listingRequests.push(request.continuationToken ?? '');
      const keys = [...objects.keys()].sort(), start = Number(request.continuationToken ?? 0), end = start + pageSize;
      return { objects: keys.slice(start, end).map(key => ({ key, size: 1 })), ...(end < keys.length ? { continuationToken: String(end) } : {}) } as never;
    }
    throw Error(`Unexpected operation ${request.operation}`);
  };
  return { storage, inference, bridge, objects, requests, listingRequests, setFailSave(value: boolean) { failSave = value; } };
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
