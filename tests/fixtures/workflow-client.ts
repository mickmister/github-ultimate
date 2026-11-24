import { BrowserChat, ChatStorage } from '../../hosted/pi-chat';
import type { PiBridge } from '../../hosted/pi-transport';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

declare global { interface Window { workflowHost(input: unknown): Promise<unknown>; workflowExperiment: ReturnType<typeof fixture> } }
function fixture() {
  const objects = new Map<string, string>(); let code = '', turn = 0, journaled = false, failReceiptSave = false, failSaves = false, loseReply = false;
  let releaseReply: (() => void) | undefined, heldReply: Promise<void> | undefined, launchPending = false;
  const storage = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Storage', endpoint: 'https://s3.example/', bucket: 'chats', prefix: 'fixture/', region: 'us-east-1', addressing: 'path' as const, allowRead: true, allowUpload: true, allowOverwrite: false, hostedGrants: [] };
  const inference = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'Inference', model: 'fixture', hostedGrants: [] };
  const bridge: PiBridge = async input => {
    if (input.operation === 's3Checkpoint') {
      if (failSaves) throw Error('Storage offline after external effect');
      const bytes = Uint8Array.from(atob(input.base64), c => c.charCodeAt(0)), hash = bytesToHex(sha256(bytes));
      const key = `${storage.prefix}pi-sessions/${input.sessionId}/${new Date().toISOString()}-${crypto.randomUUID()}-${hash}.json`;
      objects.set(key, input.base64); return { key, sha256: hash } as never;
    }
    if (input.operation === 's3Read') return { key: input.key, size: atob(objects.get(input.key)!).length, base64: objects.get(input.key) } as never;
    if (input.operation === 's3List') return { objects: [...objects.keys()].map(key => ({ key, size: 1 })) } as never;
    if (input.operation === 'inferenceComplete') {
      const body = JSON.parse(input.body);
      if (body.messages.at(-1).role === 'tool') return { choices: [{ finish_reason: 'stop', message: { content: 'Inspected the workflow receipt.' } }] } as never;
      return { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: `call-${++turn}`, type: 'function', function: { name: 'codemode', arguments: JSON.stringify({ code }) } }] } }] } as never;
    }
    throw Error(`Unexpected ${input.operation}`);
  };
  const workflowBridge: PiBridge = async input => {
    if (input.operation === 'workflowStart') {
      const latest = JSON.parse(atob([...objects.values()].at(-1)!));
      journaled = latest.phase === 'pending' && latest.messages.at(-1).role === 'assistant' && latest.messages.at(-1).content.some((part: any) => part.type === 'toolCall');
      if (!journaled) throw Error('Launch attempted before durable tool intent.');
    }
    const result = await window.workflowHost(input);
    if (input.operation === 'workflowStart' && heldReply) { launchPending = true; await heldReply; }
    if (input.operation === 'workflowStart' && loseReply) { loseReply = false; throw Error('Host launch reply was lost'); }
    if (input.operation === 'workflowStart' && failReceiptSave) failSaves = true;
    return result as never;
  };
  const store = new ChatStorage(bridge, storage);
  let chat = new BrowserChat(store, inference, bridge, undefined, { repository: 'owner/storage', workspace: 'workspace' }, workflowBridge);
  return {
    async run(script: string) { code = script; await chat.send(chat.snapshot().phase === 'interrupted' ? undefined : `Execute workflow step ${turn + 1}`); return { snapshot: chat.snapshot(), journaled, checkpoint: await store.read(chat.snapshot().sessionId!, chat.snapshot().reference!) }; },
    async restore() { const snapshot = chat.snapshot(); chat = new BrowserChat(store, inference, bridge, { checkpoint: await store.read(snapshot.sessionId!, snapshot.reference!), reference: snapshot.reference! }, undefined, workflowBridge); },
    async restoreOldest() {
      const [reference] = [...objects].find(([, raw]) => JSON.parse(atob(raw)).profile === 'pi-web-chat-1')!;
      const checkpoint = await store.read(chat.snapshot().sessionId!, reference);
      chat = new BrowserChat(store, inference, bridge, { checkpoint, reference }, undefined, workflowBridge);
    },
    failReceiptSave() { failReceiptSave = true; },
    loseLaunchReply() { loseReply = true; },
    holdLaunchReply() { heldReply = new Promise<void>(resolve => { releaseReply = resolve; }); },
    launchPending: () => launchPending,
    stop() { chat.stop(); },
    releaseLaunchReply() { releaseReply?.(); heldReply = undefined; },
    currentCheckpoint() { return store.read(chat.snapshot().sessionId!, chat.snapshot().reference!); },
    async retrySave() { failSaves = false; failReceiptSave = false; await chat.retrySave(); return store.read(chat.snapshot().sessionId!, chat.snapshot().reference!); },
  };
}
window.workflowExperiment = fixture();
