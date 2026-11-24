import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { checkpointSchema } from './pi-session';
import { inferenceStream, piModel, type PiBridge } from './pi-transport';
import { backblaze, checkpointReference, type PublicS3Connection, type S3Listing, type S3Object } from '../src/s3-protocol';
import type { PublicInferenceConnection } from '../src/inference-protocol';
import type { ChatSnapshot, SavedChat, ChatWorkspace } from './pi-chat-contract';

const digest = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const storageIdentity = (storage: PublicS3Connection) => ({ endpoint: storage.endpoint, bucket: storage.bucket, prefix: storage.prefix, region: storage.region, addressing: storage.addressing });
export const chatStorageId = (storage: PublicS3Connection) => digest(new TextEncoder().encode(JSON.stringify(storageIdentity(storage))));
const chatSchema = z.object({
  kind: z.literal('browser-pi-checkpoint'), schema_version: z.literal(2), profile: z.literal('pi-web-chat-1'),
  session_id: z.string().uuid(), branch_id: z.string().uuid(), parent: z.string().max(4096).nullable(),
  created_at: z.string().datetime(), title: z.string().max(100), model: z.string().min(1).max(200),
  storage: z.string().regex(/^[a-f0-9]{64}$/), phase: z.enum(['idle', 'pending', 'interrupted']),
  messages: checkpointSchema.shape.messages.refine(messages => messages.every(message =>
    message.role === 'user' ? typeof message.content === 'string' || message.content.every(block => block.type === 'text') :
      message.role === 'assistant' && message.content.every(block => block.type === 'text' || block.type === 'thinking')), 'Only text and thinking chat messages are supported.'),
}).strict();
export type ChatCheckpoint = z.infer<typeof chatSchema>;
class OtherCheckpointProfile extends Error {}
const workspaceSchema = z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220), workspace: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/) }).strict();
const catalogSchema = z.object({ kind: z.literal('browser-pi-checkpoint'), schema_version: z.literal(1), profile: z.literal('pi-web-catalog-1'), session_id: z.string().uuid(), conversation_id: z.string().uuid(), storage: z.string().regex(/^[a-f0-9]{64}$/), created_at: z.string().datetime(), parent: z.string().max(4096).nullable(), workspace: workspaceSchema.nullable() }).strict();
// A distinct deterministic UUID keeps small immutable catalog events separate
// from transcript branches while using the existing scoped checkpoint broker.
function catalogId(sessionId: string) {
  const hash = digest(new TextEncoder().encode(`pi-web-catalog:${z.string().uuid().parse(sessionId)}`));
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Immutable, readback-verified chat checkpoints use the existing privileged S3
 * checkpoint operation, including B2's ordinary PUT + exact-version contract. */
export class ChatStorage {
  constructor(private bridge: PiBridge, readonly connection: PublicS3Connection) {}
  private async latest() {
    const prefix = `${this.connection.prefix}pi-sessions/`;
    const latest = new Map<string, { timestamp: string; references: string[] }>(), tokens = new Set<string>();
    let token: string | undefined;
    do {
      const listing = await this.bridge<S3Listing>({ operation: 's3List', id: this.connection.id, revision: this.connection.revision, prefix, versions: backblaze(this.connection.endpoint), ...(token ? { continuationToken: token } : {}) });
      for (const object of listing.objects) {
        const match = /^([a-f0-9-]{36})\/([^/]+)-[a-f0-9]{64}\.json$/.exec(object.key.slice(prefix.length));
        if (!object.key.startsWith(prefix) || !match || !z.string().uuid().safeParse(match[1]).success) continue;
        // Broker-generated keys start with a UTC timestamp. Resolve across every
        // listing page before choosing one visible row per canonical session.
        const timestamp = match[2].slice(0, 24), previous = latest.get(match[1]), reference = checkpointReference(object.key, object.versionId);
        if (!previous || timestamp > previous.timestamp) latest.set(match[1], { timestamp, references: [reference] });
        else if (timestamp === previous.timestamp && !previous.references.includes(reference)) previous.references.push(reference);
      }
      token = listing.continuationToken;
      if (token && tokens.has(token)) throw Error('Storage repeated a conversation listing page. Retry refreshing.');
      if (token) tokens.add(token);
    } while (token);
    return latest;
  }
  private async catalog(sessionId: string, references: string[]) {
    const candidates = await Promise.all(references.map(async reference => {
      const checkpoint = catalogSchema.parse(await this.readRaw(sessionId, reference));
      if (checkpoint.session_id !== sessionId || catalogId(checkpoint.conversation_id) !== sessionId || checkpoint.storage !== chatStorageId(this.connection)) throw Error('Invalid conversation workspace metadata.');
      return { checkpoint, reference };
    }));
    const byReference = new Map(candidates.map(item => [item.reference, item]));
    function depth(item: typeof candidates[number]) {
      const visited = new Set<string>(); let parent = item.checkpoint.parent;
      while (parent && byReference.has(parent) && !visited.has(parent)) { visited.add(parent); parent = byReference.get(parent)!.checkpoint.parent; }
      return visited.size;
    }
    return candidates.sort((a, b) => depth(b) - depth(a) || b.checkpoint.created_at.localeCompare(a.checkpoint.created_at) || a.reference.localeCompare(b.reference))[0];
  }
  async list(): Promise<{ chats: SavedChat[] }> {
    const latest = await this.latest();
    const chats: SavedChat[] = [];
    const metadata = new Map<string, ChatWorkspace | null>();
    for (const [sessionId, item] of latest) {
      const candidates: { checkpoint: ChatCheckpoint; reference: string }[] = [];
      for (const reference of item.references) try {
        const raw = await this.readRaw(sessionId, reference);
        if (raw?.profile === 'pi-web-catalog-1') {
          const selected = await this.catalog(sessionId, item.references);
          metadata.set(selected.checkpoint.conversation_id, selected.checkpoint.workspace);
          break;
        } else candidates.push({ checkpoint: this.parseChat(sessionId, raw), reference });
      } catch (error) { if (!(error instanceof OtherCheckpointProfile)) throw error; }
      // Multiple saves can share a broker timestamp. Prefer a descendant and
      // completed transcript rather than a random UUID ordering within that ms.
      candidates.sort((a, b) => a.checkpoint.parent === b.reference ? -1 : b.checkpoint.parent === a.reference ? 1 :
        b.checkpoint.created_at.localeCompare(a.checkpoint.created_at) || b.checkpoint.messages.length - a.checkpoint.messages.length || a.reference.localeCompare(b.reference));
      const selected = candidates[0];
      if (selected) {
        const { checkpoint, reference } = selected;
        // Legacy empty drafts and workspace-agent checkpoints are not conversations.
        if (checkpoint.messages.length) chats.push({ sessionId, reference, label: checkpoint.title, updatedAt: checkpoint.created_at, messageCount: checkpoint.messages.length });
      }
    }
    for (const chat of chats) { const workspace = metadata.get(chat.sessionId); if (workspace) chat.workspace = workspace; }
    return { chats: chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.sessionId.localeCompare(b.sessionId)) };
  }
  async read(sessionId: string, reference: string): Promise<ChatCheckpoint> {
    return this.parseChat(sessionId, await this.readRaw(sessionId, reference));
  }
  private async readRaw(sessionId: string, reference: string): Promise<Record<string, unknown>> {
    z.string().uuid().parse(sessionId);
    const [key, fragment, extra] = reference.split('#');
    const versionId = fragment?.startsWith('versionId=') ? decodeURIComponent(fragment.slice(10)) : undefined;
    const hash = /-([a-f0-9]{64})\.json$/.exec(key)?.[1];
    if (extra || fragment && !versionId || !key.startsWith(`${this.connection.prefix}pi-sessions/${sessionId}/`) || !hash || backblaze(this.connection.endpoint) && !versionId) throw Error('Choose an exact checkpoint within the selected storage and conversation.');
    const object = await this.bridge<S3Object>({ operation: 's3Read', id: this.connection.id, revision: this.connection.revision, key, ...(versionId ? { versionId } : {}) });
    if (object.key !== key || object.size > 4 * 1024 * 1024 || versionId && object.versionId !== versionId) throw Error('Invalid chat checkpoint receipt.');
    const bytes = Uint8Array.from(atob(object.base64), character => character.charCodeAt(0));
    if (bytes.length !== object.size || digest(bytes) !== hash) throw Error('Chat checkpoint integrity check failed.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  private parseChat(sessionId: string, raw: Record<string, unknown>): ChatCheckpoint {
    if (raw?.schema_version !== 2 || raw?.profile !== 'pi-web-chat-1') throw new OtherCheckpointProfile('Open workspace-agent checkpoints in the Agent screen.');
    const checkpoint = chatSchema.parse(raw);
    if (checkpoint.session_id !== sessionId || checkpoint.storage !== chatStorageId(this.connection)) throw Error('This conversation belongs to another storage location.');
    return checkpoint;
  }
  async assign(sessionId: string, workspace: ChatWorkspace | null) {
    if (!this.connection.allowRead || !this.connection.allowUpload || this.connection.allowOverwrite) throw Error('Conversation metadata requires immutable read/write storage.');
    const id = catalogId(sessionId), previous = (await this.latest()).get(id);
    const parent = previous ? (await this.catalog(id, previous.references)).reference : null;
    const metadata = catalogSchema.parse({ kind: 'browser-pi-checkpoint', schema_version: 1, profile: 'pi-web-catalog-1', session_id: id, conversation_id: sessionId, storage: chatStorageId(this.connection), created_at: new Date().toISOString(), parent, workspace });
    const text = JSON.stringify(metadata), bytes = new TextEncoder().encode(text);
    const receipt = z.object({ key: z.string(), versionId: z.string().optional(), sha256: z.literal(digest(bytes)) }).parse(await this.bridge({ operation: 's3Checkpoint', id: this.connection.id, revision: this.connection.revision, sessionId: metadata.session_id, base64: btoa(String.fromCharCode(...bytes)) }));
    const restored = catalogSchema.parse(await this.readRaw(metadata.session_id, checkpointReference(receipt.key, receipt.versionId)));
    if (JSON.stringify(restored) !== text) throw Error('Saved conversation workspace readback differs.');
  }
  async save(checkpoint: ChatCheckpoint): Promise<string> {
    if (!this.connection.allowRead || !this.connection.allowUpload || this.connection.allowOverwrite) throw Error('Chat storage requires reads and uploads, with overwrites disabled.');
    const json = JSON.stringify(chatSchema.parse(checkpoint)), bytes = new TextEncoder().encode(json);
    if (bytes.length > 4 * 1024 * 1024) throw Error('Conversation exceeds the 4 MiB checkpoint limit.');
    let binary = ''; for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    const receipt = z.object({ key: z.string(), versionId: z.string().optional(), sha256: z.literal(digest(bytes)) }).parse(await this.bridge({ operation: 's3Checkpoint', id: this.connection.id, revision: this.connection.revision, sessionId: checkpoint.session_id, base64: btoa(binary) }));
    const reference = checkpointReference(receipt.key, receipt.versionId);
    if (JSON.stringify(await this.read(checkpoint.session_id, reference)) !== json) throw Error('Saved chat readback differs from its checkpoint.');
    return reference;
  }
}

export class BrowserChat {
  private agent: Agent;
  private listeners = new Set<() => void>();
  private checkpoint: ChatCheckpoint;
  private stopped = false;
  private reference?: string;
  private state: ChatSnapshot;
  constructor(private storage: ChatStorage, private inference: PublicInferenceConnection, bridge: PiBridge, restored?: { checkpoint: ChatCheckpoint; reference: string }, private initialWorkspace?: ChatWorkspace) {
    if (restored && restored.checkpoint.model !== inference.model) throw Error('Select an inference connection with the saved conversation’s model.');
    this.checkpoint = restored ? { ...restored.checkpoint, branch_id: crypto.randomUUID(), phase: restored.checkpoint.phase === 'pending' ? 'interrupted' : restored.checkpoint.phase } : {
      kind: 'browser-pi-checkpoint', schema_version: 2, profile: 'pi-web-chat-1', session_id: crypto.randomUUID(), branch_id: crypto.randomUUID(), parent: null, created_at: new Date().toISOString(), title: 'New conversation', model: inference.model, storage: chatStorageId(storage.connection), phase: 'idle', messages: [],
    };
    this.reference = restored?.reference;
    this.agent = new Agent({ initialState: { systemPrompt: 'You are Pi, running in the browser. Answer using this conversation. No filesystem, shell or other tools are available.', model: piModel(inference), messages: this.checkpoint.messages as AgentMessage[], thinkingLevel: 'off', tools: [] }, streamFn: inferenceStream(bridge, inference), finishTurn: () => ({ action: 'end' }) });
    this.state = { title: this.checkpoint.title, messages: [], busy: false, dirty: !restored, phase: this.checkpoint.phase };
    this.agent.subscribe(() => this.publish()); this.publish();
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish() {
    const messages = this.agent.state.messages.filter(message => message.role !== 'system');
    // Pi mutates its in-flight message. Publish an immutable render snapshot so
    // upstream memoized renderers observe each delta and the final transition.
    if (this.agent.state.streamingMessage && this.agent.state.streamingMessage.role !== 'system') messages.push(structuredClone(this.agent.state.streamingMessage));
    this.state = { ...this.state, streaming: this.agent.state.isStreaming, sessionId: this.checkpoint.session_id, reference: this.reference, title: this.checkpoint.title, phase: this.checkpoint.phase, messages };
    for (const listener of this.listeners) listener();
  }
  private async save() {
    this.state = { ...this.state, dirty: true }; this.publish();
    if (this.initialWorkspace) { await this.storage.assign(this.checkpoint.session_id, this.initialWorkspace); this.initialWorkspace = undefined; }
    const candidate = { ...this.checkpoint, parent: this.reference ?? null, created_at: new Date().toISOString(), messages: this.agent.state.messages.filter(message => message.role !== 'system') as ChatCheckpoint['messages'] };
    this.reference = await this.storage.save(candidate); this.checkpoint = candidate;
    this.state = { ...this.state, dirty: false }; this.publish();
  }
  async retrySave() {
    if (this.state.busy) return;
    this.state = { ...this.state, busy: true, error: undefined }; this.publish();
    try { await this.save(); } catch (error) { this.state = { ...this.state, error: error instanceof Error ? error.message : 'Chat save failed.' }; }
    finally { this.state = { ...this.state, busy: false }; this.publish(); }
  }
  async send(text?: string) {
    if (this.state.busy || this.state.dirty && this.reference || !text && this.checkpoint.phase === 'idle') throw Error('Save this conversation before continuing.');
    if (text !== undefined && (!text.trim() || text.length > 128 * 1024)) throw Error('Enter text up to 128 KiB.');
    if (text && this.checkpoint.phase !== 'idle') throw Error('Resolve the interrupted turn before sending another prompt.');
    this.stopped = false; this.state = { ...this.state, busy: true, error: undefined };
    if (text) { this.agent.state.messages = [...this.agent.state.messages, { role: 'user', content: text, timestamp: Date.now() }]; if (this.checkpoint.title === 'New conversation') this.checkpoint.title = text.trim().slice(0, 100); }
    this.checkpoint.phase = 'pending'; this.publish();
    try {
      await this.save(); // No inference may start before the user's message is durable.
      if (this.stopped) { this.checkpoint.phase = 'interrupted'; await this.save(); return; }
      await this.agent.continue();
      this.checkpoint.phase = 'idle';
      const last = this.agent.state.messages.at(-1);
      if (last?.role === 'assistant' && last.errorMessage) this.state = { ...this.state, error: last.errorMessage };
      await this.save();
    } catch (error) {
      this.state = { ...this.state, error: error instanceof Error ? error.message : 'Conversation failed.' };
      if (this.checkpoint.phase === 'pending') this.checkpoint.phase = 'interrupted';
    } finally { this.state = { ...this.state, busy: false }; this.publish(); }
  }
  stop() { this.stopped = true; this.agent.abort(); }
}
