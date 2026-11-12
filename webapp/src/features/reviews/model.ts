import type { OpenReview } from '../../../../hosted/reviews';
import type { ReviewArtifact, ReviewMember } from '../../../../src/review-protocol';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { StoredReviewArtifact } from '../../app-hooks/reviews';
import type { FeedbackComment, FeedbackTarget } from '../feedback/contracts';

export function reviewTarget(scope: WorkspaceScope, review: OpenReview, member: ReviewMember, representation = 'rendered-markdown'): FeedbackTarget {
  const pin = member.kind === 'document' ? member.target : member.dsl;
  return { elementId: `review:${review.request.request_id}:${member.id}`, label: member.label,
    uiPath: ['Reviews', review.request.title, member.label], featureId: 'reviews.member', representation,
    resource: { kind: 'document', id: `${pin.version}:${pin.resource}`, repository: scope.repository, workspace: scope.workspace, path: pin.resource, revision: pin.version } };
}
export function restoreReviewComments(scope: WorkspaceScope, review: OpenReview, comments: ReviewArtifact['comments']): FeedbackComment[] {
  return comments.map(comment => {
    const member = review.request.members.find(member => member.id === comment.member_id);
    if (!member) throw new Error('Saved comment refers to another review request.');
    return { id: comment.id, version: comment.version ?? 1, kind: comment.kind ?? 'content-comment', comment: comment.text,
      context: { target: reviewTarget(scope, review, member, comment.selection?.representation), selection: comment.selection ?? null,
        capturedAt: comment.captured_at ?? '', appBuild: comment.app_build ?? '' } };
  });
}
export function storeReviewComments(scope: WorkspaceScope, review: OpenReview, items: readonly FeedbackComment[]): ReviewArtifact['comments'] {
  return items.map(item => {
    const member = review.request.members.find(member => reviewTarget(scope, review, member).elementId === item.context.target.elementId);
    if (!member) throw new Error('Comment belongs to another review request.');
    const { pageUrl: _pageUrl, ...context } = item.context;
    return { id: item.id, version: item.version, member_id: member.id, text: item.comment, kind: item.kind,
      selection: context.selection ? { ...context.selection, ranges: context.selection.ranges?.map(range => ({ ...range })) } : null, captured_at: context.capturedAt, app_build: context.appBuild };
  });
}
export function responsesFor(review: OpenReview, artifacts: readonly StoredReviewArtifact[]) {
  // Resolution snapshots may advance after a draft save without changing R. The
  // manifest blob seals revision_id and every member's immutable snapshot.
  return artifacts.filter(item => item.value.kind === 'review-response' && item.value.request.id === review.request.request_id && item.value.request.version === review.pin.version);
}
export function reviewStatus(review: OpenReview, artifacts: readonly StoredReviewArtifact[]) {
  if (review.request.status !== 'published') return review.request.status === 'draft' ? 'Draft' : 'Withdrawn';
  const responses = responsesFor(review, artifacts);
  const forms = review.request.members.filter(member => member.kind === 'form');
  if (responses.length && forms.every(member => responses.some(item => item.value.forms.some(form => form.member_id === member.id)))) return 'Responded';
  if (responses.length) return 'Partially responded';
  if (artifacts.some(item => item.value.kind === 'review-draft' && item.value.request.id === review.request.request_id && item.value.request.version === review.pin.version)) return 'In review';
  return 'Needs response';
}
