import type { SurfaceProps } from '../../presentation/Presentation';
import type { FeedbackRegionProps } from './Feedback.presentation';
import { feedbackCopy as copy } from './Feedback.copy';

export function FeedbackTabletView({ context, editor, footer, presentation }: SurfaceProps<FeedbackRegionProps>) {
  return <section className="feedback-composition feedback-tablet" data-surface="tablet" data-orientation={presentation.orientation}>
    <aside className="feedback-capture" aria-label={copy.capturedContext.text}>{context}</aside>
    <div className="feedback-primary">{editor}<footer>{footer}</footer></div>
  </section>;
}
