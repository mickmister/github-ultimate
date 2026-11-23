import type { SurfaceProps } from '../../presentation/Presentation';
import type { ReviewWorkspaceModel } from './ReviewWorkspace.view';
import { ReviewSource, ReviewFilters, ReviewInboxList } from './ReviewsInboxParts.view';
import { reviewsCopy as copy } from './Reviews.copy';

export function ReviewsInboxDesktopView(props: SurfaceProps<ReviewWorkspaceModel>) {
  return <div className="review-inbox-desktop" data-review-surface="desktop" data-orientation={props.presentation.orientation}>
    <aside aria-label={copy.source.text}><ReviewSource {...props} /></aside>
    {props.listing && <section aria-label={copy.filters.text}><h2>{copy.filters.text}</h2><ReviewFilters {...props} /></section>}
    <ReviewInboxList {...props} />
  </div>;
}
