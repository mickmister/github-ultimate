import { WorkspaceReader, documents, documentText, type Snapshot } from './workspaces';
import { parseReviewRequest, parseReviewArtifact, validateReviewArtifact, reviewPinSchema, requestResource, type ReviewPin, type ReviewRequest, type ReviewArtifact } from '../src/review-protocol';

export interface OpenReview { request: ReviewRequest; pin: ReviewPin }
/** Deployed application / receiver validation, never credential-host policy. */
export async function validateReviewSave(reviews: ReviewReader, input: ReviewArtifact) {
  parseReviewArtifact(JSON.stringify(input));
  const value = input;
  const pinned = await reviews.open({ resource: requestResource(value.request.id), version_kind: 'git-blob', version: value.request.version, snapshot: value.request.snapshot });
  await validateReviewArtifact(pinned.request, value, pin => reviews.read(pin));
  const found = (await reviews.reader.discover()).find(item => item.name === reviews.workspace);
  if (!found) throw new Error('Workspace is unavailable.');
  const { snapshot } = await reviews.reader.open(found);
  const currentEntry = documents(snapshot).find(item => item.path === `documents/${requestResource(value.request.id)}`);
  if (!currentEntry) throw new Error('This request is no longer present in the workspace.');
  const current = parseReviewRequest(documentText(await reviews.reader.blob(currentEntry)));
  if (current.workspace !== reviews.workspace || current.request_id !== value.request.id) throw new Error('Current request identity mismatch.');
  if (current.status === 'withdrawn' && value.kind !== 'review-queue-state') throw new Error('This request has been withdrawn. Existing responses remain available.');
  if (pinned.request.process && value.kind !== 'review-queue-state') await reviews.read(pinned.request.process.config);
  return { value, pinned };
}
export class ReviewReader {
  private snapshots = new Map<string, Promise<Snapshot>>();
  constructor(readonly reader: WorkspaceReader, readonly workspace: string) {}
  async read(pin: ReviewPin) {
    reviewPinSchema.parse(pin);
    let pending = this.snapshots.get(pin.snapshot);
    if (!pending) {
      pending = this.reader.open({ name: this.workspace, documents: pin.snapshot }).then(opened => opened.snapshot);
      this.snapshots.set(pin.snapshot, pending);
      void pending.catch(() => { if (this.snapshots.get(pin.snapshot) === pending) this.snapshots.delete(pin.snapshot); });
      if (this.snapshots.size > 16) this.snapshots.delete(this.snapshots.keys().next().value!);
    }
    const snapshot = await pending;
    const entry = documents(snapshot).find(entry => entry.path === `documents/${pin.resource}` && entry.sha === pin.version);
    if (!entry) throw new Error(`Pinned document is unavailable: ${pin.resource}.`);
    return documentText(await this.reader.blob(entry));
  }
  async list(snapshot: Snapshot): Promise<OpenReview[]> {
    const entries = documents(snapshot).filter(entry => /^documents\/review-requests\/[^/]+\/request\.json$/.test(entry.path));
    return Promise.all(entries.map(async entry => {
      const request = parseReviewRequest(documentText(await this.reader.blob(entry)));
      if (request.workspace !== this.workspace || entry.path !== `documents/${requestResource(request.request_id)}`) throw new Error(`Review manifest identity mismatch: ${entry.path}.`);
      return { request, pin: { resource: entry.path.slice(10), version_kind: 'git-blob' as const, version: entry.sha, snapshot: snapshot.commit } };
    }));
  }
  async open(pin: ReviewPin) {
    const request = parseReviewRequest(await this.read(pin));
    if (request.workspace !== this.workspace || pin.resource !== requestResource(request.request_id)) throw new Error('Review request workspace/path mismatch.');
    return { request, pin };
  }
}
