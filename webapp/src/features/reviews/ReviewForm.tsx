import { useLayoutEffect, useRef, useState } from 'react';
import { ReviewFormView, type ReviewFormProps } from './ReviewForm.view';
import { useReviewZen } from './useReviewZen';

export function ReviewForm(props: ReviewFormProps) {
  const [step, setStep] = useState(0);
  const [zen, setZen] = useState(false);
  const { dialog, zenButton, heading } = useReviewZen<HTMLHeadingElement>(zen);
  const previousStep = useRef(step);
  useLayoutEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [step]);
  return <ReviewFormView {...props} step={step} heading={heading} onStep={setStep} zen={zen} onZen={setZen} dialog={dialog} zenButton={zenButton} />;
}
