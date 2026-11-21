import { it, expect } from 'vitest';
import { browserPiAgent } from '../hosted/pi-agent';
import { PiSessions, type SessionBinding } from '../hosted/pi-session';
import type { PiBridge } from '../hosted/pi-transport';
import type { PublicS3Connection, S3Object } from '../src/s3-protocol';
import type { PublicInferenceConnection } from '../src/inference-protocol';
import { createHash } from 'node:crypto';

const inference: PublicInferenceConnection = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Provider', model: 'test-model', hostedGrants: [] };
const github = { id: crypto.randomUUID(), name: 'GitHub', appId: 123, user: { id: 42, login: 'tester' }, installation: { id: 456, account: 'tester' } };
const storage: PublicS3Connection = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Sessions', endpoint: 'https://s3.example/', region: 'auto', bucket: 'sessions', prefix: 'private/', addressing: 'path', allowRead: true, allowUpload: true, allowOverwrite: false, hostedGrants: [] };
const binding: SessionBinding = { runtime: 'earendil-pi-1.5.2-text-v1', inferenceModel: inference.model, githubAppId: github.appId, githubUserId: github.user.id, installationId: github.installation.id, storageEndpoint: storage.endpoint, storageBucket: storage.bucket, storagePrefix: storage.prefix, storageRegion: storage.region, storageAddressing: storage.addressing };
function fixture() {
  const objects = new Map<string, S3Object>(), payloads: any[] = [];
  let calls = 0;
  const bridge: PiBridge = async <T>(request: Parameters<PiBridge>[0]): Promise<T> => {
    if (request.operation === 'inferenceComplete') {
      const body = JSON.parse(request.body); payloads.push(body); calls++;
      return { choices: [{ finish_reason: calls === 1 ? 'tool_calls' : 'stop', message: calls === 1 ? { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'github_probe', arguments: JSON.stringify({ repository: 'owner/repo' }) } }] } : { content: 'The repository head is abc. Café 🌴' } }] } as T;
    }
    if (request.operation === 'agentProbe') { expect(request).toMatchObject({ installationId: 456, userId: 42 }); return { headOid: 'abc' } as T; }
    if (request.operation === 's3Checkpoint') {
      const sha256 = createHash('sha256').update(Buffer.from(request.base64, 'base64')).digest('hex'), key = `private/pi-sessions/${request.sessionId}/${crypto.randomUUID()}-${sha256}.json`;
      objects.set(key, { key, size: atob(request.base64).length, contentType: 'application/json', base64: request.base64 });
      return { key, sha256 } as T;
    }
    if (request.operation === 's3Read') return objects.get(request.key) as T;
    throw new Error(`Unexpected ${request.operation}`);
  };
  return { bridge, objects, payloads };
}
it('runs real Pi tool loop, persists UTF-8 transcript, restores with new device IDs and continues with exact tool context', async () => {
  const { bridge, payloads } = fixture();
  const { agent } = browserPiAgent(bridge, inference, github);
  await agent.prompt('Read owner/repo');
  expect(agent.state.messages.map(item => item.role)).toEqual(['system', 'user', 'assistant', 'toolResult', 'assistant']);
  expect(payloads[1].messages).toContainEqual({ role: 'tool', tool_call_id: 'call-1', content: '{"headOid":"abc"}' });
  const sessions = new PiSessions(bridge, storage), sessionId = crypto.randomUUID();
  const key = await sessions.save(sessionId, binding, agent.state.messages, null);
  const otherStorage = { ...storage, id: crypto.randomUUID(), revision: crypto.randomUUID() };
  const otherSessions = new PiSessions(bridge, otherStorage);
  const restored = await otherSessions.read(key, sessionId, binding);
  const other = browserPiAgent(bridge, { ...inference, id: crypto.randomUUID(), revision: crypto.randomUUID() }, { ...github, id: crypto.randomUUID() }, restored.messages);
  await other.agent.prompt('Continue');
  expect(payloads[2].messages).toContainEqual({ role: 'tool', tool_call_id: 'call-1', content: '{"headOid":"abc"}' });
  expect(JSON.stringify(restored)).toContain('Café 🌴');
  const forkA = await sessions.save(sessionId, binding, agent.state.messages, key), forkB = await otherSessions.save(sessionId, binding, other.agent.state.messages, key);
  expect(forkA).not.toBe(forkB);
  expect((await otherSessions.read(forkB, sessionId, binding)).parent).toBe(key);
});
it('fails closed on mismatched identity and corrupt readback', async () => {
  const { bridge, objects } = fixture(), sessions = new PiSessions(bridge, storage), id = crypto.randomUUID();
  const key = await sessions.save(id, binding, [], null);
  await expect(sessions.read(key, id, { ...binding, githubUserId: 99 })).rejects.toThrow('different connections');
  objects.get(key)!.base64 = btoa('{}');
  await expect(sessions.read(key, id, binding)).rejects.toThrow();
});
it('persists Beads pins and context, rejects a different workspace, and reads legacy sessions in selected context', async () => {
  const { bridge } = fixture(), sessions = new PiSessions(bridge, storage), id = crypto.randomUUID();
  const contextual = { ...binding, beads: { repository: 'owner/storage', workspace: 'selected' } }, beads = { gitCommit: 'a'.repeat(40), doltCommit: '0'.repeat(32), servingCommit: 'b'.repeat(40) };
  const key = await sessions.save(id, contextual, [], null, undefined, beads);
  expect((await sessions.read(key, id, contextual)).beads).toEqual(beads);
  await expect(sessions.read(key, id, { ...contextual, beads: { ...contextual.beads, workspace: 'other' } })).rejects.toThrow('different connections');
  const legacy = await sessions.save(id, binding, [], null);
  expect((await sessions.read(legacy, id, contextual)).beads).toBeUndefined();
});
it('turns malformed/truncated tool arguments into a Pi error without invoking tools', async () => {
  for (const finish_reason of ['tool_calls', 'length']) {
    let tools = 0;
    const bridge: PiBridge = async <T>(request: Parameters<PiBridge>[0]): Promise<T> => {
      if (request.operation !== 'inferenceComplete') { tools++; throw new Error('Must not execute'); }
      return { choices: [{ finish_reason, message: { tool_calls: [{ id: 'bad', type: 'function', function: { name: 'github_probe', arguments: finish_reason === 'length' ? '{"repository":"owner/repo"}' : '{broken' } }] } }] } as T;
    };
    const { agent } = browserPiAgent(bridge, inference, github); await agent.prompt('hello');
    expect(agent.state.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'error' }); expect(tools).toBe(0);
  }
});
it('stops after a bounded number of provider requests even when a model keeps calling tools', async () => {
  let calls = 0;
  const bridge: PiBridge = async <T>(request: Parameters<PiBridge>[0]): Promise<T> => {
    if (request.operation !== 'inferenceComplete') return [] as T;
    return { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: `call-${++calls}`, type: 'function', function: { name: 'github_repositories', arguments: '{}' } }] } }] } as T;
  };
  const { agent } = browserPiAgent(bridge, inference, github); await agent.prompt('loop'); expect(calls).toBe(12);
});
