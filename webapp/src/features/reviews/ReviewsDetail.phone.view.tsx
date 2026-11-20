import type { SurfaceProps } from '../../presentation/Presentation';
import type { ReviewNavigatorModel } from './ReviewsDetail.presentation';
import { reviewsCopy as copy } from './Reviews.copy';

export function ReviewsDetailPhoneView({ review, selected, onSelect, presentation }: SurfaceProps<ReviewNavigatorModel>) {
  return <aside aria-label={copy.items.text} data-review-surface="phone" data-orientation={presentation.orientation}>
    <details open><summary>{copy.activeItem.text}</summary>
      <ul>{review.request.members.map(item => <li key={item.id}><button aria-current={selected === item.id ? 'step' : undefined} onClick={() => onSelect(item.id)}>{item.label}</button></li>)}</ul>
    </details>
  </aside>;
}
