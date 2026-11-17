import { bridgeRequest } from '../../../hosted/client';
import { WorkspaceReader, documents, documentText, type GitTransport } from '../../../hosted/workspaces';
import { ReviewReader, type OpenReview } from '../../../hosted/reviews';
import { artifactResource, parseReviewArtifact, requestResource, type ReviewArtifact, type ReviewPin, type ReviewReceipt } from '../../../src/review-protocol';
import type { HostedConnection } from '../../../src/hosted-protocol';
import type { WorkspaceScope } from './contracts';
import { limitConcurrency } from '../../../hosted/concurrency';
import { measure } from '../../../hosted/performance';
import type { ReviewWorkflowProgress } from '../../../src/review-progress';

export const PROCESS_REVIEW_UPDATE = 'This process review requires an updated credential broker. Update the browser extension or Alohak broker, then reload this page and submit again. No review was accepted by this attempt. Capability support does not grant workflow permission.';
export function isLegacyProcessSchemaError(error: unknown): boolean {
  try {
    const issues = JSON.parse(error instanceof Error ? error.message : typeof error === 'string' ? error : '');
    return Array.isArray(issues) && issues.length === 1 && issues[0]?.code === 'unrecognized_keys'
      && Array.isArray(issues[0].keys) && issues[0].keys.length === 1 && issues[0].keys[0] === 'process'
      && Array.isArray(issues[0].path) && issues[0].path.length === 0;
  } catch { return false; }
}

