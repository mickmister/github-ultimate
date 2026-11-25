import type { SurfaceProps } from '../../presentation/Presentation';
import type { FeedbackRegionProps } from './Feedback.presentation';
import { feedbackCopy as copy } from './Feedback.copy';

export function FeedbackPhoneView({ context, editor, footer, presentation }: SurfaceProps<FeedbackRegionProps>) {
  return <section className="feedback-composition feedback-phone" data-surface="phone" data-orientation={presentation.orientation}>
    <div className="feedback-primary">{editor}</div>
    <details className="feedback-capture"><summary>{copy.capturedContext.text}</summary>{context}</details>
    <footer>{footer}</footer>
  </section>;
}
