import { useLayoutEffect, useRef, useState } from 'react';
import { ReviewFormView, type ReviewFormProps } from './ReviewForm.view';

export function ReviewForm(props: ReviewFormProps) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useLayoutEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [step]);
  return <ReviewFormView {...props} step={step} heading={heading} onStep={setStep} />;
}
