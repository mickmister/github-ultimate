import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { useReviewSessionFeature } from './ReviewSession.hooks';
import { ReviewSessionView } from './ReviewSession.view';

export function ReviewSession(props: Parameters<typeof useReviewSessionFeature>[0]) {
  const model = useReviewSessionFeature(props);
  return <FeedbackProvider queue={model.queue} storageKey={`review:${model.scope.repository}:${model.scope.workspace}:${model.review.request.request_id}:${model.review.pin.version}`}>
    <ReviewSessionView {...model} />
  </FeedbackProvider>;
}
