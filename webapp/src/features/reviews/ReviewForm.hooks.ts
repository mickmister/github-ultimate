import { useLayoutEffect, useRef, useState } from 'react';
import type { ReviewFormProps } from './ReviewForm.view';
import { useReviewZen } from './useReviewZen';

export function useReviewFormFeature(props: ReviewFormProps) {
  const [step, setStep] = useState(0);
  const [zen, setZen] = useState(false);
  const { dialog, zenButton, heading } = useReviewZen<HTMLHeadingElement>(zen);
  const previousStep = useRef(step);
  const previouslySubmitted = useRef(props.submitted);
  useLayoutEffect(()=>{
    const newlySubmitted=props.submitted&&!previouslySubmitted.current;
    previouslySubmitted.current=props.submitted;
    if(!newlySubmitted||!props.formStatus?.workflowAfterSubmit)return;
    setZen(false);
    const frame=requestAnimationFrame(()=>document.querySelector<HTMLElement>('[data-ui="review-workflow-progress"]')?.scrollIntoView({block:'start'}));
    return()=>cancelAnimationFrame(frame);
  },[props.submitted,props.formStatus?.workflowAfterSubmit]);
  useLayoutEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [step]);
  return { step, heading, onStep: setStep, zen, onZen: setZen, dialog, zenButton };
}
