import { useReviewFormFeature } from './ReviewForm.hooks';
import { ReviewFormView, type ReviewFormProps } from './ReviewForm.view';

export function ReviewForm(props: ReviewFormProps) {
  const model = useReviewFormFeature(props);
  return <ReviewFormView {...props} {...model} />;
}
