import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ChatMessage } from './pi-chat-contract';
import { z } from 'zod';
import type { PublicS3Connection, S3Object } from '../src/s3-protocol';
import { backblaze, checkpointReference } from '../src/s3-protocol';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { PiBridge } from './pi-transport';
import { Scratch, scratchSchema, type ScratchState } from '../src/scratch';

const text = z.object({ type: z.literal('text'), text: z.string().max(2 * 1024 * 1024) }).strict();
const toolCall = z.object({ type: z.literal('toolCall'), id: z.string().min(1).max(200), name: z.string().min(1).max(100), arguments: z.record(z.string(), z.json()) }).strict();
const thinking = z.object({ type: z.literal('thinking'), thinking: z.string().max(2 * 1024 * 1024), thinkingSignature: z.string().max(2 * 1024 * 1024).optional(), redacted: z.boolean().optional() }).strict();
const count = z.number().nonnegative();
const usage = z.object({ input: count, output: count, cacheRead: count, cacheWrite: count, totalTokens: count, cost: z.object({ input: count, output: count, cacheRead: count, cacheWrite: count, total: count }) });
// Parse only the supported text/tool transcript. Rebuild tools and the system prompt
// from the current application, never deserialize executable tools from S3.
const message = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.union([z.string(), z.array(text)]), timestamp: count }),
  z.object({ role: z.literal('assistant'), content: z.array(z.union([text, thinking, toolCall])), api: z.literal('openai-completions'), provider: z.literal('extension'), model: z.string().max(200), usage, stopReason: z.enum(['stop', 'length', 'toolUse', 'error', 'aborted']), errorMessage: z.string().optional(), timestamp: count }),
  z.object({ role: z.literal('toolResult'), toolCallId: z.string().min(1), toolName: z.string(), content: z.array(text), isError: z.boolean(), timestamp: count }),
]) satisfies z.ZodType<ChatMessage>;
// Portable identities permit independently authorized devices with different
// local connection UUIDs. Each request still uses that device's current revision.
export const sessionBindingSchema = z.object({ runtime: z.literal('earendil-pi-1.5.2-text-v1'), inferenceModel: z.string().min(1).max(200), githubAppId: z.number().int().positive(), githubUserId: z.number().int().positive(), installationId: z.number().int().positive(), storageEndpoint: z.string().max(2000), storageBucket: z.string().max(63), storagePrefix: z.string().max(1024), storageRegion: z.string().max(100), storageAddressing: z.enum(['path', 'virtual']), beads: z.object({ repository: z.string().max(220), workspace: z.string().max(200) }).strict().optional() }).strict();
export type SessionBinding = z.infer<typeof sessionBindingSchema>;
export const checkpointSchema = z.object({ kind: z.literal('browser-pi-checkpoint'), schema_version: z.literal(1), session_id: z.string().uuid(), checkpoint_id: z.string().uuid(), parent: z.string().nullable(), created_at: z.string().datetime(), binding: sessionBindingSchema, messages: z.array(message).max(2000), scratch: scratchSchema.optional(), beads: z.object({ gitCommit: z.string().regex(/^[a-f0-9]{40}$/), doltCommit: z.string().regex(/^[0-9a-v]{32}$/), servingCommit: z.string().regex(/^[a-f0-9]{40}$/).optional() }).strict().optional() }).strict();
export type PiCheckpoint = z.infer<typeof checkpointSchema>;
export function validateTranscript(messages: PiCheckpoint['messages']) {
  const pending = new Map<string, string>(), seen = new Set<string>();
  for (const item of messages) {
    if (item.role === 'toolResult') {
      if (pending.get(item.toolCallId) !== item.toolName) throw new Error('Checkpoint has an unmatched tool result.');
      pending.delete(item.toolCallId);
    } else {
      if (pending.size) throw new Error('Checkpoint has unresolved tool calls; automatic replay is disabled.');
      if (item.role === 'assistant') for (const call of item.content) if (call.type === 'toolCall') {
        if (seen.has(call.id)) throw new Error('Checkpoint has duplicate tool call IDs.');
        seen.add(call.id); pending.set(call.id, call.name);
      }
    }
  }
  if (pending.size) throw new Error('Checkpoint has unresolved tool calls; automatic replay is disabled.');
}
function encode(text: string) {
  const bytes = new TextEncoder().encode(text); let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(binary);
}
export class PiSessions {
  constructor(private bridge: PiBridge, private storage: PublicS3Connection) {}
  prefix(sessionId: string) { return `${this.storage.prefix}pi-sessions/${z.string().uuid().parse(sessionId)}/`; }
  async save(sessionId: string, binding: SessionBinding, messages: AgentMessage[], parent: string | null, scratch?: ScratchState, beads?: PiCheckpoint['beads']) {
    if (!this.storage.allowRead || !this.storage.allowUpload || this.storage.allowOverwrite) throw new Error('Choose S3 storage with reads/uploads enabled and overwrites disabled.');
    if (beads && !binding.beads) throw Error('A Beads snapshot requires a selected workspace binding.');
    if (scratch) new Scratch(scratch);
    const checkpoint = checkpointSchema.parse({ kind: 'browser-pi-checkpoint', schema_version: 1, session_id: sessionId, checkpoint_id: crypto.randomUUID(), parent, created_at: new Date().toISOString(), binding, messages: messages.filter(message => message.role !== 'system'), ...(scratch ? { scratch } : {}), ...(beads ? { beads } : {}) });
    validateTranscript(checkpoint.messages);
    const json = JSON.stringify(checkpoint);
    if (new TextEncoder().encode(json).length > 4 * 1024 * 1024) throw new Error('Checkpoint exceeds the POC 4 MiB session limit.');
    const digest = bytesToHex(sha256(new TextEncoder().encode(json)));
    const receipt = z.object({ key: z.string().max(1024), versionId: z.string().max(2000).optional(), sha256: z.literal(digest) }).parse(await this.bridge({ operation: 's3Checkpoint', id: this.storage.id, revision: this.storage.revision, sessionId, base64: encode(json) }));
    if (!receipt.key.startsWith(this.prefix(sessionId)) || !receipt.key.endsWith(`-${digest}.json`) || backblaze(this.storage.endpoint) && !receipt.versionId) throw Error('Invalid checkpoint storage receipt.');
    const key = checkpointReference(receipt.key, receipt.versionId);
    // A PUT acknowledgement alone is not proof that the session can be restored.
    const stored = await this.read(key, sessionId, binding);
    if (JSON.stringify(stored) !== json) throw new Error('Session readback differs from the saved checkpoint.');
    return key;
  }
  async read(key: string, sessionId: string, binding: SessionBinding): Promise<PiCheckpoint> {
    const [objectKey, fragment, extra] = key.split('#');
    const versionId = fragment?.startsWith('versionId=') ? decodeURIComponent(fragment.slice(10)) : undefined;
    if (extra || fragment && !versionId || !objectKey.startsWith(this.prefix(sessionId)) || !objectKey.endsWith('.json') || backblaze(this.storage.endpoint) && !versionId) throw new Error('Checkpoint is outside the selected session or needs an exact version.');
    const object = await this.bridge<S3Object>({ operation: 's3Read', id: this.storage.id, revision: this.storage.revision, key: objectKey, ...(versionId ? { versionId } : {}) });
    if (object.key !== objectKey || object.size > 4 * 1024 * 1024 || versionId && object.versionId !== versionId) throw new Error('Invalid checkpoint object or version.');
    const bytes = Uint8Array.from(atob(object.base64), char => char.charCodeAt(0));
    if (bytes.length !== object.size) throw new Error('Invalid checkpoint size.');
    const expectedDigest = /-([a-f0-9]{64})\.json$/.exec(objectKey)?.[1];
    if (expectedDigest && bytesToHex(sha256(bytes)) !== expectedDigest) throw Error('Checkpoint SHA-256 mismatch.');
    const checkpoint = checkpointSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (checkpoint.beads && !checkpoint.binding.beads) throw Error('Beads snapshot has no workspace binding.');
    if (checkpoint.session_id !== sessionId || [...new Set([...Object.keys(binding), ...Object.keys(checkpoint.binding)])].some(key => key === 'beads' && !checkpoint.binding.beads && !checkpoint.beads ? false : JSON.stringify(binding[key as keyof SessionBinding]) !== JSON.stringify(checkpoint.binding[key as keyof SessionBinding]))) throw new Error('Checkpoint belongs to different connections or configuration. No fallback was used.');
    validateTranscript(checkpoint.messages);
    if (checkpoint.scratch) new Scratch(checkpoint.scratch);
    return checkpoint;
  }
}
