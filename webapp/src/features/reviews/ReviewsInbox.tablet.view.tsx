import type { SurfaceProps } from '../../presentation/Presentation';
import type { ReviewWorkspaceModel } from './ReviewWorkspace.view';
import { ReviewSource, ReviewFilters, ReviewInboxList } from './ReviewsInboxParts.view';
import { reviewsCopy as copy } from './Reviews.copy';

export function ReviewsInboxTabletView(props: SurfaceProps<ReviewWorkspaceModel>) {
  return <div className="review-inbox-tablet" data-review-surface="tablet" data-orientation={props.presentation.orientation}>
    <aside aria-label={copy.source.text}><ReviewSource {...props} /></aside>
    <div><ReviewFilters {...props} /><ReviewInboxList {...props} /></div>
  </div>;
}
