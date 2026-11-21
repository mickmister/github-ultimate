import type { ReviewRequest } from '../../../../src/review-protocol';

export function submissionNotice(request: ReviewRequest): string {
  return request.process
    ? `Saves feedback and requests a workflow run for ${request.process.id}.`
    : 'Saves feedback; no GitHub workflow run.';
}
