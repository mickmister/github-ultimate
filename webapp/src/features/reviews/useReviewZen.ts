import { useContext, useLayoutEffect, useRef } from 'react';
import { FeedbackContext } from '../feedback/FeedbackProvider';

/** Native top-layer isolation shared by reading and form-filling sessions. */
export function useReviewZen<T extends HTMLElement>(zen: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  const zenButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<T>(null);
  const setPortalContainer = useContext(FeedbackContext)?.setPortalContainer;
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
  return { dialog, zenButton, heading };
}
