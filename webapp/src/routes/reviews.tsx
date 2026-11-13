import { createFileRoute } from '@tanstack/react-router';
import { RoutedReviews } from '../features/reviews/RoutedReviews';
import { parseReviewSearch } from '../features/reviews/ReviewWorkspace';
export const Route = createFileRoute('/reviews')({ ssr: false, validateSearch: parseReviewSearch, component: RoutedReviews });
