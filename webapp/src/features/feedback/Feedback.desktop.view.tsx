import type { SurfaceProps } from '../../presentation/Presentation';
import type { FeedbackRegionProps } from './Feedback.presentation';
import { feedbackCopy as copy } from './Feedback.copy';

export function FeedbackDesktopView({ context, editor, footer, presentation }: SurfaceProps<FeedbackRegionProps>) {
  return <section className="feedback-composition feedback-desktop" data-surface="desktop" data-orientation={presentation.orientation}>
    <div className="feedback-primary">{editor}</div>
    <aside className="feedback-capture" aria-label={copy.capturedContext.text}>{context}</aside>
    <footer>{footer}</footer>
  </section>;
}
