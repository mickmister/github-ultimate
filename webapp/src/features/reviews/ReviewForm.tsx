import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { ReviewFormView, type ReviewFormProps } from './ReviewForm.view';
import { FeedbackContext } from '../feedback/FeedbackProvider';

export function ReviewForm(props: ReviewFormProps) {
  const [step, setStep] = useState(0);
  const [zen, setZen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const zenButton = useRef<HTMLButtonElement>(null);
  const setPortalContainer = useContext(FeedbackContext)?.setPortalContainer;
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useLayoutEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [step]);
  useLayoutEffect(() => {
    if (!zen || !dialog.current) return;
    const modal = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setPortalContainer?.(modal);
    modal.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => { setPortalContainer?.(null); modal.close(); document.body.style.overflow = overflow; };
  }, [zen, setPortalContainer]);
  const wasZen = useRef(false);
  useLayoutEffect(() => {
    if (wasZen.current && !zen) zenButton.current?.focus({ preventScroll: true });
    wasZen.current = zen;
  }, [zen]);
  return <ReviewFormView {...props} step={step} heading={heading} onStep={setStep} zen={zen} onZen={setZen} dialog={dialog} zenButton={zenButton} />;
}
