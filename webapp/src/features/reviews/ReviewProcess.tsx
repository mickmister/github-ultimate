import { useReviewProcessFeature } from './ReviewProcess.hooks';
import { ReviewProcessView } from './ReviewProcess.view';

export function ReviewProcess(props: Parameters<typeof useReviewProcessFeature>[0]) {
  const model = useReviewProcessFeature(props);
  return props.review.request.process ? <ReviewProcessView scope={props.scope} process={props.review.request.process} {...model} /> : null;
}
