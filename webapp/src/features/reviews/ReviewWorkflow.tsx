import { useReviewWorkflowFeature } from './ReviewWorkflow.hooks';
import { ReviewWorkflowView } from './ReviewWorkflow.view';

export function ReviewWorkflow(props: Parameters<typeof useReviewWorkflowFeature>[0]) {
  const model = useReviewWorkflowFeature(props);
  return <ReviewWorkflowView scope={props.scope} response={props.response} {...model} />;
}
