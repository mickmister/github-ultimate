import type { ReviewRequest } from '../../../../src/review-protocol';

export function submissionNotice(request: ReviewRequest): string {
  return request.process
    ? `Submitting saves your response, then attempts to start the configured GitHub workflow for process ${request.process.id}.`
    : 'This request saves feedback only. Submitting will not start a GitHub workflow.';
}
