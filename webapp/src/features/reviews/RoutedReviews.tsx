import { useParams, useRouterState } from '@tanstack/react-router';
import { ReviewWorkspace, parseReviewSearch } from './ReviewWorkspace';
export function RoutedReviews() {
  const search = useRouterState({ select: state => state.location.search });
  const requestId = useParams({ strict: false, select: params => params.requestId });
  const location = { ...parseReviewSearch(search), requestId };
  return <ReviewWorkspace key={JSON.stringify(location)} location={location} />;
}