export interface StoredReviewArtifact { value: ReviewArtifact; pin: ReviewPin; dispatch?: ReviewReceipt['dispatch'] }
export interface ReviewListing { requests: OpenReview[]; artifacts: StoredReviewArtifact[]; reviewer: string; acknowledgements: string[] }
export interface ReviewsModuleV1 {
  list(scope: WorkspaceScope, requestId?: string): Promise<ReviewListing>;
  listCached?(scope: WorkspaceScope, requestId?: string): Promise<ReviewListing>;
  open(scope: WorkspaceScope, pin: ReviewPin): Promise<OpenReview>;
  read(scope: WorkspaceScope, pin: ReviewPin): Promise<string>;
  current?(scope: WorkspaceScope, resource: string): Promise<{ pin: ReviewPin; text: string } | null>;
  save(scope: WorkspaceScope, value: ReviewArtifact, expected: string | null): Promise<ReviewReceipt>;
  progress?(scope: WorkspaceScope, response: StoredReviewArtifact): Promise<ReviewWorkflowProgress>;
}
export function createHostedReviews(send: GitTransport = bridgeRequest): ReviewsModuleV1 {
  let support: Promise<boolean> | undefined;
  const retain = () => support ??= bridgeRequest<{ capabilities: string[] }>({ operation: 'discover' }).then(value => value.capabilities.includes('documentSnapshots')).catch(error => { support = undefined; throw error; });
  const run = limitConcurrency(4);
  const readers = new Map<string, ReviewReader>();
  const reviews = (scope: WorkspaceScope, cached = false) => {
    const key = JSON.stringify([scope.connectionId, scope.installationId, scope.repository.toLowerCase(), scope.workspace, cached]);
    let value = readers.get(key);
    if (!value) {
      const active = new WorkspaceReader(async request => {
        const retained = await retain();
        return run(() => send({ ...request, ...(retained ? { cacheRetain: true } : {}), ...(cached ? { cacheOnly: true } : {}) }));
      }, scope.connectionId, scope.repository, scope.installationId, scope.workspace);
      value = new ReviewReader(active, scope.workspace); readers.set(key, value);
      if (readers.size > 16) readers.delete(readers.keys().next().value!);
    }
    return value;
  };
  async function list(scope: WorkspaceScope, cached = false, requestId?: string) {
    const connections = await bridgeRequest<HostedConnection[]>({ operation: 'connections' });
    const connection = connections.find(item => item.id === scope.connectionId && item.installation?.id === scope.installationId);
    if (!connection?.user) throw new Error('An authenticated GitHub reviewer is required.');
    const reviewer = `github:${connection.user.id}`;
    const reviewReader = reviews(scope, cached), active = reviewReader.reader;
    const workspace = (await active.discover()).find(item => item.name === scope.workspace);
    if (!workspace) throw new Error('Workspace is unavailable.');
    const opened = await active.open(workspace);
    const selected = requestId ? { ...opened.snapshot, tree: { ...opened.snapshot.tree, tree: opened.snapshot.tree.tree.filter(entry => entry.path.startsWith(`documents/review-requests/${requestId}/`)) } } : opened.snapshot;
    const requestsPending = reviewReader.list(selected);
    const artifacts: StoredReviewArtifact[] = [];
    const acknowledgements: string[] = [];
    const artifactsPending = Promise.all(documents(selected).map(async entry => {
      const resource = entry.path.slice(10);
      // Other reviewers' drafts are neither inbox data nor this user's restore state.
      const draft = /^review-requests\/[^/]+\/drafts\/([0-9]+)\//.exec(resource);
      if (draft && `github:${draft[1]}` !== reviewer) return;
      if (/^review-requests\/[^/]+\/responses\/[^/]+\.bead\.json$/.test(resource)) {
        if (!requestId) return;
        const ack = JSON.parse(documentText(await active.blob(entry)));
        if (ack.kind === 'review-bead-ack' && ack.schema_version === 1 && typeof ack.response_id === 'string' && typeof ack.response_version === 'string') acknowledgements.push(`${ack.response_id}:${ack.response_version}`);
      } else if (/^review-requests\/[^/]+\/(responses\/[^/]+|drafts\/[0-9]+\/[a-f0-9]+)\.json$/.test(resource)) {
        const value = parseReviewArtifact(documentText(await active.blob(entry)));
        if (artifactResource(value) !== resource) throw new Error('Review artifact path does not match its identity.');
        if (value.kind === 'review-response' || value.reviewer === reviewer) artifacts.push({ value, pin: { resource, version_kind: 'git-blob', version: entry.sha, snapshot: opened.snapshot.commit } });
      }
    }));
    const [requests] = await Promise.all([requestsPending, artifactsPending]);
    artifacts.sort((a, b) => a.pin.resource.localeCompare(b.pin.resource));
    acknowledgements.sort();
    return { requests, artifacts, reviewer, acknowledgements };
  }
  return {
    list: (scope, requestId) => measure('reviews.list', () => list(scope, false, requestId), { targeted: Boolean(requestId), cached: false }),
    listCached: (scope, requestId) => measure('reviews.list', () => list(scope, true, requestId), { targeted: Boolean(requestId), cached: true }),
    open: (scope, pin) => measure('reviews.open', () => reviews(scope).open(pin)),
    read: (scope, pin) => measure('reviews.read', () => reviews(scope).read(pin)),
    async progress(scope, response) {
      const support = await bridgeRequest<{capabilities:string[]}>({operation:'discover'});
      if (!support.capabilities.includes('qrspiWorkflowProgress')) return {state:'unknown',checked_at:new Date().toISOString(), dispatch:response.dispatch, message:'This broker cannot read live workflow progress yet. Update the extension; use the Actions link for now.'};
      return bridgeRequest<ReviewWorkflowProgress>({operation:'reviewProgress', id:scope.connectionId, installationId:scope.installationId, repository:scope.repository, workspace:scope.workspace, resource:response.pin.resource, version:response.pin.version});
    },
    async current(scope, resource) {
      const reader = reviews(scope).reader;
      const found = (await reader.discover()).find(item => item.name === scope.workspace);
      if (!found) throw new Error('Workspace is unavailable.');
      const { snapshot } = await reader.open(found);
      const entry = documents(snapshot).find(item => item.path === `documents/${resource}`);
      return entry ? { pin: { resource, version_kind: 'git-blob', version: entry.sha, snapshot: snapshot.commit }, text: documentText(await reader.blob(entry)) } : null;
    },
    async save(scope, value, expected) {
      const support = await bridgeRequest<{ capabilities: string[] }>({ operation: 'discover' });
      if (!support.capabilities?.includes('reviewWrite')) throw new Error('Update the credential broker to save review drafts and responses.');
      // Resolve the exact immutable request, not mutable head or page-supplied process data.
      const pinned = await reviews(scope).open({ resource: requestResource(value.request.id), version_kind: 'git-blob', version: value.request.version, snapshot: value.request.snapshot });
      const processBound = Boolean(pinned.request.process);
      if (processBound && !support.capabilities?.includes('qrspiProcessReview')) throw new Error(PROCESS_REVIEW_UPDATE);
      try {
        return await bridgeRequest<ReviewReceipt>({ operation: 'reviewWrite', id: scope.connectionId, installationId: scope.installationId, repository: scope.repository, workspace: scope.workspace, text: JSON.stringify(value), expected }, 120000);
      } catch (error) {
        if (processBound && isLegacyProcessSchemaError(error)) throw new Error(PROCESS_REVIEW_UPDATE);
        throw error;
      }
    },
  };
}
