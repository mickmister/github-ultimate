import { WorkspaceReader, documents, documentText, type Snapshot } from './workspaces';
import { parseReviewRequest, reviewPinSchema, requestResource, type ReviewPin, type ReviewRequest } from '../src/review-protocol';

export interface OpenReview { request: ReviewRequest; pin: ReviewPin }
export class ReviewReader {
  private snapshots = new Map<string, Promise<Snapshot>>();
  constructor(readonly reader: WorkspaceReader, readonly workspace: string) {}
  async read(pin: ReviewPin) {
    reviewPinSchema.parse(pin);
    let pending = this.snapshots.get(pin.snapshot);
    if (!pending) {
      pending = this.reader.open({ name: this.workspace, documents: pin.snapshot }).then(opened => opened.snapshot);
      this.snapshots.set(pin.snapshot, pending);
    }
    const snapshot = await pending;
    const entry = documents(snapshot).find(entry => entry.path === `documents/${pin.resource}` && entry.sha === pin.version);
    if (!entry) throw new Error(`Pinned document is unavailable: ${pin.resource}.`);
    return documentText(await this.reader.blob(entry));
  }
  async list(snapshot: Snapshot): Promise<OpenReview[]> {
    const entries = documents(snapshot).filter(entry => /^documents\/review-requests\/[^/]+\/request\.json$/.test(entry.path));
    const result: OpenReview[] = [];
    // Read serially to avoid a burst of GitHub blob requests.
    for (const entry of entries) {
      const request = parseReviewRequest(documentText(await this.reader.blob(entry)));
      if (request.workspace !== this.workspace || entry.path !== `documents/${requestResource(request.request_id)}`) throw new Error(`Review manifest identity mismatch: ${entry.path}.`);
      result.push({ request, pin: { resource: entry.path.slice(10), version_kind: 'git-blob', version: entry.sha, snapshot: snapshot.commit } });
    }
    return result;
  }
  async open(pin: ReviewPin) {
    const request = parseReviewRequest(await this.read(pin));
    if (request.workspace !== this.workspace || pin.resource !== requestResource(request.request_id)) throw new Error('Review request workspace/path mismatch.');
    return { request, pin };
  }
}
