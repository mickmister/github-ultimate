import type { OpenReview } from '../../../../hosted/reviews';
import { artifactResource, type ReviewArtifact } from '../../../../src/review-protocol';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewListing, ReviewsModuleV1, StoredReviewArtifact } from '../../app-hooks/reviews';
import { reviewStatus } from './model';

export type ReviewQueueFilter = 'active' | 'dismissed' | 'completed' | 'all';
export function reviewQueueState(review: OpenReview, listing: ReviewListing) {
  return listing.artifacts.find(item => item.value.kind === 'review-queue-state' && item.value.request.id === review.request.request_id && item.value.reviewer === listing.reviewer);
}
export function reviewQueueCategory(review: OpenReview, listing: ReviewListing) {
  const saved = reviewQueueState(review, listing);
  if (saved?.value.kind === 'review-queue-state' && saved.value.category === 'dismissed') return 'dismissed';
  if (review.request.status === 'withdrawn' || reviewStatus(review, listing.artifacts, listing.reviewer) === 'Responded') return 'completed';
  return review.request.status === 'draft' ? 'draft' : 'active';
}
export function matchesReviewQueue(review: OpenReview, listing: ReviewListing, filter: ReviewQueueFilter) {
  return filter === 'all' || reviewQueueCategory(review, listing) === filter;
}
export async function saveReviewCategory(service: ReviewsModuleV1, scope: WorkspaceScope, listing: ReviewListing, review: OpenReview, category: 'active' | 'dismissed'): Promise<StoredReviewArtifact> {
  const value: ReviewArtifact = { kind: 'review-queue-state', schema_version: 1, transport: 'workspace-resources', id: `queue-${crypto.randomUUID()}`,
    request: { id: review.request.request_id, version: review.pin.version, snapshot: review.pin.snapshot }, reviewer: listing.reviewer,
    category, forms: [], comments: [], progress: [] };
  const previous = reviewQueueState(review, listing);
  const receipt = await service.save(scope, value, previous?.pin.version ?? null);
  if (receipt.resource !== artifactResource(value) || receipt.reviewer !== listing.reviewer) throw new Error('Saved review category receipt does not match this request and reviewer. Refresh the queue.');
  return { value, pin: { resource: receipt.resource, version_kind: 'git-blob', version: receipt.version, snapshot: receipt.snapshot } };
}
export function withReviewCategory(listing: ReviewListing, saved: StoredReviewArtifact): ReviewListing {
  return { ...listing, artifacts: [...listing.artifacts.filter(item => item.pin.resource !== saved.pin.resource), saved] };
}
