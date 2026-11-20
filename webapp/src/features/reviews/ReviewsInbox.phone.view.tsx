import type { SurfaceProps } from '../../presentation/Presentation';
import type { ReviewWorkspaceModel } from './ReviewWorkspace.view';
import { ReviewSource, ReviewFilters, ReviewInboxList } from './ReviewsInboxParts.view';
import { reviewsCopy as copy } from './Reviews.copy';

export function ReviewsInboxPhoneView(props: SurfaceProps<ReviewWorkspaceModel>) {
  return <div className="review-inbox-phone" data-review-surface="phone" data-orientation={props.presentation.orientation}>
    <details open={!props.scope}><summary>{copy.source.text}</summary><ReviewSource {...props} /><ReviewFilters {...props} /></details>
    <ReviewInboxList {...props} />
  </div>;
}
