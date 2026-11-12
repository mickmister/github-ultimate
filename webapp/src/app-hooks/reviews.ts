import { bridgeRequest } from '../../../hosted/client';
import { WorkspaceReader, documents, documentText } from '../../../hosted/workspaces';
import { ReviewReader, type OpenReview } from '../../../hosted/reviews';
import { artifactResource, parseReviewArtifact, type ReviewArtifact, type ReviewPin, type ReviewReceipt } from '../../../src/review-protocol';
import type { HostedConnection } from '../../../src/hosted-protocol';
import type { WorkspaceScope } from './contracts';

export interface StoredReviewArtifact { value: ReviewArtifact; pin: ReviewPin }
export interface ReviewListing { requests: OpenReview[]; artifacts: StoredReviewArtifact[]; reviewer: string; acknowledgements: string[] }
export interface ReviewsModuleV1 {
  list(scope: WorkspaceScope): Promise<ReviewListing>;
  open(scope: WorkspaceScope, pin: ReviewPin): Promise<OpenReview>;
  read(scope: WorkspaceScope, pin: ReviewPin): Promise<string>;
  save(scope: WorkspaceScope, value: ReviewArtifact, expected: string | null): Promise<ReviewReceipt>;
}
export function createHostedReviews(): ReviewsModuleV1 {
  const reader = (scope: WorkspaceScope) => new WorkspaceReader(bridgeRequest, scope.connectionId, scope.repository, scope.installationId, scope.workspace);
  const reviews = (scope: WorkspaceScope) => new ReviewReader(reader(scope), scope.workspace);
  return {
    async list(scope) {
      const connections = await bridgeRequest<HostedConnection[]>({ operation: 'connections' });
      const connection = connections.find(item => item.id === scope.connectionId && item.installation?.id === scope.installationId);
      if (!connection?.user) throw new Error('An authenticated GitHub reviewer is required.');
      const reviewer = `github:${connection.user.id}`;
      const active = reader(scope);
      const workspace = (await active.discover()).find(item => item.name === scope.workspace);
      if (!workspace) throw new Error('Workspace is unavailable.');
      const opened = await active.open(workspace);
      const requests = await new ReviewReader(active, scope.workspace).list(opened.snapshot);
      const artifacts: StoredReviewArtifact[] = [];
      const acknowledgements: string[] = [];
      for (const entry of documents(opened.snapshot)) {
        const resource = entry.path.slice(10);
        if (/^review-requests\/[^/]+\/responses\/[^/]+\.bead\.json$/.test(resource)) {
          const ack = JSON.parse(documentText(await active.blob(entry)));
          if (ack.kind === 'review-bead-ack' && ack.schema_version === 1 && typeof ack.response_id === 'string' && typeof ack.response_version === 'string') acknowledgements.push(`${ack.response_id}:${ack.response_version}`);
        } else if (/^review-requests\/[^/]+\/(responses\/[^/]+|drafts\/[0-9]+\/[a-f0-9]+)\.json$/.test(resource)) {
          const value = parseReviewArtifact(documentText(await active.blob(entry)));
          if (artifactResource(value) !== resource) throw new Error('Review artifact path does not match its identity.');
          if (value.kind === 'review-response' || value.reviewer === reviewer) artifacts.push({ value, pin: { resource, version_kind: 'git-blob', version: entry.sha, snapshot: opened.snapshot.commit } });
        }
      }
      return { requests, artifacts, reviewer, acknowledgements };
    },
    open: (scope, pin) => reviews(scope).open(pin),
    read: (scope, pin) => reviews(scope).read(pin),
    async save(scope, value, expected) {
      const support = await bridgeRequest<{ capabilities: string[] }>({ operation: 'discover' });
      if (!support.capabilities?.includes('reviewWrite')) throw new Error('Update the credential broker to save review drafts and responses.');
      return bridgeRequest<ReviewReceipt>({ operation: 'reviewWrite', id: scope.connectionId, installationId: scope.installationId, repository: scope.repository, workspace: scope.workspace, text: JSON.stringify(value), expected }, 120000);
    },
  };
}
