import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { useReviewSessionFeature } from './ReviewSession.hooks';
import { ReviewSessionView } from './ReviewSession.view';

export function ReviewSession(props: Parameters<typeof useReviewSessionFeature>[0]) {
  const model = useReviewSessionFeature(props);
  return <FeedbackProvider queue={model.queue} storageKey={`review:${model.scope.repository}:${model.scope.workspace}:${model.review.request.request_id}:${model.review.pin.version}`}
    submission={{ submit: model.actions.submit, disabled: model.busy || model.review.request.status !== 'published' || model.latest?.request.status === 'withdrawn', notice: model.notice, error: model.error }}>
    <ReviewSessionView {...model} />
  </FeedbackProvider>;
}
