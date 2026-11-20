import { defineDevicePage } from '../../presentation/Presentation';
import type { ReviewWorkspaceModel } from './ReviewWorkspace.view';
import { ReviewsInboxPhoneView } from './ReviewsInbox.phone.view';
import { ReviewsInboxTabletView } from './ReviewsInbox.tablet.view';
import { ReviewsInboxDesktopView } from './ReviewsInbox.desktop.view';

export const ReviewsInboxPresentation = defineDevicePage<ReviewWorkspaceModel>({
  id: 'reviews.inbox', phone: ReviewsInboxPhoneView, tablet: ReviewsInboxTabletView, desktop: ReviewsInboxDesktopView,
});
