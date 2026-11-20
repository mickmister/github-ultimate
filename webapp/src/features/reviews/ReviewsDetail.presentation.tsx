import { defineDeviceRegion } from '../../presentation/Presentation';
import type { OpenReview } from '../../../../hosted/reviews';
import { ReviewsDetailPhoneView } from './ReviewsDetail.phone.view';
import { ReviewsDetailTabletView } from './ReviewsDetail.tablet.view';
import { ReviewsDetailDesktopView } from './ReviewsDetail.desktop.view';

export interface ReviewNavigatorModel {
  review: OpenReview; selected: string; progress: readonly string[]; submitted: ReadonlySet<string>;
  onSelect(id: string): void;
}
// Only navigation swaps. Content, feedback and process hosts remain stable siblings.
export const ReviewsDetailPresentation = defineDeviceRegion<ReviewNavigatorModel>({
  id: 'reviews.detail', phone: ReviewsDetailPhoneView, tablet: ReviewsDetailTabletView, desktop: ReviewsDetailDesktopView,
});
