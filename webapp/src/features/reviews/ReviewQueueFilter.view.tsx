import type { ReviewQueueFilter } from './queue';
import { reviewsCopy as copy } from './Reviews.copy';

export function ReviewQueueFilterView({ value, onChange }: { value: ReviewQueueFilter; onChange(value: ReviewQueueFilter): void }) {
  return <label>{copy.queueFilter.text}<select aria-label={copy.queueFilter.text} value={value} onChange={event => onChange(event.target.value as ReviewQueueFilter)}>
    <option value="active">{copy.queueActive.text}</option>
    <option value="dismissed">{copy.queueDismissed.text}</option>
    <option value="completed">{copy.queueCompleted.text}</option>
    <option value="all">{copy.queueAll.text}</option>
  </select></label>;
}
