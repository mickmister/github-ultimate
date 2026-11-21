import { expect, test } from 'vitest';
import { LiveSessionReader, RemoteSessions, type LiveLocator } from '../hosted/live-session';
import type { bridgeRequest } from '../hosted/client';
import type { PublicS3Connection } from '../src/s3-protocol';

const binding = { workspace: 'demo', workspace_ref: 'ws-' + '1'.repeat(32), process: 'pilot', bead: 'task-test' };
const root = 'qrspi/qrspi-hosted/', evidencePrefix = root + 'processes/' + 'a'.repeat(64) + '/executions/123-1/work/';
const locator: LiveLocator = { kind: 'pi-live-locator', schemaVersion: 1, binding, storageRepository: 'owner/storage', repository: 'owner/engine', executionId: '123-1', command: 'work', sourceSha: 'b'.repeat(40), piVersion: '1.5.2', createdAt: '2026-11-21T12:00:00.000Z', evidencePrefix };
const key = root + 'live/owner/storage/demo/123-1/work.json';
const connection = { id: '00000000-0000-4000-8000-000000000001', revision: '00000000-0000-4000-8000-000000000002', name: 'Private Actions', prefix: '', bucket: 'private', allowRead: true } as PublicS3Connection;
function fixture() {
  const objects = new Map<string, unknown>([[key, locator]]), requests: any[] = [];
  const send = (async (r: any) => {
    requests.push(r);
    if (r.operation === 's3Capabilities') return { capabilities: ['s3AllowMissing'] };
    if (r.operation === 's3Connections') return [connection];
    if (r.operation === 's3List') return { objects: [...objects.keys()].filter(k => k.startsWith(r.prefix)).map(key => ({ key, size: JSON.stringify(objects.get(key)).length })) };
    expect(r.id).toBe(connection.id); expect(r.revision).toBe(connection.revision);
    if (!objects.has(r.key)) { expect(r.allowMissing).toBe(true); return { key: r.key, missing: true }; }
    const bytes = new TextEncoder().encode(JSON.stringify(objects.get(r.key)));
    return { key: r.key, size: bytes.length, base64: btoa(String.fromCharCode(...bytes)), contentType: 'application/json' };
  }) as typeof bridgeRequest;
  return { objects, requests, send };
}
function chunk(events: unknown[]) { return { schemaVersion: 1, binding, executionId: '123-1', phaseApproval: false, replayAuthorized: false, events }; }
function pi(sequence: number, event: unknown) { return { schemaVersion: 1, sequence, timestamp: '2026-11-21T12:00:01.000Z', kind: 'pi', sessionId: 'host-parent', parentId: null, role: 'orchestrator', data: { source: 'phase-events.log', event } }; }
const start = pi(1, { type: 'message_start', message: { role: 'assistant', content: [] } });
const delta = pi(2, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello 🌍' } });
const end = pi(3, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world, final.' }] } });
const terminal = { kind: 'pi-live-terminal', schemaVersion: 1, binding, executionId: '123-1', command: 'work', status: 'completed', chunks: 2, sequence: 3, finishedAt: '2026-11-21T12:01:00.000Z', phaseApproval: false };
test('live text precedes completion; late publication, final replacement and refresh replay never duplicate or execute tools', async () => {
  const f = fixture(), reader = new LiveSessionReader(locator, key, connection, f.send);
  await reader.poll(); expect(reader.settled).toBe(false); expect(reader.nextChunk).toBe(1);
  f.objects.set(evidencePrefix + 'chunks/000001.json', chunk([start, delta]));
  await reader.poll(); expect(reader.transcript).toMatchObject([{ text: 'Hello 🌍', partial: true }]);
  expect(reader.settled).toBe(false); expect(reader.sequence).toBe(2);
  f.objects.set(evidencePrefix + 'chunks/000002.json', chunk([end]));
  f.objects.set(evidencePrefix + 'terminal.json', terminal);
  const reopened = new LiveSessionReader(locator, key, connection, f.send);
  await reopened.poll(); expect(reopened.settled).toBe(true);
  expect(reopened.transcript).toMatchObject([{ text: 'Hello world, final.', partial: false }]);
  expect(reopened.transcript).toHaveLength(1);
  expect(f.requests.every(r => ['s3Read'].includes(r.operation))).toBe(true);
});
test('duplicate chunks require the same digest; gaps, foreign attempts and mismatched final sequence are rejected', async () => {
  const f = fixture(), reader = new LiveSessionReader(locator, key, connection, f.send);
  await reader.applyChunk(1, chunk([start, delta]), 'digest', 100);
  await reader.applyChunk(1, chunk([start, delta]), 'digest', 100);
  expect(reader.transcript).toHaveLength(1);
  await expect(reader.applyChunk(1, {}, 'changed', 100)).rejects.toThrow('changed');
  await expect(reader.applyChunk(3, chunk([end]), 'd', 100)).rejects.toThrow('gap');
  await expect(reader.applyChunk(2, { ...chunk([end]), executionId: '123-2' }, 'd', 100)).rejects.toThrow('identity');
  await expect(reader.applyChunk(2, chunk([{ ...end, sequence: 4 }]), 'd', 100)).rejects.toThrow('sequence gap');
  f.objects.set(evidencePrefix + 'terminal.json', { ...terminal, chunks: 1, sequence: 3 });
  await expect(reader.poll()).rejects.toThrow('terminal disagrees');
});
test('terminal cannot settle before declared missing chunks, and native fallback is replaced by the stdout projection', async () => {
  const f = fixture(), reader = new LiveSessionReader(locator, key, connection, f.send);
  f.objects.set(evidencePrefix + 'terminal.json', terminal);
  await reader.poll(); expect(reader.settled).toBe(false);
  await reader.applyChunk(1, chunk([{ ...start, kind: 'native', data: { type: 'message', message: { role: 'assistant', content: 'native history' } } }]), 'native', 100);
  expect(reader.transcript[0].text).toBe('native history');
  await reader.applyChunk(2, chunk([{ ...start, sequence: 2 }, { ...delta, sequence: 3 }]), 'live', 100);
  expect(reader.transcript).toMatchObject([{ text: 'Hello 🌍' }]); expect(reader.transcript).toHaveLength(1);
});
test('workspace discovery is early, prefix bound and rejects a swapped workspace locator', async () => {
  const f = fixture(), remote = new RemoteSessions({ repository: 'owner/storage', workspace: 'demo' }, f.send);
  await remote.connect(); remote.storage = connection.id;
  await remote.discover(); expect(remote.locators).toEqual([{ key, value: locator }]);
  expect(f.requests.find(r => r.operation === 's3List').prefix).toBe(root + 'live/owner/storage/demo/');
  f.objects.set(key, { ...locator, binding: { ...binding, workspace: 'other' } });
  await expect(remote.discover()).rejects.toThrow('identity mismatch');
  const scoped = new RemoteSessions(undefined, f.send); scoped.stores = [connection]; scoped.storage = connection.id;
  await expect(scoped.discover()).rejects.toThrow('selected workspace');
});
test('a direct link survives connection selection and opens its exact locator without scanning history', async () => {
  const f = fixture(), remote = new RemoteSessions({ repository: 'owner/storage', workspace: 'demo' }, f.send);
  remote.selected = key;
  await remote.connect(); remote.edit('storage', connection.id); await remote.discover();
  expect(remote.selected).toBe(key); expect(remote.locators).toHaveLength(1);
  expect(f.requests.some(r => r.operation === 's3List')).toBe(false);
  remote.edit('selected', root + 'live/owner/storage/other/123-1/work.json');
  remote.edit('storage', connection.id);
  await expect(remote.discover()).rejects.toThrow('outside the selected workspace');
});
test('reconnecting a rotated S3 configuration invalidates the old reader and requires fresh discovery', async () => {
  const f = fixture(); let rotated = false;
  const send = (async (request: any) => request.operation === 's3Connections' ? [{ ...connection, revision: rotated ? 'new-revision' : connection.revision }] : f.send(request)) as typeof bridgeRequest;
  const remote = new RemoteSessions({ repository: 'owner/storage', workspace: 'demo' }, send);
  await remote.connect(); remote.edit('storage', connection.id); await remote.discover(); remote.selected = key;
  remote.reader = new LiveSessionReader(locator, key, connection, send);
  rotated = true; await remote.connect();
  expect(remote.reader).toBeUndefined(); expect(remote.locators).toHaveLength(0); expect(remote.selected).toBe(key);
  expect(remote.stores[0].revision).toBe('new-revision');
});
test('a stopped follower cannot apply an in-flight chunk response to its projection', async () => {
  const f = fixture(); let active = true, complete!: (value: unknown) => void;
  const pending = new Promise(resolve => complete = resolve);
  const reader = new LiveSessionReader(locator, key, connection, (() => pending) as typeof bridgeRequest);
  const reading = reader.poll(() => active);
  active = false;
  const bytes = Buffer.from(JSON.stringify(chunk([start, delta])));
  complete({ key: evidencePrefix + 'chunks/000001.json', size: bytes.length, base64: bytes.toString('base64') });
  await reading; expect(reader.nextChunk).toBe(1); expect(reader.transcript).toHaveLength(0); expect(f.requests).toHaveLength(0);
});
test('tool updates retain partial output and a display-limit error permanently stops partial reduction', async () => {
  const f = fixture(), reader = new LiveSessionReader(locator, key, connection, f.send);
  await reader.applyChunk(1, chunk([
    pi(1, { type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'workspace_operation' }),
    pi(2, { type: 'tool_execution_update', toolCallId: 'read-1', toolName: 'workspace_operation', partialResult: { content: [{ type: 'text', text: 'Reading…' }] } }),
  ]), 'tools', 100);
  expect([...reader.tools.values()]).toMatchObject([{ state: 'running', detail: 'Reading…' }]);
  await reader.applyChunk(2, chunk([pi(3, { type: 'tool_execution_end', toolCallId: 'read-1', toolName: 'workspace_operation', isError: true, result: { content: [] } })]), 'end', 100);
  expect([...reader.tools.values()][0].state).toBe('failed');
  await expect(reader.applyChunk(3, chunk([pi(4, { type: 'message_start', message: { role: 'assistant', content: 'x'.repeat(2_000_001) } })]), 'large', 100)).rejects.toThrow('display limit');
  await expect(reader.poll()).rejects.toThrow('display limit');
});
