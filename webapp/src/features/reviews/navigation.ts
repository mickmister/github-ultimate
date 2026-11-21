import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { OpenReview } from '../../../../hosted/reviews';

export interface ReviewLocation { connection?: string; repository?: string; workspace?: string; version?: string; snapshot?: string; requestId?: string }
export function parseReviewSearch(search: Record<string, unknown>): Omit<ReviewLocation, 'requestId'> {
  return Object.fromEntries(['connection', 'repository', 'workspace', 'version', 'snapshot'].filter(key => typeof search[key] === 'string').map(key => [key, search[key]]));
}
export function reviewHref(scope: WorkspaceScope, request?: OpenReview) {
  const query = new URLSearchParams({ connection: scope.connectionId, repository: scope.repository, workspace: scope.workspace });
  if (request) { query.set('version', request.pin.version); query.set('snapshot', request.pin.snapshot); }
  return `#/reviews${request ? `/${request.request.request_id}` : ''}?${query}`;
}
