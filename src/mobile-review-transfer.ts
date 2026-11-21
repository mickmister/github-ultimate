import { z } from 'zod';
import { reviewWriteSchema, type ReviewWrite } from './review-protocol';
import { utf8Bytes } from './utf8';
import { maxMobileReviewBytes, mobileReviewChunkChars, mobileReviewTransferTTL } from './mobile-transfer-protocol';

const identity = { transferId: z.string().uuid() };
const transferSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('begin'), ...identity, bytes: z.number().int().positive().max(maxMobileReviewBytes), request: reviewWriteSchema.omit({ text: true }) }).strict(),
  z.object({ phase: z.literal('chunk'), ...identity, index: z.number().int().min(0).max(127), text: z.string().min(1).max(mobileReviewChunkChars) }).strict(),
  z.object({ phase: z.literal('commit'), ...identity }).strict(),
  z.object({ phase: z.literal('cancel'), ...identity }).strict(),
]);
type Pending = { source: string; current(): boolean; request: Omit<ReviewWrite, 'text'>; bytes: number; received: number; parts: string[]; timer: ReturnType<typeof setTimeout> };

/** At most two bounded, ordered, document-bound artifacts; no generic RPC tunneling. */
export class MobileReviewTransfers {
  private pending = new Map<string, Pending>();
  clear() { for (const value of this.pending.values()) clearTimeout(value.timer); this.pending.clear(); }
  private remove(id: string) { const value = this.pending.get(id); if (value) clearTimeout(value.timer); this.pending.delete(id); }
  async handle(source: string, input: unknown, current: () => boolean, save: (request: ReviewWrite, current: () => boolean) => Promise<unknown>) {
    const request = transferSchema.parse(input);
    if (!current()) throw new Error('Native review document or access changed.');
    for (const [id, pending] of this.pending) if (!pending.current()) this.remove(id);
    if (request.phase === 'begin') {
      if (this.pending.has(request.transferId)) throw new Error('Review transfer already exists.');
      if (this.pending.size >= 2) throw new Error('Too many pending review transfers.');
      this.pending.set(request.transferId, { source, current, request: request.request, bytes: request.bytes, received: 0, parts: [], timer: setTimeout(() => this.remove(request.transferId), mobileReviewTransferTTL) });
      return { transferId: request.transferId };
    }
    const pending = this.pending.get(request.transferId);
    if (!pending || pending.source !== source || !pending.current()) throw new Error('Review transfer expired or document/access changed.');
    if (request.phase === 'cancel') { this.remove(request.transferId); return null; }
    if (request.phase === 'chunk') {
      const size = utf8Bytes(request.text);
      if (request.index !== pending.parts.length || pending.received + size > pending.bytes) {
        this.remove(request.transferId); throw new Error('Review chunk order or byte limit mismatch.');
      }
      pending.parts.push(request.text); pending.received += size;
      return { index: request.index };
    }
    this.remove(request.transferId);
    const text = pending.parts.join('');
    if (pending.received !== pending.bytes || utf8Bytes(text) !== pending.bytes) throw new Error('Review transfer is incomplete.');
    return save({ ...pending.request, text }, pending.current);
  }
}
