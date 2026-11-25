import { z } from 'zod';
import { S3Connections } from './s3-connections';
import { InferenceConnections } from './inference-connections';
import { s3HostedSchema } from './s3-protocol';
import { inferenceHostedSchema } from './inference-protocol';
import { ConnectionError } from './connections';
import { utf8Bytes } from './utf8';
import { mobilePiChunkChars, mobilePiMaxBytes, splitPiText } from './mobile-pi-protocol';
const transfer = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('begin'), transferId: z.string().uuid(), bytes: z.number().int().positive().max(mobilePiMaxBytes) }).strict(),
  z.object({ phase: z.literal('chunk'), transferId: z.string().uuid(), index: z.number().int().nonnegative(), text: z.string().min(1).max(mobilePiChunkChars) }).strict(),
  z.object({ phase: z.literal('commit'), transferId: z.string().uuid() }).strict(),
  z.object({ phase: z.literal('read'), transferId: z.string().uuid(), index: z.number().int().nonnegative() }).strict(),
  z.object({ phase: z.literal('cancel'), transferId: z.string().uuid() }).strict(),
]);
type Pending = { source: string; current(): boolean; bytes: number; received: number; parts: string[]; running: boolean; response?: string[]; timer: ReturnType<typeof setTimeout> };
/** Bounded transfer for the explicitly allowed Pi/S3 operations only. It does
 * not tunnel arbitrary native/GitHub RPC or relax the 16 KiB native ingress. */
export class MobilePi {
  private pending = new Map<string, Pending>();
  constructor(readonly s3: S3Connections, readonly inference: InferenceConnections) {}
  clear() { for (const pending of this.pending.values()) clearTimeout(pending.timer); this.pending.clear(); this.inference.cancelActive(); }
  private remove(id: string) { const pending = this.pending.get(id); if (pending) clearTimeout(pending.timer); this.pending.delete(id); }
  async hosted(source: string, input: unknown, current: () => boolean) {
    if (!current()) throw new ConnectionError('Native Pi document changed.');
    const inference = inferenceHostedSchema.safeParse(input);
    if (inference.success) return this.inference.handleHosted(source, inference.data, current);
    const storage = s3HostedSchema.parse(input);
    if (storage.operation === 's3Upload') throw new ConnectionError('Use the checkpoint operation to save Pi conversations.');
    return this.s3.handleHosted(source, storage, current);
  }
  async handle(source: string, input: unknown, current: () => boolean) {
    const request = transfer.parse(input);
    if (!current()) throw new ConnectionError('Native Pi document changed.');
    for (const [id, pending] of this.pending) if (!pending.current()) this.remove(id);
    if (request.phase === 'begin') {
      if (this.pending.size >= 2 || this.pending.has(request.transferId)) throw new ConnectionError('Native Pi transfer is busy.');
      this.pending.set(request.transferId, { source, current, bytes: request.bytes, received: 0, parts: [], running: false, timer: setTimeout(() => this.remove(request.transferId), 180000) });
      return null;
    }
    const pending = this.pending.get(request.transferId);
    if (!pending || pending.source !== source || !pending.current()) throw new ConnectionError('Native Pi transfer expired or document changed.');
    if (request.phase === 'cancel') { this.remove(request.transferId); return null; }
    if (request.phase === 'chunk') {
      const bytes = utf8Bytes(request.text);
      if (pending.running || request.index !== pending.parts.length || pending.received + bytes > pending.bytes) { this.remove(request.transferId); throw new ConnectionError('Native Pi chunk order or size mismatch.'); }
      pending.parts.push(request.text); pending.received += bytes; return null;
    }
    if (request.phase === 'read') {
      if (!pending.response || request.index >= pending.response.length) throw new ConnectionError('Native Pi response chunk is unavailable.');
      return { text: pending.response[request.index] };
    }
    if (pending.running || pending.received !== pending.bytes) throw new ConnectionError('Native Pi request is incomplete or already committed.');
    pending.running = true;
    const valid = () => pending.current() && current() && this.pending.get(request.transferId) === pending;
    try {
      const result = await this.hosted(source, JSON.parse(pending.parts.join('')), valid);
      if (!valid()) throw new ConnectionError('Native Pi document changed during the request.');
      const text = JSON.stringify(result), bytes = utf8Bytes(text);
      if (bytes > mobilePiMaxBytes) throw new ConnectionError('Native Pi response exceeded the transfer limit.');
      pending.parts = []; pending.response = splitPiText(text);
      return { chunks: pending.response.length, bytes };
    } catch (cause) { this.remove(request.transferId); throw cause instanceof ConnectionError ? cause : new ConnectionError('Native Pi request or storage is unavailable. Check native settings.'); }
  }
}
