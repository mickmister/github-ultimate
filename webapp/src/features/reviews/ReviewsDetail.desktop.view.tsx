import type { SurfaceProps } from '../../presentation/Presentation';
import type { ReviewNavigatorModel } from './ReviewsDetail.presentation';
import { reviewsCopy as copy } from './Reviews.copy';

export function ReviewsDetailDesktopView({ review, selected, onSelect, progress, submitted, presentation }: SurfaceProps<ReviewNavigatorModel>) {
  return <aside aria-label={copy.items.text} data-review-surface="desktop" data-orientation={presentation.orientation}>
    <h2>{copy.items.text}</h2>
    {(['document', 'form'] as const).map(kind => <ul key={kind}>{review.request.members.filter(item => item.kind === kind).map(item => <li key={item.id}><button aria-current={selected === item.id ? 'step' : undefined} onClick={() => onSelect(item.id)}>{item.label}</button><span>{submitted.has(item.id) ? copy.submitted.text : progress.includes(item.id) ? copy.reviewed.text : item.kind}</span></li>)}</ul>)}
  </aside>;
}
